import { describe, it, expect } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import MessageManager, { MessageManagerSettings } from '../service';

/**
 * Simulates one full navigator "turn": a state message, a model-output tool call, and its
 * tool-response placeholder - mirroring exactly what NavigatorAgent.execute() does against
 * the real MessageManager (see agents/navigator.ts: addStateMessage -> addModelOutput).
 * Each turn therefore adds exactly 3 messages: HumanMessage, AIMessage, ToolMessage.
 */
function runTurn(manager: MessageManager, stepLabel: string): void {
  manager.addStateMessage(new HumanMessage({ content: `state for ${stepLabel}` }));
  manager.addModelOutput({ current_state: { next_goal: stepLabel }, action: [] });
}

function seedManager(settings?: MessageManagerSettings): MessageManager {
  const manager = new MessageManager(settings);
  manager.initTaskMessages(new SystemMessage({ content: 'you are a browser agent' }), 'do the thing');
  return manager;
}

function findPlaceholder(manager: MessageManager) {
  return manager
    .getMessages()
    .find(m => typeof m.content === 'string' && /omitted from history/.test(m.content as string));
}

describe('MessageManager - init seeding', () => {
  it('seeds a SystemMessage first and keeps it first no matter what is added after', () => {
    const manager = seedManager();
    for (let i = 0; i < 5; i++) runTurn(manager, `step-${i}`);

    const messages = manager.getMessages();
    expect(messages[0]).toBeInstanceOf(SystemMessage);
  });

  it('includes the task text and the one-shot tool-call example among the seeded messages', () => {
    const manager = seedManager();
    const messages = manager.getMessages();

    const hasTaskMessage = messages.some(
      m => typeof m.content === 'string' && m.content.includes('Your ultimate task is'),
    );
    const hasExampleToolCall = messages.some(
      m => m instanceof AIMessage && m.tool_calls?.some(tc => tc.name === 'AgentOutput'),
    );

    expect(hasTaskMessage).toBe(true);
    expect(hasExampleToolCall).toBe(true);
  });
});

describe('MessageManager - rolling window (defect 1: unbounded history)', () => {
  // Turn N only "closes" (and becomes eligible for trimming) when addStateMessage() for
  // turn N+1 is called, so after running N turns, N-1 are closed and up to maxHistoryTurns
  // of those are kept; the currently-open turn (3 messages) is always additionally present.
  // Steady state once trimming has kicked in is therefore (maxHistoryTurns + 1) * 3 + 1
  // (the +1 for the truncation placeholder) messages beyond the seed - verified empirically
  // below, not just asserted from unread arithmetic.
  it('keeps history bounded over many more turns than maxHistoryTurns, instead of growing forever', () => {
    const maxHistoryTurns = 5;
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns }));
    const seededLength = manager.length();

    for (let i = 0; i < 40; i++) runTurn(manager, `step-${i}`);

    // Without the fix this would be seededLength + 40*3 = well over 100 messages.
    expect(manager.length()).toBe(seededLength + (maxHistoryTurns + 1) * 3 + 1);
  });

  it('never drops the seeded SystemMessage or task instructions across many turns', () => {
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns: 3 }));

    for (let i = 0; i < 30; i++) runTurn(manager, `step-${i}`);

    const messages = manager.getMessages();
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages.some(m => typeof m.content === 'string' && m.content.includes('Your ultimate task is'))).toBe(true);
  });

  it('leaves exactly one placeholder message recording how many turns were elided', () => {
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns: 4 }));

    for (let i = 0; i < 10; i++) runTurn(manager, `step-${i}`);

    const messages = manager.getMessages();
    const placeholders = messages.filter(m => typeof m.content === 'string' && /omitted from history/.test(m.content));

    // Exactly one placeholder, even though multiple rounds of trimming happened.
    // 10 turns run, 9 closed, 4 kept -> 5 elided.
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].content).toContain('5 earlier steps');
  });

  it('updates the placeholder in place (count grows) rather than accumulating new ones', () => {
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns: 2 }));

    for (let i = 0; i < 5; i++) runTurn(manager, `step-${i}`);
    // 5 turns run, 4 closed, 2 kept -> 2 elided.
    expect(findPlaceholder(manager)?.content).toContain('2 earlier steps');
    expect(manager.getMessages().filter(m => typeof m.content === 'string' && /omitted/.test(m.content))).toHaveLength(
      1,
    );

    for (let i = 5; i < 8; i++) runTurn(manager, `step-${i}`);
    // 8 turns run total, 7 closed, 2 kept -> 5 elided; still one single placeholder.
    expect(findPlaceholder(manager)?.content).toContain('5 earlier steps');
    expect(manager.getMessages().filter(m => typeof m.content === 'string' && /omitted/.test(m.content))).toHaveLength(
      1,
    );
  });

  it('never splits an AIMessage tool call from its ToolMessage response when trimming', () => {
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns: 3 }));

    for (let i = 0; i < 20; i++) runTurn(manager, `step-${i}`);

    const messages = manager.getMessages();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0) {
        const expectedToolCallId = m.tool_calls[0].id;
        const next = messages[i + 1];
        expect(next).toBeInstanceOf(ToolMessage);
        expect((next as ToolMessage).tool_call_id).toBe(expectedToolCallId);
      }
    }
  });

  it('does not trim anything when turn count is within the configured window', () => {
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns: 50 }));
    const seededLength = manager.length();

    for (let i = 0; i < 5; i++) runTurn(manager, `step-${i}`);

    // 5 turns * 3 messages/turn = 15 messages added, no placeholder.
    expect(manager.length()).toBe(seededLength + 15);
    expect(findPlaceholder(manager)).toBeUndefined();
  });
});

describe('MessageManager - removeLastStateMessage interaction with the rolling window', () => {
  it('rolling back a cancelled/retried step does not leave a phantom turn in the window', () => {
    // Regression test: removeLastStateMessage() must decrement the in-progress turn length,
    // otherwise a rolled-back step would later be "closed" as a phantom turn and the window
    // would remove one real message too many, risking splitting an AIMessage/ToolMessage pair.
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns: 2 }));

    // Simulate navigator.ts: add a state message, then roll it back (as on error/cancel).
    manager.addStateMessage(new HumanMessage({ content: 'state attempt 1 (will be rolled back)' }));
    manager.removeLastStateMessage();
    // Retry: add the real state message for this step and complete it normally.
    runTurn(manager, 'retry-of-step-0');

    for (let i = 1; i < 10; i++) runTurn(manager, `step-${i}`);

    const messages = manager.getMessages();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0) {
        expect(messages[i + 1]).toBeInstanceOf(ToolMessage);
      }
    }
  });

  it('removeLastStateMessage is a no-op (does not corrupt turn accounting) when there is nothing to pop', () => {
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns: 2 }));
    const seededLength = manager.length();

    // Nothing has been added yet - this must not throw or desync bookkeeping.
    manager.removeLastStateMessage();
    expect(manager.length()).toBe(seededLength);

    // 4 turns run, 3 closed, 2 kept -> 1 elided.
    for (let i = 0; i < 4; i++) runTurn(manager, `step-${i}`);
    expect(findPlaceholder(manager)?.content).toContain('1 earlier step');
  });
});

describe('MessageManager - token budget enforcement (defect 1: cutMessages was dead code)', () => {
  it('shrinks an oversized last message instead of leaving history over the token budget', () => {
    const settings = new MessageManagerSettings({ maxHistoryTurns: 50 });
    const manager = seedManager(settings);
    // Give just enough headroom above the seed for a modest addition, not a 1000-char one.
    settings.maxInputTokens = manager.getTotalTokens() + 50;

    manager.addStateMessage(new HumanMessage({ content: 'x'.repeat(1000) }));

    const messages = manager.getMessages();
    const lastContent = messages[messages.length - 1].content as string;
    expect(lastContent.length).toBeLessThan(1000);
    expect(manager.getTotalTokens()).toBeLessThanOrEqual(settings.maxInputTokens);
  });

  it('drops image content from the last message before trimming any text', () => {
    const settings = new MessageManagerSettings({ maxHistoryTurns: 50, imageTokens: 800 });
    const manager = seedManager(settings);
    // Enough headroom for the short text alone, but nowhere near enough for the 800-token image.
    settings.maxInputTokens = manager.getTotalTokens() + 10;

    manager.addStateMessage(
      new HumanMessage({
        content: [
          { type: 'text', text: 'short text' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      }),
    );

    const messages = manager.getMessages();
    const last = messages[messages.length - 1];
    // Image alone was enough to bring it back under budget - content is flattened to the
    // surviving text, not proportionally trimmed.
    expect(last.content).toBe('short text');
  });

  it('throws a clear error rather than silently overflowing when even trimming cannot fit the budget', () => {
    const settings = new MessageManagerSettings({ maxHistoryTurns: 50 });
    const manager = seedManager(settings);
    // Almost no headroom at all: the new message alone can't be trimmed down far enough.
    settings.maxInputTokens = manager.getTotalTokens() + 1;

    expect(() => manager.addStateMessage(new HumanMessage({ content: 'y'.repeat(500) }))).toThrow(/Max token limit/);
  });
});

describe('MessageManager - token accounting', () => {
  it('is additive and deterministic: two equal-length messages contribute equal token counts', () => {
    const manager = new MessageManager(new MessageManagerSettings());
    manager.addToolMessage('a'.repeat(30), 1);
    const afterFirst = manager.getTotalTokens();

    manager.addToolMessage('b'.repeat(30), 2);
    const afterSecond = manager.getTotalTokens();

    expect(afterSecond - afterFirst).toBe(afterFirst);
  });

  it('estimatedCharactersPerToken scales the estimate as documented (chars / N)', () => {
    const coarse = new MessageManager(new MessageManagerSettings({ estimatedCharactersPerToken: 10 }));
    const fine = new MessageManager(new MessageManagerSettings({ estimatedCharactersPerToken: 2 }));

    coarse.addToolMessage('z'.repeat(100), 1);
    fine.addToolMessage('z'.repeat(100), 1);

    // Same text, smaller estimatedCharactersPerToken -> more estimated tokens.
    expect(fine.getTotalTokens()).toBeGreaterThan(coarse.getTotalTokens());
  });

  it('length() and getTotalTokens() both settle back down once trimming removes old turns', () => {
    const manager = seedManager(new MessageManagerSettings({ maxHistoryTurns: 1 }));
    const seededLength = manager.length();
    const seededTokens = manager.getTotalTokens();

    runTurn(manager, 'step-0');
    expect(manager.length()).toBe(seededLength + 3); // turn 0 still open, nothing closed yet

    runTurn(manager, 'step-1');
    expect(manager.length()).toBe(seededLength + 6); // turn 0 closed but not yet over the K=1 cap

    runTurn(manager, 'step-2');
    // turn 1 closes -> now 2 closed turns > maxHistoryTurns(1) -> turn 0 is dropped and the
    // placeholder appears; net effect vs. the previous checkpoint is -3 (turn0) + 1 (placeholder).
    expect(manager.length()).toBe(seededLength + 6 - 3 + 1 + 3);
    expect(manager.getTotalTokens()).toBeGreaterThan(seededTokens);
  });
});
