/**
 * Ambient module declaration so TypeScript accepts the co-located
 * `import './Foo.css';` side-effect imports used by components in
 * `./components/*.tsx`. The actual CSS is resolved by whatever bundler
 * consumes `@extension/ui` (Vite, via its module graph) — this declaration
 * only satisfies `tsc --noEmit`.
 */
declare module '*.css';
