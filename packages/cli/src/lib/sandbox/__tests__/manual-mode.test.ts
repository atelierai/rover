import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ManualState,
  ManualModeConfig,
  getManualDir,
  getManualStatePath,
  loadManualState,
  saveManualState,
  hasActiveManual,
  generateSessionId,
  createManualState,
  updateManualState,
  completeManual,
  failManual,
  incrementContinueAttempts,
  resetContinueAttempts,
  getDefaultManualModeConfig,
  parseManualModeFromEnv,
  mergeManualModeConfig,
} from '../manual-mode.js';
import type { TaskDescriptionManager } from 'rover-schemas';

describe('manual-mode', () => {
  let testDir: string;
  let mockTask: TaskDescriptionManager;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'manual-mode-test-'));

    // Create mock task
    mockTask = {
      id: 123,
      title: 'Test Task',
      description: 'Test Description',
      iterations: 1,
      taskPath: () => testDir,
    } as unknown as TaskDescriptionManager;
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
    // Reset environment variables
    delete process.env.ROVER_SESSION_MODE;
    delete process.env.ROVER_DECISION_AGENT;
    delete process.env.ROVER_MAX_CONTINUE;
    delete process.env.ROVER_IDLE_TIMEOUT;
  });

  describe('getManualDir()', () => {
    it('should return sessions path under task directory', () => {
      const manualDir = getManualDir(mockTask);
      expect(manualDir).toBe(join(testDir, 'sessions'));
    });

    it('should create sessions directory if it does not exist', () => {
      const manualDir = getManualDir(mockTask);
      expect(existsSync(manualDir)).toBe(true);
    });
  });

  describe('getManualStatePath()', () => {
    it('should return state.json path under sessions directory', () => {
      const statePath = getManualStatePath(mockTask);
      expect(statePath).toBe(join(testDir, 'sessions', 'state.json'));
    });
  });

  describe('loadManualState()', () => {
    it('should return null when no state file exists', () => {
      const state = loadManualState(mockTask);
      expect(state).toBeNull();
    });

    it('should load and return manual state from file', () => {
      const sessionsDir = join(testDir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });

      const testState: ManualState = {
        sessionId: 'test-session-id',
        taskId: '123',
        agent: 'claude',
        status: 'running',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      };

      const statePath = join(sessionsDir, 'state.json');
      const fs = require('node:fs');
      fs.writeFileSync(statePath, JSON.stringify(testState));

      const state = loadManualState(mockTask);
      expect(state).toEqual(testState);
    });

    it('should return null for invalid JSON', () => {
      const sessionsDir = join(testDir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });

      const statePath = join(sessionsDir, 'state.json');
      const fs = require('node:fs');
      fs.writeFileSync(statePath, 'invalid json');

      const state = loadManualState(mockTask);
      expect(state).toBeNull();
    });
  });

  describe('saveManualState()', () => {
    it('should save manual state to file', () => {
      const testState: ManualState = {
        sessionId: 'test-session-id',
        taskId: '123',
        agent: 'claude',
        status: 'running',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      };

      saveManualState(mockTask, testState);

      const statePath = getManualStatePath(mockTask);
      expect(existsSync(statePath)).toBe(true);

      const savedState = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(savedState).toEqual(testState);
    });

    it('should create sessions directory if it does not exist', () => {
      const testState: ManualState = {
        sessionId: 'test-session-id',
        taskId: '123',
        agent: 'claude',
        status: 'running',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      };

      saveManualState(mockTask, testState);

      const sessionsDir = join(testDir, 'sessions');
      expect(existsSync(sessionsDir)).toBe(true);
    });
  });

  describe('hasActiveManual()', () => {
    it('should return false when no state exists', () => {
      expect(hasActiveManual(mockTask)).toBe(false);
    });

    it('should return true when status is running', () => {
      const testState: ManualState = {
        sessionId: 'test-session-id',
        taskId: '123',
        agent: 'claude',
        status: 'running',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      };

      saveManualState(mockTask, testState);
      expect(hasActiveManual(mockTask)).toBe(true);
    });

    it('should return true when status is waiting', () => {
      const testState: ManualState = {
        sessionId: 'test-session-id',
        taskId: '123',
        agent: 'claude',
        status: 'waiting',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      };

      saveManualState(mockTask, testState);
      expect(hasActiveManual(mockTask)).toBe(true);
    });

    it('should return false when status is completed', () => {
      const testState: ManualState = {
        sessionId: 'test-session-id',
        taskId: '123',
        agent: 'claude',
        status: 'completed',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      };

      saveManualState(mockTask, testState);
      expect(hasActiveManual(mockTask)).toBe(false);
    });

    it('should return false when status is failed', () => {
      const testState: ManualState = {
        sessionId: 'test-session-id',
        taskId: '123',
        agent: 'claude',
        status: 'failed',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      };

      saveManualState(mockTask, testState);
      expect(hasActiveManual(mockTask)).toBe(false);
    });
  });

  describe('generateSessionId()', () => {
    it('should generate session ID with agent prefix', () => {
      const sessionId = generateSessionId('claude');
      expect(sessionId.startsWith('claude-')).toBe(true);
    });

    it('should generate unique session IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSessionId('claude'));
      }
      expect(ids.size).toBe(100);
    });

    it('should include timestamp component', () => {
      const sessionId = generateSessionId('codex');
      const parts = sessionId.split('-');
      expect(parts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('createManualState()', () => {
    it('should create manual state with provided agent', () => {
      const state = createManualState(mockTask, 'claude');

      expect(state.agent).toBe('claude');
      expect(state.taskId).toBe('123');
      expect(state.status).toBe('running');
      expect(state.iteration).toBe(1);
      expect(state.continueAttempts).toBe(0);
    });

    it('should use provided session ID if given', () => {
      const state = createManualState(mockTask, 'claude', 'custom-session-id');
      expect(state.sessionId).toBe('custom-session-id');
    });

    it('should generate session ID if not provided', () => {
      const state = createManualState(mockTask, 'claude');
      expect(state.sessionId).toBeTruthy();
      expect(state.sessionId.startsWith('claude-')).toBe(true);
    });

    it('should set initial timestamps', () => {
      const before = new Date().toISOString();
      const state = createManualState(mockTask, 'gemini');
      const after = new Date().toISOString();

      expect(state.startedAt >= before).toBe(true);
      expect(state.startedAt <= after).toBe(true);
      expect(state.lastActivityAt >= before).toBe(true);
      expect(state.lastActivityAt <= after).toBe(true);
    });
  });

  describe('updateManualState()', () => {
    it('should update existing manual state', () => {
      const initialState = createManualState(mockTask, 'claude');
      saveManualState(mockTask, initialState);

      const updated = updateManualState(mockTask, { status: 'waiting' });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('waiting');
      expect(updated!.sessionId).toBe(initialState.sessionId);
    });

    it('should return null if no manual exists', () => {
      const updated = updateManualState(mockTask, { status: 'waiting' });
      expect(updated).toBeNull();
    });

    it('should update lastActivityAt timestamp', () => {
      const initialState = createManualState(mockTask, 'claude');
      saveManualState(mockTask, initialState);

      // Wait a bit to ensure timestamp changes
      const before = new Date().toISOString();
      const updated = updateManualState(mockTask, { continueAttempts: 1 });
      const after = new Date().toISOString();

      expect(updated!.lastActivityAt >= before).toBe(true);
      expect(updated!.lastActivityAt <= after).toBe(true);
    });
  });

  describe('completeManual()', () => {
    it('should mark manual as completed', () => {
      const initialState = createManualState(mockTask, 'claude');
      saveManualState(mockTask, initialState);

      completeManual(mockTask);

      const state = loadManualState(mockTask);
      expect(state?.status).toBe('completed');
    });
  });

  describe('failManual()', () => {
    it('should mark manual as failed', () => {
      const initialState = createManualState(mockTask, 'claude');
      saveManualState(mockTask, initialState);

      failManual(mockTask);

      const state = loadManualState(mockTask);
      expect(state?.status).toBe('failed');
    });
  });

  describe('incrementContinueAttempts()', () => {
    it('should increment continue attempts counter', () => {
      const initialState = createManualState(mockTask, 'claude');
      saveManualState(mockTask, initialState);

      const attempts1 = incrementContinueAttempts(mockTask);
      expect(attempts1).toBe(1);

      const attempts2 = incrementContinueAttempts(mockTask);
      expect(attempts2).toBe(2);
    });

    it('should return 0 if no manual exists', () => {
      const attempts = incrementContinueAttempts(mockTask);
      expect(attempts).toBe(0);
    });
  });

  describe('resetContinueAttempts()', () => {
    it('should reset continue attempts to 0', () => {
      const initialState = createManualState(mockTask, 'claude');
      initialState.continueAttempts = 5;
      saveManualState(mockTask, initialState);

      resetContinueAttempts(mockTask);

      const state = loadManualState(mockTask);
      expect(state?.continueAttempts).toBe(0);
    });
  });

  describe('getDefaultManualModeConfig()', () => {
    it('should return default config values', () => {
      const config = getDefaultManualModeConfig();

      expect(config.enabled).toBe(false);
      expect(config.decisionAgent).toBe('claude');
      expect(config.maxContinueAttempts).toBe(5);
      expect(config.idleTimeoutSeconds).toBe(300);
    });
  });

  describe('parseManualModeFromEnv()', () => {
    it('should parse ROVER_SESSION_MODE=true', () => {
      process.env.ROVER_SESSION_MODE = 'true';
      const config = parseManualModeFromEnv();
      expect(config.enabled).toBe(true);
    });

    it('should not set enabled for other values', () => {
      process.env.ROVER_SESSION_MODE = 'false';
      const config = parseManualModeFromEnv();
      expect(config.enabled).toBeUndefined();
    });

    it('should parse ROVER_DECISION_AGENT', () => {
      process.env.ROVER_DECISION_AGENT = 'gemini';
      const config = parseManualModeFromEnv();
      expect(config.decisionAgent).toBe('gemini');
    });

    it('should parse ROVER_MAX_CONTINUE', () => {
      process.env.ROVER_MAX_CONTINUE = '10';
      const config = parseManualModeFromEnv();
      expect(config.maxContinueAttempts).toBe(10);
    });

    it('should parse ROVER_IDLE_TIMEOUT', () => {
      process.env.ROVER_IDLE_TIMEOUT = '600';
      const config = parseManualModeFromEnv();
      expect(config.idleTimeoutSeconds).toBe(600);
    });
  });

  describe('mergeManualModeConfig()', () => {
    it('should merge multiple configs in order', () => {
      const config1: Partial<ManualModeConfig> = { enabled: true };
      const config2: Partial<ManualModeConfig> = { decisionAgent: 'codex' };
      const config3: Partial<ManualModeConfig> = { maxContinueAttempts: 10 };

      const merged = mergeManualModeConfig(config1, config2, config3);

      expect(merged.enabled).toBe(true);
      expect(merged.decisionAgent).toBe('codex');
      expect(merged.maxContinueAttempts).toBe(10);
      expect(merged.idleTimeoutSeconds).toBe(300); // default
    });

    it('should override earlier configs with later ones', () => {
      const config1: Partial<ManualModeConfig> = {
        enabled: true,
        decisionAgent: 'claude',
      };
      const config2: Partial<ManualModeConfig> = {
        enabled: false,
        decisionAgent: 'gemini',
      };

      const merged = mergeManualModeConfig(config1, config2);

      expect(merged.enabled).toBe(false);
      expect(merged.decisionAgent).toBe('gemini');
    });

    it('should preserve sessionId from configs', () => {
      const config: Partial<ManualModeConfig> = { sessionId: 'my-session' };
      const merged = mergeManualModeConfig(config);
      expect(merged.sessionId).toBe('my-session');
    });
  });
});
