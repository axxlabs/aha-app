// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { describe, expect, it } from "vitest";
import type { Client, TraceEvent } from "../src/client";
import { stats } from "../src/client";
import { detailsLines, stepsSummary } from "../src/details";
import { statsLines } from "../src/stats";

const ev = (ts: string, kind: string, extra: Record<string, unknown> = {}) => ({ ts, kind, ...extra }) as TraceEvent;
const model = (ts: string, label = "") => ev(ts, "model", { model: "m", text: "", calls: label ? [{ name: "x", args: "{}", label }] : [] });
const tool = (ts: string, label: string) => ev(ts, "tool", { name: label.replace(" ", "_"), label, args: "{}", result: "ok" });

function fakeClient(online = true) {
  const sent: Record<string, unknown>[] = [];
  return { client: { computer: online, send: async (m: Record<string, unknown>) => (sent.push(m), true) } as unknown as Client, sent };
}

describe("Details line (SPEC §7.4)", () => {
  it("says what it used and how many steps, in the person's words", () => {
    expect(stepsSummary([model("1", "web search"), tool("2", "web search"), model("3", "browser"), tool("4", "browser"), model("5")])).toBe("web search, browser · 5 steps");
    expect(stepsSummary([model("1")])).toBe("1 step");
  });

  it("is live while the records come, and adds them as they happen when open", () => {
    const { client, sent } = fakeClient();
    const d = detailsLines(client);
    const el = d.line(7, "t1");
    const toggle = el.querySelector("button")!;
    const body = el.querySelector(".steps-body") as HTMLElement;
    expect(body.hidden).toBe(true);
    d.step("t1", model("a", "browser"));
    expect(el.classList.contains("live")).toBe(true);
    expect(el.textContent).toContain("browser · 1 step");
    toggle.click();
    expect(body.hidden).toBe(false);
    expect(sent).toEqual([{ t: "trace_request", seq: 7 }]); // the whole record so far, from the computer
    d.trace(7, [ev("0", "user", { text: "hi" }), model("a", "browser")]);
    d.step("t1", tool("b", "browser"));
    expect(body.querySelectorAll(".trace-row").length).toBe(3); // the record so far, then what came live
    d.idle();
    expect(el.classList.contains("live")).toBe(false);
    toggle.click();
    expect(body.hidden).toBe(true);
  });

  it("an earlier request's line, opened later, shows what the computer kept", () => {
    const { client } = fakeClient();
    const d = detailsLines(client);
    const el = d.line(3, "old");
    el.querySelector("button")!.click();
    d.trace(3, [model("a", "web search"), tool("b", "web search")]);
    expect(el.querySelectorAll(".trace-row").length).toBe(2);
    expect(el.textContent).toContain("web search · 2 steps");
  });
});

describe("Live diagnostics (SPEC §7.4)", () => {
  it("shows what the computer could read", () => {
    const s = stats({ t: "stats", cpu: { load: 23, temp: 54 }, mem: { used: 31.4, total: 125.7 }, gpu: { load: 60, temp: 55, mem: 14.1, mem_total: 15.9 } });
    expect(statsLines(s)).toEqual(["CPU 23% · 54°C · RAM 31.4/126 GB", "GPU 60% · 55°C · 14.1/15.9 GB"]);
    expect(statsLines(stats({ t: "stats", mem: { used: 2, total: 8 } }))).toEqual(["RAM 2.0/8.0 GB"]);
    expect(statsLines(stats({ t: "stats", cpu: { load: "x" }, gpu: { load: 1 } }))).toEqual([]); // not numbers: left out
  });
});
