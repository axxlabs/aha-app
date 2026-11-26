// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// The receipt under an answer (SPEC §7.4 "Receipt"): the computer's record, kept only when well formed.
import { describe, expect, it } from "vitest";
import { receiptLines } from "../src/receipt";

describe("receipt", () => {
  it("keeps the computer's lines, and nothing else", () => {
    expect(receiptLines(["Started the background task “Reply from Natalia”", "", 5, null, "Cancelled it"])).toEqual([
      "Started the background task “Reply from Natalia”",
      "Cancelled it",
    ]);
    expect(receiptLines(undefined)).toEqual([]);
    expect(receiptLines("x")).toEqual([]);
    expect(receiptLines(["a".repeat(400)])[0].length).toBe(300);
  });
});
