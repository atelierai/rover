````markdown
# Rover Manual Mode User Guide

Manual mode is a persistent CLI session feature provided by Rover that allows interactive conversations with AI Agents (Claude, Codex, Gemini, Qwen) without recreating containers each time.

## Overview

### Traditional Mode vs Manual Mode

**Traditional Mode (SWE Workflow)** (`rover task` and `rover iterate`):
- Creates a new container for each iteration
- Automatically executes the complete SWE workflow (context → plan → implement → review → summary)
- Suitable for one-time tasks
- Each iteration is independent

**Manual Mode** (`rover task --manual` + `rover manual` command group):
- Persistent CLI session
- Container reuse
- Suitable for tasks requiring multiple interactions
- Maintains conversation context
- Persists session history via JSONL files
- Sends task description to CLI immediately upon startup

## Quick Start

### 1. Start a Manual Mode Task

Create a task using the `--manual` option:

```bash
# Create and start a manual mode task
rover task --manual "Implement user authentication system"
```

Example output:
```
Manual mode session started successfully
├── Task ID: 123
├── Mode: Manual (CLI Controller)
├── Status: IN_PROGRESS
├── Agent: claude
└── Container: rover-manual-123-1

✓ Task description sent to CLI
✓ Claude is now working on: "Implement user authentication system"

Tips:
  - Use rover manual send 123 "your message" to send additional instructions
  - Use rover manual status 123 to check session status
  - Use rover logs -f 123 to watch the session logs
```

### 2. Send Messages

Send new instructions to an active manual mode task:

```bash
# Send a message
rover manual send 123 "Add unit tests for the login function"

# Or read from stdin
echo "Add input validation" | rover manual send 123
```

### 3. Check Status

Check the current status of a manual mode task:

```bash
# Basic status
rover manual status 123

# View complete conversation history
rover manual status 123 --show-history
```

### 4. List All Manual Mode Tasks

View all manual mode tasks:

```bash
# Show only active tasks
rover manual list

# Show all tasks (including completed and failed)
rover manual list --all
```

### 5. Stop a Manual Mode Task

Stop the task after completing work:

```bash
# Stop the task (keep container)
rover manual stop 123

# Stop and remove the container
rover manual stop 123 --remove-container

# Force stop a running task
rover manual stop 123 --force
```

## Use Cases

### Scenario 1: Iterative Development

```bash
# 1. Create a manual mode task (starts executing immediately)
rover task --manual "Build a REST API for blog posts"

# 2. Wait for initial task execution...
rover logs -f 1

# 3. Gradually add features
rover manual send 1 "Now add authentication middleware"
# ... wait for completion ...

rover manual send 1 "Add input validation and error handling"
# ... wait for completion ...

rover manual send 1 "Finally, add unit tests"

# 4. View results
rover inspect 1

# 5. Stop the task
rover manual stop 1
```

### Scenario 2: Debugging and Fixing

```bash
# Start a manual mode task
rover task --manual "Debug and fix login issues"

# Send fix instructions after discovering issues
rover manual send 42 "The login function is throwing a null pointer exception, please fix it"

# Check progress
rover manual status 42

# Continue debugging
rover manual send 42 "Add logging to help debug the issue"

# Stop when done
rover manual stop 42
```

### Scenario 3: Parallel Multi-tasking

```bash
# Start multiple manual mode tasks for different tasks
rover task --manual "Implement frontend components"  # ID: 10
rover task --manual "Create API endpoints"           # ID: 11
rover task --manual "Update documentation"           # ID: 12

# Send messages to different tasks
rover manual send 10 "Add responsive design"
rover manual send 11 "Implement authentication"
rover manual send 12 "Update API documentation"

# View all active manual mode tasks
rover manual list

# Check progress separately
rover manual status 10
rover manual status 11
rover manual status 12
```

## Command Reference

### `rover task --manual <description>`

Create and start a manual mode task.

**Arguments:**
- `<description>`: Task description (required)

**Options:**
- `--agent <agent>`: Specify AI Agent (claude/codex/gemini/qwen)
- `--source-branch <branch>`: Source branch
- `--target-branch <branch>`: Target branch name
- `--json`: JSON format output

**Examples:**
```bash
# Basic usage
rover task --manual "Implement user authentication"

# Specify agent
rover task --manual --agent codex "Build REST API"

# Create from specified branch
rover task --manual --source-branch main "Fix security issues"
```

---

### `rover manual send <taskId> [message]`

Send a message to an active manual mode task.

**Arguments:**
- `<taskId>`: Task ID (required)
- `[message]`: Message to send (optional, can be read from stdin)

**Options:**
- `--json`: JSON format output

**Examples:**
```bash
# Send message directly
rover manual send 123 "Add error handling"

# Read from stdin
echo "Refactor the code" | rover manual send 123

# Read from file
cat instructions.txt | rover manual send 123
```

---

### `rover manual list`

List all manual mode tasks.

**Options:**
- `--json`: JSON format output
- `--all`: Show all tasks (including completed and failed)

**Examples:**
```bash
# Show only active tasks
rover manual list

# Show all tasks
rover manual list --all
```

---

### `rover manual status <taskId>`

Display detailed status of a manual mode task.

**Arguments:**
- `<taskId>`: Task ID (required)

**Options:**
- `--json`: JSON format output
- `--show-history`: Show complete conversation history

**Examples:**
```bash
# Basic status
rover manual status 123

# Include conversation history
rover manual status 123 --show-history
```

---

### `rover manual stop <taskId>`

Stop a running manual mode task.

**Arguments:**
- `<taskId>`: Task ID (required)

**Options:**
- `--force`: Force stop (even if executing)
- `--remove-container`: Remove container
- `--json`: JSON format output

**Examples:**
```bash
# Normal stop
rover manual stop 123

# Force stop and remove container
rover manual stop 123 --force --remove-container
```

## Monitoring and Debugging

### View Output in Real-time

Use the `rover logs` command to view task output in real-time:

```bash
rover logs -f 123
```

### View Task Details

Use `rover inspect` to view complete task information:

```bash
rover inspect 123
```

### View Live Daemon Status

The `rover manual status` command now fetches real-time status from the container's daemon:

```bash
# Shows live status including:
# - Container running state
# - Current daemon status (waiting/running)
# - Iteration count
# - Last activity time
# - Any errors
rover manual status 123

# Include conversation history from container
rover manual status 123 --show-history
```

### Idle Timeout

Manual mode containers automatically shut down after 30 minutes of inactivity to conserve resources. This timeout can be configured when starting the daemon.

### View JSONL Files

The complete conversation history for Manual mode is saved in JSONL files:

```
.rover/tasks/<taskId>/sessions/state.json
.rover/tasks/<taskId>/sessions/<sessionId>.jsonl
```

You can directly view these files to understand the detailed interaction history.

## Best Practices

### 1. Clear Instructions

Provide clear, specific instructions for better results:

```bash
# ❌ Bad
rover manual send 123 "Fix it"

# ✅ Good
rover manual send 123 "Fix the null pointer exception in login.ts line 42"
```

### 2. Progress Step by Step

Break down large tasks into smaller steps:

```bash
rover manual send 123 "Step 1: Create the data models"
# Wait for completion...
rover manual send 123 "Step 2: Implement the repository layer"
# Wait for completion...
rover manual send 123 "Step 3: Add business logic"
```

### 3. Check Status Regularly

Check current status before sending new instructions:

```bash
rover manual status 123
# Confirm the previous task is complete before continuing
rover manual send 123 "Next task..."
```

### 4. Stop Promptly

Stop tasks promptly after completing work to release resources:

```bash
rover manual stop 123 --remove-container
```

## Troubleshooting

### Task Not Responding

```bash
# Check task status
rover manual status 123

# View container logs
rover logs 123

# If unable to recover, stop and recreate
rover manual stop 123 --force
rover task --manual "Same task description"
```

### Container Has Stopped

```bash
# Stop old task
rover manual stop 123

# Create a new manual mode task
rover task --manual "Task description"
```

### Cannot Find Task

```bash
# List all manual mode tasks
rover manual list --all

# Check all tasks
rover list
```

## Comparison with Traditional Mode

| Feature | Traditional Mode (SWE) | Manual Mode |
|---------|------------------------|-------------|
| Start Command | `rover task` | `rover task --manual` |
| Iteration Command | `rover iterate` | `rover manual send` |
| Container Lifecycle | New container per iteration | Persistent container |
| Execution Method | Auto-execute complete workflow | CLI interactive execution |
| Context Preservation | None | Complete conversation history |
| Interaction Method | Single instruction | Multi-turn conversation |
| Resource Consumption | Higher (frequent container creation) | Lower (container reuse) |
| Suitable Scenarios | Independent tasks | Iterative development |
| Learning Curve | Simple | Moderate |

## FAQ

**Q: When should I use Manual mode?**

A: When you need multiple rounds of interaction with an AI Agent, or when a task requires multiple steps to complete gradually, Manual mode is more appropriate.

**Q: What's the difference between Manual mode and traditional iterate?**

A: `rover iterate` creates a new container each time and runs the complete SWE workflow; Manual mode reuses containers, maintains conversation context, and uses CLI Controller for interaction.

**Q: Where is task data saved?**

A: Task state and session history are saved in the `.rover/tasks/<taskId>/sessions/` directory.

**Q: Can I run multiple Manual mode tasks simultaneously?**

A: Yes, each task has its own independent container and session, without interference.

**Q: Is session history saved automatically?**

A: Yes, all interactions are automatically saved to JSONL files.

**Q: Does a Manual mode task start executing immediately after creation?**

A: Yes, after creating the task, the CLI Controller immediately sends the task description to the AI Agent to start execution.

## Internal Architecture

For developers and advanced users, here's how Manual mode works internally:

### Daemon Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Host System                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     Rover CLI                                │   │
│  │  rover manual send → sendToDaemon() → FIFO pipe write       │   │
│  │  rover manual stop → stopManualDaemon() → writes "stop"     │   │
│  │  rover manual status → getDaemonStatus() → reads status.json│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                     Docker exec / FIFO                               │
│                              │                                       │
│  ┌───────────────────────────▼─────────────────────────────────┐   │
│  │                   Docker Container                           │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │               rover-agent daemon                      │   │   │
│  │  │  • Listens on /tmp/rover-input.fifo                  │   │   │
│  │  │  • Receives: message, stop, status commands          │   │   │
│  │  │  • Invokes AI agent (claude, gemini, etc.)           │   │   │
│  │  │  • Writes session to /rover/session.jsonl            │   │   │
│  │  │  • Updates status in /rover/status.json              │   │   │
│  │  │  • Auto-shutdown after 30 min idle                   │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Message Flow

1. **User runs**: `rover manual send 123 "fix the bug"`
2. **CLI**: Validates task, checks container is running
3. **CLI**: Writes message to FIFO pipe inside container
4. **Daemon**: Receives message from FIFO
5. **Daemon**: Updates status.json to "running"
6. **Daemon**: Invokes AI agent with message
7. **Daemon**: Logs interaction to session.jsonl
8. **Daemon**: Updates status.json to "waiting"
9. **CLI**: Streams output back to user

### Key Files Inside Container

| File | Purpose |
|------|---------|
| `/tmp/rover-input.fifo` | FIFO pipe for receiving commands |
| `/rover/session.jsonl` | Session history in JSONL format |
| `/rover/status.json` | Current daemon status |
| `/rover/.daemon-ready` | Marker file indicating daemon is ready |

## Next Steps

- Learn about [Manual Mode Implementation Details](../dev/manual-mode-implementation-plan-zh.md)
- View [Complete Command Reference](../cli-guidelines.md)
- Explore [Workflow System](../../README.md#workflows)

````
