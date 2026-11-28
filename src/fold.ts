// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Topics (SPEC §4.1, §7.4): every chat item belongs to a numbered topic. The chat is the list of topics, oldest to
// newest by their last message, grouped by that day (…, Yesterday, Today); the topics waiting on the person come
// last, under Needs input, right above the composer. One topic is open at a time; the rest are one line each.
import { type DateFormat, formatDate } from "./markdown";
import type { Item } from "./store";

export const BREAK_SECONDS = 2 * 3600;

/** A topic as the computer describes it (`topic` items and the sync's list, SPEC §6.5). */
export interface TopicMeta {
  topic: number;
  title: string;
  state: string; // "" | scheduled | waiting | done | failed
  last?: number;
  question?: string;
  schedule?: Schedule;
}

export interface Schedule {
  waiting_for: string;
  prompt: string;
  done_when: string;
  every: number; // seconds
  at?: string[];
  next: number;
  checks: number;
  paused: boolean;
}

export interface Topic {
  n: number;
  items: Item[]; // what the chat shows of it, oldest first
  title: string;
  state: string;
  question: string;
  schedule?: Schedule;
  last: number; // when its last message was
  needsInput: boolean; // it waits on the person: a question, or a card not answered yet
}

/** An item the chat shows, as aha_local/folding.py SHOWN: a message, a card, a Details line, a thing done. */
export const shown = (it: Item) => it.t === "msg" || it.t === "approval" || it.t === "steps" || it.t === "act";
const sameDay = (a: number, b: number) => new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();
export const isBreak = (before: number, after: number) => after - before >= BREAK_SECONDS || !sameDay(before, after);

/** The first words of the person's first message: the title when the computer didn't give one. */
function firstWords(items: Item[]): string {
  const mine = items.find((it) => it.t === "msg" && it.role === "me" && String(it.text ?? "").trim());
  const words = String(mine?.text ?? "").trim().split(/\s+/);
  if (!words[0]) return "Untitled";
  return words.length > 7 ? `${words.slice(0, 7).join(" ").replace(/[,.;:!?]+$/, "")}…` : words.join(" ");
}

/** What's known of each topic, from its `topic` items (the latest wins) over the sync's list. */
export function metaOf(all: Item[], synced: Map<number, TopicMeta>): Map<number, TopicMeta> {
  const out = new Map(synced);
  for (const it of [...all].sort((a, b) => a.seq - b.seq)) {
    if (it.t === "topic" && typeof it.topic === "number") out.set(it.topic, it as unknown as TopicMeta);
  }
  return out;
}

/** The topics, oldest to newest by their last message. `resolved`: the approval ids that have a state. */
export function topicsOf(all: Item[], synced: Map<number, TopicMeta>, resolved: Set<string>): Topic[] {
  const meta = metaOf(all, synced);
  const by = new Map<number, Item[]>();
  for (const it of [...all].sort((a, b) => a.seq - b.seq)) {
    if (!shown(it)) continue;
    const n = typeof it.topic === "number" ? it.topic : 0;
    by.set(n, [...(by.get(n) ?? []), it]);
  }
  const out: Topic[] = [];
  for (const [n, items] of by) {
    const m = meta.get(n);
    const said = items.filter((it) => it.t === "msg");
    const last = Math.max(...(said.length ? said : items).map((it) => it.ts));
    const unanswered = items.some((it) => it.t === "approval" && !resolved.has(String(it.id)));
    out.push({
      n,
      items,
      title: m?.title || firstWords(items),
      state: m?.state ?? "",
      question: m?.question ?? "",
      schedule: m?.schedule,
      last,
      needsInput: m?.state === "waiting" || unanswered,
    });
  }
  return out.sort((a, b) => a.last - b.last || a.n - b.n);
}

/** The groups the chat shows, in order: each day's topics (by their last message), then Needs input. */
export function groups(list: Topic[], day: (ts: number) => string): { label: string; topics: Topic[] }[] {
  const out: { label: string; topics: Topic[] }[] = [];
  for (const t of list.filter((t) => !t.needsInput)) {
    const label = day(t.last);
    if (out[out.length - 1]?.label === label) out[out.length - 1].topics.push(t);
    else out.push({ label, topics: [t] });
  }
  const waiting = list.filter((t) => t.needsInput);
  if (waiting.length) out.push({ label: "Needs input", topics: waiting });
  return out;
}

/** A topic line's time: HH:MM of its last message. */
export function lineTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A day's heading in the chat (SPEC §7.4 "Folding"): "Today", "Yesterday", "Last week · <date>" for the five days
 * before, then the date, in the device's date format. */
export function dayWords(ts: number, now: number, format: DateFormat = "short"): string {
  const d = new Date(ts * 1000);
  const n = new Date(now * 1000);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(n) - midnight(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = formatDate(d, format, n);
  return days > 1 && days < 7 ? `Last week · ${date}` : date;
}
