// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// The Tasks panel's words (SPEC §7.4): how often, how long idle.
import { describe, expect, it } from "vitest";
import { countWords, everyWords, fromLocalInput, idleLine, idleWords, lastHow, nextWords, runningCards, startedMarks, toLocalInput } from "../src/tasks";

describe("tasks panel", () => {
  it("says how often a task checks", () => {
    expect(everyWords(5 * 60)).toBe("Every 5 min");
    expect(everyWords(3600)).toBe("Every hour");
    expect(everyWords(4 * 3600)).toBe("Every 4 hours");
    expect(everyWords(86400)).toBe("Every day");
    expect(everyWords(2 * 86400)).toBe("Every 2 days");
  });

  it("says when the next check is, Run now included", () => {
    const when = () => "14:35";
    expect(nextWords({ next: 2000 }, 1000, when)).toBe("Next check 14:35");
    expect(nextWords({ next: 900 }, 1000, when)).toBe("At the next idle time");
    expect(nextWords({ next: 2000, now: true }, 1000, when)).toBe("As soon as Aha! is free · then 14:35");
    expect(nextWords({ next: 2000, running: true }, 1000, when)).toBe("Checking now · then 14:35");
    expect(nextWords({ next: 900, running: true }, 1000, when)).toBe("Checking now");
  });

  it("turns times into the edit form's inputs and back", () => {
    const epoch = Math.round(new Date(2026, 10, 28, 18, 5).getTime() / 1000);
    expect(toLocalInput(epoch)).toBe("2026-11-28T18:05");
    expect(fromLocalInput("2026-11-28T18:05")).toBe(epoch);
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("not a time")).toBeNull();
  });

  it("says how the last check ended", () => {
    expect(lastHow("waiting")).toBe("");
    expect(lastHow("notify")).toBe(" · sent to you");
    expect(lastHow("ended_early")).toBe(" · ended early");
    expect(lastHow(undefined)).toBe("");
  });

  it("counts checks and the updates sent", () => {
    expect(countWords(1, 0)).toBe("1 check so far");
    expect(countWords(5, 2)).toBe("5 checks, 2 updates sent");
    expect(countWords(3, 1)).toBe("3 checks, 1 update sent");
  });

  it("says how long Aha! has been idle, or that it's working", () => {
    expect(idleWords(30)).toBe("less than a minute");
    expect(idleWords(12 * 60 + 5)).toBe("12 min");
    expect(idleWords(125 * 60)).toBe("2 h 5 min");
    expect(idleLine({ idle_since: 1000, idle_after: 300, busy: false }, 1000 + 720)).toBe("Idle for 12 min · checks run after 5 min idle");
    expect(idleLine({ idle_since: 1000, idle_after: 300, busy: true }, 5000)).toMatch(/^Working on a request/);
  });
});

describe("a topic's started tasks", () => {
  const states = new Map([["a", "approved"], ["b", "approved"], ["c", "declined"], ["d", "approved"], ["e", "approved"]]);
  const ids = (m: Map<string, unknown> | null) => [...(m?.keys() ?? [])].sort();
  it("says which still run, which ended, and nothing for a declined card or before the list came", () => {
    const started = [{ id: "a", ts: 100 }, { id: "b", ts: 200 }, { id: "c", ts: 300 }];
    const task = { card: "a", created: 110 };
    const running = runningCards(started, states, [task]);
    expect(running?.get("a")).toBe(task);
    expect(startedMarks(started, states, running)).toEqual([
      { running: true, cards: [started[0]] },
      { running: false, cards: [started[1]] },
    ]);
    expect(startedMarks(started, states, runningCards(started, states, []))).toEqual([{ running: false, cards: [started[0], started[1]] }]);
    expect(startedMarks(started, states, runningCards(started, states, null))).toEqual([]);
  });
  it("gives each older task (no card kept) one card only: the last approved before it", () => {
    const cards = [{ id: "b", ts: 1000 }, { id: "c", ts: 1500 }, { id: "d", ts: 2000 }, { id: "e", ts: 3000 }];
    expect(ids(runningCards(cards, states, [{ created: 2030 }]))).toEqual(["d"]); // not every card in the six hours
    expect(ids(runningCards(cards, states, [{ created: 2030 }, { created: 2040 }]))).toEqual(["b", "d"]); // c was declined
    expect(ids(runningCards(cards, states, [{ card: "e", created: 3010 }, { created: 3020 }]))).toEqual(["d", "e"]);
    expect(runningCards(cards, states, [{ created: 3000 + 7 * 3600 }])?.size).toBe(0);
  });
});

