/**
 * Motion constants — the TS/React mirror of the `--ra-duration-*`,
 * `--ra-ease-*`, `--ra-spring-*`, `--ra-ambient-*` and `--ra-reduced-fallback`
 * custom properties in `./tokens.css`.
 *
 * These exist so animation logic driven from TS (Framer Motion `transition`
 * props, `setTimeout`/`requestAnimationFrame` bookkeeping, etc.) does not
 * have to re-read a CSS custom property at runtime, or worse, hardcode its
 * own copy of the number. If a value here and the matching `--ra-*` token
 * ever disagree, tokens.css is the source of truth — fix the constant here,
 * do not invent a new number in either place.
 */

/** Discrete-transition durations, in seconds (Framer Motion / Web Animations API convention). */
export const DURATION = {
  micro: 0.12,
  standard: 0.24,
  emphasis: 0.4,
  hero: 0.7,
} as const;

export type DurationTier = keyof typeof DURATION;

/** A `cubic-bezier(x1, y1, x2, y2)` control-point tuple. */
export type EaseCurve = readonly [number, number, number, number];

export const EASE = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.4, 0, 0.2, 1],
  spring: [0.34, 1.4, 0.64, 1],
  in: [0.4, 0, 1, 1],
} as const satisfies Record<string, EaseCurve>;

export type EaseName = keyof typeof EASE;

/**
 * Named spring settle-times, in seconds. SwiftUI's response/damping springs
 * have no exact CSS/Framer Motion analogue, so these are the measured settle
 * times, paired with `EASE.spring` (mirrors `--ra-spring-*` + `--ra-ease-spring`).
 */
export const SPRING = {
  snappy: 0.2,
  standard: 0.32,
  gentle: 0.44,
  bouncy: 0.38,
} as const;

export type SpringName = keyof typeof SPRING;

/** Ambient/looping animation periods, in seconds. All of these run `linear` — never ease them. */
export const AMBIENT = {
  breathe: 1.6,
  shimmer: 1.2,
  spin: 1.0,
} as const;

export type AmbientName = keyof typeof AMBIENT;

/**
 * The Reduce Motion crossfade duration, in seconds. The change must be
 * perceived, not blinked past — this is NOT 0, and callers must not round it
 * down to 0 for a "prefers-reduced-motion" branch.
 */
export const REDUCED_FALLBACK = 0.15;

/**
 * Reads `(prefers-reduced-motion: reduce)` defensively. Safe to call from
 * contexts with no `window` (a Chrome extension background/service-worker
 * script, SSR, tests) — it returns `false` instead of throwing.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
