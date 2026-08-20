import { type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

export class MessageMetadata {
  tokens: number;
  message_type: string | null = null;

  constructor(tokens: number, message_type?: string | null) {
    this.tokens = tokens;
    this.message_type = message_type ?? null;
  }
}

export class ManagedMessage {
  message: BaseMessage;
  metadata: MessageMetadata;

  constructor(message: BaseMessage, metadata: MessageMetadata) {
    this.message = message;
    this.metadata = metadata;
  }
}

export class MessageHistory {
  messages: ManagedMessage[] = [];
  totalTokens = 0;

  /**
   * Number of leading messages that removeOldestMessage() must never touch: the seeded
   * init messages (system message, task, one-shot example, ...) plus, once created, the
   * history-truncation placeholder message. MessageManager grows this boundary as those
   * protected messages are added; it starts at 0 so a bare MessageHistory behaves as before.
   */
  seedCount = 0;

  addMessage(message: BaseMessage, metadata: MessageMetadata, position?: number): void {
    const managedMessage: ManagedMessage = {
      message,
      metadata,
    };

    if (position === undefined) {
      this.messages.push(managedMessage);
    } else {
      this.messages.splice(position, 0, managedMessage);
    }
    this.totalTokens += metadata.tokens;
  }

  removeMessage(index = -1): void {
    if (this.messages.length > 0) {
      const msg = this.messages.splice(index, 1)[0];
      this.totalTokens -= msg.metadata.tokens;
    }
  }

  /**
   * Removes the last message from the history if it is a human message.
   * This is used to remove the state message from the history. Also respects seedCount, so
   * calling this with no turn message added yet (nothing beyond the protected seed) is a
   * true no-op rather than popping a seeded message.
   * @returns true if a message was actually removed, false otherwise - callers that keep
   * their own parallel bookkeeping (e.g. MessageManager's turn-length counter) need this
   * to know whether to adjust their counts.
   */
  removeLastStateMessage(): boolean {
    if (
      this.messages.length > 2 &&
      this.messages.length > this.seedCount &&
      this.messages[this.messages.length - 1].message instanceof HumanMessage
    ) {
      const msg = this.messages.pop();
      if (msg) {
        this.totalTokens -= msg.metadata.tokens;
        return true;
      }
    }
    return false;
  }

  /**
   * Get all messages
   */
  getMessages(): BaseMessage[] {
    return this.messages.map(m => m.message);
  }

  /**
   * Get total tokens in history
   */
  getTotalTokens(): number {
    return this.totalTokens;
  }

  /**
   * Remove the oldest droppable message: the first one, scanning past the protected
   * `seedCount` prefix, that isn't a SystemMessage (defense in depth - the seed's system
   * message already lives inside that protected prefix, but this keeps the guarantee even
   * if a caller never set seedCount).
   */
  removeOldestMessage(): void {
    for (let i = this.seedCount; i < this.messages.length; i++) {
      if (!(this.messages[i].message instanceof SystemMessage)) {
        const msg = this.messages.splice(i, 1)[0];
        this.totalTokens -= msg.metadata.tokens;
        break;
      }
    }
  }
}
