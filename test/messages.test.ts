// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// The messages between the app and the computer (SPEC §6.5), checked against the file both repos share.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(readFileSync(new URL("./vectors/device_messages.json", import.meta.url), "utf8"));
const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

describe("device messages", () => {
  it("sends only messages the computer handles", () => {
    const sent = new Set<string>();
    for (const file of readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts"))) {
      for (const m of src(file).matchAll(/\bsend\(\{ t: "([a-z_]+)"/g)) sent.add(m[1]);
    }
    expect(sent.size).toBeGreaterThan(10);
    for (const t of sent) expect(Object.keys(schema.device), t).toContain(t);
  });

  it("handles only messages the computer sends", () => {
    const client = src("client.ts");
    const start = client.indexOf("switch (msg.t) {");
    const block = client.slice(start, client.indexOf("\n    }\n", start));
    const handled = [...block.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
    expect(handled.length).toBeGreaterThan(10);
    for (const t of handled) expect(Object.keys(schema.computer), t).toContain(t);
  });
});
