/**
 * Codex CLI Adapter
 *
 * Implements the CliAdapter interface for OpenAI Codex CLI.
 * Handles JSONL parsing, command generation, and state detection
 * specific to Codex.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { JsonlMessage } from '../types.js';
import { BaseCliAdapter, CliStartOptions } from './base.js';

/**
 * Codex CLI Adapter
 */
export class CodexCliAdapter extends BaseCliAdapter {
  readonly name = 'codex' as const;
  readonly binary = 'codex';

  getJsonlDir(taskId: string, workspaceDir?: string): string {
    // In container, use workspace-relative path
    if (workspaceDir) {
      return join(workspaceDir, '.rover', 'sessions', taskId);
    }
    // Default Codex location
    return join(homedir(), '.codex', 'sessions');
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
        timestamp: this.parseTimestamp(entry.timestamp || entry.created_at),
        sessionId: entry.session_id || entry.sessionId || '',
        uuid: entry.id || entry.uuid,
        raw: entry,
      };

      // Parse message content
      if (entry.role && entry.content) {
        message.message = {
          role: entry.role,
          content: entry.content,
        };
      } else if (entry.message) {
        message.message = {
          role: entry.message.role || 'assistant',
          content: entry.message.content,
        };
      }

      // Parse function/tool calls (Codex uses function calling)
      if (entry.function_call) {
        message.toolUse = {
          name: entry.function_call.name,
          input: this.parseJsonSafe(entry.function_call.arguments) || {},
        };
      }

      // Parse tool calls (newer format)
      if (entry.tool_calls && Array.isArray(entry.tool_calls)) {
        const firstTool = entry.tool_calls[0];
        if (firstTool?.function) {
          message.toolUse = {
            id: firstTool.id,
            name: firstTool.function.name,
            input: this.parseJsonSafe(firstTool.function.arguments) || {},
          };
        }
      }

      // Parse working directory
      if (entry.cwd || entry.working_directory) {
        message.cwd = entry.cwd || entry.working_directory;
      }

      // Parse model
      if (entry.model) {
        message.model = entry.model;
      }

      // Parse usage/tokens
      if (entry.usage) {
        message.tokens = {
          input: entry.usage.prompt_tokens,
          output: entry.usage.completion_tokens,
          total: entry.usage.total_tokens,
        };
      }

      return message;
    } catch {
      return null;
    }
  }

  getStartArgs(options: CliStartOptions): string[] {
    const args: string[] = ['chat'];

    // Skip approval prompts
    args.push('--dangerously-bypass-approvals-and-sandbox');

    // Skip git repo check for containerized environments
    args.push('--skip-git-repo-check');

    // Session management
    if (options.sessionId) {
      args.push('--session', options.sessionId);
    }

    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    return args;
  }

  getResumeArgs(sessionId: string, options?: CliStartOptions): string[] {
    const args: string[] = [
      'chat',
      '--session',
      sessionId,
      '--dangerously-bypass-approvals-and-sandbox',
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
    return '/exit';
  }

  getClearCommand(): string | null {
    return '/clear';
  }

  isWaitingForInput(message: JsonlMessage): boolean {
    // Check parent implementation
    if (super.isWaitingForInput(message)) {
      return true;
    }

    // Codex-specific patterns
    if (message.type === 'assistant' && message.message?.content) {
      const content = this.extractTextContent(message.message.content);
      const codexWaitingPhrases = [
        'changes have been applied',
        'implementation complete',
        'ready for testing',
        'what else',
      ];

      const lowerContent = content.toLowerCase();
      return codexWaitingPhrases.some((phrase) => lowerContent.includes(phrase));
    }

    return false;
  }

  isCompleted(message: JsonlMessage): boolean {
    if (super.isCompleted(message)) {
      return true;
    }

    // Check for finish_reason in raw entry
    const raw = message.raw as Record<string, unknown>;
    if (raw?.finish_reason === 'stop') {
      return true;
    }

    return false;
  }

  isAuthenticationRequired(output: string): boolean {
    if (super.isAuthenticationRequired(output)) {
      return true;
    }

    // Codex-specific auth patterns
    const codexAuthPatterns = [
      /openai api key/i,
      /OPENAI_API_KEY/,
      /please set.*api.*key/i,
    ];

    return codexAuthPatterns.some((pattern) => pattern.test(output));
  }

  getEnvironmentVariables(options?: CliStartOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Set state directory if history dir is provided
    if (options?.historyDir) {
      env['CODEX_STATE_DIR'] = options.historyDir;
    }

    return env;
  }

  getJsonlEnvironment(jsonlDir: string): Record<string, string> {
    return {
      CODEX_STATE_DIR: jsonlDir,
    };
  }

  // ==================== Private Helper Methods ====================

  private mapEntryType(entry: Record<string, unknown>): JsonlMessage['type'] {
    if (entry.error) return 'error';

    const role = entry.role as string | undefined;
    if (role === 'user') return 'user';
    if (role === 'assistant') return 'assistant';
    if (role === 'system') return 'system';
    if (role === 'function' || role === 'tool') return 'tool_result';

    if (entry.function_call || entry.tool_calls) return 'tool_use';

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
