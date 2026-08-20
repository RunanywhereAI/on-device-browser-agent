/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { RxDiscordLogo } from 'react-icons/rx';
import { FiSettings } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import {
  Actors,
  chatHistoryStore,
  agentModelStore,
  generalSettingsStore,
  llmProviderStore,
  getDefaultProviderConfig,
  AgentNameEnum,
  ProviderTypeEnum,
} from '@extension/storage';
import favoritesStorage, { type FavoritePrompt } from '@extension/storage/lib/prompt/favorites';
import { t } from '@extension/i18n';
import { getCapabilities, getModelState, type RaCapabilities } from '@extension/runanywhere';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import ChatHistoryList from './components/ChatHistoryList';
import BookmarkList from './components/BookmarkList';
import { Onboarding } from './components/Onboarding';
import { ModelStatus } from './components/ModelStatus';
import { EventType, type AgentEvent, ExecutionState } from './types/event';
import {
  type UiMessage,
  type StepUiMessage,
  type ToolCallUiMessage,
  nextUiMessageId,
  textUiMessage,
  toStorageMessage,
} from './types/uiMessage';
import './SidePanel.css';

// Declare chrome API types
declare global {
  interface Window {
    chrome: typeof chrome;
  }
}

/**
 * Whether the panel should show the chat UI, the first-run download flow, or
 * is still figuring out which of those it is.
 */
type GateState = 'loading' | 'onboarding' | 'chat';

const SidePanel = () => {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [inputEnabled, setInputEnabled] = useState(true);
  const [showStopButton, setShowStopButton] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; createdAt: number }>>([]);
  const [isFollowUpMode, setIsFollowUpMode] = useState(false);
  const [isHistoricalSession, setIsHistoricalSession] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [favoritePrompts, setFavoritePrompts] = useState<FavoritePrompt[]>([]);
  const [gate, setGate] = useState<GateState>('loading');
  const [capabilities, setCapabilities] = useState<RaCapabilities | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayEnabled, setReplayEnabled] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const isReplayingRef = useRef<boolean>(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  // In-flight Planner/Navigator/Validator "step" row, keyed by actor, and the
  // currently in-flight Navigator tool call — so STEP_OK/ACT_OK etc. update
  // the existing row instead of appending a duplicate.
  const runningStepIdRef = useRef<Partial<Record<Actors, string>>>({});
  const runningToolCallIdRef = useRef<string | null>(null);

  // Check for dark mode preference
  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModeMediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    darkModeMediaQuery.addEventListener('change', handleChange);
    return () => darkModeMediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Figure out whether to show the chat UI or the first-run download flow:
  // a downloaded on-device model, or a configured cloud provider, both mean
  // there is something to chat with already.
  const evaluateGate = useCallback(async () => {
    let nextCapabilities: RaCapabilities | null = null;
    try {
      nextCapabilities = await getCapabilities();
    } catch (error) {
      console.error('Failed to read on-device capabilities:', error);
    }
    setCapabilities(nextCapabilities);

    let downloadedModelId: string | null = null;
    try {
      const models = await getModelState();
      downloadedModelId = models.find(model => model.downloaded)?.id ?? null;
    } catch (error) {
      console.error('Failed to read on-device model state:', error);
    }
    setActiveModelId(downloadedModelId);

    if (downloadedModelId) {
      setGate('chat');
      return;
    }

    let hasConfiguredAgent = false;
    try {
      const configuredAgents = await agentModelStore.getConfiguredAgents();
      hasConfiguredAgent = configuredAgents.length > 0;
    } catch (error) {
      console.error('Failed to read agent configuration:', error);
    }

    setGate(hasConfiguredAgent ? 'chat' : 'onboarding');
  }, []);

  // Load general settings to check if replay is enabled
  const loadGeneralSettings = useCallback(async () => {
    try {
      const settings = await generalSettingsStore.getSettings();
      setReplayEnabled(settings.replayHistoricalTasks);
    } catch (error) {
      console.error('Error loading general settings:', error);
      setReplayEnabled(false);
    }
  }, []);

  // Check model/gate state on mount
  useEffect(() => {
    evaluateGate();
    loadGeneralSettings();
  }, [evaluateGate, loadGeneralSettings]);

  // Re-check when the side panel becomes visible/focused again — the model
  // may have finished downloading, or been configured, from another surface.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        evaluateGate();
        loadGeneralSettings();
      }
    };

    const handleFocus = () => {
      evaluateGate();
      loadGeneralSettings();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [evaluateGate, loadGeneralSettings]);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);

  /** Persist a plain message to the current session's history, if there is one. */
  const persistMessage = useCallback((actor: Actors, content: string, timestamp: number, sessionId?: string | null) => {
    const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;
    if (!effectiveSessionId) return;
    chatHistoryStore
      .addMessage(effectiveSessionId, toStorageMessage(actor, content, timestamp))
      .catch(err => console.error('Failed to save message to history:', err));
  }, []);

  /** Append a plain chat bubble, and persist it. */
  const appendTextMessage = useCallback(
    (actor: Actors, content: string, timestamp: number, sessionId?: string | null) => {
      setMessages(prev => [...prev, { kind: 'text', id: nextUiMessageId(), actor, content, timestamp }]);
      persistMessage(actor, content, timestamp, sessionId);
    },
    [persistMessage],
  );

  /** Insert or update a step/tool-call row in place, by id. */
  const upsertUiMessage = useCallback((id: string, build: (prev: UiMessage | undefined) => UiMessage) => {
    setMessages(prev => {
      const idx = prev.findIndex(message => message.id === id);
      if (idx === -1) return [...prev, build(undefined)];
      const next = prev.slice();
      next[idx] = build(prev[idx]);
      return next;
    });
  }, []);

  const removeUiMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(message => message.id !== id));
  }, []);

  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      const { actor, state, timestamp, data } = event;
      const content = data?.details ?? '';

      switch (actor) {
        case Actors.SYSTEM: {
          switch (state) {
            case ExecutionState.TASK_START:
              setIsHistoricalSession(false);
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              appendTextMessage(actor, content, timestamp);
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              appendTextMessage(actor, content, timestamp);
              break;
            case ExecutionState.TASK_PAUSE:
            case ExecutionState.TASK_RESUME:
              break;
            default:
              console.error('Invalid task state', state);
          }
          break;
        }
        case Actors.USER:
          break;
        // Planner and the legacy Validator both render as a "thinking" step:
        // an auto-expanding Disclosure with escalating wait copy while
        // running, collapsing to the real reasoning once it settles.
        case Actors.PLANNER:
        case Actors.VALIDATOR: {
          switch (state) {
            case ExecutionState.STEP_START: {
              const id = runningStepIdRef.current[actor] ?? nextUiMessageId();
              runningStepIdRef.current[actor] = id;
              upsertUiMessage(id, () => ({ kind: 'step', id, actor, status: 'running', text: '', timestamp }));
              break;
            }
            case ExecutionState.STEP_OK:
            case ExecutionState.STEP_FAIL: {
              const id = runningStepIdRef.current[actor];
              delete runningStepIdRef.current[actor];
              const status = state === ExecutionState.STEP_OK ? 'ok' : 'fail';
              if (id) {
                upsertUiMessage(id, prev => ({ ...(prev as StepUiMessage), status, text: content }));
              } else {
                const freshId = nextUiMessageId();
                upsertUiMessage(freshId, () => ({
                  kind: 'step',
                  id: freshId,
                  actor,
                  status,
                  text: content,
                  timestamp,
                }));
              }
              persistMessage(actor, content, timestamp);
              break;
            }
            case ExecutionState.STEP_CANCEL: {
              const id = runningStepIdRef.current[actor];
              delete runningStepIdRef.current[actor];
              if (id) removeUiMessage(id);
              break;
            }
            default:
              console.error('Invalid step state', state);
          }
          break;
        }
        case Actors.NAVIGATOR: {
          switch (state) {
            case ExecutionState.STEP_START: {
              const id = nextUiMessageId();
              runningStepIdRef.current[actor] = id;
              upsertUiMessage(id, () => ({ kind: 'step', id, actor, status: 'running', text: '', timestamp }));
              break;
            }
            case ExecutionState.STEP_OK: {
              // Superseded by the ACT_* tool-call row(s) below — matches the
              // previous behaviour of never showing "Navigation done".
              const id = runningStepIdRef.current[actor];
              delete runningStepIdRef.current[actor];
              if (id) removeUiMessage(id);
              break;
            }
            case ExecutionState.STEP_FAIL: {
              const id = runningStepIdRef.current[actor];
              delete runningStepIdRef.current[actor];
              if (id) {
                upsertUiMessage(id, prev => ({ ...(prev as StepUiMessage), status: 'fail', text: content }));
              } else {
                const freshId = nextUiMessageId();
                upsertUiMessage(freshId, () => ({
                  kind: 'step',
                  id: freshId,
                  actor,
                  status: 'fail',
                  text: content,
                  timestamp,
                }));
              }
              persistMessage(actor, content, timestamp);
              break;
            }
            case ExecutionState.STEP_CANCEL: {
              const id = runningStepIdRef.current[actor];
              delete runningStepIdRef.current[actor];
              if (id) removeUiMessage(id);
              break;
            }
            case ExecutionState.ACT_START: {
              // The "Navigating..." placeholder is superseded by the tool-call row.
              const stepId = runningStepIdRef.current[actor];
              if (stepId) {
                delete runningStepIdRef.current[actor];
                removeUiMessage(stepId);
              }
              if (content === 'cache_content') break; // suppressed, as before
              const id = nextUiMessageId();
              runningToolCallIdRef.current = id;
              upsertUiMessage(id, () => ({
                kind: 'toolCall',
                id,
                actor,
                status: 'running',
                action: content,
                timestamp,
              }));
              persistMessage(actor, content, timestamp);
              break;
            }
            case ExecutionState.ACT_OK: {
              const id = runningToolCallIdRef.current;
              runningToolCallIdRef.current = null;
              if (id) {
                upsertUiMessage(id, prev => ({ ...(prev as ToolCallUiMessage), status: 'ok', result: content }));
              } else if (isReplayingRef.current) {
                const freshId = nextUiMessageId();
                upsertUiMessage(freshId, () => ({
                  kind: 'toolCall',
                  id: freshId,
                  actor,
                  status: 'ok',
                  action: content,
                  timestamp,
                }));
              }
              // Only shown/persisted during replay, matching the previous behaviour.
              if (isReplayingRef.current) persistMessage(actor, content, timestamp);
              break;
            }
            case ExecutionState.ACT_FAIL: {
              const id = runningToolCallIdRef.current;
              runningToolCallIdRef.current = null;
              if (id) {
                upsertUiMessage(id, prev => ({ ...(prev as ToolCallUiMessage), status: 'fail', result: content }));
              } else {
                const freshId = nextUiMessageId();
                upsertUiMessage(freshId, () => ({
                  kind: 'toolCall',
                  id: freshId,
                  actor,
                  status: 'fail',
                  action: content,
                  timestamp,
                }));
              }
              persistMessage(actor, content, timestamp);
              break;
            }
            default:
              console.error('Invalid action', state);
          }
          break;
        }
        default:
          console.error('Unknown actor', actor);
      }
    },
    [appendTextMessage, persistMessage, upsertUiMessage, removeUiMessage],
  );

  // Stop heartbeat and close connection
  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      portRef.current.disconnect();
      portRef.current = null;
    }
  }, []);

  // Setup connection management
  const setupConnection = useCallback(() => {
    // Only setup if no existing connection
    if (portRef.current) {
      return;
    }

    try {
      portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });

      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      portRef.current.onMessage.addListener((message: any) => {
        // Add type checking for message
        if (message && message.type === EventType.EXECUTION) {
          handleTaskState(message);
        } else if (message && message.type === 'error') {
          // Handle error messages from service worker
          appendTextMessage(Actors.SYSTEM, message.error || t('errors_unknown'), Date.now());
          setInputEnabled(true);
          setShowStopButton(false);
        } else if (message && message.type === 'speech_to_text_result') {
          // Handle speech-to-text result
          if (message.text && setInputTextRef.current) {
            setInputTextRef.current(message.text);
          }
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'speech_to_text_error') {
          // Handle speech-to-text error
          appendTextMessage(Actors.SYSTEM, message.error || t('chat_stt_recognitionFailed'), Date.now());
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'heartbeat_ack') {
          console.log('Heartbeat acknowledged');
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.log('Connection disconnected', error ? `Error: ${error.message}` : '');
        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setInputEnabled(true);
        setShowStopButton(false);
      });

      // Setup heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === 'side-panel-connection') {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('Heartbeat failed:', error);
            stopConnection(); // Stop connection if heartbeat fails
          }
        } else {
          stopConnection(); // Stop if port is invalid
        }
      }, 25000);
    } catch (error) {
      console.error('Failed to establish connection:', error);
      appendTextMessage(Actors.SYSTEM, t('errors_conn_serviceWorker'), Date.now());
      // Clear any references since connection failed
      portRef.current = null;
    }
  }, [handleTaskState, appendTextMessage, stopConnection]);

  // Add safety check for message sending
  const sendMessage = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    (message: any) => {
      if (portRef.current?.name !== 'side-panel-connection') {
        throw new Error('No valid connection available');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        console.error('Failed to send message:', error);
        stopConnection(); // Stop connection when message sending fails
        throw error;
      }
    },
    [stopConnection],
  );

  // Handle replay command
  const handleReplay = async (historySessionId: string): Promise<void> => {
    try {
      // Check if replay is enabled in settings
      if (!replayEnabled) {
        appendTextMessage(Actors.SYSTEM, t('chat_replay_disabled'), Date.now());
        return;
      }

      // Check if history exists using loadAgentStepHistory
      const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
      if (!historyData) {
        appendTextMessage(Actors.SYSTEM, t('chat_replay_noHistory', historySessionId.substring(0, 20)), Date.now());
        return;
      }

      // Get current tab ID
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Clear messages if we're in a historical session
      if (isHistoricalSession) {
        setMessages([]);
      }
      runningStepIdRef.current = {};
      runningToolCallIdRef.current = null;

      // Create a new chat session for this replay task
      const newSession = await chatHistoryStore.createSession(`Replay of ${historySessionId.substring(0, 20)}...`);
      console.log('newSession for replay', newSession);

      // Store the new session ID in both state and ref
      const newTaskId = newSession.id;
      setCurrentSessionId(newTaskId);
      sessionIdRef.current = newTaskId;

      // Send replay command to background
      setInputEnabled(false);
      setShowStopButton(true);

      // Reset follow-up mode and historical session flags
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);

      // Add the user message to the new session
      appendTextMessage(Actors.USER, `/replay ${historySessionId}`, Date.now(), sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send replay command to background with the task from history
      portRef.current?.postMessage({
        type: 'replay',
        taskId: newTaskId,
        tabId: tabId,
        historySessionId: historySessionId,
        task: historyData.task, // Add the task from history
      });

      appendTextMessage(Actors.SYSTEM, t('chat_replay_starting', historyData.task), Date.now());
      setIsReplaying(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      appendTextMessage(Actors.SYSTEM, t('chat_replay_failed', errorMessage), Date.now());
    }
  };

  // Handle chat commands that start with /
  const handleCommand = async (command: string): Promise<boolean> => {
    try {
      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Handle different commands
      if (command === '/state') {
        portRef.current?.postMessage({
          type: 'state',
        });
        return true;
      }

      if (command === '/nohighlight') {
        portRef.current?.postMessage({
          type: 'nohighlight',
        });
        return true;
      }

      if (command.startsWith('/replay ')) {
        // Parse replay command: /replay <historySessionId>
        // Handle multiple spaces by filtering out empty strings
        const parts = command.split(' ').filter(part => part.trim() !== '');
        if (parts.length !== 2) {
          appendTextMessage(Actors.SYSTEM, t('chat_replay_invalidArgs'), Date.now());
          return true;
        }

        const historySessionId = parts[1];
        await handleReplay(historySessionId);
        return true;
      }

      // Unsupported command
      appendTextMessage(Actors.SYSTEM, t('errors_cmd_unknown', command), Date.now());
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Command error', errorMessage);
      appendTextMessage(Actors.SYSTEM, errorMessage, Date.now());
      return true;
    }
  };

  const handleSendMessage = async (text: string, displayText?: string) => {
    console.log('handleSendMessage', text);

    // Trim the input text first
    const trimmedText = text.trim();

    if (!trimmedText) return;

    // Check if the input is a command (starts with /)
    if (trimmedText.startsWith('/')) {
      // Process command and return if it was handled
      const wasHandled = await handleCommand(trimmedText);
      if (wasHandled) return;
    }

    // Block sending messages in historical sessions
    if (isHistoricalSession) {
      console.log('Cannot send messages in historical sessions');
      return;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      setInputEnabled(false);
      setShowStopButton(true);

      // Create a new chat session for this task if not in follow-up mode
      if (!isFollowUpMode) {
        // Use display text for session title if available, otherwise use full text
        const titleText = displayText || text;
        const newSession = await chatHistoryStore.createSession(
          titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''),
        );
        console.log('newSession', newSession);

        // Store the session ID in both state and ref
        const sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
      }

      // Pass the sessionId directly to appendTextMessage
      appendTextMessage(Actors.USER, displayText || text, Date.now(), sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send message using the utility function
      if (isFollowUpMode) {
        // Send as follow-up task
        await sendMessage({
          type: 'follow_up_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('follow_up_task sent', text, tabId, sessionIdRef.current);
      } else {
        // Send as new task
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('new_task sent', text, tabId, sessionIdRef.current);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task error', errorMessage);
      appendTextMessage(Actors.SYSTEM, errorMessage, Date.now());
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };

  const handleStopTask = async () => {
    try {
      portRef.current?.postMessage({
        type: 'cancel_task',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('cancel_task error', errorMessage);
      appendTextMessage(Actors.SYSTEM, errorMessage, Date.now());
    }
    setInputEnabled(true);
    setShowStopButton(false);
  };

  const handleNewChat = () => {
    // Clear messages and start a new chat
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setInputEnabled(true);
    setShowStopButton(false);
    setIsFollowUpMode(false);
    setIsHistoricalSession(false);
    runningStepIdRef.current = {};
    runningToolCallIdRef.current = null;

    // Disconnect any existing connection
    stopConnection();
  };

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata();
      setChatSessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  }, []);

  const handleLoadHistory = async () => {
    await loadChatSessions();
    setShowHistory(true);
  };

  const handleBackToChat = (reset = false) => {
    setShowHistory(false);
    if (reset) {
      setCurrentSessionId(null);
      setMessages([]);
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);
      runningStepIdRef.current = {};
      runningToolCallIdRef.current = null;
    }
  };

  const handleSessionSelect = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);
      if (fullSession && fullSession.messages.length > 0) {
        setCurrentSessionId(fullSession.id);
        setMessages(fullSession.messages.map(message => textUiMessage(message, message.id)));
        setIsFollowUpMode(false);
        setIsHistoricalSession(true); // Mark this as a historical session
        runningStepIdRef.current = {};
        runningToolCallIdRef.current = null;
        console.log('history session selected', sessionId);
      }
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const handleSessionDelete = async (sessionId: string) => {
    try {
      await chatHistoryStore.deleteSession(sessionId);
      await loadChatSessions();
      if (sessionId === currentSessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleSessionBookmark = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);

      if (fullSession && fullSession.messages.length > 0) {
        // Get the session title
        const sessionTitle = fullSession.title;
        // Get the first 8 words of the title
        const title = sessionTitle.split(' ').slice(0, 8).join(' ');

        // Get the first message content (the task)
        const taskContent = fullSession.messages[0]?.content || '';

        // Add to favorites storage
        await favoritesStorage.addPrompt(title, taskContent);

        // Update favorites in the UI
        const prompts = await favoritesStorage.getAllPrompts();
        setFavoritePrompts(prompts);

        // Return to chat view after pinning
        handleBackToChat(true);
      }
    } catch (error) {
      console.error('Failed to pin session to favorites:', error);
    }
  };

  const handleBookmarkSelect = (content: string) => {
    if (setInputTextRef.current) {
      setInputTextRef.current(content);
    }
  };

  const handleBookmarkUpdateTitle = async (id: number, title: string) => {
    try {
      await favoritesStorage.updatePromptTitle(id, title);

      // Update favorites in the UI
      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('Failed to update favorite prompt title:', error);
    }
  };

  const handleBookmarkDelete = async (id: number) => {
    try {
      await favoritesStorage.removePrompt(id);

      // Update favorites in the UI
      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('Failed to delete favorite prompt:', error);
    }
  };

  const handleBookmarkReorder = async (draggedId: number, targetId: number) => {
    try {
      // Directly pass IDs to storage function - it now handles the reordering logic
      await favoritesStorage.reorderPrompts(draggedId, targetId);

      // Fetch the updated list from storage to get the new IDs and reflect the authoritative order
      const updatedPromptsFromStorage = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(updatedPromptsFromStorage);
    } catch (error) {
      console.error('Failed to reorder favorite prompts:', error);
    }
  };

  // Load favorite prompts from storage
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const prompts = await favoritesStorage.getAllPrompts();
        setFavoritePrompts(prompts);
      } catch (error) {
        console.error('Failed to load favorite prompts:', error);
      }
    };

    loadFavorites();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop recording if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear recording timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopConnection();
    };
  }, [stopConnection]);

  // Scroll to bottom when new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** Called once the model chosen during onboarding has finished downloading. */
  const handleModelReady = useCallback(async (modelId: string) => {
    // Wire the on-device provider + agent models so the background executor
    // can actually route inference to it — the whole point of "no
    // configuration" is that this happens automatically rather than sending
    // the user to the options page after a download they just watched finish.
    try {
      await llmProviderStore.setProvider(
        ProviderTypeEnum.RunAnywhere,
        getDefaultProviderConfig(ProviderTypeEnum.RunAnywhere),
      );
    } catch (error) {
      console.error('Failed to register the on-device provider:', error);
    }
    try {
      if (!(await agentModelStore.hasAgentModel(AgentNameEnum.Navigator))) {
        await agentModelStore.setAgentModel(AgentNameEnum.Navigator, {
          provider: ProviderTypeEnum.RunAnywhere,
          modelName: modelId,
        });
      }
      if (!(await agentModelStore.hasAgentModel(AgentNameEnum.Planner))) {
        await agentModelStore.setAgentModel(AgentNameEnum.Planner, {
          provider: ProviderTypeEnum.RunAnywhere,
          modelName: modelId,
        });
      }
    } catch (error) {
      console.error('Failed to configure the on-device agent model:', error);
    }
    setActiveModelId(modelId);
    setGate('chat');
  }, []);

  const handleMicClick = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear the timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      // First check if permission is already granted
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

      if (permissionStatus.state === 'denied') {
        appendTextMessage(Actors.SYSTEM, t('chat_stt_microphone_permissionDenied'), Date.now());
        return;
      }

      // If permission is not granted, open permission page
      if (permissionStatus.state !== 'granted') {
        const permissionUrl = chrome.runtime.getURL('permission/index.html');

        // Open permission page in a new window
        chrome.windows.create(
          {
            url: permissionUrl,
            type: 'popup',
            width: 500,
            height: 600,
          },
          createdWindow => {
            if (createdWindow?.id) {
              // Listen for window close to check permission status
              chrome.windows.onRemoved.addListener(function onWindowClose(windowId) {
                if (windowId === createdWindow.id) {
                  chrome.windows.onRemoved.removeListener(onWindowClose);
                  // Check permission status after window closes
                  setTimeout(async () => {
                    try {
                      const newPermissionStatus = await navigator.permissions.query({
                        name: 'microphone' as PermissionName,
                      });
                      // Only retry if permission was granted
                      if (newPermissionStatus.state === 'granted') {
                        handleMicClick();
                      }
                      // If denied or prompt, do nothing - let user manually try again
                    } catch (error) {
                      console.error('Failed to check permission status:', error);
                    }
                  }, 500);
                }
              });
            }
          },
        );
        return;
      }

      // Permission granted - proceed with recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Clear previous audio chunks
      audioChunksRef.current = [];

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // Handle data available event
      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle stop event
      mediaRecorder.onstop = async () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        if (audioChunksRef.current.length > 0) {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

          // Convert blob to base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Audio = reader.result as string;

            // Setup connection if not exists
            if (!portRef.current) {
              setupConnection();
            }

            // Send audio to backend for speech-to-text conversion
            try {
              setIsProcessingSpeech(true);
              portRef.current?.postMessage({
                type: 'speech_to_text',
                audio: base64Audio,
              });
            } catch (error) {
              console.error('Failed to send audio for speech-to-text:', error);
              appendTextMessage(Actors.SYSTEM, t('chat_stt_processingFailed'), Date.now());
              setIsRecording(false);
              setIsProcessingSpeech(false);
            }
          };
          reader.readAsDataURL(audioBlob);
        }
      };

      // Set up 2-minute duration limit
      const maxDuration = 2 * 60 * 1000;
      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setIsProcessingSpeech(true);
        recordingTimerRef.current = null;
      }, maxDuration);

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);

      let errorMessage = t('chat_stt_microphone_accessFailed');
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage += t('chat_stt_microphone_grantPermission');
        } else if (error.name === 'NotFoundError') {
          errorMessage += t('chat_stt_microphone_notFound');
        } else {
          errorMessage += error.message;
        }
      }

      appendTextMessage(Actors.SYSTEM, errorMessage, Date.now());
      setIsRecording(false);
    }
  };

  return (
    <div>
      <div
        className={`flex h-screen flex-col ${isDarkMode ? 'bg-slate-900' : "bg-[url('/bg.jpg')] bg-cover bg-no-repeat"} overflow-hidden border ${isDarkMode ? 'border-sky-800' : 'border-[rgb(186,230,253)]'} rounded-2xl`}>
        <header className="header relative">
          <div className="header-logo">
            {showHistory ? (
              <button
                type="button"
                onClick={() => handleBackToChat(false)}
                className={`${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'} cursor-pointer`}
                aria-label={t('nav_back_a11y')}>
                {t('nav_back')}
              </button>
            ) : (
              <img src="/icon-128.png" alt="Extension Logo" className="size-6" />
            )}
          </div>
          {!showHistory && gate === 'chat' && activeModelId && (
            <div className="flex flex-1 items-center justify-center overflow-hidden px-2">
              <ModelStatus modelId={activeModelId} capabilities={capabilities} />
            </div>
          )}
          <div className="header-icons">
            {!showHistory && (
              <>
                <button
                  type="button"
                  onClick={handleNewChat}
                  onKeyDown={e => e.key === 'Enter' && handleNewChat()}
                  className={`header-icon ${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'} cursor-pointer`}
                  aria-label={t('nav_newChat_a11y')}
                  tabIndex={0}>
                  <PiPlusBold size={20} />
                </button>
                <button
                  type="button"
                  onClick={handleLoadHistory}
                  onKeyDown={e => e.key === 'Enter' && handleLoadHistory()}
                  className={`header-icon ${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'} cursor-pointer`}
                  aria-label={t('nav_loadHistory_a11y')}
                  tabIndex={0}>
                  <GrHistory size={20} />
                </button>
              </>
            )}
            <a
              href="https://discord.gg/NN3ABHggMK"
              target="_blank"
              rel="noopener noreferrer"
              className={`header-icon ${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'}`}>
              <RxDiscordLogo size={20} />
            </a>
            <button
              type="button"
              onClick={() => chrome.runtime.openOptionsPage()}
              onKeyDown={e => e.key === 'Enter' && chrome.runtime.openOptionsPage()}
              className={`header-icon ${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'} cursor-pointer`}
              aria-label={t('nav_settings_a11y')}
              tabIndex={0}>
              <FiSettings size={20} />
            </button>
          </div>
        </header>
        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              onSessionBookmark={handleSessionBookmark}
              visible={true}
              isDarkMode={isDarkMode}
            />
          </div>
        ) : (
          <>
            {/* Still figuring out whether there's a model or provider to chat with */}
            {gate === 'loading' && (
              <div
                className={`flex flex-1 items-center justify-center p-8 ${isDarkMode ? 'text-sky-300' : 'text-sky-600'}`}>
                <div className="text-center">
                  <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"></div>
                  <p>{t('status_checkingConfig')}</p>
                </div>
              </div>
            )}

            {/* First run: no model downloaded yet, and no cloud provider configured */}
            {gate === 'onboarding' && <Onboarding capabilities={capabilities} onModelReady={handleModelReady} />}

            {/* Normal chat interface: a model is downloaded, or a cloud provider is configured */}
            {gate === 'chat' && (
              <>
                {messages.length === 0 && (
                  <>
                    <div
                      className={`border-t ${isDarkMode ? 'border-sky-900' : 'border-sky-100'} mb-2 p-2 shadow-sm backdrop-blur-sm`}>
                      <ChatInput
                        onSendMessage={handleSendMessage}
                        onStopTask={handleStopTask}
                        onMicClick={handleMicClick}
                        isRecording={isRecording}
                        isProcessingSpeech={isProcessingSpeech}
                        disabled={!inputEnabled || isHistoricalSession}
                        showStopButton={showStopButton}
                        setContent={setter => {
                          setInputTextRef.current = setter;
                        }}
                        isDarkMode={isDarkMode}
                        historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                        onReplay={handleReplay}
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      <BookmarkList
                        bookmarks={favoritePrompts}
                        onBookmarkSelect={handleBookmarkSelect}
                        onBookmarkUpdateTitle={handleBookmarkUpdateTitle}
                        onBookmarkDelete={handleBookmarkDelete}
                        onBookmarkReorder={handleBookmarkReorder}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                  </>
                )}
                {messages.length > 0 && (
                  <div
                    className={`scrollbar-gutter-stable flex-1 overflow-x-hidden overflow-y-scroll scroll-smooth p-2 ${isDarkMode ? 'bg-slate-900/80' : ''}`}>
                    <MessageList messages={messages} isDarkMode={isDarkMode} />
                    <div ref={messagesEndRef} />
                  </div>
                )}
                {messages.length > 0 && (
                  <div
                    className={`border-t ${isDarkMode ? 'border-sky-900' : 'border-sky-100'} p-2 shadow-sm backdrop-blur-sm`}>
                    <ChatInput
                      onSendMessage={handleSendMessage}
                      onStopTask={handleStopTask}
                      onMicClick={handleMicClick}
                      isRecording={isRecording}
                      isProcessingSpeech={isProcessingSpeech}
                      disabled={!inputEnabled || isHistoricalSession}
                      showStopButton={showStopButton}
                      setContent={setter => {
                        setInputTextRef.current = setter;
                      }}
                      isDarkMode={isDarkMode}
                      historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                      onReplay={handleReplay}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SidePanel;
