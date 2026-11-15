# WebOS local speech engine

Independent speech-recognition engine source, browser worker, microphone/text-control helper and complete pinned runtime/model input lock. This source is not a Desktop app or a new backend service. The current assembly does not enable it.

The original source baseline retains `client.mjs`, `worker.mjs`, three legal texts and captured provenance. The worker uses CPU WASM, a single thread and local-only Whisper tiny English models; no remote model fallback is enabled. `client.mjs` records/transcribes in the tab when explicitly called; microphone permission remains browser/user-controlled. Test acceptance uses a public documentation audio file, never private microphone/account data.

Build from the parent, with a new output path:

```sh
python3 engines/speech/scripts/fetch-inputs.py --inputs artifacts/inputs/speech --cache /private/public-input-cache
node engines/speech/scripts/build.mjs --inputs artifacts/inputs/speech --output /new/output/speech
```

The input fetcher verifies every model file and npm artifact against the captured hashes, never executes dependency scripts, and refuses mismatched destination files. The builder runs offline, verifies all34 input files before output creation, copies the full static graph and legal/provenance material, and records source revision and every payload digest in `component-build.json`. Serve `client.mjs` and its worker from the same component root, preserving relative vendor/model paths. Use appropriate COOP/COEP and WASM MIME headers; browser acceptance checks the required isolated context. Ordinary output collision/source-tree output is refused. No absolute old-workspace imports or mutable external URLs select build inputs.

The original speech baseline pins Transformers3.8.1 and its ONNX1.22 development build. The generic provider wrappers currently select different versions; no cross-version compatibility is assumed. Updating these pins requires a separate tested port, not replacing files behind a receipt. Published npm artifacts are pinned build inputs; this phase does not claim a cold source build of those upstream dependencies or independent npm-signature verification.

`node --test tests/client.test.mjs` checks transcript handling. `tests/browser.mjs` accepts explicit site, public fixture, Chromium and Puppeteer-package paths; it loads the real worker/models, rejects invalid/oversized audio and checks the normalized spoken output against the documented public fixture. `tests/public-audio.lock.json` pins that fixture independently; it is not bundled into runtime output. The fetcher can recover it only when `--fixtures` is explicitly supplied.

Retained licenses, package notices and the model card provide provenance; exact model/package redistribution and release notice review remains separate. No new license grant is inferred. Desktop lifecycle/permission/cancellation wiring, scoped human/agent operations and actual microphone acceptance remain open. This engine is optional for the first Calculator/Files/Text/WordCraft milestone.
