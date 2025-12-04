```markdown
# 项目文件 Schema

Rover 使用本地 JSON 和 YAML 文件维护状态。它不断创建、解析和更新这些文件。我们需要一种可维护的方式在项目中的所有不同工具（CLI 和扩展）之间正确地创建、管理和使用它们。

## 架构

所有 schema 定义、类型和工具都在 `packages/schema` 内部包中定义。其他包如 `cli` 和 `rover-agent` 使用它们来一致地管理这些文件。

每个项目文件（如 `rover.json` 或 `iteration.json`）都有以下关联代码：

- `packages/schemas/src/<name>/schema.js`：使用 Zod v4 库的文件 schema 定义
- `packages/schemas/src/<name>/types.js`：从 Zod 定义推断的 TypeScript 类型
- `packages/schemas/src/<name>/errors.js`：自定义错误类型
- `packages/schemas/src/<name>.js`：用于加载和管理文件的包装类
- `packages/schemas/src/<name>-store.js`：（可选）用于加载和管理相关文件的类。它了解查找它们的位置和文件夹结构。

## 通用属性

所有不同的项目文件都包含一个 `version` 属性。这个 `string` 简化了检测和管理不同版本。格式是 `Major.Minor`。

## 命名约定

我们在以下列表中使用 `workflow` 作为示例：

- 文件名：
  - `packages/schemas/src/workflow/schema.js`
  - `packages/schemas/src/workflow/types.js`
  - `packages/schemas/src/workflow/errors.js`
  - `packages/schemas/src/workflow.js`
  - `packages/schemas/src/workflow-store.js`
- 常量、类型和类名：
  - Zod schema 定义：`<Type>Schema`。例如，`WorkflowSchema` 和 `WorkflowInputTypeSchema`
  - TypeScript 类型：`<Type>`。例如，`Workflow` 和 `WorkflowInputType`
  - 自定义错误：`<Type><Reason>Error`。例如，`WorkflowLoadError` 或 `WorkflowValidationError`
  - 包装类：`<Type>Manager`。例如，`WorkflowManager`
  - 存储类：`<Type>Store`。例如，`WorkflowStore`

## 处理多个版本

我们使用 `version` 属性来识别和更新项目文件。默认情况下，我们自动将文件迁移到较新版本，因此我们确保用户始终拥有最新的兼容版本。为此，我们根据 schema 更改更新版本值：

- `Major`：当有重大重构或与以前版本不兼容时增加
- `Minor`：添加新元素或删除可选/未使用的值。我们可以轻松地从以前的版本迁移到新版本

### 不兼容性

对于不兼容性，我们应该始终增加主版本号并创建单独的 `schema` 和 `types`。我们应该尝试保持单一的包装类和类型，这样我们就可以避免在其余客户端中根据版本进行代码分支。

```
