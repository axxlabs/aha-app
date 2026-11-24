// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { describe, expect, it } from "vitest";
import { plan } from "../src/fold";
import type { Item } from "../src/store";

const T = new Date(2026, 10, 24, 9, 0).getTime() / 1000; // 24 Nov, 09:00 local
const min = 60;
let n = 0;
const me = (ts: number, text = "hello there") => ({ seq: ++n, ts, t: "msg", role: "me", text }) as Item;
const aha = (ts: number, text = "ok", open?: string) => ({ seq: ++n, ts, t: "msg", role: "aha", text, ...(open ? { open } : {}) }) as Item;

describe("folding after a break (SPEC §7.4)", () => {
  it("folds parts before a break, keeps the one going on, and titles from the computer or the first words", () => {
    n = 0;
    const a = [me(T, "order laundry liquid from Waitrose please now, thanks"), aha(T + 5 * min)];
    const title = { seq: ++n, ts: T + 6 * min, t: "title", from: a[0].seq, text: "Waitrose order" } as Item;
    const b = [me(T + 3 * 60 * min, "what's on Friday"), aha(T + 3 * 60 * min + min)];
    const parts = plan([...a, title, ...b], new Set(), T + 3 * 60 * min + 2 * min);
    expect(parts.map((p) => [p.title, p.folded])).toEqual([
      ["Waitrose order", true],
      ["what's on Friday", false], // still going on: no title shown, not folded
    ]);
    const later = plan([...a, ...b], new Set(), T + 6 * 60 * min);
    expect(later.map((p) => [p.title, p.folded])).toEqual([
      ["order laundry liquid from Waitrose please now…", true],
      ["what's on Friday", true], // after the break the canvas is empty
    ]);
    expect(plan([...a, ...b], new Set(), T + 6 * 60 * min, true)[1].folded).toBe(false); // still working on it
  });

  it("a new day is a break", () => {
    n = 0;
    const night = new Date(2026, 10, 24, 23, 50).getTime() / 1000;
    const parts = plan([me(night), aha(night + 20 * min)], new Set(), night + 25 * min);
    expect(parts.length).toBe(2);
  });

  it("keeps unfinished things open: a waiting card, a question, a stopped task, with what was asked", () => {
    n = 0;
    const ask = me(T, "book Flat Iron");
    const card = { seq: ++n, ts: T + min, t: "approval", id: "a1" } as Item;
    const q = aha(T + 2 * min, "Which time?", "asks");
    const later = T + 5 * 60 * min;
    let [p] = plan([ask, card, q], new Set(), later);
    expect(p.folded && [...p.open].sort()).toEqual([ask.seq, card.seq, q.seq].sort());
    [p] = plan([ask, card, q], new Set(["a1"]), later); // the card was answered
    expect([...p.open]).toEqual([q.seq]);
    const reply = me(T + 3 * min, "8pm");
    [p] = plan([ask, card, q, reply], new Set(["a1"]), later); // the question was answered
    expect(p.open.size).toBe(0);
    const stopped = aha(T + 4 * min, "Aha! is restarting…", "stopped");
    [p] = plan([ask, card, q, reply, stopped], new Set(["a1"]), later);
    expect([...p.open].sort()).toEqual([reply.seq, stopped.seq].sort()); // with what it was doing
  });

  it("a cut folds the part going on at once, even while working; the next message starts a new part", () => {
    n = 0;
    const a = [me(T, "flights to Lisbon"), aha(T + min, "Here are three")];
    const cut = { seq: ++n, ts: T + 2 * min, t: "cut" } as Item;
    let parts = plan([...a, cut], new Set(), T + 3 * min, true);
    expect(parts.length).toBe(1);
    expect(parts[0].folded).toBe(true);
    const next = me(T + 4 * min, "what's on Friday");
    parts = plan([...a, cut, next], new Set(), T + 5 * min);
    expect(parts.map((p) => p.folded)).toEqual([true, false]);
  });
});
