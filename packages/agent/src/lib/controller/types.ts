/**
 * CLI Controller Types
 *
 * Type definitions for the JSONL session-based CLI controller
 * that manages interactions with Code CLI (Claude, Codex, Gemini, Qwen).
 */

import type { IPty } from 'node-pty';

/**
 * Supported agent types
 */
export type AgentType = 'claude' | 'codex' | 'gemini' | 'qwen' | 'cursor';

/**
 * Session status states
 */
export type SessionStatus =
  | 'starting' // Session is being initialized
  | 'running' // CLI is actively processing
  | 'waiting_input' // CLI is waiting for user input
  | 'completed' // Task completed successfully
  | 'failed' // Task failed with error
  | 'aborted'; // Session was manually aborted

/**
 * CLI Session representation
 */
export interface CliSession {
  /** Unique session identifier */
  id: string;
  /** Associated task ID */
  taskId: string;
  /** Agent type (claude, codex, etc.) */
  agent: AgentType;
  /** Current session status */
  status: SessionStatus;
  /** PTY instance for the CLI process */
  pty?: IPty;
  /** Path to the JSONL session file */
  jsonlPath: string;
  /** Session start time */
  startedAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Working directory */
  cwd?: string;
  /** Exit code if completed/failed */
  exitCode?: number;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Options for starting a new session
 */
export interface StartSessionOptions {
  /** Initial prompt to send */
  prompt: string;
  /** Working directory */
  cwd?: string;
  /** Custom environment variables */
  env?: Record<string, string>;
  /** Directory for JSONL history */
  historyDir?: string;
  /** Model to use (if supported) */
  model?: string;
  /** Skip permission prompts */
  skipPermissions?: boolean;
}

/**
 * Options for resuming an existing session
 */
export interface ResumeSessionOptions {
  /** New prompt to send after resuming */
  prompt?: string;
  /** Working directory override */
  cwd?: string;
}

/**
 * Content part in a message (for multimodal content)
 */
export interface ContentPart {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  data?: string;
  name?: string;
  input?: Record<string, unknown>;
  output?: string;
}

/**
 * Unified JSONL message format
 * Normalized from various CLI-specific formats
 */
export interface JsonlMessage {
  /** Message type */
  type:
    | 'user'
    | 'assistant'
    | 'system'
    | 'tool_use'
    | 'tool_result'
    | 'summary'
    | 'error';
  /** ISO timestamp */
  timestamp: string;
  /** Session ID */
  sessionId: string;
  /** Unique message ID */
  uuid?: string;
  /** Parent message ID (for threading) */
  parentUuid?: string;
  /** Message content */
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string | ContentPart[];
  };
  /** Tool use details */
  toolUse?: {
    id?: string;
    name: string;
    input: Record<string, unknown>;
  };
  /** Tool result details */
  toolResult?: {
    id?: string;
    name: string;
    output: string;
    isError?: boolean;
  };
  /** Processing status */
  status?: 'running' | 'completed' | 'error' | 'waiting';
  /** Working directory */
  cwd?: string;
  /** Model used */
  model?: string;
  /** Cost in dollars */
  cost?: number;
  /** Token count */
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  /** Summary text (for summary type) */
  summary?: string;
  /** Error details (for error type) */
  error?: {
    code?: string;
    message: string;
    recoverable?: boolean;
  };
  /** Raw entry from CLI (for debugging) */
  raw?: unknown;
}

/**
 * Message callback type
 */
export type MessageCallback = (message: JsonlMessage) => void;

/**
 * Session event types
 */
export type SessionEvent =
  | { type: 'message'; message: JsonlMessage }
  | { type: 'status_change'; status: SessionStatus; previousStatus: SessionStatus }
  | { type: 'waiting_input'; lastMessage: JsonlMessage }
  | { type: 'completed'; summary?: string }
  | { type: 'error'; error: Error }
  | { type: 'exit'; exitCode: number };

/**
 * Session event callback
 */
export type SessionEventCallback = (event: SessionEvent) => void;

/**
 * CLI Controller interface
 */
export interface CliController {
  /**
   * Start a new CLI session
   */
  startSession(
    taskId: string,
    agent: AgentType,
    options: StartSessionOptions
  ): Promise<CliSession>;

  /**
   * Resume an existing session
   */
  resumeSession(
    sessionId: string,
    options?: ResumeSessionOptions
  ): Promise<CliSession>;

  /**
   * Send a command to an active session
   */
  sendCommand(sessionId: string, command: string): Promise<void>;

  /**
   * Stop a session gracefully
   */
  stopSession(sessionId: string): Promise<void>;

  /**
   * Abort a session immediately
   */
  abortSession(sessionId: string): Promise<void>;

  /**
   * Get current session status
   */
  getSessionStatus(sessionId: string): SessionStatus | undefined;

  /**
   * Get session by ID
   */
  getSession(sessionId: string): CliSession | undefined;

  /**
   * Get all active sessions
   */
  getActiveSessions(): CliSession[];

  /**
   * Subscribe to session messages
   */
  onMessage(sessionId: string, callback: MessageCallback): () => void;

  /**
   * Subscribe to session events
   */
  onEvent(sessionId: string, callback: SessionEventCallback): () => void;

  /**
   * Get recent messages from a session
   */
  getMessages(sessionId: string, limit?: number): Promise<JsonlMessage[]>;

  /**
   * Get the latest output from a session (for decision making)
   */
  getLatestOutput(sessionId: string): Promise<string>;
}

/**
 * Decision result from the decision engine
 */
export interface DecisionResult {
  /** Decision status */
  status: 'complete' | 'continue' | 'needs_attention';
  /** Summary if completed */
  summary?: string;
  /** Next command if continuing */
  nextCommand?: string;
  /** Reason if needs attention */
  reason?: string;
}

/**
 * Context for making a decision
 */
export interface DecisionContext {
  /** Task title */
  taskTitle: string;
  /** Task description */
  taskDescription: string;
  /** Git branch */
  branch: string;
  /** Iteration number */
  iteration: number;
  /** Latest CLI output */
  latestCliOutput: string;
  /** Previously sent commands */
  previousCommands?: string[];
  /** Maximum token budget */
  maxTokens?: number;
}

/**
 * Decision engine interface
 */
export interface DecisionEngine {
  /**
   * Make a decision based on the current context
   */
  makeDecision(context: DecisionContext): Promise<DecisionResult>;
}

/**
 * Session persistence data (for saving/loading sessions)
 */
export interface SessionPersistenceData {
  id: string;
  taskId: string;
  agent: AgentType;
  status: SessionStatus;
  jsonlPath: string;
  startedAt: string;
  lastActivityAt: string;
  cwd?: string;
  messageCount: number;
  lastMessageUuid?: string;
}

/**
 * Controller configuration options
 */
export interface ControllerConfig {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Default agent to use for decisions */
  decisionAgent?: AgentType;
  /** Maximum auto-continue attempts */
  maxContinueAttempts?: number;
  /** Idle timeout in seconds before checking status */
  idleTimeoutSeconds?: number;
  /** Base directory for session data */
  sessionBaseDir?: string;
}
