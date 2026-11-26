// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// The receipt under an answer (SPEC §7.4 "Receipt"): what the request changed, one line per action, as the
// computer recorded it from the tool calls (a message typed on a site, a fact saved, a task started or
// cancelled). It's Aha!'s own record, not the model's words: it's drawn apart from them, never as a reply, so an
// action the model doesn't mention still shows.
import { ICONS, h, icon } from "./dom";

const MAX_LINES = 40;
const MAX_LINE = 300;

/** The computer's `record` lines, kept only when well formed. */
export function receiptLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    .slice(0, MAX_LINES)
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE - 1)}…` : l));
}

export function receipt(lines: string[]): HTMLElement {
  return h(
    "aside",
    { class: "receipt", "aria-label": "What Aha! did" },
    h("header", {}, icon(ICONS.check), "What Aha! did"),
    h("ul", {}, ...lines.map((l) => h("li", {}, l))),
  );
}
