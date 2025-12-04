````markdown
# Rover 中的 AI Agent

Rover 为在终端中运行的多个 AI 编码 Agent 提供通用接口。它支持 AI 编码 Agent，如 Codex、Claude Code、Gemini CLI 和 Qwen。Rover 与多个工具交互，这些工具暴露了不同的参数、选项和功能集。在所有这些工具之间维护稳定的接口是必需的。

目前，Rover 使用 AI 编码 Agent 用于：

- **内部操作**：
  - 提取工作流所需的输入
  - 用更多细节丰富用户描述
  - 修复合并冲突
  - 编写提交消息
- **完成用户任务**：
  - 在沙箱中运行工作流的每个步骤以完成用户任务

## AI Agent 定义

### 要求

Rover 与在终端中运行的 AI 编码 Agent 集成，如 Claude Code、Gemini CLI、Codex 和 Qwen CLI。虽然我们希望尽可能支持更多工具，但向 Rover 添加 AI agent 有一定的要求：

1. 它必须稳定。它必须是一个被广泛采用和支持的工具
2. 它必须支持"非交互式"模式。大多数工具使用 `-p` 选项来实现这一点
3. 它必须支持 MCP 服务器配置

如果 AI agent 满足所有这些要求，你可以继续进行集成。要开始集成，首先解决这些问题：

- AI agent 如何向远程服务进行身份验证？
- 配置要求是什么？它需要什么文件才能工作？
- 如何以交互模式运行它？
- 它是否支持 `json` 输出模式？（_这简化了响应的解析_）
- 如何配置 MCP 服务器？我可以通过 CLI 完成还是需要更改一些配置文件？

一旦你有了这些信息，你就可以继续实现了。

### 新 Agent 实现

每个 AI agent 目前在两个位置定义：

- `packages/common/agent.ts`：通用 agent 枚举
- `packages/cli/src/lib/agents`：用于内部操作的类
- `packages/agent/src/`：用于完成用户任务的类

在两个位置定义导致了不必要的重复。在未来，**我们将把所有 AI agent 逻辑整合到 `packages/agents` 包中**。

#### 所需文件

**主 CLI 文件**

| 文件 | 用途 |
| --- | --- |
| `packages/cli/src/commands/init.ts` | 检查用户环境中可用的 AI agent |
| `packages/cli/src/commands/task.ts` | 在创建任务之前验证所需的身份验证文件是否可用 |
| `packages/cli/src/lib/agents/*` | 每个 agent 一个文件，定义：支持的环境变量、所需的容器挂载（用于身份验证）以及使用 agent 运行内部操作的逻辑。它们都实现 `AIAgentTool` 接口 |
| `packages/cli/src/utils/system.ts` | 检查 AI agent 是否在系统中可用的方法 |

**Agent CLI 文件**

| 文件 | 用途 |
| --- | --- |
| `packages/agent/src/lib/runner.ts` | 定义运行 AI agent 的命令 |
| `packages/agent/src/lib/agents/*` | （_~重复_）每个 agent 一个类，定义配置要求并提供完成工作流步骤的方法 |
| `packages/agent/src/lib/agents/index.ts` | （_~重复_）根据名称初始化 agent |

**其他文件**

| 文件 | 用途 |
| --- | --- |
| `packages/common/src/agent.ts` | rover CLI 和 agent CLI 可用 agent 的列表 |
| `packages/schemas/src/workflow/schema.ts` | （_重复_）工作流定义中支持的 AI 编码 agent |

#### 主要接口

添加新 agent 时，你需要实现两个不同的接口：

1. **`AIAgentTool` 接口**（`packages/cli/src/lib/agents`）：用于内部操作，如丰富描述、生成提交消息和解决合并冲突。

   必需的方法：
   - `invoke()`：使用提示运行 agent
   - `checkAgent()`：验证 agent 在系统中可用
   - `expandTask()`、`expandIterationInstructions()`：丰富用户描述
   - `generateCommitMessage()`：创建提交消息
   - `resolveMergeConflicts()`：修复合并冲突
   - `extractGithubInputs()`：提取工作流输入
   - `getContainerMounts()`、`getEnvironmentVariables()`：定义容器配置

2. **`Agent` 接口**（`packages/agent/src/lib/agents`）：用于在工作流中完成用户任务。新 agent 应该扩展 `BaseAgent` 类。

   必需的方法：
   - `getRequiredCredentials()`：列出所需的身份验证文件
   - `validateCredentials()`：检查凭据是否有效
   - `getInstallCommand()`：在容器中安装 agent 的命令
   - `install()`：安装 agent
   - `configureMCP()`：配置 MCP 服务器
   - `copyCredentials()`：将身份验证文件复制到容器
   - `isInstalled()`：检查 agent 是否已安装

### 测试新 Agent

新 agent 涉及项目中的不同包。要测试你的更改，**从项目根文件夹**运行所有这些命令：

- 安装项目依赖：

  ```bash
  npm install
  ```

- 构建不同的包：

  ```bash
  npm run build
  ```

- 然后，构建用于测试的本地沙箱镜像。目前，你需要匹配 [`task.ts` 文件](../packages/cli/src/commands/task.ts) 中 `AGENT_IMAGE` 常量的值。

  ```bash
  # 记得将 "VERSION" 替换为 "AGENT_IMAGE" 中的值
  docker build -t ghcr.io/endorhq/rover/node:VERSION -f ./images/agent/Dockerfile .
  ```

  此镜像构建新的 `agent` 包并将其安装在镜像中。我们在生产发布期间构建最终镜像并发布它。

- 现在，你需要使用最新的 CLI 版本。为此，添加一个别名来使用你刚刚为 CLI 构建的开发版本：

  ```bash
  # 你可以使用 "unalias rover" 删除别名
  alias rover="node $(pwd)/packages/cli/dist/index.js"
  ```

- 最后，你可以使用你的新 agent 创建任务。

  ```bash
  rover task --agent my-agent
  ```

````
