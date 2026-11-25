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

/** The panel's "Next" line for a task. */
export function nextWords(t: Pick<BackgroundTask, "next" | "now" | "running">, now: number, when: (epoch: number) => string): string {
  if (t.running) return "Checking now";
  if (t.now) return "As soon as Aha! is free";
  return t.next <= now ? "At the next idle time" : `Next check ${when(t.next)}`;
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
    h("p", { class: "fine" }, "What Aha! is waiting for and checks on its own, while nobody is using it. It tells you in the chat once each is done. To start one, ask in the chat."),
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
      t.last ? h("p", { class: "last" }, h("small", {}, `Last check · ${checks}`), t.last) : h("p", { class: "last" }, h("small", {}, "Not checked yet")),
      h("div", { class: "task-foot" }, h("details", {}, h("summary", {}, "How it checks"), h("p", {}, t.prompt)), run),
    );
  };

  ask();
  return {
    close: shut,
    show(s) {
      state = s;
      drawIdle();
      list.replaceChildren(
        ...(s.items.length
          ? s.items.map(card)
          : [h("p", { class: "fine" }, "Nothing yet. When something can't be done yet (a reply, a delivery, a price), Aha! asks to keep checking for you.")]),
      );
    },
  };
}
