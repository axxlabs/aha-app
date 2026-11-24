// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// The chat view (SPEC §7.4). `items` is the only state; draw() derives everything shown from it: the parts of the
// chat and their fold lines, day labels, what stays open, and what's being sent. Each item's element is made once
// and kept, so a card keeps what's typed in it. Everything else only changes the state and calls invalidate().
import { foldLabel, plan } from "./fold";
import type { Item } from "./store";

export interface ViewDeps {
  col: HTMLElement; // where the chat goes
  scroller: HTMLElement; // what scrolls
  working: HTMLElement; // "Aha! is working…", always last
  node(it: Item): HTMLElement | null; // an item's element (null: not shown)
  resolve(it: Item, state: string): void; // show a card's answer on its element
  dayLabel(ts: number): string;
  busy(): boolean; // a task is running: the part going on doesn't fold
  cut?: HTMLElement; // [collapse]: shown while there's a part going on to fold
  now?: () => number; // seconds (tests)
  frame?: (fn: () => void) => void; // requestAnimationFrame (tests: run now)
}

const shown = (it: Item) => it.t === "msg" || it.t === "approval";

export function chatView(d: ViewDeps) {
  const items = new Map<number, Item>();
  const els = new Map<number, HTMLElement>();
  const pending = new Map<string, HTMLElement>(); // sent from here, not echoed back yet
  const expanded = new Set<number>(); // folded parts the person opened, by their first item
  const foldLines = new Map<number, HTMLButtonElement>();
  const dayLines = new Map<string, HTMLElement>();
  const answered = new Set<number>(); // cards already shown as answered
  const now = d.now ?? (() => Date.now() / 1000);
  const frame = d.frame ?? ((fn: () => void) => requestAnimationFrame(fn));
  let queued = false;
  let wantBottom = false;

  const atBottom = () => d.scroller.scrollHeight - d.scroller.scrollTop - d.scroller.clientHeight < 80;
  const toBottom = () => (d.scroller.scrollTop = d.scroller.scrollHeight);

  function elementFor(it: Item): HTMLElement | null {
    let el = els.get(it.seq);
    if (!el) {
      const made = d.node(it);
      if (!made) return null;
      made.dataset.seq = String(it.seq);
      els.set(it.seq, made);
      el = made;
    }
    return el;
  }

  function foldLine(first: number): HTMLButtonElement {
    let line = foldLines.get(first);
    if (!line) {
      line = document.createElement("button");
      line.type = "button";
      line.className = "fold";
      line.onclick = () => {
        if (expanded.has(first)) expanded.delete(first);
        else expanded.add(first);
        invalidate();
      };
      foldLines.set(first, line);
    }
    return line;
  }

  function dayLine(day: string): HTMLElement {
    let el = dayLines.get(day);
    if (!el) {
      el = document.createElement("div");
      el.className = "day";
      el.textContent = day;
      dayLines.set(day, el);
    }
    return el;
  }

  function draw(): void {
    queued = false;
    const stick = wantBottom || atBottom();
    wantBottom = false;
    const fromBottom = d.scroller.scrollHeight - d.scroller.scrollTop;
    const all = [...items.values()].sort((a, b) => a.seq - b.seq);
    const states = new Map(all.filter((it) => it.t === "approval_state").map((it) => [String(it.id), String(it.state)]));
    const t = now();
    const chat = all.filter(shown);
    const want: Node[] = [];
    let lastDay = "";
    let at = 0;
    const parts = plan(all, new Set(states.keys()), t, d.busy());
    if (d.cut) d.cut.hidden = !parts.length || parts[parts.length - 1].folded;
    for (const p of parts) {
      const open = expanded.has(p.first);
      if (p.folded) {
        const line = foldLine(p.first);
        const chevron = document.createElement("span");
        chevron.className = "chevron";
        chevron.setAttribute("aria-hidden", "true");
        chevron.textContent = open ? "▾" : "▸";
        line.replaceChildren(chevron, foldLabel(p, t));
        line.setAttribute("aria-expanded", String(open));
        want.push(line);
      }
      while (at < chat.length && chat[at].seq <= p.last) {
        const it = chat[at++];
        if (p.folded && !open && !p.open.has(it.seq)) continue;
        const el = elementFor(it);
        if (!el) continue;
        const day = d.dayLabel(it.ts);
        if (day !== lastDay) want.push(dayLine(day));
        lastDay = day;
        want.push(el);
        const state = it.t === "approval" ? states.get(String(it.id)) : undefined;
        if (state && !answered.has(it.seq)) {
          answered.add(it.seq);
          d.resolve(it, state);
        }
      }
    }
    want.push(...pending.values(), d.working);
    // Move only what's out of place, so a card being typed into keeps its focus.
    let cur = d.col.firstChild;
    for (const n of want) {
      if (n === cur) cur = cur.nextSibling;
      else d.col.insertBefore(n, cur);
    }
    while (cur) {
      const next = cur.nextSibling;
      cur.remove();
      cur = next;
    }
    if (stick) toBottom();
    else d.scroller.scrollTop = d.scroller.scrollHeight - fromBottom; // what's on screen stays put
  }

  /** Draw on the next frame; `bottom`: then scroll to the end (a new message, coming back to the app). */
  function invalidate(bottom = false): void {
    wantBottom ||= bottom;
    if (queued) return;
    queued = true;
    frame(draw);
  }

  return {
    items,
    draw,
    invalidate,
    toBottom,
    atBottom,
    /** Items in (live, synced, older history, the cache). */
    add(list: Item[]): void {
      for (const it of list) {
        if (typeof it.seq !== "number" || items.has(it.seq)) continue;
        items.set(it.seq, it);
        if (it.t === "msg" && it.role === "me" && typeof it.cid === "string") pending.delete(it.cid); // echoed back
      }
      invalidate();
    },
    /** History before `start` is gone (its length, or Clear history): it goes from here too. */
    dropBefore(start: number): void {
      for (const seq of [...items.keys()]) {
        if (seq >= start) continue;
        items.delete(seq);
        els.delete(seq);
        answered.delete(seq);
      }
      expanded.clear();
      invalidate();
    },
    /** A message sent from here, until the computer echoes it back. */
    sending(cid: string, el: HTMLElement): void {
      pending.set(cid, el);
      invalidate(true);
    },
    pendingEntries: () => pending.entries(),
    /** Make these items' elements again on the next draw (e.g. the accounts shown as labels changed). */
    remake(which: (it: Item) => boolean): void {
      for (const [seq, it] of items) if (which(it)) els.delete(seq);
      invalidate();
    },
    oldest: () => (items.size ? Math.min(...items.keys()) : Infinity),
  };
}
