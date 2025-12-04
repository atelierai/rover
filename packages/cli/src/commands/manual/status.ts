/**
 * Manual Status Command
 *
 * Shows detailed status and history of a manual mode task.
 */

import colors from 'ansi-colors';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, showProperties } from 'rover-common';
import { TaskDescriptionManager, TaskNotFoundError } from 'rover-schemas';
import {
  hasActiveManual,
  loadManualState,
  getManualDir,
} from '../../lib/sandbox/manual-mode.js';
import { exitWithError } from '../../utils/exit.js';
import { isJsonMode } from '../../lib/global-state.js';
import { getTelemetry } from '../../lib/telemetry.js';
import type { CLIJsonOutput } from '../../types.js';

// Path to status file in container
const CONTAINER_STATUS_PATH = '/rover/status.json';
const CONTAINER_JSONL_PATH = '/rover/session.jsonl';

interface StatusOptions {
  json?: boolean;
  showHistory?: boolean;
}

interface DaemonStatus {
  status: string;
  agent: string;
  taskId: string;
  startedAt: string;
  lastActivityAt: string;
  iteration: number;
  lastError?: string;
}

interface StatusResult extends CLIJsonOutput {
  taskId?: number;
  taskTitle?: string;
  sessionId?: string;
  agent?: string;
  status?: string;
  daemonStatus?: DaemonStatus;
  containerRunning?: boolean;
  startedAt?: string;
  lastActivityAt?: string;
  containerId?: string;
  iteration?: number;
  jsonlPath?: string;
  history?: Array<{
    timestamp: string;
    role: string;
    content: string;
  }>;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Check if container is running and get daemon status from it
 */
async function getContainerDaemonStatus(containerId: string): Promise<{
  running: boolean;
  daemonStatus?: DaemonStatus;
}> {
  try {
    // Check if container is running
    const inspectResult = await launch('docker', [
      'inspect',
      '-f',
      '{{.State.Running}}',
      containerId,
    ], { reject: false });

    const running = inspectResult.stdout?.trim() === 'true';

    if (!running) {
      return { running: false };
    }

    // Get daemon status from container
    const statusResult = await launch('docker', [
      'exec',
      containerId,
      'cat',
      CONTAINER_STATUS_PATH,
    ], { reject: false });

    if (statusResult.exitCode === 0 && statusResult.stdout) {
      try {
        const daemonStatus = JSON.parse(statusResult.stdout) as DaemonStatus;
        return { running: true, daemonStatus };
      } catch {
        return { running: true };
      }
    }

    return { running: true };
  } catch {
    return { running: false };
  }
}

/**
 * Get recent history from container's JSONL log
 */
async function getContainerHistory(
  containerId: string,
  limit: number = 20
): Promise<Array<{ timestamp: string; role: string; content: string }>> {
  try {
    const result = await launch('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      `tail -n ${limit} ${CONTAINER_JSONL_PATH} 2>/dev/null || echo ""`,
    ], { reject: false });

    if (result.exitCode !== 0 || !result.stdout) {
      return [];
    }

    const lines = result.stdout.trim().split('\n').filter(l => l.trim());
    
    return lines.map(line => {
      try {
        const entry = JSON.parse(line);
        return {
          timestamp: entry.timestamp || '',
          role: entry.message?.role || entry.type || 'system',
          content: extractContent(entry),
        };
      } catch {
        return {
          timestamp: '',
          role: 'system',
          content: 'Failed to parse entry',
        };
      }
    });
  } catch {
    return [];
  }
}

/**
 * Parse JSONL file to extract conversation history
 */
function parseJsonlHistory(jsonlPath: string, limit: number = 10): Array<{
  timestamp: string;
  role: string;
  content: string;
}> {
  if (!existsSync(jsonlPath)) {
    return [];
  }

  try {
    const content = readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    
    // Take last N lines
    const recentLines = lines.slice(-limit);
    
    return recentLines.map(line => {
      try {
        const entry = JSON.parse(line);
        return {
          timestamp: entry.timestamp || '',
          role: entry.message?.role || entry.type || 'system',
          content: extractContent(entry),
        };
      } catch {
        return {
          timestamp: '',
          role: 'system',
          content: 'Failed to parse entry',
        };
      }
    });
  } catch {
    return [];
  }
}

/**
 * Extract content from JSONL entry
 */
function extractContent(entry: any): string {
  if (entry.message?.content) {
    if (typeof entry.message.content === 'string') {
      return entry.message.content;
    } else if (Array.isArray(entry.message.content)) {
      return entry.message.content
        .map((c: any) => c.text || c.type || '')
        .join(' ');
    }
  }
  
  if (entry.toolUse) {
    return `Tool: ${entry.toolUse.name}`;
  }
  
  if (entry.toolResult) {
    return `Tool Result: ${entry.toolResult.name}`;
  }
  
  return entry.type || 'Unknown';
}

/**
 * Colorize role
 */
function colorizeRole(role: string): string {
  switch (role) {
    case 'user':
      return colors.cyan(role);
    case 'assistant':
      return colors.green(role);
    case 'tool_use':
    case 'tool_result':
      return colors.yellow(role);
    default:
      return colors.gray(role);
  }
}

export const statusCommand = async (
  taskId: string,
  options: StatusOptions = {}
): Promise<void> => {
  const telemetry = getTelemetry();
  const result: StatusResult = {
    success: false,
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

  result.taskTitle = task.title;

  // TODO: Check if task is manual mode
  // if (task.mode !== 'manual') {
  //   result.error = 'This command only works with manual mode tasks';
  //   await exitWithError(result, {
  //     tips: [
  //       'Use ' + colors.cyan(`rover inspect ${taskId}`) + ' for workflow mode tasks',
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
        'Use ' +
          colors.cyan(`rover task --manual "description"`) +
          ' to create a manual mode task',
        'Use ' +
          colors.cyan(`rover inspect ${taskId}`) +
          ' for workflow mode tasks',
      ],
      telemetry,
    });
    return;
  }

  // Fill result from local manual state
  result.success = true;
  result.sessionId = manualState.sessionId;
  result.agent = manualState.agent;
  result.status = manualState.status;
  result.startedAt = manualState.startedAt;
  result.lastActivityAt = manualState.lastActivityAt;
  result.containerId = manualState.containerId;
  result.iteration = manualState.iteration;
  
  // Get JSONL path
  const manualDir = getManualDir(task);
  const jsonlPath = join(manualDir, manualState.jsonlPath);
  result.jsonlPath = jsonlPath;

  // Try to get live status from container daemon
  if (manualState.containerId) {
    const containerStatus = await getContainerDaemonStatus(manualState.containerId);
    result.containerRunning = containerStatus.running;

    if (containerStatus.daemonStatus) {
      result.daemonStatus = containerStatus.daemonStatus;
      // Update with live status from daemon
      result.status = containerStatus.daemonStatus.status;
      result.iteration = containerStatus.daemonStatus.iteration;
      result.lastActivityAt = containerStatus.daemonStatus.lastActivityAt;
    }

    // Get history from container if requested
    if (options.showHistory && containerStatus.running) {
      result.history = await getContainerHistory(manualState.containerId, 20);
    }
  }

  // Fall back to local history if container history not available
  if (options.showHistory && (!result.history || result.history.length === 0)) {
    result.history = parseJsonlHistory(jsonlPath, 20);
  }

  if (isJsonMode()) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(colors.bold('\nManual Task Status\n'));
    
    // Build status string with color
    let statusDisplay = result.status || 'unknown';
    if (result.containerRunning === true) {
      statusDisplay = colors.green(statusDisplay + ' (container running)');
    } else if (result.containerRunning === false) {
      statusDisplay = colors.yellow(statusDisplay + ' (container stopped)');
    }
    
    const props: Record<string, string> = {
      'Task ID': result.taskId!.toString(),
      'Task Title': result.taskTitle || '',
      'Session ID': result.sessionId!,
      'Agent': result.agent!,
      'Status': statusDisplay,
      'Started At': formatTimestamp(result.startedAt!),
      'Last Activity': formatTimestamp(result.lastActivityAt!),
      'Iteration': result.iteration!.toString(),
    };

    if (result.containerId) {
      props['Container ID'] = result.containerId;
    }

    if (result.daemonStatus?.lastError) {
      props['Last Error'] = colors.red(result.daemonStatus.lastError);
    }

    showProperties(props);

    // Show recent history
    if (options.showHistory && result.history && result.history.length > 0) {
      console.log(colors.bold('\nRecent Activity:\n'));
      
      for (const entry of result.history) {
        const time = entry.timestamp
          ? new Date(entry.timestamp).toLocaleTimeString()
          : '';
        const role = colorizeRole(entry.role);
        const content = entry.content.substring(0, 100);
        
        console.log(`  [${time}] ${role}: ${content}${entry.content.length > 100 ? '...' : ''}`);
      }
    }

    // Show tips based on status
    console.log(colors.bold('\nTips:'));
    
    if (result.status === 'running' || result.status === 'waiting') {
      console.log(
        colors.gray('  - Use ') +
          colors.cyan(`rover manual send ${taskId} "message"`) +
          colors.gray(' to send instructions')
      );
      console.log(
        colors.gray('  - Use ') +
          colors.cyan(`rover logs -f ${taskId}`) +
          colors.gray(' to watch output')
      );
      console.log(
        colors.gray('  - Use ') +
          colors.cyan(`rover manual stop ${taskId}`) +
          colors.gray(' to stop the task')
      );
    } else {
      console.log(
        colors.gray('  - Use ') +
          colors.cyan(`rover task --manual "description"`) +
          colors.gray(' to create a new manual mode task')
      );
      console.log(
        colors.gray('  - Use ') +
          colors.cyan(`rover inspect ${taskId}`) +
          colors.gray(' to review results')
      );
      console.log(
        colors.gray('  - Use ') +
          colors.cyan(`rover merge ${taskId}`) +
          colors.gray(' to merge changes')
      );
    }
  }

  await telemetry?.shutdown();
};
