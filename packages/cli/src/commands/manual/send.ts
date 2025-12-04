/**
 * Manual Send Command
 *
 * Sends a message or instruction to an active manual mode task without
 * recreating the container.
 */

import colors from 'ansi-colors';
import { TaskDescriptionManager, TaskNotFoundError } from 'rover-schemas';
import {
  hasActiveManual,
  loadManualState,
  saveManualState,
} from '../../lib/sandbox/manual-mode.js';
import { sendIterationToManual } from '../../lib/manual-iterate.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { isJsonMode } from '../../lib/global-state.js';
import { getTelemetry } from '../../lib/telemetry.js';
import { readFromStdin, stdinIsAvailable } from '../../utils/stdin.js';
import type { CLIJsonOutput } from '../../types.js';

interface SendOptions {
  json?: boolean;
}

interface SendResult extends CLIJsonOutput {
  taskId?: number;
  sessionId?: string;
  message?: string;
  sent?: boolean;
}

export const sendCommand = async (
  taskId: string,
  message?: string,
  options: SendOptions = {}
): Promise<void> => {
  const telemetry = getTelemetry();
  const result: SendResult = {
    success: false,
    sent: false,
  };

  // Parse task ID
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    result.error = `Invalid task ID '${taskId}' - must be a number`;
    await exitWithError(result, { telemetry });
    return;
  }

  result.taskId = numericTaskId;

  // Load task
  let task: TaskDescriptionManager;
  try {
    task = TaskDescriptionManager.load(numericTaskId);
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      result.error = error.message;
    } else {
      result.error = `Error loading task: ${error}`;
    }
    await exitWithError(result, { telemetry });
    return;
  }

  // TODO: Check if task is manual mode
  // if (task.mode !== 'manual') {
  //   result.error = 'This command only works with manual mode tasks';
  //   await exitWithError(result, {
  //     tips: [
  //       'Use ' + colors.cyan(`rover iterate ${taskId}`) + ' for workflow mode tasks',
  //       'Create a manual mode task with: ' + colors.cyan('rover task --manual "description"'),
  //     ],
  //     telemetry,
  //   });
  //   return;
  // }

  // Check if task has an active manual
  if (!hasActiveManual(task)) {
    result.error = 'Task does not have an active manual session';
    await exitWithError(result, {
      tips: [
        'The task may have completed or stopped',
        'Use ' +
          colors.cyan(`rover task --manual "description"`) +
          ' to create a new manual mode task',
        'Use ' + colors.cyan(`rover manual list`) + ' to see all manual mode tasks',
      ],
      telemetry,
    });
    return;
  }

  // Get message from stdin if not provided
  let finalMessage = message?.trim() || '';

  if (!finalMessage && stdinIsAvailable()) {
    const stdinInput = await readFromStdin();
    if (stdinInput) {
      finalMessage = stdinInput;
      if (!isJsonMode()) {
        console.log(colors.gray('(From stdin)'));
      }
    }
  }

  if (!finalMessage) {
    result.error = 'Message is required';
    await exitWithError(result, {
      tips: [
        'Provide a message as argument or via stdin',
        'Example: ' +
          colors.cyan(`rover manual send ${taskId} "Add unit tests"`),
        'Or: ' +
          colors.cyan(`echo "Add tests" | rover manual send ${taskId}`),
      ],
      telemetry,
    });
    return;
  }

  result.message = finalMessage;

  try {
    const manualState = loadManualState(task);
    if (!manualState) {
      result.error = 'Manual state not found';
      await exitWithError(result, { telemetry });
      return;
    }

    result.sessionId = manualState.sessionId;

    if (!isJsonMode()) {
      console.log(
        colors.gray('Sending message to task ') +
          colors.cyan(taskId)
      );
      console.log(colors.gray('Message: ') + finalMessage);
    }

    // Send message to the manual session
    const sendResult = await sendIterationToManual(task, finalMessage);

    if (sendResult.success) {
      // Update manual state
      manualState.lastActivityAt = new Date().toISOString();
      saveManualState(task, manualState);

      result.success = true;
      result.sent = true;

      await exitWithSuccess('Message sent to task', result, {
        tips: [
          'Task is processing your request',
          'Use ' +
            colors.cyan(`rover manual status ${taskId}`) +
            ' to check progress',
          'Use ' +
            colors.cyan(`rover logs -f ${taskId}`) +
            ' to watch the response',
        ],
        telemetry,
      });
    } else {
      result.error = sendResult.error || 'Failed to send message';
      await exitWithError(result, {
        tips: [
          'Check if the container is still running',
          'Use ' + colors.cyan(`rover manual status ${taskId}`) + ' for details',
        ],
        telemetry,
      });
    }
  } catch (error) {
    result.error = `Error sending message: ${(error as Error).message}`;
    await exitWithError(result, { telemetry });
  } finally {
    await telemetry?.shutdown();
  }
};
