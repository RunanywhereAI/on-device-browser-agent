/**
 * Real-Time Page Monitor
 *
 * Continuously monitors page for changes using GPU-accelerated change detection.
 * Enables reactive agent behavior by detecting DOM mutations in real-time.
 */

import { changeDetector, type ChangeDetectionResult } from './change-detector';
import { serializeDOMState } from './dom-observer';
import type { DOMState, InteractiveElement } from '../shared/types';

// ============================================================================
// Types
// ============================================================================

export interface PageChangeEvent {
  type: 'elements_added' | 'elements_removed' | 'elements_modified' | 'text_changed' | 'state_changed';
  timestamp: number;
  changes: ChangeDetectionResult;
  newState?: DOMState;
}

export interface MonitorConfig {
  pollInterval: number;        // Polling interval in ms (default: 500)
  enableGPU: boolean;          // Use GPU acceleration (default: true)
  detectText: boolean;         // Monitor text changes (default: true)
  detectElements: boolean;     // Monitor element changes (default: true)
  minChangeThreshold: number;  // Minimum changes to report (default: 1)
}

type ChangeListener = (event: PageChangeEvent) => void;

// ============================================================================
// Page Monitor Class
// ============================================================================

export class PageMonitor {
  private monitoring = false;
  private pollInterval: number = 500;
  private listeners: Set<ChangeListener> = new Set();
  private config: MonitorConfig;
  private lastState: DOMState | null = null;
  private lastElements: InteractiveElement[] = [];
  private lastPageText: string = '';
  private intervalId: number | null = null;
  private initialized = false;

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = {
      pollInterval: config.pollInterval || 500,
      enableGPU: config.enableGPU !== false,
      detectText: config.detectText !== false,
      detectElements: config.detectElements !== false,
      minChangeThreshold: config.minChangeThreshold || 1,
    };
    this.pollInterval = this.config.pollInterval;
  }

  /**
   * Initialize the page monitor
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.enableGPU) {
      const gpuReady = await changeDetector.initialize();
      if (!gpuReady) {
        console.warn('[PageMonitor] GPU not available, using CPU fallback');
      }
    }

    this.initialized = true;
    console.log('[PageMonitor] Initialized');
  }

  /**
   * Start monitoring the page for changes
   */
  async start(): Promise<void> {
    if (this.monitoring) {
      console.warn('[PageMonitor] Already monitoring');
      return;
    }

    if (!this.initialized) {
      await this.initialize();
    }

    // Capture initial state
    this.lastState = serializeDOMState();
    this.lastElements = this.lastState.interactiveElements;
    this.lastPageText = this.lastState.pageText;

    this.monitoring = true;

    // Start polling
    this.intervalId = window.setInterval(() => {
      this.checkForChanges();
    }, this.pollInterval);

    console.log(`[PageMonitor] Started monitoring (interval: ${this.pollInterval}ms)`);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.monitoring) return;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.monitoring = false;
    console.log('[PageMonitor] Stopped monitoring');
  }

  /**
   * Subscribe to page change events
   */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get monitoring status
   */
  getStatus(): {
    monitoring: boolean;
    initialized: boolean;
    pollInterval: number;
    listenerCount: number;
  } {
    return {
      monitoring: this.monitoring,
      initialized: this.initialized,
      pollInterval: this.pollInterval,
      listenerCount: this.listeners.size,
    };
  }

  /**
   * Manually trigger a change check
   */
  async checkNow(): Promise<PageChangeEvent[]> {
    const events: PageChangeEvent[] = [];

    if (this.config.detectElements) {
      const elementEvent = await this.checkElementChanges();
      if (elementEvent) events.push(elementEvent);
    }

    if (this.config.detectText) {
      const textEvent = await this.checkTextChanges();
      if (textEvent) events.push(textEvent);
    }

    return events;
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(config: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.pollInterval) {
      this.pollInterval = config.pollInterval;
      if (this.monitoring) {
        this.stop();
        this.start();
      }
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Check for changes (called by interval)
   */
  private async checkForChanges(): Promise<void> {
    if (!this.monitoring) return;

    try {
      const events = await this.checkNow();

      // Emit events to listeners
      for (const event of events) {
        this.emit(event);
      }
    } catch (error) {
      console.error('[PageMonitor] Error checking for changes:', error);
    }
  }

  /**
   * Check for element changes
   */
  private async checkElementChanges(): Promise<PageChangeEvent | null> {
    const currentState = serializeDOMState();
    const currentElements = currentState.interactiveElements;

    // Detect changes with GPU acceleration
    const changes = await changeDetector.detectChanges(
      this.lastElements,
      currentElements
    );

    // Check if changes meet threshold
    const totalChanges = changes.added.length + changes.removed.length + changes.modified.length;
    if (totalChanges < this.config.minChangeThreshold) {
      return null;
    }

    // Update last state
    this.lastElements = currentElements;
    this.lastState = currentState;

    // Determine event type
    let eventType: PageChangeEvent['type'] = 'elements_modified';
    if (changes.added.length > 0) {
      eventType = 'elements_added';
    } else if (changes.removed.length > 0) {
      eventType = 'elements_removed';
    }

    return {
      type: eventType,
      timestamp: Date.now(),
      changes,
      newState: currentState,
    };
  }

  /**
   * Check for text content changes
   */
  private async checkTextChanges(): Promise<PageChangeEvent | null> {
    const currentState = serializeDOMState();
    const currentText = currentState.pageText;

    // Quick check: if identical, no change
    if (currentText === this.lastPageText) {
      return null;
    }

    // Detect text changes
    const textChanges = await changeDetector.detectTextChanges(
      this.lastPageText,
      currentText
    );

    if (!textChanges.changed) {
      return null;
    }

    // Update last text
    this.lastPageText = currentText;
    this.lastState = currentState;

    return {
      type: 'text_changed',
      timestamp: Date.now(),
      changes: {
        added: [],
        removed: [],
        modified: [],
        hasChanges: true,
        detectionTime: 0,
      },
      newState: currentState,
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: PageChangeEvent): void {
    console.log(`[PageMonitor] Change detected: ${event.type}`, {
      added: event.changes.added.length,
      removed: event.changes.removed.length,
      modified: event.changes.modified.length,
      detectionTime: event.changes.detectionTime?.toFixed(2) + 'ms',
    });

    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[PageMonitor] Listener error:', error);
      }
    });
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a page monitor with default configuration
 */
export function createPageMonitor(config?: Partial<MonitorConfig>): PageMonitor {
  return new PageMonitor(config);
}

/**
 * Simple change monitor that just tracks if page has changed
 */
export async function hasPageChanged(
  oldState: DOMState,
  newState: DOMState
): Promise<boolean> {
  const changes = await changeDetector.detectChanges(
    oldState.interactiveElements,
    newState.interactiveElements
  );

  const textChanged = oldState.pageText !== newState.pageText;

  return changes.hasChanges || textChanged;
}

/**
 * Get page change statistics
 */
export function getChangeStats(changes: ChangeDetectionResult): {
  totalChanges: number;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  detectionTime: number;
} {
  return {
    totalChanges: changes.added.length + changes.removed.length + changes.modified.length,
    addedCount: changes.added.length,
    removedCount: changes.removed.length,
    modifiedCount: changes.modified.length,
    detectionTime: changes.detectionTime,
  };
}

/**
 * Format change event as human-readable string
 */
export function formatChangeEvent(event: PageChangeEvent): string {
  const stats = getChangeStats(event.changes);

  switch (event.type) {
    case 'elements_added':
      return `${stats.addedCount} element(s) added`;
    case 'elements_removed':
      return `${stats.removedCount} element(s) removed`;
    case 'elements_modified':
      return `${stats.modifiedCount} element(s) modified`;
    case 'text_changed':
      return 'Page text content changed';
    case 'state_changed':
      return 'Page state changed';
    default:
      return 'Page changed';
  }
}

// ============================================================================
// Export Default Monitor Instance
// ============================================================================

export const pageMonitor = new PageMonitor();
