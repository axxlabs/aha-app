// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the app server's headers (SPEC §7.4)", () => {
  const caddy = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
  it("sends a CSP at least as strict as the page's own, plus frame-ancestors", () => {
    for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"])
      expect(caddy).toContain(d);
    expect(caddy).not.toMatch(/unsafe-(inline|eval)/);
  });
  it("sends HSTS, nosniff and no referrer, and never caches the entry points", () => {
    for (const h of ["Strict-Transport-Security", 'X-Content-Type-Options "nosniff"', 'Referrer-Policy "no-referrer"', "/sw.js"]) expect(caddy).toContain(h);
  });
});

describe("the app server's images (SPEC §9.2)", () => {
  it("pins every image by digest", () => {
    const compose = readFileSync(new URL("../deploy/compose.yaml", import.meta.url), "utf8");
    const update = readFileSync(new URL("../deploy/update.sh", import.meta.url), "utf8");
    const refs = [...compose.matchAll(/^\s+image: (\S+)/gm), ...update.matchAll(/^NODE_IMAGE="([^"]+)"/gm)].map((m) => m[1]);
    expect(refs.length).toBe(2);
    for (const r of refs) expect(r).toMatch(/@sha256:[0-9a-f]{64}$/);
  });
});
