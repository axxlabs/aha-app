// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// The chat view (SPEC §4.1, §7.4). `items` is the only state; draw() derives everything shown from it: the topics,
// oldest to newest by their last message, grouped by day, then Needs input; one topic open at a time, with the
// composer inside it; the rest one line each. Each item's element is made once and kept, so a card keeps what's
// typed in it. Everything else only changes the state and calls invalidate().
import { type Schedule, type Topic, type TopicMeta, isBreak, lineTime, groups, topicsOf } from "./fold";
import type { Item } from "./store";

export interface ViewDeps {
  col: HTMLElement; // where the chat goes
  scroller: HTMLElement; // what scrolls
  working: HTMLElement; // "sha is working…", in the topic it works in
  composer: HTMLElement; // the message box: inside the open topic, or in `footer` for a new topic
  footer: HTMLElement; // the bar at the bottom: shown only when every topic is collapsed
  node(it: Item): HTMLElement | null; // an item's element (null: not shown)
  resolve(it: Item, state: string): void; // show a card's answer on its element
  dayLabel(ts: number): string;
  busy(): boolean; // a request or wakeup is running
  busyTopic(): number; // the topic it works in (0: not known)
  strip?(n: number, s: Schedule): HTMLElement; // a scheduled topic's strip (SPEC §4.1)
  background?: HTMLElement; // "Continue in background": shown in the open topic while sha works on it
  remove?(n: number): void; // the open topic's Delete topic (SPEC §4.1)
  opened?(n: number | null): void; // the open topic changed (the composer's placeholder)
  now?: () => number; // seconds (tests)
  frame?: (fn: () => void) => void; // requestAnimationFrame (tests: run now)
}

export function chatView(d: ViewDeps) {
  const items = new Map<number, Item>();
  const els = new Map<number, HTMLElement>();
  const pending = new Map<string, { el: HTMLElement; topic: number }>(); // sent from here, not echoed back yet
  const lines = new Map<number, HTMLElement>(); // each topic's line
  const boxes = new Map<number, HTMLElement>(); // the open topic's box
  const strips = new Map<number, { key: string; el: HTMLElement }>();
  const heads = new Map<string, HTMLElement>();
  const removers = new Map<number, HTMLElement>(); // each open topic's Delete topic button
  const answered = new Set<number>(); // cards already shown as answered
  const synced = new Map<number, TopicMeta>(); // the sync's list of topics (SPEC §6.5)
  const now = d.now ?? (() => Date.now() / 1000);
  const frame = d.frame ?? ((fn: () => void) => requestAnimationFrame(fn));
  let open: number | null = null;
  let chosen = false; // the person opened or closed a topic: no default open any more
  let queued = false;
  let wantBottom = false;
  let scrollTo: number | null = null; // a topic just opened: its line comes to the top on the next draw

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

  function setOpen(n: number | null): void {
    if (n === open) return;
    open = n;
    if (n !== null) scrollTo = n;
    d.opened?.(n);
    invalidate(n === null);
  }

  function head(label: string): HTMLElement {
    let el = heads.get(label);
    if (!el) {
      el = document.createElement("div");
      el.className = label === "Needs input" ? "day needs" : "day";
      el.textContent = label;
      heads.set(label, el);
    }
    return el;
  }

  /** A topic's state, as one icon on its line (SPEC §4.1 "Icons"). */
  function stateIcon(t: Topic): HTMLElement | null {
    const span = (cls: string, text: string, label: string) => {
      const el = document.createElement("span");
      el.className = `state-icon ${cls}`;
      el.textContent = text;
      el.title = label;
      el.setAttribute("aria-label", label);
      return el;
    };
    if (d.busy() && d.busyTopic() === t.n) return span("running", "•••", "sha is working on it");
    if (t.needsInput) return span("waiting", "●", "Waiting on you");
    if (t.state === "scheduled" && t.schedule) {
      return span("scheduled", t.schedule.paused ? "⏱" : `⏱ ${lineTime(t.schedule.next)}`, "Checks on its own");
    }
    if (t.state === "done") return span("done", "✓", "Done");
    if (t.state === "failed") return span("failed", "!", "Couldn't be done");
    return null;
  }

  function line(t: Topic): HTMLElement {
    let el = lines.get(t.n);
    if (!el) {
      el = document.createElement("div");
      el.className = "fold";
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      const n = t.n;
      const toggle = () => {
        chosen = true;
        setOpen(open === n ? null : n);
      };
      el.onclick = toggle;
      el.onkeydown = (e) => {
        if (e.target === el && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          toggle();
        }
      };
      lines.set(t.n, el);
    }
    const isOpen = open === t.n;
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = isOpen ? "▾" : "▸";
    const num = document.createElement("span"); // its number, to ask sha about it ("topic 12")
    num.className = "num";
    num.textContent = t.n ? String(t.n) : "";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = t.title;
    const time = document.createElement("time");
    time.textContent = lineTime(t.last);
    const icon = stateIcon(t);
    el.replaceChildren(chevron, ...(t.n ? [num] : []), title, ...(icon ? [icon] : []), time);
    if (t.needsInput && t.question && !isOpen) {
      const q = document.createElement("span");
      q.className = "question";
      q.textContent = t.question;
      el.append(q);
    }
    el.classList.toggle("open", isOpen);
    el.setAttribute("aria-label", `${t.n ? `Topic ${t.n}: ` : ""}${t.title} · ${time.textContent}`);
    el.setAttribute("aria-expanded", String(isOpen));
    return el;
  }

  function stripFor(t: Topic): HTMLElement | null {
    if (!t.schedule || !d.strip) return null;
    const key = JSON.stringify(t.schedule);
    let s = strips.get(t.n);
    if (!s || s.key !== key) {
      s = { key, el: d.strip(t.n, t.schedule) };
      strips.set(t.n, s);
    }
    return s.el;
  }

  function box(t: Topic, states: Map<string, string>): HTMLElement {
    let el = boxes.get(t.n);
    if (!el) {
      el = document.createElement("section");
      el.className = "topic-box";
      boxes.set(t.n, el);
    }
    const want: Node[] = [line(t)];
    const strip = stripFor(t);
    if (strip) want.push(strip);
    for (const it of t.items) {
      const node = elementFor(it);
      if (!node) continue;
      want.push(node);
      const state = it.t === "approval" ? states.get(String(it.id)) : undefined;
      if (state && !answered.has(it.seq)) {
        answered.add(it.seq);
        d.resolve(it, state);
      }
    }
    for (const p of pending.values()) if (p.topic === t.n) want.push(p.el);
    const working = d.busy() && d.busyTopic() === t.n;
    if (working) want.push(d.working);
    if (working && d.background) want.push(d.background);
    want.push(d.composer);
    if (d.remove && t.n) want.push(remover(t.n));
    place(el, want);
    return el;
  }

  function remover(n: number): HTMLElement {
    let el = removers.get(n);
    if (!el) {
      el = document.createElement("button");
      el.className = "cut remove";
      (el as HTMLButtonElement).type = "button";
      el.textContent = "Delete topic";
      el.title = "Delete this topic, its messages and anything it checks on";
      el.onclick = () => d.remove?.(n);
      removers.set(n, el);
    }
    return el;
  }

  /** Put `want` in `parent`, in order, moving only what's out of place, so a card being typed into keeps its
   * focus. */
  function place(parent: HTMLElement, want: Node[]): void {
    let cur = parent.firstChild;
    for (const n of want) {
      if (n === cur) cur = cur.nextSibling;
      else parent.insertBefore(n, cur);
    }
    while (cur) {
      const next = cur.nextSibling;
      cur.remove();
      cur = next;
    }
  }

  function draw(): void {
    queued = false;
    const stick = wantBottom || atBottom();
    wantBottom = false;
    const fromBottom = d.scroller.scrollHeight - d.scroller.scrollTop;
    const all = [...items.values()];
    const states = new Map(all.filter((it) => it.t === "approval_state").map((it) => [String(it.id), String(it.state)]));
    const list = topicsOf(all, synced, new Set(states.keys()));
    const t = now();
    // Until the person chooses, the newest topic is open while it's going on (no break since its last message).
    if (!chosen) {
      const newest = list[list.length - 1];
      const going = newest && (!isBreak(newest.last, t) || (d.busy() && d.busyTopic() === newest.n));
      const want = going ? newest.n : null;
      if (want !== open) {
        open = want;
        d.opened?.(open);
      }
    }
    if (open !== null && !list.some((x) => x.n === open) && ![...pending.values()].some((p) => p.topic === open)) {
      open = null; // its history was cleared
      d.opened?.(null);
    }
    const want: Node[] = [];
    for (const g of groups(list, d.dayLabel)) {
      want.push(head(g.label));
      for (const topic of g.topics) want.push(topic.n === open ? box(topic, states) : line(topic));
    }
    const fresh = [...pending.values()].filter((p) => !p.topic || !list.some((x) => x.n === p.topic));
    want.push(...fresh.map((p) => p.el));
    if (d.busy() && (open === null || d.busyTopic() !== open) && !list.some((x) => x.n === d.busyTopic())) {
      want.push(d.working); // working on something not drawn yet (a new topic)
    }
    place(d.col, want);
    if (open === null && d.composer.parentElement !== d.footer) d.footer.append(d.composer);
    d.footer.hidden = open !== null;
    const opened = scrollTo === null ? undefined : lines.get(scrollTo);
    scrollTo = null;
    if (opened?.isConnected) {
      d.scroller.scrollTop += opened.getBoundingClientRect().top - d.scroller.getBoundingClientRect().top - 8;
    } else if (stick) toBottom();
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
    /** The topic open now (where a message goes), or null: a message starts a new topic. */
    opened: () => open,
    /** Open topic n (or collapse every topic, null). */
    open(n: number | null): void {
      chosen = true;
      setOpen(n);
    },
    /** The sync's list of topics: their titles and states, whatever the device keeps (SPEC §4.1). */
    topics(list: TopicMeta[]): void {
      synced.clear(); // the whole list, as the computer has it now
      for (const m of list) if (typeof m.topic === "number") synced.set(m.topic, m);
      invalidate();
    },
    /** Items in (live, synced, older history, the cache). */
    add(list: Item[]): void {
      for (const it of list) {
        if (typeof it.seq !== "number" || items.has(it.seq)) continue;
        items.set(it.seq, it);
        if (it.t === "topic" && it.state === "deleted" && typeof it.topic === "number") {
          // The person deleted it, here or on another device: its items go (SPEC §4.1).
          for (const [seq, x] of items) {
            if (x.topic !== it.topic || x.t === "topic") continue;
            items.delete(seq);
            els.delete(seq);
          }
          if (open === it.topic) {
            open = null;
            d.opened?.(null);
          }
        }
        if (it.t === "msg" && it.role === "me" && typeof it.cid === "string") {
          const p = pending.get(it.cid);
          pending.delete(it.cid); // echoed back
          // A message sent with every topic collapsed started a topic: it's the open one now.
          if (p && !p.topic && typeof it.topic === "number") {
            chosen = true;
            open = it.topic;
            d.opened?.(open);
          }
        }
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
      invalidate();
    },
    /** A message sent from here, until the computer echoes it back; `topic`: where it was sent (0: a new one). */
    sending(cid: string, el: HTMLElement, topic = 0): void {
      pending.set(cid, { el, topic });
      invalidate(true);
    },
    pendingEntries: () => [...pending.entries()].map(([cid, p]) => [cid, p.el] as [string, HTMLElement]),
    /** Make these items' elements again on the next draw (e.g. the accounts shown as labels changed). */
    remake(which: (it: Item) => boolean): void {
      for (const [seq, it] of items) if (which(it)) els.delete(seq);
      invalidate();
    },
    oldest: () => (items.size ? Math.min(...items.keys()) : Infinity),
  };
}
