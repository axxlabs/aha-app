// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { describe, expect, it } from "vitest";
import { dayWords, gist, groups, topicsOf } from "../src/fold";
import type { Item } from "../src/store";

const T = new Date(2026, 10, 24, 9, 0).getTime() / 1000; // 24 Nov, 09:00 local
const min = 60;
let n = 0;
const me = (topic: number, ts: number, text = "hello there") => ({ seq: ++n, ts, t: "msg", role: "me", text, topic }) as Item;
const aha = (topic: number, ts: number, text = "ok") => ({ seq: ++n, ts, t: "msg", role: "aha", text, topic }) as Item;
const meta = (topic: number, extra: Record<string, unknown> = {}) => ({ seq: ++n, ts: T, t: "topic", topic, title: "", state: "", ...extra }) as Item;

describe("topics (SPEC §4.1)", () => {
  it("orders topics by their last message, titled by the computer or by the first words", () => {
    n = 0;
    const items = [me(1, T, "where is my evri parcel"), aha(1, T + min), me(2, T + 10 * min, "weather in Lisbon?"), aha(2, T + 11 * min), meta(2, { title: "Lisbon weather" })];
    expect(topicsOf(items, new Map(), new Set()).map((t) => [t.n, t.title])).toEqual([
      [1, "where is my evri parcel"],
      [2, "Lisbon weather"],
    ]);
    // A new message in topic 1 moves it to the end.
    items.push(me(1, T + 30 * min, "and when?"));
    expect(topicsOf(items, new Map(), new Set()).map((t) => t.n)).toEqual([2, 1]);
  });

  it("takes the latest topic item, over the sync's list", () => {
    n = 0;
    const synced = new Map([[1, { topic: 1, title: "Old", state: "scheduled" }]]);
    const items = [me(1, T), meta(1, { title: "Parcel", state: "done" })];
    const [t] = topicsOf(items, synced, new Set());
    expect([t.title, t.state]).toEqual(["Parcel", "done"]);
    expect(topicsOf([me(1, T)], synced, new Set())[0].state).toBe("scheduled");
  });

  it("puts the topics waiting on the person under Needs input, last: a question, or a card not answered", () => {
    n = 0;
    const card = { seq: 0, ts: T + 2 * min, t: "approval", id: "c1", topic: 2 } as Item;
    const items = [me(1, T), meta(1, { state: "waiting", question: "Which day?" }), me(2, T + min)];
    card.seq = ++n;
    items.push(card, me(3, T + 3 * min));
    const list = topicsOf(items, new Map(), new Set());
    const g = groups(list, () => "Today");
    expect(g.map((x) => [x.label, x.topics.map((t) => t.n)])).toEqual([
      ["Today", [3]],
      ["Needs input", [1, 2]],
    ]);
    expect(list.find((t) => t.n === 1)?.question).toBe("Which day?");
    // The card answered: topic 2 goes back to its day.
    const answered = topicsOf(items, new Map(), new Set(["c1"]));
    expect(groups(answered, () => "Today")[0].topics.map((t) => t.n)).toEqual([2, 3]);
  });

  it("groups by the day of the last message", () => {
    n = 0;
    const day = 24 * 60 * min;
    const list = topicsOf([me(1, T - day), me(2, T - day + min), me(3, T)], new Map(), new Set());
    expect(groups(list, (ts) => (ts < T - 60 ? "Yesterday" : "Today")).map((g) => [g.label, g.topics.length])).toEqual([
      ["Yesterday", 2],
      ["Today", 1],
    ]);
  });

  it("gives a result's gist: plain words, cut at a word", () => {
    expect(gist("**Sam replied**: see [the email](https://x.y/z).\n\n# More")).toBe("Sam replied: see the email. More");
    expect(gist("one two three four", 12)).toBe("one two…");
  });
});

describe("day headings (SPEC §7.4 \"Folding\")", () => {
  it("says Today, Yesterday, Last week with the date, then the date", () => {
    const day = 24 * 60 * min;
    expect(dayWords(T, T + 5 * 60 * min)).toBe("Today");
    expect(dayWords(T - 9 * 60 * min - 1, T)).toBe("Yesterday"); // a second before midnight is another day
    expect(dayWords(T - 2 * day, T, "plain")).toBe("Last week · 22 Nov 2026");
    expect(dayWords(T - 6 * day, T, "plain")).toBe("Last week · 18 Nov 2026");
    expect(dayWords(T - 7 * day, T, "plain")).toBe("17 Nov 2026");
  });
});
