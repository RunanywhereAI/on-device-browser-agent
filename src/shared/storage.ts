/**
 * Storage Utilities
 *
 * Manages chrome.storage.local for settings and task history.
 */

// ============================================================================
// Types
// ============================================================================

export interface UserSettings {
  modelId: string;
  visionMode: boolean;
  vlmModelId: string;
  lastUpdated: number;
}

/**
 * Detailed information about a single step in task execution
 * (Phase 2.2: Enhanced Task History)
 */
export interface DetailedStep {
  number: number;
  action: string;
  params: Record<string, string>;
  status: 'success' | 'failed';
  result?: string;
  error?: string;
  // Agent reasoning (from Phase 1.3)
  reasoning?: string;
  stateDetected?: string;
  confidence?: number;
  // Timing
  timestamp: number;
  duration: number; // ms
}

export interface TaskHistoryEntry {
  id: string;
  description: string;
  modelId: string;
  visionMode: boolean;
  steps: number;
  llmCalls: number;
  duration: number;
  success: boolean;
  result?: string;
  error?: string;
  timestamp: number;
  // Detailed step-by-step information (Phase 2.2)
  detailedSteps?: DetailedStep[];
  planSteps?: string[]; // High-level plan from Planner
}

export interface StorageData {
  settings?: UserSettings;
  taskHistory?: TaskHistoryEntry[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SETTINGS: UserSettings = {
  modelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
  visionMode: false,
  vlmModelId: 'small',
  lastUpdated: Date.now(),
};

const MAX_HISTORY_ENTRIES = 50;

// ============================================================================
// Settings Management
// ============================================================================

/**
 * Load user settings from storage
 */
export async function loadSettings(): Promise<UserSettings> {
  try {
    const result = await chrome.storage.local.get('settings');
    if (result.settings) {
      console.log('[Storage] Loaded settings:', result.settings);
      return result.settings as UserSettings;
    }
  } catch (error) {
    console.error('[Storage] Failed to load settings:', error);
  }

  console.log('[Storage] Using default settings');
  return DEFAULT_SETTINGS;
}

/**
 * Save user settings to storage
 */
export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  try {
    const currentSettings = await loadSettings();
    const updatedSettings: UserSettings = {
      ...currentSettings,
      ...settings,
      lastUpdated: Date.now(),
    };

    await chrome.storage.local.set({ settings: updatedSettings });
    console.log('[Storage] Saved settings:', updatedSettings);
  } catch (error) {
    console.error('[Storage] Failed to save settings:', error);
    throw error;
  }
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  try {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    console.log('[Storage] Reset settings to defaults');
  } catch (error) {
    console.error('[Storage] Failed to reset settings:', error);
    throw error;
  }
}

// ============================================================================
// Task History Management
// ============================================================================

/**
 * Load task history from storage
 */
export async function loadTaskHistory(): Promise<TaskHistoryEntry[]> {
  try {
    const result = await chrome.storage.local.get('taskHistory');
    if (result.taskHistory && Array.isArray(result.taskHistory)) {
      console.log('[Storage] Loaded task history:', result.taskHistory.length, 'entries');
      return result.taskHistory as TaskHistoryEntry[];
    }
  } catch (error) {
    console.error('[Storage] Failed to load task history:', error);
  }

  return [];
}

/**
 * Add a task to history
 */
export async function addTaskToHistory(task: Omit<TaskHistoryEntry, 'id'>): Promise<void> {
  try {
    const history = await loadTaskHistory();

    const entry: TaskHistoryEntry = {
      ...task,
      id: generateTaskId(),
    };

    // Add to beginning of array
    history.unshift(entry);

    // Keep only the most recent entries
    const trimmedHistory = history.slice(0, MAX_HISTORY_ENTRIES);

    await chrome.storage.local.set({ taskHistory: trimmedHistory });
    console.log('[Storage] Added task to history:', entry.id);
  } catch (error) {
    console.error('[Storage] Failed to add task to history:', error);
    throw error;
  }
}

/**
 * Get a specific task from history by ID
 */
export async function getTaskFromHistory(taskId: string): Promise<TaskHistoryEntry | null> {
  try {
    const history = await loadTaskHistory();
    return history.find(task => task.id === taskId) || null;
  } catch (error) {
    console.error('[Storage] Failed to get task from history:', error);
    return null;
  }
}

/**
 * Clear all task history
 */
export async function clearTaskHistory(): Promise<void> {
  try {
    await chrome.storage.local.set({ taskHistory: [] });
    console.log('[Storage] Cleared task history');
  } catch (error) {
    console.error('[Storage] Failed to clear task history:', error);
    throw error;
  }
}

/**
 * Get task history statistics
 */
export async function getTaskHistoryStats(): Promise<{
  total: number;
  successful: number;
  failed: number;
  averageDuration: number;
  averageSteps: number;
  totalLLMCalls: number;
}> {
  const history = await loadTaskHistory();

  if (history.length === 0) {
    return {
      total: 0,
      successful: 0,
      failed: 0,
      averageDuration: 0,
      averageSteps: 0,
      totalLLMCalls: 0,
    };
  }

  const successful = history.filter(t => t.success).length;
  const totalDuration = history.reduce((sum, t) => sum + t.duration, 0);
  const totalSteps = history.reduce((sum, t) => sum + t.steps, 0);
  const totalLLMCalls = history.reduce((sum, t) => sum + t.llmCalls, 0);

  return {
    total: history.length,
    successful,
    failed: history.length - successful,
    averageDuration: Math.round(totalDuration / history.length),
    averageSteps: Math.round(totalSteps / history.length),
    totalLLMCalls,
  };
}

/**
 * Export task history as JSON
 */
export async function exportTaskHistory(): Promise<string> {
  const history = await loadTaskHistory();
  return JSON.stringify(history, null, 2);
}

// ============================================================================
// Storage Info
// ============================================================================

/**
 * Get storage usage information
 */
export async function getStorageInfo(): Promise<{
  bytesUsed: number;
  bytesAvailable: number;
  percentUsed: number;
}> {
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse();
    const quota = chrome.storage.local.QUOTA_BYTES;

    return {
      bytesUsed: bytesInUse,
      bytesAvailable: quota - bytesInUse,
      percentUsed: Math.round((bytesInUse / quota) * 100),
    };
  } catch (error) {
    console.error('[Storage] Failed to get storage info:', error);
    return {
      bytesUsed: 0,
      bytesAvailable: 0,
      percentUsed: 0,
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format duration to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
