/**
 * Token Processor
 *
 * High-level API for GPU-accelerated token preprocessing.
 * Integrates with Transformers.js and WebLLM for faster inference.
 */

import { tokenCompute } from './token-compute';

// ============================================================================
// Types
// ============================================================================

export interface TokenizationResult {
  tokenIds: Uint32Array;
  attentionMask: Uint32Array;
  positionIds: Uint32Array;
  actualLength: number;
  processingTime: number;
}

export interface BatchTokenizationResult {
  tokenIds: Uint32Array[];
  attentionMasks: Uint32Array[];
  positionIds: Uint32Array[];
  processingTime: number;
}

export interface TextPreprocessingOptions {
  maxLength?: number;
  normalize?: boolean;
  lowercase?: boolean;
  padTokenId?: number;
  bosTokenId?: number;
  eosTokenId?: number;
}

// ============================================================================
// Token Processor Class
// ============================================================================

export class TokenProcessor {
  private initialized = false;
  private gpuAvailable = false;

  /**
   * Initialize GPU acceleration for token processing
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.initialized = true;
    this.gpuAvailable = await tokenCompute.initialize();

    if (this.gpuAvailable) {
      console.log('[TokenProcessor] GPU acceleration enabled');
    } else {
      console.log('[TokenProcessor] Using CPU fallback');
    }
  }

  /**
   * Preprocess text tokens with GPU acceleration
   *
   * Takes pre-tokenized IDs and generates attention masks and position IDs
   */
  async preprocessTokens(
    tokenIds: number[],
    options: TextPreprocessingOptions = {}
  ): Promise<TokenizationResult> {
    const startTime = performance.now();

    const maxLength = options.maxLength || 512;
    const padTokenId = options.padTokenId || 0;
    const actualLength = tokenIds.length;

    // Convert to Uint32Array
    let tokenArray = new Uint32Array(tokenIds);

    // Pad if needed
    if (tokenArray.length < maxLength) {
      const padded = new Uint32Array(maxLength);
      padded.fill(padTokenId);
      padded.set(tokenArray);
      tokenArray = padded;
    } else if (tokenArray.length > maxLength) {
      tokenArray = tokenArray.slice(0, maxLength);
    }

    // Generate attention mask (GPU accelerated)
    const attentionMask = await tokenCompute.generateAttentionMask(
      tokenArray,
      actualLength,
      padTokenId
    );

    // Generate position IDs (GPU accelerated)
    const positionIds = await tokenCompute.generatePositionIds(tokenArray.length);

    const processingTime = performance.now() - startTime;

    console.log(`[TokenProcessor] Preprocessed ${actualLength} tokens in ${processingTime.toFixed(2)}ms`);

    return {
      tokenIds: tokenArray,
      attentionMask,
      positionIds,
      actualLength,
      processingTime,
    };
  }

  /**
   * Batch preprocess multiple token sequences (GPU accelerated)
   */
  async batchPreprocessTokens(
    tokenSequences: number[][],
    options: TextPreprocessingOptions = {}
  ): Promise<BatchTokenizationResult> {
    const startTime = performance.now();

    const maxLength = options.maxLength || 512;
    const padTokenId = options.padTokenId || 0;

    // Convert to Uint32Arrays
    const tokenArrays = tokenSequences.map(seq => new Uint32Array(seq));

    // Batch pad sequences (GPU accelerated)
    const paddedArrays = await tokenCompute.batchPadSequences(
      tokenArrays,
      maxLength,
      padTokenId
    );

    // Generate attention masks for each sequence (parallel GPU calls)
    const attentionMasks = await Promise.all(
      paddedArrays.map((tokens, i) =>
        tokenCompute.generateAttentionMask(
          tokens,
          tokenArrays[i].length,
          padTokenId
        )
      )
    );

    // Generate position IDs (can reuse for all sequences of same length)
    const positionIds = await tokenCompute.generatePositionIds(maxLength);
    const positionIdsArray = new Array(paddedArrays.length).fill(positionIds);

    const processingTime = performance.now() - startTime;

    console.log(`[TokenProcessor] Batch processed ${tokenSequences.length} sequences in ${processingTime.toFixed(2)}ms`);

    return {
      tokenIds: paddedArrays,
      attentionMasks,
      positionIds: positionIdsArray,
      processingTime,
    };
  }

  /**
   * Normalize text for tokenization
   *
   * CPU-based for now (Unicode normalization is complex for GPU)
   */
  normalizeText(text: string, options: TextPreprocessingOptions = {}): string {
    let normalized = text;

    // Unicode normalization (NFC)
    if (options.normalize !== false) {
      normalized = normalized.normalize('NFC');
    }

    // Lowercase
    if (options.lowercase) {
      normalized = normalized.toLowerCase();
    }

    // Clean whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }

  /**
   * Compute token statistics (GPU accelerated for large sequences)
   */
  async computeStats(tokenIds: number[]): Promise<{
    uniqueTokens: number;
    averageTokenId: number;
    maxTokenId: number;
    minTokenId: number;
    sequenceLength: number;
  }> {
    const tokenArray = new Uint32Array(tokenIds);
    const stats = await tokenCompute.computeTokenStats(tokenArray);

    return {
      ...stats,
      sequenceLength: tokenIds.length,
    };
  }

  /**
   * Create input tensors for LLM inference
   *
   * Wraps preprocessed tokens in a format suitable for Transformers.js
   */
  createInputTensors(result: TokenizationResult): {
    input_ids: number[][];
    attention_mask: number[][];
    position_ids: number[][];
  } {
    return {
      input_ids: [Array.from(result.tokenIds)],
      attention_mask: [Array.from(result.attentionMask)],
      position_ids: [Array.from(result.positionIds)],
    };
  }

  /**
   * Benchmark GPU vs CPU performance
   */
  async benchmark(sequenceLengths: number[] = [128, 256, 512, 1024]): Promise<{
    results: Array<{
      length: number;
      cpuTime: number;
      gpuTime: number;
      speedup: number;
    }>;
    averageSpeedup: number;
  }> {
    const results: Array<{
      length: number;
      cpuTime: number;
      gpuTime: number;
      speedup: number;
    }> = [];

    for (const length of sequenceLengths) {
      // Create dummy token sequence
      const tokens = Array.from({ length }, (_, i) => i % 1000);

      // CPU benchmark (disable GPU temporarily)
      const gpuWasAvailable = this.gpuAvailable;
      this.gpuAvailable = false;

      const cpuStart = performance.now();
      await this.preprocessTokens(tokens, { maxLength: length });
      const cpuTime = performance.now() - cpuStart;

      // GPU benchmark (re-enable)
      this.gpuAvailable = gpuWasAvailable;

      const gpuStart = performance.now();
      await this.preprocessTokens(tokens, { maxLength: length });
      const gpuTime = performance.now() - gpuStart;

      const speedup = cpuTime / gpuTime;

      results.push({
        length,
        cpuTime,
        gpuTime,
        speedup,
      });

      console.log(`[TokenProcessor] Benchmark ${length} tokens: CPU ${cpuTime.toFixed(2)}ms, GPU ${gpuTime.toFixed(2)}ms, Speedup: ${speedup.toFixed(2)}x`);
    }

    const averageSpeedup = results.reduce((sum, r) => sum + r.speedup, 0) / results.length;

    return {
      results,
      averageSpeedup,
    };
  }

  /**
   * Get processor status
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
// Utility Functions
// ============================================================================

/**
 * Simple byte-pair encoding tokenizer (for testing)
 * In production, use Transformers.js tokenizer
 */
export function simpleTokenize(text: string, vocabSize: number = 1000): number[] {
  const tokens: number[] = [];

  for (let i = 0; i < text.length; i++) {
    // Simple char code modulo vocab size
    tokens.push(text.charCodeAt(i) % vocabSize);
  }

  return tokens;
}

/**
 * Estimate token count for text (rough approximation)
 */
export function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 chars per token on average
  return Math.ceil(text.length / 4);
}

/**
 * Chunk text into segments that fit within max tokens
 */
export function chunkText(text: string, maxTokens: number = 512): string[] {
  const maxChars = maxTokens * 4; // Rough estimate
  const chunks: string[] = [];

  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }

  return chunks;
}

// ============================================================================
// Export Singleton
// ============================================================================

export const tokenProcessor = new TokenProcessor();
