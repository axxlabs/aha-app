// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// Storage on the device (SPEC §7.5): IndexedDB, for this origin only. Everything sensitive (keys, ratchet
// state, the message cache, the outbox) is encrypted at rest with a non-extractable AES-256-GCM key that
// never leaves the browser's key store. The device is a cache, never the record: the computer keeps the
// transcript.

const DB_NAME = "aha";
const DB_VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** A message waiting to be sent: its text and, optionally, a photo (SPEC §6.5). Encrypted like the rest. */
export interface Photo {
  mime: string;
  b64: string;
}
export interface Queued {
  cid: string;
  text: string;
  ts: number;
  image?: Photo;
}

export interface Item {
  seq: number;
  ts: number;
  t: string;
  [k: string]: unknown;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class Store {
  private constructor(
    private db: IDBDatabase,
    private key: CryptoKey,
  ) {}

  static async open(): Promise<Store> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("keys"); // the storage key (a non-extractable CryptoKey)
        d.createObjectStore("meta"); // encrypted records by name
        d.createObjectStore("items"); // encrypted cache items by seq
        d.createObjectStore("outbox"); // encrypted unsent messages by cid
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    let key = (await request(db.transaction("keys").objectStore("keys").get("storage"))) as CryptoKey | undefined;
    if (!key) {
      key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(key, "storage");
      await done(tx);
    }
    return new Store(db, key);
  }

  private async seal(value: unknown): Promise<ArrayBuffer> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, enc.encode(JSON.stringify(value)));
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    return out.buffer;
  }

  private async open<T>(data: ArrayBuffer | undefined): Promise<T | undefined> {
    if (!data) return undefined;
    const bytes = new Uint8Array(data);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, this.key, bytes.slice(12));
    return JSON.parse(dec.decode(pt)) as T;
  }

  async get<T>(name: string): Promise<T | undefined> {
    return this.open<T>(await request(this.db.transaction("meta").objectStore("meta").get(name)));
  }

  async put(name: string, value: unknown): Promise<void> {
    const sealed = await this.seal(value);
    const tx = this.db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(sealed, name);
    await done(tx);
  }

  async putItems(items: Item[]): Promise<void> {
    const sealed = await Promise.all(items.map((i) => this.seal(i)));
    const tx = this.db.transaction("items", "readwrite");
    items.forEach((it, i) => tx.objectStore("items").put(sealed[i], it.seq));
    await done(tx);
  }

  async items(): Promise<Item[]> {
    const all = (await request(this.db.transaction("items").objectStore("items").getAll())) as ArrayBuffer[];
    const out = await Promise.all(all.map((d) => this.open<Item>(d)));
    return (out.filter(Boolean) as Item[]).sort((a, b) => a.seq - b.seq);
  }

  /** Delete cached items older than `cutoff` (unix seconds); keep pending approvals whatever their age. */
  async prune(cutoff: number, keep: (it: Item) => boolean = () => false): Promise<void> {
    const items = await this.items();
    const tx = this.db.transaction("items", "readwrite");
    for (const it of items) if (it.ts < cutoff && !keep(it)) tx.objectStore("items").delete(it.seq);
    await done(tx);
  }

  async outbox(): Promise<Queued[]> {
    const all = (await request(this.db.transaction("outbox").objectStore("outbox").getAll())) as ArrayBuffer[];
    const out = await Promise.all(all.map((d) => this.open<Queued>(d)));
    return (out.filter(Boolean) as Queued[]).sort((a, b) => a.ts - b.ts);
  }

  async queue(entry: Queued): Promise<void> {
    const sealed = await this.seal(entry);
    const tx = this.db.transaction("outbox", "readwrite");
    tx.objectStore("outbox").put(sealed, entry.cid);
    await done(tx);
  }

  async unqueue(cid: string): Promise<void> {
    const tx = this.db.transaction("outbox", "readwrite");
    tx.objectStore("outbox").delete(cid);
    await done(tx);
  }

  async clearItems(): Promise<void> {
    const tx = this.db.transaction("items", "readwrite");
    tx.objectStore("items").clear();
    await done(tx);
  }

  /** Unpair: delete everything, including the storage key. */
  async wipe(): Promise<void> {
    this.db.close();
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }
}
