/**
 * Manual List Command
 *
 * Lists all manual mode tasks (tasks with active sessions).
 */

import colors from 'ansi-colors';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from 'rover-common';
import { TaskDescriptionManager } from 'rover-schemas';
import { loadManualState, type ManualState } from '../../lib/sandbox/manual-mode.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { isJsonMode } from '../../lib/global-state.js';
import { getTelemetry } from '../../lib/telemetry.js';
import type { CLIJsonOutput } from '../../types.js';

interface ListOptions {
  json?: boolean;
  all?: boolean;
}

interface TaskInfo {
  taskId: number;
  title: string;
  sessionId: string;
  agent: string;
  status: string;
  lastActivity: string;
  containerId?: string;
}

interface ListResult extends CLIJsonOutput {
  tasks?: TaskInfo[];
  count?: number;
}

/**
 * Format time difference for display
 */
function formatTimeDiff(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  } else {
    return 'just now';
  }
}

/**
 * Apply status color
 */
function colorizeStatus(status: string): string {
  switch (status) {
    case 'running':
      return colors.green(status);
    case 'waiting':
      return colors.yellow(status);
    case 'completed':
      return colors.blue(status);
    case 'failed':
      return colors.red(status);
    default:
      return colors.gray(status);
  }
}

export const listCommand = async (
  options: ListOptions = {}
): Promise<void> => {
  const telemetry = getTelemetry();
  const result: ListResult = {
    success: false,
    tasks: [],
    count: 0,
  };

  try {
    // Find all tasks with sessions (manual mode tasks)
    const roverPath = join(findProjectRoot(), '.rover');
    const tasksPath = join(roverPath, 'tasks');

    if (!existsSync(tasksPath)) {
      result.success = true;
      result.count = 0;

      if (isJsonMode()) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(colors.gray('No tasks found'));
      }
      await telemetry?.shutdown();
      return;
    }

    const taskDirs = readdirSync(tasksPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const tasks: TaskInfo[] = [];

    for (const taskDir of taskDirs) {
      const taskId = parseInt(taskDir, 10);
      if (isNaN(taskId)) continue;

      try {
        const task = TaskDescriptionManager.load(taskId);
        const state = loadManualState(task);

        // Only show tasks with manual state (manual mode tasks)
        // TODO: Also check task.mode === 'manual' when mode field is added
        if (state) {
          // Filter by status if not showing all
          if (!options.all) {
            if (state.status !== 'running' && state.status !== 'waiting') {
              continue;
            }
          }

          tasks.push({
            taskId: task.id,
            title: task.title,
            sessionId: state.sessionId,
            agent: state.agent,
            status: state.status,
            lastActivity: state.lastActivityAt,
            containerId: state.containerId,
          });
        }
      } catch {
        // Skip tasks that can't be loaded
        continue;
      }
    }

    // Sort by last activity (most recent first)
    tasks.sort((a, b) => {
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });

    result.success = true;
    result.tasks = tasks;
    result.count = tasks.length;

    if (isJsonMode()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (tasks.length === 0) {
        console.log(colors.gray('\nNo ' + (options.all ? '' : 'active ') + 'manual mode tasks found'));
        console.log(
          colors.gray('\nUse ') +
            colors.cyan('rover task --manual "description"') +
            colors.gray(' to create a manual mode task')
        );
      } else {
        console.log(
          colors.bold(
            `\n${options.all ? 'All' : 'Active'} Manual Mode Tasks (${tasks.length})\n`
          )
        );

        // Print header
        const headerFormat = '%-9s %-10s %-30s %-12s %-20s';
        console.log(
          colors.gray(
            require('util').format(
              headerFormat,
              'Task ID',
              'Agent',
              'Title',
              'Status',
              'Last Activity'
            )
          )
        );
        console.log(colors.gray('─'.repeat(90)));

        // Print each task
        for (const task of tasks) {
          const titleDisplay =
            task.title.length > 30
              ? task.title.substring(0, 27) + '...'
              : task.title;

          console.log(
            require('util').format(
              headerFormat,
              task.taskId,
              task.agent,
              titleDisplay,
              colorizeStatus(task.status),
              formatTimeDiff(task.lastActivity)
            )
          );
        }

        console.log('');
        console.log(
          colors.gray('Tips:')
        );
        console.log(
          colors.gray('  - Use ') +
            colors.cyan('rover manual status <taskId>') +
            colors.gray(' for detailed information')
        );
        console.log(
          colors.gray('  - Use ') +
            colors.cyan('rover manual send <taskId> <message>') +
            colors.gray(' to send instructions')
        );
      }
    }

    await telemetry?.shutdown();
  } catch (error) {
    result.error = `Error listing manual mode tasks: ${(error as Error).message}`;
    await exitWithError(result, { telemetry });
  }
};
