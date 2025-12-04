````markdown
# Rover Manual Command Overview

This document provides a quick reference for Rover Manual mode.

## What is Manual Mode?

Manual mode is a Rover feature that allows you to have persistent interactive conversations with AI Agents. Unlike traditional `rover task` and `rover iterate` commands, Manual mode:

- ✅ **Container Reuse**: No need to create a new container each time
- ✅ **Context Preservation**: AI Agent remembers previous conversations
- ✅ **Interactive**: Can send new instructions at any time
- ✅ **Persistent**: Conversation history saved in JSONL files
- ✅ **Immediate Execution**: Sends task description and starts execution immediately upon startup

## Command Overview

```bash
# Create a manual mode task (starts executing immediately)
rover task --manual "<description>"

# Send a message
rover manual send <taskId> "<message>"

# Check status
rover manual status <taskId>

# List all manual mode tasks
rover manual list

# Stop a task
rover manual stop <taskId>
```

## Quick Example

```bash
# 1. Create a manual mode task (starts executing immediately)
rover task --manual "Implement login feature"

# AI starts working immediately after task creation...
# Use rover logs -f 42 to view progress

# 2. Send follow-up instructions (assuming task ID is 42)
rover manual send 42 "Now add form validation"

# 3. Check progress
rover manual status 42

# 4. Continue conversation
rover manual send 42 "Add unit tests"

# 5. Stop when done
rover manual stop 42
```

## Traditional Mode vs Manual Mode

### Traditional Mode (SWE Workflow, recommended for simple tasks)

```bash
# Creates a new container each time, executes complete SWE workflow
rover task "Fix bug in login"
rover iterate 1 "Add unit tests"
rover iterate 1 "Improve error messages"
```

### Manual Mode (recommended for complex interactions)

```bash
# Starts executing immediately upon task creation
rover task --manual "Fix bug in login"

# Reuses the same container, maintains conversation context
rover manual send 1 "Add unit tests"
rover manual send 1 "Improve error messages"

# Stop when done
rover manual stop 1
```

## Detailed Documentation

- [Complete User Guide](./manual-mode.md)
- [Implementation Details](../dev/manual-mode-implementation-plan-zh.md)

## Common Usage Patterns

### Iterative Development

```bash
# Create task (starts executing immediately)
rover task --manual "Implement feature A"

# After initial task completes, send follow-up instructions
rover manual send 1 "Add tests for feature A"
# Wait for completion...
rover manual send 1 "Refactor and optimize"
rover manual stop 1
```

### Debugging and Fixing

```bash
rover task --manual "Debug the crash in module X"
# AI starts analyzing immediately...

rover manual send 5 "Apply the fix you suggested"
# Wait for completion...
rover manual send 5 "Add defensive checks to prevent this"
rover manual stop 5
```

### Multi-task Management

```bash
# Start multiple manual mode tasks
rover task --manual "Build frontend components"  # ID: 10
rover task --manual "Create API endpoints"       # ID: 20
rover task --manual "Write tests"                # ID: 30

# View all active manual mode tasks
rover manual list

# Interact with them separately
rover manual send 10 "Update UI components"
rover manual send 20 "Add new API endpoint"
rover manual send 30 "Write integration tests"
```

## Monitoring

```bash
# View output in real-time
rover logs -f <taskId>

# Check task status
rover manual status <taskId>

# View all manual mode tasks
rover manual list --all
```

## Tips

- 💡 Use clear, specific instructions for better results
- 💡 Break down large tasks into smaller steps
- 💡 Check status regularly, ensure each step is complete before continuing
- 💡 Stop tasks promptly after completion to release resources
- 💡 Session history is saved in `.rover/tasks/<taskId>/sessions/`

## Integration with rover list

When Manual mode tasks are displayed in `rover list`, the Workflow column shows `manual`:

```
Tasks
┌─────┬──────────────────────────┬────────┬──────────┬────────────┐
│ ID  │ Title                    │ Agent  │ Workflow │ Status     │
├─────┼──────────────────────────┼────────┼──────────┼────────────┤
│ 1   │ Implement auth           │ claude │ swe      │ COMPLETED  │
│ 2   │ Build API endpoints      │ claude │ manual   │ IN_PROGRESS│
│ 3   │ Interactive debugging    │ gemini │ manual   │ IN_PROGRESS│
└─────┴──────────────────────────┴────────┴──────────┴────────────┘
```

## Next Steps

See the [Complete Manual Mode User Guide](./manual-mode.md) for more detailed information.

````
