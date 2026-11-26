// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Live diagnostics in the header (SPEC §7.4 "Live diagnostics"): the computer's CPU, memory and GPU, every few
// seconds while the app is open. Small: one chip each, a load bar and the temperature, coloured by how high they
// are; the numbers in full on hover. Each part only when the computer could read it.
import type { Stats } from "./client";
import { h } from "./dom";

export type Level = "ok" | "warn" | "hot";
export const loadLevel = (pct: number): Level => (pct >= 85 ? "hot" : pct >= 60 ? "warn" : "ok");
export const tempLevel = (c: number): Level => (c >= 85 ? "hot" : c >= 70 ? "warn" : "ok");

const gb = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

export interface Chip {
  label: string; // CPU | RAM | GPU
  load?: number; // percent, the bar
  temp?: number; // °C
  title: string; // the numbers in full, on hover
}

/** One chip per part the computer could read. */
export function statsChips(s: Stats): Chip[] {
  const out: Chip[] = [];
  if (s.cpu) {
    const title = [s.cpu.load !== undefined ? `CPU ${s.cpu.load}%` : "CPU", s.cpu.temp !== undefined ? `${s.cpu.temp}°C` : ""].filter(Boolean).join(" · ");
    out.push({ label: "CPU", ...(s.cpu.load !== undefined ? { load: s.cpu.load } : {}), ...(s.cpu.temp !== undefined ? { temp: s.cpu.temp } : {}), title });
  }
  if (s.mem) out.push({ label: "RAM", load: Math.round((100 * s.mem.used) / s.mem.total), title: `RAM ${gb(s.mem.used)} of ${gb(s.mem.total)} GB` });
  if (s.gpu) out.push({ label: "GPU", load: s.gpu.load, temp: s.gpu.temp, title: `GPU ${s.gpu.load}% · ${s.gpu.temp}°C · VRAM ${gb(s.gpu.mem)} of ${gb(s.gpu.mem_total)} GB` });
  return out;
}

function chip(c: Chip): HTMLElement {
  // Stacked in a grid (the chip itself is `display: contents`), so each row has its three cells, empty or not, and
  // each cell carries the hover text.
  const tip = { title: c.title };
  const bar = c.load !== undefined ? h("span", { class: `bar ${loadLevel(c.load)}`, "aria-hidden": "true", ...tip }, h("i", { style: `width:${Math.max(0, Math.min(100, c.load))}%` })) : h("span", tip);
  const temp = c.temp !== undefined ? h("span", { class: `temp ${tempLevel(c.temp)}`, ...tip }, `${c.temp}°`) : h("span", { class: "temp", ...tip });
  return h("span", { class: "chip", "aria-label": c.title }, h("b", tip, c.label), bar, temp);
}

/** The panel: hidden until the first reading, and again when the computer goes offline. */
export function statsPanel() {
  const el = h("div", { class: "stats", hidden: "", role: "status", "aria-label": "Your computer's load and temperatures" });
  return {
    el,
    show(s: Stats): void {
      const chips = statsChips(s);
      el.replaceChildren(...chips.map(chip));
      el.hidden = !chips.length;
    },
    hide(): void {
      el.hidden = true;
    },
  };
}
