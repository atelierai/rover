/**
 * CLI Adapter Base Interface
 *
 * Defines the interface that each CLI adapter must implement
 * to support JSONL session-based interactions.
 */

import type {
  AgentType,
  JsonlMessage,
  StartSessionOptions,
} from '../types.js';

/**
 * Options for starting a CLI session
 */
export interface CliStartOptions extends StartSessionOptions {
  /** Session ID for resuming */
  sessionId?: string;
  /** History directory path */
  historyDir?: string;
}

/**
 * CLI Adapter interface
 *
 * Each supported CLI (Claude, Codex, Gemini, Qwen) must implement
 * this interface to provide CLI-specific behavior.
 */
export interface CliAdapter {
  /** Adapter name (matches agent type) */
  readonly name: AgentType;

  /** CLI binary name */
  readonly binary: string;

  // ==================== JSONL Configuration ====================

  /**
   * Get the default JSONL directory for a task
   * @param taskId Task identifier
   * @param workspaceDir Base workspace directory
   */
  getJsonlDir(taskId: string, workspaceDir?: string): string;

  /**
   * Get the JSONL file path for a specific session
   * @param sessionId Session identifier
   * @param baseDir Base directory for sessions
   */
  getSessionJsonlPath(sessionId: string, baseDir: string): string;

  /**
   * Parse a JSONL line into a normalized message
   * @param line Raw JSONL line
   */
  parseJsonlMessage(line: string): JsonlMessage | null;

  // ==================== CLI Commands ====================

  /**
   * Get CLI arguments for starting a new session
   * @param options Start options
   */
  getStartArgs(options: CliStartOptions): string[];

  /**
   * Get CLI arguments for resuming an existing session
   * @param sessionId Session to resume
   * @param options Additional options
   */
  getResumeArgs(sessionId: string, options?: CliStartOptions): string[];

  /**
   * Get the command to continue execution
   */
  getContinueCommand(): string;

  /**
   * Get the command to stop/exit the session
   */
  getStopCommand(): string;

  /**
   * Get the command to clear context (if supported)
   */
  getClearCommand(): string | null;

  // ==================== State Detection ====================

  /**
   * Check if the CLI is waiting for user input
   * @param message Last message from CLI
   */
  isWaitingForInput(message: JsonlMessage): boolean;

  /**
   * Check if the task is completed
   * @param message Last message from CLI
   */
  isCompleted(message: JsonlMessage): boolean;

  /**
   * Check if an error occurred
   * @param message Last message from CLI
   */
  isError(message: JsonlMessage): boolean;

  /**
   * Check if authentication is required
   * @param output CLI output text
   */
  isAuthenticationRequired(output: string): boolean;

  // ==================== Environment ====================

  /**
   * Get environment variables required for this CLI
   * @param options Session options
   */
  getEnvironmentVariables(options?: CliStartOptions): Record<string, string>;

  /**
   * Get default environment variable overrides for JSONL path
   * @param jsonlDir Directory for JSONL files
   */
  getJsonlEnvironment(jsonlDir: string): Record<string, string>;
}

/**
 * Base implementation with common functionality
 */
export abstract class BaseCliAdapter implements CliAdapter {
  abstract readonly name: AgentType;
  abstract readonly binary: string;

  abstract getJsonlDir(taskId: string, workspaceDir?: string): string;
  abstract getSessionJsonlPath(sessionId: string, baseDir: string): string;
  abstract parseJsonlMessage(line: string): JsonlMessage | null;
  abstract getStartArgs(options: CliStartOptions): string[];
  abstract getResumeArgs(sessionId: string, options?: CliStartOptions): string[];

  getContinueCommand(): string {
    return '/continue';
  }

  getStopCommand(): string {
    return '/stop';
  }

  getClearCommand(): string | null {
    return '/clear';
  }

  isWaitingForInput(message: JsonlMessage): boolean {
    if (message.type !== 'assistant' || !message.message?.content) {
      return false;
    }

    const content = this.extractTextContent(message.message.content);
    const waitingPhrases = [
      'done for now',
      'waiting for',
      'let me know',
      'please provide',
      'need more information',
      'what would you like',
      'how can i help',
    ];

    const lowerContent = content.toLowerCase();
    return waitingPhrases.some((phrase) => lowerContent.includes(phrase));
  }

  isCompleted(message: JsonlMessage): boolean {
    return message.type === 'summary' || message.status === 'completed';
  }

  isError(message: JsonlMessage): boolean {
    if (message.type === 'error') return true;
    if (message.status === 'error') return true;
    if (message.error) return true;
    return false;
  }

  isAuthenticationRequired(output: string): boolean {
    const authPatterns = [
      /waiting for authentication/i,
      /please authenticate/i,
      /login required/i,
      /authentication required/i,
      /sign in to continue/i,
      /api key.*invalid/i,
      /unauthorized/i,
    ];

    return authPatterns.some((pattern) => pattern.test(output));
  }

  getEnvironmentVariables(_options?: CliStartOptions): Record<string, string> {
    return {};
  }

  getJsonlEnvironment(_jsonlDir: string): Record<string, string> {
    return {};
  }

  /**
   * Extract text content from message content (string or ContentPart[])
   */
  protected extractTextContent(content: string | unknown[]): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter((part: any) => part.type === 'text' && part.text)
        .map((part: any) => part.text)
        .join('\n');
    }

    return '';
  }

  /**
   * Generate a unique session ID
   */
  protected generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${this.name}-${timestamp}-${random}`;
  }

  /**
   * Parse timestamp from various formats
   */
  protected parseTimestamp(value: unknown): string {
    if (!value) {
      return new Date().toISOString();
    }

    if (typeof value === 'string') {
      const date = new Date(value);
      return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    }

    if (typeof value === 'number') {
      return new Date(value).toISOString();
    }

    return new Date().toISOString();
  }
}
