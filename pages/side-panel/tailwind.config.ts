import baseConfig from '@extension/tailwindcss-config';
import { withUI } from '@extension/ui';
import type { Config } from 'tailwindcss/types/config';

/**
 * Tailwind config for the side panel.
 *
 * The `theme` key here MUST merge with the base config rather than replace it.
 * A plain `{...baseConfig, theme: {extend: {...}}}` silently drops the shared
 * theme entirely — including the whole `--ra-*` colour bridge — so classes like
 * `text-foreground` and `ring-brand` stop being generated and the UI renders
 * with no colour rules at all. Nothing errors; the styles are simply absent,
 * which is why it is worth spelling out here.
 *
 * `withUI` adds `@extension/ui`'s source to the content globs so classes used
 * inside the shared components are not purged.
 */
export default withUI({
  ...baseConfig,
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    ...baseConfig.theme,
    extend: {
      ...baseConfig.theme?.extend,
      keyframes: {
        ...baseConfig.theme?.extend?.keyframes,
        progress: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        ...baseConfig.theme?.extend?.animation,
        progress: 'progress 1.5s infinite ease-in-out',
      },
    },
  },
} as Config);
