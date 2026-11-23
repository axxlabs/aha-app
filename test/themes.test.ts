// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, themeById } from "../src/themes";

describe("colour themes (SPEC §7.4)", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  it("has six named themes, Blaze Rod first", () => {
    expect(THEMES.map((t) => t.name)).toEqual(["Blaze Rod", "Prismarine", "Amethyst", "Red Sandstone", "Moss", "Lapis"]);
    expect(DEFAULT_THEME).toBe("saffron-hour");
  });
  it("every theme but the default has a light and a dark palette in the CSS", () => {
    for (const t of THEMES.slice(1)) expect(css.split(`:root[data-theme="${t.id}"]`).length - 1).toBe(2);
  });
  it("Dark and Light can be forced for every colour, whatever the system says", () => {
    expect(css).toContain(':root[data-mode="dark"] {');
    expect(css).toContain(':root:not([data-mode="light"]) {');
    for (const t of THEMES.slice(1)) {
      expect(css).toContain(`:root[data-mode="dark"][data-theme="${t.id}"]`);
      expect(css).toContain(`:root[data-theme="${t.id}"]:not([data-mode="light"])`);
    }
  });
  it("unknown ids fall back to the default", () => {
    expect(themeById("nope").id).toBe(DEFAULT_THEME);
  });
});
