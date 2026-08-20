import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({ default: {} }));
// The action handlers emit i18n'd status strings; the real module reaches for
// chrome.i18n, which does not exist in a node test.
vi.mock('@extension/i18n', () => ({ t: (key: string, args?: string[]) => [key, ...(args ?? [])].join(' ') }));

import { ActionBuilder } from '../builder';
import { AgentContext } from '../../types';
import { EventManager } from '../../event/manager';
import MessageManager from '../../messages/service';
import { ExecutionState } from '../../event/types';

/**
 * A simulated task, driven through the real action layer.
 *
 * This is the closest thing to "does it actually work" that can run without a
 * model download and without a browser. It exercises the genuine
 * `ActionBuilder`, the genuine zod schemas, the genuine dispatch and validation
 * path, and the genuine coordinate mapping — only the browser underneath is a
 * recording fake.
 *
 * What it proves: a sequence of actions of the shape a model really emits gets
 * validated, dispatched, and turned into the right browser calls in the right
 * order, with the right events. What it cannot prove: that a model chooses good
 * actions. That needs the real weights and is the part a human has to watch.
 */

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** A fake Page that records what the agent asked it to do. */
function createFakePage(calls: RecordedCall[]) {
  const record = (method: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ method, args });
    });

  return {
    // Navigation
    navigateTo: record('navigateTo'),
    goBack: record('goBack'),
    // Coordinate input (vision mode)
    clickAtCoordinates: record('clickAtCoordinates'),
    typeAtCoordinates: record('typeAtCoordinates'),
    scrollAtCoordinates: record('scrollAtCoordinates'),
    // A 1440x900 CSS viewport on a 2x display, so the screenshot the model sees
    // is 2880x1800. Any coordinate handled here must be halved on the way in;
    // if it is not, the arithmetic is wrong and these tests say so.
    getViewportInfo: vi.fn(async () => ({ widthCss: 1440, heightCss: 900, devicePixelRatio: 2 })),
    getShownImageSize: vi.fn(async () => ({ width: 2880, height: 1800 })),
    // Index-based input
    getElement: vi.fn(() => null),
    scrollToText: record('scrollToText'),
    scrollToPercent: record('scrollToPercent'),
    sendKeys: record('sendKeys'),
    getDropdownOptions: vi.fn(async () => []),
    selectDropdownOption: record('selectDropdownOption'),
    url: () => 'https://www.youtube.com/',
    title: async () => 'YouTube',
  };
}

function createContext(page: ReturnType<typeof createFakePage>, events: { state: ExecutionState; detail: string }[]) {
  const browserContext = {
    getCurrentPage: vi.fn(async () => page),
    getCachedState: vi.fn(async () => ({ selectorMap: new Map(), tabs: [], url: page.url(), title: 'YouTube' })),
    navigateTo: page.navigateTo,
    openTab: vi.fn(async () => undefined),
    closeTab: vi.fn(async () => undefined),
    switchTab: vi.fn(async () => undefined),
    getTabInfos: vi.fn(async () => []),
    removeHighlight: vi.fn(async () => undefined),
  };

  const context = new AgentContext(
    'sim-task',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    browserContext as any,
    new MessageManager(),
    new EventManager(),
    { maxSteps: 20, maxActionsPerStep: 5 },
  );

  // Capture the execution events the UI would render, so we can assert the user
  // would actually see each step happen.
  const originalEmit = context.emitEvent.bind(context);
  context.emitEvent = (async (actor, state, detail) => {
    events.push({ state, detail: String(detail) });
    return originalEmit(actor, state, detail);
  }) as typeof context.emitEvent;

  return { context, browserContext };
}

describe('simulated task: coordinate (vision) mode', () => {
  let calls: RecordedCall[];
  let events: { state: ExecutionState; detail: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let actions: Map<string, any>;
  let page: ReturnType<typeof createFakePage>;

  beforeEach(() => {
    calls = [];
    events = [];
    page = createFakePage(calls);
    const { context } = createContext(page, events);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = new ActionBuilder(context, {} as any);
    actions = new Map(builder.buildCoordinateActions().map(action => [action.name(), action]));
  });

  it('offers coordinate actions and withholds the index-based ones', () => {
    // A model that only ever saw a screenshot has no idea what "index 12" is.
    expect(actions.has('click_at')).toBe(true);
    expect(actions.has('type_at')).toBe(true);
    expect(actions.has('scroll_at')).toBe(true);
    expect(actions.has('click_element')).toBe(false);
    expect(actions.has('input_text')).toBe(false);
    expect(actions.has('select_dropdown_option')).toBe(false);
  });

  it('keeps the actions that never needed an element reference', () => {
    expect(actions.has('go_to_url')).toBe(true);
    expect(actions.has('done')).toBe(true);
  });

  it('runs "open YouTube, search, play the first result" end to end', async () => {
    // The action sequence a vision model would emit for this task. Coordinates
    // are in screenshot space (2880x1800).
    await actions.get('go_to_url').call({ intent: 'Open YouTube', url: 'https://www.youtube.com' });
    await actions.get('type_at').call({ intent: 'Search', x: 1440, y: 132, text: 'lofi hip hop' });
    await actions.get('click_at').call({ intent: 'Play the first result', x: 600, y: 700 });

    // One browser call per action, in the order the model asked for them. (The
    // real typeAtCoordinates clicks to focus before typing, but that happens
    // inside Page, below this seam, so the fake records a single call.)
    expect(calls.map(call => call.method)).toEqual(['navigateTo', 'typeAtCoordinates', 'clickAtCoordinates']);

    const typed = calls.find(call => call.method === 'typeAtCoordinates');
    expect(typed?.args[2]).toBe('lofi hip hop');
    // Search box at y=132 in a 1800-tall screenshot -> y=66 in the CSS viewport.
    expect(typed?.args.slice(0, 2)).toEqual([720, 66]);
  });

  it('halves screenshot coordinates for a 2x display', async () => {
    // The single most likely bug in this whole path: forgetting that the image
    // is devicePixelRatio times the size of the viewport CDP clicks into.
    await actions.get('click_at').call({ intent: 'Click centre', x: 1440, y: 900 });

    const click = calls.find(call => call.method === 'clickAtCoordinates');
    expect(click?.args).toEqual([720, 450]);
  });

  it('maps the far corner onto the viewport corner, not past it', async () => {
    await actions.get('click_at').call({ intent: 'Corner', x: 2880, y: 1800 });
    expect(calls.at(-1)?.args).toEqual([1440, 900]);
  });

  it('reports a nonsensical coordinate as a failed action instead of clicking somewhere', async () => {
    const result = await actions.get('click_at').call({ intent: 'Bad', x: 999_999, y: 10 });

    expect(result.error).toBeTruthy();
    expect(calls.some(call => call.method === 'clickAtCoordinates')).toBe(false);
    expect(events.some(event => event.state === ExecutionState.ACT_FAIL)).toBe(true);
  });

  it('rejects a malformed action before it reaches the browser', async () => {
    // A model that emits a string where a number belongs must fail loudly at the
    // schema boundary, not coerce and click an arbitrary point.
    await expect(actions.get('click_at').call({ intent: 'Bad', x: 'left-ish', y: 10 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('emits a start and an ok event per action, so the UI can show progress', async () => {
    await actions.get('click_at').call({ intent: 'Click something', x: 100, y: 100 });

    expect(events.map(event => event.state)).toEqual([ExecutionState.ACT_START, ExecutionState.ACT_OK]);
    expect(events[0].detail).toContain('Click something');
  });

  it('scrolls at a point so the right container moves, not just the page', async () => {
    await actions.get('scroll_at').call({ intent: 'Scroll the feed', x: 1000, y: 1000, amount: 400 });

    const scroll = calls.find(call => call.method === 'scrollAtCoordinates');
    expect(scroll?.args).toEqual([500, 500, 400]);
  });
});

describe('simulated task: DOM (index) mode', () => {
  it('offers the index-based actions and no coordinate ones', () => {
    const calls: RecordedCall[] = [];
    const events: { state: ExecutionState; detail: string }[] = [];
    const page = createFakePage(calls);
    const { context } = createContext(page, events);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = new ActionBuilder(context, {} as any);
    const names = new Set(builder.buildDefaultActions().map(action => action.name()));

    expect(names.has('click_element')).toBe(true);
    expect(names.has('input_text')).toBe(true);
    expect(names.has('click_at')).toBe(false);
    expect(names.has('type_at')).toBe(false);
  });

  it('navigates for a plain text-mode task', async () => {
    const calls: RecordedCall[] = [];
    const events: { state: ExecutionState; detail: string }[] = [];
    const page = createFakePage(calls);
    const { context } = createContext(page, events);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = new ActionBuilder(context, {} as any);
    const actions = new Map(builder.buildDefaultActions().map(action => [action.name(), action]));

    await actions.get('go_to_url').call({ intent: 'Open Wikipedia', url: 'https://en.wikipedia.org' });

    expect(calls[0].method).toBe('navigateTo');
    expect(calls[0].args[0]).toBe('https://en.wikipedia.org');
  });
});
