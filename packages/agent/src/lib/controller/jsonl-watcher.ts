/**
 * JSONL Watcher
 *
 * Monitors JSONL session files for changes and emits parsed messages.
 * Uses file watching to detect new entries and maintains read position
 * for incremental parsing.
 */

import { watch, FSWatcher } from 'chokidar';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'events';
import type { JsonlMessage } from './types.js';
import type { CliAdapter } from './adapters/base.js';

/**
 * Events emitted by JsonlWatcher
 */
export interface JsonlWatcherEvents {
  message: (message: JsonlMessage) => void;
  waiting_input: (message: JsonlMessage) => void;
  completed: (message: JsonlMessage) => void;
  error: (error: Error, message?: JsonlMessage) => void;
  file_created: (path: string) => void;
  file_deleted: (path: string) => void;
}

/**
 * Configuration for JsonlWatcher
 */
export interface JsonlWatcherConfig {
  /** Polling interval for file changes (ms) */
  pollInterval?: number;
  /** Whether to process existing content on start */
  processExisting?: boolean;
  /** Maximum lines to read per batch */
  batchSize?: number;
}

/**
 * JSONL file watcher that emits parsed messages
 */
export class JsonlWatcher extends EventEmitter {
  private watcher?: FSWatcher;
  private lastPosition = 0;
  private lastSize = 0;
  private processing = false;
  private pendingProcess = false;
  private started = false;
  private readonly config: Required<JsonlWatcherConfig>;

  constructor(
    private readonly filePath: string,
    private readonly adapter: CliAdapter,
    config?: JsonlWatcherConfig
  ) {
    super();
    this.config = {
      pollInterval: config?.pollInterval ?? 100,
      processExisting: config?.processExisting ?? true,
      batchSize: config?.batchSize ?? 1000,
    };
  }

  /**
   * Start watching the JSONL file
   */
  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    // Initialize watcher
    this.watcher = watch(this.filePath, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 50,
        pollInterval: this.config.pollInterval,
      },
    });

    this.watcher.on('add', (path) => {
      this.emit('file_created', path);
      if (this.config.processExisting) {
        this.processFile();
      }
    });

    this.watcher.on('change', () => {
      this.processNewLines();
    });

    this.watcher.on('unlink', (path) => {
      this.emit('file_deleted', path);
      this.lastPosition = 0;
      this.lastSize = 0;
    });

    this.watcher.on('error', (error) => {
      this.emit('error', error);
    });

    // If file already exists, process it
    if (existsSync(this.filePath) && this.config.processExisting) {
      this.processFile();
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.started = false;
    this.lastPosition = 0;
    this.lastSize = 0;
  }

  /**
   * Check if watcher is active
   */
  isActive(): boolean {
    return this.started;
  }

  /**
   * Get current file position
   */
  getPosition(): number {
    return this.lastPosition;
  }

  /**
   * Reset position to start of file
   */
  resetPosition(): void {
    this.lastPosition = 0;
    this.lastSize = 0;
  }

  /**
   * Process entire file from current position
   */
  async processFile(): Promise<JsonlMessage[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const messages: JsonlMessage[] = [];

    try {
      const fileStream = createReadStream(this.filePath, {
        start: this.lastPosition,
        encoding: 'utf8',
      });

      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let bytesRead = this.lastPosition;

      for await (const line of rl) {
        bytesRead += Buffer.byteLength(line, 'utf8') + 1; // +1 for newline

        if (!line.trim()) {
          continue;
        }

        const message = this.adapter.parseJsonlMessage(line);
        if (message) {
          messages.push(message);
          this.emitMessage(message);
        }
      }

      this.lastPosition = bytesRead;

      // Update file size
      try {
        this.lastSize = statSync(this.filePath).size;
      } catch {
        // File might have been deleted
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.emit('error', error as Error);
      }
    }

    return messages;
  }

  /**
   * Process only new lines since last read
   */
  private async processNewLines(): Promise<void> {
    // Prevent concurrent processing
    if (this.processing) {
      this.pendingProcess = true;
      return;
    }

    this.processing = true;

    try {
      // Check if file has grown
      if (!existsSync(this.filePath)) {
        return;
      }

      const stats = statSync(this.filePath);
      if (stats.size <= this.lastSize) {
        // File hasn't grown (or was truncated)
        if (stats.size < this.lastSize) {
          // File was truncated, reset position
          this.lastPosition = 0;
          this.lastSize = 0;
        }
        return;
      }

      // Read new content
      await this.processFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.emit('error', error as Error);
      }
    } finally {
      this.processing = false;

      // Process pending if any
      if (this.pendingProcess) {
        this.pendingProcess = false;
        setImmediate(() => this.processNewLines());
      }
    }
  }

  /**
   * Emit a message and check for special states
   */
  private emitMessage(message: JsonlMessage): void {
    this.emit('message', message);

    // Check for waiting state
    if (this.adapter.isWaitingForInput(message)) {
      this.emit('waiting_input', message);
    }

    // Check for completion
    if (this.adapter.isCompleted(message)) {
      this.emit('completed', message);
    }

    // Check for error
    if (this.adapter.isError(message)) {
      const error = new Error(
        message.error?.message || 'CLI reported an error'
      );
      this.emit('error', error, message);
    }
  }

  /**
   * Read all messages from the file (without watching)
   */
  async readAllMessages(): Promise<JsonlMessage[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const messages: JsonlMessage[] = [];

    try {
      const fileStream = createReadStream(this.filePath, {
        encoding: 'utf8',
      });

      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        const message = this.adapter.parseJsonlMessage(line);
        if (message) {
          messages.push(message);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return messages;
  }

  /**
   * Get the last N messages from the file
   */
  async getLastMessages(count: number): Promise<JsonlMessage[]> {
    const allMessages = await this.readAllMessages();
    return allMessages.slice(-count);
  }

  /**
   * Get latest assistant message content
   */
  async getLatestAssistantContent(): Promise<string> {
    const messages = await this.readAllMessages();

    // Find last assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'assistant' && msg.message?.content) {
        const content = msg.message.content;
        if (typeof content === 'string') {
          return content;
        }
        if (Array.isArray(content)) {
          return content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text || '')
            .join('\n');
        }
      }
    }

    return '';
  }
}

// Type augmentation for EventEmitter
declare interface JsonlWatcher {
  on<E extends keyof JsonlWatcherEvents>(
    event: E,
    listener: JsonlWatcherEvents[E]
  ): this;
  emit<E extends keyof JsonlWatcherEvents>(
    event: E,
    ...args: Parameters<JsonlWatcherEvents[E]>
  ): boolean;
}
