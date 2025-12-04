/**
 * Manual Stop Command
 *
 * Stops an active manual mode task and optionally removes the container.
 */

import colors from 'ansi-colors';
import { launch, ProcessManager } from 'rover-common';
import { TaskDescriptionManager, TaskNotFoundError } from 'rover-schemas';
import {
  hasActiveManual,
  loadManualState,
  saveManualState,
} from '../../lib/sandbox/manual-mode.js';
import { stopManualDaemon } from '../../lib/manual-iterate.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { isJsonMode } from '../../lib/global-state.js';
import { getTelemetry } from '../../lib/telemetry.js';
import type { CLIJsonOutput } from '../../types.js';

interface StopOptions {
  force?: boolean;
  removeContainer?: boolean;
  json?: boolean;
}

interface StopResult extends CLIJsonOutput {
  taskId?: number;
  sessionId?: string;
  stopped?: boolean;
  containerRemoved?: boolean;
}

export const stopCommand = async (
  taskId: string,
  options: StopOptions = {}
): Promise<void> => {
  const telemetry = getTelemetry();
  const result: StopResult = {
    success: false,
    stopped: false,
    containerRemoved: false,
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
  //       'Use ' + colors.cyan(`rover stop ${taskId}`) + ' for workflow mode tasks',
  //     ],
  //     telemetry,
  //   });
  //   return;
  // }

  // Check if task has a manual state
  const manualState = loadManualState(task);
  
  if (!manualState) {
    result.error = 'Task does not have any manual state (not a manual mode task?)';
    await exitWithError(result, {
      tips: [
        'Use ' + colors.cyan(`rover manual list`) + ' to see manual mode tasks',
      ],
      telemetry,
    });
    return;
  }

  result.sessionId = manualState.sessionId;

  // Check if manual is already stopped
  if (manualState.status === 'completed' || manualState.status === 'failed') {
    if (!options.removeContainer) {
      result.success = true;
      result.stopped = true;

      if (isJsonMode()) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          colors.yellow(
            `Task ${taskId} is already ${manualState.status}`
          )
        );
      }
      await telemetry?.shutdown();
      return;
    }
  }

  // Warn if stopping an active task without force flag
  if (
    !options.force &&
    (manualState.status === 'running' || manualState.status === 'waiting')
  ) {
    if (!isJsonMode()) {
      console.log(
        colors.yellow(
          '\n⚠ Warning: Task is currently ' +
            manualState.status +
            '. Use --force to stop anyway.\n'
        )
      );
    }
    result.error =
      'Task is active. Use --force to stop anyway.';
    await exitWithError(result, { telemetry });
    return;
  }

  try {
    // First, try to gracefully stop the daemon via FIFO
    if (manualState.containerId) {
      if (!isJsonMode()) {
        console.log(
          colors.gray('Sending stop signal to daemon...')
        );
      }

      // Try to stop daemon gracefully first
      const daemonStopResult = await stopManualDaemon(task);
      
      if (!daemonStopResult.success && !isJsonMode()) {
        console.log(
          colors.yellow(
            `Note: ${daemonStopResult.error || 'Could not signal daemon'}`
          )
        );
      }

      // Now stop the container
      if (!isJsonMode()) {
        console.log(
          colors.gray('Stopping container ') +
            colors.cyan(manualState.containerId) +
            colors.gray('...')
        );
      }

      try {
        // Check if container is running
        const inspectResult = await launch('docker', [
          'inspect',
          '-f',
          '{{.State.Running}}',
          manualState.containerId,
        ], { reject: false });

        const isRunning = inspectResult.stdout?.trim() === 'true';

        if (isRunning) {
          // Stop the container
          await launch('docker', ['stop', manualState.containerId], { reject: false });
        }

        // Remove container if requested
        if (options.removeContainer) {
          if (!isJsonMode()) {
            console.log(colors.gray('Removing container...'));
          }

          await launch('docker', ['rm', manualState.containerId], { reject: false });
          result.containerRemoved = true;
        }
      } catch (error) {
        // Container might not exist anymore, that's okay
        if (!isJsonMode()) {
          console.log(
            colors.yellow(
              `Warning: Could not stop/remove container: ${(error as Error).message}`
            )
          );
        }
      }
    }

    // Update manual state
    manualState.status = 'completed';
    manualState.lastActivityAt = new Date().toISOString();
    saveManualState(task, manualState);

    // Update task status
    task.updateExecutionStatus('completed');

    result.success = true;
    result.stopped = true;

    const tips: string[] = [];
    
    if (result.containerRemoved) {
      tips.push('Container has been removed');
    } else if (manualState.containerId) {
      tips.push(
        'Container ' +
          colors.cyan(manualState.containerId) +
          ' is stopped but not removed'
      );
      tips.push(
        'Use ' +
          colors.cyan(`rover manual stop ${taskId} --remove-container`) +
          ' to remove it'
      );
    }

    tips.push(
      'Use ' + colors.cyan(`rover inspect ${taskId}`) + ' to review results'
    );
    tips.push(
      'Use ' + colors.cyan(`rover merge ${taskId}`) + ' to merge changes'
    );
    tips.push(
      'Use ' +
        colors.cyan(`rover task --manual "description"`) +
        ' to create a new manual mode task'
    );

    await exitWithSuccess('Task stopped successfully', result, {
      tips,
      telemetry,
    });
  } catch (error) {
    result.error = `Error stopping task: ${(error as Error).message}`;
    await exitWithError(result, { telemetry });
  } finally {
    await telemetry?.shutdown();
  }
};
