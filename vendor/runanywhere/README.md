# Vendored RunAnywhere Web SDK

These tarballs are the on-device inference engine: `@runanywhere/web` (the SDK) and
`@runanywhere/web-llamacpp` (the llama.cpp WASM backend, CPU and WebGPU builds).

## Why they are committed rather than installed from npm

Two reasons, and the second is not optional:

1. **These builds are not published yet.** They are built from a sibling
   `runanywhere-sdks` checkout and carry a change that is not in any released
   version: grammar-constrained decoding enabled on the Web target. Without it a
   small local model has to be asked nicely for valid JSON instead of being made
   incapable of producing anything else. When those packages are published, these
   files go away and `pages/offscreen/package.json` points at the registry
   instead — that is the only change needed.

2. **A `file:` path to a sibling repository cannot work in CI.** Only this
   repository is checked out there, so `../../runanywhere-sdks/...` does not
   exist and `pnpm install --frozen-lockfile` fails outright. Vendoring makes the
   repository self-contained and buildable by anyone who clones it.

The `.wasm` binaries inside the llamacpp tarball have to ship inside the
extension package regardless: the Chrome Web Store forbids remotely-hosted
executable code. Model *weights* are data and are fetched at runtime, which is
allowed; the engine that runs them is code and is not.

## Provenance

Built with `bindings/web/scripts/package-sdk.sh --mode local` from
`runanywhere-sdks` at branch `feat/web-constrained-decoding-and-capabilities`.
`.sha256` files are the checksums that script emitted; verify with:

```bash
cd vendor/runanywhere && shasum -a 256 -c *.sha256
```

## Updating

Rebuild in the SDK repo, copy both `.tgz` and both `.sha256` here, then
`pnpm install` so the lockfile records the new integrity hashes.
