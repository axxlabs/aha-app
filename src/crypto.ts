// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// AHA-PQ v1 (SPEC §6.8): hybrid post-quantum pairing and a Double Ratchet with ML-KEM steps.
// Primitives come from the audited @noble libraries; this file only composes them. It mirrors
// aha-local-llm's aha_local/e2e/crypto.py, and both are checked with shared test vectors.

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf as nobleHkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";

export const VERSION = 1;
const enc = new TextEncoder();
const PROTOCOL = enc.encode("AHA-PQ-v1");
const INFO_PAIR = enc.encode("AHA-PQ-v1 pair");
const INFO_RATCHET = enc.encode("AHA-PQ-v1 ratchet");
const INFO_MSG = enc.encode("AHA-PQ-v1 msg");
const AD_PUSH = enc.encode("AHA-PQ-v1 push");

export const KEM_PK_LEN = 1184;
export const KEM_CT_LEN = 1088;
export const KEM_SEED_LEN = 64;
export const HEADER_LEN = 1 + 32 + 4 + 4 + KEM_CT_LEN;
const PAD_BLOCK = 256;
export const MAX_BOX = 2 * 1024 * 1024;
export const MAX_SKIP = 200;
const MAX_SKIPPED_TOTAL = 1000;
const SKIPPED_TTL = 7 * 24 * 3600;

export class CryptoError extends Error {}

// ---- encoding

export function b64e(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64d(text: string, length?: number): Uint8Array {
  let bin: string;
  try {
    bin = atob(text);
  } catch {
    throw new CryptoError("bad base64");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (length !== undefined && out.length !== length) throw new CryptoError("bad length");
  return out;
}

export function b64urlDecode(text: string): Uint8Array {
  const std = text.replace(/-/g, "+").replace(/_/g, "/");
  return b64d(std + "=".repeat((4 - (std.length % 4)) % 4));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// ---- primitives

export function x25519Keypair(seed?: Uint8Array): [Uint8Array, Uint8Array] {
  const priv = seed ?? randomBytes(32);
  return [priv, x25519.getPublicKey(priv)];
}

export function dh(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  if (pub.length !== 32) throw new CryptoError("bad X25519 key");
  let out: Uint8Array;
  try {
    out = x25519.getSharedSecret(priv, pub);
  } catch {
    throw new CryptoError("bad X25519 key");
  }
  if (out.every((b) => b === 0)) throw new CryptoError("bad X25519 key");
  return out;
}

export function kemKeypair(seed?: Uint8Array): [Uint8Array, Uint8Array] {
  const s = seed ?? randomBytes(KEM_SEED_LEN);
  return [s, ml_kem768.keygen(s).publicKey];
}

export function kemEncaps(pub: Uint8Array): [Uint8Array, Uint8Array] {
  if (pub.length !== KEM_PK_LEN) throw new CryptoError("bad ML-KEM key");
  const { sharedSecret, cipherText } = ml_kem768.encapsulate(pub);
  return [sharedSecret, cipherText];
}

export function kemDecaps(seed: Uint8Array, ct: Uint8Array): Uint8Array {
  if (ct.length !== KEM_CT_LEN) throw new CryptoError("bad ML-KEM ciphertext");
  return ml_kem768.decapsulate(ct, ml_kem768.keygen(seed).secretKey);
}

export function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  return nobleHkdf(nobleSha256, ikm, salt, info, length);
}

export function hmac256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(nobleSha256, key, data);
}

export const sha256 = (data: Uint8Array): Uint8Array => nobleSha256(data);

export function seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, ad: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonce, ad).encrypt(plaintext);
}

export function unseal(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, ad: Uint8Array): Uint8Array {
  try {
    return chacha20poly1305(key, nonce, ad).decrypt(ciphertext);
  } catch {
    throw new CryptoError("does not decrypt");
  }
}

export function pad(data: Uint8Array): Uint8Array {
  const len = data.length + 1;
  const out = new Uint8Array(len + ((PAD_BLOCK - (len % PAD_BLOCK)) % PAD_BLOCK));
  out.set(data);
  out[data.length] = 0x80;
  return out;
}

export function unpad(data: Uint8Array): Uint8Array {
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end--;
  if (end === 0 || data[end - 1] !== 0x80) throw new CryptoError("bad padding");
  return data.slice(0, end - 1);
}

// ---- pairing (SPEC §6.4, §6.8)

export const fingerprint = (ikPub: Uint8Array, kemPub: Uint8Array) => sha256(concat(ikPub, kemPub));

export function transcript(...parts: Uint8Array[]): Uint8Array {
  return sha256(concat(INFO_PAIR, ...parts));
}

export interface PairKeys {
  sk: Uint8Array;
  pushKey: Uint8Array;
  confirmD: Uint8Array;
  confirmC: Uint8Array;
  th: Uint8Array;
}

export function pairKeys(psk: Uint8Array, th: Uint8Array, dhs: Uint8Array[], ss: Uint8Array): PairKeys {
  const okm = hkdf(psk, concat(new Uint8Array(32).fill(0xff), ...dhs, ss), concat(INFO_PAIR, th), 128);
  return { sk: okm.slice(0, 32), pushKey: okm.slice(32, 64), confirmD: okm.slice(64, 96), confirmC: okm.slice(96, 128), th };
}

export const deviceMac = (pk: PairKeys) => hmac256(pk.confirmD, concat(enc.encode("device"), pk.th));
export const computerMac = (pk: PairKeys) => hmac256(pk.confirmC, concat(enc.encode("computer"), pk.th));
export const sessionAd = (ikd: Uint8Array, ikc: Uint8Array) => concat(PROTOCOL, ikd, ikc);

export interface DeviceKeys {
  ikPriv: Uint8Array;
  ikPub: Uint8Array;
  kemSeed: Uint8Array;
  kemPub: Uint8Array;
  sigPriv: Uint8Array;
  sigPub: Uint8Array;
}

export function generateDeviceKeys(): DeviceKeys {
  const [ikPriv, ikPub] = x25519Keypair();
  const [kemSeed, kemPub] = kemKeypair();
  const sigPriv = randomBytes(32);
  return { ikPriv, ikPub, kemSeed, kemPub, sigPriv, sigPub: ed25519.getPublicKey(sigPriv) };
}

export function sign(priv: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, priv);
}

export function verify(pub: Uint8Array, message: Uint8Array, sig: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, message, pub);
  } catch {
    return false;
  }
}

export interface Bundle {
  ikc: string;
  kemc: string;
  ekc: string;
}

/** Device step 4: check the computer's bundle against the QR fingerprint, derive keys, build the reply. */
export function deviceFinish(bundle: Bundle, fp: Uint8Array, psk: Uint8Array, keys: DeviceKeys) {
  const ikc = b64d(bundle.ikc, 32);
  const kemc = b64d(bundle.kemc, KEM_PK_LEN);
  const ekc = b64d(bundle.ekc, 32);
  if (!equal(fingerprint(ikc, kemc), fp)) throw new CryptoError("fingerprint mismatch");
  const [ekPriv, ekPub] = x25519Keypair();
  const [ss, ct] = kemEncaps(kemc);
  const th = transcript(ikc, kemc, ekc, keys.ikPub, keys.kemPub, keys.sigPub, ekPub, ct);
  const pk = pairKeys(psk, th, [dh(keys.ikPriv, ikc), dh(ekPriv, ikc), dh(keys.ikPriv, ekc), dh(ekPriv, ekc)], ss);
  const message = {
    ikd: b64e(keys.ikPub),
    kemd: b64e(keys.kemPub),
    sigd: b64e(keys.sigPub),
    ekd: b64e(ekPub),
    ct: b64e(ct),
    mac: b64e(deviceMac(pk)),
  };
  return { message, pk, ikc, kemc, ekc };
}

export function deviceCheckComputer(pk: PairKeys, macC: Uint8Array): void {
  if (!equal(computerMac(pk), macC)) throw new CryptoError("computer MAC mismatch");
}

// ---- Double Ratchet with ML-KEM steps (SPEC §6.8)

export function kdfRk(rk: Uint8Array, dhOut: Uint8Array, kemSs: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdf(rk, concat(dhOut, kemSs), INFO_RATCHET, 64);
  return [out.slice(0, 32), out.slice(32)];
}

export function kdfCk(ck: Uint8Array): [Uint8Array, Uint8Array] {
  return [hmac256(ck, Uint8Array.of(2)), hmac256(ck, Uint8Array.of(1))];
}

function messageKeyMaterial(mk: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdf(new Uint8Array(32), mk, INFO_MSG, 44);
  return [out.slice(0, 32), out.slice(32)];
}

interface Header {
  dh: Uint8Array;
  pn: number;
  n: number;
  kemCt: Uint8Array;
}

function encodeHeader(h: Header): Uint8Array {
  const out = new Uint8Array(HEADER_LEN);
  out[0] = VERSION;
  out.set(h.dh, 1);
  const view = new DataView(out.buffer);
  view.setUint32(33, h.pn);
  view.setUint32(37, h.n);
  out.set(h.kemCt, 41);
  return out;
}

function decodeHeader(data: Uint8Array): Header {
  if (data.length < HEADER_LEN || data[0] !== VERSION) throw new CryptoError("bad header");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { dh: data.slice(1, 33), pn: view.getUint32(33), n: view.getUint32(37), kemCt: data.slice(41, HEADER_LEN) };
}

/** JSON state, the same format as Ratchet.to_dict() in aha-local-llm. */
export interface RatchetState {
  v: number;
  ad: string;
  rk: string;
  dhs: [string, string];
  dhr: string | null;
  cks: string | null;
  ckr: string | null;
  ns: number;
  nr: number;
  pn: number;
  kem: string;
  peer_kem: string;
  send_ct: string | null;
  skipped: Record<string, [string, number]>;
}

export class Ratchet {
  private constructor(
    public ad: Uint8Array,
    public rk: Uint8Array,
    public dhsPriv: Uint8Array,
    public dhsPub: Uint8Array,
    public dhr: Uint8Array | null,
    public cks: Uint8Array | null,
    public ckr: Uint8Array | null,
    public ns: number,
    public nr: number,
    public pn: number,
    public myKemSeed: Uint8Array,
    public peerKemPub: Uint8Array,
    public sendKemCt: Uint8Array | null,
    public skipped: Record<string, [string, number]>,
  ) {}

  /** "Alice": the device ratchets at once towards the computer's pairing key EKc. */
  static initDevice(sk: Uint8Array, ad: Uint8Array, ekc: Uint8Array, kemSeed: Uint8Array, kemc: Uint8Array): Ratchet {
    const [dhsPriv, dhsPub] = x25519Keypair();
    const [ss, ct] = kemEncaps(kemc);
    const [rk, cks] = kdfRk(sk, dh(dhsPriv, ekc), ss);
    return new Ratchet(ad, rk, dhsPriv, dhsPub, ekc, cks, null, 0, 0, 0, kemSeed, kemc, ct, {});
  }

  /** "Bob": used by tests that play the computer. */
  static initComputer(sk: Uint8Array, ad: Uint8Array, ekPriv: Uint8Array, ekPub: Uint8Array, kemSeed: Uint8Array, kemd: Uint8Array): Ratchet {
    return new Ratchet(ad, sk, ekPriv, ekPub, null, null, null, 0, 0, 0, kemSeed, kemd, null, {});
  }

  toJSON(): RatchetState {
    const opt = (b: Uint8Array | null) => (b ? b64e(b) : null);
    return {
      v: VERSION,
      ad: b64e(this.ad),
      rk: b64e(this.rk),
      dhs: [b64e(this.dhsPriv), b64e(this.dhsPub)],
      dhr: opt(this.dhr),
      cks: opt(this.cks),
      ckr: opt(this.ckr),
      ns: this.ns,
      nr: this.nr,
      pn: this.pn,
      kem: b64e(this.myKemSeed),
      peer_kem: b64e(this.peerKemPub),
      send_ct: opt(this.sendKemCt),
      skipped: { ...this.skipped },
    };
  }

  static fromJSON(d: RatchetState): Ratchet {
    if (d.v !== VERSION) throw new CryptoError("unknown state version");
    const opt = (v: string | null, n?: number) => (v === null ? null : b64d(v, n));
    return new Ratchet(
      b64d(d.ad),
      b64d(d.rk, 32),
      b64d(d.dhs[0], 32),
      b64d(d.dhs[1], 32),
      opt(d.dhr, 32),
      opt(d.cks, 32),
      opt(d.ckr, 32),
      d.ns,
      d.nr,
      d.pn,
      b64d(d.kem, KEM_SEED_LEN),
      b64d(d.peer_kem, KEM_PK_LEN),
      opt(d.send_ct, KEM_CT_LEN),
      { ...(d.skipped ?? {}) },
    );
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    if (!this.cks || !this.sendKemCt) throw new CryptoError("no sending chain yet");
    const [ck, mk] = kdfCk(this.cks);
    this.cks = ck;
    const header = encodeHeader({ dh: this.dhsPub, pn: this.pn, n: this.ns, kemCt: this.sendKemCt });
    this.ns += 1;
    const [key, nonce] = messageKeyMaterial(mk);
    return concat(header, seal(key, nonce, pad(plaintext), concat(this.ad, header)));
  }

  /** All or nothing: the state changes only if the message decrypts. */
  decrypt(box: Uint8Array, now: number = Math.floor(Date.now() / 1000)): Uint8Array {
    if (box.length > MAX_BOX) throw new CryptoError("too large");
    const work = Ratchet.fromJSON(this.toJSON());
    const plaintext = work.decryptInPlace(box, now);
    Object.assign(this, work);
    return plaintext;
  }

  private decryptInPlace(box: Uint8Array, now: number): Uint8Array {
    this.expireSkipped(now);
    const headerBytes = box.slice(0, HEADER_LEN);
    const body = box.slice(HEADER_LEN);
    const header = decodeHeader(headerBytes);
    const slot = `${b64e(header.dh)}:${header.n}`;
    if (slot in this.skipped) {
      const mk = b64d(this.skipped[slot][0], 32);
      delete this.skipped[slot];
      return this.open(mk, headerBytes, body);
    }
    if (!this.dhr || !equal(header.dh, this.dhr)) {
      this.skip(header.pn, now);
      this.dhRatchet(header);
    }
    this.skip(header.n, now);
    const [ck, mk] = kdfCk(this.ckr as Uint8Array);
    this.ckr = ck;
    this.nr += 1;
    return this.open(mk, headerBytes, body);
  }

  private open(mk: Uint8Array, headerBytes: Uint8Array, body: Uint8Array): Uint8Array {
    const [key, nonce] = messageKeyMaterial(mk);
    return unpad(unseal(key, nonce, body, concat(this.ad, headerBytes)));
  }

  private skip(until: number, now: number): void {
    if (!this.ckr) return;
    if (until - this.nr > MAX_SKIP) throw new CryptoError("too far ahead");
    while (this.nr < until) {
      const [ck, mk] = kdfCk(this.ckr);
      this.ckr = ck;
      this.skipped[`${b64e(this.dhr as Uint8Array)}:${this.nr}`] = [b64e(mk), now];
      this.nr += 1;
    }
    const keys = Object.keys(this.skipped);
    if (keys.length > MAX_SKIPPED_TOTAL) {
      keys.sort((a, b) => this.skipped[a][1] - this.skipped[b][1]);
      for (const k of keys.slice(0, keys.length - MAX_SKIPPED_TOTAL)) delete this.skipped[k];
    }
  }

  private expireSkipped(now: number): void {
    for (const [k, v] of Object.entries(this.skipped)) if (now - v[1] >= SKIPPED_TTL) delete this.skipped[k];
  }

  private dhRatchet(header: Header): void {
    this.pn = this.ns;
    this.ns = 0;
    this.nr = 0;
    this.dhr = header.dh;
    const ss = kemDecaps(this.myKemSeed, header.kemCt);
    [this.rk, this.ckr] = kdfRk(this.rk, dh(this.dhsPriv, this.dhr), ss);
    [this.dhsPriv, this.dhsPub] = x25519Keypair();
    const [ss2, ct2] = kemEncaps(this.peerKemPub);
    this.sendKemCt = ct2;
    [this.rk, this.cks] = kdfRk(this.rk, dh(this.dhsPriv, this.dhr), ss2);
  }
}

const dec = new TextDecoder("utf-8", { fatal: true });

export function encryptJson(r: Ratchet, message: object): string {
  return b64e(r.encrypt(enc.encode(JSON.stringify(message))));
}

export function decryptJson(r: Ratchet, boxB64: string): { t: string; [k: string]: unknown } {
  const plaintext = r.decrypt(b64d(boxB64));
  let message: unknown;
  try {
    message = JSON.parse(dec.decode(plaintext));
  } catch {
    throw new CryptoError("not JSON");
  }
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof (message as { t?: unknown }).t !== "string")
    throw new CryptoError("not a message");
  return message as { t: string };
}

// ---- push payloads (SPEC §6.6)

export interface SealedPush {
  v: number;
  n: string;
  box: string;
}

export function pushSeal(pushKey: Uint8Array, payload: object, nonce: Uint8Array = randomBytes(12)): SealedPush {
  return { v: VERSION, n: b64e(nonce), box: b64e(seal(pushKey, nonce, enc.encode(JSON.stringify(payload)), AD_PUSH)) };
}

export function pushOpen(pushKey: Uint8Array, sealed: SealedPush): unknown {
  if (sealed.v !== VERSION) throw new CryptoError("bad push version");
  return JSON.parse(dec.decode(unseal(pushKey, b64d(sealed.n, 12), b64d(sealed.box), AD_PUSH)));
}
