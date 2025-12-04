/**
 * Manual Mode Iterate
 *
 * Handles task iteration in manual mode by sending commands
 * to existing CLI sessions instead of restarting containers.
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

  processManager?.addItem('Sending instructions to active manual');

  try {
    // Build the iteration prompt
    const iterationPrompt = buildIterationPrompt(task, instructions, state);

    // Send to container via docker exec
    const result = await launch('docker', [
      'exec',
      '-i',
      state.containerId,
      'sh',
      '-c',
      `echo "${escapeForShell(iterationPrompt)}" | tee -a /dev/stdin`,
    ]);

    if (result.exitCode !== 0) {
      processManager?.failLastItem();
      return {
        success: false,
        error: `Failed to send instructions: ${result.stderr}`,
      };
    }

    // Update manual state
    updateManualState(task, {
      lastActivityAt: new Date().toISOString(),
      iteration: task.iterations,
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

  processManager?.addItem('Resuming manual with new instructions');

  try {
    // Build resume command based on agent
    const resumeCommand = buildResumeCommand(state.agent, state.sessionId, instructions);

    // Check if container is running
    const containerCheck = await launch('docker', [
      'inspect',
      '-f',
      '{{.State.Running}}',
      state.containerId || '',
    ]);

    const isRunning = containerCheck.stdout?.toString().trim() === 'true';

    if (!isRunning) {
      // Container stopped, need to restart
      processManager?.addItem('Restarting container');

      await launch('docker', ['start', state.containerId || '']);

      processManager?.completeLastItem();
    }

    // Execute resume command in container
    const result = await launch('docker', [
      'exec',
      '-i',
      state.containerId || '',
      'sh',
      '-c',
      resumeCommand,
    ]);

    if (result.exitCode !== 0) {
      processManager?.failLastItem();
      return {
        success: false,
        error: `Failed to resume session: ${result.stderr}`,
      };
    }

    // Update manual state
    updateManualState(task, {
      status: 'running',
      lastActivityAt: new Date().toISOString(),
      iteration: task.iterations,
    });

    processManager?.completeLastItem();

    return {
      success: true,
      sessionId: state.sessionId,
      commandSent: resumeCommand,
    };
  } catch (error) {
    processManager?.failLastItem();
    return {
      success: false,
      error: `Error resuming manual: ${(error as Error).message}`,
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
