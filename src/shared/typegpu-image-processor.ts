/**
 * TypeGPU-Enhanced Image Processing
 *
 * Type-safe GPU-accelerated image processing using TypeGPU.
 * Provides better development experience and compile-time type checking.
 */

import tgpu from 'typegpu';

// ============================================================================
// Types
// ============================================================================

export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'webp' | 'png';
}

export interface ProcessedImage {
  dataUrl: string;
  width: number;
  height: number;
  originalSize: number;
  processedSize: number;
  compressionRatio: number;
  processingTime: number;
}

// ============================================================================
// TypeGPU Schema Definitions
// ============================================================================

const DimensionsSchema = tgpu.struct({
  srcWidth: tgpu.u32,
  srcHeight: tgpu.u32,
  dstWidth: tgpu.u32,
  dstHeight: tgpu.u32,
});

// RGBA pixel data as u32 (packed)
const ImageDataSchema = tgpu.arrayOf(tgpu.u32);

// ============================================================================
// TypeGPU Image Processor
// ============================================================================

export class TypeGPUImageProcessor {
  private root: tgpu.TgpuRoot | null = null;
  private initialized = false;

  /**
   * Initialize TypeGPU for image processing
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      if (!navigator.gpu) {
        console.warn('[TypeGPUImageProcessor] WebGPU not available');
        return false;
      }

      this.root = await tgpu.init();
      this.initialized = true;
      console.log('[TypeGPUImageProcessor] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[TypeGPUImageProcessor] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Process image with GPU acceleration
   */
  async processImage(
    dataUrl: string,
    options: ImageProcessingOptions = {}
  ): Promise<ProcessedImage> {
    const startTime = performance.now();
    const originalSize = dataUrl.length;

    // Try GPU processing first
    if (this.initialized && this.root) {
      try {
        const result = await this.gpuProcess(dataUrl, options);
        return {
          ...result,
          originalSize,
          processingTime: performance.now() - startTime,
        };
      } catch (error) {
        console.warn('[TypeGPUImageProcessor] GPU processing failed, falling back to CPU:', error);
      }
    }

    // Fallback to CPU processing
    const result = await this.cpuProcess(dataUrl, options);
    return {
      ...result,
      originalSize,
      processingTime: performance.now() - startTime,
    };
  }

  /**
   * GPU-accelerated image processing with TypeGPU
   */
  private async gpuProcess(
    dataUrl: string,
    options: ImageProcessingOptions
  ): Promise<Omit<ProcessedImage, 'originalSize' | 'processingTime'>> {
    if (!this.root) throw new Error('TypeGPU not initialized');

    // Load image
    const img = await loadImage(dataUrl);
    const { width: originalWidth, height: originalHeight } = img;

    // Calculate target dimensions
    const { width: targetWidth, height: targetHeight } = calculateDimensions(
      originalWidth,
      originalHeight,
      options.maxWidth || 1280,
      options.maxHeight || 720
    );

    // Create canvas for GPU processing
    const canvas = new OffscreenCanvas(originalWidth, originalHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, originalWidth, originalHeight);

    // GPU downscaling (if size changed)
    let processedData: ImageData;
    if (targetWidth !== originalWidth || targetHeight !== originalHeight) {
      processedData = await this.typegpuDownscale(
        imageData,
        targetWidth,
        targetHeight
      );
    } else {
      processedData = imageData;
    }

    // Convert to desired format
    const outputCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    const outputCtx = outputCanvas.getContext('2d');
    if (!outputCtx) throw new Error('Failed to get output context');

    outputCtx.putImageData(processedData, 0, 0);

    const blob = await outputCanvas.convertToBlob({
      type: `image/${options.format || 'jpeg'}`,
      quality: options.quality || 0.7,
    });

    const processedDataUrl = await blobToDataUrl(blob);

    return {
      dataUrl: processedDataUrl,
      width: targetWidth,
      height: targetHeight,
      processedSize: processedDataUrl.length,
      compressionRatio: processedDataUrl.length / dataUrl.length,
    };
  }

  /**
   * Type-safe GPU downscaling using TypeGPU
   */
  private async typegpuDownscale(
    imageData: ImageData,
    targetWidth: number,
    targetHeight: number
  ): Promise<ImageData> {
    if (!this.root) throw new Error('TypeGPU not initialized');

    const { width: srcWidth, height: srcHeight } = imageData;

    // Pack RGBA data into u32 array
    const packedInput = new Uint32Array(srcWidth * srcHeight);
    for (let i = 0; i < srcWidth * srcHeight; i++) {
      const r = imageData.data[i * 4];
      const g = imageData.data[i * 4 + 1];
      const b = imageData.data[i * 4 + 2];
      const a = imageData.data[i * 4 + 3];
      packedInput[i] = r | (g << 8) | (b << 16) | (a << 24);
    }

    // Create type-safe buffers
    const dimsBuffer = this.root
      .createBuffer(DimensionsSchema)
      .$usage('uniform')
      .$value({
        srcWidth,
        srcHeight,
        dstWidth: targetWidth,
        dstHeight: targetHeight,
      });

    const inputBuffer = this.root
      .createBuffer(ImageDataSchema, srcWidth * srcHeight)
      .$usage('storage')
      .$initialData(packedInput);

    const outputBuffer = this.root
      .createBuffer(ImageDataSchema, targetWidth * targetHeight)
      .$usage('storage', 'copy-from');

    // Create compute kernel with TypeGPU
    const downscaleKernel = tgpu
      .kernel({
        workgroupSize: [8, 8, 1],
      })
      .withBindings({
        dims: dimsBuffer,
        input: inputBuffer,
        output: outputBuffer,
      })
      .implement(
        // TypeGPU will transpile this to WGSL
        ({ dims, input, output }, builtins) => {
          const globalId = builtins.globalInvocationId;
          const dstX = globalId.x;
          const dstY = globalId.y;

          // Bounds check
          if (dstX >= dims.dstWidth || dstY >= dims.dstHeight) {
            return;
          }

          // Calculate source position (bilinear sampling)
          const xRatio = dims.srcWidth / dims.dstWidth;
          const yRatio = dims.srcHeight / dims.dstHeight;

          const srcX = dstX * xRatio;
          const srcY = dstY * yRatio;

          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = Math.min(x0 + 1, dims.srcWidth - 1);
          const y1 = Math.min(y0 + 1, dims.srcHeight - 1);

          const fx = srcX - x0;
          const fy = srcY - y0;

          // Sample 4 pixels
          const idx00 = y0 * dims.srcWidth + x0;
          const idx10 = y0 * dims.srcWidth + x1;
          const idx01 = y1 * dims.srcWidth + x0;
          const idx11 = y1 * dims.srcWidth + x1;

          const p00 = unpackRGBA(input[idx00]);
          const p10 = unpackRGBA(input[idx10]);
          const p01 = unpackRGBA(input[idx01]);
          const p11 = unpackRGBA(input[idx11]);

          // Bilinear interpolation
          const top = lerp4(p00, p10, fx);
          const bottom = lerp4(p01, p11, fx);
          const result = lerp4(top, bottom, fy);

          const dstIdx = dstY * dims.dstWidth + dstX;
          output[dstIdx] = packRGBA(result);
        }
      );

    // Execute kernel
    await this.root.execute(downscaleKernel, {
      workgroups: [
        Math.ceil(targetWidth / 8),
        Math.ceil(targetHeight / 8),
        1,
      ],
    });

    // Read results
    const outputData = await outputBuffer.read();

    // Unpack u32 array back to RGBA
    const resultData = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    for (let i = 0; i < targetWidth * targetHeight; i++) {
      const packed = outputData[i];
      resultData[i * 4] = packed & 0xff;
      resultData[i * 4 + 1] = (packed >> 8) & 0xff;
      resultData[i * 4 + 2] = (packed >> 16) & 0xff;
      resultData[i * 4 + 3] = (packed >> 24) & 0xff;
    }

    // Cleanup
    dimsBuffer.destroy();
    inputBuffer.destroy();
    outputBuffer.destroy();

    return new ImageData(resultData, targetWidth, targetHeight);
  }

  /**
   * CPU fallback for image processing
   */
  private async cpuProcess(
    dataUrl: string,
    options: ImageProcessingOptions
  ): Promise<Omit<ProcessedImage, 'originalSize' | 'processingTime'>> {
    const img = await loadImage(dataUrl);
    const { width: originalWidth, height: originalHeight } = img;

    const { width: targetWidth, height: targetHeight } = calculateDimensions(
      originalWidth,
      originalHeight,
      options.maxWidth || 1280,
      options.maxHeight || 720
    );

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');

    // Use high-quality downscaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob = await canvas.convertToBlob({
      type: `image/${options.format || 'jpeg'}`,
      quality: options.quality || 0.7,
    });

    const processedDataUrl = await blobToDataUrl(blob);

    return {
      dataUrl: processedDataUrl,
      width: targetWidth,
      height: targetHeight,
      processedSize: processedDataUrl.length,
      compressionRatio: processedDataUrl.length / dataUrl.length,
    };
  }
}

// ============================================================================
// Helper Functions (for WGSL transpilation)
// ============================================================================

// These functions will be transpiled to WGSL by TypeGPU
function unpackRGBA(packed: number): [number, number, number, number] {
  return [
    (packed & 0xff) / 255,
    ((packed >> 8) & 0xff) / 255,
    ((packed >> 16) & 0xff) / 255,
    ((packed >> 24) & 0xff) / 255,
  ];
}

function packRGBA(color: [number, number, number, number]): number {
  const r = Math.floor(Math.min(Math.max(color[0] * 255, 0), 255));
  const g = Math.floor(Math.min(Math.max(color[1] * 255, 0), 255));
  const b = Math.floor(Math.min(Math.max(color[2] * 255, 0), 255));
  const a = Math.floor(Math.min(Math.max(color[3] * 255, 0), 255));
  return r | (g << 8) | (b << 16) | (a << 24);
}

function lerp4(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number
): [number, number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

// ============================================================================
// Utility Functions
// ============================================================================

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function calculateDimensions(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (srcWidth <= maxWidth && srcHeight <= maxHeight) {
    return { width: srcWidth, height: srcHeight };
  }

  const ratio = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
  return {
    width: Math.round(srcWidth * ratio),
    height: Math.round(srcHeight * ratio),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ============================================================================
// Export Singleton
// ============================================================================

export const typegpuImageProcessor = new TypeGPUImageProcessor();
