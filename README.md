<h1 align="center">RA Browser Use</h1>

<p align="center">
  <img src="chrome-extension/public/icon-128.png" width="72" height="72" alt="RA Browser Use" />
</p>

<p align="center"><strong>An AI web agent for Chrome that runs entirely on your machine.</strong></p>

<p align="center">
  Give it a task in plain language and it navigates, clicks, types, and extracts
  for you — with the model running on your own hardware. No API key. No cloud. No
  page content leaving your browser.
</p>

<p align="center">
  <a href="https://github.com/nanobrowser/nanobrowser">Forked from Nanobrowser</a> ·
  Powered by <a href="https://runanywhere.ai">RunAnywhere</a> ·
  Apache-2.0
</p>

---

## This is a public fork of Nanobrowser

RA Browser Use is an openly-declared fork of
**[Nanobrowser](https://github.com/nanobrowser/nanobrowser)** (Apache-2.0), adapted
for local, on-device AI and powered by the [RunAnywhere](https://runanywhere.ai) SDK.

We want to be unambiguous about that, so:

- **Upstream's full commit history is merged into this repository**, not squashed
  away. `git log` and `git blame` show the real provenance of every inherited file.
- **Upstream is tracked as a live git remote**, and we pull its fixes forward:

  ```bash
  git remote add upstream https://github.com/nanobrowser/nanobrowser.git
  git fetch upstream && git merge upstream/master
  ```

- Attribution and the list of significant modifications are in [`NOTICE`](NOTICE).

Nanobrowser built an excellent multi-agent browser automation extension. Our
contribution is a different answer to *where the model runs*: Nanobrowser connects
to cloud LLM providers (or a separately-installed Ollama), while RA Browser Use's
default is a model executing inside the extension itself. Credit for the agent
architecture, the DOM serialization, and the extension foundation belongs upstream.

## What changes in this fork

| | Nanobrowser | RA Browser Use |
|---|---|---|
| Where the model runs | Cloud API, or a separate local Ollama process | **Inside the extension**, via RunAnywhere (WebAssembly + WebGPU) |
| Setup | Bring your own API key | **Nothing to configure** — it picks a model for your hardware |
| Page data | Sent to whichever provider you configure | **Never leaves the browser** on the default path |
| Cost | Per-token provider billing | **Free to run** |
| Cloud providers | The product | Still supported, now optional |

Cloud providers are deliberately kept. Local inference is the default and the
point, but nothing stops you pointing RA Browser Use at a frontier model when a task
genuinely needs one.

## Status

**Early development, not yet released.** The fork foundation is in place and the
extension builds and runs; the on-device inference backend is being wired up.
There is no Chrome Web Store listing yet. Track progress in the issues.

## Development

Requires Node (see [`.nvmrc`](.nvmrc)) and pnpm — `engine-strict` is on, so a
mismatched toolchain fails install rather than breaking mysteriously later.

```bash
nvm use
pnpm install
pnpm build        # or: pnpm dev  (watch mode)
```

Then load it in Chrome: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `dist/`.

```bash
pnpm type-check                  # tsc across every workspace
pnpm lint
pnpm -F chrome-extension test    # vitest
```

Chrome and Edge only. Firefox and Safari are not supported — on-device inference
here depends on Chrome's offscreen-document, WebGPU, and OPFS behaviour.

Architecture notes for contributors and coding agents live in
[`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md).

## Privacy

On the default local path, the model runs in the extension, so page content,
prompts, and model weights stay on your machine. Weights are downloaded once from
a public model host and cached on disk.

Two honest caveats. First, browser automation needs broad browser access, and
those Chrome permissions are real regardless of where inference happens. Second,
if you configure a cloud provider, page content goes to that provider on the same
terms as any other client — that is the trade you are choosing when you do it.

## License

Apache-2.0 — see [`LICENSE`](LICENSE), inherited from Nanobrowser and retained.
Attribution and modifications: [`NOTICE`](NOTICE).
