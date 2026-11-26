// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Live diagnostics in the header (SPEC §7.4 "Live diagnostics"): the computer's CPU, memory and GPU, every few
// seconds while the app is open. Each part only when the computer could read it.
import type { Stats } from "./client";
import { h } from "./dom";

const gb = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

/** The panel's lines: "CPU 23% · 54°C · RAM 31/126 GB", "GPU 60% · 55°C · 14.1/15.9 GB". */
export function statsLines(s: Stats): string[] {
  const cpu = [s.cpu?.load !== undefined ? `${s.cpu.load}%` : "", s.cpu?.temp !== undefined ? `${s.cpu.temp}°C` : ""].filter(Boolean);
  const first = [cpu.length ? `CPU ${cpu.join(" · ")}` : "", s.mem ? `RAM ${gb(s.mem.used)}/${gb(s.mem.total)} GB` : ""].filter(Boolean).join(" · ");
  const second = s.gpu ? `GPU ${s.gpu.load}% · ${s.gpu.temp}°C · ${gb(s.gpu.mem)}/${gb(s.gpu.mem_total)} GB` : "";
  return [first, second].filter(Boolean);
}

/** The panel: hidden until the first reading, and again when the computer goes offline. */
export function statsPanel() {
  const el = h("div", { class: "stats", hidden: "", "aria-label": "Your computer's load and temperatures", role: "status" });
  return {
    el,
    show(s: Stats): void {
      const lines = statsLines(s);
      el.replaceChildren(...lines.map((l) => h("span", {}, l)));
      el.hidden = !lines.length;
    },
    hide(): void {
      el.hidden = true;
    },
  };
}
