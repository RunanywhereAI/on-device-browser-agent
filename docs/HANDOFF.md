# Handoff

Where the work lives, what state it is in, and what is genuinely unverified.

## The two repos

### 1. `RunanywhereAI/on-device-browser-agent` — the extension

| Branch / tag | What it is |
|---|---|
| **`master`** | **The work. Start here.** RA Browser Use: nanobrowser forked and rebuilt on the RunAnywhere Web SDK. |
| `legacy/webllm-poc` | The original 12-commit WebLLM proof-of-concept, preserved. |
| `v0.1.0-webllm-poc` | Immutable tag of the same, in case the branch moves. |
| `upstream/master` | nanobrowser. It is a real merge base — `git merge upstream/master` works. |

This is a **fork, declared openly**: nanobrowser's full 369-commit history was merged in with
`--allow-unrelated-histories`, so Apache-2.0 attribution is satisfied by the history itself, plus a
`NOTICE`. The repo's stars and issues are preserved because it was never a GitHub fork.

**Green on `master`:** `pnpm lint` 14/14 · `pnpm type-check` 14/14 ·
`pnpm -F chrome-extension test` 88/88 · `pnpm build` 6/6 · CI runs all four on PR.

### 2. `RunanywhereAI/runanywhere-sdks` — the SDK changes

| Branch | What it is |
|---|---|
| **`feat/web-constrained-decoding-and-cua-profiles`** | Two commits off `main`, open as **PR #749**. Not merged, not published. |
| `main` | Untouched. |

Two changes, both needed by the extension:

1. **Grammar-constrained decoding turned on for web** (`ed52dd56b`). The capability existed all the
   way down — proto, commons JSON-Schema→GBNF compiler, llama.cpp — and only the TypeScript layer
   threw. Deleting that throw also fixed a live bug: `toProtoStructuredOutputOptions()` never set the
   proto `mode` field, so commons read "unset" as CONSTRAINED and **every `validationOnly` call was
   already being grammar-constrained**, contradicting its own docs.
2. **CUA profiles registrable at runtime** (`e3d6a5ed6`). Profiles were a compile-time C array with
   exactly one entry (Microsoft Fara), so adding a computer-use model meant a C++ edit and a release
   across six bindings. Now: `RunAnywhere.CUA.registerProfile(id, prompt, {width, height})`.

The extension consumes the SDK from **vendored tarballs in `vendor/runanywhere/`**, not npm, so it
builds without either branch being merged. When these are published, swap the `file:` deps.

## What is verified and what is not — read this before judging anything

Every gate above is green, and **not one of them runs a model.** The simulated task drives real
action dispatch against a fake browser, so the plumbing is proven; nothing is known about whether a
4B model picks sensible actions on a real page. That is the open question and it needs a person.

Three things are specifically unverified:

- **No model has been run end to end.** Start with `docs/TESTING.md` §"What a human has to do".
- **The default is reasoned, not measured.** Qwen3.5-4B vs LFM2.5-2.6B on the same tasks is the
  comparison that should decide it. See `docs/MODELS.md`.
- **The CUA path builds but has no profile.** The C++ registry, the four exported entry points and
  the TypeScript surface are all in place, but the *vendored WASM predates them*, so
  `registerProfile` throws a rebuild hint until `npm run build:wasm` runs in `bindings/web`. No
  catalog model declares a `cua` profile, so nothing calls it today.

That last one is deliberate. A CUA profile fails **silently**: a wrong `modelSpace` does not error,
it puts every click in the same wrong place, and a prompt the model was never trained on produces
output the parser cannot read. An unverified profile is worse than no profile — it looks like a bad
model. Add one per model, as each is verified.

## Where to start

1. `nvm use && pnpm install && pnpm build`, then load `dist/` unpacked at `chrome://extensions`.
2. `docs/TESTING.md` — how to run it, **where the logs are** (most model problems surface only in the
   offscreen document's console, not the page console), and tasks worth trying in order.
3. `docs/MODELS.md` — what ships, the measured sizes, and what was ruled out with numbers.

The one automation gap: branded Chrome refuses `--load-extension`, so `tools/smoke/smoke-extension.mjs`
reports INCONCLUSIVE (exit 2) rather than a false pass. It needs Chromium to go further.
