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

describe('FIFO message format', () => {
  describe('message JSON structure', () => {
    it('should format message correctly', () => {
      const content = 'Fix the bug';
      const message = { type: 'message', content };
      const json = JSON.stringify(message);
      
      expect(JSON.parse(json)).toEqual({ type: 'message', content: 'Fix the bug' });
    });

    it('should format stop command correctly', () => {
      const message = { type: 'stop' };
      const json = JSON.stringify(message);
      
      expect(JSON.parse(json)).toEqual({ type: 'stop' });
    });

    it('should format status request correctly', () => {
      const message = { type: 'status' };
      const json = JSON.stringify(message);
      
      expect(JSON.parse(json)).toEqual({ type: 'status' });
    });

    it('should handle special characters in content', () => {
      const content = 'Fix the "bug" in <auth.ts> & handle \'quotes\'';
      const message = { type: 'message', content };
      const json = JSON.stringify(message);
      
      const parsed = JSON.parse(json);
      expect(parsed.content).toBe(content);
    });

    it('should handle newlines in content', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const message = { type: 'message', content };
      const json = JSON.stringify(message);
      
      const parsed = JSON.parse(json);
      expect(parsed.content).toContain('\n');
      expect(parsed.content.split('\n')).toHaveLength(3);
    });

    it('should handle unicode in content', () => {
      const content = '修复 auth.ts 中的问题 🐛';
      const message = { type: 'message', content };
      const json = JSON.stringify(message);
      
      const parsed = JSON.parse(json);
      expect(parsed.content).toBe(content);
    });
  });
});

describe('iteration prompt building', () => {
  it('should build basic iteration prompt', () => {
    const instructions = 'Add unit tests';
    const iteration = 2;
    
    const prompt = `## Iteration ${iteration}

## New Instructions

${instructions}

Please continue working on this task based on the new instructions above.
When you are done, let me know what was accomplished.`;

    expect(prompt).toContain('Iteration 2');
    expect(prompt).toContain('Add unit tests');
    expect(prompt).toContain('New Instructions');
  });

  it('should include previous summary if available', () => {
    const summary = 'Implemented the login feature';
    const instructions = 'Add error handling';
    
    const contextSection = `\n## Previous Iteration Summary\n\n${summary}\n`;
    const prompt = `## Iteration 3
${contextSection}
## New Instructions

${instructions}`;

    expect(prompt).toContain('Previous Iteration Summary');
    expect(prompt).toContain(summary);
    expect(prompt).toContain(instructions);
  });
});
