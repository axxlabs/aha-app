// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Folding the chat after a break (SPEC §7.4 "Folding"). The same rule as the computer's aha_local/folding.py (the
// break is checked against test/vectors/device_messages.json on both sides):
// a break is two hours without a message, or a new day; a new subject starts a part of its own, and so does a
// cut (the person's [collapse]: everything before it folds at once). Each part before a break folds into one grey line with
// its title; what's unfinished stays open; the part still going on doesn't fold and has no title.
import type { Item } from "./store";

export const BREAK_SECONDS = 2 * 3600;

export interface Part {
  first: number; // seq of its first item
  last: number;
  ts: number; // when it started
  title: string;
  folded: boolean; // false for the part still going on
  open: Set<number>; // seqs that stay visible while it's folded
  notes: string[]; // the kinds of background task notes in it (update, done, failed, expired), in that order
  started: { id: string; ts: number }[]; // its "Start this background task?" cards
}

export const NOTE_KINDS = ["update", "done", "failed", "expired"];

const shown = (it: Item) => it.t === "msg" || it.t === "approval" || it.t === "tool"; // aha_local/folding.py SHOWN
const sameDay = (a: number, b: number) => new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();
export const isBreak = (before: number, after: number) => after - before >= BREAK_SECONDS || !sameDay(before, after);

/** The first words of the person's first message: the title when the computer didn't give one. */
function firstWords(items: Item[]): string {
  const mine = items.find((it) => it.t === "msg" && it.role === "me" && String(it.text ?? "").trim());
  const words = String(mine?.text ?? "").trim().split(/\s+/);
  if (!words[0]) return "Earlier";
  return words.length > 7 ? `${words.slice(0, 7).join(" ").replace(/[,.;:!?]+$/, "")}…` : words.join(" ");
}

/** The parts of the chat and what shows of each. `resolved`: the approval ids that have a state; `working`: a
 * task is running now. */
export function plan(all: Item[], resolved: Set<string>, now: number, working = false): Part[] {
  const items = [...all].sort((a, b) => a.seq - b.seq);
  const chat = items.filter(shown);
  const titles = items.filter((it) => it.t === "title");
  // A new subject starts a part too: the computer marks the message where it starts (SPEC §7.4).
  const topics = new Set(titles.filter((t) => t.new === true).map((t) => Number(t.from)));
  const cuts = items.filter((it) => it.t === "cut").map((it) => it.seq);
  const cutBetween = (a: number, b: number) => cuts.some((c) => c > a && c < b);
  const lastMine = Math.max(0, ...chat.filter((it) => it.role === "me").map((it) => it.seq));
  const parts: Item[][] = [];
  for (const it of chat) {
    const cur = parts[parts.length - 1];
    const prev = cur?.[cur.length - 1];
    if (!prev || isBreak(prev.ts, it.ts) || topics.has(it.seq) || cutBetween(prev.seq, it.seq)) parts.push([it]);
    else cur.push(it);
  }
  return parts.map((part, i) => {
    const first = part[0].seq;
    const last = part[part.length - 1].seq;
    // The last part is still going on until a break, or while Aha! works on it.
    // A cut after it folds it now, working or not: what Aha! answers next starts a part of its own.
    const live =
      i === parts.length - 1 && !cutBetween(last, Infinity) && (working || !isBreak(part[part.length - 1].ts, now));
    const named = titles.filter((t) => Number(t.from) >= first && Number(t.from) <= last).pop();
    const open = new Set<number>();
    part.forEach((it, k) => {
      const unfinished =
        (it.t === "approval" && !resolved.has(String(it.id))) || // a card waiting for you
        (it.t === "msg" && it.open === "stopped" && it.seq > lastMine) || // stopped, and you haven't written since
        (it.t === "msg" && it.open === "asks" && it.seq > lastMine); // a question you haven't answered
      if (!unfinished) return;
      open.add(it.seq);
      const before = part[k - 1]; // what you asked, so the open item makes sense on its own
      if (before?.t === "msg" && before.role === "me") open.add(before.seq);
    });
    const kinds = new Set(part.flatMap((it) => (it.t === "msg" && it.task && typeof it.task === "object" ? [String((it.task as { kind?: unknown }).kind ?? "update")] : [])));
    const notes = NOTE_KINDS.filter((k) => kinds.has(k));
    const started = part.filter((it) => it.t === "approval" && it.kind === "task").map((it) => ({ id: String(it.id), ts: it.ts }));
    return { first, last, ts: part[0].ts, title: String(named?.text ?? "") || firstWords(part), folded: !live, open, notes, started };
  });
}

export function foldLabel(p: Part, now: number): string {
  const d = new Date(p.ts * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = sameDay(p.ts, now) ? "today" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${p.title} · ${day} ${time}`;
}
