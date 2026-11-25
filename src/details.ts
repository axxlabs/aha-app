// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// A message's ⋯ → Details (SPEC §3.8): what the model wrote, thought and called, with times.
import { type Client, type TraceEvent, traceTime } from "./client";
import { ICONS, h, icon } from "./dom";

const CHECKS: Record<string, string> = {
  numbers: "a number it couldn't find on a page",
  site: "it said it did something on a site without doing it",
  blank: "it gave up on a new, blank browser window",
};

function seconds(ms: unknown): string {
  return typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : "";
}

function block(label: string, text: unknown, open = true): HTMLElement | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const d = h("details", {}, h("summary", {}, label), h("pre", { class: "report-draft" }, text));
  d.open = open;
  return d;
}

/** One record, drawn: its time and what it was, then what it said. */
function traceRow(e: TraceEvent): HTMLElement {
  const at = traceTime(e.ts);
  const time = Number.isNaN(at) ? e.ts : new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts: (HTMLElement | null)[] = [];
  let title = e.kind;
  let meta = "";
  if (e.kind === "model") {
    title = `Model · ${String(e.model ?? "")}`;
    const t = (e.timings ?? {}) as Record<string, number>;
    meta = [
      seconds(e.ms),
      `${Number(e.prompt_tokens ?? 0).toLocaleString()} prompt tokens (${Number(e.cached_tokens ?? 0).toLocaleString()} cached)`,
      t.prompt_ms !== undefined ? `read ${Number(t.prompt_n ?? 0).toLocaleString()} in ${seconds(t.prompt_ms)}` : "",
      t.predicted_ms !== undefined ? `wrote ${Number(t.predicted_n ?? 0).toLocaleString()} in ${seconds(t.predicted_ms)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    parts.push(block("Thinking", e.reasoning, false), block("Wrote", e.text));
    for (const c of Array.isArray(e.calls) ? (e.calls as { name?: string; args?: string }[]) : []) parts.push(block(`Called ${String(c.name ?? "")}`, c.args || "{}"));
  } else if (e.kind === "tool") {
    title = `Tool · ${String(e.name ?? "")}${e.error ? " · error" : ""}`;
    parts.push(block("Arguments", e.args, false), block("Result", e.result, false));
  } else if (e.kind === "check") {
    title = "Check";
    meta = `Sent the draft back: ${CHECKS[String(e.name)] ?? String(e.name)}`;
  } else if (e.kind === "user") {
    title = "You said";
    parts.push(block("Message", e.text));
  } else if (e.kind === "item") {
    title = e.t === "approval" ? "Card shown" : "Sent to the chat";
    parts.push(block("Text", e.text, false));
  } else if (e.kind === "answer") {
    title = "Task finished";
  } else if (e.kind === "stopped") {
    title = "Stopped";
  }
  return h(
    "div",
    { class: "trace-row" },
    h("div", { class: "trace-head" }, h("time", {}, time), h("b", {}, title)),
    ...(meta ? [h("small", {}, meta)] : []),
    ...parts.filter((p): p is HTMLElement => p !== null),
  );
}

/** ⋯ → Show details: everything the model wrote and called for this message, with times. */
export function openDetails(client: Client, seq: number, onClose: () => void) {
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon(ICONS.close));
  const copy = h("button", { class: "btn", type: "button", hidden: "" }, "Copy all");
  const body = h("div", { class: "trace" }, h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline: details need it online."));
  const dialog = h(
    "dialog",
    { class: "sheet", "aria-label": "Message details" },
    h("div", { class: "sheet-in" }, h("header", {}, h("h2", {}, "Details"), close), h("p", { class: "fine" }, "What the model wrote, thought and called for this message, from your computer."), body, copy),
  ) as HTMLDialogElement;
  document.body.append(dialog);
  dialog.showModal();
  const shut = () => {
    dialog.close();
    dialog.remove();
    onClose();
  };
  close.onclick = shut;
  dialog.addEventListener("cancel", shut);
  void client.send({ t: "trace_request", seq });
  return {
    seq,
    show(events: TraceEvent[]) {
      if (!events.length) {
        body.replaceChildren(h("p", { class: "fine" }, "No details were kept for this message. Messages from before this version, and ones not from a task, have none."));
        return;
      }
      body.replaceChildren(...events.map(traceRow));
      copy.hidden = false;
      copy.onclick = async () => {
        await navigator.clipboard.writeText(JSON.stringify(events, null, 1));
        copy.textContent = "Copied";
      };
    },
  };
}

// ---- settings
