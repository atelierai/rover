/**
 * Claude CLI Adapter
 *
 * Implements the CliAdapter interface for Claude Code CLI.
 * Handles JSONL parsing, command generation, and state detection
 * specific to Claude Code.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { JsonlMessage } from '../types.js';
import { BaseCliAdapter, CliStartOptions } from './base.js';

/**
 * Claude Code CLI Adapter
 */
export class ClaudeCliAdapter extends BaseCliAdapter {
  readonly name = 'claude' as const;
  readonly binary = 'claude';

  getJsonlDir(taskId: string, workspaceDir?: string): string {
    // In container, use workspace-relative path
    if (workspaceDir) {
      return join(workspaceDir, '.rover', 'sessions', taskId);
    }
    // Default Claude location
    return join(homedir(), '.claude', 'projects');
  }

  getSessionJsonlPath(sessionId: string, baseDir: string): string {
    return join(baseDir, `${sessionId}.jsonl`);
  }

  parseJsonlMessage(line: string): JsonlMessage | null {
    try {
      const entry = JSON.parse(line);

      // Build normalized message
      const message: JsonlMessage = {
        type: this.mapEntryType(entry),
        timestamp: this.parseTimestamp(entry.timestamp),
        sessionId: entry.sessionId || '',
        uuid: entry.uuid,
        parentUuid: entry.parentUuid,
        raw: entry,
      };

      // Parse message content
      if (entry.message) {
        message.message = {
          role: entry.message.role || 'assistant',
          content: entry.message.content,
        };
      }

      // Parse tool use
      if (entry.toolUse || this.hasToolUse(entry)) {
        const toolUse = entry.toolUse || this.extractToolUse(entry);
        if (toolUse) {
          message.toolUse = {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input || {},
          };
        }
      }

      // Parse tool result
      if (entry.toolResult || this.hasToolResult(entry)) {
        const toolResult = entry.toolResult || this.extractToolResult(entry);
        if (toolResult) {
          message.toolResult = {
            id: toolResult.id,
            name: toolResult.name,
            output: toolResult.output || '',
            isError: toolResult.isError,
          };
        }
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

      if (entry.cost !== undefined) {
        message.cost = entry.cost;
      }

      // Parse tokens from modelUsage
      if (entry.modelUsage) {
        const modelKey = Object.keys(entry.modelUsage)[0];
        const usage = entry.modelUsage[modelKey];
        if (usage) {
          message.tokens = {
            input: usage.inputTokens || usage.cumulativeInputTokens,
            output: usage.outputTokens || usage.cumulativeOutputTokens,
            total:
              (usage.inputTokens || 0) +
              (usage.outputTokens || 0) +
              (usage.cacheReadInputTokens || 0) +
              (usage.cacheCreationInputTokens || 0),
          };
        }
      }

      return message;
    } catch {
      return null;
    }
  }

  getStartArgs(options: CliStartOptions): string[] {
    const args: string[] = [];

    // Skip permission prompts for automated use
    if (options.skipPermissions !== false) {
      args.push('--dangerously-skip-permissions');
    }

    // Output format for structured parsing
    args.push('--output-format', 'stream-json');

    // Custom history directory
    if (options.historyDir) {
      args.push('--history-dir', options.historyDir);
    }

    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    // Note: We don't use -p for interactive sessions
    // The prompt is sent via PTY stdin after session starts

    return args;
  }

  getResumeArgs(sessionId: string, options?: CliStartOptions): string[] {
    const args: string[] = ['--resume', sessionId];

    if (options?.skipPermissions !== false) {
      args.push('--dangerously-skip-permissions');
    }

    args.push('--output-format', 'stream-json');

    if (options?.historyDir) {
      args.push('--history-dir', options.historyDir);
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
    // Check parent implementation first
    if (super.isWaitingForInput(message)) {
      return true;
    }

    // Claude-specific patterns
    if (message.type === 'assistant' && message.message?.content) {
      const content = this.extractTextContent(message.message.content);
      const claudeWaitingPhrases = [
        'i\'ve completed',
        'task is complete',
        'finished implementing',
        'ready for review',
        'awaiting your feedback',
      ];

      const lowerContent = content.toLowerCase();
      return claudeWaitingPhrases.some((phrase) => lowerContent.includes(phrase));
    }

    return false;
  }

  isCompleted(message: JsonlMessage): boolean {
    // Check for summary type
    if (message.type === 'summary') {
      return true;
    }

    // Check for result type in raw entry
    const raw = message.raw as Record<string, unknown>;
    if (raw?.type === 'result') {
      return true;
    }

    return super.isCompleted(message);
  }

  isError(message: JsonlMessage): boolean {
    if (super.isError(message)) {
      return true;
    }

    // Check for API error messages
    const raw = message.raw as Record<string, unknown>;
    if (raw?.isApiErrorMessage === true) {
      return true;
    }

    return false;
  }

  getEnvironmentVariables(options?: CliStartOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Disable interactive prompts
    env['CLAUDE_CODE_DISABLE_NONINTERACTIVE_HINTS'] = '1';

    // Set history directory if provided
    if (options?.historyDir) {
      env['CLAUDE_HISTORY_DIR'] = options.historyDir;
    }

    return env;
  }

  getJsonlEnvironment(jsonlDir: string): Record<string, string> {
    return {
      CLAUDE_HISTORY_DIR: jsonlDir,
    };
  }

  // ==================== Private Helper Methods ====================

  private mapEntryType(entry: Record<string, unknown>): JsonlMessage['type'] {
    if (entry.type === 'summary') return 'summary';
    if (entry.type === 'error') return 'error';

    const message = entry.message as Record<string, unknown> | undefined;
    if (message?.role === 'user') return 'user';
    if (message?.role === 'assistant') return 'assistant';

    if (this.hasToolUse(entry)) return 'tool_use';
    if (this.hasToolResult(entry)) return 'tool_result';

    return 'system';
  }

  private hasToolUse(entry: Record<string, unknown>): boolean {
    if (entry.toolUse) return true;

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message?.content) return false;

    const content = message.content;
    if (Array.isArray(content)) {
      return content.some((part: any) => part.type === 'tool_use');
    }

    return false;
  }

  private hasToolResult(entry: Record<string, unknown>): boolean {
    if (entry.toolResult) return true;

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message?.content) return false;

    const content = message.content;
    if (Array.isArray(content)) {
      return content.some((part: any) => part.type === 'tool_result');
    }

    return false;
  }

  private extractToolUse(
    entry: Record<string, unknown>
  ): { id?: string; name: string; input: Record<string, unknown> } | null {
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message?.content || !Array.isArray(message.content)) {
      return null;
    }

    const toolUsePart = (message.content as any[]).find(
      (part) => part.type === 'tool_use'
    );
    if (!toolUsePart) return null;

    return {
      id: toolUsePart.id,
      name: toolUsePart.name,
      input: toolUsePart.input || {},
    };
  }

  private extractToolResult(
    entry: Record<string, unknown>
  ): { id?: string; name: string; output: string; isError?: boolean } | null {
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message?.content || !Array.isArray(message.content)) {
      return null;
    }

    const toolResultPart = (message.content as any[]).find(
      (part) => part.type === 'tool_result'
    );
    if (!toolResultPart) return null;

    return {
      id: toolResultPart.tool_use_id,
      name: toolResultPart.name || '',
      output: toolResultPart.content || '',
      isError: toolResultPart.is_error,
    };
  }
}
