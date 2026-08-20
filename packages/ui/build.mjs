import fs from 'node:fs';
import { replaceTscAliasPaths } from 'tsc-alias';
import { resolve } from 'node:path';
import esbuild from 'esbuild';

/**
 * @type { import('esbuild').BuildOptions }
 */
const buildOptions = {
  entryPoints: ['./index.ts', './lib/**/*.ts', './lib/**/*.tsx'],
  tsconfig: './tsconfig.json',
  bundle: false,
  target: 'es6',
  outdir: './dist',
  sourcemap: true,
};

await esbuild.build(buildOptions);

/**
 * Post build paths resolve since ESBuild only natively
 * support paths resolution for bundling scenario
 * @url https://github.com/evanw/esbuild/issues/394#issuecomment-1537247216
 */
await replaceTscAliasPaths({
  configFile: 'tsconfig.json',
  watch: false,
  outDir: 'dist',
  declarationDir: 'dist',
});

/**
 * esbuild only bundles .ts/.tsx (see entryPoints above); every plain .css
 * file under lib/ — tokens.css, and each component's co-located Foo.css —
 * has to be copied over separately, at the SAME relative path under dist/,
 * so imports like `import './Card.css'` (which end up living next to
 * dist/lib/components/Card.js) and `@import './lib/tokens.css'` (from
 * dist/global.css) still resolve after the build.
 *
 * global.css itself is the one exception: it's copied straight to
 * dist/global.css (dropping the `lib/` prefix) to match the path every
 * consuming page already imports: `@extension/ui/dist/global.css`.
 */
function copyCssRecursive(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = resolve(srcDir, entry.name);
    if (entry.isDirectory()) {
      copyCssRecursive(srcPath, resolve(destDir, entry.name));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.css') && entry.name !== 'global.css') {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, resolve(destDir, entry.name));
    }
  }
}

copyCssRecursive(resolve('lib'), resolve('dist', 'lib'));
fs.copyFileSync(resolve('lib', 'global.css'), resolve('dist', 'global.css'));
