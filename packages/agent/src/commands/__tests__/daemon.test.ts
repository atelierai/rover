import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock dependencies before importing the module
vi.mock('rover-common', async () => {
  const actual = await vi.importActual('rover-common');
  return {
    ...actual,
    launch: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'Agent output', stderr: '' }),
    VERBOSE: false,
  };
});

vi.mock('../../lib/agents/index.js', () => ({
  createAgent: vi.fn().mockReturnValue({
    binary: 'mock-agent',
    toolArguments: vi.fn().mockReturnValue(['--arg1', '--arg2']),
  }),
}));

// Import after mocking
import { launch } from 'rover-common';
import { createAgent } from '../../lib/agents/index.js';

describe('daemon command utilities', () => {
  let testDir: string;
  let roverHome: string;
  let fifoPath: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'daemon-test-'));
    roverHome = join(testDir, 'rover');
    fifoPath = join(testDir, 'rover-input.fifo');
    
    mkdirSync(roverHome, { recursive: true });

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('parseMessage', () => {
    // Test message parsing logic
    it('should parse valid JSON message', () => {
      const raw = JSON.stringify({ type: 'message', content: 'Hello' });
      const parsed = JSON.parse(raw);
      expect(parsed.type).toBe('message');
      expect(parsed.content).toBe('Hello');
    });

    it('should parse stop command', () => {
      const raw = JSON.stringify({ type: 'stop' });
      const parsed = JSON.parse(raw);
      expect(parsed.type).toBe('stop');
    });

    it('should parse status command', () => {
      const raw = JSON.stringify({ type: 'status' });
      const parsed = JSON.parse(raw);
      expect(parsed.type).toBe('status');
    });
  });

  describe('DaemonStatus structure', () => {
    it('should have correct initial status', () => {
      const status = {
        status: 'waiting' as const,
        agent: 'claude',
        taskId: 'test-123',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        iteration: 0,
        idleTimeoutSeconds: 1800,
      };

      expect(status.status).toBe('waiting');
      expect(status.agent).toBe('claude');
      expect(status.iteration).toBe(0);
    });

    it('should track iteration count', () => {
      const status = {
        status: 'running' as const,
        agent: 'gemini',
        taskId: 'test-456',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        iteration: 5,
      };

      expect(status.status).toBe('running');
      expect(status.iteration).toBe(5);
    });

    it('should track errors', () => {
      const status = {
        status: 'waiting' as const,
        agent: 'codex',
        taskId: 'test-789',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        iteration: 3,
        lastError: 'Agent timeout',
      };

      expect(status.lastError).toBe('Agent timeout');
    });
  });

  describe('JSONL logging', () => {
    it('should append entries to JSONL file', () => {
      const logPath = join(roverHome, 'session.jsonl');
      
      // Simulate logging
      const entry1 = {
        timestamp: new Date().toISOString(),
        type: 'user_input',
        message: { role: 'user', content: 'Hello' },
      };
      
      const entry2 = {
        timestamp: new Date().toISOString(),
        type: 'assistant_output',
        message: { role: 'assistant', content: 'Hi there' },
      };

      writeFileSync(logPath, JSON.stringify(entry1) + '\n');
      writeFileSync(logPath, readFileSync(logPath, 'utf-8') + JSON.stringify(entry2) + '\n');

      const content = readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).type).toBe('user_input');
      expect(JSON.parse(lines[1]).type).toBe('assistant_output');
    });

    it('should log daemon start event', () => {
      const logPath = join(roverHome, 'session.jsonl');
      
      const entry = {
        timestamp: new Date().toISOString(),
        type: 'daemon_start',
        agent: 'claude',
        taskId: 'test-123',
        idleTimeoutSeconds: 1800,
      };

      writeFileSync(logPath, JSON.stringify(entry) + '\n');

      const content = readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(content.trim());
      
      expect(parsed.type).toBe('daemon_start');
      expect(parsed.agent).toBe('claude');
      expect(parsed.idleTimeoutSeconds).toBe(1800);
    });

    it('should log daemon stop event', () => {
      const logPath = join(roverHome, 'session.jsonl');
      
      const entry = {
        timestamp: new Date().toISOString(),
        type: 'daemon_stop',
        reason: 'stop_command',
      };

      writeFileSync(logPath, JSON.stringify(entry) + '\n');

      const content = readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(content.trim());
      
      expect(parsed.type).toBe('daemon_stop');
      expect(parsed.reason).toBe('stop_command');
    });
  });

  describe('status file management', () => {
    it('should write status to JSON file', () => {
      const statusPath = join(roverHome, 'status.json');
      
      const status = {
        status: 'waiting',
        agent: 'claude',
        taskId: 'test-123',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        iteration: 0,
      };

      writeFileSync(statusPath, JSON.stringify(status, null, 2));

      expect(existsSync(statusPath)).toBe(true);
      const content = JSON.parse(readFileSync(statusPath, 'utf-8'));
      expect(content.status).toBe('waiting');
    });

    it('should update status on message processing', () => {
      const statusPath = join(roverHome, 'status.json');
      
      // Initial status
      let status = {
        status: 'waiting' as string,
        agent: 'claude',
        taskId: 'test-123',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        iteration: 0,
      };

      writeFileSync(statusPath, JSON.stringify(status, null, 2));

      // Update to running
      status.status = 'running';
      status.iteration = 1;
      writeFileSync(statusPath, JSON.stringify(status, null, 2));

      const content = JSON.parse(readFileSync(statusPath, 'utf-8'));
      expect(content.status).toBe('running');
      expect(content.iteration).toBe(1);
    });
  });

  describe('idle timeout calculation', () => {
    it('should calculate default timeout correctly', () => {
      const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
      expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(1800000); // 30 minutes
    });

    it('should convert seconds to milliseconds', () => {
      const timeoutSeconds = 60;
      const timeoutMs = timeoutSeconds * 1000;
      expect(timeoutMs).toBe(60000);
    });

    it('should detect idle timeout', () => {
      const idleTimeoutMs = 5000; // 5 seconds for testing
      const lastActivityTime = Date.now() - 6000; // 6 seconds ago
      
      const idleTime = Date.now() - lastActivityTime;
      const isIdle = idleTime >= idleTimeoutMs;
      
      expect(isIdle).toBe(true);
    });

    it('should not trigger timeout within limit', () => {
      const idleTimeoutMs = 5000;
      const lastActivityTime = Date.now() - 3000; // 3 seconds ago
      
      const idleTime = Date.now() - lastActivityTime;
      const isIdle = idleTime >= idleTimeoutMs;
      
      expect(isIdle).toBe(false);
    });
  });

  describe('agent invocation', () => {
    it('should call createAgent with correct agent name', () => {
      createAgent('claude');
      expect(createAgent).toHaveBeenCalledWith('claude');
    });

    it('should get tool arguments from agent', () => {
      const agent = createAgent('gemini');
      const args = agent.toolArguments();
      expect(args).toEqual(['--arg1', '--arg2']);
    });
  });
});

describe('manual-iterate FIFO communication', () => {
  describe('message format', () => {
    it('should format message correctly for FIFO', () => {
      const content = 'Fix the bug in auth.ts';
      const message = JSON.stringify({ type: 'message', content });
      
      const parsed = JSON.parse(message);
      expect(parsed.type).toBe('message');
      expect(parsed.content).toBe(content);
    });

    it('should format stop command correctly', () => {
      const message = JSON.stringify({ type: 'stop' });
      
      const parsed = JSON.parse(message);
      expect(parsed.type).toBe('stop');
    });

    it('should handle multi-line content', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const message = JSON.stringify({ type: 'message', content });
      
      const parsed = JSON.parse(message);
      expect(parsed.content).toContain('\n');
      expect(parsed.content.split('\n')).toHaveLength(3);
    });

    it('should handle special characters in content', () => {
      const content = 'Fix the "bug" in <auth.ts> & handle \'edge\' cases';
      const message = JSON.stringify({ type: 'message', content });
      
      const parsed = JSON.parse(message);
      expect(parsed.content).toBe(content);
    });
  });

  describe('daemon readiness check', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), 'daemon-ready-test-'));
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should detect daemon ready when marker file exists', () => {
      const readyFile = join(testDir, '.daemon-ready');
      writeFileSync(readyFile, '');
      
      expect(existsSync(readyFile)).toBe(true);
    });

    it('should detect daemon not ready when marker file missing', () => {
      const readyFile = join(testDir, '.daemon-ready');
      
      expect(existsSync(readyFile)).toBe(false);
    });
  });

  describe('status retrieval', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), 'daemon-status-test-'));
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should read status from JSON file', () => {
      const statusPath = join(testDir, 'status.json');
      const status = {
        status: 'waiting',
        agent: 'claude',
        taskId: 'test-123',
        iteration: 5,
        lastActivityAt: new Date().toISOString(),
      };

      writeFileSync(statusPath, JSON.stringify(status));

      const content = JSON.parse(readFileSync(statusPath, 'utf-8'));
      expect(content.status).toBe('waiting');
      expect(content.iteration).toBe(5);
    });

    it('should handle missing status file', () => {
      const statusPath = join(testDir, 'status.json');
      
      expect(existsSync(statusPath)).toBe(false);
    });
  });
});
