/**
 * Main Application Component
 *
 * Manages the popup UI state and communication with the background service worker.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { TaskInput } from './components/TaskInput';
import { ProgressDisplay } from './components/ProgressDisplay';
import { ModelStatus } from './components/ModelStatus';
import { ResultView } from './components/ResultView';
import { TaskHistory } from './components/TaskHistory';
import { ObstacleNotification, type ObstacleInfo } from './components/ObstacleNotification';
import { StateMachineViewer } from './components/StateMachineViewer';
import { StateMachineBuilder } from './components/StateMachineBuilder';
import { POPUP_PORT_NAME } from '../shared/constants';
import type { ExecutorEvent } from '../shared/types';

// ============================================================================
// Types
// ============================================================================

export interface Step {
  number: number;
  action: string;
  params: Record<string, string>;
  status: 'pending' | 'running' | 'success' | 'failed';
  result?: string;
  error?: string;
  // Agent reasoning fields (Phase 1.3)
  reasoning?: string;        // Why this action was chosen
  stateDetected?: string;    // Which state machine matched
  alternatives?: string[];   // Other options considered
  confidence?: number;       // Confidence level (0-1)
}

type AppState = 'idle' | 'loading' | 'planning' | 'executing' | 'paused' | 'complete' | 'error';
type AppTab = 'task' | 'history' | 'state-machines' | 'builder';

// ============================================================================
// App Component
// ============================================================================

export function App(): React.ReactElement {
  // Application state
  const [state, setState] = useState<AppState>('idle');
  const [activeTab, setActiveTab] = useState<AppTab>('task');
  const [modelProgress, setModelProgress] = useState(0);
  const [modelPhase, setModelPhase] = useState<'downloading' | 'loading_from_cache' | 'initializing' | undefined>(undefined);
  const [modelPhaseText, setModelPhaseText] = useState<string | undefined>(undefined);
  const [plan, setPlan] = useState<string[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);
  const [obstacle, setObstacle] = useState<ObstacleInfo | null>(null);

  // Connect to background service worker
  useEffect(() => {
    let currentPort: chrome.runtime.Port | null = null;

    const connect = () => {
      try {
        console.log('[Popup] Connecting to background service...');
        const newPort = chrome.runtime.connect({ name: POPUP_PORT_NAME });
        currentPort = newPort;

        newPort.onMessage.addListener((message) => {
          console.log('[Popup] Received message:', message);

          if (message.type === 'EXECUTOR_EVENT') {
            handleExecutorEvent(message.event as ExecutorEvent);
          } else if (message.type === 'TASK_RESULT') {
            setResult(message.result);
            setState('complete');
          } else if (message.type === 'ERROR') {
            setError(message.error);
            setState('error');
          }
        });

        newPort.onDisconnect.addListener(() => {
          console.log('[Popup] Port disconnected');
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            console.error('[Popup] Disconnect error:', lastError.message);
          }
          setPort(null);
          currentPort = null;
        });

        setPort(newPort);
        console.log('[Popup] Connected successfully');
      } catch (err) {
        console.error('[Popup] Failed to connect:', err);
        setError('Failed to connect to background service. Try reloading the extension.');
        setState('error');
      }
    };

    connect();

    return () => {
      if (currentPort) {
        currentPort.disconnect();
      }
    };
  }, []);

  // Handle executor events
  const handleExecutorEvent = useCallback((event: ExecutorEvent) => {
    console.log('[Popup] Executor event:', event.type);

    switch (event.type) {
      case 'INIT_START':
        setState('loading');
        setModelProgress(0);
        setModelPhase(undefined);
        setModelPhaseText(undefined);
        break;

      case 'INIT_PROGRESS':
        setModelProgress(event.progress);
        setModelPhase(event.phase);
        setModelPhaseText(event.text);
        break;

      case 'INIT_COMPLETE':
        setModelProgress(1);
        setModelPhase(undefined);
        setModelPhaseText(undefined);
        break;

      case 'VLM_INIT_START':
        // VLM loading starts after LLM
        break;

      case 'VLM_INIT_PROGRESS':
        // Show VLM progress (offset from LLM progress)
        setModelProgress(0.5 + event.progress * 0.5);
        break;

      case 'VLM_INIT_COMPLETE':
        setModelProgress(1);
        break;

      case 'SCREENSHOT_CAPTURED':
        // Could show visual feedback
        break;

      case 'VISION_ANALYSIS_COMPLETE':
        // Could show visual feedback
        break;

      case 'PLAN_START':
        setState('planning');
        break;

      case 'PLAN_COMPLETE':
        setPlan(event.plan);
        setState('executing');
        break;

      case 'STEP_START':
        setSteps((prev) => [
          ...prev,
          {
            number: event.stepNumber,
            action: '...',
            params: {},
            status: 'running',
          },
        ]);
        break;

      case 'STEP_ACTION':
        setSteps((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last) {
            last.action = event.action;
            last.params = event.params;
            // Phase 1.3: Capture agent reasoning
            last.reasoning = event.reasoning;
            last.stateDetected = event.stateDetected;
            last.confidence = event.confidence;
          }
          return updated;
        });
        break;

      case 'STEP_RESULT':
        setSteps((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last) {
            last.status = event.success ? 'success' : 'failed';
            if (event.success && event.data) {
              last.result = event.data.slice(0, 200);
            } else if (!event.success) {
              last.error = event.data;
            }
          }
          return updated;
        });
        break;

      case 'REPLAN':
        // Clear plan and steps for replanning
        setPlan([]);
        setSteps([]);
        setState('planning');
        break;

      case 'TASK_COMPLETE':
        setResult(event.result);
        setState('complete');
        break;

      case 'TASK_FAILED':
        setError(event.error);
        setState('error');
        break;

      // Obstacle handling events
      case 'OBSTACLE_DETECTED':
        setObstacle({
          type: event.obstacle as ObstacleInfo['type'],
          message: event.message,
          timestamp: Date.now(),
        });
        break;

      case 'TASK_PAUSED':
        setState('paused');
        break;

      case 'TASK_RESUMED':
        setObstacle(null);
        setState('executing');
        break;

      case 'USER_ACTION_REQUIRED':
        // Additional UI hint could be shown here
        break;
    }
  }, []);

  // Submit a new task
  const handleSubmitTask = useCallback(
    (task: string, modelId: string, visionMode: boolean, vlmModelId: string) => {
      const payload = { task, modelId, visionMode, vlmModelId };

      // Try to reconnect if port is disconnected
      if (!port) {
        console.log('[Popup] Port disconnected, attempting to reconnect...');
        try {
          const newPort = chrome.runtime.connect({ name: POPUP_PORT_NAME });

          newPort.onMessage.addListener((message) => {
            console.log('[Popup] Received message:', message);
            if (message.type === 'EXECUTOR_EVENT') {
              handleExecutorEvent(message.event as ExecutorEvent);
            } else if (message.type === 'TASK_RESULT') {
              setResult(message.result);
              setState('complete');
            } else if (message.type === 'ERROR') {
              setError(message.error);
              setState('error');
            }
          });

          newPort.onDisconnect.addListener(() => {
            console.log('[Popup] Port disconnected');
            setPort(null);
          });

          setPort(newPort);

          // Reset state and send task
          setState('loading');
          setModelProgress(0);
          setPlan([]);
          setSteps([]);
          setResult(null);
          setError(null);

          newPort.postMessage({ type: 'START_TASK', payload });
          return;
        } catch (err) {
          console.error('[Popup] Reconnection failed:', err);
          setError('Failed to connect to background service. Try closing and reopening the popup.');
          setState('error');
          return;
        }
      }

      // Reset state
      setState('loading');
      setModelProgress(0);
      setPlan([]);
      setSteps([]);
      setResult(null);
      setError(null);

      // Send task to background
      port.postMessage({ type: 'START_TASK', payload });
    },
    [port, handleExecutorEvent]
  );

  // Cancel the running task
  const handleCancel = useCallback(() => {
    if (port) {
      port.postMessage({ type: 'CANCEL_TASK' });
      setState('idle');
      setModelProgress(0);
      setPlan([]);
      setSteps([]);
    }
  }, [port]);

  // Resume a paused task
  const handleResume = useCallback(() => {
    if (port) {
      port.postMessage({ type: 'RESUME_TASK' });
      setObstacle(null);
      setState('executing');
    }
  }, [port]);

  // Reset to initial state
  const handleReset = useCallback(() => {
    setState('idle');
    setModelProgress(0);
    setPlan([]);
    setSteps([]);
    setResult(null);
    setError(null);
    setObstacle(null);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>Local Browser</h1>
        <p>AI Web Automation (On-Device)</p>
      </header>

      {/* Tab Navigation (only show when idle) */}
      {state === 'idle' && (
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'task' ? 'active' : ''}`}
            onClick={() => setActiveTab('task')}
          >
            New Task
          </button>
          <button
            className={`tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
          <button
            className={`tab ${activeTab === 'state-machines' ? 'active' : ''}`}
            onClick={() => setActiveTab('state-machines')}
          >
            State Machines
          </button>
          <button
            className={`tab ${activeTab === 'builder' ? 'active' : ''}`}
            onClick={() => setActiveTab('builder')}
          >
            Builder
          </button>
        </div>
      )}

      <main className="main">
        {state === 'idle' && activeTab === 'task' && <TaskInput onSubmit={handleSubmitTask} />}
        {state === 'idle' && activeTab === 'history' && <TaskHistory />}
        {state === 'idle' && activeTab === 'state-machines' && <StateMachineViewer />}
        {state === 'idle' && activeTab === 'builder' && <StateMachineBuilder />}

        {state === 'loading' && (
          <>
            <ModelStatus progress={modelProgress} phase={modelPhase} phaseText={modelPhaseText} />
            <button className="stop-button" onClick={handleCancel}>
              Stop
            </button>
          </>
        )}

        {(state === 'planning' || state === 'executing') && (
          <>
            <ProgressDisplay state={state} plan={plan} steps={steps} />
            <button className="stop-button" onClick={handleCancel}>
              Stop Task
            </button>
          </>
        )}

        {state === 'paused' && obstacle && (
          <div className="paused-view">
            <ObstacleNotification
              obstacle={obstacle}
              onResume={handleResume}
              onCancel={handleCancel}
            />
            <div className="progress-while-paused">
              <h3>Progress so far:</h3>
              <ProgressDisplay state="executing" plan={plan} steps={steps} />
            </div>
          </div>
        )}

        {state === 'complete' && result && (
          <ResultView result={result} onReset={handleReset} />
        )}

        {state === 'error' && error && (
          <div className="error-view">
            <h2>Error</h2>
            <div className="error-content">{error}</div>
            <button onClick={handleReset}>Try Again</button>
          </div>
        )}
      </main>
    </div>
  );
}
