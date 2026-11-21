// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// Colour themes (SPEC §7.4). Each is one choice for the person; the full palette for it is fixed in style.css.

export interface Theme {
  id: string;
  name: string;
  swatch: string;
  light: string; // background, for the browser's theme-color
  dark: string;
}

export const THEMES: Theme[] = [
  { id: "saffron-hour", name: "Saffron Hour", swatch: "#E8A33D", light: "#FAF8F4", dark: "#151412" },
  { id: "sea-glass", name: "Sea Glass", swatch: "#2A9D8F", light: "#F4F8F7", dark: "#111615" },
  { id: "lavender-haze", name: "Lavender Haze", swatch: "#7C68D9", light: "#F8F6FB", dark: "#141218" },
  { id: "terracotta-sun", name: "Terracotta Sun", swatch: "#C95F33", light: "#FBF6F3", dark: "#171211" },
  { id: "fern-hollow", name: "Fern Hollow", swatch: "#4F8A3E", light: "#F6F8F3", dark: "#121510" },
  { id: "midnight-ink", name: "Midnight Ink", swatch: "#3563C9", light: "#F5F7FB", dark: "#101318" },
];

export const DEFAULT_THEME = THEMES[0].id;

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export type Appearance = "auto" | "light" | "dark";
export const APPEARANCES: { id: Appearance; name: string }[] = [
  { id: "auto", name: "Auto" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

/** Apply a colour and an appearance: the CSS palette by attributes, and the browser's own bar colour. */
export function applyTheme(id: string | undefined, mode: Appearance | undefined = "auto"): void {
  const theme = themeById(id);
  const root = document.documentElement;
  if (theme.id === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = theme.id;
  if (mode === "light" || mode === "dark") root.dataset.mode = mode;
  else delete root.dataset.mode;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const dark = mode === "dark" || (mode !== "light" && meta.media.includes("dark"));
    meta.content = dark ? theme.dark : theme.light;
  }
}
