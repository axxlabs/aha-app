// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// The device side of the protocol (SPEC §6.3–§6.6): QR pairing, the authenticated connection to the gateway,
// the end-to-end ratchet with the computer, the outbox and sync. The gateway only ever sees ciphertext.

import * as c from "./crypto";
import type { Item, Store } from "./store";

export const APP_VERSION = "0.2.0";
const enc = new TextEncoder();

export interface PairData {
  v: number;
  gw: string;
  pin: string;
  fp: string;
  code: string;
  psk: string;
  name: string;
  home: string;
}

export interface Cert {
  v: 2;
  device: string;
  instance: string;
  tag: string;
  issued: number;
  expires: number;
  sig: string;
}

export interface Identity {
  v: 1;
  gw: string;
  pin: string;
  home: string;
  name: string;
  deviceName: string;
  keys: Record<"ikPriv" | "ikPub" | "kemSeed" | "kemPub" | "sigPriv" | "sigPub", string>;
  pushKey: string;
  cert: Cert;
  fp?: string; // the computer's fingerprint (base64url SHA-256 of IKc ‖ KEMc), from the pairing link
}

export interface Settings {
  keepDays: number; // 30, 7, 1 or 0 (don't keep)
  notifications: boolean;
  theme: string; // a colour theme id (themes.ts)
  appearance: "auto" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = { keepDays: 30, notifications: false, theme: "saffron-hour", appearance: "auto" };

export function parsePairLink(hash: string): PairData {
  const m = /^#pair=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) throw new Error("This isn't a pairing link.");
  const data = JSON.parse(new TextDecoder().decode(c.b64urlDecode(m[1]))) as PairData;
  if (data.v !== 1 || !data.code || !data.psk || !data.fp || !data.pin || typeof data.gw !== "string")
    throw new Error("This pairing link is incomplete.");
  // wss:// only; plain ws:// just for a gateway on this same machine, in development (SPEC §6.4).
  const url = new URL(data.gw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && local)) throw new Error("This pairing link doesn't use a secure connection.");
  return data;
}

/** What people compare with `aha status` (SPEC §6.4): 16 base32 characters of the fingerprint, in groups of 4. */
export function shortFingerprint(fpB64url: string): string {
  const bytes = c.b64urlDecode(fpB64url);
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= 16) break;
  }
  return out.match(/.{4}/g)!.join(" ");
}

const proofContext = "aha-gateway-v1|";

/** The gateway proves it holds the pinned key by signing our nonce (SPEC §6.3). */
export function gatewayProved(pin: string, nonce: string, sig: unknown): boolean {
  return typeof sig === "string" && c.verify(c.b64d(pin, 32), enc.encode(proofContext + nonce), c.b64d(sig));
}

function certBody(cert: Cert): Uint8Array {
  // Same bytes as certs.cert_body() in Python: sorted keys, compact JSON.
  const fields = { device: cert.device, expires: cert.expires, instance: cert.instance, issued: cert.issued, tag: cert.tag, v: cert.v };
  return enc.encode("aha-cert-v2|" + JSON.stringify(fields));
}

export function certValid(cert: Cert, pin: string, now = Math.floor(Date.now() / 1000)): boolean {
  return cert.v === 2 && now < cert.expires && c.verify(c.b64d(pin, 32), certBody(cert), c.b64d(cert.sig));
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Linux";
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} · ${browser}`;
}

/** Pair this device using a QR link (SPEC §6.4). Resolves with the identity and the fresh ratchet. */
export function pair(data: PairData, deviceName = defaultDeviceName()): Promise<{ identity: Identity; ratchet: c.Ratchet }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(data.gw);
    let fin: ReturnType<typeof c.deviceFinish> | null = null;
    let keys: c.DeviceKeys | null = null;
    let proved = false;
    const nonce = c.b64e(c.randomBytes(32));
    const fail = (msg: string) => {
      ws.close();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail("The computer didn't answer. Is Aha! running there?"), 30_000);
    ws.onerror = () => fail("Couldn't reach the gateway.");
    ws.onmessage = (ev) => {
      let f: any;
      try {
        f = JSON.parse(ev.data as string);
      } catch {
        return fail("The gateway sent something unexpected.");
      }
      try {
        if (f.t === "hello") {
          if (f.gateway !== data.pin) return fail("The gateway's key doesn't match the pairing link.");
          ws.send(JSON.stringify({ t: "pair_hello", code: data.code, nonce }));
        } else if (f.t === "ready") {
          if (!gatewayProved(data.pin, nonce, f.sig)) return fail("The gateway couldn't prove it holds the key in the pairing link.");
          proved = true;
        } else if (f.t === "notice") {
          return fail(f.code === "pair_unknown" ? "This pairing link has expired or was already used. Run `aha pair` again." : "Pairing was refused.");
        } else if (f.t === "pair" && !proved) {
          return fail("The gateway didn't prove its key before pairing.");
        } else if (f.t === "pair" && f.body?.t === "bundle") {
          keys = c.generateDeviceKeys();
          fin = c.deviceFinish(f.body, c.b64urlDecode(data.fp), c.b64urlDecode(data.psk), keys);
          ws.send(JSON.stringify({ t: "pair", body: { t: "finish", ...fin.message } }));
        } else if (f.t === "pair" && f.body?.t === "ok" && fin && keys) {
          c.deviceCheckComputer(fin.pk, c.b64d(f.body.mac, 32));
          const cert = JSON.parse(f.body.cert) as Cert;
          if (cert.device !== c.b64e(keys.sigPub) || !certValid(cert, data.pin)) return fail("The certificate doesn't check out.");
          const ratchet = c.Ratchet.initDevice(fin.pk.sk, c.sessionAd(keys.ikPub, fin.ikc), fin.ekc, keys.kemSeed, fin.kemc);
          const identity: Identity = {
            v: 1,
            gw: data.gw,
            pin: data.pin,
            home: data.home,
            name: data.name,
            deviceName,
            keys: {
              ikPriv: c.b64e(keys.ikPriv), ikPub: c.b64e(keys.ikPub), kemSeed: c.b64e(keys.kemSeed),
              kemPub: c.b64e(keys.kemPub), sigPriv: c.b64e(keys.sigPriv), sigPub: c.b64e(keys.sigPub),
            },
            pushKey: c.b64e(fin.pk.pushKey),
            cert,
            fp: data.fp,
          };
          clearTimeout(timer);
          ws.close();
          resolve({ identity, ratchet });
        } else if (f.t === "pair" && f.body?.t === "error") {
          return fail("The computer refused the pairing (wrong or tampered link).");
        }
      } catch (e) {
        fail(e instanceof c.CryptoError ? "The pairing didn't verify: the link may be wrong, or someone tampered with it." : String(e));
      }
    };
  });
}

export interface Events {
  item(it: Item, live: boolean): void;
  typing(on: boolean): void;
  status(s: { connected: boolean; computer: boolean }): void;
  history(items: Item[]): void;
  memories(items: { id: string; text: string }[]): void;
  devices(items: { id: string; name: string; created: number; last_seen: number; this: boolean }[]): void;
  error(code: string): void;
  revoked(): void;
  report(msg: { t: "report_draft" | "report_sent"; id: string; text?: string; ok?: boolean; code?: string }): void;
}

/** The authenticated connection and the end-to-end session with the computer. */
export class Client {
  ws: WebSocket | null = null;
  connected = false;
  computer = false;
  vapid = "";
  last = 0;
  private retry = 1000;
  private stopped = false;
  private helloSent = false;
  private nonce = "";

  constructor(
    private store: Store,
    public identity: Identity,
    private ratchet: c.Ratchet,
    public settings: Settings,
    private on: Events,
  ) {}

  get dev(): string {
    return this.identity.keys.sigPub;
  }

  async start(): Promise<void> {
    this.last = (await this.store.get<number>("last")) ?? 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.identity.gw);
    this.ws = ws;
    ws.onopen = () => (this.retry = 1000);
    ws.onclose = (ev) => {
      this.connected = this.computer = false;
      this.helloSent = false;
      this.on.status({ connected: false, computer: false });
      if (ev.code === 4403) return this.on.revoked();
      if (ev.code === 4409) return this.on.error("other_tab");
      if (!this.stopped) setTimeout(() => this.connect(), this.retry * (0.8 + Math.random() * 0.4));
      this.retry = Math.min(this.retry * 2, 60_000);
    };
    ws.onmessage = (ev) => void this.frame(ev.data as string);
  }

  private async frame(raw: string): Promise<void> {
    let f: any;
    try {
      f = JSON.parse(raw);
    } catch {
      return;
    }
    switch (f.t) {
      case "hello": {
        if (f.gateway !== this.identity.pin) {
          this.stopped = true;
          this.ws?.close();
          return this.on.error("pin");
        }
        this.vapid = f.vapid || "";
        this.nonce = c.b64e(c.randomBytes(32));
        const sig = c.sign(c.b64d(this.identity.keys.sigPriv, 32), enc.encode(`aha-device-v1|${f.nonce}|${this.dev}`));
        this.ws?.send(JSON.stringify({ t: "dev_auth", cert: this.identity.cert, sig: c.b64e(sig), nonce: this.nonce }));
        break;
      }
      case "ready":
        if (!gatewayProved(this.identity.pin, this.nonce, f.sig)) {
          // Something answers for the gateway's name without its key: don't talk to it (SPEC §6.3).
          this.stopped = true;
          this.ws?.close();
          return this.on.error("pin");
        }
        this.connected = true;
        await this.setComputer(!!f.online);
        break;
      case "computer":
        await this.setComputer(!!f.online);
        break;
      case "e2e":
        await this.receive(f.box);
        break;
      case "ping":
        this.ws?.send(JSON.stringify({ t: "pong" }));
        break;
    }
  }

  private async setComputer(online: boolean): Promise<void> {
    this.computer = online;
    this.on.status({ connected: this.connected, computer: online });
    if (!online) return;
    if (!this.helloSent) {
      this.helloSent = true;
      await this.send({ t: "hello", name: this.identity.deviceName, version: APP_VERSION, ...(await this.pushField()) });
    }
    await this.send({ t: "sync_request", after: this.last, ...(this.last === 0 ? { days: this.settings.keepDays } : {}) });
    for (const m of await this.store.outbox()) await this.send({ t: "say", text: m.text, cid: m.cid });
  }

  private async pushField(): Promise<{ push?: unknown }> {
    if (!this.settings.notifications || !("serviceWorker" in navigator)) return {};
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? { push: sub.toJSON() } : {};
  }

  /** Encrypt and send one message; the ratchet is saved before the box leaves (SPEC §6.8). */
  async send(message: object): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.connected) return false;
    const box = c.encryptJson(this.ratchet, message);
    await this.store.put("ratchet", this.ratchet.toJSON());
    this.ws.send(JSON.stringify({ t: "e2e", box }));
    return true;
  }

  private async receive(box: string): Promise<void> {
    let msg: { t: string; [k: string]: any };
    try {
      msg = c.decryptJson(this.ratchet, box);
    } catch {
      return; // not from our computer, or tampered: drop it
    }
    await this.store.put("ratchet", this.ratchet.toJSON());
    switch (msg.t) {
      case "msg":
      case "approval":
      case "approval_state":
        await this.accept([msg as unknown as Item], true);
        break;
      case "typing":
        this.on.typing(!!msg.on);
        break;
      case "sync":
        await this.accept((msg.items ?? []) as Item[], false);
        break;
      case "history":
        this.on.history((msg.items ?? []) as Item[]);
        break;
      case "memories":
        this.on.memories(msg.items ?? []);
        break;
      case "devices":
        this.on.devices(msg.items ?? []);
        break;
      case "cert":
        if (msg.cert && certValid(msg.cert, this.identity.pin) && msg.cert.device === this.dev) {
          this.identity = { ...this.identity, cert: msg.cert };
          await this.store.put("identity", this.identity);
        }
        break;
      case "report_draft":
      case "report_sent":
        this.on.report(msg as never);
        break;
      case "error":
        this.on.error(String(msg.code));
        break;
    }
  }

  private async accept(items: Item[], live: boolean): Promise<void> {
    const fresh = items.filter((it) => typeof it.seq === "number" && it.seq > 0);
    if (this.settings.keepDays > 0) await this.store.putItems(fresh);
    for (const it of fresh) {
      if (it.t === "msg" && it.role === "me" && typeof it.cid === "string") await this.store.unqueue(it.cid);
      if (it.seq > this.last) this.last = it.seq;
      this.on.item(it, live);
    }
    await this.store.put("last", this.last);
  }

  async say(text: string): Promise<string> {
    const cid = c.b64e(c.randomBytes(9)).replace(/[+/=]/g, "x");
    await this.store.queue({ cid, text, ts: Math.floor(Date.now() / 1000) });
    if (this.computer) await this.send({ t: "say", text, cid });
    return cid;
  }
}
