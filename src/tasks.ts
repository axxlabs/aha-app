// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Tasks (SPEC §3.4 "Background tasks", §7.4): what Aha! waits for and checks on its own, in a panel of its own.
// Each task with how often it checks, the next check and until when, what the last check found, and Cancel; at
// the top, the idle time the checks wait for (they run only while nobody uses Aha!).
import type { Client } from "./client";
import { ICONS, h, icon, openSheet } from "./dom";
import { formatDate } from "./markdown";

export interface BackgroundTask {
  id: string;
  title: string;
  prompt: string;
  every: number; // seconds
  until: number | null; // epoch seconds; null = no end
  next: number;
  last: string;
  checks: number;
  updates: number; // NOTIFY messages sent so far: the task reports and goes on
  created: number;
  now?: boolean; // Run now was asked: it checks as soon as the model is free
  running?: boolean; // a check of it runs now
  last_how?: string; // how the last check ended: waiting | notify | unfinished | interrupted
}
export interface TasksState {
  items: BackgroundTask[];
  idle_since: number;
  idle_after: number;
  busy: boolean;
}
export interface TasksUi {
  close(): void;
  show(state: TasksState): void;
}

const REFRESH_MS = 30_000;

/** "Every 30 min", "Every 4 hours", "Every day". */
export function everyWords(seconds: number): string {
  const m = Math.round(seconds / 60);
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

/** The panel's "Next" line for a task. */
export function nextWords(t: Pick<BackgroundTask, "next" | "now" | "running">, now: number, when: (epoch: number) => string): string {
  const planned = t.next <= now ? "At the next idle time" : `Next check ${when(t.next)}`;
  // Run now is an extra check: the planned one keeps its time, said beside it.
  const then = t.next <= now ? "" : ` · then ${when(t.next)}`;
  if (t.running) return `Checking now${then}`;
  if (t.now) return `As soon as Aha! is free${then}`;
  return planned;
}

/** How the last check ended, beside "Last check" ("" for a plain WAITING). */
export function lastHow(how: string | undefined): string {
  return { notify: " · sent to you", unfinished: " · didn't finish", interrupted: " · stopped early" }[how ?? ""] ?? "";
}

/** "3 checks so far", "5 checks, 2 updates sent". */
export function countWords(checks: number, updates: number): string {
  const c = checks === 1 ? "1 check" : `${checks} checks`;
  if (!updates) return `${c} so far`;
  return `${c}, ${updates === 1 ? "1 update" : `${updates} updates`} sent`;
}

/** "12 min", "2 h 5 min", "less than a minute". */
export function idleWords(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 1) return "less than a minute";
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  return m % 60 ? `${hours} h ${m % 60} min` : `${hours} h`;
}

/** The idle line at the top of the panel. */
export function idleLine(state: Pick<TasksState, "idle_since" | "idle_after" | "busy">, now: number): string {
  if (state.busy) return "Working on a request · checks wait until it's done";
  return `Idle for ${idleWords(now - state.idle_since)} · checks run after ${idleWords(state.idle_after)} idle`;
}

export function openTasks(client: Client, onClose: () => void): TasksUi {
  const offline = () => h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline.");
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon(ICONS.close));
  const idle = h("p", { class: "idle" });
  const list = h("div", { class: "task-list" }, offline());
  const content = h(
    "div",
    { class: "sheet-in tasks" },
    h("header", {}, h("h2", {}, "Tasks"), close),
    h("p", { class: "fine" }, "What Aha! does later on its own: waiting for something, or at a time. It checks while nobody is using it, and tells you in the chat. To start one, ask in the chat."),
    idle,
    list,
  );
  const ask = () => void client.send({ t: "tasks_request" });
  const refresh = setInterval(ask, REFRESH_MS);
  const { shut } = openSheet("Tasks", content, () => {
    clearInterval(refresh);
    clearInterval(ticking);
    onClose();
  });
  close.onclick = shut;

  const when = (epoch: number) => {
    const d = new Date(epoch * 1000);
    const clock = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const today = new Date().toDateString() === d.toDateString();
    return today ? clock : `${formatDate(d, client.settings.dates)} ${clock}`;
  };

  let state: TasksState | null = null;
  let editing = false;
  const drawIdle = () => {
    idle.textContent = state ? idleLine(state, Date.now() / 1000) : "";
  };
  const ticking = setInterval(drawIdle, 15_000);

  const card = (t: BackgroundTask) => {
    const cancel = h("button", { class: "forget", type: "button", "aria-label": `Cancel “${t.title}”`, title: "Cancel" }, icon(ICONS.close));
    cancel.onclick = async () => {
      if (!confirm(`Stop waiting for “${t.title}”?`)) return;
      cancel.setAttribute("disabled", "");
      if (!(await client.send({ t: "task_cancel", id: t.id }))) cancel.removeAttribute("disabled");
    };
    // Run now (SPEC §3.4): the check runs at once, without waiting for the idle time; only a busy model delays it.
    const run = h("button", { class: "run", type: "button" }, t.running ? "Checking now…" : t.now ? "Starting…" : "Run now");
    if (t.running || t.now) run.setAttribute("disabled", "");
    run.onclick = async () => {
      run.setAttribute("disabled", "");
      run.textContent = "Starting…";
      if (!(await client.send({ t: "task_run", id: t.id }))) {
        run.removeAttribute("disabled");
        run.textContent = "Run now";
      }
    };
    // Edit (SPEC §7.4): the person changes what each check does; their own action, so no card. The next check
    // runs the new text.
    const how = h("details", {}, h("summary", {}, "How it checks"), h("p", {}, t.prompt));
    const editBtn = h("button", { class: "run", type: "button" }, "Edit");
    const foot = h("div", { class: "task-foot" }, how, editBtn, run);
    editBtn.onclick = () => {
      // Every field (SPEC §7.4): what it waits for, what it checks, how often, the next check and until when.
      const field = (label: string, input: HTMLElement) => h("label", {}, h("span", {}, label), input);
      const title = h("input", { type: "text", value: t.title, maxlength: "120" }) as HTMLInputElement;
      const box = h("textarea", { rows: "6", maxlength: "2000" }, t.prompt) as HTMLTextAreaElement;
      const every = h("input", { type: "number", min: "5", step: "1", value: String(Math.round(t.every / 60)) }) as HTMLInputElement;
      const nextAt = h("input", { type: "datetime-local", value: toLocalInput(Math.max(t.next, Date.now() / 1000)) }) as HTMLInputElement;
      const until = h("input", { type: "datetime-local", value: t.until === null ? "" : toLocalInput(t.until) }) as HTMLInputElement;
      const noEnd = h("input", { type: "checkbox" }) as HTMLInputElement;
      noEnd.checked = t.until === null;
      until.disabled = noEnd.checked;
      noEnd.onchange = () => (until.disabled = noEnd.checked);
      const error = h("p", { class: "fine error", hidden: "" });
      const save = h("button", { class: "run", type: "button" }, "Save");
      const back = h("button", { class: "run quiet", type: "button" }, "Cancel");
      const form = h(
        "div",
        { class: "task-edit" },
        field("Waiting for", title),
        field("How it checks", box),
        h("div", { class: "task-edit-row" }, field("Check every (minutes)", every), field("Next check", nextAt)),
        h("div", { class: "task-edit-row" }, field("Until", until), h("label", { class: "check" }, noEnd, h("span", {}, "No end"))),
        error,
        h("div", { class: "task-edit-actions" }, back, save),
      );
      editing = true;
      const done = () => {
        editing = false;
        form.replaceWith(foot);
        draw(); // what came in meanwhile
      };
      back.onclick = done;
      save.onclick = async () => {
        const minutes = Number(every.value);
        const next = fromLocalInput(nextAt.value);
        const end = noEnd.checked ? null : fromLocalInput(until.value);
        const why = !title.value.trim()
          ? "Say what it waits for."
          : !box.value.trim()
            ? "Say how it checks."
            : !(minutes >= 5)
              ? "Check at most every 5 minutes."
              : next === null
                ? "Choose the next check."
                : !noEnd.checked && end === null
                  ? "Choose when it ends, or No end."
                  : end !== null && next >= end
                    ? "The next check must be before it ends."
                    : "";
        error.textContent = why;
        error.hidden = !why;
        if (why) return;
        save.setAttribute("disabled", "");
        const sent = await client.send({ t: "task_edit", id: t.id, title: title.value.trim(), prompt: box.value.trim(), every: Math.round(minutes) * 60, next, until: end });
        if (sent) done(); // the computer sends the new list
        else save.removeAttribute("disabled");
      };
      foot.replaceWith(form);
      box.focus();
    };
    const now = Date.now() / 1000;
    const next = nextWords(t, now, when);
    const checks = countWords(t.checks, t.updates ?? 0);
    return h(
      "article",
      { class: "task" },
      h("header", {}, h("b", {}, t.title), cancel),
      h(
        "dl",
        {},
        h("dt", {}, "Checks"),
        h("dd", {}, everyWords(t.every)),
        h("dt", {}, "Next"),
        h("dd", {}, next),
        h("dt", {}, "Until"),
        h("dd", {}, t.until === null ? "No end" : when(t.until)),
      ),
      t.last || t.last_how ? h("p", { class: "last" }, h("small", {}, `Last check${lastHow(t.last_how)} · ${checks}`), t.last) : h("p", { class: "last" }, h("small", {}, "Not checked yet")),
      foot,
    );
  };

  ask();
  return {
    close: shut,
    show(s) {
      state = s;
      drawIdle();
      draw();
    },
  };

  /** The list, unless the person is editing a task: a refresh then waits, so it doesn't wipe their text. */
  function draw(): void {
    if (!state || editing) return;
    list.replaceChildren(
      ...(state.items.length
        ? state.items.map(card)
        : [h("p", { class: "fine" }, "Nothing yet. Ask Aha! to remind you of something, do something at a time, or keep checking on something (a reply, a delivery, a price).")]),
    );
  }
}
