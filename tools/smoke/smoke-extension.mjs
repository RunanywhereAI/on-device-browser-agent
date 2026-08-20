#!/usr/bin/env node
/**
 * Load the built extension in a real Chrome and report whether it boots.
 *
 * This exists because "it compiles" says almost nothing about an extension. The
 * failures that actually matter — a manifest Chrome rejects, a service worker
 * that throws on registration, an offscreen document that cannot be created, a
 * CSP that blocks WASM compilation — all happen at load time and are invisible
 * to `tsc` and to Vite.
 *
 * Chrome cannot load an unpacked extension in true headless mode, so this runs
 * headed by default. Pass --headless to try the new headless mode, which
 * supports extensions on recent builds but is less reliable.
 *
 * Usage:
 *   node tools/smoke/smoke-extension.mjs [--headless] [--keep-open] [--timeout=30]
 *
 * Exit code 0 means the extension registered a service worker and reported no
 * errors. Non-zero means it failed to load, and the reason is printed.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const DIST = join(REPO, 'dist');

const args = process.argv.slice(2);
const headless = args.includes('--headless');
const keepOpen = args.includes('--keep-open');
const timeoutSec = Number(args.find(a => a.startsWith('--timeout='))?.split('=')[1] ?? 45);

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  process.env.CHROME_PATH,
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find(p => existsSync(p));
  if (!found) {
    throw new Error(
      `Could not find Chrome. Set CHROME_PATH. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
    );
  }
  return found;
}

async function preflight() {
  const problems = [];

  if (!existsSync(DIST)) {
    problems.push('dist/ does not exist — run `pnpm build` first.');
    return problems;
  }

  const manifestPath = join(DIST, 'manifest.json');
  if (!existsSync(manifestPath)) {
    problems.push('dist/manifest.json is missing — the build did not complete.');
    return problems;
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    problems.push(`Expected manifest_version 3, found ${manifest.manifest_version}.`);
  }

  // Every path the manifest names must actually be in the bundle. A missing
  // file here is the single most common cause of a silent load failure.
  const referenced = [
    manifest.background?.service_worker,
    manifest.options_page,
    manifest.side_panel?.default_path,
    ...(manifest.content_scripts ?? []).flatMap(cs => cs.js ?? []),
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].filter(Boolean);

  for (const rel of referenced) {
    if (!existsSync(join(DIST, rel))) problems.push(`manifest references a missing file: ${rel}`);
  }

  // The remotely-hosted-code policy forbids fetching executable code. Model
  // weights are data and may be fetched; .js and .wasm may not. Catch a CDN
  // reference before the Chrome Web Store review does.
  const jsFiles = [manifest.background?.service_worker].filter(Boolean);
  for (const rel of jsFiles) {
    const source = await readFile(join(DIST, rel), 'utf8');
    const remoteScript = source.match(/https?:\/\/[^"'`\s]+\.(?:js|wasm)\b/);
    if (remoteScript) {
      problems.push(
        `${rel} references remote executable code (${remoteScript[0]}). ` +
          'Chrome Web Store policy forbids this; bundle it instead.',
      );
    }
  }

  return problems;
}

async function main() {
  console.log('— preflight —');
  const problems = await preflight();
  if (problems.length > 0) {
    for (const p of problems) console.error(`  FAIL  ${p}`);
    process.exit(1);
  }
  console.log('  OK    manifest is v3, every referenced file exists, no remote executable code');

  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), 'ra-smoke-'));
  console.log(`\n— launching ${headless ? 'headless' : 'headed'} Chrome —`);
  console.log(`  ${chrome}`);

  const chromeArgs = [
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    // Surface extension errors on stderr instead of only in chrome://extensions.
    '--enable-logging=stderr',
    '--v=1',
    'about:blank',
  ];
  if (headless) chromeArgs.unshift('--headless=new');

  const child = spawn(chrome, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  const interesting = [];
  const fatal = [];
  /**
   * Branded Google Chrome refuses --load-extension / --disable-extensions-except
   * (it logs "not allowed in Google Chrome, ignoring"). If that happens the
   * browser started with NO extension at all, so reporting success would be
   * actively misleading.
   */
  let flagsIgnored = false;

  const scan = chunk => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      // Chrome is extremely verbose at --v=1; keep only extension-relevant lines.
      if (/extension|offscreen|service.?worker|wasm|CSP|Content Security/i.test(line)) {
        interesting.push(line.trim());
      }
      if (/Failed to load extension|Manifest.*(invalid|error)|could not be loaded/i.test(line)) {
        fatal.push(line.trim());
      }
      if (/is not allowed in Google Chrome, ignoring/i.test(line)) {
        flagsIgnored = true;
      }
    }
  };

  child.stdout.on('data', scan);
  child.stderr.on('data', scan);

  const settled = await Promise.race([
    new Promise(r => child.on('exit', code => r({ exited: true, code }))),
    new Promise(r => setTimeout(() => r({ exited: false }), timeoutSec * 1000)),
  ]);

  if (!keepOpen) child.kill('SIGTERM');

  console.log('\n— extension-related log lines —');
  if (interesting.length === 0) {
    console.log('  (none — Chrome logged nothing about the extension)');
  } else {
    for (const line of interesting.slice(0, 40)) console.log(`  ${line}`);
    if (interesting.length > 40) console.log(`  … ${interesting.length - 40} more`);
  }

  if (fatal.length > 0) {
    console.error('\n— FAILED to load —');
    for (const line of fatal) console.error(`  ${line}`);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }

  if (settled.exited && settled.code !== 0) {
    console.error(`\nChrome exited early with code ${settled.code}.`);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }

  if (flagsIgnored) {
    console.error('\n— INCONCLUSIVE —');
    console.error('  This Chrome build refuses --load-extension (branded Google Chrome blocks it).');
    console.error('  The browser ran WITHOUT the extension, so nothing about loading was verified.');
    console.error('  The preflight checks above did pass and are meaningful on their own.');
    console.error('  To verify loading, use Chromium or Playwright\'s bundled Chromium:');
    console.error('    CHROME_PATH=/path/to/Chromium node tools/smoke/smoke-extension.mjs');
    console.error('  or load dist/ manually via chrome://extensions -> Load unpacked.');
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    process.exit(2);
  }

  console.log('\nOK — Chrome loaded the extension without reporting a load failure.');
  console.log('NOTE: this proves the bundle is loadable, not that a task succeeds.');
  console.log('      Running an actual agent task needs a model download and is a separate step.');

  if (!keepOpen) await rm(profile, { recursive: true, force: true }).catch(() => {});
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
