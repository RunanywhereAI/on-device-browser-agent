/**
 * Executor / Orchestrator
 *
 * Coordinates the Planner and Navigator agents to execute tasks.
 * Manages:
 * - Agent lifecycle and initialization
 * - Task execution loop
 * - Error recovery and replanning
 * - Event emission for UI updates
 * - Obstacle detection and pause/resume
 * - Amazon state machine integration
 */

import { PlannerAgent } from './planner-agent';
import { NavigatorAgent } from './navigator-agent';
import { siteRouter } from './site-router';
import { changeObserver } from './change-observer';
import { detectObstacle, getObstacleMessage, type DetectedObstacle } from './obstacle-detector';
import { llmEngine } from '../llm-engine';
import { taskLogger } from '../task-logger';
import type {
  AgentContext,
  DOMState,
  ActionResult,
  AgentStep,
  ExecutorEvent,
  NavigatorOutput,
} from '../../shared/types';
import { MAX_STEPS, MAX_REPLANS, MAX_LLM_CALLS_PER_TASK } from '../../shared/constants';

// ============================================================================
// Types
// ============================================================================

type GetDOMStateFn = () => Promise<DOMState>;
type ExecuteActionFn = (actionType: string, params: Record<string, string>) => Promise<ActionResult>;
type EventListener = (event: ExecutorEvent) => void;

// ============================================================================
// Executor
// ============================================================================

export class Executor {
  private planner = new PlannerAgent();
  private navigator = new NavigatorAgent();
  private context: AgentContext | null = null;
  private eventListeners: Set<EventListener> = new Set();
  private isRunning = false;
  private shouldCancel = false;
  private isPaused = false;
  private pauseResolver: (() => void) | null = null;
  private currentObstacle: DetectedObstacle | null = null;
  private searchQuery: string = '';
  private llmCallsRemaining: number = MAX_LLM_CALLS_PER_TASK;

  /**
   * Execute a task from start to finish
   * @param task - Natural language task description
   * @param getDOMState - Function to get current DOM state from content script
   * @param executeAction - Function to execute actions in the browser
   * @param modelId - Optional model ID to use for LLM inference
   */
  async executeTask(
    task: string,
    getDOMState: GetDOMStateFn,
    executeAction: ExecuteActionFn,
    modelId?: string
  ): Promise<string> {
    if (this.isRunning) {
      throw new Error('Executor is already running a task');
    }

    this.isRunning = true;
    this.shouldCancel = false;
    this.isPaused = false;
    this.currentObstacle = null;
    this.llmCallsRemaining = MAX_LLM_CALLS_PER_TASK;

    // Extract search query from task (no LLM needed)
    this.searchQuery = this.extractSearchQuery(task);
    console.log(`[Executor] Extracted search query: "${this.searchQuery}"`);

    // Initialize site router for state machine routing
    siteRouter.initialize(task);
    console.log(`[Executor] Site router initialized, can handle: ${siteRouter.canHandle(task, '')}`)

    // Start task logging
    taskLogger.startTask(task, modelId || 'default', false);

    try {
      // Phase 1: Initialize LLM
      this.emit({ type: 'INIT_START' });

      const unsubscribe = llmEngine.onProgress((progress) => {
        // Get additional state info (phase, text) from engine
        const state = llmEngine.getState();
        this.emit({
          type: 'INIT_PROGRESS',
          progress,
          phase: state.phase,
          text: state.progressText,
        });
      });

      try {
        await llmEngine.initialize(modelId);
        unsubscribe();
        this.emit({ type: 'INIT_COMPLETE' });
      } catch (error) {
        unsubscribe();
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.emit({ type: 'TASK_FAILED', error: `LLM initialization failed: ${errorMsg}` });
        throw error;
      }

      // VLM removed from hot path - only used for error recovery

      // Phase 2: Initialize context (skip LLM planning for state-machine tasks)
      this.context = {
        task,
        history: [],
      };

      this.emit({ type: 'PLAN_START' });

      // Skip LLM planning if state machine can handle (most tasks)
      const canUseStateMachine = siteRouter.canHandle(task, '');
      if (canUseStateMachine) {
        console.log('[Executor] Using state machine - skipping LLM planning');
        this.context.plan = {
          current_state: {
            analysis: 'State machine driven task',
            memory: [],
          },
          plan: {
            thought: 'Using deterministic state machine',
            steps: ['Execute via state machine'],
            success_criteria: 'Task completed successfully',
          },
        };
        this.emit({ type: 'PLAN_COMPLETE', plan: ['State machine execution'] });
      } else {
        // Only use LLM planning for tasks without state machines
        try {
          this.context.plan = await this.planner.createPlan(task);
          this.llmCallsRemaining--; // Count this LLM call
          taskLogger.recordLLMCall();

          // Validate plan structure
          const steps = this.context.plan?.plan?.steps;
          if (!steps || !Array.isArray(steps) || steps.length === 0) {
            console.warn('[Executor] Plan missing steps, using fallback');
            this.context.plan = {
              current_state: {
                analysis: 'Task analysis',
                memory: [],
              },
              plan: {
                thought: 'Executing task directly',
                steps: ['Analyze the current page', 'Complete the requested task'],
                success_criteria: 'Task completed successfully',
              },
            };
          }

          this.emit({ type: 'PLAN_COMPLETE', plan: this.context.plan.plan.steps });
          console.log('[Executor] Plan created:', this.context.plan.plan.steps);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.emit({ type: 'TASK_FAILED', error: `Planning failed: ${errorMsg}` });
          throw error;
        }
      }

      // Phase 3: Execution loop
      let replans = 0;
      let consecutiveFailures = 0;
      let lastActionSignature = '';
      let sameActionCount = 0;

      for (let step = 0; step < MAX_STEPS; step++) {
        if (this.shouldCancel) {
          taskLogger.cancelTask();
          throw new Error('Task cancelled by user');
        }

        this.emit({ type: 'STEP_START', stepNumber: step + 1 });
        taskLogger.recordStep();

        // Get current DOM state
        let domState: DOMState;
        try {
          domState = await getDOMState();
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[Executor] Failed to get DOM state:', errorMsg);

          // Get tab info to determine if we're on a restricted page
          let tabUrl = 'unknown';
          let tabTitle = 'Unknown page';
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
              tabUrl = tab.url || 'unknown';
              tabTitle = tab.title || 'Unknown';
            }
          } catch {}

          // Provide context about why DOM state failed
          const isRestricted = tabUrl.startsWith('chrome://') ||
                               tabUrl.startsWith('chrome-extension://') ||
                               tabUrl.startsWith('about:') ||
                               tabUrl === 'chrome://newtab/' ||
                               tabUrl === 'unknown';

          domState = {
            url: tabUrl,
            title: tabTitle,
            interactiveElements: [],
            pageText: isRestricted
              ? 'RESTRICTED PAGE: Cannot interact with this page. Use "navigate" action to go to a website first (e.g., navigate to https://google.com).'
              : 'Page content not available. Try navigating to a different page.',
          };
        }

        // Check for obstacles that require user intervention
        const obstacle = detectObstacle(domState);
        if (obstacle) {
          this.currentObstacle = obstacle;
          this.emit({
            type: 'OBSTACLE_DETECTED',
            obstacle: obstacle.type,
            message: obstacle.message,
          });

          if (obstacle.userActionRequired !== 'NONE') {
            this.emit({
              type: 'USER_ACTION_REQUIRED',
              action: obstacle.userActionRequired,
            });
            this.emit({
              type: 'TASK_PAUSED',
              reason: getObstacleMessage(obstacle),
            });

            // Wait for user to resolve obstacle
            await this.waitForResume();

            if (this.shouldCancel) {
              throw new Error('Task cancelled by user');
            }

            // Continue to next iteration to re-check state
            this.emit({ type: 'TASK_RESUMED' });
            continue;
          } else if (!obstacle.recoverable) {
            // Non-recoverable obstacle (like out of stock)
            this.emit({
              type: 'TASK_FAILED',
              error: obstacle.message,
            });
            throw new Error(obstacle.message);
          }
        }
        this.currentObstacle = null;

        // Take DOM snapshot before action for change observation
        changeObserver.takeSnapshot(domState);

        // STATE MACHINE FIRST approach - minimize LLM calls
        let action: NavigatorOutput | null = null;
        let actionSource = '';

        // 1. Try site-specific state machine (90% of actions - NO LLM)
        const machineResult = siteRouter.getAction(task, domState, this.context!);
        if (machineResult) {
          action = machineResult.action;
          actionSource = `${machineResult.machineName} state machine (${machineResult.state})`;

          // Handle obstacles from state machine (Amazon)
          if (machineResult.machineName === 'Amazon') {
            // Check if there's an obstacle in the action (Amazon machine returns obstacles)
            const pageText = domState.pageText?.toLowerCase() || '';
            if (pageText.includes('captcha') || pageText.includes('sign in')) {
              const obstacleType = pageText.includes('captcha') ? 'CAPTCHA' : 'LOGIN_REQUIRED';
              this.currentObstacle = {
                type: obstacleType,
                message: obstacleType === 'CAPTCHA' ? 'CAPTCHA detected' : 'Login required',
                recoverable: true,
                userActionRequired: obstacleType === 'LOGIN_REQUIRED' ? 'LOGIN' : 'SOLVE_CAPTCHA',
              };
              this.emit({
                type: 'OBSTACLE_DETECTED',
                obstacle: obstacleType,
                message: this.currentObstacle.message,
              });
              if (this.currentObstacle.userActionRequired !== 'NONE') {
                this.emit({ type: 'TASK_PAUSED', reason: getObstacleMessage(this.currentObstacle) });
                await this.waitForResume();
                if (this.shouldCancel) throw new Error('Task cancelled by user');
                siteRouter.resumeAmazon();
                this.emit({ type: 'TASK_RESUMED' });
                continue;
              }
            }
          }
        }

        // 2. Try rule engine if no state machine match (8% - NO LLM)
        if (!action) {
          const ruleAction = this.navigator.applyRules(this.context!, domState);
          if (ruleAction) {
            action = ruleAction;
            actionSource = 'rule engine';
          }
        }

        // 3. LLM disambiguation only when stuck (2% of actions)
        if (!action && this.llmCallsRemaining > 0) {
          try {
            this.llmCallsRemaining--;
            taskLogger.recordLLMCall();
            console.log(`[Executor] LLM fallback (${this.llmCallsRemaining} calls remaining)`);
            action = await this.navigator.getNextAction(this.context!, domState);
            actionSource = 'LLM';
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[Executor] Navigator error:', errorMsg);

            // Try replanning only if we have LLM calls left
            if (replans < MAX_REPLANS && this.llmCallsRemaining > 0) {
              replans++;
              this.llmCallsRemaining--;
              taskLogger.recordLLMCall();
              this.emit({ type: 'REPLAN', reason: `Navigator error: ${errorMsg}` });
              this.navigator.reset();
              this.context!.plan = await this.planner.replan(this.context!, errorMsg);
              this.emit({ type: 'PLAN_COMPLETE', plan: this.context!.plan.plan.steps });
              continue;
            }

            this.emit({ type: 'TASK_FAILED', error: `Navigator error: ${errorMsg}` });
            throw error;
          }
        }

        // 4. No action available - fail with helpful message
        if (!action) {
          const pageInfo = `Current page: ${domState.title || 'Unknown'} (${domState.url})`;
          const elementInfo = `Found ${domState.interactiveElements.length} interactive elements`;

          let error = '⚠️ COULD NOT DETERMINE NEXT ACTION\n\n';
          error += 'The agent couldn\'t figure out what to do next. This usually happens when:\n\n';
          error += '• The page structure is unexpected or has changed\n';
          error += '• The page requires login or verification (CAPTCHA)\n';
          error += '• The content is dynamically loaded and not yet visible\n';
          error += '• The task is not achievable on the current page\n\n';
          error += 'What to try:\n';
          error += '✓ Refresh the page and try again\n';
          error += '✓ Enable Vision Mode for better understanding\n';
          error += '✓ Check if you\'re logged in to the site\n';
          error += '✓ Make sure you\'re on the correct page\n';
          error += '✓ Try a simpler or more specific task description\n\n';
          error += 'Debug Information:\n';
          error += `• ${pageInfo}\n`;
          error += `• ${elementInfo}\n`;
          error += `• State machines checked: ${machineResult ? 'matched but no action' : 'no match'}\n`;
          error += `• Rules checked: ${action ? 'matched' : 'no match'}\n`;
          error += '• LLM reasoning: Exhausted or failed to generate valid action\n';

          this.emit({ type: 'TASK_FAILED', error });
          throw new Error(error);
        }

        console.log(`[Executor] Action via ${actionSource}: ${action.action.action_type}`);

        // Loop detection: check if we're repeating the same action
        const actionSignature = `${action.action.action_type}:${JSON.stringify(action.action.parameters)}`;
        if (actionSignature === lastActionSignature) {
          sameActionCount++;
          console.warn(`[Executor] Same action repeated ${sameActionCount} times`);

          if (sameActionCount >= 3 && replans < MAX_REPLANS) {
            // Stuck in a loop, force replan
            replans++;
            this.emit({ type: 'REPLAN', reason: 'Stuck repeating same action' });
            this.navigator.reset();
            this.context.plan = await this.planner.replan(
              this.context,
              `Agent stuck repeating: ${action.action.action_type}. Need different approach.`
            );
            this.emit({ type: 'PLAN_COMPLETE', plan: this.context.plan.plan.steps });
            sameActionCount = 0;
            lastActionSignature = '';
            continue;
          }

          // If replans exhausted and still looping, fail early
          if (sameActionCount >= 5 && replans >= MAX_REPLANS) {
            const error = `Stuck in loop: repeating "${action.action.action_type}" action. Unable to make progress.`;
            this.emit({ type: 'TASK_FAILED', error });
            throw new Error(error);
          }
        } else {
          lastActionSignature = actionSignature;
          sameActionCount = 1;
        }

        // Emit action with reasoning (Phase 1.3)
        this.emit({
          type: 'STEP_ACTION',
          action: action.action.action_type,
          params: action.action.parameters,
          reasoning: action.action.thought || `Action selected via ${actionSource}`,
          stateDetected: actionSource,
          confidence: actionSource.includes('state machine') ? 0.95 :
                     actionSource.includes('rule') ? 0.8 : 0.7,
        });

        console.log(
          `[Executor] Step ${step + 1}: ${action.action.action_type}`,
          action.action.parameters
        );

        // Handle terminal actions
        if (action.action.action_type === 'done') {
          const result = action.action.parameters.result || 'Task completed successfully';
          await taskLogger.endTaskSuccess(result);
          this.emit({ type: 'TASK_COMPLETE', result });
          return result;
        }

        if (action.action.action_type === 'fail') {
          const reason = action.action.parameters.reason || 'Unknown failure';

          // Try replanning
          if (replans < MAX_REPLANS) {
            replans++;
            taskLogger.recordLLMCall();
            this.emit({ type: 'REPLAN', reason });
            this.navigator.reset();
            this.context.plan = await this.planner.replan(this.context, reason);
            this.emit({ type: 'PLAN_COMPLETE', plan: this.context.plan.plan.steps });
            consecutiveFailures = 0;
            continue;
          }

          await taskLogger.endTaskFailure(reason);
          this.emit({ type: 'TASK_FAILED', error: reason });
          throw new Error(reason);
        }

        // Execute the action
        let result: ActionResult;
        try {
          result = await executeAction(action.action.action_type, action.action.parameters);
        } catch (error) {
          result = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        this.emit({
          type: 'STEP_RESULT',
          success: result.success,
          data: result.data,
        });

        console.log(`[Executor] Action result:`, result);

        // Record in history
        const historyEntry: AgentStep = {
          action: action.action,
          result,
          timestamp: Date.now(),
        };
        this.context.history.push(historyEntry);

        // Handle action failure
        if (!result.success) {
          consecutiveFailures++;

          if (consecutiveFailures >= 3 && replans < MAX_REPLANS) {
            // Multiple consecutive failures, try replanning
            replans++;
            this.emit({ type: 'REPLAN', reason: result.error || 'Multiple consecutive failures' });
            this.navigator.reset();
            this.context.plan = await this.planner.replan(
              this.context,
              result.error || 'Multiple action failures'
            );
            this.emit({ type: 'PLAN_COMPLETE', plan: this.context.plan.plan.steps });
            consecutiveFailures = 0;
          }
          // Otherwise let navigator adapt on its own
        } else {
          consecutiveFailures = 0;
        }
      }

      // Max steps exceeded
      const error = `Maximum steps (${MAX_STEPS}) exceeded without completing task`;
      await taskLogger.endTaskFailure(error);
      this.emit({ type: 'TASK_FAILED', error });
      throw new Error(error);
    } catch (error) {
      // Catch any unhandled errors and log them
      const errorMsg = error instanceof Error ? error.message : String(error);
      await taskLogger.endTaskFailure(errorMsg);
      throw error;
    } finally {
      this.isRunning = false;
      this.reset();
    }
  }

  /**
   * Cancel the currently running task
   */
  cancel(): void {
    this.shouldCancel = true;
    // Also resolve any pending pause
    if (this.pauseResolver) {
      this.pauseResolver();
      this.pauseResolver = null;
    }
  }

  /**
   * Pause the task execution (used for obstacle handling)
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resume a paused task
   */
  resume(): void {
    this.isPaused = false;
    if (this.pauseResolver) {
      this.pauseResolver();
      this.pauseResolver = null;
    }
    // Reset the site router's state machine if we were paused due to obstacle
    if (this.currentObstacle) {
      siteRouter.resumeAmazon();
    }
    this.currentObstacle = null;
  }

  /**
   * Check if the task is currently paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Get the current obstacle if any
   */
  getCurrentObstacle(): DetectedObstacle | null {
    return this.currentObstacle;
  }

  /**
   * Wait for the task to be resumed
   */
  private waitForResume(): Promise<void> {
    this.isPaused = true;
    return new Promise((resolve) => {
      this.pauseResolver = resolve;
    });
  }

  /**
   * Subscribe to executor events
   * Returns unsubscribe function
   */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(event: ExecutorEvent): void {
    console.log('[Executor] Event:', event.type);
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (e) {
        console.error('[Executor] Event listener error:', e);
      }
    });
  }

  /**
   * Reset executor state
   */
  reset(): void {
    this.planner.reset();
    this.navigator.reset();
    this.context = null;
    this.isPaused = false;
    this.pauseResolver = null;
    this.currentObstacle = null;
    this.searchQuery = '';
    this.llmCallsRemaining = MAX_LLM_CALLS_PER_TASK;
  }

  /**
   * Extract search query from task without LLM
   */
  private extractSearchQuery(task: string): string {
    const patterns = [
      // Site-specific patterns
      /(?:youtube|video).*?(?:search|find|play|watch)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+on|\s*$)/i,
      /(?:search|find|play|watch)\s+(?:for\s+)?["']?(.+?)["']?\s+(?:on\s+)?(?:youtube|amazon)/i,
      // E-commerce patterns
      /(?:add|buy|order)\s+["']?(.+?)["']?\s+(?:to cart|on amazon|from amazon)/i,
      /(?:add|buy|order)\s+["']?(.+?)["']?(?:\s+to|\s+on|\s*$)/i,
      // Generic search patterns
      /(?:search|find|look)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+on|\s*$)/i,
      /(?:play|watch)\s+["']?(.+?)["']?(?:\s+on|\s+video|\s*$)/i,
    ];

    for (const pattern of patterns) {
      const match = task.match(pattern);
      if (match && match[1]) {
        // Clean up the query
        return match[1]
          .replace(/\s+/g, ' ')
          .replace(/^(a|an|the|some)\s+/i, '')
          .trim();
      }
    }

    // Fallback: use the whole task (stripped of common verbs)
    return task
      .replace(/^(go to|open|navigate to|visit)\s+/i, '')
      .replace(/\s+(on|from|to cart|to my cart)\s*$/i, '')
      .trim();
  }
}

// Export singleton instance
export const executor = new Executor();
