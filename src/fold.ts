// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Folding the chat (SPEC §7.4 "Folding"). The app's own view: a break is two hours without a message, or a new
// day. A new subject the computer marked starts a part of its own, and so does a cut (the person's [collapse]:
// everything before it folds at once). Each part before a break folds into one grey line with
// its title; what's unfinished stays open; the part still going on doesn't fold and has no title.
import { type DateFormat, formatDate } from "./markdown";
import type { Item } from "./store";

export const BREAK_SECONDS = 2 * 3600;

export interface Part {
  first: number; // seq of its first item
  last: number;
  ts: number; // when it started
  title: string;
  n?: number; // its topic's number (SPEC §7.4 "Topic numbers"), when the computer gave one
  folded: boolean; // false for the part still going on
  open: Set<number>; // seqs that stay visible while it's folded
  notes: Note[]; // its background task notes, in order
  started: { id: string; ts: number; title: string }[]; // its "Start this background task?" cards, with the task's title
}

export const NOTE_KINDS = ["update", "done", "failed"];
export interface Note {
  kind: string; // update | done | failed
  title: string; // the task's
  text: string; // what it said
}

/** An item the chat shows, as aha_local/folding.py SHOWN: a message, a card, a Details line, a thing done. */
export const shown = (it: Item) => it.t === "msg" || it.t === "approval" || it.t === "steps" || it.t === "act";
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
  // SHA's messages that wait for your reply, as the computer said after each request (SPEC §7.4).
  const waiting = new Set(titles.filter((t) => typeof t.waiting === "number").map((t) => Number(t.waiting)));
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
    // The last part is still going on until a break, or while SHA works on it.
    // A cut after it folds it now, working or not: what SHA answers next starts a part of its own.
    const live =
      i === parts.length - 1 && !cutBetween(last, Infinity) && (working || !isBreak(part[part.length - 1].ts, now));
    const named = titles.filter((t) => Number(t.from) >= first && Number(t.from) <= last).pop();
    // Its topic's number: the latest titled part starting at or before its end, with no cut between (a part split
    // off by a break keeps its topic's number).
    const covering = titles
      .filter((t) => typeof t.n === "number" && Number(t.from) <= last && !cutBetween(Number(t.from), first))
      .sort((a, b) => Number(a.from) - Number(b.from))
      .pop();
    const open = new Set<number>();
    part.forEach((it, k) => {
      const unfinished =
        (it.t === "approval" && !resolved.has(String(it.id))) || // a card waiting for you
        (it.t === "msg" && it.open === "stopped" && it.seq > lastMine) || // stopped, and you haven't written since
        (it.t === "msg" && waiting.has(it.seq) && it.seq > lastMine); // waits for your reply, and you haven't written
      if (!unfinished) return;
      open.add(it.seq);
      const before = part[k - 1]; // what you asked, so the open item makes sense on its own
      if (before?.t === "msg" && before.role === "me") open.add(before.seq);
    });
    const notes = part.flatMap((it): Note[] => {
      if (it.t !== "msg" || !it.task || typeof it.task !== "object") return [];
      const { kind, title } = it.task as { kind?: unknown; title?: unknown };
      return [{ kind: NOTE_KINDS.includes(String(kind)) ? String(kind) : "update", title: typeof title === "string" ? title : "", text: String(it.text ?? "") }];
    });
    const started = part
      .filter((it) => it.t === "approval" && it.kind === "task")
      .map((it) => {
        const fields = Array.isArray(it.fields) ? (it.fields as { value?: unknown }[]) : [];
        return { id: String(it.id), ts: it.ts, title: String(fields[0]?.value ?? "") }; // "Waiting for"
      });
    const n = typeof covering?.n === "number" ? covering.n : undefined;
    return { first, last, ts: part[0].ts, title: String(named?.text ?? "") || firstWords(part), n, folded: !live, open, notes, started };
  });
}

/** A fold line's time: HH:MM, on its right, under its day's heading. */
export function foldTime(p: Part): string {
  return new Date(p.ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
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

/** A result's gist: its first words as plain text, at most `max` characters. */
export function gist(text: string, max = 140): string {
  const plain = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links: their words
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : plain;
}
