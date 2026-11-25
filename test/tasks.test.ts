// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// The Tasks panel's words (SPEC §7.4): how often, how long idle.
import { describe, expect, it } from "vitest";
import { countWords, everyWords, idleLine, idleWords } from "../src/tasks";

describe("tasks panel", () => {
  it("says how often a task checks", () => {
    expect(everyWords(5 * 60)).toBe("Every 5 min");
    expect(everyWords(3600)).toBe("Every hour");
    expect(everyWords(4 * 3600)).toBe("Every 4 hours");
    expect(everyWords(86400)).toBe("Every day");
    expect(everyWords(2 * 86400)).toBe("Every 2 days");
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
