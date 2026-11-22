// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { describe, expect, it } from "vitest";
import { MAX_TAPS, checkButton, tapOnImage, tapsValue } from "../src/taps";

describe("a check card's taps (SPEC §3.4, §5.3)", () => {
  const rect = { left: 10, top: 20, width: 640, height: 406.5 }; // a 1280×813 screenshot shown at half size
  const natural = { width: 1280, height: 813 };
  it("are in the screenshot's own pixels", () => {
    expect(tapOnImage(10, 20, rect, natural)).toEqual({ x: 0, y: 0 });
    expect(tapOnImage(330, 223.25, rect, natural)).toEqual({ x: 640, y: 406 });
    expect(tapOnImage(649.9, 426.4, rect, natural)).toEqual({ x: 1279, y: 812 });
  });
  it("outside the screenshot are no taps", () => {
    expect(tapOnImage(9, 30, rect, natural)).toBeNull();
    expect(tapOnImage(650, 30, rect, natural)).toBeNull();
    expect(tapOnImage(20, 30, { ...rect, width: 0 }, natural)).toBeNull();
  });
  it("travel as x,y;x,y, at most 20, and name the button", () => {
    expect(tapsValue([{ x: 1, y: 2 }, { x: 30, y: 40 }])).toBe("1,2;30,40");
    expect(tapsValue([])).toBe("");
    expect(tapsValue(Array.from({ length: 30 }, () => ({ x: 1, y: 1 }))).split(";").length).toBe(MAX_TAPS);
    expect(checkButton([])).toBe("It's done");
    expect(checkButton([{ x: 1, y: 1 }])).toBe("Send 1 tap");
    expect(checkButton([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe("Send 2 taps");
  });
});
