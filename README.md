# aha-app

The **Aha!** app: one private conversation with Aha! Your private agent, which runs on your own computer
([aha-local-llm](https://github.com/axxlabs/aha-local-llm)). It's an installable web app (add it to your home
screen); store versions come later.

- **End-to-end encrypted.** Pairing is a QR code from your computer (`aha pair <name>`): a hybrid post-quantum
  handshake (X25519 + ML-KEM-768) bound to a secret that only the QR code carries, then a Double Ratchet with
  ML-KEM steps: a fresh key for every message. The [gateway](https://github.com/axxlabs/aha-gateway) in the
  middle only sees ciphertext.
- **Your history stays yours.** Your computer keeps the conversation; this app keeps only a small cache of
  recent messages, encrypted at rest (30 days by default, down to none, in Settings).
- **It asks before it acts.** Forms and memories come as cards: Approve, Edit (in the card), Decline.
- **No third parties.** No analytics, fonts or scripts from anywhere else; a strict Content-Security-Policy.
  Notifications only ever say "New message from Aha!" unless your computer is set to send verified previews.

## Develop

```sh
npm install
npm run dev        # http://127.0.0.1:5173 (pair it with `aha pair <name>` from a computer whose config
                   # has app = "http://127.0.0.1:5173")
npm test           # crypto (incl. vectors shared with aha-local-llm), markdown safety, fuzzing
npm run build      # dist/: the app plus dist/sw.js (service worker)
```

`src/crypto.ts` mirrors `aha_local/e2e/crypto.py`. `test/vectors/from_python.json` comes from aha-local-llm
(`scripts/make_vectors.py`); `WRITE_VECTORS=1 npm test` writes `test/vectors/from_ts.json`, which
aha-local-llm's tests verify.

Serve `dist/` from a static origin of its own (not from the gateway) and list that origin in the gateway's
`AHA_GW_APP_ORIGINS`. Crypto needs a secure context: https, or localhost.

## Security

See `SECURITY.md`. The protocol code hasn't had an external review yet.

## Licence

Copyright (C) 2026 Axxlabs Limited. GNU Affero General Public License, version 3 or (at your option) any later
version: see `LICENSE`.
