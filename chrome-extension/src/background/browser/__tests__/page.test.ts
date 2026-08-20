import { describe, it, expect, vi } from 'vitest';
import { shouldUseTrustedTyping } from '../page';

// page.ts pulls in 'webextension-polyfill' at module load time, which throws
// ("This script should only be loaded in a browser extension") outside a real extension
// context. Mocking it is the only thing needed to safely import the module in Vitest's node
// environment and reach the pure shouldUseTrustedTyping() predicate we're testing here - no
// puppeteer/CDP session, no chrome.* APIs, and no other browser globals are touched by that
// predicate or by loading the module. vi.mock() calls are hoisted above the imports above by
// Vitest's transform, so this takes effect before '../page' is actually loaded.
vi.mock('webextension-polyfill', () => ({ default: {} }));

describe('shouldUseTrustedTyping (defect 2: <textarea> typing was untrusted)', () => {
  it('routes <input> through the trusted path when enabled and not read-only', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'input', isContentEditable: false, isReadOnly: false, isDisabled: false }),
    ).toBe(true);
  });

  it('routes <textarea> through the trusted path when enabled and not read-only (the fix)', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'textarea', isContentEditable: false, isReadOnly: false, isDisabled: false }),
    ).toBe(true);
  });

  it('routes a contentEditable element through the trusted path regardless of tag name', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'div', isContentEditable: true, isReadOnly: false, isDisabled: false }),
    ).toBe(true);
    expect(
      shouldUseTrustedTyping({ tagName: 'span', isContentEditable: true, isReadOnly: false, isDisabled: false }),
    ).toBe(true);
  });

  it('falls back to the untrusted path for a read-only <textarea>', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'textarea', isContentEditable: false, isReadOnly: true, isDisabled: false }),
    ).toBe(false);
  });

  it('falls back to the untrusted path for a disabled <textarea>', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'textarea', isContentEditable: false, isReadOnly: false, isDisabled: true }),
    ).toBe(false);
  });

  it('falls back to the untrusted path for a read-only <input>', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'input', isContentEditable: false, isReadOnly: true, isDisabled: false }),
    ).toBe(false);
  });

  it('falls back to the untrusted path for a disabled <input>', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'input', isContentEditable: false, isReadOnly: false, isDisabled: true }),
    ).toBe(false);
  });

  it('falls back to the untrusted path for an element that is none of input/textarea/contentEditable', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'div', isContentEditable: false, isReadOnly: false, isDisabled: false }),
    ).toBe(false);
    expect(
      shouldUseTrustedTyping({ tagName: 'select', isContentEditable: false, isReadOnly: false, isDisabled: false }),
    ).toBe(false);
  });

  it('read-only/disabled wins even for an element that would otherwise be typeable via contentEditable', () => {
    expect(
      shouldUseTrustedTyping({ tagName: 'div', isContentEditable: true, isReadOnly: true, isDisabled: false }),
    ).toBe(false);
    expect(
      shouldUseTrustedTyping({ tagName: 'div', isContentEditable: true, isReadOnly: false, isDisabled: true }),
    ).toBe(false);
  });
});
