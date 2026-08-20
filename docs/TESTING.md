# Testing RA Browser Use

Everything below the "what a human has to do" line has been automated and is
green. This document is about the part that cannot be: actually watching a local
model drive a browser.

## What is already verified, and what that does and does not mean

| Gate | Status | What it actually proves |
|---|---|---|
| `pnpm lint` | 14/14 | No lint errors. Also enforced in CI as a real gate. |
| `pnpm type-check` | 14/14 | Every workspace compiles, including the SDK boundary. |
| `pnpm -F chrome-extension test` | 86 tests / 6 files | Coordinate maths, model-selection rules, catalog invariants, history compaction, and a simulated task through the real action layer. |
| `pnpm build` | 9/9 | A loadable `dist/` is produced, manifest included. |
| `node tools/smoke/smoke-extension.mjs` | preflight passes | Manifest is v3, every path it references exists, no remotely-hosted executable code. |

**None of that proves the product works.** Not one of those gates runs a model.
The simulated task drives real action dispatch against a fake browser, so it
proves the plumbing; it says nothing about whether a 2.6B model picks sensible
actions on a real page. That is the open question, and it needs a person.

## The one automation gap

Branded Google Chrome refuses `--load-extension` and
`--disable-extensions-except` (it logs *"not allowed in Google Chrome,
ignoring"*), so the extension cannot be loaded from a script here. The smoke
harness reports `INCONCLUSIVE` (exit 2) in that case rather than claiming a pass,
because a browser that started without the extension has verified nothing.

If you want this automated later, it needs Chromium or Playwright's bundled
Chromium via `CHROME_PATH=/path/to/Chromium node tools/smoke/smoke-extension.mjs`.

---

## What a human has to do

### 1. Build and load

```bash
nvm use && pnpm install && pnpm build
```

Then `chrome://extensions` → **Developer mode** on → **Load unpacked** → select
`dist/`.

Expect the *"RA Browser Use started debugging this browser"* infobar the first
time it acts on a tab. That is not a bug and cannot be suppressed: trusted input
(a click the page cannot tell from a human's) requires the `debugger` permission,
and Chrome always announces it. Claude in Chrome shows the same banner for the
same reason.

### 2. Check the hardware story before blaming the model

Visit `chrome://gpu` and confirm **WebGPU** is enabled. Without it the CPU WASM
path still works, but it is markedly slower and a slow first token will look like
a hang. Worth knowing which case you are in before judging quality.

### 3. First run downloads a model

The default is **LFM2.5-2.6B at Q5_K_M, 1.94 GB**, fetched from Hugging Face and
cached in OPFS. Things to watch:

- Progress should show named phases (`Starting…` → bytes/rate/ETA → `Checking
  download` → `Unpacking`), never a bare spinning percentage.
- Interrupt it — close the panel, drop the network — then resume. It should pick
  up where it stopped rather than starting over; the SDK keeps partial bytes and
  re-requests with a Range header.
- It is cached after the first time. A second load should not re-download.

If you would rather not wait, the options page can switch to **LFM2.5-1.2B
(0.79 GB)**. For a fast pipeline check only, `qwen3-0.6b-q4_k_m` (397 MB) exists
but is deliberately too weak to navigate — use it to prove plumbing, not quality.

### 4. Where the logs are

This matters, because the interesting failures are not in the page console:

- **Service worker** (agent loop, actions, planner/navigator): `chrome://extensions`
  → the extension's **service worker** link.
- **Offscreen document** (model load, WASM/WebGPU, inference, downloads):
  `chrome://inspect/#other`, or the *Inspect views* list on the extension card —
  look for `offscreen/index.html`. **Most model problems surface only here.**
- **Content script** (DOM extraction): the page's own DevTools console.

### 5. Tasks worth trying, easiest first

Start where the DOM is clean and the failure modes are boring:

1. *"Go to Hacker News and tell me the top 3 story titles."* — navigation plus
   extraction, no forms. If this fails, the problem is plumbing, not the model.
2. *"Search Wikipedia for the Cassini spacecraft and summarise the first
   paragraph."* — adds typing into a field and following a result.
3. *"Go to YouTube and search for lofi hip hop."* — heavier, more dynamic DOM;
   this is where a small model starts to struggle.
4. Something multi-step on a site you know well — the real test is whether it
   recovers when a step does not do what it expected.

### 6. What to record when something fails

The useful distinction is *which layer* failed:

- **Did it pick a bad action?** (clicked the wrong thing, gave up early, looped)
  That is model quality. Note the task, the step, and what it chose instead.
  Trying LFM2.5-2.6B vs Qwen3-4B on the same task is the informative comparison.
- **Did the action fail to execute?** (click did nothing, text did not land)
  That is the browser layer. The service-worker log names the action and its
  arguments.
- **Did it never get that far?** (no tokens, error on load) That is the engine.
  Offscreen-document console.
- **Did it run out of context on a long task?** History compaction is in, but the
  real ceiling is KV cache inside a shared 4 GiB heap. Note how many steps it got
  through.

## Vision mode

Text/DOM is the default path. Vision is opt-in and **experimental**.

To try it: select `lfm2.5-vl-3b-q5_k_m` (2.52 GB with its projector) and enable
`useVision` in general settings. That combination switches the action set from
element indices to pixel coordinates, because a model shown only a screenshot has
no idea what "index 12" refers to.

Both inputs are available and which is used depends on the model:

- **Text model** — DOM tree only. Images are not attached at all.
- **Vision model with `useVision`** — the screenshot goes to the SDK's VLM path,
  and the DOM text still accompanies it. Only the newest screenshot is kept;
  re-sending every frame would exhaust the context in a few steps.

The thing most likely to be wrong here is coordinate scaling on a retina display
(the screenshot is `devicePixelRatio` times the CSS viewport that CDP clicks
into). That conversion is unit-tested in both directions, but if clicks land
consistently up-and-left of their target, that is the suspect.

## Computer-use (CUA) models

The SDK has a CUA layer — a system-prompt builder plus an action parser with an
18-verb vocabulary (click/type/scroll/drag/navigate/wait/ask/terminate…) that
rescales the model's coordinates into your viewport.

It shipped with exactly one profile, for Microsoft Fara, in a compile-time C
array. Fara does not fit in a browser (its smallest GGUF is the 9B at ~5.5 GB),
so that profile was effectively unreachable here. Profiles can now be registered
at runtime instead:

```ts
RunAnywhere.CUA.registerProfile('my-vlm', systemPromptForThatModel, {
  width: 1280,
  height: 720, // the space the model was TRAINED to answer in
});
RunAnywhere.CUA.listProfiles();
```

Two things to be careful about, because both fail silently rather than loudly:

- **The coordinate space must be the one the model was trained on.** Everything
  downstream rescales from it, so a wrong number does not error — it just puts
  every click in the wrong place, consistently.
- **The prompt must match what the model actually emits.** A plausible-looking
  prompt for a model that was never trained on that envelope produces output the
  parser cannot read. This is why no extra built-in profiles were added: an
  unverified profile is worse than no profile.

Our own `click_at` / `type_at` / `scroll_at` actions do not depend on any of
this and work with any vision model, so both paths stay open until measurement
says which is better.

## Known limitations, stated plainly

- Chrome and Edge only. Firefox and Safari cannot run this — it depends on
  offscreen documents, WebGPU and OPFS behaviour specific to Chromium.
- The `debugger` banner is unavoidable (see above).
- One model is resident at a time. The Planner and Navigator share it, because
  the SDK's lifecycle store is latest-load-wins per modality, so pointing them at
  different models would evict on every planning turn.
- Models above ~3.5 GB cannot run at all. Weights and KV cache share one 4 GiB
  wasm32 heap. This is why Ornith-1.5-9B, Fara1.5-9B and anything Qwen3.6-sized
  are not options, however good they are.
- The SDK is consumed from vendored tarballs in `vendor/runanywhere/` until those
  packages are published.
