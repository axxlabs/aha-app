// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { describe, expect, it } from "vitest";
import type { Item } from "../src/store";
import { chatView } from "../src/view";

const T = new Date(2026, 10, 24, 10, 0).getTime() / 1000;
let n = 0;
const me = (topic: number, ts: number, text: string, extra: Record<string, unknown> = {}) => ({ seq: ++n, ts, t: "msg", role: "me", text, topic, ...extra }) as Item;
const aha = (topic: number, ts: number, text: string) => ({ seq: ++n, ts, t: "msg", role: "aha", text, topic }) as Item;

function setup(now = T + 600, busyTopic = 0, waking = 0) {
  n = 0;
  const col = document.createElement("div");
  const scroller = document.createElement("main");
  const working = document.createElement("div");
  working.className = "working";
  const composer = document.createElement("form");
  composer.className = "composer-in";
  const footer = document.createElement("footer");
  const collapseAll = document.createElement("button");
  collapseAll.className = "collapse-all";
  const opened: (number | null)[] = [];
  let made = 0;
  const view = chatView({
    col,
    scroller,
    working,
    composer,
    footer,
    collapseAll,
    node: (it) => {
      if (it.t !== "msg" && it.t !== "approval") return null;
      made++;
      const el = document.createElement(it.t === "approval" ? "article" : "div");
      el.className = it.t === "approval" ? "card" : String(it.role);
      el.textContent = String(it.text ?? it.id);
      if (it.t === "approval") el.append(document.createElement("input"));
      return el;
    },
    resolve: () => undefined,
    dayLabel: (ts) => new Date(ts * 1000).toDateString(),
    busy: () => busyTopic > 0,
    busyTopic: () => busyTopic,
    waking: () => waking,
    opened: (x) => opened.push(x),
    now: () => now,
    frame: (fn) => fn(), // draw at once
  });
  /** What the chat shows: ▸title for a collapsed topic, ▾title for the open one, then its messages. */
  const shown = () =>
    [...col.querySelectorAll(".fold, .me, .aha, .card, .composer-in")].map((el) =>
      el.classList.contains("fold") ? `${el.classList.contains("open") ? "▾" : "▸"}${el.querySelector(".title")?.textContent}` : el.classList.contains("composer-in") ? "[composer]" : (el.textContent ?? ""),
    );
  return { col, view, shown, footer, composer, collapseAll, opened, made: () => made };
}

describe("the chat view (SPEC §4.1, §7.4)", () => {
  it("opens the topic going on, with the composer inside it; the bar at the bottom hides", () => {
    const { view, shown, footer } = setup();
    view.add([me(1, T - 3 * 3600, "old one"), aha(1, T - 3 * 3600 + 60, "done"), me(2, T, "order rice"), aha(2, T + 5, "ordered")]);
    expect(shown()).toEqual(["▸old one", "▾order rice", "order rice", "ordered", "[composer]"]);
    expect(view.opened()).toBe(2);
    expect(footer.hidden).toBe(true);
  });

  it("after a break nothing is open: the composer is at the bottom, for a new topic", () => {
    const { view, shown, footer, composer } = setup(T + 4 * 3600);
    view.add([me(1, T, "order rice"), aha(1, T + 5, "ordered")]);
    expect(shown()).toEqual(["▸order rice"]);
    expect(view.opened()).toBe(null);
    expect(footer.hidden).toBe(false);
    expect(composer.parentElement).toBe(footer);
  });

  it("[collapse all] is last in the chat while a topic is open, and only then", () => {
    const { view, col, collapseAll } = setup();
    view.add([me(1, T - 60, "first"), me(2, T, "second")]);
    expect(col.lastElementChild).toBe(collapseAll);
    view.open(null);
    expect(col.contains(collapseAll)).toBe(false);
  });

  it("one topic open at a time: opening one closes the other, and its line closes it", () => {
    const { view, shown, col } = setup();
    view.add([me(1, T - 60, "first"), me(2, T, "second")]);
    expect(view.opened()).toBe(2);
    (col.querySelector(".fold") as HTMLElement).click(); // topic 1's line
    expect(view.opened()).toBe(1);
    expect(shown()).toEqual(["▾first", "first", "[composer]", "▸second"]);
    (col.querySelector(".fold.open") as HTMLElement).click();
    expect(view.opened()).toBe(null);
  });

  it("a message sent with every topic collapsed opens the topic it started, once echoed", () => {
    const { view, opened } = setup(T + 4 * 3600);
    view.add([me(1, T, "old")]);
    const el = document.createElement("div");
    view.sending("c1", el, 0);
    view.add([me(2, T + 4 * 3600, "new thing", { cid: "c1" })]);
    expect(view.opened()).toBe(2);
    expect(opened.at(-1)).toBe(2);
  });

  it("a topic waiting on you is under Needs input, at the bottom, with its question", () => {
    const { view, col } = setup(T + 4 * 3600);
    view.add([me(1, T, "dinner with Natalia"), me(2, T + 60, "weather")]);
    view.add([{ seq: ++n, ts: T + 120, t: "topic", topic: 1, title: "Dinner", state: "waiting", question: "She offered 17:00. OK?" } as Item]);
    const heads = [...col.querySelectorAll(".day")].map((d) => d.textContent);
    expect(heads.at(-1)).toBe("Needs input");
    const last = [...col.querySelectorAll(".fold")].at(-1) as HTMLElement;
    expect(last.querySelector(".title")?.textContent).toBe("Dinner");
    expect(last.querySelector(".question")?.textContent).toBe("She offered 17:00. OK?");
    expect(last.querySelector(".state-icon.waiting")).not.toBeNull();
  });

  it("shows a scheduled topic's next wake on its line", () => {
    const { view, col } = setup(T + 4 * 3600);
    view.add([me(1, T, "parcel")]);
    view.topics([{ topic: 1, title: "Parcel", state: "scheduled", schedule: { waiting_for: "Parcel", prompt: "x", done_when: "delivered", every: 1800, next: T + 5 * 3600, checks: 2, paused: false } }]);
    expect(col.querySelector(".state-icon.scheduled")?.textContent).toMatch(/^⏱ \d/);
  });

  it("a card keeps its element (and what's typed) across draws", () => {
    const { view, col, made } = setup();
    const card = { seq: 0, ts: T + 10, t: "approval", id: "a1", text: "card", topic: 1 } as Item;
    const ask = me(1, T, "book it");
    card.seq = ++n;
    view.add([ask, card]);
    const input = col.querySelector("input") as HTMLInputElement;
    input.value = "typed";
    const count = made();
    view.add([aha(1, T + 20, "more")]);
    expect(col.querySelector("input")).toBe(input);
    expect(input.value).toBe("typed");
    expect(made()).toBe(count + 1); // only the new item's element was made
  });

  it("a deleted topic goes, with its messages; the one going on before it opens instead", () => {
    const { view, shown } = setup();
    view.add([me(1, T - 60, "keep"), me(2, T, "gone")]);
    expect(view.opened()).toBe(2);
    view.add([{ seq: ++n, ts: T + 5, t: "topic", topic: 2, title: "", state: "deleted" } as Item]);
    expect(shown()).toEqual(["▾keep", "keep", "[composer]"]);
    expect(view.opened()).toBe(1);
  });

  it("a topic that woke up on its own shows moving dots on its line, and nothing else changes", () => {
    const { view, col, footer } = setup(T + 4 * 3600, 0, 1);
    view.add([me(1, T, "parcel"), me(2, T + 60, "weather")]);
    const line = [...col.querySelectorAll(".fold")].find((l) => l.querySelector(".title")?.textContent === "parcel");
    expect(line?.querySelector(".state-icon.running")).not.toBeNull();
    expect(col.querySelector(".working")).toBeNull();
    expect(footer.hidden).toBe(false);
  });

  it("drops what's before the history's start", () => {
    const { view, col } = setup();
    view.add([me(1, T, "old")]);
    view.dropBefore(100);
    expect(col.querySelectorAll(".fold, [data-seq]").length).toBe(0);
  });

  it("remake draws chosen items again (labels after the accounts arrive)", () => {
    const { view, col } = setup();
    view.add([aha(1, T, "in fe@example.com")]);
    const before = col.querySelector("[data-seq]");
    view.remake((it) => it.role === "aha");
    expect(col.querySelector("[data-seq]")).not.toBe(before);
  });
});
