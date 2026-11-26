// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// What Aha! did (SPEC §7.4): a box right above a request's answer, filled with each action as it happens (a message
// typed on a site, a fact saved, a task started or cancelled). While the request works it sits at the end of the
// chat, above "Aha! is working…" and under any card, and grows; when the answer comes, it's the first thing of
// the answer. The lines are the computer's record of the tool calls, never the model's words, so the box is drawn
// apart from them and has no title. It shows only once something was done; the person can collapse it. After a
// reload it's filled from the answer's `record`.
import { h } from "./dom";
import { receiptLines } from "./receipt";

export function actionBoxes() {
  const lines = new Map<string, string[]>(); // by request
  const drawn = new Map<string, () => void>(); // the answer's box, by request
  const collapsed = new Set<string>();
  const finished = new Set<string>(); // requests whose answer came: their box is the answer's now
  let current = ""; // the request whose actions are coming live

  function frame(task: () => string): { el: HTMLElement; redraw: () => void } {
    const list = h("ul", {});
    const count = h("span", { class: "acts-count" });
    const toggle = h("button", { type: "button", class: "acts-toggle", "aria-expanded": "true" }, h("span", { class: "chev", "aria-hidden": "true" }, "›"));
    const el = h("aside", { class: "acts", hidden: "", "aria-label": "What Aha! did" }, toggle, count, list);
    const redraw = () => {
      const t = task();
      const now = (t && lines.get(t)) || [];
      const shut = collapsed.has(t);
      el.hidden = !now.length;
      list.hidden = shut;
      count.hidden = !shut;
      count.textContent = `${now.length} action${now.length === 1 ? "" : "s"}`;
      toggle.setAttribute("aria-expanded", String(!shut));
      toggle.setAttribute("aria-label", shut ? "Show what Aha! did" : "Collapse what Aha! did");
      list.replaceChildren(...now.map((l) => h("li", {}, l)));
    };
    toggle.onclick = () => {
      const t = task();
      if (collapsed.has(t)) collapsed.delete(t);
      else collapsed.add(t);
      redraw();
    };
    return { el, redraw };
  }

  // The running request's box, at the end of the chat.
  const liveBox = frame(() => (finished.has(current) ? "" : current));

  return {
    /** The live box: the view keeps it last, above "Aha! is working…". */
    live: liveBox.el,
    /** Lines from a live record (`did` on a tool record). */
    add(task: string, did: unknown): void {
      const more = receiptLines(did);
      if (!task) return;
      current = task;
      if (more.length) lines.set(task, [...(lines.get(task) ?? []), ...more]);
      liveBox.redraw();
    },
    /** The request's answer came: the whole list from its `record`, and the box moves into the answer. */
    done(task: string, record: unknown): void {
      if (!task) return;
      const all = receiptLines(record);
      if (all.length) lines.set(task, all);
      finished.add(task);
      liveBox.redraw();
      drawn.get(task)?.();
    },
    /** The answer's own box, above its text. */
    box(task: string): HTMLElement {
      const b = frame(() => task);
      drawn.set(task, b.redraw);
      b.redraw();
      return b.el;
    },
  };
}
