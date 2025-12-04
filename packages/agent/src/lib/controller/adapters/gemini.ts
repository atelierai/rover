/**
 * Gemini CLI Adapter
 *
 * Implements the CliAdapter interface for Google Gemini CLI.
 * Handles JSONL parsing, command generation, and state detection
 * specific to Gemini.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { JsonlMessage } from '../types.js';
import { BaseCliAdapter, CliStartOptions } from './base.js';

/**
 * Gemini CLI Adapter
 */
export class GeminiCliAdapter extends BaseCliAdapter {
  readonly name = 'gemini' as const;
  readonly binary = 'gemini';

  getJsonlDir(taskId: string, workspaceDir?: string): string {
    // In container, use workspace-relative path
    if (workspaceDir) {
      return join(workspaceDir, '.rover', 'sessions', taskId);
    }
    // Default Gemini location - uses encoded project path
    return join(homedir(), '.gemini', 'projects');
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

      // Parse tool use (Gemini uses function_call)
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
      if (entry.usageMetadata) {
        message.tokens = {
          input: entry.usageMetadata.promptTokenCount,
          output: entry.usageMetadata.candidatesTokenCount,
          total: entry.usageMetadata.totalTokenCount,
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

    // Sandbox mode
    args.push('--sandbox');

    // Output format
    args.push('--output-format', 'json');

    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    // Note: Gemini uses project path for session management
    // The --project flag or CODE_ASSIST_PROJECT_PATH env var

    return args;
  }

  getResumeArgs(sessionId: string, options?: CliStartOptions): string[] {
    const args: string[] = [
      '--resume',
      sessionId,
      '--yolo',
      '--sandbox',
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

    // Gemini-specific patterns
    if (message.type === 'assistant' && message.message?.content) {
      const content = this.extractTextContent(message.message.content);
      const geminiWaitingPhrases = [
        'changes applied successfully',
        'task completed',
        'anything else',
        'further assistance',
      ];

      const lowerContent = content.toLowerCase();
      return geminiWaitingPhrases.some((phrase) => lowerContent.includes(phrase));
    }

    return false;
  }

  isAuthenticationRequired(output: string): boolean {
    if (super.isAuthenticationRequired(output)) {
      return true;
    }

    // Gemini-specific auth patterns
    const geminiAuthPatterns = [
      /google.*authentication/i,
      /gcloud.*auth/i,
      /GOOGLE_API_KEY/,
      /GEMINI_API_KEY/,
      /oauth.*consent/i,
    ];

    return geminiAuthPatterns.some((pattern) => pattern.test(output));
  }

  getEnvironmentVariables(options?: CliStartOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Sandbox mode
    env['GEMINI_SANDBOX'] = 'true';

    // Project path for session management
    if (options?.historyDir) {
      env['CODE_ASSIST_PROJECT_PATH'] = options.historyDir;
    }

    return env;
  }

  getJsonlEnvironment(jsonlDir: string): Record<string, string> {
    return {
      CODE_ASSIST_PROJECT_PATH: jsonlDir,
      GEMINI_HISTORY_DIR: jsonlDir,
    };
  }

  // ==================== Private Helper Methods ====================

  private mapEntryType(entry: Record<string, unknown>): JsonlMessage['type'] {
    if (entry.type === 'summary') return 'summary';
    if (entry.type === 'error' || entry.error) return 'error';

    const role = entry.role as string | undefined;
    if (role === 'user') return 'user';
    if (role === 'model' || role === 'assistant') return 'assistant';

    if (entry.function_call || entry.toolUse) return 'tool_use';
    if (entry.function_response || entry.toolResult) return 'tool_result';

    // Check message.role
    const message = entry.message as Record<string, unknown> | undefined;
    if (message?.role === 'user') return 'user';
    if (message?.role === 'model' || message?.role === 'assistant') return 'assistant';

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
