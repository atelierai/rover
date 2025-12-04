/**
 * Manual Mode for Sandbox
 *
 * Extends sandbox functionality to support JSONL-based CLI sessions
 * for interactive Code CLI control (Claude, Codex, Gemini, Qwen).
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskDescriptionManager } from 'rover-schemas';

/**
 * Manual mode configuration
 */
export interface ManualModeConfig {
  /** Enable manual mode */
  enabled: boolean;
  /** Session ID for resuming */
  sessionId?: string;
  /** Agent type for decision making */
  decisionAgent?: string;
  /** Maximum auto-continue attempts */
  maxContinueAttempts?: number;
  /** Idle timeout in seconds */
  idleTimeoutSeconds?: number;
}

/**
 * Manual state persisted to disk
 */
export interface ManualState {
  /** Session ID */
  sessionId: string;
  /** Task ID */
  taskId: string;
  /** Agent type */
  agent: string;
  /** Container ID/Name */
  containerId?: string;
  /** Manual status */
  status: 'running' | 'waiting' | 'completed' | 'failed';
  /** Start time */
  startedAt: string;
  /** Last activity time */
  lastActivityAt: string;
  /** Current iteration */
  iteration: number;
  /** Continue attempts */
  continueAttempts: number;
  /** JSONL file path (relative) */
  jsonlPath: string;
  /** Last message UUID */
  lastMessageUuid?: string;
}

/**
 * Get manual directory for a task
 */
export function getManualDir(task: TaskDescriptionManager): string {
  const sessionsPath = join(task.taskPath(), 'sessions');
  if (!existsSync(sessionsPath)) {
    mkdirSync(sessionsPath, { recursive: true });
  }
  return sessionsPath;
}

/**
 * Get manual state file path
 */
export function getManualStatePath(task: TaskDescriptionManager): string {
  return join(getManualDir(task), 'state.json');
}

/**
 * Load manual state from disk
 */
export function loadManualState(
  task: TaskDescriptionManager
): ManualState | null {
  const statePath = getManualStatePath(task);
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    return JSON.parse(content) as ManualState;
  } catch {
    return null;
  }
}

/**
 * Save manual state to disk
 */
export function saveManualState(
  task: TaskDescriptionManager,
  state: ManualState
): void {
  const statePath = getManualStatePath(task);
  const sessionsDir = getManualDir(task);

  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Check if a task has an active manual
 */
export function hasActiveManual(task: TaskDescriptionManager): boolean {
  const state = loadManualState(task);
  if (!state) {
    return false;
  }

  return state.status === 'running' || state.status === 'waiting';
}

/**
 * Generate a new session ID
 */
export function generateSessionId(agent: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${agent}-${timestamp}-${random}`;
}

/**
 * Create initial manual state
 */
export function createManualState(
  task: TaskDescriptionManager,
  agent: string,
  sessionId?: string
): ManualState {
  const id = sessionId ?? generateSessionId(agent);

  return {
    sessionId: id,
    taskId: task.id.toString(),
    agent,
    status: 'running',
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    iteration: task.iterations,
    continueAttempts: 0,
    jsonlPath: `sessions/${id}.jsonl`,
  };
}

/**
 * Update manual state
 */
export function updateManualState(
  task: TaskDescriptionManager,
  updates: Partial<ManualState>
): ManualState | null {
  const state = loadManualState(task);
  if (!state) {
    return null;
  }

  const updated: ManualState = {
    ...state,
    ...updates,
    lastActivityAt: new Date().toISOString(),
  };

  saveManualState(task, updated);
  return updated;
}

/**
 * Mark manual as completed
 */
export function completeManual(task: TaskDescriptionManager): void {
  updateManualState(task, { status: 'completed' });
}

/**
 * Mark manual as failed
 */
export function failManual(
  task: TaskDescriptionManager,
  error?: string
): void {
  updateManualState(task, { status: 'failed' });
}

/**
 * Increment continue attempts
 */
export function incrementContinueAttempts(
  task: TaskDescriptionManager
): number {
  const state = loadManualState(task);
  if (!state) {
    return 0;
  }

  const newAttempts = state.continueAttempts + 1;
  updateManualState(task, { continueAttempts: newAttempts });
  return newAttempts;
}

/**
 * Reset continue attempts
 */
export function resetContinueAttempts(task: TaskDescriptionManager): void {
  updateManualState(task, { continueAttempts: 0 });
}

/**
 * Get default manual mode config
 */
export function getDefaultManualModeConfig(): ManualModeConfig {
  return {
    enabled: false,
    decisionAgent: 'claude',
    maxContinueAttempts: 5,
    idleTimeoutSeconds: 300,
  };
}

/**
 * Parse manual mode config from environment
 */
export function parseManualModeFromEnv(): Partial<ManualModeConfig> {
  const config: Partial<ManualModeConfig> = {};

  if (process.env.ROVER_SESSION_MODE === 'true') {
    config.enabled = true;
  }

  if (process.env.ROVER_DECISION_AGENT) {
    config.decisionAgent = process.env.ROVER_DECISION_AGENT;
  }

  if (process.env.ROVER_MAX_CONTINUE) {
    config.maxContinueAttempts = parseInt(process.env.ROVER_MAX_CONTINUE, 10);
  }

  if (process.env.ROVER_IDLE_TIMEOUT) {
    config.idleTimeoutSeconds = parseInt(process.env.ROVER_IDLE_TIMEOUT, 10);
  }

  return config;
}

/**
 * Merge manual mode configs
 */
export function mergeManualModeConfig(
  ...configs: Partial<ManualModeConfig>[]
): ManualModeConfig {
  const base = getDefaultManualModeConfig();

  for (const config of configs) {
    if (config.enabled !== undefined) {
      base.enabled = config.enabled;
    }
    if (config.sessionId !== undefined) {
      base.sessionId = config.sessionId;
    }
    if (config.decisionAgent !== undefined) {
      base.decisionAgent = config.decisionAgent;
    }
    if (config.maxContinueAttempts !== undefined) {
      base.maxContinueAttempts = config.maxContinueAttempts;
    }
    if (config.idleTimeoutSeconds !== undefined) {
      base.idleTimeoutSeconds = config.idleTimeoutSeconds;
    }
  }

  return base;
}
