/**
 * Manual Mode Iterate
 *
 * Handles task iteration in manual mode by sending commands
 * to existing CLI sessions via FIFO pipes in Docker containers.
 */

import colors from 'ansi-colors';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { launch, ProcessManager } from 'rover-common';
import type { TaskDescriptionManager } from 'rover-schemas';
import {
  hasActiveManual,
  loadManualState,
  updateManualState,
  ManualState,
} from './sandbox/manual-mode.js';

// Constants matching the daemon
const FIFO_INPUT_PATH = '/tmp/rover-input.fifo';
const ROVER_STATUS_PATH = '/rover/status.json';

/**
 * Result of manual iterate operation
 */
export interface ManualIterateResult {
  success: boolean;
  sessionId?: string;
  commandSent?: string;
  error?: string;
}

/**
 * Check if a task can use manual mode iteration
 */
export function canUseManualIterate(task: TaskDescriptionManager): boolean {
  // Check if task has an active manual
  if (!hasActiveManual(task)) {
    return false;
  }

  // Check if container is still running
  const state = loadManualState(task);
  if (!state?.containerId) {
    return false;
  }

  return true;
}

/**
 * Check if the container's daemon is ready to receive messages
 */
async function isDaemonReady(containerId: string): Promise<boolean> {
  try {
    // Check if container is running
    const containerCheck = await launch('docker', [
      'inspect',
      '-f',
      '{{.State.Running}}',
      containerId,
    ], { reject: false });

    if (containerCheck.exitCode !== 0 || containerCheck.stdout?.trim() !== 'true') {
      return false;
    }

    // Check if FIFO exists in container
    const fifoCheck = await launch('docker', [
      'exec',
      containerId,
      'test',
      '-p',
      FIFO_INPUT_PATH,
    ], { reject: false });

    return fifoCheck.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get the daemon status from the container
 */
async function getDaemonStatus(containerId: string): Promise<{
  status: string;
  iteration: number;
  lastError?: string;
} | null> {
  try {
    const result = await launch('docker', [
      'exec',
      containerId,
      'cat',
      ROVER_STATUS_PATH,
    ], { reject: false });

    if (result.exitCode !== 0) {
      return null;
    }

    return JSON.parse(result.stdout || '{}');
  } catch {
    return null;
  }
}

/**
 * Send a message to the daemon via FIFO pipe
 */
async function sendToDaemon(
  containerId: string,
  message: { type: string; content?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const messageJson = JSON.stringify(message);
    
    // Use docker exec to write to the FIFO
    // Note: The echo command writes to the FIFO, which the daemon reads
    const result = await launch('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      `echo '${messageJson.replace(/'/g, "'\\''")}' > ${FIFO_INPUT_PATH}`,
    ], { reject: false, timeout: 30000 });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `docker exec failed with code ${result.exitCode}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send message: ${(error as Error).message}`,
    };
  }
}

/**
 * Send iteration instructions to an existing manual session
 */
export async function sendIterationToManual(
  task: TaskDescriptionManager,
  instructions: string,
  processManager?: ProcessManager
): Promise<ManualIterateResult> {
  const state = loadManualState(task);

  if (!state) {
    return {
      success: false,
      error: 'No active manual found for this task',
    };
  }

  if (!state.containerId) {
    return {
      success: false,
      error: 'No container ID found for this manual',
    };
  }

  processManager?.addItem('Checking daemon status');

  // Check if daemon is ready
  const daemonReady = await isDaemonReady(state.containerId);
  if (!daemonReady) {
    processManager?.failLastItem();
    return {
      success: false,
      error: 'Daemon is not running or FIFO not ready. The container may have stopped.',
    };
  }

  processManager?.completeLastItem();
  processManager?.addItem('Sending instructions to daemon');

  try {
    // Build the iteration prompt
    const iterationPrompt = buildIterationPrompt(task, instructions, state);

    // Send message to daemon via FIFO
    const sendResult = await sendToDaemon(state.containerId, {
      type: 'message',
      content: iterationPrompt,
    });

    if (!sendResult.success) {
      processManager?.failLastItem();
      return {
        success: false,
        error: `Failed to send instructions: ${sendResult.error}`,
      };
    }

    // Update manual state
    updateManualState(task, {
      lastActivityAt: new Date().toISOString(),
      iteration: (state.iteration || 0) + 1,
    });

    processManager?.completeLastItem();

    return {
      success: true,
      sessionId: state.sessionId,
      commandSent: iterationPrompt,
    };
  } catch (error) {
    processManager?.failLastItem();
    return {
      success: false,
      error: `Error sending instructions: ${(error as Error).message}`,
    };
  }
}

/**
 * Resume a paused manual session with new instructions
 */
export async function resumeManualWithInstructions(
  task: TaskDescriptionManager,
  instructions: string,
  processManager?: ProcessManager
): Promise<ManualIterateResult> {
  const state = loadManualState(task);

  if (!state) {
    return {
      success: false,
      error: 'No manual state found for this task',
    };
  }

  if (!state.containerId) {
    return {
      success: false,
      error: 'No container ID found for this task',
    };
  }

  processManager?.addItem('Checking container status');

  try {
    // Check if container is running
    const containerCheck = await launch('docker', [
      'inspect',
      '-f',
      '{{.State.Running}}',
      state.containerId,
    ], { reject: false });

    const isRunning = containerCheck.stdout?.trim() === 'true';

    if (!isRunning) {
      // Container stopped, need to restart
      processManager?.completeLastItem();
      processManager?.addItem('Restarting container');

      await launch('docker', ['start', state.containerId]);

      processManager?.completeLastItem();

      // Wait for daemon to be ready
      processManager?.addItem('Waiting for daemon to start');

      let retries = 10;
      while (retries > 0) {
        if (await isDaemonReady(state.containerId)) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        retries--;
      }

      if (retries === 0) {
        processManager?.failLastItem();
        return {
          success: false,
          error: 'Daemon did not start within timeout period',
        };
      }

      processManager?.completeLastItem();
    } else {
      processManager?.completeLastItem();
    }

    // Now send the instructions
    return await sendIterationToManual(task, instructions, processManager);
  } catch (error) {
    processManager?.failLastItem();
    return {
      success: false,
      error: `Error resuming manual: ${(error as Error).message}`,
    };
  }
}

/**
 * Stop the daemon gracefully
 */
export async function stopManualDaemon(
  task: TaskDescriptionManager,
  processManager?: ProcessManager
): Promise<{ success: boolean; error?: string }> {
  const state = loadManualState(task);

  if (!state?.containerId) {
    return { success: true }; // Already stopped
  }

  processManager?.addItem('Sending stop signal to daemon');

  try {
    // Send stop message to daemon
    const sendResult = await sendToDaemon(state.containerId, { type: 'stop' });

    if (!sendResult.success) {
      // Daemon might already be stopped, that's okay
      processManager?.completeLastItem();
    } else {
      processManager?.completeLastItem();
    }

    // Update state
    updateManualState(task, {
      status: 'completed',
      lastActivityAt: new Date().toISOString(),
    });

    return { success: true };
  } catch (error) {
    processManager?.failLastItem();
    return {
      success: false,
      error: `Failed to stop daemon: ${(error as Error).message}`,
    };
  }
}

/**
 * Build iteration prompt from task and instructions
 */
function buildIterationPrompt(
  task: TaskDescriptionManager,
  instructions: string,
  state: ManualState
): string {
  // Try to load previous iteration context
  let contextSection = '';

  const lastIteration = task.getLastIteration();
  if (lastIteration) {
    const files = lastIteration.getMarkdownFiles(['plan.md', 'changes.md', 'summary.md']);

    if (files.has('summary.md')) {
      contextSection += `\n## Previous Iteration Summary\n\n${files.get('summary.md')}\n`;
    }

    if (files.has('changes.md')) {
      contextSection += `\n## Previous Changes\n\n${files.get('changes.md')}\n`;
    }
  }

  return `## Iteration ${state.iteration + 1}
${contextSection}
## New Instructions

${instructions}

Please continue working on this task based on the new instructions above.
When you are done, let me know what was accomplished.`;
}

/**
 * Build resume command for specific agent
 */
function buildResumeCommand(
  agent: string,
  sessionId: string,
  instructions: string
): string {
  const escapedInstructions = escapeForShell(instructions);

  switch (agent) {
    case 'claude':
      return `echo "${escapedInstructions}" | claude --resume ${sessionId} --dangerously-skip-permissions`;
    case 'codex':
      return `echo "${escapedInstructions}" | codex chat --session ${sessionId} --dangerously-bypass-approvals-and-sandbox`;
    case 'gemini':
      return `echo "${escapedInstructions}" | gemini --resume ${sessionId} --yolo`;
    case 'qwen':
      return `echo "${escapedInstructions}" | qwen --resume ${sessionId} --yolo`;
    default:
      return `echo "${escapedInstructions}"`;
  }
}

/**
 * Escape string for shell
 */
function escapeForShell(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n');
}

/**
 * Get manual status message for display
 */
export function getManualStatusMessage(task: TaskDescriptionManager): string {
  const state = loadManualState(task);

  if (!state) {
    return colors.gray('No active manual');
  }

  const statusColors: Record<string, (s: string) => string> = {
    running: colors.green,
    waiting: colors.yellow,
    completed: colors.blue,
    failed: colors.red,
  };

  const colorFn = statusColors[state.status] || colors.gray;

  return `Session ${colors.cyan(state.sessionId)} - ${colorFn(state.status)}`;
}
