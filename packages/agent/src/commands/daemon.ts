import colors from 'ansi-colors';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  createReadStream,
  unlinkSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { createAgent } from '../lib/agents/index.js';
import { launch, VERBOSE } from 'rover-common';
import readline from 'node:readline';

// Constants for daemon communication
const FIFO_INPUT_PATH = '/tmp/rover-input.fifo';
const ROVER_HOME = '/rover';
const STATUS_FILE_PATH = `${ROVER_HOME}/status.json`;
const JSONL_LOG_PATH = `${ROVER_HOME}/session.jsonl`;

// Default idle timeout: 30 minutes (in milliseconds)
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface DaemonStatus {
  status: 'waiting' | 'running' | 'completed' | 'failed' | 'idle_timeout';
  agent: string;
  taskId: string;
  startedAt: string;
  lastActivityAt: string;
  iteration: number;
  lastError?: string;
  idleTimeoutSeconds?: number;
}

interface DaemonCommandOptions {
  taskId: string;
  jsonlPath?: string;
  preContextFile: string[];
  idleTimeout?: number; // in seconds
}

/**
 * Log an entry to the JSONL log file
 */
function logJsonl(
  logPath: string,
  entry: { timestamp: string; type: string; [key: string]: unknown }
): void {
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

/**
 * Update the daemon status file
 */
function updateStatus(status: DaemonStatus): void {
  writeFileSync(STATUS_FILE_PATH, JSON.stringify(status, null, 2));
}

/**
 * Create FIFO pipe if it doesn't exist
 */
function ensureFifo(fifoPath: string): void {
  if (!existsSync(fifoPath)) {
    try {
      execSync(`mkfifo "${fifoPath}"`, { stdio: 'pipe' });
      console.log(colors.gray(`Created FIFO pipe: ${fifoPath}`));
    } catch (error) {
      throw new Error(`Failed to create FIFO pipe at ${fifoPath}: ${error}`);
    }
  }
}

/**
 * Read a single message from the FIFO pipe
 * Returns null if the pipe is closed or an error occurs
 */
async function readFromFifo(fifoPath: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      const stream = createReadStream(fifoPath, { encoding: 'utf-8' });
      let data = '';

      stream.on('data', chunk => {
        data += chunk;
      });

      stream.on('end', () => {
        resolve(data.trim() || null);
      });

      stream.on('error', error => {
        console.error(colors.red(`Error reading FIFO: ${error.message}`));
        resolve(null);
      });
    } catch (error) {
      console.error(colors.red(`Failed to open FIFO: ${error}`));
      resolve(null);
    }
  });
}

/**
 * Parse the message from the FIFO pipe
 * Expected format: JSON with { type: 'message', content: '...' } or { type: 'stop' }
 */
interface FifoMessage {
  type: 'message' | 'stop' | 'status';
  content?: string;
}

function parseMessage(raw: string): FifoMessage | null {
  try {
    return JSON.parse(raw) as FifoMessage;
  } catch {
    // If not JSON, treat as plain text message
    return { type: 'message', content: raw };
  }
}

/**
 * Run the agent with the given prompt and capture output
 */
async function runAgent(
  agentName: string,
  prompt: string,
  preContextFiles: string[],
  logPath: string
): Promise<{ success: boolean; output: string; error?: string }> {
  const agentInstance = createAgent(agentName);

  // Log user input
  logJsonl(logPath, {
    timestamp: new Date().toISOString(),
    type: 'user_input',
    message: { role: 'user', content: prompt },
  });

  try {
    // Build arguments for non-interactive mode
    const args = agentInstance.toolArguments();
    args.push(prompt);

    if (VERBOSE) {
      console.log(
        colors.gray(
          `Running: ${agentInstance.binary} ${args.join(' ').substring(0, 100)}...`
        )
      );
    }

    const result = await launch(agentInstance.binary, args, {
      reject: false,
      timeout: 600000, // 10 minutes timeout
    });

    const output = result.stdout || '';
    const stderr = result.stderr || '';

    // Log assistant output
    logJsonl(logPath, {
      timestamp: new Date().toISOString(),
      type: 'assistant_output',
      message: { role: 'assistant', content: output },
      exitCode: result.exitCode,
    });

    if (result.exitCode !== 0) {
      return {
        success: false,
        output,
        error: stderr || `Agent exited with code ${result.exitCode}`,
      };
    }

    return { success: true, output };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logJsonl(logPath, {
      timestamp: new Date().toISOString(),
      type: 'error',
      error: errorMessage,
    });

    return { success: false, output: '', error: errorMessage };
  }
}

/**
 * The daemon command runs a persistent process that listens for messages
 * from the CLI via a FIFO pipe and forwards them to the AI agent.
 *
 * Architecture:
 * 1. Create FIFO pipe at /tmp/rover-input.fifo
 * 2. Write initial status to /rover/status.json
 * 3. Loop: read from FIFO -> run agent -> log output -> update status
 * 4. Handle 'stop' message to gracefully shutdown
 * 5. Auto-shutdown after idle timeout (default 30 minutes)
 */
export const daemonCommand = async (
  agent: string,
  options: DaemonCommandOptions
): Promise<void> => {
  // Calculate idle timeout in milliseconds
  const idleTimeoutMs = options.idleTimeout
    ? options.idleTimeout * 1000
    : DEFAULT_IDLE_TIMEOUT_MS;
  const idleTimeoutSeconds = Math.floor(idleTimeoutMs / 1000);

  console.log(colors.cyan('Starting Rover Agent Daemon'));
  console.log(colors.gray(`├── Agent: ${agent}`));
  console.log(colors.gray(`├── Task ID: ${options.taskId}`));
  console.log(colors.gray(`├── FIFO: ${FIFO_INPUT_PATH}`));
  console.log(colors.gray(`├── Idle Timeout: ${idleTimeoutSeconds}s`));
  console.log(colors.gray(`└── Log: ${JSONL_LOG_PATH}`));

  // Ensure rover home directory exists
  if (!existsSync(ROVER_HOME)) {
    mkdirSync(ROVER_HOME, { recursive: true });
  }

  const logPath = options.jsonlPath || JSONL_LOG_PATH;

  // Initialize status
  const status: DaemonStatus = {
    status: 'waiting',
    agent,
    taskId: options.taskId,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    iteration: 0,
    idleTimeoutSeconds,
  };
  updateStatus(status);

  // Log daemon start
  logJsonl(logPath, {
    timestamp: new Date().toISOString(),
    type: 'daemon_start',
    agent,
    taskId: options.taskId,
    idleTimeoutSeconds,
  });

  // Create FIFO pipe
  ensureFifo(FIFO_INPUT_PATH);

  console.log(colors.green('✓ Daemon ready, waiting for messages...'));

  // Pre-context handling
  const preContextFiles: string[] = options.preContextFile || [];
  if (preContextFiles.length > 0) {
    console.log(colors.gray(`Loaded ${preContextFiles.length} pre-context files`));
  }

  // Set up idle timeout check
  let lastActivityTime = Date.now();
  let idleCheckInterval: NodeJS.Timeout | null = null;

  // Function to check idle timeout
  const checkIdleTimeout = (): boolean => {
    const idleTime = Date.now() - lastActivityTime;
    if (idleTime >= idleTimeoutMs) {
      console.log(
        colors.yellow(
          `\n⏰ Idle timeout reached (${Math.floor(idleTime / 1000)}s), shutting down...`
        )
      );
      return true;
    }
    return false;
  };

  // Main loop: continuously read from FIFO and process messages
  let running = true;

  // Start idle timeout checker (every 60 seconds)
  idleCheckInterval = setInterval(() => {
    if (checkIdleTimeout()) {
      status.status = 'idle_timeout';
      updateStatus(status);

      logJsonl(logPath, {
        timestamp: new Date().toISOString(),
        type: 'daemon_stop',
        reason: 'idle_timeout',
        idleSeconds: Math.floor((Date.now() - lastActivityTime) / 1000),
      });

      running = false;
      
      // Force exit after logging
      setTimeout(() => {
        console.log(colors.cyan('Daemon stopped due to idle timeout'));
        process.exit(0);
      }, 100);
    }
  }, 60000); // Check every minute

  while (running) {
    try {
      // This blocks until data is written to the FIFO
      const rawMessage = await readFromFifo(FIFO_INPUT_PATH);

      if (!rawMessage) {
        // Pipe closed or error, continue listening
        continue;
      }

      // Update last activity time
      lastActivityTime = Date.now();

      console.log(colors.cyan(`\n📨 Received message at ${new Date().toISOString()}`));

      const message = parseMessage(rawMessage);
      if (!message) {
        console.log(colors.yellow('Failed to parse message, skipping'));
        continue;
      }

      // Handle stop command
      if (message.type === 'stop') {
        console.log(colors.yellow('Received stop command, shutting down...'));
        status.status = 'completed';
        updateStatus(status);

        logJsonl(logPath, {
          timestamp: new Date().toISOString(),
          type: 'daemon_stop',
          reason: 'stop_command',
        });

        running = false;
        break;
      }

      // Handle status request
      if (message.type === 'status') {
        console.log(colors.gray('Status request received'));
        console.log(JSON.stringify(status));
        continue;
      }

      // Handle message
      if (message.type === 'message' && message.content) {
        status.status = 'running';
        status.lastActivityAt = new Date().toISOString();
        status.iteration++;
        updateStatus(status);

        console.log(
          colors.gray(`Processing message (iteration ${status.iteration})...`)
        );
        console.log(colors.gray(`Content: ${message.content.substring(0, 100)}...`));

        const result = await runAgent(
          agent,
          message.content,
          preContextFiles,
          logPath
        );

        // Update activity time after agent completes
        lastActivityTime = Date.now();

        if (result.success) {
          console.log(colors.green('✓ Agent completed successfully'));
          status.status = 'waiting';
          status.lastError = undefined;
        } else {
          console.log(colors.red(`✗ Agent failed: ${result.error}`));
          status.status = 'waiting'; // Still waiting for next message
          status.lastError = result.error;
        }

        status.lastActivityAt = new Date().toISOString();
        updateStatus(status);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(colors.red(`Daemon error: ${errorMessage}`));

      logJsonl(logPath, {
        timestamp: new Date().toISOString(),
        type: 'daemon_error',
        error: errorMessage,
      });

      // Don't crash on errors, keep the daemon running
      status.status = 'waiting';
      status.lastError = errorMessage;
      updateStatus(status);
    }
  }

  // Clear idle check interval
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
  }

  console.log(colors.cyan('Daemon stopped'));

  // Cleanup FIFO
  try {
    unlinkSync(FIFO_INPUT_PATH);
  } catch {
    // Ignore cleanup errors
  }
};
