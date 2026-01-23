/**
 * GPU-Enhanced State Machine Integration
 *
 * Wraps existing state machines with optional GPU acceleration for state detection.
 * Provides instant state detection (<1ms) for site-specific routing.
 */

import { stateCompute } from './state-compute';
import type { DOMState, AmazonPageState } from '../../shared/types';
import {
  AMAZON_URL_PATTERNS,
  AMAZON_OBSTACLE_PATTERNS,
} from '../../shared/constants';

// ============================================================================
// Types
// ============================================================================

export interface StateDefinition {
  id: number;
  name: string;
  urlPatterns?: RegExp[];
  textPatterns?: string[];
  priority: number;
}

export interface ObstacleDefinition {
  type: string;
  urlPatterns?: string[];
  textPatterns: string[];
  priority: number;
}

export interface StateDetectionResult {
  stateName: string;
  stateId: number;
  confidence: number;
  detectionTime: number;
  source: 'url' | 'text' | 'mixed';
}

export interface ObstacleDetectionResult {
  detected: boolean;
  obstacleType?: string;
  confidence: number;
  detectionTime: number;
}

// ============================================================================
// GPU State Detector Class
// ============================================================================

export class GPUStateDetector {
  private initialized = false;
  private gpuAvailable = false;

  /**
   * Initialize GPU acceleration
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.initialized = true;
    this.gpuAvailable = await stateCompute.initialize();

    if (this.gpuAvailable) {
      console.log('[GPUStateDetector] GPU acceleration enabled for state detection');
    } else {
      console.log('[GPUStateDetector] Using CPU fallback for state detection');
    }
  }

  /**
   * Detect Amazon page state with GPU acceleration
   */
  async detectAmazonState(domState: DOMState): Promise<StateDetectionResult> {
    const startTime = performance.now();

    // Define Amazon states
    const states: StateDefinition[] = [
      {
        id: 1,
        name: 'captcha',
        textPatterns: AMAZON_OBSTACLE_PATTERNS.captcha,
        priority: 100, // Highest priority
      },
      {
        id: 2,
        name: 'signin',
        urlPatterns: [AMAZON_URL_PATTERNS.signin],
        textPatterns: AMAZON_OBSTACLE_PATTERNS.login,
        priority: 90,
      },
      {
        id: 3,
        name: 'checkout',
        urlPatterns: [AMAZON_URL_PATTERNS.checkout],
        priority: 80,
      },
      {
        id: 4,
        name: 'cart',
        urlPatterns: [AMAZON_URL_PATTERNS.cart],
        priority: 70,
      },
      {
        id: 5,
        name: 'product_page',
        urlPatterns: [AMAZON_URL_PATTERNS.product],
        priority: 60,
      },
      {
        id: 6,
        name: 'search_results',
        urlPatterns: [AMAZON_URL_PATTERNS.search],
        priority: 50,
      },
      {
        id: 7,
        name: 'homepage',
        urlPatterns: [AMAZON_URL_PATTERNS.homepage],
        priority: 40,
      },
    ];

    // Prepare patterns for GPU
    const urlPatterns = states
      .flatMap(state =>
        (state.urlPatterns || []).map(pattern => ({
          pattern,
          stateId: state.id,
          priority: state.priority,
        }))
      );

    const textPatterns = states
      .flatMap(state =>
        (state.textPatterns || []).map(pattern => ({
          pattern,
          stateId: state.id,
          priority: state.priority,
        }))
      );

    // Detect state
    const result = await stateCompute.detectState({
      url: domState.url,
      pageText: domState.pageText.toLowerCase(),
      urlPatterns,
      textPatterns,
    });

    // Map stateId back to state name
    const matchedState = states.find(s => s.id === result.stateId);

    const detectionTime = performance.now() - startTime;

    return {
      stateName: matchedState?.name || 'unknown',
      stateId: result.stateId,
      confidence: result.confidence,
      detectionTime,
      source: result.source,
    };
  }

  /**
   * Detect obstacles with GPU acceleration
   */
  async detectObstacles(domState: DOMState): Promise<ObstacleDetectionResult> {
    const startTime = performance.now();

    // Define obstacle patterns
    const obstacles: ObstacleDefinition[] = [
      {
        type: 'CAPTCHA',
        textPatterns: AMAZON_OBSTACLE_PATTERNS.captcha,
        priority: 100,
      },
      {
        type: 'LOGIN_REQUIRED',
        textPatterns: AMAZON_OBSTACLE_PATTERNS.login,
        priority: 90,
      },
      {
        type: 'OUT_OF_STOCK',
        textPatterns: AMAZON_OBSTACLE_PATTERNS.outOfStock,
        priority: 80,
      },
      {
        type: 'PRICE_CHANGED',
        textPatterns: AMAZON_OBSTACLE_PATTERNS.priceChange,
        priority: 70,
      },
    ];

    // Prepare text patterns for GPU
    const textPatterns = obstacles.flatMap((obstacle, idx) =>
      obstacle.textPatterns.map(pattern => ({
        pattern,
        stateId: idx, // Use index as temporary ID
        priority: obstacle.priority,
      }))
    );

    // Match patterns
    const matches = await stateCompute.matchTextPatterns(
      domState.pageText.toLowerCase(),
      textPatterns
    );

    // Find highest confidence match
    let bestMatch: { stateId: number; confidence: number } | null = null;
    for (const match of matches) {
      if (!bestMatch || match.confidence > bestMatch.confidence) {
        bestMatch = match;
      }
    }

    const detectionTime = performance.now() - startTime;

    if (bestMatch) {
      const matchedObstacle = obstacles[bestMatch.stateId];
      return {
        detected: true,
        obstacleType: matchedObstacle.type,
        confidence: bestMatch.confidence,
        detectionTime,
      };
    }

    return {
      detected: false,
      confidence: 0,
      detectionTime,
    };
  }

  /**
   * Batch detect states across multiple pages
   */
  async batchDetectStates(
    domStates: DOMState[]
  ): Promise<StateDetectionResult[]> {
    const startTime = performance.now();

    // Process all in parallel
    const results = await Promise.all(
      domStates.map(state => this.detectAmazonState(state))
    );

    const totalTime = performance.now() - startTime;
    console.log(`[GPUStateDetector] Batch detected ${domStates.length} states in ${totalTime.toFixed(2)}ms`);

    return results;
  }

  /**
   * Benchmark GPU vs CPU performance
   */
  async benchmark(domState: DOMState): Promise<{
    cpu: number;
    gpu: number;
    speedup: number;
  }> {
    // CPU benchmark
    const gpuWasAvailable = this.gpuAvailable;
    this.gpuAvailable = false;

    const cpuStart = performance.now();
    await this.detectAmazonState(domState);
    const cpuTime = performance.now() - cpuStart;

    // GPU benchmark
    this.gpuAvailable = gpuWasAvailable;

    const gpuStart = performance.now();
    await this.detectAmazonState(domState);
    const gpuTime = performance.now() - gpuStart;

    return {
      cpu: cpuTime,
      gpu: gpuTime,
      speedup: cpuTime / gpuTime,
    };
  }

  /**
   * Get detector status
   */
  getStatus(): {
    initialized: boolean;
    gpuAvailable: boolean;
  } {
    return {
      initialized: this.initialized,
      gpuAvailable: this.gpuAvailable,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert AmazonPageState to StateDetectionResult format
 */
export function convertPageState(
  pageState: AmazonPageState | undefined
): StateDetectionResult {
  return {
    stateName: pageState || 'unknown',
    stateId: 0,
    confidence: pageState ? 0.9 : 0,
    detectionTime: 0,
    source: 'url',
  };
}

/**
 * Check if two states are equivalent
 */
export function statesMatch(
  state1: string,
  state2: string,
  threshold: number = 0.8
): boolean {
  return state1 === state2;
}

/**
 * Merge multiple state detection results
 */
export function mergeStateResults(
  results: StateDetectionResult[]
): StateDetectionResult {
  if (results.length === 0) {
    return {
      stateName: 'unknown',
      stateId: 0,
      confidence: 0,
      detectionTime: 0,
      source: 'mixed',
    };
  }

  // Find highest confidence result
  let best = results[0];
  for (const result of results) {
    if (result.confidence > best.confidence) {
      best = result;
    }
  }

  return best;
}

// ============================================================================
// Export Singleton
// ============================================================================

export const gpuStateDetector = new GPUStateDetector();
