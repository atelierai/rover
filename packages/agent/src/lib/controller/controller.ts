/**
 * CLI Controller
 *
 * Main controller for managing JSONL-based CLI sessions.
 * Handles session lifecycle, PTY management, and message routing.
 */

import { spawn, IPty } from 'node-pty';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { EventEmitter } from 'events';
import type {
  AgentType,
  CliController,
  CliSession,
  ControllerConfig,
  JsonlMessage,
  MessageCallback,
  ResumeSessionOptions,
  SessionEvent,
  SessionEventCallback,
  SessionPersistenceData,
  SessionStatus,
  StartSessionOptions,
} from './types.js';
import { getAdapter } from './adapters/index.js';
import { JsonlWatcher } from './jsonl-watcher.js';

/**
 * Generate a unique session ID
 */
function generateSessionId(agent: AgentType): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${agent}-${timestamp}-${random}`;
}

/**
 * Default CLI Controller implementation
 */
export class DefaultCliController implements CliController {
  private sessions = new Map<string, CliSession>();
  private watchers = new Map<string, JsonlWatcher>();
  private messageCallbacks = new Map<string, Set<MessageCallback>>();
  private eventCallbacks = new Map<string, Set<SessionEventCallback>>();
  private eventEmitter = new EventEmitter();
  private readonly config: Required<ControllerConfig>;

  constructor(config?: ControllerConfig) {
    this.config = {
      verbose: config?.verbose ?? false,
      decisionAgent: config?.decisionAgent ?? 'claude',
      maxContinueAttempts: config?.maxContinueAttempts ?? 5,
      idleTimeoutSeconds: config?.idleTimeoutSeconds ?? 300,
      sessionBaseDir: config?.sessionBaseDir ?? '.rover/sessions',
    };
  }

  /**
   * Start a new CLI session
   */
  async startSession(
    taskId: string,
    agent: AgentType,
    options: StartSessionOptions
  ): Promise<CliSession> {
    const adapter = getAdapter(agent);
    const sessionId = generateSessionId(agent);

    // Determine session directory
    const sessionDir = options.historyDir ?? join(
      options.cwd ?? process.cwd(),
      this.config.sessionBaseDir,
      taskId
    );

    // Ensure directory exists
    this.ensureDirectory(sessionDir);

    const jsonlPath = adapter.getSessionJsonlPath(sessionId, sessionDir);

    // Create session object
    const session: CliSession = {
      id: sessionId,
      taskId,
      agent,
      status: 'starting',
      jsonlPath,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      cwd: options.cwd,
    };

    // Build environment
    const env = {
      ...process.env,
      ...adapter.getEnvironmentVariables(options),
      ...adapter.getJsonlEnvironment(sessionDir),
      ...(options.env ?? {}),
    };

    // Get start arguments
    const args = adapter.getStartArgs({
      ...options,
      historyDir: sessionDir,
    });

    if (this.config.verbose) {
      console.log(`[Controller] Starting session ${sessionId}`);
      console.log(`[Controller] Command: ${adapter.binary} ${args.join(' ')}`);
      console.log(`[Controller] Working dir: ${options.cwd ?? process.cwd()}`);
    }

    // Spawn PTY
    try {
      const pty = spawn(adapter.binary, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: options.cwd ?? process.cwd(),
        env: env as Record<string, string>,
      });

      session.pty = pty;

      // Setup PTY handlers
      this.setupPtyHandlers(session);

      // Start JSONL watcher
      this.startJsonlWatcher(session);

      // Send initial prompt after a short delay
      if (options.prompt) {
        setTimeout(() => {
          this.sendCommand(sessionId, options.prompt);
        }, 500);
      }

      session.status = 'running';
      this.sessions.set(sessionId, session);

      // Save session metadata
      this.saveSessionMetadata(session);

      // Emit status change
      this.emitEvent(sessionId, {
        type: 'status_change',
        status: 'running',
        previousStatus: 'starting',
      });

      return session;
    } catch (error) {
      session.status = 'failed';
      session.errorMessage = (error as Error).message;
      throw error;
    }
  }

  /**
   * Resume an existing session
   */
  async resumeSession(
    sessionId: string,
    options?: ResumeSessionOptions
  ): Promise<CliSession> {
    // Check if session exists in memory
    let session = this.sessions.get(sessionId);

    if (!session) {
      // Try to load from disk
      session = await this.loadSessionMetadata(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
    }

    const adapter = getAdapter(session.agent);
    const previousStatus = session.status;

    // Build environment
    const env = {
      ...process.env,
      ...adapter.getEnvironmentVariables(),
      ...adapter.getJsonlEnvironment(dirname(session.jsonlPath)),
    };

    // Get resume arguments
    const args = adapter.getResumeArgs(sessionId, {
      cwd: options?.cwd ?? session.cwd,
    });

    if (this.config.verbose) {
      console.log(`[Controller] Resuming session ${sessionId}`);
      console.log(`[Controller] Command: ${adapter.binary} ${args.join(' ')}`);
    }

    // Spawn new PTY
    try {
      const pty = spawn(adapter.binary, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: options?.cwd ?? session.cwd ?? process.cwd(),
        env: env as Record<string, string>,
      });

      session.pty = pty;
      session.status = 'running';
      session.lastActivityAt = new Date();

      // Setup PTY handlers
      this.setupPtyHandlers(session);

      // Restart JSONL watcher if needed
      if (!this.watchers.has(sessionId)) {
        this.startJsonlWatcher(session);
      }

      // Send prompt if provided
      if (options?.prompt) {
        setTimeout(() => {
          this.sendCommand(sessionId, options.prompt!);
        }, 500);
      }

      this.sessions.set(sessionId, session);
      this.saveSessionMetadata(session);

      // Emit status change
      this.emitEvent(sessionId, {
        type: 'status_change',
        status: 'running',
        previousStatus,
      });

      return session;
    } catch (error) {
      session.status = 'failed';
      session.errorMessage = (error as Error).message;
      throw error;
    }
  }

  /**
   * Send a command to an active session
   */
  async sendCommand(sessionId: string, command: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.pty) {
      throw new Error(`Session ${sessionId} has no active PTY`);
    }

    if (this.config.verbose) {
      console.log(`[Controller] Sending to ${sessionId}: ${command}`);
    }

    // Write command to PTY
    session.pty.write(command + '\n');
    session.lastActivityAt = new Date();

    // Update status if was waiting
    if (session.status === 'waiting_input') {
      const previousStatus = session.status;
      session.status = 'running';
      this.emitEvent(sessionId, {
        type: 'status_change',
        status: 'running',
        previousStatus,
      });
    }
  }

  /**
   * Stop a session gracefully
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const adapter = getAdapter(session.agent);

    if (this.config.verbose) {
      console.log(`[Controller] Stopping session ${sessionId}`);
    }

    // Send stop command
    if (session.pty) {
      try {
        session.pty.write(adapter.getStopCommand() + '\n');

        // Wait for graceful exit
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            // Force kill after timeout
            session.pty?.kill();
            resolve();
          }, 5000);

          session.pty?.onExit(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } catch {
        // PTY might already be dead
      }
    }

    this.cleanupSession(sessionId);
  }

  /**
   * Abort a session immediately
   */
  async abortSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (this.config.verbose) {
      console.log(`[Controller] Aborting session ${sessionId}`);
    }

    // Force kill PTY
    if (session.pty) {
      try {
        session.pty.kill();
      } catch {
        // Already dead
      }
    }

    session.status = 'aborted';
    this.cleanupSession(sessionId);

    this.emitEvent(sessionId, {
      type: 'status_change',
      status: 'aborted',
      previousStatus: session.status,
    });
  }

  /**
   * Get current session status
   */
  getSessionStatus(sessionId: string): SessionStatus | undefined {
    return this.sessions.get(sessionId)?.status;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): CliSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): CliSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'running' || s.status === 'waiting_input'
    );
  }

  /**
   * Subscribe to session messages
   */
  onMessage(sessionId: string, callback: MessageCallback): () => void {
    if (!this.messageCallbacks.has(sessionId)) {
      this.messageCallbacks.set(sessionId, new Set());
    }
    this.messageCallbacks.get(sessionId)!.add(callback);

    return () => {
      this.messageCallbacks.get(sessionId)?.delete(callback);
    };
  }

  /**
   * Subscribe to session events
   */
  onEvent(sessionId: string, callback: SessionEventCallback): () => void {
    if (!this.eventCallbacks.has(sessionId)) {
      this.eventCallbacks.set(sessionId, new Set());
    }
    this.eventCallbacks.get(sessionId)!.add(callback);

    return () => {
      this.eventCallbacks.get(sessionId)?.delete(callback);
    };
  }

  /**
   * Get recent messages from a session
   */
  async getMessages(sessionId: string, limit?: number): Promise<JsonlMessage[]> {
    const watcher = this.watchers.get(sessionId);
    if (!watcher) {
      // Try to read directly from file
      const session = this.sessions.get(sessionId);
      if (!session) {
        return [];
      }

      const adapter = getAdapter(session.agent);
      const tempWatcher = new JsonlWatcher(session.jsonlPath, adapter, {
        processExisting: false,
      });

      const messages = await tempWatcher.readAllMessages();
      return limit ? messages.slice(-limit) : messages;
    }

    const messages = await watcher.readAllMessages();
    return limit ? messages.slice(-limit) : messages;
  }

  /**
   * Get the latest output from a session
   */
  async getLatestOutput(sessionId: string): Promise<string> {
    const watcher = this.watchers.get(sessionId);
    if (!watcher) {
      return '';
    }

    return watcher.getLatestAssistantContent();
  }

  // ==================== Private Methods ====================

  /**
   * Setup PTY event handlers
   */
  private setupPtyHandlers(session: CliSession): void {
    if (!session.pty) return;

    const adapter = getAdapter(session.agent);

    // Handle PTY data
    session.pty.onData((data) => {
      session.lastActivityAt = new Date();

      if (this.config.verbose) {
        process.stdout.write(data);
      }

      // Check for authentication prompts
      if (adapter.isAuthenticationRequired(data)) {
        const previousStatus = session.status;
        session.status = 'failed';
        session.errorMessage = 'Authentication required';

        this.emitEvent(session.id, {
          type: 'status_change',
          status: 'failed',
          previousStatus,
        });

        this.emitEvent(session.id, {
          type: 'error',
          error: new Error('Authentication required - please authenticate first'),
        });
      }
    });

    // Handle PTY exit
    session.pty.onExit(({ exitCode, signal }) => {
      if (this.config.verbose) {
        console.log(
          `[Controller] Session ${session.id} exited (code: ${exitCode}, signal: ${signal})`
        );
      }

      const previousStatus = session.status;
      session.exitCode = exitCode;
      session.status = exitCode === 0 ? 'completed' : 'failed';
      session.pty = undefined;

      this.saveSessionMetadata(session);

      this.emitEvent(session.id, {
        type: 'exit',
        exitCode,
      });

      this.emitEvent(session.id, {
        type: 'status_change',
        status: session.status,
        previousStatus,
      });
    });
  }

  /**
   * Start JSONL watcher for a session
   */
  private startJsonlWatcher(session: CliSession): void {
    const adapter = getAdapter(session.agent);

    const watcher = new JsonlWatcher(session.jsonlPath, adapter, {
      processExisting: true,
    });

    // Handle messages
    watcher.on('message', (message) => {
      this.emitMessage(session.id, message);
    });

    // Handle waiting state
    watcher.on('waiting_input', (message) => {
      const previousStatus = session.status;
      session.status = 'waiting_input';

      this.emitEvent(session.id, {
        type: 'waiting_input',
        lastMessage: message,
      });

      if (previousStatus !== 'waiting_input') {
        this.emitEvent(session.id, {
          type: 'status_change',
          status: 'waiting_input',
          previousStatus,
        });
      }
    });

    // Handle completion
    watcher.on('completed', (message) => {
      this.emitEvent(session.id, {
        type: 'completed',
        summary: message.summary,
      });
    });

    // Handle errors
    watcher.on('error', (error, message) => {
      this.emitEvent(session.id, {
        type: 'error',
        error,
      });

      if (message) {
        this.emitMessage(session.id, message);
      }
    });

    watcher.start();
    this.watchers.set(session.id, watcher);
  }

  /**
   * Emit a message to all subscribers
   */
  private emitMessage(sessionId: string, message: JsonlMessage): void {
    const callbacks = this.messageCallbacks.get(sessionId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(message);
        } catch (error) {
          console.error('[Controller] Message callback error:', error);
        }
      }
    }

    // Also emit to event subscribers
    this.emitEvent(sessionId, { type: 'message', message });
  }

  /**
   * Emit an event to all subscribers
   */
  private emitEvent(sessionId: string, event: SessionEvent): void {
    const callbacks = this.eventCallbacks.get(sessionId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(event);
        } catch (error) {
          console.error('[Controller] Event callback error:', error);
        }
      }
    }
  }

  /**
   * Cleanup session resources
   */
  private cleanupSession(sessionId: string): void {
    // Stop watcher
    const watcher = this.watchers.get(sessionId);
    if (watcher) {
      watcher.stop();
      this.watchers.delete(sessionId);
    }

    // Clear callbacks
    this.messageCallbacks.delete(sessionId);
    this.eventCallbacks.delete(sessionId);

    // Update session
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty = undefined;
      this.saveSessionMetadata(session);
    }
  }

  /**
   * Save session metadata to disk
   */
  private saveSessionMetadata(session: CliSession): void {
    const metadataPath = session.jsonlPath.replace('.jsonl', '.meta.json');

    const data: SessionPersistenceData = {
      id: session.id,
      taskId: session.taskId,
      agent: session.agent,
      status: session.status,
      jsonlPath: session.jsonlPath,
      startedAt: session.startedAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      cwd: session.cwd,
      messageCount: 0, // TODO: track actual count
    };

    try {
      this.ensureDirectory(dirname(metadataPath));
      writeFileSync(metadataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[Controller] Failed to save session metadata:', error);
    }
  }

  /**
   * Load session metadata from disk
   */
  private async loadSessionMetadata(
    sessionId: string
  ): Promise<CliSession | null> {
    // Search for session in known locations
    // This is a simplified implementation - in production,
    // you'd want to index sessions properly

    // For now, return null and rely on memory
    return null;
  }

  /**
   * Ensure directory exists
   */
  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Create a new CLI controller
 */
export function createController(config?: ControllerConfig): CliController {
  return new DefaultCliController(config);
}
