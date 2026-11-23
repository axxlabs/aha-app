// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, HISTORY_CHOICES, browserSites, cacheDays, gatewayProved, modelChoices, traceEvents, traceTime, parsePairLink, shortFingerprint } from "../src/client";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as c from "../src/crypto";

const b64url = (b: Uint8Array) => c.b64e(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const link = (gw: string) =>
  "#pair=" + b64url(new TextEncoder().encode(JSON.stringify({ v: 1, gw, pin: "x", fp: "AAAA", code: "ABC-DEF", psk: "p", name: "N", home: "H" })));

describe("pairing links (SPEC §6.4)", () => {
  it("need wss, except for a gateway on this machine", () => {
    expect(parsePairLink(link("wss://gateway.example/v1/device")).gw).toContain("wss://");
    expect(parsePairLink(link("ws://127.0.0.1:8700/v1/device")).gw).toContain("127.0.0.1");
    expect(() => parsePairLink(link("ws://gateway.example/v1/device"))).toThrow(/secure/);
  });
  it("short fingerprints match the computer's (`aha status`)", () => {
    const fp = b64url(Uint8Array.from({ length: 32 }, (_, i) => i));
    expect(shortFingerprint(fp)).toBe("AAAQ EAYE AUDA OCAJ"); // same value as the Python test
  });
});

describe("Settings → Your browser (SPEC §3.4, §7.4)", () => {
  it("shows only well-formed sites from the computer", () => {
    expect(browserSites([{ site: "waitrose.com", signed_in: true, trusted: true }, { site: "news.example", signed_in: "yes" }, { site: 5 }, null, "x"])).toEqual([
      { site: "waitrose.com", signed_in: true, trusted: true },
      { site: "news.example", signed_in: false, trusted: false },
    ]);
    expect(browserSites(undefined)).toEqual([]);
  });
});

describe("Settings → Model (SPEC §3.2)", () => {
  it("shows only well-formed models from the computer", () => {
    expect(
      modelChoices({ current: "qwen3.5-9b", choices: [{ id: "qwen3.5-9b", name: "Qwen3.5 9B", note: "Faster", ready: true }, { id: "x", name: 5 }, null, { id: "y", name: "Y", ready: "yes" }] }),
    ).toEqual({ current: "qwen3.5-9b", choices: [{ id: "qwen3.5-9b", name: "Qwen3.5 9B", note: "Faster", ready: true }, { id: "y", name: "Y", note: "", ready: false }] });
    expect(modelChoices(undefined)).toEqual({ current: "", choices: [] });
  });
});

describe("a message's details (SPEC §3.8)", () => {
  it("keeps well-formed records and reads the transcript's times", () => {
    expect(traceEvents([{ ts: "2026-11-23T08:41:02+0000", kind: "model", ms: 900 }, { kind: "tool" }, null, "x"])).toEqual([{ ts: "2026-11-23T08:41:02+0000", kind: "model", ms: 900 }]);
    expect(traceEvents(undefined)).toEqual([]);
    expect(traceTime("2026-11-23T08:41:02+0000")).toBe(Date.UTC(2026, 10, 23, 8, 41, 2));
    expect(traceTime("2026-11-23T08:41:02-0130")).toBe(Date.UTC(2026, 10, 23, 10, 11, 2));
  });
});

describe("the gateway's proof (SPEC §6.3)", () => {
  it("accepts only a signature by the pinned key over our nonce", () => {
    const priv = c.randomBytes(32);
    const pin = c.b64e(ed25519.getPublicKey(priv));
    const nonce = c.b64e(c.randomBytes(32));
    const sig = c.b64e(c.sign(priv, new TextEncoder().encode("aha-gateway-v1|" + nonce)));
    expect(gatewayProved(pin, nonce, sig)).toBe(true);
    expect(gatewayProved(pin, c.b64e(c.randomBytes(32)), sig)).toBe(false);
    expect(gatewayProved(pin, nonce, undefined)).toBe(false);
    const other = c.b64e(ed25519.getPublicKey(c.randomBytes(32)));
    expect(gatewayProved(other, nonce, sig)).toBe(false);
  });
});

describe("history (SPEC §3.8.1, §7.5)", () => {
  it("keeps 5 days on the device, or 1 when the person keeps a day", () => {
    expect(cacheDays({ ...DEFAULT_SETTINGS })).toBe(5);
    expect(cacheDays({ ...DEFAULT_SETTINGS, historyDays: null })).toBe(5);
    expect(cacheDays({ ...DEFAULT_SETTINGS, historyDays: 7 })).toBe(5);
    expect(cacheDays({ ...DEFAULT_SETTINGS, historyDays: 1 })).toBe(1);
  });
  it("offers exactly the lengths the computer accepts", () => {
    expect(HISTORY_CHOICES.map(([d]) => d)).toEqual([null, 365, 90, 30, 7, 1]);
  });
});
