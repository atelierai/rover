````markdown
# Rover Manual 命令概述

本文档提供 Rover Manual 模式的快速参考。

## 什么是 Manual 模式？

Manual 模式是 Rover 的一个功能，允许你与 AI Agent 进行持久化的交互式对话。与传统的 `rover task` 和 `rover iterate` 命令不同，Manual 模式：

- ✅ **容器复用**：不需要每次都创建新容器
- ✅ **保持上下文**：AI Agent 记住之前的对话
- ✅ **交互式**：可以随时发送新指令
- ✅ **持久化**：对话历史保存在 JSONL 文件中
- ✅ **立即执行**：启动后立即发送 task description 开始执行

## 命令概览

```bash
# 创建 manual 模式任务（立即开始执行）
rover task --manual "<description>"

# 发送消息
rover manual send <taskId> "<message>"

# 查看状态
rover manual status <taskId>

# 列出所有 manual 模式任务
rover manual list

# 停止任务
rover manual stop <taskId>
```

## 快速示例

```bash
# 1. 创建 manual 模式任务（立即开始执行）
rover task --manual "Implement login feature"

# 任务创建后 AI 立即开始工作...
# 使用 rover logs -f 42 查看进度

# 2. 发送后续指令（假设任务 ID 为 42）
rover manual send 42 "Now add form validation"

# 3. 查看进度
rover manual status 42

# 4. 继续对话
rover manual send 42 "Add unit tests"

# 5. 完成后停止
rover manual stop 42
```

## 传统模式 vs Manual 模式

### 传统模式（SWE Workflow，推荐用于简单任务）

```bash
# 每次创建新容器，执行完整 SWE 工作流
rover task "Fix bug in login"
rover iterate 1 "Add unit tests"
rover iterate 1 "Improve error messages"
```

### Manual 模式（推荐用于复杂交互）

```bash
# 创建任务时立即开始执行
rover task --manual "Fix bug in login"

# 复用同一个容器，保持对话上下文
rover manual send 1 "Add unit tests"
rover manual send 1 "Improve error messages"

# 完成后停止
rover manual stop 1
```

## 详细文档

- [完整使用指南](./manual-mode.md)
- [实现原理](../manual-mode-implementation-plan-zh.md)

## 常见用法

### 迭代式开发

```bash
# 创建任务（立即开始执行）
rover task --manual "Implement feature A"

# 等待初始任务完成后，发送后续指令
rover manual send 1 "Add tests for feature A"
# 等待完成...
rover manual send 1 "Refactor and optimize"
rover manual stop 1
```

### 调试和修复

```bash
rover task --manual "Debug the crash in module X"
# AI 立即开始分析...

rover manual send 5 "Apply the fix you suggested"
# 等待完成...
rover manual send 5 "Add defensive checks to prevent this"
rover manual stop 5
```

### 多任务管理

```bash
# 启动多个 manual 模式任务
rover task --manual "Build frontend components"  # ID: 10
rover task --manual "Create API endpoints"       # ID: 20
rover task --manual "Write tests"                # ID: 30

# 查看所有活跃的 manual 模式任务
rover manual list

# 分别与它们交互
rover manual send 10 "Update UI components"
rover manual send 20 "Add new API endpoint"
rover manual send 30 "Write integration tests"
```

## 监控

```bash
# 实时查看输出
rover logs -f <taskId>

# 检查任务状态
rover manual status <taskId>

# 查看所有 manual 模式任务
rover manual list --all
```

## 提示

- 💡 使用明确、具体的指令以获得更好的结果
- 💡 将大任务分解为小步骤
- 💡 定期检查状态，确保每步完成后再继续
- 💡 完成后及时停止任务以释放资源
- 💡 会话历史保存在 `.rover/tasks/<taskId>/sessions/`

## 与 rover list 的集成

Manual 模式任务在 `rover list` 中显示时，Workflow 列会显示 `manual`：

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

## 下一步

查看[完整的 Manual 模式使用指南](./manual-mode.md)了解更多详细信息。

````
