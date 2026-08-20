import type { Config } from 'tailwindcss/types/config';

/**
 * Tailwind theme bridge for the RunAnywhere design tokens.
 *
 * Every value below REFERENCES a `--ra-*` custom property from
 * `@extension/ui/lib/tokens.css` (loaded at runtime via
 * `@extension/ui/dist/global.css`, which every page already imports) rather
 * than duplicating a hex/px value here. tokens.css stays the single source
 * of truth: change a `--ra-*` value there and every Tailwind utility built
 * from it (bg-brand, rounded-lg, ease-spring, z-modal, …) picks up the
 * change with no edit needed in this file.
 *
 * This file only EXTENDS the theme — keys that collide with a Tailwind
 * default (e.g. borderRadius.lg, transitionTimingFunction.out) are
 * intentionally overridden to point at the token; keys with no `--ra-*`
 * analogue (Tailwind's numeric spacing scale, its gray/slate palettes, …)
 * are left untouched.
 */
export default {
  theme: {
    extend: {
      colors: {
        background: 'var(--ra-background)',
        surface: 'var(--ra-surface)',
        'surface-sunken': 'var(--ra-surface-sunken)',
        'surface-floating': 'var(--ra-surface-floating)',
        foreground: 'var(--ra-foreground)',
        'muted-foreground': 'var(--ra-muted-foreground)',
        muted: 'var(--ra-muted)',
        border: 'var(--ra-border)',
        'border-subtle': 'var(--ra-border-subtle)',
        brand: {
          DEFAULT: 'var(--ra-brand)',
          ink: 'var(--ra-brand-ink)',
          hover: 'var(--ra-brand-hover)',
        },
        'gradient-end': 'var(--ra-gradient-end)',
        'on-brand': 'var(--ra-on-brand)',
        'on-brand-large': 'var(--ra-on-brand-large)',
        success: {
          DEFAULT: 'var(--ra-success)',
          text: 'var(--ra-success-text)',
        },
        warning: {
          DEFAULT: 'var(--ra-warning)',
          text: 'var(--ra-warning-text)',
        },
        danger: {
          DEFAULT: 'var(--ra-danger)',
          text: 'var(--ra-danger-text)',
        },
        info: {
          DEFAULT: 'var(--ra-info)',
          text: 'var(--ra-info-text)',
        },
        'code-surface': 'var(--ra-code-surface)',
        'code-foreground': 'var(--ra-code-foreground)',
      },
      borderRadius: {
        xs: 'var(--ra-radius-xs)',
        sm: 'var(--ra-radius-sm)',
        md: 'var(--ra-radius-md)',
        lg: 'var(--ra-radius-lg)',
        xl: 'var(--ra-radius-xl)',
        pill: 'var(--ra-radius-pill)',
      },
      spacing: {
        hair: 'var(--ra-space-hair)',
        xs: 'var(--ra-space-xs)',
        sm: 'var(--ra-space-sm)',
        md: 'var(--ra-space-md)',
        lg: 'var(--ra-space-lg)',
        xl: 'var(--ra-space-xl)',
        xxl: 'var(--ra-space-xxl)',
        xxxl: 'var(--ra-space-xxxl)',
      },
      transitionTimingFunction: {
        out: 'var(--ra-ease-out)',
        'in-out': 'var(--ra-ease-in-out)',
        in: 'var(--ra-ease-in)',
        spring: 'var(--ra-ease-spring)',
      },
      // Not explicitly requested alongside timing-function/radius/spacing/z-index,
      // but added so a duration class always has a token-backed easing partner
      // (`duration-standard ease-out` etc.) — see also DURATION in lib/motion.ts.
      transitionDuration: {
        micro: 'var(--ra-duration-micro)',
        standard: 'var(--ra-duration-standard)',
        emphasis: 'var(--ra-duration-emphasis)',
        hero: 'var(--ra-duration-hero)',
      },
      zIndex: {
        base: 'var(--ra-z-base)',
        dropdown: 'var(--ra-z-dropdown)',
        sticky: 'var(--ra-z-sticky)',
        overlay: 'var(--ra-z-overlay)',
        modal: 'var(--ra-z-modal)',
        toast: 'var(--ra-z-toast)',
      },
      // `ra-` prefixed so these never shadow Tailwind's own default
      // `animate-spin` etc. — pair with the AMBIENT constants in lib/motion.ts.
      keyframes: {
        'ra-breathe': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'ra-shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'ra-spin': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'ra-breathe': 'ra-breathe var(--ra-ambient-breathe) var(--ra-ease-in-out) infinite',
        'ra-shimmer': 'ra-shimmer var(--ra-ambient-shimmer) linear infinite',
        'ra-spin': 'ra-spin var(--ra-ambient-spin) linear infinite',
      },
    },
  },
  plugins: [],
} as Omit<Config, 'content'>;
