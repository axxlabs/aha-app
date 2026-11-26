// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { describe, expect, it } from "vitest";
import type { Item } from "../src/store";
import { chatView } from "../src/view";

const T = new Date(2026, 10, 24, 10, 0).getTime() / 1000;
let n = 0;
const me = (ts: number, text: string) => ({ seq: ++n, ts, t: "msg", role: "me", text }) as Item;
const aha = (ts: number, text: string, extra: Record<string, unknown> = {}) => ({ seq: ++n, ts, t: "msg", role: "aha", text, ...extra }) as Item;

function setup(now = T + 600) {
  n = 0;
  const col = document.createElement("div");
  const scroller = document.createElement("main");
  const working = document.createElement("div");
  working.className = "working";
  let made = 0;
  const view = chatView({
    col,
    scroller,
    working,
    node: (it) => {
      if (it.t !== "msg" && it.t !== "approval") return null;
      made++;
      const el = document.createElement(it.t === "approval" ? "article" : "div");
      el.className = it.t === "approval" ? "card" : String(it.role);
      el.textContent = String(it.text ?? it.id);
      if (it.t === "approval") el.append(document.createElement("input"));
      return el;
    },
    resolve: (it, st) => it.t === "approval" && document.body && void 0,
    dayLabel: (ts) => new Date(ts * 1000).toDateString(),
    busy: () => false,
    now: () => now,
    frame: (fn) => fn(), // draw at once
  });
  const shown = () => [...col.children].map((el) => (el.className === "fold" ? `▸${el.querySelector(".title")?.textContent}` : el.className === "day" ? "day" : el.textContent ?? "")).filter((x) => x !== "day" && x !== "");
  return { col, view, shown, made: () => made };
}

describe("the chat view (SPEC §7.4)", () => {
  it("folds the part before a new subject as soon as its title arrives, live", () => {
    const { view, shown } = setup();
    const a = [me(T, "order rice"), aha(T + 5, "done")];
    view.add(a);
    view.add([{ seq: ++n, ts: T + 6, t: "title", from: a[0].seq, text: "Rice order" } as Item]);
    expect(shown()).toEqual(["order rice", "done"]); // still going on: no fold
    const b = [me(T + 60, "new topic: who is X"), aha(T + 65, "X is …")];
    view.add(b);
    expect(shown()).toEqual(["order rice", "done", "new topic: who is X", "X is …"]); // no title yet: one part
    view.add([{ seq: ++n, ts: T + 66, t: "title", from: b[0].seq, text: "Who is X", new: true } as Item]);
    expect(shown()).toEqual(["▸Rice order", "new topic: who is X", "X is …"]); // folded the moment it arrived
  });

  it("heads each day's topics with the day, once, and each line has its title and time apart", () => {
    const { view, col } = setup(T + 2 * 86400);
    view.add([me(T, "first"), aha(T + 60, "a"), me(T + 3 * 3600, "second"), aha(T + 3 * 3600 + 60, "b"), me(T + 86400, "third")]);
    const order = [...col.children].map((el) => el.className);
    expect(order).toEqual(["day", "fold", "fold", "day", "fold", "working"]);
    const line = col.querySelector(".fold") as HTMLElement;
    expect(line.querySelector(".title")?.textContent).toBe("first");
    expect(line.querySelector("time")?.textContent).toMatch(/10:00|10:00\s?AM/);
  });

  it("[collapse all] shows while a folded topic is open, and folds them all again", () => {
    const { view, col } = setup(T + 2 * 86400);
    view.add([me(T, "first"), aha(T + 60, "a"), me(T + 3 * 3600, "second"), aha(T + 3 * 3600 + 60, "b")]);
    expect(col.querySelectorAll(".fold").length).toBe(2);
    (col.querySelector(".fold") as HTMLButtonElement).click();
    expect([...col.children].some((el) => el.textContent === "a")).toBe(true);
    view.collapseAll();
    expect([...col.children].some((el) => el.textContent === "a")).toBe(false);
  });

  it("clearing history leaves nothing behind: no fold lines, no days", () => {
    const { view, col, shown } = setup(T + 7 * 3600);
    view.add([me(T, "old"), aha(T + 5, "old answer"), me(T + 4 * 3600, "later"), aha(T + 4 * 3600 + 5, "later answer")]);
    expect(shown()).toEqual(["▸old", "▸later"]);
    view.dropBefore(100);
    expect(shown()).toEqual([]);
    expect(col.querySelectorAll(".fold, .day, [data-seq]").length).toBe(0);
  });

  it("opening a fold line shows its part; a card keeps its element (and what's typed) across draws", () => {
    const { view, col, shown, made } = setup(T + 5 * 3600);
    const card = { seq: 0, ts: T + 10, t: "approval", id: "a1", text: "card" } as Item;
    const ask = me(T, "book it");
    card.seq = ++n;
    view.add([ask, card]);
    expect(shown()).toEqual(["▸book it", "book it", "card"]); // folded, but the card waiting for you stays open
    const input = col.querySelector("input") as HTMLInputElement;
    input.value = "typed";
    (col.querySelector(".fold") as HTMLButtonElement).click();
    expect(col.querySelector("input")).toBe(input);
    expect(input.value).toBe("typed");
    const count = made();
    view.add([aha(T + 5 * 3600 - 10, "unrelated")]);
    expect(made()).toBe(count + 1); // only the new item's element was made
  });

  it("remake draws chosen items again (labels after the accounts arrive)", () => {
    const { view, col } = setup();
    view.add([aha(T, "in fe@example.com")]);
    const before = col.querySelector("[data-seq]");
    view.remake((it) => it.role === "aha");
    expect(col.querySelector("[data-seq]")).not.toBe(before);
  });
});
