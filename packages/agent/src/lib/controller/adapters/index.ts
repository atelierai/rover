/**
 * CLI Adapters Index
 *
 * Exports all CLI adapters and provides factory function
 * for creating adapters based on agent type.
 */

import type { AgentType } from '../types.js';
import type { CliAdapter } from './base.js';
import { ClaudeCliAdapter } from './claude.js';
import { CodexCliAdapter } from './codex.js';
import { GeminiCliAdapter } from './gemini.js';
import { QwenCliAdapter } from './qwen.js';

// Export base interface and class
export { CliAdapter, BaseCliAdapter, CliStartOptions } from './base.js';

// Export concrete adapters
export { ClaudeCliAdapter } from './claude.js';
export { CodexCliAdapter } from './codex.js';
export { GeminiCliAdapter } from './gemini.js';
export { QwenCliAdapter } from './qwen.js';

/**
 * Adapter instances cache
 */
const adapterCache = new Map<AgentType, CliAdapter>();

/**
 * Get CLI adapter for the specified agent type
 *
 * @param agent Agent type (claude, codex, gemini, qwen)
 * @returns CLI adapter instance
 * @throws Error if agent type is not supported
 */
export function getAdapter(agent: AgentType): CliAdapter {
  // Check cache first
  const cached = adapterCache.get(agent);
  if (cached) {
    return cached;
  }

  // Create new adapter
  let adapter: CliAdapter;

  switch (agent) {
    case 'claude':
      adapter = new ClaudeCliAdapter();
      break;
    case 'codex':
      adapter = new CodexCliAdapter();
      break;
    case 'gemini':
      adapter = new GeminiCliAdapter();
      break;
    case 'qwen':
      adapter = new QwenCliAdapter();
      break;
    case 'cursor':
      // Cursor uses Claude adapter with some overrides
      // For now, fallback to Claude
      adapter = new ClaudeCliAdapter();
      break;
    default:
      throw new Error(`Unsupported agent type: ${agent}`);
  }

  // Cache and return
  adapterCache.set(agent, adapter);
  return adapter;
}

/**
 * Check if an agent type is supported for session mode
 *
 * @param agent Agent type to check
 * @returns true if the agent supports JSONL session mode
 */
export function isSessionModeSupported(agent: AgentType): boolean {
  const supportedAgents: AgentType[] = ['claude', 'codex', 'gemini', 'qwen'];
  return supportedAgents.includes(agent);
}

/**
 * Get all supported agent types for session mode
 *
 * @returns Array of supported agent types
 */
export function getSupportedAgents(): AgentType[] {
  return ['claude', 'codex', 'gemini', 'qwen'];
}

/**
 * Clear the adapter cache (useful for testing)
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}
