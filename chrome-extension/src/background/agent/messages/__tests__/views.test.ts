import { describe, it, expect } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MessageHistory, MessageMetadata } from '../views';

function addHuman(history: MessageHistory, text: string, tokens = 10): void {
  history.addMessage(new HumanMessage({ content: text }), new MessageMetadata(tokens));
}

describe('MessageHistory - removeOldestMessage', () => {
  it('skips a leading SystemMessage and removes the next message instead', () => {
    const history = new MessageHistory();
    history.addMessage(new SystemMessage({ content: 'sys' }), new MessageMetadata(5));
    addHuman(history, 'first', 10);
    addHuman(history, 'second', 10);

    history.removeOldestMessage();

    expect(history.messages).toHaveLength(2);
    expect(history.messages[0].message).toBeInstanceOf(SystemMessage);
    expect(history.messages[1].message.content).toBe('second');
  });

  it('never removes the SystemMessage even if called repeatedly with nothing else left', () => {
    const history = new MessageHistory();
    history.addMessage(new SystemMessage({ content: 'sys' }), new MessageMetadata(5));
    addHuman(history, 'only', 10);

    history.removeOldestMessage();
    history.removeOldestMessage();
    history.removeOldestMessage();

    expect(history.messages).toHaveLength(1);
    expect(history.messages[0].message).toBeInstanceOf(SystemMessage);
  });

  it('keeps totalTokens consistent as messages are removed', () => {
    const history = new MessageHistory();
    history.addMessage(new SystemMessage({ content: 'sys' }), new MessageMetadata(5));
    addHuman(history, 'first', 20);
    addHuman(history, 'second', 30);
    expect(history.totalTokens).toBe(55);

    history.removeOldestMessage();
    expect(history.totalTokens).toBe(35);

    history.removeOldestMessage();
    expect(history.totalTokens).toBe(5);
  });

  it('respects seedCount: never removes messages in the protected prefix, even non-system ones', () => {
    const history = new MessageHistory();
    addHuman(history, 'seeded-task', 10);
    addHuman(history, 'seeded-example', 10);
    history.seedCount = 2;
    addHuman(history, 'turn-1', 10);
    addHuman(history, 'turn-2', 10);

    history.removeOldestMessage();
    history.removeOldestMessage();

    // Both non-seed messages are gone; the protected prefix survives untouched even though
    // neither of its messages is a SystemMessage.
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0].message.content).toBe('seeded-task');
    expect(history.messages[1].message.content).toBe('seeded-example');
  });

  it('is a no-op when only protected/system messages remain', () => {
    const history = new MessageHistory();
    history.addMessage(new SystemMessage({ content: 'sys' }), new MessageMetadata(5));
    history.seedCount = 1;

    history.removeOldestMessage();

    expect(history.messages).toHaveLength(1);
    expect(history.totalTokens).toBe(5);
  });
});

describe('MessageHistory - removeLastStateMessage', () => {
  it('pops the last message and reports success when it is a HumanMessage', () => {
    const history = new MessageHistory();
    history.addMessage(new SystemMessage({ content: 'sys' }), new MessageMetadata(5));
    addHuman(history, 'a', 10);
    addHuman(history, 'state', 15);

    const removed = history.removeLastStateMessage();

    expect(removed).toBe(true);
    expect(history.messages).toHaveLength(2);
    expect(history.totalTokens).toBe(15);
  });

  it('does nothing and returns false when the last message is not a HumanMessage', () => {
    const history = new MessageHistory();
    history.addMessage(new SystemMessage({ content: 'sys' }), new MessageMetadata(5));
    addHuman(history, 'a', 10);
    history.addMessage(new AIMessage({ content: 'ai' }), new MessageMetadata(20));

    const removed = history.removeLastStateMessage();

    expect(removed).toBe(false);
    expect(history.messages).toHaveLength(3);
    expect(history.totalTokens).toBe(35);
  });

  it('does nothing and returns false when there are 2 or fewer messages', () => {
    const history = new MessageHistory();
    history.addMessage(new SystemMessage({ content: 'sys' }), new MessageMetadata(5));
    addHuman(history, 'only-other', 10);

    const removed = history.removeLastStateMessage();

    expect(removed).toBe(false);
    expect(history.messages).toHaveLength(2);
  });
});

describe('MessageHistory - addMessage / getMessages / getTotalTokens', () => {
  it('inserts at an explicit position without disturbing totalTokens accounting', () => {
    const history = new MessageHistory();
    addHuman(history, 'first', 10);
    addHuman(history, 'third', 10);
    history.addMessage(new HumanMessage({ content: 'second' }), new MessageMetadata(10), 1);

    expect(history.getMessages().map(m => m.content)).toEqual(['first', 'second', 'third']);
    expect(history.getTotalTokens()).toBe(30);
  });
});
