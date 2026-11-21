// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// The Aha! app (SPEC §7.4): one GPT-style conversation with your own computer, end-to-end encrypted.

import "./style.css";
import { THEMES, applyTheme } from "./themes";
import { APP_VERSION, Client, DEFAULT_SETTINGS, type Identity, type Settings, pair, parsePairLink } from "./client";
import { Ratchet, type RatchetState, b64urlDecode } from "./crypto";
import { render } from "./markdown";
import { type Item, Store } from "./store";

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";

const app = document.getElementById("app") as HTMLElement;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = path; // static, from this file only
  return svg;
}

const ICONS = {
  send: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  menu: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
};

function mark(): HTMLElement {
  return h("div", { class: "mark", "aria-label": "Aha!" }, h("span", {}, "ah"), h("span", { class: "a" }, "a"));
}

function screen(...children: (Node | string)[]): HTMLElement {
  app.replaceChildren(h("div", { class: "screen" }, ...children));
  return app;
}

// ---- boot

async function boot(): Promise<void> {
  if (!window.isSecureContext || !crypto.subtle) {
    screen(mark(), h("h1", {}, "Secure connection needed"), h("p", {}, "Open Aha! over https (or on this computer at localhost)."));
    return;
  }
  const store = await Store.open();
  applyTheme((await store.get<Settings>("settings"))?.theme);
  if (location.hash.startsWith("#pair=")) return pairingScreen(store);
  const identity = await store.get<Identity>("identity");
  if (!identity) return welcomeScreen();
  return chat(store, identity);
}

function welcomeScreen(): void {
  screen(
    mark(),
    h("h1", {}, "Aha! Your private agent."),
    h("p", {}, "To use Aha!, pair this device with your own computer: run ", h("code", {}, "aha pair <your name>"), " there and scan the QR code it shows."),
    h("p", { class: "fine" }, `Messages are end-to-end encrypted between this device and your computer. Version ${APP_VERSION} (${BUILD}).`),
  );
}

async function pairingScreen(store: Store): Promise<void> {
  let data;
  try {
    data = parsePairLink(location.hash);
  } catch (e) {
    history.replaceState(null, "", location.pathname);
    screen(mark(), h("h1", {}, "That link doesn't work"), h("p", { class: "error" }, String((e as Error).message)));
    return;
  }
  // The secret must not stay in the address bar or the history.
  history.replaceState(null, "", location.pathname);
  const existing = await store.get<Identity>("identity");
  const button = h("button", { class: "primary", type: "button" }, `Pair with ${data.home} as ${data.name}`);
  const nameInput = h("input", { type: "text", maxlength: "60", value: defaultName(), "aria-label": "Name of this device" }) as HTMLInputElement;
  const msg = h("p", {});
  screen(
    mark(),
    h("h1", {}, `Hi ${data.name}`),
    h("p", {}, `This connects this device to Aha! on “${data.home}”. Everything you write is end-to-end encrypted to that computer.`),
    existing ? h("p", { class: "error" }, "This device is already paired; pairing again replaces it.") : "",
    h("p", { class: "fine" }, `Through the gateway ${new URL(data.gw).host}. Only pair with a QR code your own computer showed you.`),
    h("label", { class: "fine" }, "Name of this device"),
    nameInput,
    button,
    msg,
  );
  button.onclick = async () => {
    button.setAttribute("disabled", "");
    msg.textContent = "Pairing…";
    try {
      const { identity, ratchet } = await pair(data, nameInput.value.trim() || defaultName());
      await store.put("identity", identity);
      await store.put("ratchet", ratchet.toJSON());
      await store.put("settings", DEFAULT_SETTINGS);
      await store.put("last", 0);
      await store.clearItems();
      await chat(store, identity);
    } catch (e) {
      button.removeAttribute("disabled");
      msg.className = "error";
      msg.textContent = (e as Error).message;
    }
  };
}

function defaultName(): string {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "Computer";
}

// ---- the chat

async function chat(store: Store, identity: Identity): Promise<void> {
  const state = await store.get<RatchetState>("ratchet");
  if (!state) return welcomeScreen();
  const ratchet = Ratchet.fromJSON(state);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...((await store.get<Settings>("settings")) ?? {}) };

  // One tab at a time uses the ratchet (SPEC §6.3).
  if ("locks" in navigator) {
    const got = await new Promise<boolean>((resolve) => {
      void navigator.locks.request("aha-session", { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        return lock ? new Promise(() => {}) : undefined;
      });
    });
    if (!got) {
      screen(mark(), h("h1", {}, "Aha! is open in another tab"), h("p", {}, "Use that tab, or close it and reload this one."));
      return;
    }
  }

  const statusText = h("b", {});
  const dot = h("span", { class: "dot" });
  const statusBox = h("div", { class: "status" }, h("span", {}, dot, statusText), h("span", { class: "lock" }, icon(ICONS.lock), " End-to-end encrypted"));
  const menu = h("button", { class: "icon-btn", type: "button", "aria-label": "Settings" }, icon(ICONS.menu));
  const banner = h("div", { class: "banner", hidden: "" });
  const col = h("div", { class: "col" });
  const scroller = h("main", { class: "chat" }, col);
  const working = h("div", { class: "working", hidden: "", role: "status" }, h("i"), h("i"), h("i"), " Aha! is working…");
  const input = h("textarea", { rows: "1", placeholder: "Ask Aha! anything", "aria-label": "Message", maxlength: "20000" }) as HTMLTextAreaElement;
  const sendBtn = h("button", { class: "send", type: "submit", "aria-label": "Send" }, icon(ICONS.send));
  const form = h("form", {}, input, sendBtn);
  app.replaceChildren(
    h("header", { class: "top" }, mark(), h("div", { class: "right" }, statusBox, menu)),
    banner,
    scroller,
    h("footer", { class: "composer" }, form),
  );

  const items = new Map<number, Item>();
  const cards = new Map<string, { el: HTMLElement; resolved: boolean }>();
  const pending = new Map<string, HTMLElement>();
  let busy = false;
  let lastDay = "";
  let oldest = Infinity;

  const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const toBottom = () => (scroller.scrollTop = scroller.scrollHeight);

  function dayLabel(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function node(it: Item): HTMLElement | null {
    if (it.t === "msg" && it.role === "me") return h("div", { class: "me" }, String(it.text ?? ""));
    if (it.t === "msg") {
      const el = h("div", { class: "aha" });
      el.innerHTML = render(String(it.text ?? "")); // markdown-it with html disabled (src/markdown.ts)
      const img = it.image as { mime?: string; b64?: string } | undefined;
      if (img && /^image\/(png|jpeg|webp)$/.test(img.mime ?? "")) el.append(h("img", { class: "shot", alt: "Screenshot", src: `data:${img.mime};base64,${img.b64}` }));
      return el;
    }
    if (it.t === "approval") return approvalCard(it);
    return null;
  }

  function place(it: Item, where: "end" | "start"): void {
    if (items.has(it.seq)) return;
    items.set(it.seq, it);
    oldest = Math.min(oldest, it.seq);
    if (it.t === "approval_state") return applyState(String(it.id), String(it.state));
    if (it.t === "msg" && it.role === "me" && typeof it.cid === "string" && pending.has(it.cid)) {
      pending.get(it.cid)?.remove();
      pending.delete(it.cid);
    }
    const el = node(it);
    if (!el) return;
    el.dataset.seq = String(it.seq);
    if (where === "start") {
      col.insertBefore(el, col.querySelector("[data-seq]"));
      return;
    }
    const day = dayLabel(it.ts);
    if (day !== lastDay) {
      col.append(h("div", { class: "day" }, day));
      lastDay = day;
    }
    // keep sequence order even if items arrive out of order
    const after = [...col.querySelectorAll<HTMLElement>("[data-seq]")].find((x) => Number(x.dataset.seq) > it.seq);
    if (after) col.insertBefore(el, after);
    else col.append(el);
    col.append(working);
  }

  function approvalCard(it: Item): HTMLElement {
    const id = String(it.id);
    const fields = (it.fields as { label: string; value: string; editable: boolean }[]) ?? [];
    const buttons = (it.buttons as string[]) ?? ["Approve", "Decline"];
    const dl = h("dl", {});
    const inputs: (HTMLInputElement | null)[] = [];
    fields.forEach((f) => {
      dl.append(h("dt", {}, f.label));
      const dd = h("dd", {}, f.value);
      dl.append(dd);
      inputs.push(null);
    });
    const stateEl = h("div", { class: "state" });
    const actions = h("div", { class: "actions" });
    const card = h("article", { class: "card" }, h("h3", {}, `${it.kind === "memory" || it.kind === "forget" ? "🧠" : "✋"} ${String(it.title)}`));
    const img = it.image as { mime?: string; b64?: string } | undefined;
    if (img && /^image\/(png|jpeg|webp)$/.test(img.mime ?? "")) card.append(h("img", { alt: "Screenshot of the page", src: `data:${img.mime};base64,${img.b64}` }));
    card.append(dl, actions, stateEl);
    let editing = false;
    const approve = h("button", { class: "primary", type: "button" }, buttons[0] ?? "Approve");
    const edit = buttons.length === 3 ? h("button", { type: "button" }, buttons[1]) : null;
    const decline = h("button", { type: "button" }, buttons[buttons.length - 1] ?? "Decline");
    actions.append(approve, ...(edit ? [edit] : []), decline);
    const disable = (text: string) => {
      for (const b of actions.querySelectorAll("button")) b.setAttribute("disabled", "");
      stateEl.textContent = text;
    };
    approve.onclick = async () => {
      const values = fields.map((f, i) => inputs[i]?.value ?? f.value);
      if (await client.send({ t: "approval_reply", id, decision: "approve", ...(editing ? { values } : {}) })) disable("Sending…");
    };
    decline.onclick = async () => {
      if (await client.send({ t: "approval_reply", id, decision: "decline" })) disable("Sending…");
    };
    if (edit)
      edit.onclick = () => {
        editing = true;
        edit.setAttribute("disabled", "");
        [...dl.querySelectorAll("dd")].forEach((dd, i) => {
          if (!fields[i].editable) return;
          const inp = h("input", { type: "text", value: fields[i].value, "aria-label": fields[i].label }) as HTMLInputElement;
          inputs[i] = inp;
          dd.replaceChildren(inp);
        });
        inputs.find(Boolean)?.focus();
      };
    cards.set(id, { el: card, resolved: false });
    return card;
  }

  function applyState(id: string, st: string): void {
    const c = cards.get(id);
    if (!c) return;
    c.resolved = true;
    for (const b of c.el.querySelectorAll("button")) b.setAttribute("disabled", "");
    for (const i of c.el.querySelectorAll("input")) i.setAttribute("disabled", "");
    const label: Record<string, string> = { approved: "✓ Approved", declined: "Declined", expired: "Expired", stopped: "Stopped", replaced: "Replaced by an edited version" };
    const el = c.el.querySelector(".state");
    if (el) el.textContent = label[st] ?? st;
  }

  function setStatus(connected: boolean, computer: boolean): void {
    dot.className = `dot${computer ? " on" : ""}`;
    statusText.textContent = !connected ? "Connecting…" : computer ? `${identity.home} · online` : `${identity.home} · offline`;
    banner.toggleAttribute("hidden", !connected || computer);
    banner.textContent = "Your Aha! computer is offline. What you write waits here and is sent when it's back.";
  }

  function setBusy(on: boolean): void {
    busy = on;
    working.toggleAttribute("hidden", !on);
    sendBtn.classList.toggle("stop", on && !input.value.trim());
    sendBtn.replaceChildren(icon(on && !input.value.trim() ? ICONS.stop : ICONS.send));
    sendBtn.setAttribute("aria-label", on && !input.value.trim() ? "Stop" : "Send");
    if (on && atBottom()) toBottom();
  }

  function showPending(cid: string, text: string, sent: boolean): void {
    const el = h("div", { class: "me pending" }, text, h("span", { class: "note" }, sent ? "Sending…" : "Waiting for your computer"));
    pending.set(cid, el);
    col.append(el, working);
    toBottom();
  }

  const client = new Client(store, identity, ratchet, settings, {
    item(it, live) {
      const stick = atBottom();
      place(it, "end");
      // A reply, or a card waiting for you: Aha! isn't working on its own any more (SPEC §3.3).
      if (live && ((it.t === "msg" && it.role === "aha") || it.t === "approval")) setBusy(false);
      if (stick || live) toBottom();
    },
    typing(on) {
      setBusy(on);
    },
    status(s) {
      setStatus(s.connected, s.computer);
      for (const [cid, el] of pending) {
        const note = el.querySelector(".note");
        if (note) note.textContent = s.computer ? "Sending…" : "Waiting for your computer";
        void cid;
      }
    },
    history(older) {
      const before = scroller.scrollHeight;
      for (const it of older.sort((a, b) => b.seq - a.seq)) place(it, "start");
      scroller.scrollTop += scroller.scrollHeight - before;
      loadingOlder = false;
    },
    memories(list) {
      settingsUi?.showMemories(list);
    },
    devices(list) {
      settingsUi?.showDevices(list);
    },
    report(msg) {
      settingsUi?.onReport(msg);
    },
    error(code) {
      if (code === "other_tab") screen(mark(), h("h1", {}, "Aha! is open somewhere else"), h("p", {}, "This device connected again from another tab or window."));
      if (code === "pin") screen(mark(), h("h1", {}, "Gateway key changed"), h("p", { class: "error" }, "The gateway's key no longer matches the one from pairing, so Aha! won't connect. Pair this device again."));
    },
    async revoked() {
      client.stop();
      await store.wipe();
      screen(mark(), h("h1", {}, "This device was unpaired"), h("p", {}, "Its keys and cached messages were deleted. Pair it again with a new QR code from your computer."));
    },
  });

  // cached messages first
  const cutoff = Math.floor(Date.now() / 1000) - settings.keepDays * 86400;
  if (settings.keepDays > 0) await store.prune(cutoff, (it) => it.t === "approval");
  else await store.clearItems();
  const cached = await store.items();
  for (const it of cached) place(it, "end");
  // a pending approval's card stays usable only if no state was recorded for it
  for (const m of await store.outbox()) showPending(m.cid, m.text, false);
  toBottom();
  setStatus(false, false);
  await client.start();

  // older history on demand
  let loadingOlder = false;
  scroller.addEventListener("scroll", () => {
    if (scroller.scrollTop < 40 && !loadingOlder && oldest > 1 && oldest !== Infinity && client.computer) {
      loadingOlder = true;
      void client.send({ t: "history_request", before: oldest, limit: 50 });
    }
  });

  // composer
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.4)}px`;
    setBusy(busy);
  };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      if (busy) await client.send({ t: "stop" });
      return;
    }
    input.value = "";
    grow();
    const cid = await client.say(text);
    showPending(cid, text, client.computer);
  });

  let settingsUi: SettingsUi | null = null;
  menu.onclick = () => {
    settingsUi = openSettings(store, client, () => (settingsUi = null));
  };

  // keep the cache window: prune once a day while open
  setInterval(() => {
    if (client.settings.keepDays > 0) void store.prune(Math.floor(Date.now() / 1000) - client.settings.keepDays * 86400, (it) => it.t === "approval");
  }, 86_400_000);

  if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register("/sw.js");
}

// ---- settings

interface SettingsUi {
  showMemories(list: { id: string; text: string }[]): void;
  showDevices(list: { id: string; name: string; created: number; last_seen: number; this: boolean }[]): void;
  onReport(msg: { t: string; id: string; text?: string; ok?: boolean; code?: string }): void;
}

const REPORT_ERRORS: Record<string, string> = {
  reports_off: "This gateway doesn't take problem reports.",
  rate_limited: "Too many reports for now. Please try again in an hour.",
  expired: "That preview expired. Please preview it again.",
  gateway_unreachable: "Couldn't reach the gateway. Please try again.",
};

/** Settings → Report a problem (SPEC §7.7): preview the exact text from the computer, then send it on request. */
function reportView(client: Client, back: () => void) {
  const note = h("textarea", { rows: "3", maxlength: "2000", placeholder: "What went wrong? (optional)", "aria-label": "What went wrong" }) as HTMLTextAreaElement;
  const count = h("select", { "aria-label": "How many of the latest messages to include" }) as HTMLSelectElement;
  for (const n of [1, 2, 4, 6, 10, 20]) {
    const o = h("option", { value: String(n) }, `The last ${n} message${n > 1 ? "s" : ""}`) as HTMLOptionElement;
    if (n === 4) o.selected = true;
    count.append(o);
  }
  const details = h("input", { type: "checkbox", id: "report-details" }) as HTMLInputElement;
  const status = h("p", { class: "fine" });
  const previewBtn = h("button", { class: "btn", type: "button" }, "Preview the report");
  const sendBtn = h("button", { class: "btn primary", type: "button", hidden: "" }, "Send to Axxlabs");
  const draft = h("pre", { class: "report-draft", hidden: "" });
  const backBtn = h("button", { class: "btn", type: "button" }, "Back");
  let draftId = "";
  const el = h(
    "section",
    {},
    h("h4", {}, "Report a problem"),
    h("p", { class: "fine" }, "Send Axxlabs the latest messages so we can see what went wrong. You'll see exactly what's sent before anything leaves your computer."),
    note,
    h("div", { class: "row" }, h("span", {}, "Include"), count),
    h("label", { class: "row", for: "report-details" }, h("span", {}, "Include technical details", h("small", {}, "The searches, pages and tools Aha! used for these messages. Helps us find the problem.")), details),
    draft,
    h("p", { class: "fine", hidden: "" }, "Only the text above is sent. It goes to Axxlabs as a private report, without your name or account, and is deleted once we've dealt with it (at most 90 days)."),
    status,
    h("div", { class: "row" }, backBtn, h("span", {}, previewBtn, " ", sendBtn)),
  );
  const consent = el.querySelector("p[hidden]") as HTMLElement;
  const reset = () => {
    draftId = "";
    draft.hidden = sendBtn.hidden = consent.hidden = true;
    previewBtn.textContent = "Preview the report";
  };
  for (const input of [note, count, details]) input.addEventListener("input", reset);
  previewBtn.onclick = async () => {
    status.textContent = "";
    const ok = await client.send({ t: "report_preview", count: Number(count.value), note: note.value, details: details.checked, app: APP_VERSION });
    status.textContent = ok ? "Asking your computer for the report…" : "Your computer is offline. Reports are built there, so try again when it's online.";
  };
  sendBtn.onclick = async () => {
    if (!draftId) return;
    sendBtn.disabled = true;
    status.textContent = (await client.send({ t: "report_send", id: draftId })) ? "Sending…" : "Your computer is offline.";
  };
  backBtn.onclick = back;
  return {
    el,
    onReport(msg: { t: string; id: string; text?: string; ok?: boolean; code?: string }) {
      if (msg.t === "report_draft") {
        draftId = msg.id;
        draft.textContent = msg.text ?? "";
        draft.hidden = sendBtn.hidden = consent.hidden = false;
        sendBtn.disabled = false;
        previewBtn.textContent = "Preview again";
        status.textContent = "";
      } else if (msg.t === "report_sent" && msg.id === draftId) {
        if (msg.ok) {
          el.replaceChildren(h("h4", {}, "Report a problem"), h("p", {}, "Thank you. Your report was sent."), h("div", { class: "row" }, backBtn));
        } else {
          status.textContent = REPORT_ERRORS[msg.code ?? ""] ?? "The report couldn't be sent. Please try again later.";
          sendBtn.disabled = false;
          if (msg.code === "expired") reset();
        }
      }
    },
  };
}

function openSettings(store: Store, client: Client, onClose: () => void): SettingsUi {
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon(ICONS.close));
  const memories = h("div", {}, h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline."));
  const devices = h("div", {}, h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline."));
  const keep = h("select", { "aria-label": "Keep messages on this device" }) as HTMLSelectElement;
  for (const [v, label] of [["30", "30 days"], ["7", "7 days"], ["1", "1 day"], ["0", "Don't keep"]]) {
    const o = h("option", { value: v }, label) as HTMLOptionElement;
    if (Number(v) === client.settings.keepDays) o.selected = true;
    keep.append(o);
  }
  const notify = h("button", { class: "btn", type: "button" }, client.settings.notifications ? "On" : "Turn on");
  const clearBtn = h("button", { class: "btn", type: "button" }, "Clear");
  const unpair = h("button", { class: "btn danger", type: "button" }, "Unpair");
  const reportBtn = h("button", { class: "btn", type: "button" }, "Report");
  const swatches = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Colour" });
  for (const t of THEMES) {
    const dot = h("i");
    dot.style.background = t.swatch; // CSSOM, which the CSP allows (no inline style attributes)
    const b = h("button", { class: "swatch", type: "button", role: "radio", "aria-checked": String(t.id === client.settings.theme) }, dot, t.name);
    b.onclick = async () => {
      for (const o of swatches.children) o.setAttribute("aria-checked", String(o === b));
      applyTheme(t.id);
      client.settings = { ...client.settings, theme: t.id };
      await store.put("settings", client.settings);
    };
    swatches.append(b);
  }
  let report: ReturnType<typeof reportView> | null = null;
  const dialog = h(
    "dialog",
    { class: "sheet", "aria-label": "Settings" },
    h(
      "div",
      { class: "sheet-in" },
      h("header", {}, h("h2", {}, "Settings"), close),
      h("section", {}, h("h4", {}, "What Aha! remembers about you"), memories, h("p", { class: "fine" }, "To change something, just tell Aha! in the chat.")),
      h("section", {}, h("h4", {}, "Your devices"), devices),
      h(
        "section",
        {},
        h("h4", {}, "This device"),
        h("div", { class: "row" }, h("span", {}, "Keep messages on this device", h("small", {}, "Your computer keeps the full history.")), keep),
        h("div", { class: "row" }, h("span", {}, "Notifications", h("small", {}, "They only say “New message from Aha!”.")), notify),
        h("div", { class: "row" }, h("span", {}, "Clear this device's cache"), clearBtn),
        h("div", { class: "row" }, h("span", {}, "Unpair this device", h("small", {}, "Deletes its keys and cached messages.")), unpair),
      ),
      h("section", {}, h("h4", {}, "Colour"), swatches),
      h("section", {}, h("h4", {}, "Help"), h("div", { class: "row" }, h("span", {}, "Report a problem", h("small", {}, "You choose what's shared, and see it before it's sent.")), reportBtn)),
      h("p", { class: "fine" }, `Aha! ${APP_VERSION} (${BUILD}) · end-to-end encrypted (AHA-PQ v1) · `, h("a", { href: "https://github.com/axxlabs/aha-app", target: "_blank", rel: "noopener noreferrer" }, "source (AGPL-3.0)")),
    ),
  ) as HTMLDialogElement;
  document.body.append(dialog);
  dialog.showModal();
  const shut = () => {
    dialog.close();
    dialog.remove();
    onClose();
  };
  close.onclick = shut;
  dialog.addEventListener("cancel", shut);
  void client.send({ t: "memories_request" });
  void client.send({ t: "devices_request" });

  keep.onchange = async () => {
    client.settings = { ...client.settings, keepDays: Number(keep.value) };
    await store.put("settings", client.settings);
    if (client.settings.keepDays === 0) await store.clearItems();
    else await store.prune(Math.floor(Date.now() / 1000) - client.settings.keepDays * 86400, (it) => it.t === "approval");
  };
  clearBtn.onclick = async () => {
    await store.clearItems();
    await store.put("last", 0);
    clearBtn.textContent = "Cleared";
  };
  notify.onclick = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !client.vapid) {
      notify.textContent = "Not available here";
      return;
    }
    if ((await Notification.requestPermission()) !== "granted") {
      notify.textContent = "Blocked in browser settings";
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlDecode(client.vapid) as BufferSource });
    client.settings = { ...client.settings, notifications: true };
    await store.put("settings", client.settings);
    await client.send({ t: "hello", name: client.identity.deviceName, version: APP_VERSION, push: sub.toJSON() });
    notify.textContent = "On";
  };
  const inner = dialog.querySelector(".sheet-in") as HTMLElement;
  reportBtn.onclick = () => {
    const sections = [...inner.children].slice(1) as HTMLElement[];
    for (const s of sections) s.hidden = true;
    report = reportView(client, () => {
      report?.el.remove();
      report = null;
      for (const s of sections) s.hidden = false;
    });
    inner.append(report.el);
  };
  unpair.onclick = async () => {
    if (!confirm("Unpair this device? Its keys and cached messages will be deleted.")) return;
    await client.send({ t: "revoke_device", device: client.dev });
    client.stop();
    await store.wipe();
    location.reload();
  };

  return {
    onReport(msg) {
      report?.onReport(msg);
    },
    showMemories(list) {
      memories.replaceChildren(
        ...(list.length ? list.map((m) => h("div", { class: "row" }, h("span", {}, m.text))) : [h("p", { class: "fine" }, "Nothing yet.")]),
      );
    },
    showDevices(list) {
      devices.replaceChildren(
        ...list.map((d) => {
          const seen = d.last_seen ? new Date(d.last_seen * 1000).toLocaleString() : "never";
          const row = h("div", { class: "row" }, h("span", {}, d.name + (d.this ? " (this device)" : ""), h("small", {}, `last seen ${seen}`)));
          if (!d.this) {
            const b = h("button", { class: "btn danger", type: "button" }, "Revoke");
            b.onclick = async () => {
              if (confirm(`Revoke “${d.name}”? It won't be able to reach Aha! any more.`)) await client.send({ t: "revoke_device", device: d.id });
            };
            row.append(b);
          }
          return row;
        }),
      );
    },
  };
}

void boot();
