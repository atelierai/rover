import { ProcessManager } from 'rover-common';

import { TaskDescriptionManager } from 'rover-schemas';

export abstract class SandboxPackage {
  abstract name: string;

  abstract installScript(): string;
  abstract initScript(): string;
}

/**
 * Sandbox execution mode
 * - workflow: Run automated SWE workflow (default)
 * - manual: Run CLI Controller for interactive session
 */
export type SandboxMode = 'workflow' | 'manual';

/**
 * Options for starting a sandbox
 */
export interface SandboxStartOptions {
  /** Execution mode: workflow (default) or manual */
  mode?: SandboxMode;
  /** Session ID for manual mode resumption */
  sessionId?: string;
  /** Initial prompt to send when starting manual mode */
  initialPrompt?: string;
}

export abstract class Sandbox {
  abstract backend: string;

  processManager?: ProcessManager;
  task: TaskDescriptionManager;
  protected startOptions?: SandboxStartOptions;

  constructor(task: TaskDescriptionManager, processManager?: ProcessManager) {
    this.task = task;
    this.processManager = processManager;
  }

  /**
   * Get the current sandbox mode
   */
  get mode(): SandboxMode {
    return this.startOptions?.mode ?? 'workflow';
  }

  abstract isBackendAvailable(): Promise<boolean>;
  abstract openShellAtWorktree(): Promise<void>;
  protected abstract create(): Promise<string>;
  protected abstract start(): Promise<string>;
  protected abstract remove(): Promise<string>;
  protected abstract stop(): Promise<string>;
  protected abstract logs(): Promise<string>;
  protected abstract followLogs(): AsyncIterable<string>;

  protected get sandboxName(): string {
    const modePrefix = this.mode === 'manual' ? 'manual' : 'task';
    return `rover-${modePrefix}-${this.task.id}-${this.task.iterations}`;
  }

  async createAndStart(options?: SandboxStartOptions): Promise<string> {
    // Store options for use in create()
    this.startOptions = options;

    const modeLabel = this.mode === 'manual' ? 'Manual Mode' : 'Workflow Mode';
    let sandboxId = '';
    this.processManager?.addItem(
      `Prepare sandbox (${this.backend} - ${modeLabel}) | Name: ${this.sandboxName}`
    );
    try {
      sandboxId = await this.create();
      this.processManager?.completeLastItem();
      this.processManager?.addItem(
        `Start sandbox (${this.backend}) | Name: ${this.sandboxName}`
      );
      await this.start();
      this.processManager?.completeLastItem();
    } catch (err) {
      this.processManager?.failLastItem();
      this.processManager?.finish();
      throw err;
    }
    this.processManager?.finish();
    return sandboxId;
  }

  async stopAndRemove(): Promise<string> {
    let sandboxId = '';
    this.processManager?.addItem(
      `Stopping sandbox (${this.backend}) | Name: ${this.sandboxName}`
    );
    try {
      sandboxId = await this.stop();
      this.processManager?.completeLastItem();
    } catch (_err: any) {
      this.processManager?.failLastItem();
    } finally {
      this.processManager?.finish();
    }

    this.processManager?.addItem(
      `Removing sandbox (${this.backend}) | Name: ${this.sandboxName}`
    );

    try {
      sandboxId = await this.remove();
      this.processManager?.completeLastItem();
    } catch (_err: any) {
      this.processManager?.failLastItem();
    } finally {
      this.processManager?.finish();
    }

    return sandboxId;
  }
}
