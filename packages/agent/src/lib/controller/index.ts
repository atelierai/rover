/**
 * CLI Controller Module
 *
 * Provides JSONL session-based CLI control for Code CLI agents
 * (Claude Code, Codex, Gemini, Qwen).
 *
 * @example
 * ```typescript
 * import { createController, createDecisionEngine } from './controller';
 *
 * // Create controller
 * const controller = createController({ verbose: true });
 *
 * // Start a session
 * const session = await controller.startSession('task-123', 'claude', {
 *   prompt: 'Implement the login feature',
 *   cwd: '/path/to/project',
 * });
 *
 * // Subscribe to messages
 * const unsubscribe = controller.onMessage(session.id, (message) => {
 *   console.log('Message:', message);
 * });
 *
 * // Subscribe to events
 * controller.onEvent(session.id, (event) => {
 *   if (event.type === 'waiting_input') {
 *     // CLI is waiting for input, make a decision
 *     const engine = createDecisionEngine({ agent: 'claude' });
 *     const decision = await engine.makeDecision({
 *       taskTitle: 'Login Feature',
 *       taskDescription: 'Implement user login',
 *       branch: 'feature/login',
 *       iteration: 1,
 *       latestCliOutput: await controller.getLatestOutput(session.id),
 *     });
 *
 *     if (decision.status === 'continue') {
 *       await controller.sendCommand(session.id, decision.nextCommand!);
 *     } else if (decision.status === 'complete') {
 *       await controller.stopSession(session.id);
 *     }
 *   }
 * });
 *
 * // Clean up
 * unsubscribe();
 * await controller.stopSession(session.id);
 * ```
 */

// Export types
export type {
  AgentType,
  CliController,
  CliSession,
  ContentPart,
  ControllerConfig,
  DecisionContext,
  DecisionEngine,
  DecisionResult,
  JsonlMessage,
  MessageCallback,
  ResumeSessionOptions,
  SessionEvent,
  SessionEventCallback,
  SessionPersistenceData,
  SessionStatus,
  StartSessionOptions,
} from './types.js';

// Export controller
export { DefaultCliController, createController } from './controller.js';

// Export decision engine
export {
  DefaultDecisionEngine,
  createDecisionEngine,
  DecisionEngineConfig,
} from './decision.js';

// Export JSONL watcher
export {
  JsonlWatcher,
  JsonlWatcherConfig,
  JsonlWatcherEvents,
} from './jsonl-watcher.js';

// Export adapters
export {
  CliAdapter,
  BaseCliAdapter,
  CliStartOptions,
  ClaudeCliAdapter,
  CodexCliAdapter,
  GeminiCliAdapter,
  QwenCliAdapter,
  getAdapter,
  getSupportedAgents,
  isSessionModeSupported,
  clearAdapterCache,
} from './adapters/index.js';
