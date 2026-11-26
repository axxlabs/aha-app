// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Each request's Details line (SPEC §7.4 "Details"): what the model wrote, thought and called, live, with times.
import { type Client, type TraceEvent, traceTime } from "./client";
import { h } from "./dom";

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

const STEP_KINDS = new Set(["model", "tool", "check"]);
const same = (a: TraceEvent, b: TraceEvent) => a.ts === b.ts && a.kind === b.kind && a.name === b.name && a.text === b.text;

/** What a Details line says while closed: the tools it used, in the person's words, and how many steps. */
export function stepsSummary(events: TraceEvent[]): string {
  const labels: string[] = [];
  for (const e of events) {
    const names = e.kind === "tool" ? [e.label] : e.kind === "model" && Array.isArray(e.calls) ? (e.calls as { label?: unknown }[]).map((c) => c.label) : [];
    for (const l of names) if (typeof l === "string" && l && !labels.includes(l)) labels.push(l);
  }
  const n = events.filter((e) => STEP_KINDS.has(e.kind)).length;
  return [labels.join(", "), n ? `${n} step${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}

/** Each request's Details line (SPEC §7.4 "Details"): one small expandable line where its work starts. Closed,
 * it says what the model is doing; open, its records, live as they happen. Opened, the line asks the computer
 * for the whole record so far (a reload or another device saw only part of it live), then adds what comes. */
export function detailsLines(client: Client) {
  const live = new Map<string, TraceEvent[]>(); // by task: the records that came live on this device
  const lines = new Map<string, { add(e: TraceEvent): void; idle(): void }>(); // drawn lines, by task
  const asked = new Map<number, (events: TraceEvent[]) => void>(); // trace requests, by the line's seq
  let working = ""; // the task whose records are coming now

  return {
    /** A record as it happens. */
    step(task: string, e: TraceEvent): void {
      const list = live.get(task) ?? [];
      list.push(e);
      live.set(task, list);
      const was = working;
      working = task;
      if (was && was !== task) lines.get(was)?.idle();
      lines.get(task)?.add(e);
    },
    /** Aha! stopped working: no line is live any more. */
    idle(): void {
      const was = working;
      working = "";
      if (was) lines.get(was)?.idle();
    },
    trace(seq: number, events: TraceEvent[]): void {
      asked.get(seq)?.(events);
      asked.delete(seq);
    },
    line(seq: number, task: string): HTMLElement {
      let events: TraceEvent[] = [...(live.get(task) ?? [])];
      const summary = h("span", { class: "steps-sum" });
      const toggle = h("button", { type: "button", class: "steps-toggle", "aria-expanded": "false" }, h("span", { class: "chev", "aria-hidden": "true" }, "›"), h("b", {}, "Details"), summary);
      const body = h("div", { class: "steps-body trace", hidden: "" });
      const el = h("div", { class: "steps" }, toggle, body);
      const draw = () => {
        summary.textContent = stepsSummary(events);
        el.classList.toggle("live", working === task);
      };
      const open = () => !body.hidden;
      const shown = (list: TraceEvent[]) => body.replaceChildren(...(list.length ? list.map(traceRow) : [h("p", { class: "fine" }, "No details were kept for this request.")]));
      toggle.onclick = () => {
        body.hidden = open();
        toggle.setAttribute("aria-expanded", String(open()));
        if (!open()) return;
        shown(events);
        if (!client.computer) return;
        asked.set(seq, (whole) => {
          // The computer's record so far, then what came live since that it didn't have yet.
          const later = events.filter((e) => !whole.some((w) => same(w, e)));
          events = [...whole, ...later];
          draw();
          if (open()) shown(events);
        });
        void client.send({ t: "trace_request", seq });
      };
      lines.set(task, {
        add(e) {
          if (!events.some((x) => same(x, e))) events.push(e);
          draw();
          if (open()) body.append(traceRow(e));
        },
        idle: draw,
      });
      draw();
      return el;
    },
  };
}

// ---- settings
