/**
 * A LangChain chat model backed by on-device inference.
 *
 * This is a thin RPC client. It holds no engine state: every call is forwarded
 * over the port in `bridgeClient.ts` to the offscreen document, which owns the
 * WASM/WebGPU engine. That keeps it a drop-in peer of the cloud providers in
 * `createChatModel()` — the agent code above it cannot tell the difference.
 */

import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import { RunnableLambda, type Runnable } from '@langchain/core/runnables';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { generateStream } from './bridgeClient';
import type { RaChatMessage, RaGenerateOptions, RaImage } from './protocol';

export interface ChatRunAnywhereFields extends BaseChatModelParams {
  /** Catalog id, e.g. 'qwen3-4b-q4_k_m'. */
  readonly modelId: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
}

/**
 * Split LangChain's possibly-multimodal content into text and images.
 *
 * LangChain represents an image as `{type:'image_url', image_url:{url}}` where
 * the url is normally a `data:` URI. We keep those rather than discarding them,
 * so a vision model genuinely receives the screenshot; a text-only model never
 * has images attached in the first place, because the caller decides whether to
 * capture one.
 */
function splitContent(content: BaseMessage['content']): { text: string; images: RaImage[] } {
  if (typeof content === 'string') return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: '', images: [] };

  const texts: string[] = [];
  const images: RaImage[] = [];

  for (const part of content) {
    if (typeof part === 'string') {
      texts.push(part);
      continue;
    }
    if (!part || typeof part !== 'object' || !('type' in part)) continue;

    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      texts.push(part.text);
      continue;
    }

    if (part.type === 'image_url' && 'image_url' in part) {
      const raw = part.image_url as string | { url?: string } | undefined;
      const url = typeof raw === 'string' ? raw : raw?.url;
      if (!url) continue;
      const parsed = parseDataUrl(url);
      if (parsed) images.push(parsed);
    }
  }

  return { text: texts.join('\n'), images };
}

/**
 * Pull a base64 image out of a `data:` URI.
 *
 * Dimensions are unknown at this layer — only the capturing side knows what it
 * resized to — so they are reported as 0 and must be supplied by the caller
 * when coordinates matter. Encoding a guess here would be worse than admitting
 * ignorance, because the coordinate maths would silently scale against it.
 */
function parseDataUrl(url: string): RaImage | null {
  // [\s\S] rather than the `s` (dotAll) flag: this package compiles without an
  // explicit tsconfig `target`, which defaults below ES2018 where that flag is
  // a compile error. Base64 has no newlines in practice, but a data URI can be
  // wrapped, so the payload must be matched across lines either way.
  const match = /^data:(image\/(?:png|jpeg));base64,([\s\S]*)$/.exec(url);
  if (!match) return null;
  return {
    base64: match[2],
    mediaType: match[1] as RaImage['mediaType'],
    width: 0,
    height: 0,
  };
}

function toRaMessages(messages: BaseMessage[]): RaChatMessage[] {
  const converted = messages.map(message => {
    const { text, images } = splitContent(message.content);
    const role =
      message._getType() === 'system'
        ? ('system' as const)
        : message._getType() === 'ai'
          ? ('assistant' as const)
          : // A tool/function result is, to a model without a native tool
            // channel, just more context from the environment.
            ('user' as const);
    return { role, content: text, images };
  });

  // Keep images only on the most recent turn that has any. Re-sending every
  // historical screenshot would exhaust a small model's context within a few
  // steps, and the older ones are never what the next action depends on.
  const lastWithImages = converted.reduce((last, message, index) => (message.images.length > 0 ? index : last), -1);

  return converted.map((message, index) => {
    if (index === lastWithImages && message.images.length > 0) {
      return { role: message.role, content: message.content, images: message.images };
    }
    return { role: message.role, content: message.content };
  });
}

/** True when the value looks like a Zod schema rather than a JSON Schema object. */
function isZodSchema(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && '_def' in (schema as Record<string, unknown>);
}

/** Errors that mean "the schema could not be compiled to a grammar". */
function isGrammarCompileFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /gbnf|grammar|could not be compiled|unsupported keyword/i.test(message);
}

export class ChatRunAnywhere extends BaseChatModel {
  static lc_name(): string {
    return 'ChatRunAnywhere';
  }

  readonly modelId: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly topP: number;

  constructor(fields: ChatRunAnywhereFields) {
    super(fields);
    this.modelId = fields.modelId;
    this.maxTokens = fields.maxTokens ?? 4096;
    this.temperature = fields.temperature ?? 0.1;
    this.topP = fields.topP ?? 0.1;
  }

  _llmType(): string {
    return 'runanywhere';
  }

  private baseOptions(jsonSchema?: string): RaGenerateOptions {
    return {
      model: this.modelId,
      maxOutputTokens: this.maxTokens,
      temperature: this.temperature,
      topP: this.topP,
      jsonSchema,
    };
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const { text, tokensPerSecond, outputTokens } = await this.collect(
      messages,
      this.baseOptions(),
      options.signal,
      runManager,
    );

    return {
      generations: [{ text, message: new AIMessage({ content: text }) }],
      llmOutput: { tokenUsage: { completionTokens: outputTokens }, tokensPerSecond },
    };
  }

  /**
   * Token streaming, so the side panel can render text as it arrives rather
   * than waiting for a whole step.
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const stream = generateStream(toRaMessages(messages), this.baseOptions(), options.signal ?? undefined);
    for await (const event of stream) {
      if (event.type !== 'delta') continue;
      await runManager?.handleLLMNewToken(event.text);
      yield new ChatGenerationChunk({
        text: event.text,
        message: new AIMessageChunk({ content: event.text }),
      });
    }
  }

  private async collect(
    messages: BaseMessage[],
    generateOptions: RaGenerateOptions,
    signal: AbortSignal | undefined,
    runManager?: CallbackManagerForLLMRun,
  ): Promise<{ text: string; tokensPerSecond?: number; outputTokens?: number }> {
    let text = '';
    let tokensPerSecond: number | undefined;
    let outputTokens: number | undefined;

    for await (const event of generateStream(toRaMessages(messages), generateOptions, signal)) {
      if (event.type === 'delta') {
        text += event.text;
        await runManager?.handleLLMNewToken(event.text);
      } else if (event.type === 'done') {
        tokensPerSecond = event.result.tokensPerSecond;
        outputTokens = event.result.outputTokens;
        // The final result is authoritative; prefer it over accumulated deltas.
        if (event.result.text) text = event.result.text;
      }
    }

    return { text, tokensPerSecond, outputTokens };
  }

  /**
   * Structured output via grammar-constrained decoding.
   *
   * The base class would fall back to prompting-and-hoping (or to a
   * function-calling channel this model does not have). We can do better: the
   * schema is compiled to a GBNF grammar inside the engine and used to
   * constrain sampling, which makes schema-invalid output *structurally
   * impossible* rather than something to detect and retry. That is what makes a
   * 4B model dependable as an agent, where a malformed action object costs a
   * whole step.
   *
   * The grammar compiler supports a subset of JSON Schema, and by contract the
   * engine fails the call rather than silently degrading to free generation. So
   * if compilation fails we retry once unconstrained and parse the text — the
   * caller still gets an answer, just without the guarantee.
   */
  withStructuredOutput<RunOutput extends Record<string, unknown> = Record<string, unknown>>(
    outputSchema: unknown,
    config?: { includeRaw?: boolean; name?: string },
  ): Runnable<BaseLanguageModelInput, RunOutput> {
    const jsonSchema = isZodSchema(outputSchema)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zodToJsonSchema(outputSchema as any)
      : (outputSchema as Record<string, unknown>);
    const schemaText = JSON.stringify(jsonSchema);
    const includeRaw = config?.includeRaw ?? false;

    const run = async (input: BaseLanguageModelInput) => {
      const messages = this._convertInputToMessageArray(input);

      let text: string;
      try {
        text = (await this.collect(messages, this.baseOptions(schemaText), undefined)).text;
      } catch (error) {
        if (!isGrammarCompileFailure(error)) throw error;
        // Schema outside the grammar compiler's subset. Fall back rather than
        // failing the step, and make the downgrade visible.
        console.warn(
          '[ChatRunAnywhere] Schema could not be compiled to a grammar; ' +
            'retrying unconstrained. Structured output is not guaranteed for this call.',
          error,
        );
        text = (await this.collect(messages, this.baseOptions(), undefined)).text;
      }

      const parsed = JSON.parse(text) as RunOutput;
      return includeRaw ? { raw: new AIMessage({ content: text }), parsed } : parsed;
    };

    // The base class declares four overloads of this method whose return type
    // depends on `includeRaw`, which is a runtime value here. Assert once, at
    // the boundary, rather than threading conditional types through.
    return RunnableLambda.from(run) as unknown as Runnable<BaseLanguageModelInput, RunOutput>;
  }

  /** Normalise LangChain's several accepted input shapes to a message array. */
  private _convertInputToMessageArray(input: BaseLanguageModelInput): BaseMessage[] {
    if (typeof input === 'string') {
      return [new AIMessage({ content: input })];
    }
    if (Array.isArray(input)) {
      return input as BaseMessage[];
    }
    // A PromptValue.
    const promptValue = input as { toChatMessages?: () => BaseMessage[] };
    if (typeof promptValue.toChatMessages === 'function') {
      return promptValue.toChatMessages();
    }
    throw new Error('Unsupported input passed to ChatRunAnywhere.');
  }
}
