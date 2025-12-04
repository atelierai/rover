/**
 * Decision Engine
 *
 * Makes decisions about whether a task is complete or needs to continue.
 * Uses stateless CLI calls to evaluate the current state and determine
 * the next action.
 */

import { launch } from 'rover-common';
import type {
  AgentType,
  DecisionContext,
  DecisionEngine,
  DecisionResult,
} from './types.js';

/**
 * Configuration for the decision engine
 */
export interface DecisionEngineConfig {
  /** Agent to use for decision making */
  agent: AgentType;
  /** Maximum tokens for decision response */
  maxTokens?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Default decision engine implementation
 */
export class DefaultDecisionEngine implements DecisionEngine {
  private readonly config: Required<DecisionEngineConfig>;

  constructor(config?: Partial<DecisionEngineConfig>) {
    this.config = {
      agent: config?.agent ?? 'claude',
      maxTokens: config?.maxTokens ?? 1024,
      timeout: config?.timeout ?? 60000,
      verbose: config?.verbose ?? false,
    };
  }

  /**
   * Make a decision based on the current context
   */
  async makeDecision(context: DecisionContext): Promise<DecisionResult> {
    const prompt = this.buildDecisionPrompt(context);

    if (this.config.verbose) {
      console.log('[Decision] Making decision with prompt:');
      console.log(prompt);
    }

    try {
      const result = await this.callAgent(prompt);

      if (this.config.verbose) {
        console.log('[Decision] Raw result:', result);
      }

      return this.parseDecisionResult(result);
    } catch (error) {
      console.error('[Decision] Error making decision:', error);
      return {
        status: 'needs_attention',
        reason: `Decision engine error: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Build the decision prompt
   */
  private buildDecisionPrompt(context: DecisionContext): string {
    const previousCommandsSection = context.previousCommands?.length
      ? `
之前发送的指令：
${context.previousCommands.map((c, i) => `${i + 1}. ${c}`).join('\n')}
`
      : '';

    return `你是 Rover 的任务决策器。根据当前任务描述和 Code CLI 的最新输出，判断下一步操作。

## 任务信息

**标题**: ${context.taskTitle}
**描述**: ${context.taskDescription}

## 工作流上下文

- **分支**: ${context.branch}
- **迭代**: ${context.iteration}

## CLI 最新输出

\`\`\`
${context.latestCliOutput.slice(-4000)}
\`\`\`
${previousCommandsSection}

## 判断规则

1. **任务完成** - 如果任务的所有需求已经满足（代码已实现、测试通过、文档更新等），返回：
   \`{"status": "complete", "summary": "简要说明完成了什么"}\`

2. **需要继续** - 如果任务尚未完成但 CLI 在等待输入，返回：
   \`{"status": "continue", "next_command": "下一条指令或 /continue"}\`

3. **需要关注** - 如果遇到以下情况，返回：
   - 错误无法自动恢复
   - CLI 陷入循环
   - 需要人工决策
   \`{"status": "needs_attention", "reason": "具体原因"}\`

## 注意事项

- 只返回 JSON，不要有其他文字
- next_command 应该是具体的指令，可以是 /continue 或者更具体的任务说明
- 如果 CLI 输出表明任务已完成（如 "所有需求已实现"），应返回 complete
- 如果 CLI 正在等待输入且任务未完成，应返回 continue

请分析上述信息并返回 JSON 决策结果：`;
  }

  /**
   * Call the agent CLI to get decision
   */
  private async callAgent(prompt: string): Promise<string> {
    const binary = this.getAgentBinary();
    const args = this.getAgentArgs();

    const result = await launch(binary, args, {
      input: prompt,
      timeout: this.config.timeout,
      reject: false,
    });

    if (result.exitCode !== 0) {
      const stderr = result.stderr?.toString() || '';
      throw new Error(`Agent call failed (exit ${result.exitCode}): ${stderr}`);
    }

    return result.stdout?.toString() || '';
  }

  /**
   * Get the binary name for the decision agent
   */
  private getAgentBinary(): string {
    switch (this.config.agent) {
      case 'claude':
        return 'claude';
      case 'codex':
        return 'codex';
      case 'gemini':
        return 'gemini';
      case 'qwen':
        return 'qwen';
      default:
        return 'claude';
    }
  }

  /**
   * Get CLI arguments for the decision agent
   */
  private getAgentArgs(): string[] {
    switch (this.config.agent) {
      case 'claude':
        return [
          '--dangerously-skip-permissions',
          '--output-format',
          'json',
          '-p',
        ];
      case 'codex':
        return [
          'exec',
          '--dangerously-bypass-approvals-and-sandbox',
          '--output-last-message',
          '-',
        ];
      case 'gemini':
        return ['--yolo', '--output-format', 'json'];
      case 'qwen':
        return ['--yolo', '-p'];
      default:
        return ['-p'];
    }
  }

  /**
   * Parse the decision result from agent output
   */
  private parseDecisionResult(output: string): DecisionResult {
    // Try to extract JSON from the output
    const jsonPatterns = [
      // Direct JSON
      /^\s*(\{[\s\S]*\})\s*$/,
      // JSON in code block
      /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,
      // JSON anywhere in output
      /(\{[^{}]*"status"\s*:\s*"(?:complete|continue|needs_attention)"[^{}]*\})/,
    ];

    for (const pattern of jsonPatterns) {
      const match = output.match(pattern);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          return this.validateDecisionResult(parsed);
        } catch {
          // Try next pattern
        }
      }
    }

    // Try to parse Claude's JSON output format
    try {
      const parsed = JSON.parse(output);
      // Claude returns { result: "..." } format
      if (parsed.result) {
        const innerResult = JSON.parse(parsed.result);
        return this.validateDecisionResult(innerResult);
      }
      return this.validateDecisionResult(parsed);
    } catch {
      // Failed to parse
    }

    // Fallback: analyze output text
    return this.analyzeOutputFallback(output);
  }

  /**
   * Validate and normalize decision result
   */
  private validateDecisionResult(parsed: unknown): DecisionResult {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid decision result format');
    }

    const result = parsed as Record<string, unknown>;
    const status = result.status as string;

    if (!['complete', 'continue', 'needs_attention'].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    return {
      status: status as DecisionResult['status'],
      summary: typeof result.summary === 'string' ? result.summary : undefined,
      nextCommand:
        typeof result.next_command === 'string'
          ? result.next_command
          : typeof result.nextCommand === 'string'
            ? result.nextCommand
            : undefined,
      reason: typeof result.reason === 'string' ? result.reason : undefined,
    };
  }

  /**
   * Fallback analysis when JSON parsing fails
   */
  private analyzeOutputFallback(output: string): DecisionResult {
    const lower = output.toLowerCase();

    // Check for completion indicators
    const completionPhrases = [
      'task is complete',
      'all requirements met',
      'successfully implemented',
      'no further action',
      '任务已完成',
      '所有需求已满足',
    ];

    if (completionPhrases.some((phrase) => lower.includes(phrase))) {
      return {
        status: 'complete',
        summary: 'Task appears to be complete based on analysis',
      };
    }

    // Check for error indicators
    const errorPhrases = [
      'error',
      'failed',
      'cannot proceed',
      'stuck',
      'loop detected',
      '错误',
      '失败',
    ];

    if (errorPhrases.some((phrase) => lower.includes(phrase))) {
      return {
        status: 'needs_attention',
        reason: 'Potential error or blocker detected in output',
      };
    }

    // Default to continue
    return {
      status: 'continue',
      nextCommand: '/continue',
    };
  }
}

/**
 * Create a decision engine with the specified configuration
 */
export function createDecisionEngine(
  config?: Partial<DecisionEngineConfig>
): DecisionEngine {
  return new DefaultDecisionEngine(config);
}
