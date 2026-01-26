/**
 * GPU-Enhanced DOM Observer
 *
 * Wraps the standard DOM observer with optional GPU acceleration.
 * Falls back to CPU processing if WebGPU is unavailable.
 */

import { domCompute, type FilterCriteria } from './dom-compute';
import { serializeDOMState } from './dom-observer';
import type { InteractiveElement } from '../shared/types';
import {
  INTERACTIVE_SELECTORS,
  MAX_INTERACTIVE_ELEMENTS,
} from '../shared/constants';

// ============================================================================
// GPU-Enhanced DOM Serialization
// ============================================================================

let gpuInitialized = false;
let gpuAvailable = false;

/**
 * Initialize GPU acceleration (call once on content script load)
 */
export async function initializeGPU(): Promise<void> {
  if (gpuInitialized) return;

  gpuInitialized = true;
  gpuAvailable = await domCompute.initialize();

  if (gpuAvailable) {
    console.log('[DOMObserverGPU] GPU acceleration enabled');
  } else {
    console.log('[DOMObserverGPU] GPU not available, using CPU');
  }
}

/**
 * Extract interactive elements with GPU acceleration
 */
export async function extractInteractiveElementsGPU(): Promise<InteractiveElement[]> {
  const startTime = performance.now();

  // Query all potential interactive elements
  const selector = INTERACTIVE_SELECTORS.join(', ');
  const allElements = Array.from(document.querySelectorAll(selector))
    .filter((el): el is HTMLElement => el instanceof HTMLElement);

  console.log(`[DOMObserverGPU] Found ${allElements.length} potential elements`);

  // Use GPU to filter and rank elements
  const criteria: FilterCriteria = {
    minWidth: 10,
    minHeight: 10,
    requireVisible: true,
    requireInViewport: false, // Don't require, but prioritize
    requireClickable: false,  // Don't require, but boost score
    requireInput: false,      // Don't require, but boost score
  };

  let filteredElements: HTMLElement[];
  if (gpuAvailable) {
    filteredElements = await domCompute.findElements(allElements, criteria);
  } else {
    // CPU fallback
    filteredElements = cpuFilterElements(allElements, criteria);
  }

  // Convert to InteractiveElement format
  const interactiveElements: InteractiveElement[] = [];
  for (let i = 0; i < Math.min(filteredElements.length, MAX_INTERACTIVE_ELEMENTS); i++) {
    const el = filteredElements[i];
    interactiveElements.push({
      index: i,
      tag: el.tagName.toLowerCase(),
      type: getInputType(el),
      text: getElementText(el),
      selector: generateSelector(el),
      attributes: extractRelevantAttributes(el),
    });
  }

  const totalTime = performance.now() - startTime;
  console.log(`[DOMObserverGPU] Extracted ${interactiveElements.length} elements in ${totalTime.toFixed(2)}ms`);

  return interactiveElements;
}

/**
 * Benchmark: Compare GPU vs CPU performance
 */
export async function benchmarkPerformance(): Promise<{
  cpu: number;
  gpu: number;
  speedup: number;
}> {
  const selector = INTERACTIVE_SELECTORS.join(', ');
  const allElements = Array.from(document.querySelectorAll(selector))
    .filter((el): el is HTMLElement => el instanceof HTMLElement);

  const criteria: FilterCriteria = {
    minWidth: 10,
    minHeight: 10,
    requireVisible: true,
    requireInViewport: false,
    requireClickable: false,
    requireInput: false,
  };

  // CPU benchmark
  const cpuStart = performance.now();
  cpuFilterElements(allElements, criteria);
  const cpuTime = performance.now() - cpuStart;

  // GPU benchmark (if available)
  let gpuTime = cpuTime;
  if (gpuAvailable) {
    const gpuStart = performance.now();
    await domCompute.findElements(allElements, criteria);
    gpuTime = performance.now() - gpuStart;
  }

  return {
    cpu: cpuTime,
    gpu: gpuTime,
    speedup: cpuTime / gpuTime,
  };
}

// ============================================================================
// CPU Fallback Implementation
// ============================================================================

function cpuFilterElements(elements: HTMLElement[], criteria: FilterCriteria): HTMLElement[] {
  return elements.filter(el => {
    const rect = el.getBoundingClientRect();

    // Size check
    if (rect.width < criteria.minWidth || rect.height < criteria.minHeight) {
      return false;
    }

    // Visibility check
    if (criteria.requireVisible && !isVisible(el)) {
      return false;
    }

    // Viewport check (if required)
    if (criteria.requireInViewport) {
      const inViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!inViewport) return false;
    }

    return true;
  });
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);

  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  if (element.hidden) return false;

  return true;
}

// ============================================================================
// Helper Functions (from dom-observer.ts)
// ============================================================================

function getInputType(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement) {
    return element.type || 'text';
  }
  if (element instanceof HTMLTextAreaElement) {
    return 'textarea';
  }
  if (element instanceof HTMLSelectElement) {
    return 'select';
  }
  return undefined;
}

function getElementText(element: HTMLElement): string {
  // For inputs, get placeholder, value, or label
  if (element instanceof HTMLInputElement) {
    if (element.placeholder) return element.placeholder;
    if (element.value && element.type !== 'password') return element.value;

    const label = findLabel(element);
    if (label) return label;

    return element.name || element.id || '';
  }

  if (element instanceof HTMLTextAreaElement) {
    if (element.placeholder) return element.placeholder;

    const label = findLabel(element);
    if (label) return label;

    return element.name || '';
  }

  if (element instanceof HTMLSelectElement) {
    const selected = element.options[element.selectedIndex];
    if (selected) return selected.text;

    const label = findLabel(element);
    if (label) return label;

    return element.name || '';
  }

  // For other elements, get inner text
  const text = element.innerText || element.textContent || '';
  return text.trim().replace(/\s+/g, ' ').slice(0, 100);
}

function findLabel(element: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) return label.textContent?.trim() || '';
  }

  const parentLabel = element.closest('label');
  if (parentLabel) {
    return parentLabel.textContent?.trim() || '';
  }

  return '';
}

function generateSelector(element: HTMLElement): string {
  // ID-based selector (most reliable)
  if (element.id) {
    if (/^[a-zA-Z][\w-]*$/.test(element.id)) {
      return `#${element.id}`;
    }
    return `[id="${CSS.escape(element.id)}"]`;
  }

  // Name attribute for form elements
  const name = element.getAttribute('name');
  if (name) {
    const selector = `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    const matches = document.querySelectorAll(selector);
    if (matches.length === 1) {
      return selector;
    }
  }

  // Class-based selector
  if (element.className && typeof element.className === 'string') {
    const classes = element.className
      .split(/\s+/)
      .filter((c) => c && !c.includes(':') && /^[a-zA-Z]/.test(c))
      .slice(0, 3);

    if (classes.length > 0) {
      const classSelector = classes.map((c) => `.${CSS.escape(c)}`).join('');
      const selector = `${element.tagName.toLowerCase()}${classSelector}`;
      const matches = document.querySelectorAll(selector);
      if (matches.length === 1) {
        return selector;
      }
    }
  }

  // Data attributes
  const dataTestId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
  if (dataTestId) {
    return `[data-testid="${CSS.escape(dataTestId)}"]`;
  }

  // Aria label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const selector = `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
    const matches = document.querySelectorAll(selector);
    if (matches.length === 1) {
      return selector;
    }
  }

  // Fallback: nth-child path
  return generateNthChildPath(element);
}

function generateNthChildPath(element: HTMLElement): string {
  const path: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body && path.length < 5) {
    const parent = current.parentElement;
    if (!parent) break;

    const siblings = Array.from(parent.children).filter(
      (el) => el.tagName === current!.tagName
    );
    const index = siblings.indexOf(current) + 1;

    if (siblings.length === 1) {
      path.unshift(current.tagName.toLowerCase());
    } else {
      path.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
    }

    current = parent;
  }

  if (current === document.body) {
    path.unshift('body');
  }

  return path.join(' > ');
}

function extractRelevantAttributes(element: HTMLElement): Record<string, string> {
  const relevant: Record<string, string> = {};
  const attrs = ['href', 'name', 'placeholder', 'aria-label', 'title', 'role', 'type', 'value'];

  attrs.forEach((attr) => {
    const value = element.getAttribute(attr);
    if (value && attr !== 'value') {
      relevant[attr] = value.slice(0, 100);
    }
  });

  return relevant;
}
