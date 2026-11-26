// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// What Aha! did (SPEC §7.4): a box where a request's work starts, filled with each action as it happens (a message
// typed on a site, a fact saved, a task started or cancelled), before the answer. The lines are the computer's
// record of the tool calls, never the model's words, so the box is drawn apart from them and has no title. It
// shows only once something was done; the person can collapse it. After a reload it's filled from the answer's
// `record`.
import { h } from "./dom";
import { receiptLines } from "./receipt";

export function actionBoxes() {
  const lines = new Map<string, string[]>(); // by request
  const drawn = new Map<string, () => void>(); // its box, redrawn when lines come
  const collapsed = new Set<string>();

  const draw = (task: string) => drawn.get(task)?.();

  return {
    /** Lines from a live record (`did` on a tool record). */
    add(task: string, did: unknown): void {
      const more = receiptLines(did);
      if (!task || !more.length) return;
      lines.set(task, [...(lines.get(task) ?? []), ...more]);
      draw(task);
    },
    /** The whole list, from the request's answer (`record`): what the computer kept wins over what came live. */
    fill(task: string, record: unknown): void {
      const all = receiptLines(record);
      if (!task || !all.length) return;
      lines.set(task, all);
      draw(task);
    },
    box(task: string): HTMLElement {
      const list = h("ul", {});
      const count = h("span", { class: "acts-count" });
      const toggle = h("button", { type: "button", class: "acts-toggle", "aria-expanded": "true", "aria-label": "Collapse what Aha! did" }, h("span", { class: "chev", "aria-hidden": "true" }, "›"));
      const el = h("aside", { class: "acts", hidden: "", "aria-label": "What Aha! did" }, toggle, count, list);
      const redraw = () => {
        const now = lines.get(task) ?? [];
        el.hidden = !now.length;
        const shut = collapsed.has(task);
        list.hidden = shut;
        count.hidden = !shut;
        count.textContent = `${now.length} action${now.length === 1 ? "" : "s"}`;
        toggle.setAttribute("aria-expanded", String(!shut));
        toggle.setAttribute("aria-label", shut ? "Show what Aha! did" : "Collapse what Aha! did");
        list.replaceChildren(...now.map((l) => h("li", {}, l)));
      };
      toggle.onclick = () => {
        if (collapsed.has(task)) collapsed.delete(task);
        else collapsed.add(task);
        redraw();
      };
      drawn.set(task, redraw);
      redraw();
      return el;
    },
  };
}
