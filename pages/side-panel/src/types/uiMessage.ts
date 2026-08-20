import type { Actors, type Message } from '@extension/storage';

/**
 * The chat transcript used to be a flat `Message[]` where an in-flight step
 * was represented by appending a message whose `content` was literally the
 * string `'Showing progress...'`, and `MessageList` detected it by exact
 * string comparison. That made "is this a progress row" untypeable and
 * fragile (any real message that happened to contain that text would have
 * been treated as a progress indicator).
 *
 * `UiMessage` replaces it with a discriminated union so the renderer can
 * switch on `kind` instead of sniffing `content`.
 */
export type StepStatus = 'running' | 'ok' | 'fail';

interface BaseUiMessage {
  /** Stable across re-renders for a given logical row, so it can be updated in place. */
  readonly id: string;
  readonly timestamp: number;
}

/** A plain chat bubble — user turns, system notices, and historical messages. */
export interface TextUiMessage extends BaseUiMessage {
  readonly kind: 'text';
  readonly actor: Actors;
  readonly content: string;
}

/**
 * A Planner/Navigator/Validator "thinking" step. Shows escalating wait copy
 * while `status === 'running'`, then the real reasoning once it settles.
 */
export interface StepUiMessage extends BaseUiMessage {
  readonly kind: 'step';
  readonly actor: Actors;
  readonly status: StepStatus;
  /** The final reasoning/result text. Empty while running. */
  readonly text: string;
}

/** One Navigator tool call, driven by ACT_START / ACT_OK / ACT_FAIL. */
export interface ToolCallUiMessage extends BaseUiMessage {
  readonly kind: 'toolCall';
  readonly actor: Actors;
  readonly status: StepStatus;
  /** The action's description/arguments, from ACT_START. */
  readonly action: string;
  /** The outcome, from ACT_OK / ACT_FAIL. Absent while running. */
  readonly result?: string;
}

export type UiMessage = TextUiMessage | StepUiMessage | ToolCallUiMessage;

let idCounter = 0;

/** A ui-message id that is unique within this side panel session. */
export function nextUiMessageId(): string {
  idCounter += 1;
  return `ui-${Date.now().toString(36)}-${idCounter}`;
}

/** Wrap a persisted/history `Message` for display — always a plain bubble. */
export function textUiMessage(message: Message, id: string = nextUiMessageId()): TextUiMessage {
  return { kind: 'text', id, actor: message.actor, content: message.content, timestamp: message.timestamp };
}

/** Project a UI message back down to the shape `chatHistoryStore` persists. */
export function toStorageMessage(actor: Actors, content: string, timestamp: number): Message {
  return { actor, content, timestamp };
}
