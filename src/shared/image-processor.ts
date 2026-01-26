/**
 * GPU-Accelerated Image Processing
 *
 * Uses WebGPU for fast image downscaling and preprocessing.
 * Reduces screenshot size and improves vision mode performance.
 */

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
// GPU Image Processor
// ============================================================================

export class GPUImageProcessor {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private initialized = false;

  /**
   * Initialize WebGPU for image processing
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      if (!navigator.gpu) {
        console.warn('[ImageProcessor] WebGPU not available');
        return false;
      }

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        console.warn('[ImageProcessor] No GPU adapter found');
        return false;
      }

      this.device = await adapter.requestDevice();

      // Create downscaling compute pipeline
      this.pipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: this.device.createShaderModule({
            code: downscaleShader,
          }),
          entryPoint: 'main',
        },
      });

      this.initialized = true;
      console.log('[ImageProcessor] GPU initialized successfully');
      return true;
    } catch (error) {
      console.error('[ImageProcessor] Failed to initialize WebGPU:', error);
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
    if (this.initialized && this.device && this.pipeline) {
      try {
        const result = await this.gpuProcess(dataUrl, options);
        return {
          ...result,
          originalSize,
          processingTime: performance.now() - startTime,
        };
      } catch (error) {
        console.warn('[ImageProcessor] GPU processing failed, falling back to CPU:', error);
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
   * GPU-accelerated image processing
   */
  private async gpuProcess(
    dataUrl: string,
    options: ImageProcessingOptions
  ): Promise<Omit<ProcessedImage, 'originalSize' | 'processingTime'>> {
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
      processedData = await this.gpuDownscale(
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
   * GPU downscaling using compute shader
   */
  private async gpuDownscale(
    imageData: ImageData,
    targetWidth: number,
    targetHeight: number
  ): Promise<ImageData> {
    if (!this.device || !this.pipeline) {
      throw new Error('GPU not initialized');
    }

    const { width: srcWidth, height: srcHeight } = imageData;

    // Create input buffer
    const inputBuffer = this.device.createBuffer({
      size: imageData.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(inputBuffer, 0, imageData.data);

    // Create output buffer
    const outputSize = targetWidth * targetHeight * 4;
    const outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Create staging buffer for reading results
    const stagingBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create uniform buffer for dimensions
    const uniformData = new Uint32Array([srcWidth, srcHeight, targetWidth, targetHeight]);
    const uniformBuffer = this.device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: inputBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
      ],
    });

    // Execute compute shader
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(
      Math.ceil(targetWidth / 8),
      Math.ceil(targetHeight / 8)
    );
    passEncoder.end();

    // Copy to staging buffer
    commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputSize);
    this.device.queue.submit([commandEncoder.finish()]);

    // Read results
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const outputData = new Uint8ClampedArray(
      stagingBuffer.getMappedRange().slice(0)
    );
    stagingBuffer.unmap();

    // Cleanup
    inputBuffer.destroy();
    outputBuffer.destroy();
    stagingBuffer.destroy();
    uniformBuffer.destroy();

    return new ImageData(outputData, targetWidth, targetHeight);
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
// Compute Shader for Downscaling
// ============================================================================

const downscaleShader = `
struct Dimensions {
  src_width: u32,
  src_height: u32,
  dst_width: u32,
  dst_height: u32,
}

@group(0) @binding(0) var<uniform> dims: Dimensions;
@group(0) @binding(1) var<storage, read> input: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let dst_x = global_id.x;
  let dst_y = global_id.y;

  if (dst_x >= dims.dst_width || dst_y >= dims.dst_height) {
    return;
  }

  // Calculate source position (bilinear sampling)
  let x_ratio = f32(dims.src_width) / f32(dims.dst_width);
  let y_ratio = f32(dims.src_height) / f32(dims.dst_height);

  let src_x = f32(dst_x) * x_ratio;
  let src_y = f32(dst_y) * y_ratio;

  let x0 = u32(floor(src_x));
  let y0 = u32(floor(src_y));
  let x1 = min(x0 + 1u, dims.src_width - 1u);
  let y1 = min(y0 + 1u, dims.src_height - 1u);

  let fx = fract(src_x);
  let fy = fract(src_y);

  // Sample 4 pixels
  let idx00 = y0 * dims.src_width + x0;
  let idx10 = y0 * dims.src_width + x1;
  let idx01 = y1 * dims.src_width + x0;
  let idx11 = y1 * dims.src_width + x1;

  // Bilinear interpolation for each channel
  let p00 = unpackRGBA(input[idx00]);
  let p10 = unpackRGBA(input[idx10]);
  let p01 = unpackRGBA(input[idx01]);
  let p11 = unpackRGBA(input[idx11]);

  let top = mix(p00, p10, fx);
  let bottom = mix(p01, p11, fx);
  let result = mix(top, bottom, fy);

  let dst_idx = dst_y * dims.dst_width + dst_x;
  output[dst_idx] = packRGBA(result);
}

fn unpackRGBA(packed: u32) -> vec4<f32> {
  return vec4<f32>(
    f32((packed >> 0u) & 0xFFu) / 255.0,
    f32((packed >> 8u) & 0xFFu) / 255.0,
    f32((packed >> 16u) & 0xFFu) / 255.0,
    f32((packed >> 24u) & 0xFFu) / 255.0,
  );
}

fn packRGBA(color: vec4<f32>) -> u32 {
  let r = u32(clamp(color.r * 255.0, 0.0, 255.0));
  let g = u32(clamp(color.g * 255.0, 0.0, 255.0));
  let b = u32(clamp(color.b * 255.0, 0.0, 255.0));
  let a = u32(clamp(color.a * 255.0, 0.0, 255.0));
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}
`;

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

export const imageProcessor = new GPUImageProcessor();
