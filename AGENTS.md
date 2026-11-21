# Instructions for coding agents

Design notes: Axxlabs keeps the design specification privately; the rules that matter are here and in the
tests. For a change in behaviour, say what changes and why before writing code.

Rules:
- `src/crypto.ts` mirrors aha-local-llm's `aha_local/e2e/crypto.py` (AHA-PQ v1). Never change one without the
  other; both must keep passing the shared vectors (`test/vectors/`). Primitives come only from @noble; no
  home-made cryptography, no other crypto dependencies.
- Never log, display or send keys, ratchet state, the pairing secret or decrypted content anywhere but the
  screen. The pairing link's fragment is removed from the address bar at once (`history.replaceState`).
- Everything stored goes through `src/store.ts` (AES-GCM with a non-extractable key). The device is a cache;
  the computer keeps the history.
- Untrusted text is rendered only with `textContent`, or as Markdown through `src/markdown.ts` (no HTML, no
  remote images, http(s)/mailto links only). Don't add `innerHTML` for anything else.
- No third-party requests (fonts, analytics, CDNs): the CSP in `vite.config.ts` must stay as strict.
- Notifications show fixed text unless a preview decrypts and verifies under the push key (`src/sw.ts`).
- Every source file starts with the SPDX and copyright header.
- `npx tsc --noEmit && npm test` before every commit.
