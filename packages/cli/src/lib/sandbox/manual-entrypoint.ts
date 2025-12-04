/**
 * Manual Mode Entrypoint Generator
 *
 * Generates entrypoint scripts for manual-mode CLI execution
 * in Docker/Podman containers.
 */

import { writeFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskDescriptionManager, ProjectConfigManager } from 'rover-schemas';
import type { ManualModeConfig } from './manual-mode.js';

/**
 * Generate manual mode entrypoint script
 */
export function generateManualEntrypoint(
  task: TaskDescriptionManager,
  agent: string,
  projectConfig: ProjectConfigManager,
  manualConfig: ManualModeConfig
): string {
  const taskDir = task.taskPath();
  if (!existsSync(taskDir)) {
    mkdirSync(taskDir, { recursive: true });
  }

  // Generate MCP configuration commands
  const mcps = projectConfig.mcps || [];
  const mcpCommands: string[] = [];

  if (mcps.length > 0) {
    mcpCommands.push('echo "Configuring MCPs..."');
    for (const mcp of mcps) {
      let cmd = `rover-agent config mcp ${agent} "${mcp.name}" --transport "${mcp.transport || 'stdio'}"`;
      if (mcp.envs?.length) {
        for (const env of mcp.envs) {
          cmd += ` --env "${env}"`;
        }
      }
      if (mcp.headers?.length) {
        for (const header of mcp.headers) {
          cmd += ` --header "${header}"`;
        }
      }
      cmd += ` "${mcp.commandOrUrl}"`;
      mcpCommands.push(cmd);
    }
  }

  const script = `#!/bin/sh
# Rover Manual Mode Entrypoint
# Generated for task: ${task.id}
# Agent: ${agent}

set -e

echo "======================================="
echo "Rover Manual Mode"
echo "Task: ${task.id}"
echo "Agent: ${agent}"
echo "======================================="

# Function for safe exit
safe_exit() {
  exit_code=\${1:-0}
  echo "Exiting with code: \$exit_code"
  exit \$exit_code
}

# Trap for cleanup
trap 'safe_exit $?' EXIT

# Setup working directory
cd /workspace

# Install agent CLI
echo "Installing ${agent} CLI..."
rover-agent install ${agent}
if [ $? -ne 0 ]; then
  echo "Failed to install ${agent} CLI"
  safe_exit 1
fi

# Configure MCPs
${mcpCommands.join('\n')}

# Create sessions directory
mkdir -p /workspace/.rover/sessions/${task.id}

# Set environment for JSONL history
export ROVER_SESSION_MODE=true
export ROVER_TASK_ID=${task.id}
export ROVER_AGENT=${agent}

# Session directory for JSONL files
SESSION_DIR="/workspace/.rover/sessions/${task.id}"

${getAgentEnvironment(agent)}

# Start CLI in session mode
echo "Starting ${agent} CLI session..."
echo "Session directory: \$SESSION_DIR"

# Read task description
TASK_TITLE="${escapeShell(task.title)}"
TASK_DESC="${escapeShell(task.description)}"

# Build initial prompt
INITIAL_PROMPT="## Task

**Title:** \$TASK_TITLE

**Description:**
\$TASK_DESC

Please complete this task. When you are done, let me know what was accomplished."

# Start the CLI session
# The CLI will run in interactive mode
${getAgentStartCommand(agent, manualConfig)}

echo "Session ended"
`;

  const scriptPath = join(taskDir, 'manual-entrypoint.sh');
  writeFileSync(scriptPath, script.replace(/\r\n/g, '\n'), 'utf8');
  chmodSync(scriptPath, 0o755);

  return scriptPath;
}

/**
 * Get agent-specific environment setup
 */
function getAgentEnvironment(agent: string): string {
  switch (agent) {
    case 'claude':
      return `
# Claude-specific environment
export CLAUDE_HISTORY_DIR="\$SESSION_DIR"
export CLAUDE_CODE_DISABLE_NONINTERACTIVE_HINTS=1
`;
    case 'codex':
      return `
# Codex-specific environment
export CODEX_STATE_DIR="\$SESSION_DIR"
`;
    case 'gemini':
      return `
# Gemini-specific environment
export CODE_ASSIST_PROJECT_PATH="\$SESSION_DIR"
export GEMINI_SANDBOX=true
`;
    case 'qwen':
      return `
# Qwen-specific environment
export CODE_ASSIST_PROJECT_PATH="\$SESSION_DIR"
`;
    default:
      return '';
  }
}

/**
 * Get agent-specific start command
 */
function getAgentStartCommand(
  agent: string,
  config: SessionModeConfig
): string {
  const resumeArg = config.sessionId ? `--resume ${config.sessionId}` : '';

  switch (agent) {
    case 'claude':
      return `
# Claude CLI
echo "\$INITIAL_PROMPT" | claude \\
  --dangerously-skip-permissions \\
  --output-format stream-json \\
  --history-dir "\$SESSION_DIR" \\
  ${resumeArg}
`;
    case 'codex':
      return `
# Codex CLI
echo "\$INITIAL_PROMPT" | codex \\
  chat \\
  --dangerously-bypass-approvals-and-sandbox \\
  --skip-git-repo-check \\
  ${resumeArg ? `--session ${config.sessionId}` : ''}
`;
    case 'gemini':
      return `
# Gemini CLI
echo "\$INITIAL_PROMPT" | gemini \\
  --yolo \\
  --sandbox \\
  --output-format json \\
  ${resumeArg}
`;
    case 'qwen':
      return `
# Qwen CLI
echo "\$INITIAL_PROMPT" | qwen \\
  --yolo \\
  ${resumeArg}
`;
    default:
      return `
# Unknown agent: ${agent}
echo "Error: Unknown agent '${agent}'"
safe_exit 1
`;
  }
}

/**
 * Escape string for shell
 */
function escapeShell(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n');
}

/**
 * Generate manual controller entrypoint
 *
 * This entrypoint uses the rover-agent daemon to manage the CLI session
 * with message passing via FIFO pipes.
 *
 * Architecture:
 * 1. Container starts and runs this entrypoint
 * 2. Entrypoint installs agent and configures MCPs
 * 3. Creates FIFO pipe at /tmp/rover-input.fifo
 * 4. Starts rover-agent daemon which listens on FIFO
 * 5. External CLI sends messages via: docker exec ... echo '{"type":"message","content":"..."}' > /tmp/rover-input.fifo
 * 6. Daemon processes messages and outputs to JSONL log
 */
export function generateControllerEntrypoint(
  task: TaskDescriptionManager,
  agent: string,
  projectConfig: ProjectConfigManager,
  manualConfig: ManualModeConfig
): string {
  const taskDir = task.taskPath();
  if (!existsSync(taskDir)) {
    mkdirSync(taskDir, { recursive: true });
  }

  // Generate MCP configuration commands
  const mcps = projectConfig.mcps || [];
  const mcpCommands: string[] = [];

  if (mcps.length > 0) {
    mcpCommands.push('echo "Configuring MCPs..."');
    for (const mcp of mcps) {
      let cmd = `rover-agent config mcp ${agent} "${mcp.name}" --transport "${mcp.transport || 'stdio'}"`;
      if (mcp.envs?.length) {
        for (const env of mcp.envs) {
          cmd += ` --env "${env}"`;
        }
      }
      if (mcp.headers?.length) {
        for (const header of mcp.headers) {
          cmd += ` --header "${header}"`;
        }
      }
      cmd += ` "${mcp.commandOrUrl}"`;
      mcpCommands.push(cmd);
    }
  }

  // FIFO and paths
  const fifoPath = '/tmp/rover-input.fifo';
  const roverHome = '/rover';
  const sessionDir = `/workspace/.rover/sessions/${task.id}`;
  const jsonlPath = `${roverHome}/session.jsonl`;
  const statusPath = `${roverHome}/status.json`;

  const script = `#!/bin/sh
# Rover Manual Controller Entrypoint (Daemon Mode)
# Generated for task: ${task.id}
# Agent: ${agent}
# 
# This script starts a daemon process that listens for messages
# via FIFO pipe and forwards them to the AI agent.

set -e

echo "======================================="
echo "Rover Manual Controller (Daemon Mode)"
echo "Task: ${task.id}"
echo "Agent: ${agent}"
echo "======================================="

# Function for safe exit
safe_exit() {
  exit_code=\${1:-0}
  echo "Shutting down daemon..."
  
  # Signal daemon to stop if FIFO exists
  if [ -p "${fifoPath}" ]; then
    echo '{"type":"stop"}' > "${fifoPath}" 2>/dev/null || true
  fi
  
  echo "Exiting with code: \$exit_code"
  exit \$exit_code
}

# Trap for cleanup on signals
trap 'safe_exit $?' EXIT
trap 'safe_exit 130' INT
trap 'safe_exit 143' TERM

# Setup working directory
cd /workspace

# Create required directories
mkdir -p ${roverHome}
mkdir -p ${sessionDir}

# Install agent CLI
echo "Installing ${agent} CLI..."
rover-agent install ${agent}
if [ $? -ne 0 ]; then
  echo "Failed to install ${agent} CLI"
  safe_exit 1
fi

# Configure MCPs
${mcpCommands.join('\n')}

# Set environment variables
export ROVER_MANUAL_MODE=true
export ROVER_TASK_ID=${task.id}
export ROVER_AGENT=${agent}
export ROVER_DECISION_AGENT=${manualConfig.decisionAgent || 'claude'}
export ROVER_MAX_CONTINUE=${manualConfig.maxContinueAttempts || 5}
export ROVER_IDLE_TIMEOUT=${manualConfig.idleTimeoutSeconds || 300}
export ROVER_FIFO_PATH=${fifoPath}

${getAgentEnvironment(agent)}

# Write initial task info to status
cat > ${statusPath} << 'EOF'
{
  "status": "starting",
  "agent": "${agent}",
  "taskId": "${task.id}",
  "startedAt": "$(date -Iseconds)",
  "lastActivityAt": "$(date -Iseconds)",
  "iteration": 0
}
EOF

# Log startup
echo "Starting daemon at $(date -Iseconds)"
echo "FIFO Path: ${fifoPath}"
echo "JSONL Log: ${jsonlPath}"
echo "Status File: ${statusPath}"

# Start the daemon process
# This will create the FIFO and listen for messages
echo "Starting rover-agent daemon..."
rover-agent daemon ${agent} \\
  --task-id "${task.id}" \\
  --jsonl-path "${jsonlPath}"

# If daemon exits, log it
echo "Daemon exited at $(date -Iseconds)"
`;

  const scriptPath = join(taskDir, 'controller-entrypoint.sh');
  writeFileSync(scriptPath, script.replace(/\r\n/g, '\n'), 'utf8');
  chmodSync(scriptPath, 0o755);

  return scriptPath;
}
