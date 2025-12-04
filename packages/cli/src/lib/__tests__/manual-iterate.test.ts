import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canUseManualIterate,
  getManualStatusMessage,
} from '../manual-iterate.js';
import type { TaskDescriptionManager } from 'rover-schemas';

// Mock the manual-mode module
vi.mock('../sandbox/manual-mode.js', async () => {
  const actual = await vi.importActual('../sandbox/manual-mode.js');
  return {
    ...actual,
    loadManualState: vi.fn(),
    hasActiveManual: vi.fn(),
    updateManualState: vi.fn(),
  };
});

// Mock rover-common launch
vi.mock('rover-common', async () => {
  const actual = await vi.importActual('rover-common');
  return {
    ...actual,
    launch: vi.fn(),
  };
});

import {
  loadManualState,
  hasActiveManual,
  updateManualState,
} from '../sandbox/manual-mode.js';
import { launch } from 'rover-common';

describe('manual-iterate', () => {
  let testDir: string;
  let mockTask: TaskDescriptionManager;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'manual-iterate-test-'));

    // Create mock task
    mockTask = {
      id: 123,
      title: 'Test Task',
      description: 'Test Description',
      iterations: 1,
      taskPath: () => testDir,
      iterationsPath: () => join(testDir, 'iterations'),
      getLastIteration: vi.fn().mockReturnValue(null),
    } as unknown as TaskDescriptionManager;

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('canUseManualIterate()', () => {
    it('should return false when no active manual', () => {
      vi.mocked(hasActiveManual).mockReturnValue(false);

      const result = canUseManualIterate(mockTask);
      expect(result).toBe(false);
    });

    it('should return false when manual has no container ID', () => {
      vi.mocked(hasActiveManual).mockReturnValue(true);
      vi.mocked(loadManualState).mockReturnValue({
        sessionId: 'test-session',
        taskId: '123',
        agent: 'claude',
        status: 'running',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
        containerId: undefined,
      });

      const result = canUseManualIterate(mockTask);
      expect(result).toBe(false);
    });

    it('should return true when active manual with container ID', () => {
      vi.mocked(hasActiveManual).mockReturnValue(true);
      vi.mocked(loadManualState).mockReturnValue({
        sessionId: 'test-session',
        taskId: '123',
        agent: 'claude',
        status: 'running',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
        containerId: 'container-123',
      });

      const result = canUseManualIterate(mockTask);
      expect(result).toBe(true);
    });
  });

  describe('getManualStatusMessage()', () => {
    it('should return gray "No active manual" when no state', () => {
      vi.mocked(loadManualState).mockReturnValue(null);

      const message = getManualStatusMessage(mockTask);
      expect(message).toContain('No active manual');
    });

    it('should return formatted status for running manual', () => {
      vi.mocked(loadManualState).mockReturnValue({
        sessionId: 'test-session',
        taskId: '123',
        agent: 'claude',
        status: 'running',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      });

      const message = getManualStatusMessage(mockTask);
      expect(message).toContain('test-session');
      expect(message).toContain('running');
    });

    it('should return formatted status for waiting manual', () => {
      vi.mocked(loadManualState).mockReturnValue({
        sessionId: 'wait-session',
        taskId: '123',
        agent: 'codex',
        status: 'waiting',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      });

      const message = getManualStatusMessage(mockTask);
      expect(message).toContain('wait-session');
      expect(message).toContain('waiting');
    });

    it('should return formatted status for completed manual', () => {
      vi.mocked(loadManualState).mockReturnValue({
        sessionId: 'done-session',
        taskId: '123',
        agent: 'gemini',
        status: 'completed',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      });

      const message = getManualStatusMessage(mockTask);
      expect(message).toContain('done-session');
      expect(message).toContain('completed');
    });

    it('should return formatted status for failed manual', () => {
      vi.mocked(loadManualState).mockReturnValue({
        sessionId: 'fail-session',
        taskId: '123',
        agent: 'qwen',
        status: 'failed',
        startedAt: '2025-12-03T00:00:00.000Z',
        lastActivityAt: '2025-12-03T00:00:00.000Z',
        iteration: 1,
        continueAttempts: 0,
        jsonlPath: 'sessions/test.jsonl',
      });

      const message = getManualStatusMessage(mockTask);
      expect(message).toContain('fail-session');
      expect(message).toContain('failed');
    });
  });
});
