// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { readFileSync, writeFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as c from "../src/crypto";

const enc = new TextEncoder();
const fromPython = JSON.parse(readFileSync(new URL("./vectors/from_python.json", import.meta.url), "utf8"));

function checkVectors(v: any) {
  const p = v.pairing;
  const s = Object.fromEntries(Object.entries(p.seeds).map(([k, x]) => [k, c.b64d(x as string)])) as Record<string, Uint8Array>;
  const [ikcP, ikc] = c.x25519Keypair(s.ikc);
  const [kemcS, kemc] = c.kemKeypair(s.kemc);
  const [ekcP, ekc] = c.x25519Keypair(s.ekc);
  const [ikdP, ikd] = c.x25519Keypair(s.ikd);
  const [, kemd] = c.kemKeypair(s.kemd);
  const sigd = ed25519.getPublicKey(s.sigd);
  const [ekdP, ekd] = c.x25519Keypair(s.ekd);
  const ct = c.b64d(p.kem_ct);
  const ss = c.kemDecaps(kemcS, ct);
  const th = c.transcript(ikc, kemc, ekc, ikd, kemd, sigd, ekd, ct);
  const pk = c.pairKeys(c.b64d(p.psk), th, [c.dh(ikdP, ikc), c.dh(ekdP, ikc), c.dh(ikdP, ekc), c.dh(ekdP, ekc)], ss);
  // the computer's side must agree too
  expect(c.b64e(c.dh(ikcP, ikd))).toBe(c.b64e(c.dh(ikdP, ikc)));
  expect(c.b64e(c.dh(ekcP, ekd))).toBe(c.b64e(c.dh(ekdP, ekc)));
  const e = p.expect;
  expect(c.b64e(c.fingerprint(ikc, kemc))).toBe(e.fp);
  expect(c.b64e(th)).toBe(e.th);
  expect([c.b64e(pk.sk), c.b64e(pk.pushKey), c.b64e(pk.confirmD), c.b64e(pk.confirmC)]).toEqual([e.sk, e.push_key, e.confirm_d, e.confirm_c]);
  expect(c.b64e(c.deviceMac(pk))).toBe(e.mac);
  expect(c.b64e(c.computerMac(pk))).toBe(e.mac_c);
  expect(c.b64e(c.sessionAd(ikd, ikc))).toBe(e.ad);
  for (const step of v.ratchet) {
    const r = c.Ratchet.fromJSON(step.state);
    expect(c.b64e(r.decrypt(c.b64d(step.box), step.now))).toBe(step.plaintext);
  }
  expect(c.pushOpen(c.b64d(v.push.key), v.push.sealed)).toEqual(v.push.payload);
}

function pairInTs() {
  // computer side, written with the same primitives (aha-app only ever plays the device for real)
  const [ikcP, ikc] = c.x25519Keypair();
  const [kemcS, kemc] = c.kemKeypair();
  const [ekcP, ekc] = c.x25519Keypair();
  const psk = c.randomBytes(32);
  const keys = c.generateDeviceKeys();
  const bundle = { ikc: c.b64e(ikc), kemc: c.b64e(kemc), ekc: c.b64e(ekc) };
  const fin = c.deviceFinish(bundle, c.fingerprint(ikc, kemc), psk, keys);
  const m = fin.message;
  const ct = c.b64d(m.ct);
  const th = c.transcript(ikc, kemc, ekc, keys.ikPub, keys.kemPub, keys.sigPub, c.b64d(m.ekd), ct);
  const ekd = c.b64d(m.ekd);
  const pkC = c.pairKeys(psk, th, [c.dh(ikcP, keys.ikPub), c.dh(ikcP, ekd), c.dh(ekcP, keys.ikPub), c.dh(ekcP, ekd)], c.kemDecaps(kemcS, ct));
  expect(c.equal(c.deviceMac(pkC), c.b64d(m.mac))).toBe(true);
  c.deviceCheckComputer(fin.pk, c.computerMac(pkC));
  const ad = c.sessionAd(keys.ikPub, ikc);
  const alice = c.Ratchet.initDevice(fin.pk.sk, ad, ekc, keys.kemSeed, kemc);
  const bob = c.Ratchet.initComputer(pkC.sk, ad, ekcP, ekc, kemcS, keys.kemPub);
  return { alice, bob, fin, psk, ikc, kemc };
}

describe("AHA-PQ v1", () => {
  it("verifies the vectors from aha-local-llm (Python)", () => checkVectors(fromPython));

  it("pairs and talks both ways, out of order, and refuses replays", () => {
    const { alice, bob } = pairInTs();
    expect(new TextDecoder().decode(bob.decrypt(alice.encrypt(enc.encode("hi"))))).toBe("hi");
    const boxes = [0, 1, 2].map((i) => bob.encrypt(enc.encode(`r${i}`)));
    expect(new TextDecoder().decode(alice.decrypt(boxes[2]))).toBe("r2");
    expect(new TextDecoder().decode(alice.decrypt(boxes[0]))).toBe("r0");
    expect(() => alice.decrypt(boxes[2])).toThrow(c.CryptoError);
    expect(new TextDecoder().decode(alice.decrypt(boxes[1]))).toBe("r1");
  });

  it("refuses a wrong fingerprint, a wrong computer MAC and tampering, without changing state", () => {
    const { alice, bob, fin } = pairInTs();
    expect(() => c.deviceCheckComputer(fin.pk, c.randomBytes(32))).toThrow(c.CryptoError);
    const keys = c.generateDeviceKeys();
    const [, ikc] = c.x25519Keypair();
    const [, kemc] = c.kemKeypair();
    const [, ekc] = c.x25519Keypair();
    const bundle = { ikc: c.b64e(ikc), kemc: c.b64e(kemc), ekc: c.b64e(ekc) };
    expect(() => c.deviceFinish(bundle, c.randomBytes(32), c.randomBytes(32), keys)).toThrow(c.CryptoError);
    const box = alice.encrypt(enc.encode("x"));
    const before = JSON.stringify(bob.toJSON());
    const bad = box.slice();
    bad[bad.length - 2] ^= 1;
    expect(() => bob.decrypt(bad)).toThrow(c.CryptoError);
    expect(JSON.stringify(bob.toJSON())).toBe(before);
    expect(new TextDecoder().decode(bob.decrypt(box))).toBe("x");
  });

  it("round-trips state through JSON and JSON messages through the ratchet", () => {
    const { alice, bob } = pairInTs();
    const b2 = c.Ratchet.fromJSON(JSON.parse(JSON.stringify(bob.toJSON())));
    expect(c.decryptJson(b2, c.encryptJson(alice, { t: "say", text: "hé ✅" }))).toEqual({ t: "say", text: "hé ✅" });
    expect(() => c.decryptJson(b2, c.b64e(alice.encrypt(enc.encode("[1]"))))).toThrow(c.CryptoError);
  });

  it("writes vectors for aha-local-llm when WRITE_VECTORS=1", () => {
    if (!process.env.WRITE_VECTORS) return;
    const seed = (label: string, n = 32) => {
      let out: Uint8Array = new Uint8Array(0);
      for (let i = 0; out.length < n; i++) out = c.concat(out, c.sha256(enc.encode(`aha-ts-vector|${label}|${i}`)));
      return out.slice(0, n);
    };
    const seeds: Record<string, Uint8Array> = {};
    for (const k of ["ikc", "kemc", "ekc", "ikd", "kemd", "sigd", "ekd"]) seeds[k] = seed(k, k.startsWith("kem") ? 64 : 32);
    const [, ikc] = c.x25519Keypair(seeds.ikc);
    const [, kemc] = c.kemKeypair(seeds.kemc);
    const [ekcP, ekc] = c.x25519Keypair(seeds.ekc);
    const [ikdP, ikd] = c.x25519Keypair(seeds.ikd);
    const [, kemd] = c.kemKeypair(seeds.kemd);
    const sigd = ed25519.getPublicKey(seeds.sigd);
    const [ekdP, ekd] = c.x25519Keypair(seeds.ekd);
    const psk = seed("psk");
    const [ss, ct] = c.kemEncaps(kemc);
    const th = c.transcript(ikc, kemc, ekc, ikd, kemd, sigd, ekd, ct);
    const pk = c.pairKeys(psk, th, [c.dh(ikdP, ikc), c.dh(ekdP, ikc), c.dh(ikdP, ekc), c.dh(ekdP, ekc)], ss);
    void ekcP;
    const { alice, bob } = pairInTs();
    const sides: Record<string, c.Ratchet> = { device: alice, computer: bob };
    const steps: object[] = [];
    const now = 1_800_000_000;
    const send = (frm: string, text: string) => {
      const pt = enc.encode(JSON.stringify({ t: "msg", text }));
      return { frm, box: sides[frm].encrypt(pt), pt };
    };
    const deliver = (x: { frm: string; box: Uint8Array; pt: Uint8Array }) => {
      const to = x.frm === "device" ? "computer" : "device";
      steps.push({ to, state: sides[to].toJSON(), box: c.b64e(x.box), plaintext: c.b64e(x.pt), now });
      sides[to].decrypt(x.box, now);
    };
    deliver(send("device", "hello from ts"));
    const batch = [0, 1, 2, 3].map((i) => send("computer", `reply ${i} ✅`));
    for (const i of [3, 1, 0, 2]) deliver(batch[i]);
    deliver(send("device", "second"));
    const late = send("device", "late");
    deliver(send("device", "third"));
    deliver(send("computer", "y".repeat(700)));
    deliver(late);
    const pushKey = seed("push");
    const vectors = {
      version: "AHA-PQ-v1",
      pairing: {
        seeds: Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, c.b64e(v)])),
        psk: c.b64e(psk),
        kem_ct: c.b64e(ct),
        expect: {
          fp: c.b64e(c.fingerprint(ikc, kemc)), th: c.b64e(th), sk: c.b64e(pk.sk), push_key: c.b64e(pk.pushKey),
          confirm_d: c.b64e(pk.confirmD), confirm_c: c.b64e(pk.confirmC), mac: c.b64e(c.deviceMac(pk)),
          mac_c: c.b64e(c.computerMac(pk)), ad: c.b64e(c.sessionAd(ikd, ikc)),
        },
      },
      ratchet: steps,
      push: { key: c.b64e(pushKey), payload: { seq: 42, preview: "Booked ✅" }, sealed: c.pushSeal(pushKey, { seq: 42, preview: "Booked ✅" }, seed("nonce", 12)) },
    };
    checkVectors(vectors);
    writeFileSync(new URL("./vectors/from_ts.json", import.meta.url), JSON.stringify(vectors, null, 1) + "\n");
  });
});

describe("fuzz", () => {
  it("rejects random and mutated boxes without changing state", () => {
    const { alice, bob } = pairInTs();
    const good = alice.encrypt(enc.encode('{"t":"say"}'));
    const before = JSON.stringify(bob.toJSON());
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      let bad: Uint8Array;
      if (i % 3 === 0) bad = c.randomBytes(rnd(3000));
      else {
        bad = good.slice();
        for (let k = 0; k <= rnd(6); k++) bad[rnd(bad.length)] ^= 1 << rnd(8);
        if (i % 5 === 0) bad = bad.slice(0, rnd(bad.length));
      }
      if (c.equal(bad, good)) continue;
      expect(() => bob.decrypt(bad)).toThrow(c.CryptoError);
      expect(JSON.stringify(bob.toJSON())).toBe(before);
    }
    expect(new TextDecoder().decode(bob.decrypt(good))).toBe('{"t":"say"}');
  });

  it("rejects malformed pairing links", async () => {
    const { parsePairLink } = await import("../src/client");
    for (const bad of ["", "#pair=", "#pair=!!!", "#x=abc", "#pair=" + btoa('{"v":1,"gw":"javascript:alert(1)"}').replace(/=/g, "")]) {
      expect(() => parsePairLink(bad)).toThrow();
    }
  });
});
