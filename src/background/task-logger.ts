/**
 * Task Logger
 *
 * Logs task execution to storage for history and analytics.
 * (Phase 2.2: Enhanced to store detailed step information)
 */

import { addTaskToHistory, type TaskHistoryEntry, type DetailedStep } from '../shared/storage';

// ============================================================================
// Types
// ============================================================================

interface TaskLogData {
  description: string;
  modelId: string;
  visionMode: boolean;
  startTime: number;
  endTime?: number;
  steps: number;
  llmCalls: number;
  success: boolean;
  result?: string;
  error?: string;
  // Phase 2.2: Detailed tracking
  detailedSteps: DetailedStep[];
  planSteps?: string[];
  currentStep?: {
    number: number;
    action: string;
    params: Record<string, string>;
    reasoning?: string;
    stateDetected?: string;
    confidence?: number;
    startTime: number;
  };
}

// ============================================================================
// Task Logger
// ============================================================================

export class TaskLogger {
  private currentTask: TaskLogData | null = null;
  private stepCount: number = 0;
  private llmCallCount: number = 0;

  /**
   * Start logging a new task
   */
  startTask(description: string, modelId: string, visionMode: boolean): void {
    this.currentTask = {
      description,
      modelId,
      visionMode,
      startTime: Date.now(),
      steps: 0,
      llmCalls: 0,
      success: false,
      detailedSteps: [], // Phase 2.2
    };

    this.stepCount = 0;
    this.llmCallCount = 0;

    console.log('[TaskLogger] Started logging task:', description);
  }

  /**
   * Record a step execution
   */
  recordStep(): void {
    if (this.currentTask) {
      this.stepCount++;
      this.currentTask.steps = this.stepCount;
    }
  }

  /**
   * Record an LLM call
   */
  recordLLMCall(): void {
    if (this.currentTask) {
      this.llmCallCount++;
      this.currentTask.llmCalls = this.llmCallCount;
    }
  }

  /**
   * Record the high-level plan (Phase 2.2)
   */
  recordPlan(planSteps: string[]): void {
    if (this.currentTask) {
      this.currentTask.planSteps = planSteps;
    }
  }

  /**
   * Start a new step with action details (Phase 2.2)
   */
  startStep(
    action: string,
    params: Record<string, string>,
    reasoning?: string,
    stateDetected?: string,
    confidence?: number
  ): void {
    if (this.currentTask) {
      this.currentTask.currentStep = {
        number: this.stepCount + 1,
        action,
        params,
        reasoning,
        stateDetected,
        confidence,
        startTime: Date.now(),
      };
    }
  }

  /**
   * Complete the current step with result (Phase 2.2)
   */
  completeStep(success: boolean, data?: string): void {
    if (!this.currentTask || !this.currentTask.currentStep) return;

    const step = this.currentTask.currentStep;
    const endTime = Date.now();
    const duration = endTime - step.startTime;

    const detailedStep: DetailedStep = {
      number: step.number,
      action: step.action,
      params: step.params,
      status: success ? 'success' : 'failed',
      reasoning: step.reasoning,
      stateDetected: step.stateDetected,
      confidence: step.confidence,
      timestamp: step.startTime,
      duration,
    };

    if (success && data) {
      detailedStep.result = data.slice(0, 200); // Truncate long results
    } else if (!success) {
      detailedStep.error = data;
    }

    this.currentTask.detailedSteps.push(detailedStep);
    this.currentTask.currentStep = undefined;
  }

  /**
   * End the task with success
   */
  async endTaskSuccess(result: string): Promise<void> {
    if (!this.currentTask) {
      console.warn('[TaskLogger] No active task to end');
      return;
    }

    this.currentTask.endTime = Date.now();
    this.currentTask.success = true;
    this.currentTask.result = result;

    await this.saveTask();
  }

  /**
   * End the task with failure
   */
  async endTaskFailure(error: string): Promise<void> {
    if (!this.currentTask) {
      console.warn('[TaskLogger] No active task to end');
      return;
    }

    this.currentTask.endTime = Date.now();
    this.currentTask.success = false;
    this.currentTask.error = error;

    await this.saveTask();
  }

  /**
   * Cancel the current task (don't save to history)
   */
  cancelTask(): void {
    if (this.currentTask) {
      console.log('[TaskLogger] Cancelled task:', this.currentTask.description);
      this.currentTask = null;
      this.stepCount = 0;
      this.llmCallCount = 0;
    }
  }

  /**
   * Get the current task data (for debugging)
   */
  getCurrentTask(): TaskLogData | null {
    return this.currentTask;
  }

  /**
   * Save the task to history
   */
  private async saveTask(): Promise<void> {
    if (!this.currentTask) return;

    const duration = this.currentTask.endTime
      ? this.currentTask.endTime - this.currentTask.startTime
      : 0;

    const historyEntry: Omit<TaskHistoryEntry, 'id'> = {
      description: this.currentTask.description,
      modelId: this.currentTask.modelId,
      visionMode: this.currentTask.visionMode,
      steps: this.currentTask.steps,
      llmCalls: this.currentTask.llmCalls,
      duration,
      success: this.currentTask.success,
      result: this.currentTask.result,
      error: this.currentTask.error,
      timestamp: this.currentTask.startTime,
      // Phase 2.2: Include detailed information
      detailedSteps: this.currentTask.detailedSteps,
      planSteps: this.currentTask.planSteps,
    };

    try {
      await addTaskToHistory(historyEntry);
      console.log('[TaskLogger] Saved task to history:', {
        description: historyEntry.description,
        duration: `${duration}ms`,
        steps: historyEntry.steps,
        llmCalls: historyEntry.llmCalls,
        success: historyEntry.success,
      });
    } catch (error) {
      console.error('[TaskLogger] Failed to save task to history:', error);
    }

    // Reset state
    this.currentTask = null;
    this.stepCount = 0;
    this.llmCallCount = 0;
  }
}

// Export singleton instance
export const taskLogger = new TaskLogger();
