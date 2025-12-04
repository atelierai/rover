import { describe, it, expect, beforeEach } from 'vitest';
import {
  ClaudeCliAdapter,
  CodexCliAdapter,
  GeminiCliAdapter,
  QwenCliAdapter,
  getAdapter,
  clearAdapterCache,
} from '../adapters/index.js';
import type { AgentType, JsonlMessage } from '../types.js';

describe('CLI Adapters', () => {
  // Clear adapter cache before each test to ensure fresh instances
  beforeEach(() => {
    clearAdapterCache();
  });

  describe('getAdapter()', () => {
    it('should return ClaudeCliAdapter for claude', () => {
      const adapter = getAdapter('claude');
      expect(adapter).toBeInstanceOf(ClaudeCliAdapter);
      expect(adapter.name).toBe('claude');
    });

    it('should return CodexCliAdapter for codex', () => {
      const adapter = getAdapter('codex');
      expect(adapter).toBeInstanceOf(CodexCliAdapter);
      expect(adapter.name).toBe('codex');
    });

    it('should return GeminiCliAdapter for gemini', () => {
      const adapter = getAdapter('gemini');
      expect(adapter).toBeInstanceOf(GeminiCliAdapter);
      expect(adapter.name).toBe('gemini');
    });

    it('should return QwenCliAdapter for qwen', () => {
      const adapter = getAdapter('qwen');
      expect(adapter).toBeInstanceOf(QwenCliAdapter);
      expect(adapter.name).toBe('qwen');
    });

    it('should throw error for unsupported agent', () => {
      expect(() => getAdapter('unsupported' as AgentType)).toThrow(
        'Unsupported agent type: unsupported'
      );
    });
  });

  describe('ClaudeCliAdapter', () => {
    const adapter = new ClaudeCliAdapter();

    it('should have correct name and binary', () => {
      expect(adapter.name).toBe('claude');
      expect(adapter.binary).toBe('claude');
    });

    it('should generate correct JSONL directory with workspace', () => {
      const dir = adapter.getJsonlDir('task-123', '/workspace');
      expect(dir).toContain('task-123');
      expect(dir).toContain('sessions');
    });

    it('should return default Claude directory without workspace', () => {
      const dir = adapter.getJsonlDir('task-123');
      expect(dir).toContain('.claude');
    });

    it('should generate correct session JSONL path', () => {
      const path = adapter.getSessionJsonlPath('session-abc', '/base');
      expect(path).toContain('session-abc');
      expect(path).toContain('.jsonl');
    });

    it('should return correct start args with prompt', () => {
      const args = adapter.getStartArgs({
        prompt: 'Test prompt',
        dangerouslySkipPermissions: true,
        outputFormat: 'stream-json',
      });

      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
    });

    it('should return correct start args with history dir', () => {
      const args = adapter.getStartArgs({
        prompt: 'Test prompt',
        historyDir: '/path/to/history',
        dangerouslySkipPermissions: true,
      });

      expect(args).toContain('--history-dir');
      expect(args).toContain('/path/to/history');
    });

    it('should return correct resume args', () => {
      const args = adapter.getResumeArgs('session-123');

      expect(args).toContain('--resume');
      expect(args).toContain('session-123');
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('should return /continue as continue command', () => {
      expect(adapter.getContinueCommand()).toBe('/continue');
    });

    it('should return /stop as stop command', () => {
      expect(adapter.getStopCommand()).toBe('/stop');
    });

    it('should parse valid JSONL message', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'Hello' },
        timestamp: '2025-12-03T00:00:00Z',
        sessionId: 'session-123',
        uuid: 'uuid-1',
      });

      const message = adapter.parseJsonlMessage(line);
      expect(message).not.toBeNull();
      expect(message?.type).toBe('assistant');
      expect(message?.message?.content).toBe('Hello');
    });

    it('should return null for invalid JSONL', () => {
      const message = adapter.parseJsonlMessage('invalid json');
      expect(message).toBeNull();
    });

    it('should detect waiting for input', () => {
      const waitingMessage: JsonlMessage = {
        type: 'assistant',
        timestamp: '2025-12-03T00:00:00Z',
        sessionId: 'session-123',
        message: {
          role: 'assistant',
          content: "I'm done for now. Let me know if you need anything else.",
        },
      };

      expect(adapter.isWaitingForInput(waitingMessage)).toBe(true);
    });

    it('should not detect waiting for regular messages', () => {
      const regularMessage: JsonlMessage = {
        type: 'assistant',
        timestamp: '2025-12-03T00:00:00Z',
        sessionId: 'session-123',
        message: {
          role: 'assistant',
          content: 'Working on the task...',
        },
      };

      expect(adapter.isWaitingForInput(regularMessage)).toBe(false);
    });

    it('should detect completed from summary type', () => {
      const completedMessage: JsonlMessage = {
        type: 'summary',
        timestamp: '2025-12-03T00:00:00Z',
        sessionId: 'session-123',
      };

      expect(adapter.isCompleted(completedMessage)).toBe(true);
    });

    it('should detect completed from raw result type', () => {
      const completedMessage: JsonlMessage = {
        type: 'assistant',
        timestamp: '2025-12-03T00:00:00Z',
        sessionId: 'session-123',
        raw: { type: 'result' },
      };

      expect(adapter.isCompleted(completedMessage)).toBe(true);
    });

    it('should detect error from API error message', () => {
      const errorMessage: JsonlMessage = {
        type: 'assistant',
        timestamp: '2025-12-03T00:00:00Z',
        sessionId: 'session-123',
        raw: { isApiErrorMessage: true },
      };

      expect(adapter.isError(errorMessage)).toBe(true);
    });

    it('should detect error from error type', () => {
      const errorMessage: JsonlMessage = {
        type: 'error',
        timestamp: '2025-12-03T00:00:00Z',
        sessionId: 'session-123',
      };

      expect(adapter.isError(errorMessage)).toBe(true);
    });
  });

  describe('CodexCliAdapter', () => {
    const adapter = new CodexCliAdapter();

    it('should have correct name and binary', () => {
      expect(adapter.name).toBe('codex');
      expect(adapter.binary).toBe('codex');
    });

    it('should generate correct start args', () => {
      const args = adapter.getStartArgs({
        prompt: 'Test prompt',
        dangerouslySkipPermissions: true,
      });

      expect(args).toContain('chat');
      expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    });

    it('should return correct resume args with session', () => {
      const args = adapter.getResumeArgs('session-456');

      expect(args).toContain('chat');
      expect(args).toContain('--session');
      expect(args).toContain('session-456');
    });

    it('should return /continue as continue command', () => {
      expect(adapter.getContinueCommand()).toBe('/continue');
    });

    it('should return /exit as stop command', () => {
      expect(adapter.getStopCommand()).toBe('/exit');
    });
  });

  describe('GeminiCliAdapter', () => {
    const adapter = new GeminiCliAdapter();

    it('should have correct name and binary', () => {
      expect(adapter.name).toBe('gemini');
      expect(adapter.binary).toBe('gemini');
    });

    it('should generate correct start args with yolo mode', () => {
      const args = adapter.getStartArgs({
        prompt: 'Test prompt',
        dangerouslySkipPermissions: true,
      });

      expect(args).toContain('--yolo');
    });

    it('should generate correct start args with sandbox', () => {
      const args = adapter.getStartArgs({
        prompt: 'Test prompt',
        sandbox: true,
      });

      expect(args).toContain('--sandbox');
    });

    it('should return correct resume args', () => {
      const args = adapter.getResumeArgs('session-789');

      expect(args).toContain('--resume');
      expect(args).toContain('session-789');
    });

    it('should return /continue as continue command', () => {
      expect(adapter.getContinueCommand()).toBe('/continue');
    });

    it('should return /stop as stop command', () => {
      expect(adapter.getStopCommand()).toBe('/stop');
    });
  });

  describe('QwenCliAdapter', () => {
    const adapter = new QwenCliAdapter();

    it('should have correct name and binary', () => {
      expect(adapter.name).toBe('qwen');
      expect(adapter.binary).toBe('qwen');
    });

    it('should generate correct start args with yolo mode', () => {
      const args = adapter.getStartArgs({
        prompt: 'Test prompt',
        dangerouslySkipPermissions: true,
      });

      expect(args).toContain('--yolo');
    });

    it('should return correct resume args', () => {
      const args = adapter.getResumeArgs('session-qwen');

      expect(args).toContain('--resume');
      expect(args).toContain('session-qwen');
    });
  });
});
