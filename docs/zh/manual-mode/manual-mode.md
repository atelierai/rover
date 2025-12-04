````markdown
# Rover Manual 模式使用指南

Manual 模式是 Rover 提供的一种持久化 CLI 会话功能，允许与 AI Agent（Claude、Codex、Gemini、Qwen）进行交互式对话，而无需每次都重新创建容器。

## 概述

### 传统模式 vs Manual 模式

**传统模式（SWE Workflow）**（`rover task` 和 `rover iterate`）：
- 每次迭代都会创建新的容器
- 自动执行完整 SWE 工作流（context → plan → implement → review → summary）
- 适合一次性任务
- 每个迭代独立

**Manual 模式**（`rover task --manual` + `rover manual` 命令组）：
- 持久化的 CLI 会话
- 容器复用
- 适合需要多次交互的任务
- 保持对话上下文
- 通过 JSONL 文件持久化会话历史
- 启动时立即发送 task description 到 CLI

## 快速开始

### 1. 启动 Manual 模式任务

使用 `--manual` 选项创建任务：

```bash
# 创建并启动 manual 模式任务
rover task --manual "Implement user authentication system"
```

输出示例：
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

### 2. 发送消息

向活跃的 manual 模式任务发送新的指令：

```bash
# 发送消息
rover manual send 123 "Add unit tests for the login function"

# 或从 stdin 读取
echo "Add input validation" | rover manual send 123
```

### 3. 查看状态

检查 manual 模式任务的当前状态：

```bash
# 基本状态
rover manual status 123

# 查看完整对话历史
rover manual status 123 --show-history
```

### 4. 列出所有 Manual 模式任务

查看所有 manual 模式的任务：

```bash
# 只显示活跃的任务
rover manual list

# 显示所有任务（包括已完成和失败的）
rover manual list --all
```

### 5. 停止 Manual 模式任务

完成工作后停止任务：

```bash
# 停止任务（保留容器）
rover manual stop 123

# 停止并删除容器
rover manual stop 123 --remove-container

# 强制停止正在运行的任务
rover manual stop 123 --force
```

## 使用场景

### 场景 1：迭代式开发

```bash
# 1. 创建 manual 模式任务（立即开始执行）
rover task --manual "Build a REST API for blog posts"

# 2. 等待初始任务执行...
rover logs -f 1

# 3. 逐步添加功能
rover manual send 1 "Now add authentication middleware"
# ... 等待完成 ...

rover manual send 1 "Add input validation and error handling"
# ... 等待完成 ...

rover manual send 1 "Finally, add unit tests"

# 4. 查看结果
rover inspect 1

# 5. 停止任务
rover manual stop 1
```

### 场景 2：调试和修复

```bash
# 启动 manual 模式任务
rover task --manual "Debug and fix login issues"

# 发现问题后发送修复指令
rover manual send 42 "The login function is throwing a null pointer exception, please fix it"

# 检查进度
rover manual status 42

# 继续调试
rover manual send 42 "Add logging to help debug the issue"

# 完成后停止
rover manual stop 42
```

### 场景 3：多任务并行

```bash
# 为不同任务启动多个 manual 模式任务
rover task --manual "Implement frontend components"  # ID: 10
rover task --manual "Create API endpoints"           # ID: 11
rover task --manual "Update documentation"           # ID: 12

# 向不同任务发送消息
rover manual send 10 "Add responsive design"
rover manual send 11 "Implement authentication"
rover manual send 12 "Update API documentation"

# 查看所有活跃的 manual 模式任务
rover manual list

# 分别检查进度
rover manual status 10
rover manual status 11
rover manual status 12
```

## 命令参考

### `rover task --manual <description>`

创建并启动一个 manual 模式任务。

**参数：**
- `<description>`: 任务描述（必须）

**选项：**
- `--agent <agent>`: 指定 AI Agent（claude/codex/gemini/qwen）
- `--source-branch <branch>`: 源分支
- `--target-branch <branch>`: 目标分支名
- `--json`: JSON 格式输出

**示例：**
```bash
# 基本用法
rover task --manual "Implement user authentication"

# 指定 agent
rover task --manual --agent codex "Build REST API"

# 从指定分支创建
rover task --manual --source-branch main "Fix security issues"
```

---

### `rover manual send <taskId> [message]`

向活跃的 manual 模式任务发送消息。

**参数：**
- `<taskId>`: 任务 ID（必须）
- `[message]`: 要发送的消息（可选，可从 stdin 读取）

**选项：**
- `--json`: JSON 格式输出

**示例：**
```bash
# 直接发送消息
rover manual send 123 "Add error handling"

# 从 stdin 读取
echo "Refactor the code" | rover manual send 123

# 从文件读取
cat instructions.txt | rover manual send 123
```

---

### `rover manual list`

列出所有 manual 模式任务。

**选项：**
- `--json`: JSON 格式输出
- `--all`: 显示所有任务（包括已完成和失败的）

**示例：**
```bash
# 只显示活跃的任务
rover manual list

# 显示所有任务
rover manual list --all
```

---

### `rover manual status <taskId>`

显示 manual 模式任务的详细状态。

**参数：**
- `<taskId>`: 任务 ID（必须）

**选项：**
- `--json`: JSON 格式输出
- `--show-history`: 显示完整对话历史

**示例：**
```bash
# 基本状态
rover manual status 123

# 包含对话历史
rover manual status 123 --show-history
```

---

### `rover manual stop <taskId>`

停止运行中的 manual 模式任务。

**参数：**
- `<taskId>`: 任务 ID（必须）

**选项：**
- `--force`: 强制停止（即使正在执行）
- `--remove-container`: 删除容器
- `--json`: JSON 格式输出

**示例：**
```bash
# 正常停止
rover manual stop 123

# 强制停止并删除容器
rover manual stop 123 --force --remove-container
```

## 监控和调试

### 实时查看输出

使用 `rover logs` 命令实时查看任务的输出：

```bash
rover logs -f 123
```

### 查看任务详情

使用 `rover inspect` 查看任务的完整信息：

```bash
rover inspect 123
```

### 查看实时 Daemon 状态

`rover manual status` 命令现在可以从容器的 daemon 获取实时状态：

```bash
# 显示实时状态，包括：
# - 容器运行状态
# - 当前 daemon 状态（waiting/running）
# - 迭代次数
# - 最后活动时间
# - 任何错误信息
rover manual status 123

# 包含容器中的对话历史
rover manual status 123 --show-history
```

### 空闲超时

Manual 模式容器在 30 分钟无活动后会自动关闭以节约资源。这个超时时间可以在启动 daemon 时配置。

### 查看 JSONL 文件

Manual 模式的完整对话历史保存在 JSONL 文件中：

```
.rover/tasks/<taskId>/sessions/state.json
.rover/tasks/<taskId>/sessions/<sessionId>.jsonl
```

你可以直接查看这些文件来了解详细的交互历史。

## 最佳实践

### 1. 明确的指令

提供清晰、具体的指令以获得更好的结果：

```bash
# ❌ 不好
rover manual send 123 "Fix it"

# ✅ 好
rover manual send 123 "Fix the null pointer exception in login.ts line 42"
```

### 2. 逐步推进

将大任务分解为小步骤：

```bash
rover manual send 123 "Step 1: Create the data models"
# 等待完成...
rover manual send 123 "Step 2: Implement the repository layer"
# 等待完成...
rover manual send 123 "Step 3: Add business logic"
```

### 3. 定期检查状态

在发送新指令前检查当前状态：

```bash
rover manual status 123
# 确认上一个任务已完成再继续
rover manual send 123 "Next task..."
```

### 4. 及时停止

完成工作后及时停止任务释放资源：

```bash
rover manual stop 123 --remove-container
```

## 故障排查

### 任务无响应

```bash
# 检查任务状态
rover manual status 123

# 查看容器日志
rover logs 123

# 如果无法恢复，停止并重新创建
rover manual stop 123 --force
rover task --manual "Same task description"
```

### 容器已停止

```bash
# 停止旧任务
rover manual stop 123

# 创建新的 manual 模式任务
rover task --manual "Task description"
```

### 找不到任务

```bash
# 列出所有 manual 模式任务
rover manual list --all

# 检查所有任务
rover list
```

## 与传统模式的比较

| 特性 | 传统模式（SWE） | Manual 模式 |
|------|----------------|-------------|
| 启动命令 | `rover task` | `rover task --manual` |
| 迭代命令 | `rover iterate` | `rover manual send` |
| 容器生命周期 | 每次迭代创建新容器 | 持久化容器 |
| 执行方式 | 自动执行完整 workflow | CLI 交互式执行 |
| 上下文保持 | 无 | 完整对话历史 |
| 交互方式 | 单次指令 | 多轮对话 |
| 资源消耗 | 较高（频繁创建容器） | 较低（复用容器） |
| 适用场景 | 独立任务 | 迭代式开发 |
| 学习曲线 | 简单 | 中等 |

## 常见问题

**Q: 什么时候应该使用 Manual 模式？**

A: 当你需要与 AI Agent 进行多轮交互，或任务需要多个步骤逐步完成时，使用 Manual 模式更合适。

**Q: Manual 模式和传统 iterate 有什么区别？**

A: `rover iterate` 每次都创建新容器运行完整的 SWE 工作流；而 Manual 模式复用容器，保持对话上下文，使用 CLI Controller 进行交互。

**Q: 任务数据保存在哪里？**

A: 任务状态和会话历史保存在 `.rover/tasks/<taskId>/sessions/` 目录下。

**Q: 可以同时运行多个 Manual 模式任务吗？**

A: 可以，每个任务都有独立的容器和会话，互不干扰。

**Q: 会话历史会自动保存吗？**

A: 是的，所有的交互都会自动保存到 JSONL 文件中。

**Q: Manual 模式任务创建后会立即开始执行吗？**

A: 是的，创建任务后 CLI Controller 会立即将 task description 发送给 AI Agent 开始执行。

## 内部架构

对于开发者和高级用户，以下是 Manual 模式的内部工作原理：

### Daemon 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        宿主机系统                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     Rover CLI                                │   │
│  │  rover manual send → sendToDaemon() → 写入 FIFO 管道        │   │
│  │  rover manual stop → stopManualDaemon() → 写入 "stop"       │   │
│  │  rover manual status → getDaemonStatus() → 读取 status.json │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                     Docker exec / FIFO                               │
│                              │                                       │
│  ┌───────────────────────────▼─────────────────────────────────┐   │
│  │                   Docker 容器                                │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │               rover-agent daemon                      │   │   │
│  │  │  • 监听 /tmp/rover-input.fifo                        │   │   │
│  │  │  • 接收命令: message, stop, status                   │   │   │
│  │  │  • 调用 AI agent（claude, gemini 等）                │   │   │
│  │  │  • 写入会话记录到 /rover/session.jsonl               │   │   │
│  │  │  • 更新状态到 /rover/status.json                     │   │   │
│  │  │  • 30 分钟空闲后自动关闭                             │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 消息流程

1. **用户执行**: `rover manual send 123 "修复这个bug"`
2. **CLI**: 验证任务，检查容器是否运行
3. **CLI**: 将消息写入容器内的 FIFO 管道
4. **Daemon**: 从 FIFO 接收消息
5. **Daemon**: 更新 status.json 为 "running"
6. **Daemon**: 调用 AI agent 处理消息
7. **Daemon**: 记录交互到 session.jsonl
8. **Daemon**: 更新 status.json 为 "waiting"
9. **CLI**: 将输出流式返回给用户

### 容器内的关键文件

| 文件 | 用途 |
|------|------|
| `/tmp/rover-input.fifo` | 用于接收命令的 FIFO 管道 |
| `/rover/session.jsonl` | JSONL 格式的会话历史 |
| `/rover/status.json` | 当前 daemon 状态 |
| `/rover/.daemon-ready` | 表示 daemon 已就绪的标记文件 |

## 下一步

- 了解 [Manual 模式实现原理](../dev/manual-mode-implementation-plan-zh.md)
- 查看 [完整的命令参考](../cli-guidelines.md)
- 探索 [工作流系统](../../README.md#workflows)

````
