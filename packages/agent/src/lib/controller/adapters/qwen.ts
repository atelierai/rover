/**
 * Qwen CLI Adapter
 *
 * Implements the CliAdapter interface for Alibaba Qwen Code CLI.
 * Qwen CLI shares similar architecture with Gemini CLI (Seatbelt-based).
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { JsonlMessage } from '../types.js';
import { BaseCliAdapter, CliStartOptions } from './base.js';

/**
 * Qwen CLI Adapter
 */
export class QwenCliAdapter extends BaseCliAdapter {
  readonly name = 'qwen' as const;
  readonly binary = 'qwen';

  getJsonlDir(taskId: string, workspaceDir?: string): string {
    // In container, use workspace-relative path
    if (workspaceDir) {
      return join(workspaceDir, '.rover', 'sessions', taskId);
    }
    // Default Qwen location
    return join(homedir(), '.qwen', 'projects');
  }

  getSessionJsonlPath(sessionId: string, baseDir: string): string {
    return join(baseDir, `${sessionId}.jsonl`);
  }

  parseJsonlMessage(line: string): JsonlMessage | null {
    try {
      const entry = JSON.parse(line);

      // Build normalized message (similar to Gemini)
      const message: JsonlMessage = {
        type: this.mapEntryType(entry),
        timestamp: this.parseTimestamp(entry.timestamp),
        sessionId: entry.sessionId || entry.session_id || '',
        uuid: entry.uuid || entry.id,
        parentUuid: entry.parentUuid || entry.parent_id,
        raw: entry,
      };

      // Parse message content
      if (entry.message) {
        message.message = {
          role: entry.message.role || 'assistant',
          content: entry.message.content,
        };
      } else if (entry.content) {
        message.message = {
          role: entry.role || 'assistant',
          content: entry.content,
        };
      }

      // Parse tool use
      if (entry.function_call || entry.toolUse) {
        const toolCall = entry.function_call || entry.toolUse;
        message.toolUse = {
          id: toolCall.id,
          name: toolCall.name,
          input: typeof toolCall.args === 'string'
            ? this.parseJsonSafe(toolCall.args) || {}
            : toolCall.args || toolCall.input || {},
        };
      }

      // Parse tool result
      if (entry.function_response || entry.toolResult) {
        const toolResult = entry.function_response || entry.toolResult;
        message.toolResult = {
          id: toolResult.id,
          name: toolResult.name || '',
          output: typeof toolResult.response === 'string'
            ? toolResult.response
            : JSON.stringify(toolResult.response || toolResult.output || ''),
          isError: toolResult.isError || toolResult.is_error,
        };
      }

      // Parse summary
      if (entry.type === 'summary' && entry.summary) {
        message.summary = entry.summary;
      }

      // Parse metadata
      if (entry.cwd) {
        message.cwd = entry.cwd;
      }

      if (entry.model) {
        message.model = entry.model;
      }

      // Parse tokens
      if (entry.usage) {
        message.tokens = {
          input: entry.usage.input_tokens || entry.usage.prompt_tokens,
          output: entry.usage.output_tokens || entry.usage.completion_tokens,
          total: entry.usage.total_tokens,
        };
      }

      return message;
    } catch {
      return null;
    }
  }

  getStartArgs(options: CliStartOptions): string[] {
    const args: string[] = [];

    // YOLO mode for automated execution
    args.push('--yolo');

    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    // Qwen still supports -p for prompt input (unlike deprecated in Gemini)
    // But for interactive mode, we don't use it

    return args;
  }

  getResumeArgs(sessionId: string, options?: CliStartOptions): string[] {
    const args: string[] = [
      '--resume',
      sessionId,
      '--yolo',
    ];

    if (options?.model) {
      args.push('--model', options.model);
    }

    return args;
  }

  getContinueCommand(): string {
    return '/continue';
  }

  getStopCommand(): string {
    return '/stop';
  }

  getClearCommand(): string | null {
    return '/clear';
  }

  isWaitingForInput(message: JsonlMessage): boolean {
    if (super.isWaitingForInput(message)) {
      return true;
    }

    // Qwen-specific patterns
    if (message.type === 'assistant' && message.message?.content) {
      const content = this.extractTextContent(message.message.content);
      const qwenWaitingPhrases = [
        '已完成',
        'completed',
        'finished',
        '还有什么',
        'anything else',
      ];

      const lowerContent = content.toLowerCase();
      return qwenWaitingPhrases.some((phrase) =>
        lowerContent.includes(phrase.toLowerCase())
      );
    }

    return false;
  }

  isAuthenticationRequired(output: string): boolean {
    if (super.isAuthenticationRequired(output)) {
      return true;
    }

    // Qwen-specific auth patterns
    const qwenAuthPatterns = [
      /dashscope.*api.*key/i,
      /DASHSCOPE_API_KEY/,
      /alibaba.*auth/i,
      /qwen.*authentication/i,
    ];

    return qwenAuthPatterns.some((pattern) => pattern.test(output));
  }

  getEnvironmentVariables(options?: CliStartOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Project path for session management
    if (options?.historyDir) {
      env['CODE_ASSIST_PROJECT_PATH'] = options.historyDir;
    }

    return env;
  }

  getJsonlEnvironment(jsonlDir: string): Record<string, string> {
    return {
      CODE_ASSIST_PROJECT_PATH: jsonlDir,
      QWEN_HISTORY_DIR: jsonlDir,
    };
  }

  // ==================== Private Helper Methods ====================

  private mapEntryType(entry: Record<string, unknown>): JsonlMessage['type'] {
    if (entry.type === 'summary') return 'summary';
    if (entry.type === 'error' || entry.error) return 'error';

    const role = entry.role as string | undefined;
    if (role === 'user') return 'user';
    if (role === 'assistant') return 'assistant';

    if (entry.function_call || entry.toolUse) return 'tool_use';
    if (entry.function_response || entry.toolResult) return 'tool_result';

    // Check message.role
    const message = entry.message as Record<string, unknown> | undefined;
    if (message?.role === 'user') return 'user';
    if (message?.role === 'assistant') return 'assistant';

    return 'system';
  }

  private parseJsonSafe(value: unknown): Record<string, unknown> | null {
    if (!value) return null;

    if (typeof value === 'object') {
      return value as Record<string, unknown>;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }

    return null;
  }
}
