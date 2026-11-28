// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Memory (SPEC §5.4, §7.4): what sha keeps between conversations, in a panel of its own. The facts the person
// approved about themselves, and sha's memory of each topic, newest first, each with Forget.
import type { Client } from "./client";
import { ICONS, h, icon, openSheet } from "./dom";
import { formatDate } from "./markdown";

export interface Fact {
  id: string;
  text: string;
}
export interface Topic {
  id: string;
  title: string;
  text: string;
  ts: number;
}
export interface MemoryUi {
  close(): void;
  show(facts: Fact[], topics: Topic[]): void;
}

export function openMemory(client: Client, onClose: () => void): MemoryUi {
  const offline = () => h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline.");
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon(ICONS.close));
  const facts = h("div", { class: "facts" }, offline());
  const topics = h("div", { class: "topics" }, offline());
  const search = h("input", { type: "search", placeholder: "Search topics", "aria-label": "Search topics", autocapitalize: "off" }) as HTMLInputElement;
  const count = h("small", {});
  const content = h(
    "div",
    { class: "sheet-in memory" },
    h("header", {}, h("h2", {}, "Memory"), close),
    h("p", { class: "fine" }, "What sha keeps between conversations, on your computer. To change something, tell sha in the chat."),
    h("section", {}, h("h4", {}, "About you"), facts),
    h("section", {}, h("div", { class: "topics-head" }, h("h4", {}, "Topics ", count), search), topics),
  );
  const { shut } = openSheet("Memory", content, onClose);
  close.onclick = shut;

  const forgetButton = (id: string, what: string) => {
    const b = h("button", { class: "forget", type: "button", "aria-label": `Forget ${what}`, title: "Forget" }, icon(ICONS.close));
    b.onclick = async () => {
      if (!confirm(`Forget ${what}?`)) return;
      b.setAttribute("disabled", "");
      if (!(await client.send({ t: "memory_forget", id }))) b.removeAttribute("disabled");
    };
    return b;
  };

  let shown: Topic[] = [];
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const list = q ? shown.filter((t) => `${t.title}\n${t.text}`.toLowerCase().includes(q)) : shown;
    topics.replaceChildren(
      ...(list.length
        ? list.map((t) =>
            h(
              "article",
              { class: "topic" },
              h(
                "header",
                {},
                h("div", {}, h("b", {}, t.title || "Untitled"), h("time", {}, t.ts ? formatDate(new Date(t.ts * 1000), client.settings.dates) : "Earlier")),
                forgetButton(t.id, `what sha remembers of “${t.title || "this topic"}”`),
              ),
              h("p", {}, t.text),
            ),
          )
        : [h("p", { class: "fine" }, q ? "No topic matches." : "Nothing yet. After each conversation, sha notes what matters here.")]),
    );
  };
  search.oninput = draw;
  void client.send({ t: "memories_request" });

  return {
    close: shut,
    show(list, entries) {
      facts.replaceChildren(
        ...(list.length
          ? list.map((m) => h("div", { class: "fact" }, h("span", {}, m.text), forgetButton(m.id, `“${m.text}”`)))
          : [h("p", { class: "fine" }, "Nothing yet. sha asks before it saves something about you.")]),
      );
      shown = entries;
      count.textContent = entries.length ? String(entries.length) : "";
      draw();
    },
  };
}
