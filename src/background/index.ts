/**
 * Background Service Worker
 *
 * Main entry point for the extension's background process.
 * Handles:
 * - Communication with popup UI
 * - Task execution orchestration
 * - DOM state retrieval from content scripts
 * - Action execution via content scripts
 */

import { executor } from './agents/executor';
import { visionExecutor } from './agents/vision-executor';
import { visionEngine } from './vision-engine';
import { stateRegistry } from './agents/state-registry';
import { POPUP_PORT_NAME, POST_NAVIGATION_DELAY, PAGE_LOAD_TIMEOUT } from '../shared/constants';
import type { DOMState, ActionResult, ExecutorEvent, BackgroundMessage } from '../shared/types';

// ============================================================================
// State
// ============================================================================

let activePort: chrome.runtime.Port | null = null;
let currentTabId: number | null = null;

// ============================================================================
// Port Connection Handler
// ============================================================================

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== POPUP_PORT_NAME) return;

  console.log('[Background] Popup connected');
  activePort = port;

  port.onMessage.addListener(async (message: BackgroundMessage & { type: string }) => {
    console.log('[Background] Received message:', message.type);

    if (message.type === 'START_TASK') {
      const { task, modelId, visionMode, vlmModelId } = message.payload;
      await handleStartTask(task, port, modelId, visionMode, vlmModelId);
    } else if (message.type === 'CANCEL_TASK') {
      executor.cancel();
      visionExecutor.cancel();
    } else if (message.type === 'RESUME_TASK') {
      console.log('[Background] Resuming task');
      executor.resume();
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[Background] Popup disconnected');
    activePort = null;
  });
});

// ============================================================================
// Task Execution
// ============================================================================

async function handleStartTask(
  task: string,
  port: chrome.runtime.Port,
  modelId?: string,
  visionMode?: boolean,
  vlmModelId?: string
): Promise<void> {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    port.postMessage({ type: 'ERROR', error: 'No active tab found. Please open a web page first.' });
    return;
  }

  currentTabId = tab.id;

  // Event handler for forwarding to popup
  const handleEvent = (event: ExecutorEvent) => {
    try {
      port.postMessage({ type: 'EXECUTOR_EVENT', event });
    } catch (e) {
      console.error('[Background] Failed to send event to popup:', e);
    }
  };

  try {
    if (visionMode) {
      // Use vision executor for screenshot-based navigation
      console.log('[Background] Starting vision task with VLM:', vlmModelId || 'small');
      const unsubscribe = visionExecutor.onEvent(handleEvent);

      try {
        const result = await visionExecutor.executeTask(
          task,
          currentTabId!,
          (actionType, params) => executeAction(currentTabId!, actionType, params),
          vlmModelId
        );
        port.postMessage({ type: 'TASK_RESULT', result });
      } finally {
        unsubscribe();
      }
    } else {
      // Use standard executor for DOM-based navigation
      console.log('[Background] Starting task with LLM:', modelId || 'default');
      const unsubscribe = executor.onEvent(handleEvent);

      try {
        const result = await executor.executeTask(
          task,
          () => getDOMStateWithScreenshot(currentTabId!),
          (actionType, params) => executeAction(currentTabId!, actionType, params),
          modelId
        );
        port.postMessage({ type: 'TASK_RESULT', result });
      } finally {
        unsubscribe();
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Background] Task failed:', errorMsg);
    port.postMessage({ type: 'ERROR', error: errorMsg });
  } finally {
    currentTabId = null;
  }
}

// ============================================================================
// DOM State Retrieval
// ============================================================================

async function getDOMState(tabId: number): Promise<DOMState> {
  const maxRetries = 5;
  const retryDelay = 500;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Check if content script is available
      const isReady = await waitForContentScript(tabId, attempt === 0 ? 2000 : 500);

      if (!isReady) {
        // Get tab info to check if it's a restricted page
        const tab = await chrome.tabs.get(tabId);
        const tabUrl = tab.url || 'unknown';

        const isRestricted = tabUrl.startsWith('chrome://') ||
                            tabUrl.startsWith('chrome-extension://') ||
                            tabUrl.startsWith('about:') ||
                            tabUrl === 'chrome://newtab/';

        if (isRestricted) {
          return {
            url: tabUrl,
            title: tab.title || 'Restricted Page',
            interactiveElements: [],
            pageText: 'RESTRICTED PAGE: Cannot interact with this page. Use "navigate" action to go to a website first (e.g., navigate to https://google.com).',
          };
        }

        // Not restricted but content script not ready - try to inject it
        console.log(`[Background] Content script not ready on attempt ${attempt + 1}, attempting re-injection...`);
        const injected = await injectContentScriptIfNeeded(tabId);

        if (injected) {
          console.log('[Background] Content script injected, waiting for ready...');
          await sleep(500); // Give it time to initialize
          const nowReady = await waitForContentScript(tabId, 1000);

          if (!nowReady && attempt < maxRetries - 1) {
            console.log('[Background] Still not ready after injection, retrying...');
            await sleep(retryDelay);
            continue;
          }
        } else if (attempt < maxRetries - 1) {
          console.log(`[Background] Could not inject content script, retrying (${attempt + 1}/${maxRetries})...`);
          await sleep(retryDelay);
          continue;
        }
      }

      // Try to get DOM state
      const result = await new Promise<DOMState>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: 'GET_DOM_STATE' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (response?.success && response.data) {
            resolve(response.data);
          } else {
            reject(new Error(response?.error || 'Failed to get DOM state'));
          }
        });
      });

      return result;
    } catch (error) {
      console.error(`[Background] getDOMState attempt ${attempt + 1} failed:`, error);

      if (attempt < maxRetries - 1) {
        await sleep(retryDelay);
      }
    }
  }

  // All retries failed - return error state with detailed guidance
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || 'unknown';

    // Provide specific guidance based on context
    let errorMessage = '⚠️ CONTENT SCRIPT ERROR\n\n';
    errorMessage += 'Could not communicate with the page after multiple attempts.\n\n';
    errorMessage += 'This usually happens when:\n';
    errorMessage += '• The page is still loading or refreshing\n';
    errorMessage += '• The page blocked the extension\n';
    errorMessage += '• The page navigation destroyed the content script\n';
    errorMessage += '• The page uses strict Content Security Policy\n\n';
    errorMessage += 'What to try:\n';
    errorMessage += '✓ Refresh the page and try again\n';
    errorMessage += '✓ Make sure you\'re on a normal website (not chrome:// pages)\n';
    errorMessage += '✓ Try navigating to a different page first\n';
    errorMessage += '✓ Check if the site allows extensions\n\n';
    errorMessage += `Current URL: ${url}`;

    return {
      url,
      title: tab.title || 'Error loading page',
      interactiveElements: [],
      pageText: errorMessage,
    };
  } catch {
    return {
      url: 'unknown',
      title: 'Communication Error',
      interactiveElements: [],
      pageText: '⚠️ FATAL ERROR: Could not communicate with the tab. The tab may have been closed.',
    };
  }
}

// ============================================================================
// Action Execution
// ============================================================================

async function executeAction(
  tabId: number,
  actionType: string,
  params: Record<string, string>
): Promise<ActionResult> {
  console.log('[Background] Executing action:', actionType, params);

  // Handle navigation specially - it changes the page
  if (actionType === 'navigate') {
    return executeNavigation(tabId, params.url);
  }

  // Ensure content script is loaded
  await ensureContentScriptLoaded(tabId);

  // Execute other actions via message passing
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'EXECUTE_ACTION', payload: { actionType, params } },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message || 'Failed to execute action',
          });
          return;
        }

        resolve(response || { success: false, error: 'No response from content script' });
      }
    );
  });
}

async function executeNavigation(tabId: number, url: string): Promise<ActionResult> {
  try {
    // Ensure URL has protocol
    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    console.log('[Background] Navigating to:', targetUrl);
    await chrome.tabs.update(tabId, { url: targetUrl });
    await waitForTabLoad(tabId);

    // Wait for content script to become available after navigation
    console.log('[Background] Waiting for content script after navigation...');
    const isReady = await waitForContentScript(tabId, 3000);

    if (isReady) {
      console.log('[Background] Content script ready after navigation');
      return { success: true, data: `Navigated to ${targetUrl}` };
    } else {
      console.warn('[Background] Content script not ready after navigation, but page loaded');
      return { success: true, data: `Navigated to ${targetUrl} (content script may still be loading)` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wait for content script to become available with timeout
 * Returns true if content script is ready, false otherwise
 */
async function waitForContentScript(tabId: number, timeout: number = 2000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeout) {
    try {
      const isReady = await new Promise<boolean>((resolve) => {
        const timeoutId = setTimeout(() => resolve(false), pollInterval);

        chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            resolve(false);
          } else {
            resolve(response?.ok === true);
          }
        });
      });

      if (isReady) {
        return true;
      }

      await sleep(pollInterval);
    } catch {
      await sleep(pollInterval);
    }
  }

  return false;
}

async function ensureContentScriptLoaded(tabId: number): Promise<boolean> {
  const isReady = await waitForContentScript(tabId, 1000);

  if (!isReady) {
    console.warn('[Background] Content script not available in tab', tabId);
  }

  return isReady;
}

/**
 * Inject content script if it's not already loaded
 * Returns true if injection succeeded or script was already present
 */
async function injectContentScriptIfNeeded(tabId: number): Promise<boolean> {
  try {
    // First check if it's already loaded
    const alreadyLoaded = await waitForContentScript(tabId, 100);
    if (alreadyLoaded) {
      return true;
    }

    // Get tab info to check if injection is possible
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';

    // Cannot inject into restricted pages
    if (url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url === 'chrome://newtab/' ||
        url === '') {
      console.log('[Background] Cannot inject into restricted page:', url);
      return false;
    }

    console.log('[Background] Injecting content script into tab', tabId);

    // Inject the content script (use the loader file from manifest)
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['assets/index.ts-loader-DvRpSkcy.js'], // Content script loader
    });

    console.log('[Background] Content script injected successfully');
    return true;
  } catch (error) {
    console.error('[Background] Failed to inject content script:', error);
    return false;
  }
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete' && !resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        // Give page time to render
        setTimeout(resolve, POST_NAVIGATION_DELAY);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Timeout after max wait time
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, PAGE_LOAD_TIMEOUT);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Capture screenshot of the visible tab with GPU-accelerated compression
 * Returns base64 jpeg data URL or undefined if capture fails
 */
async function captureScreenshot(tabId: number): Promise<string | undefined> {
  try {
    // Get the window ID for this tab
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) {
      console.warn('[Background] No window ID for tab');
      return undefined;
    }

    // Capture the visible tab as jpeg
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 85, // Higher quality, we'll compress with GPU
    });

    const originalSize = Math.round(dataUrl.length / 1024);
    console.log('[Background] Screenshot captured, original size:', originalSize, 'KB');

    // GPU-accelerated compression and downscaling
    try {
      // Dynamic import to avoid loading in service worker context
      const { imageProcessor } = await import('../shared/image-processor');

      // Initialize GPU processor if not already done
      if (!await imageProcessor.initialize()) {
        console.warn('[Background] GPU not available, using original screenshot');
        return dataUrl;
      }

      // Process with GPU (downscale + compress)
      const processed = await imageProcessor.processImage(dataUrl, {
        maxWidth: 1280,
        maxHeight: 720,
        quality: 0.7,
        format: 'jpeg',
      });

      const newSize = Math.round(processed.processedSize / 1024);
      const ratio = processed.compressionRatio;

      console.log('[Background] Screenshot compressed:', {
        original: originalSize + ' KB',
        compressed: newSize + ' KB',
        ratio: ratio.toFixed(2) + 'x',
        time: processed.processingTime.toFixed(1) + 'ms',
      });

      return processed.dataUrl;
    } catch (error) {
      console.warn('[Background] GPU compression failed, using original:', error);
      return dataUrl;
    }
  } catch (error) {
    console.warn('[Background] Failed to capture screenshot:', error);
    return undefined;
  }
}

/**
 * Get DOM state with optional screenshot for VLM analysis
 */
export async function getDOMStateWithScreenshot(tabId: number): Promise<DOMState> {
  // Get base DOM state
  const domState = await getDOMState(tabId);

  // Capture screenshot
  const screenshot = await captureScreenshot(tabId);
  if (screenshot) {
    domState.screenshot = screenshot;
  }

  return domState;
}

// ============================================================================
// Content Script Ready Handler
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONTENT_SCRIPT_READY') {
    console.log('[Background] Content script ready in tab:', sender.tab?.id);
    sendResponse({ ok: true });
  } else if (message.type === 'PING') {
    sendResponse({ ok: true });
  } else if (message.type === 'VLM_PROGRESS') {
    // Forward VLM progress to vision engine
    visionEngine.handleProgressUpdate(message.progress);
    sendResponse({ ok: true });
  } else if (message.type === 'GET_STATE_MACHINE_STATUS') {
    // Phase 2.1: Return state machine status
    const status = stateRegistry.getStatus();
    sendResponse({ success: true, status });
  }
  return true;
});

// ============================================================================
// Extension Install Handler
// ============================================================================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason);
});

console.log('[Background] Service worker started');

// ============================================================================
// Side Panel Handler
// ============================================================================

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch((error) => {
      console.error('[Background] Failed to open side panel:', error);
    });
  }
});
