// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, themeById } from "../src/themes";

describe("colour themes (SPEC §7.4)", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  it("has six named themes, Saffron Hour first", () => {
    expect(THEMES.map((t) => t.name)).toEqual(["Saffron Hour", "Sea Glass", "Lavender Haze", "Terracotta Sun", "Fern Hollow", "Midnight Ink"]);
    expect(DEFAULT_THEME).toBe("saffron-hour");
  });
  it("every theme but the default has a light and a dark palette in the CSS", () => {
    for (const t of THEMES.slice(1)) expect(css.split(`:root[data-theme="${t.id}"]`).length - 1).toBe(2);
  });
  it("unknown ids fall back to the default", () => {
    expect(themeById("nope").id).toBe(DEFAULT_THEME);
  });
});
