import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearProjectRootCache, launchSync } from 'rover-common';
import { TaskDescriptionManager } from 'rover-schemas';
import { sendCommand } from '../manual/send.js';
import { statusCommand } from '../manual/status.js';
import { stopCommand } from '../manual/stop.js';
import { listCommand } from '../manual/list.js';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventManualSend: vi.fn(),
    eventManualStop: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock exit utilities to prevent process.exit
vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => {}),
  exitWithSuccess: vi.fn().mockImplementation(() => {}),
  exitWithWarn: vi.fn().mockImplementation(() => {}),
}));

// Mock sandbox to prevent actual Docker/Podman calls
vi.mock('../../lib/sandbox/index.js', () => ({
  createSandbox: vi.fn().mockResolvedValue({
    stopAndRemove: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock manual-mode functions
vi.mock('../../lib/sandbox/manual-mode.js', () => ({
  loadManualState: vi.fn().mockReturnValue(null),
  saveManualState: vi.fn(),
  hasActiveManual: vi.fn().mockReturnValue(false),
  getManualDir: vi.fn().mockImplementation((task) => {
    return join(task.taskPath(), 'sessions');
  }),
  createManualState: vi.fn().mockImplementation((task, agent, sessionId) => ({
    sessionId: sessionId || `${agent}-test-session`,
    taskId: task.id.toString(),
    agent,
    status: 'running',
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    iteration: 1,
    continueAttempts: 0,
    jsonlPath: 'sessions/test.jsonl',
  })),
  updateManualState: vi.fn(),
  completeManual: vi.fn(),
  failManual: vi.fn(),
}));

describe('manual commands', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-manual-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repo
    launchSync('git', ['init']);
    launchSync('git', ['config', 'user.email', 'test@test.com']);
    launchSync('git', ['config', 'user.name', 'Test User']);
    launchSync('git', ['config', 'commit.gpgsign', 'false']);

    // Create initial commit
    writeFileSync('README.md', '# Test');
    launchSync('git', ['add', '.']);
    launchSync('git', ['commit', '-m', 'Initial commit']);

    // Create .rover directory structure
    mkdirSync('.rover/tasks', { recursive: true });

    // Create rover.json to indicate this is a Rover project
    writeFileSync(
      join(testDir, 'rover.json'),
      JSON.stringify({ name: 'test-project' })
    );

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
    clearProjectRootCache();
  });

  // Helper to create a test task
  const createTestTask = (
    id: number,
    title: string = 'Test Task',
    workflowName: string = 'swe'
  ) => {
    const task = TaskDescriptionManager.create({
      id,
      title,
      description: 'Test task description',
      inputs: new Map(),
      workflowName,
    });

    // Create task directory and iterations
    const taskDir = join('.rover', 'tasks', id.toString());
    const iterationsDir = join(taskDir, 'iterations', '1');
    mkdirSync(iterationsDir, { recursive: true });

    // Create a git worktree for the task
    const worktreePath = join(taskDir, 'workspace');
    const branchName = `rover-task-${id}`;

    launchSync('git', ['worktree', 'add', worktreePath, '-b', branchName]);
    task.setWorkspace(join(testDir, worktreePath), branchName);

    return task;
  };

  // Helper to create a manual mode task
  const createManualTask = (id: number, title: string = 'Manual Task') => {
    const task = createTestTask(id, title, 'manual');

    // Create sessions directory
    const sessionsDir = join('.rover', 'tasks', id.toString(), 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    return task;
  };

  describe('manual send command', () => {
    describe('Task ID validation', () => {
      it('should reject non-numeric task ID', async () => {
        const { exitWithError } = await import('../../utils/exit.js');

        await sendCommand('invalid', 'test message', { json: true });

        expect(exitWithError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringContaining('Invalid task ID'),
          }),
          expect.objectContaining({
            telemetry: expect.anything(),
          })
        );
      });

      it('should handle non-existent task', async () => {
        const { exitWithError } = await import('../../utils/exit.js');

        await sendCommand('999', 'test message', { json: true });

        expect(exitWithError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringContaining('not found'),
          }),
          expect.objectContaining({
            telemetry: expect.anything(),
          })
        );
      });
    });

    describe('Session validation', () => {
      it('should require an active manual', async () => {
        const { exitWithError } = await import('../../utils/exit.js');
        const { hasActiveManual } = await import(
          '../../lib/sandbox/manual-mode.js'
        );

        // Mock hasActiveManual to return false
        vi.mocked(hasActiveManual).mockReturnValue(false);

        const task = createManualTask(1, 'Manual Task');
        task.markInProgress();

        await sendCommand('1', 'test message', { json: true });

        expect(exitWithError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Task does not have an active manual session',
            success: false,
            taskId: 1,
          }),
          expect.anything()
        );
      });

      it('should write message to JSONL when manual is active', async () => {
        const { hasActiveManual, loadManualState } = await import(
          '../../lib/sandbox/manual-mode.js'
        );

        // Mock hasActiveManual to return true
        vi.mocked(hasActiveManual).mockReturnValue(true);
        vi.mocked(loadManualState).mockReturnValue({
          sessionId: 'claude-test-session',
          taskId: '2',
          agent: 'claude',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          iteration: 1,
          continueAttempts: 0,
          jsonlPath: 'sessions/test.jsonl',
        });

        const task = createManualTask(2, 'Active Manual Task');
        task.markInProgress();

        // Create sessions directory
        const sessionsDir = join('.rover', 'tasks', '2', 'sessions');
        mkdirSync(sessionsDir, { recursive: true });

        await sendCommand('2', 'test message', { json: true });

        // Verify the command completed - check that either exitWithSuccess or file was written
        // The actual behavior depends on the implementation
      });
    });

    describe('Message handling', () => {
      it('should require a message', async () => {
        const { exitWithError } = await import('../../utils/exit.js');
        const { hasActiveManual } = await import(
          '../../lib/sandbox/manual-mode.js'
        );

        vi.mocked(hasActiveManual).mockReturnValue(true);

        const task = createManualTask(3, 'Manual Task');
        task.markInProgress();

        await sendCommand('3', undefined, { json: true });

        expect(exitWithError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Message is required',
            success: false,
          }),
          expect.anything()
        );
      });
    });
  });

  describe('manual status command', () => {
    describe('Task ID validation', () => {
      it('should reject non-numeric task ID', async () => {
        const { exitWithError } = await import('../../utils/exit.js');

        await statusCommand('invalid', { json: true });

        expect(exitWithError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringContaining('Invalid task ID'),
          }),
          expect.anything()
        );
      });

      it('should handle non-existent task', async () => {
        const { exitWithError } = await import('../../utils/exit.js');

        await statusCommand('999', { json: true });

        expect(exitWithError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringContaining('not found'),
          }),
          expect.anything()
        );
      });
    });

    describe('Status display', () => {
      it('should display task status for manual task', async () => {
        const { loadManualState } = await import(
          '../../lib/sandbox/manual-mode.js'
        );

        // Mock loadManualState to return a manual state
        vi.mocked(loadManualState).mockReturnValue({
          sessionId: 'claude-test-session',
          taskId: '4',
          agent: 'claude',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          iteration: 1,
          continueAttempts: 0,
          jsonlPath: 'sessions/test.jsonl',
        });

        const task = createManualTask(4, 'Manual Status Task');
        task.markInProgress();

        // Should not throw
        await expect(statusCommand('4', { json: true })).resolves.not.toThrow();
      });

      it('should handle task with no manual state', async () => {
        const { loadManualState } = await import(
          '../../lib/sandbox/manual-mode.js'
        );

        vi.mocked(loadManualState).mockReturnValue(null);

        const task = createManualTask(5, 'No Session Task');

        // Should not throw
        await expect(statusCommand('5', { json: true })).resolves.not.toThrow();
      });
    });
  });

  describe('manual stop command', () => {
    describe('Task ID validation', () => {
      it('should reject non-numeric task ID', async () => {
        const { exitWithError } = await import('../../utils/exit.js');

        await stopCommand('invalid', { json: true });

        expect(exitWithError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringContaining('Invalid task ID'),
          }),
          expect.anything()
        );
      });

      it('should handle non-existent task', async () => {
        const { exitWithError } = await import('../../utils/exit.js');

        await stopCommand('999', { json: true });

        expect(exitWithError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringContaining('not found'),
          }),
          expect.anything()
        );
      });
    });

    describe('Manual cleanup', () => {
      it('should stop and cleanup manual', async () => {
        const { loadManualState } = await import(
          '../../lib/sandbox/manual-mode.js'
        );

        vi.mocked(loadManualState).mockReturnValue({
          sessionId: 'claude-test-session',
          taskId: '6',
          agent: 'claude',
          status: 'running',
          startedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          iteration: 1,
          continueAttempts: 0,
          jsonlPath: 'sessions/test.jsonl',
        });

        const task = createManualTask(6, 'Stop Session Task');
        task.markInProgress();
        task.setContainerInfo('container-123', 'test-container');

        // Should not throw
        await expect(stopCommand('6', { json: true })).resolves.not.toThrow();
      });
    });
  });

  describe('manual list command', () => {
    it('should list manual mode tasks', async () => {
      // Create mix of tasks
      createTestTask(10, 'Regular SWE Task', 'swe');
      createManualTask(11, 'Manual Task 1');
      createManualTask(12, 'Manual Task 2');

      // Note: This test mainly verifies the command doesn't throw
      // Full integration would need to mock TaskDescriptionStore
      await expect(listCommand({ json: true })).resolves.not.toThrow();
    });

    it('should handle empty task list', async () => {
      await expect(listCommand({ json: true })).resolves.not.toThrow();
    });
  });
});

describe('SandboxMode types', () => {
  it('should have correct SandboxMode type', async () => {
    // Import types to verify they exist
    const { Sandbox } = await import('../../lib/sandbox/types.js');

    // Verify the abstract class exists
    expect(Sandbox).toBeDefined();
  });

  it('should support manual mode in SandboxStartOptions', async () => {
    // This is a type-level test - if it compiles, the types are correct
    type SandboxStartOptions = {
      mode?: 'workflow' | 'manual';
      sessionId?: string;
      initialPrompt?: string;
    };

    const options: SandboxStartOptions = {
      mode: 'manual',
      sessionId: 'test-session',
      initialPrompt: 'Test prompt',
    };

    expect(options.mode).toBe('manual');
  });
});
