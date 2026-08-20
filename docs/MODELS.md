# Models

What ships in v1, why, and what to actually test.

The single fact that drives every decision here: **weights and KV cache share one
4 GiB WebAssembly heap.** The SDK pins `-sMAXIMUM_MEMORY=4294967296` identically
for every target, so the WebGPU build gets no more room than the CPU build, and
Memory64 is disabled (the SDK's main module is wasm32 and Emscripten cannot link
wasm32 against wasm64). After runtime, stack and staging overhead, about
**3.5 GB** is available, and every byte spent on weights is a byte not available
for context.

That inverts the usual instinct. A smaller model is not a compromise here — it
buys the context that decides how long an agentic task survives.

---

## Shipping in v1

Selected automatically at first run; the options page can override.

| Model | Quant | Download | Context | Role |
|---|---|---|---|---|
| **LFM2.5-2.6B** | Q5_K_M | **1.94 GB** | 32k configured (131k native) | **Default** |
| LFM2.5-1.2B | Q5_K_M | 0.79 GB | 32k configured (131k native) | Fast start |
| Qwen3-4B | Q4_K_M | 2.33 GB | 16k configured (32k native) | Alternative |
| Qwen3-0.6B | Q4_K_M | 0.37 GB | 4k | CI only — never auto-selected |
| LFM2.5-VL-3B | Q5_K_M + Q8_0 mmproj | 2.52 GB | 16k configured | Vision, experimental |

Every size was measured from the live download URL, not estimated. The exact
URLs are in `packages/runanywhere/lib/modelCatalog.ts`.

### Why LFM2.5-2.6B is the default

- Liquid post-trained it **as an agent**. Their model card recommends it for
  "agentic workloads, tool use, data extraction, RAG, and long-context
  workflows" — which is this product's job description.
- At 1.94 GB it leaves roughly 1.6 GB for KV cache, against ~1.3 GB for a 4B.
- The SDK ships a **dedicated LFM2 tool-call parser**
  (`core/src/features/llm/tool_calling.cpp:119`), so its tool output is
  understood natively rather than by a generic fallback.
- Its card notes it is weaker at coding and knowledge-heavy tasks. Neither is
  what browser automation asks of it.

### Why Q5_K_M rather than Q4

Under a fixed budget the useful question is quality per byte, not parameter
count. Q5_K_M costs about 0.27 GB more than Q4_K_M on the 2.6B and is
meaningfully closer to the unquantised model, while still leaving more KV
headroom than a 4B at Q4 would. Going the other way — a 9B crushed to Q2 —
spends the whole budget on weights, destroys quality, and leaves nothing for
context.

Two tuning ends if this needs adjusting: **Q6_K** (2.22 GB, closer to
unquantised) and Liquid's quantisation-aware **QAD-Q4_0** (1.59 GB, maximum
context).

---

## Ruled out, with the numbers

These come up repeatedly, so here is why each is not in the list. All are good
models; the constraint is the browser, not the model.

| Model | Why not |
|---|---|
| **Ornith-1.5-9B** | 9.41B, MIT, vision-language. Smallest published quant (IQ2_M) is 3.51 GB, and being a VLM it also needs an 0.86 GB projector — **4.37 GB together, more than the entire 4 GiB address space**, with nothing left for KV. Q4_K_M is 5.50 GB. |
| **Qwen3.6 (any size)** | **There is no small variant.** Qwen publishes 27B dense and 35B-A3B only. Every smaller "Qwen3.6" on the hub is a community merge at 27B+. |
| **LFM2.5-8B-A1B** | 4.80 GB at Q4_K_M. Mixture-of-experts cuts *compute* to ~1B active, but every expert stays resident. |
| **Fara1.5** | Purpose-built for browser use and otherwise ideal, but the smallest published GGUF is the 9B at ~5.5 GB. Worth re-checking whether a 4B GGUF appears. |
| **Qwen3-VL-4B** | Fits only on paper: 3.11 GB leaves ~0.5 GB for KV *and* image tokens. LFM2.5-VL-3B does the same job with room to work. |

**These limits are browser-only.** The same catalog concept on Mac (MLX), native
desktop (GGUF) or the Hexagon NPU has no 4 GiB wall, so a 9B or 27B is fine
there. If a CUA model matters more than the browser target, that is where it
belongs.

---

## Vision

Text/DOM is the default. Vision is opt-in and **experimental**: select
`lfm2.5-vl-3b-q5_k_m` and enable `useVision`.

That combination switches the action set from element indices to pixel
coordinates, because a model shown only a screenshot has no idea what "index 12"
refers to. The two sets are mutually exclusive by design — offering both invites
the model to mix them.

Which inputs get sent depends on the model:

- **Text model** — DOM tree only. No image is attached at all.
- **Vision model with `useVision`** — the screenshot goes through the SDK's VLM
  path, with the DOM text alongside it. Only the newest screenshot is kept;
  re-sending every frame exhausts the context in a few steps.

---

## Adding a computer-use (CUA) model

The SDK's CUA layer builds the system prompt and parses the model's actions into
an 18-verb vocabulary, rescaling coordinates into the live viewport. It shipped
with one profile (Microsoft Fara) baked into a compile-time C array, which meant
supporting another model required a C++ edit, an SDK rebuild, and a release
across six language bindings.

Profiles are now registrable at runtime, and a model declares its own:

```ts
// packages/runanywhere/lib/modelCatalog.ts
{
  id: 'some-cua-model',
  // ...the usual fields...
  vision: true,
  cua: {
    profileId: 'some-cua-model',
    systemPrompt: THE_PROMPT_THAT_MODEL_WAS_TRAINED_ON,
    modelSpace: { width: 1000, height: 1000 },
  },
}
```

That is the whole change. The offscreen host registers every declared profile at
boot, so nothing downstream needs to know the model is special.

**Two things must be right, and neither fails loudly:**

- `systemPrompt` must be the envelope the model was actually trained to emit. A
  plausible-looking prompt for a model that never saw it produces output the
  parser cannot read.
- `modelSpace` must be the coordinate space it answers in. Every coordinate is
  rescaled from it, so a wrong value does not error — it puts every click in the
  same wrong place, consistently.

This is exactly why **no additional built-in profiles were added**. An unverified
profile is worse than no profile: it fails silently and looks like a bad model.
Add one per model as it is verified.

**Current status of this path, precisely:** the C++ registry, the four exported
entry points, and the TypeScript surface are all in place and the library builds
with the symbols exported. The *vendored WASM* predates the change, so
`CUA.registerProfile` will throw its rebuild hint until the WASM is rebuilt
(`npm run build:wasm` in `bindings/web`). No model in the catalog declares a
`cua` profile today, so nothing calls it and there is no runtime impact — the
registration loop is a no-op. Rebuild the WASM at the same time as adding the
first real profile.

---

## What to test first

In this order, because each adds one failure mode:

1. **Qwen3-0.6B** (0.37 GB) — proves the pipeline downloads, loads, and
   generates. It is deliberately too weak to navigate well; do not judge quality
   here, only plumbing.
2. **LFM2.5-1.2B** (0.79 GB) — the fast-start path a real user might pick.
3. **LFM2.5-2.6B** (1.94 GB) — the actual default. This is the one whose task
   success matters.
4. **Qwen3-4B** (2.33 GB) — the comparison. Same tasks as step 3; the
   interesting question is whether the extra parameters beat the extra context.
5. **LFM2.5-VL-3B** (2.52 GB) — vision, only after the DOM path is understood.

The comparison in step 4 is the one that decides the default. If Qwen3-4B wins
on real multi-step tasks despite less KV headroom, the default should change —
the reasoning above is sound but it is reasoning, not measurement.

See [`TESTING.md`](TESTING.md) for how to run these and where the logs are.
