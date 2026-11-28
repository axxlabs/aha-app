// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// A topic that checks on its own (SPEC §4.1 "No Tasks pane"): under its title, a strip with when it wakes next,
// how often and until what, and Run now, Edit and Stop; the person's own actions, so no card.
import type { Client } from "./client";
import { h } from "./dom";
import type { Schedule } from "./fold";
import { formatDate } from "./markdown";

/** "Every 30 min", "Every 4 hours", "Every day", "Every day at 08:00". */
export function everyWords(s: Pick<Schedule, "every" | "at">): string {
  if (s.at?.length) return `Every day at ${s.at.join(" and ")}`;
  const m = Math.round(s.every / 60);
  if (m % 1440 === 0) return m === 1440 ? "Every day" : `Every ${m / 1440} days`;
  if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
  return `Every ${m} min`;
}

/** An epoch time as a datetime-local input's value, in this device's time. */
export function toLocalInput(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local input's value as epoch seconds, or null when empty or not a time. */
export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : Math.round(t / 1000);
}

/** The strip's first line: when it wakes next. */
export function nextWords(s: Pick<Schedule, "next" | "paused">, now: number, when: (epoch: number) => string): string {
  if (s.paused) return "Paused until you answer";
  return s.next <= now ? "Next check when sha is idle" : `Next check ${when(s.next)}`;
}

/** The idle line (SPEC §3.4): checks wait for a quiet household. */
export const IDLE_LINE = "Checks run after 5 minutes with no one using sha.";

export function scheduleStrip(client: Client, n: number, s: Schedule, dates: () => Parameters<typeof formatDate>[1]): HTMLElement {
  const when = (epoch: number) => {
    const d = new Date(epoch * 1000);
    const clock = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return new Date().toDateString() === d.toDateString() ? clock : `${formatDate(d, dates())} ${clock}`;
  };
  const ends = s.done_when === "never" ? "until you stop it" : `until ${s.done_when}`;
  const line = h("p", { class: "strip-line" }, h("b", {}, nextWords(s, Date.now() / 1000, when)), ` · ${everyWords(s)}, ${ends}`);
  const run = h("button", { class: "run", type: "button" }, "Run now");
  const edit = h("button", { class: "run", type: "button" }, "Edit");
  const stop = h("button", { class: "run quiet", type: "button" }, "Stop");
  const about = h("details", {}, h("summary", {}, `Waiting for: ${s.waiting_for}`), h("p", {}, s.prompt), h("p", { class: "fine" }, IDLE_LINE));
  const strip = h("div", { class: "strip", role: "group", "aria-label": `Topic ${n} checks on its own` }, line, about, h("div", { class: "strip-actions" }, run, edit, stop));
  run.onclick = async () => {
    run.setAttribute("disabled", "");
    run.textContent = "Starting…";
    if (!(await client.send({ t: "topic_run", topic: n }))) {
      run.removeAttribute("disabled");
      run.textContent = "Run now";
    }
  };
  stop.onclick = async () => {
    if (!confirm(`Stop topic ${n} checking on its own?`)) return;
    stop.setAttribute("disabled", "");
    if (!(await client.send({ t: "topic_stop", topic: n }))) stop.removeAttribute("disabled");
  };
  edit.onclick = () => {
    const field = (label: string, input: HTMLElement) => h("label", {}, h("span", {}, label), input);
    const title = h("input", { type: "text", value: s.waiting_for, maxlength: "120" }) as HTMLInputElement;
    const box = h("textarea", { rows: "5", maxlength: "2000" }, s.prompt) as HTMLTextAreaElement;
    const doneWhen = h("input", { type: "text", value: s.done_when, maxlength: "300", placeholder: "What ends it, or never" }) as HTMLInputElement;
    const every = h("input", { type: "number", min: "5", step: "1", value: String(Math.round(s.every / 60)) }) as HTMLInputElement;
    const at = h("input", { type: "text", value: (s.at ?? []).join(", "), placeholder: "08:00, 18:00", autocapitalize: "off" }) as HTMLInputElement;
    const nextAt = h("input", { type: "datetime-local", value: toLocalInput(Math.max(s.next, Date.now() / 1000)) }) as HTMLInputElement;
    const error = h("p", { class: "fine error", hidden: "" });
    const save = h("button", { class: "run", type: "button" }, "Save");
    const back = h("button", { class: "run quiet", type: "button" }, "Cancel");
    const form = h(
      "div",
      { class: "task-edit" },
      field("Waiting for", title),
      field("How it checks", box),
      field("Done when (or never)", doneWhen),
      h("div", { class: "task-edit-row" }, field("Check every (minutes)", every), field("Or at times of day", at), field("Next check", nextAt)),
      error,
      h("div", { class: "task-edit-actions" }, back, save),
    );
    strip.replaceChildren(form);
    back.onclick = () => strip.replaceWith(scheduleStrip(client, n, s, dates));
    save.onclick = async () => {
      const minutes = Number(every.value);
      const next = fromLocalInput(nextAt.value);
      if (!at.value.trim() && (!Number.isFinite(minutes) || minutes < 5)) {
        error.textContent = "Check at most every 5 minutes.";
        error.hidden = false;
        return;
      }
      save.setAttribute("disabled", "");
      const sent = await client.send({
        t: "topic_edit",
        topic: n,
        title: title.value.trim(),
        prompt: box.value.trim(),
        done_when: doneWhen.value.trim(),
        ...(at.value.trim() ? { at: at.value.trim() } : { every: Math.round(minutes) * 60 }),
        ...(next ? { next } : {}),
      });
      if (!sent) {
        save.removeAttribute("disabled");
        error.textContent = "Your computer is offline.";
        error.hidden = false;
      }
      // The computer sends the topic again with its new schedule, and the strip is drawn from it.
    };
    title.focus();
  };
  return strip;
}
