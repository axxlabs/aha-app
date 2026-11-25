// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// The Aha! app (SPEC §7.4): one GPT-style conversation with your own computer, end-to-end encrypted.

import "./style.css";
import { APPEARANCES, THEMES, applyTheme } from "./themes";
import { APP_VERSION, Client, HISTORY_CHOICES, pruneCache, shortFingerprint, DEFAULT_SETTINGS, type BrowserSite, type ModelChoice, type TraceEvent, traceTime, type Identity, type Settings, pair, parsePairLink } from "./client";
import { type Tap, MAX_TAPS, checkButton, tapOnImage, tapsValue } from "./taps";
import { Ratchet, type RatchetState, b64e, b64urlDecode } from "./crypto";
import { chatView } from "./view";
import { DATE_FORMATS, formatDate, render } from "./markdown";
import { externalUrl, platform, standalone } from "./links";
import { type Item, type Photo, Store } from "./store";

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
  photo: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
};

// A photo for Aha! (SPEC §7.4): at most 1600 px on its longest side, re-encoded as JPEG, which also drops its
// location and other metadata; smaller again if it's still over ~900 kB.
async function shrinkPhoto(file: File): Promise<Photo> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  for (const [side, quality] of [[1600, 0.85], [1280, 0.75], [1024, 0.7]] as const) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", quality));
    if (!blob) break;
    if (blob.size <= 900_000) return { mime: "image/jpeg", b64: b64e(new Uint8Array(await blob.arrayBuffer())) };
  }
  throw new Error("photo too large");
}

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
  const saved = await store.get<Settings>("settings");
  applyTheme(saved?.theme, saved?.appearance);
  if (location.hash.startsWith("#pair=")) return pairingScreen(store);
  const identity = await store.get<Identity>("identity");
  if (!identity) return welcomeScreen(store);
  return chat(store, identity);
}

const onIphone = () => platform(navigator.userAgent, navigator.maxTouchPoints) === "ios";

function welcomeScreen(store: Store): void {
  // The installed app on an iPhone can't be reached by scanning: the camera opens the link in Safari, whose data
  // is separate from the Home Screen app's. So the link can be pasted here too.
  const link = h("input", { type: "url", placeholder: "Paste the pairing link", "aria-label": "Pairing link", autocomplete: "off" }) as HTMLInputElement;
  const go = h("button", { class: "primary", type: "button" }, "Pair");
  const msg = h("p", { class: "error" });
  go.onclick = () => {
    const at = link.value.indexOf("#pair=");
    if (at < 0) {
      msg.textContent = "That isn't a pairing link. It starts with the app's address and has #pair= in it.";
      return;
    }
    location.hash = link.value.slice(at).trim();
    void pairingScreen(store);
  };
  screen(
    mark(),
    h("h1", {}, "aha! A Truly Private Personal Assistant"),
    h("p", {}, "To use Aha!, pair this device with your own computer: run ", h("code", {}, "aha pair <your name>"), " there and scan the QR code it shows."),
    standalone() && onIphone()
      ? h("p", {}, "In the Home Screen app, paste the link instead: point the Camera at the QR code, touch and hold the link it shows, choose Copy, and paste it here.")
      : h("p", { class: "fine" }, "Or paste the link the QR code holds:"),
    link,
    go,
    msg,
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
  const fullLink = location.origin + location.pathname + location.hash;
  // The secret must not stay in the address bar or the history.
  history.replaceState(null, "", location.pathname);
  // On an iPhone, Safari and the Home Screen app keep separate data: a pairing made in Safari isn't in the app.
  const copy = h("button", { class: "btn", type: "button" }, "Copy pairing link");
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(fullLink);
      copy.textContent = "Copied: now open Aha! from your Home Screen and paste it";
    } catch {
      copy.textContent = "Couldn't copy";
    }
  };
  const iphoneBox =
    onIphone() && !standalone()
      ? h(
          "div",
          { class: "note-box" },
          h("p", {}, h("b", {}, "Using Aha! from your Home Screen?"), " Pair there, not here: on iPhone the Home Screen app keeps its own data, separate from Safari, so a pairing made in Safari isn't in it."),
          h("p", { class: "fine" }, "Copy the link, add Aha! to your Home Screen (Share → Add to Home Screen), open it from there and paste the link."),
          copy,
        )
      : "";
  const existing = await store.get<Identity>("identity");
  // A link for a different computer than the one this device is paired with (SPEC §6.4).
  const different = !!existing && (existing.fp ? existing.fp !== data.fp : existing.gw !== data.gw || existing.home !== data.home);
  const confirmInput = h("input", { type: "text", maxlength: "60", "aria-label": "Type the computer's name to confirm" }) as HTMLInputElement;
  const button = h("button", { class: "primary", type: "button" }, `Pair with ${data.home} as ${data.name}`);
  if (different) {
    button.setAttribute("disabled", "");
    confirmInput.addEventListener("input", () => button.toggleAttribute("disabled", confirmInput.value.trim() !== data.home));
  }
  const nameInput = h("input", { type: "text", maxlength: "60", value: defaultName(), "aria-label": "Name of this device" }) as HTMLInputElement;
  const msg = h("p", {});
  screen(
    mark(),
    h("h1", {}, `Hi ${data.name}`),
    h("p", {}, `This connects this device to Aha! on “${data.home}”. Everything you write is end-to-end encrypted to that computer.`),
    existing && !different ? h("p", { class: "error" }, "This device is already paired; pairing again replaces it.") : "",
    iphoneBox,
    different
      ? h(
          "div",
          { class: "warn-box" },
          h("p", {}, h("b", {}, `This isn't your computer “${existing!.home}”.`), ` If someone sent you this link, don't pair: they would receive everything you write.`),
          h("label", { class: "fine" }, `To pair with “${data.home}” anyway, type its name:`),
          confirmInput,
        )
      : "",
    h("p", { class: "fine" }, `Through the gateway ${new URL(data.gw).host}. Computer fingerprint ${shortFingerprint(data.fp)} (\`aha status\` shows it). Only pair with a QR code your own computer showed you.`),
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
  if (!state) return welcomeScreen(store);
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
  // A link in a reply, in the installed app with "In my browser" chosen: hand it to the phone's browser (links.ts).
  col.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.(".aha a[href]") as HTMLAnchorElement | null;
    if (!a || client.settings.links !== "browser" || !standalone()) return;
    const url = externalUrl(a.href, platform(navigator.userAgent, navigator.maxTouchPoints));
    if (url === a.href) return;
    e.preventDefault();
    location.href = url;
  });
  const scroller = h("main", { class: "chat" }, col);
  const workingText = h("span", {}, " Aha! is working…");
  const working = h("div", { class: "working", hidden: "", role: "status" }, h("i"), h("i"), h("i"), workingText);
  const input = h("textarea", { rows: "1", placeholder: "Ask Aha! anything", "aria-label": "Message", enterkeyhint: "enter", maxlength: "20000" }) as HTMLTextAreaElement;
  const sendBtn = h("button", { class: "send", type: "submit", "aria-label": "Send" }, icon(ICONS.send));
  const photoBtn = h("button", { class: "attach", type: "button", "aria-label": "Add a photo" }, icon(ICONS.photo));
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: "" }) as HTMLInputElement;
  const attachment = h("div", { class: "attachment", hidden: "" });
  let photo: Photo | null = null;
  const form = h("form", {}, photoBtn, fileInput, input, sendBtn);
  // Fold the conversation going on now, on every device; the next message starts a new part (SPEC §7.4).
  const cutBtn = h("button", { class: "cut", type: "button", hidden: "", title: "Fold this conversation away" }, "[collapse]");
  cutBtn.onclick = () => void client.send({ t: "cut" });
  // Safari deletes a non-installed site's storage after 7 days without a visit, and the pairing with it (SPEC §9.2).
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const installHint = h("div", { class: "banner" }, "Safari may delete this pairing after 7 days without a visit. To keep Aha! on your Home Screen, add it (Share → Add to Home Screen) and pair it again there: it keeps its own data, so this pairing isn't in it.");
  installHint.hidden = !ios || installed;
  app.replaceChildren(
    h("header", { class: "top" }, mark(), h("div", { class: "right" }, statusBox, menu)),
    installHint,
    banner,
    scroller,
    h("footer", { class: "composer" }, attachment, form),
  );

  const cards = new Map<string, { el: HTMLElement; resolved: boolean }>();
  let busy = false;
  let historyStart = 1; // the first message the computer still holds (SPEC §3.8.1)
  // The chat view (src/view.ts): the items are its only state, and it draws everything from them.
  const view = chatView({
    col,
    scroller,
    working,
    node,
    resolve: (it, st) => applyState(String(it.id), st),
    dayLabel,
    busy: () => busy,
    cut: cutBtn,
  });
  const toBottom = view.toBottom;

  function dayLabel(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  let detailsUi: { seq: number; show(events: TraceEvent[]): void } | null = null;
  // The person's connected accounts, shown as labels in replies (SPEC §7.4 "Labels"); asked once online.
  let accounts: string[] = [];
  let askedAccounts = false;
  function relabel(list: string[]): void {
    if (list.join() === accounts.join()) return;
    accounts = list;
    view.remake((it) => it.t === "msg" && it.role === "aha"); // drawn again with the labels
  }
  window.addEventListener("aha-dates", () => view.remake((it) => it.t === "msg" && it.role === "aha"));

  function node(it: Item): HTMLElement | null {
    if (it.t === "msg" && it.role === "me") {
      const el = h("div", { class: "me" }, String(it.text ?? ""));
      const img = it.image as { mime?: string; b64?: string } | undefined;
      if (img && /^image\/(png|jpeg|webp)$/.test(img.mime ?? "")) el.prepend(h("img", { class: "photo", alt: "Your photo", src: `data:${img.mime};base64,${img.b64}` }));
      return el;
    }
    if (it.t === "msg") {
      const el = h("div", { class: "aha" });
      el.innerHTML = render(String(it.text ?? ""), accounts, client.settings.dates); // html disabled; labels
      const img = it.image as { mime?: string; b64?: string } | undefined;
      if (img && /^image\/(png|jpeg|webp)$/.test(img.mime ?? "")) el.append(h("img", { class: "shot", alt: "Screenshot", src: `data:${img.mime};base64,${img.b64}` }));
      el.append(messageMenu(it.seq));
      return el;
    }
    if (it.t === "approval") return approvalCard(it);
    return null;
  }

  /** ⋯ under each of Aha!'s messages: Show details (SPEC §3.8). */
  function messageMenu(seq: number): HTMLElement {
    const more = h("button", { class: "more", type: "button", "aria-label": "More", "aria-haspopup": "menu", "aria-expanded": "false" }, icon(ICONS.menu));
    const show = h("button", { type: "button", role: "menuitem" }, "Show details");
    const pop = h("div", { class: "more-menu", role: "menu", hidden: "" }, show);
    const shut = (e?: Event) => {
      if (e && wrap.contains(e.target as Node)) return;
      pop.hidden = true;
      more.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", shut);
    };
    more.onclick = () => {
      if (!pop.hidden) return shut();
      pop.hidden = false;
      more.setAttribute("aria-expanded", "true");
      setTimeout(() => document.addEventListener("click", shut));
    };
    show.onclick = () => {
      shut();
      detailsUi = openDetails(client, seq, () => (detailsUi = null));
    };
    const wrap = h("div", { class: "more-wrap" }, more, pop);
    return wrap;
  }

  function approvalCard(it: Item): HTMLElement {
    const id = String(it.id);
    const fields = (it.fields as { label: string; value: string; editable: boolean; kind?: string }[]) ?? [];
    const buttons = (it.buttons as string[]) ?? ["Approve", "Decline"];
    const dl = h("dl", {});
    const inputs: (HTMLInputElement | HTMLTextAreaElement | null)[] = [];
    fields.forEach((f) => {
      const hidden: Record<string, string> = f.kind === "taps" ? { hidden: "" } : {}; // a check card's taps are made on the screenshot
      dl.append(h("dt", hidden, f.label));
      const dd = h("dd", f.kind === "longtext" ? { class: "long", ...hidden } : hidden, f.value);
      dl.append(dd);
      inputs.push(null);
    });
    const stateEl = h("div", { class: "state" });
    const actions = h("div", { class: "actions" });
    // The computer sends each card's icon (SPEC §6.5); a card from an older computer has none.
    const icon = typeof it.icon === "string" && it.icon.length <= 8 ? it.icon : "✋";
    const card = h("article", { class: "card" }, h("h3", {}, `${icon} ${String(it.title)}`));
    // Why this card is shown, as the computer's code decided it (SPEC §5.2, §7.4): a tooltip on hover, and a tap
    // shows it in the card (phones have no hover).
    const why = typeof it.why === "string" ? it.why.trim() : "";
    if (why) {
      const note = h("p", { class: "why", hidden: "" }, why);
      const info = h("button", { class: "info", type: "button", title: why, "aria-label": "Why am I asked?", "aria-expanded": "false" }, "i");
      info.onclick = () => {
        note.hidden = !note.hidden;
        info.setAttribute("aria-expanded", String(!note.hidden));
      };
      card.classList.add("has-why");
      card.append(info, note);
    }
    const img = it.image as { mime?: string; b64?: string } | undefined;
    const shot = img && /^image\/(png|jpeg|webp)$/.test(img.mime ?? "") ? (h("img", { alt: "Screenshot of the page", src: `data:${img.mime};base64,${img.b64}` }) as HTMLImageElement) : null;
    // A check card (SPEC §3.4, §5.3): the person taps the screenshot where they'd click.
    const tapsAt = it.kind === "check" ? fields.findIndex((f) => f.kind === "taps") : -1;
    const taps: Tap[] = [];
    let showTaps = () => {};
    if (shot && tapsAt >= 0) {
      const frame = h("div", { class: "tap-frame" }, shot);
      const undo = h("button", { class: "btn", type: "button", disabled: "" }, "Undo last tap");
      showTaps = () => {
        for (const d of frame.querySelectorAll(".tap")) d.remove();
        taps.forEach((t, i) => {
          const dot = h("span", { class: "tap" }, String(i + 1));
          dot.style.left = `${(t.x / shot.naturalWidth) * 100}%`; // CSSOM, which the CSP allows
          dot.style.top = `${(t.y / shot.naturalHeight) * 100}%`;
          frame.append(dot);
        });
        undo.toggleAttribute("disabled", taps.length === 0);
        approve.textContent = checkButton(taps);
      };
      shot.addEventListener("click", (e) => {
        if (approve.hasAttribute("disabled") || taps.length >= MAX_TAPS) return;
        const tap = tapOnImage(e.clientX, e.clientY, shot.getBoundingClientRect(), { width: shot.naturalWidth, height: shot.naturalHeight });
        if (!tap) return;
        taps.push(tap);
        showTaps();
      });
      undo.onclick = () => {
        taps.pop();
        showTaps();
      };
      card.append(frame, h("p", { class: "fine" }, "Tap the picture where you'd click, then send your taps. When the check is done, tap “It's done”."), undo);
    } else if (shot) card.append(shot);
    card.append(dl, actions, stateEl);
    let editing = false;
    // A sign-in card's inputs are open from the start: the person types into them (SPEC §5.3). A check card's
    // only input is the screenshot.
    const openInputs = it.kind === "signin" || it.kind === "check";
    const inputFor = (f: (typeof fields)[number]): HTMLInputElement | HTMLTextAreaElement => {
      if (f.kind === "longtext") {
        const ta = h("textarea", { rows: "8", "aria-label": f.label }) as HTMLTextAreaElement;
        ta.value = f.value;
        return ta;
      }
      if (f.kind === "bool") {
        const box = h("input", { type: "checkbox", "aria-label": f.label }) as HTMLInputElement;
        box.checked = f.value === "true";
        return box;
      }
      if (f.kind === "secret") {
        // Never pre-filled, never stored: cleared as soon as it's sent. Codes get the phone's one-time-code fill.
        const code = /code|otp|pin|verif/i.test(f.label);
        return h("input", {
          type: code ? "text" : "password",
          autocomplete: code ? "one-time-code" : "off",
          ...(code ? { inputmode: "numeric" } : {}),
          "aria-label": f.label,
        }) as HTMLInputElement;
      }
      return h("input", { type: "text", value: f.value, "aria-label": f.label, ...(openInputs ? { autocomplete: "username" } : {}) }) as HTMLInputElement;
    };
    const valueOf = (f: (typeof fields)[number], i: number): string => {
      if (i === tapsAt) return tapsValue(taps);
      const inp = inputs[i];
      if (!inp) return f.value;
      return inp instanceof HTMLInputElement && inp.type === "checkbox" ? String(inp.checked) : inp.value;
    };
    const approve = h("button", { class: "primary", type: "button" }, buttons[0] ?? "Approve");
    const edit = buttons.length === 3 ? h("button", { type: "button" }, buttons[1]) : null;
    const decline = h("button", { type: "button" }, buttons[buttons.length - 1] ?? "Decline");
    actions.append(approve, ...(edit ? [edit] : []), decline);
    showTaps();
    const disable = (text: string) => {
      for (const b of actions.querySelectorAll("button")) b.setAttribute("disabled", "");
      stateEl.textContent = text;
    };
    approve.onclick = async () => {
      const values = fields.map(valueOf);
      const sent = await client.send({ t: "approval_reply", id, decision: "approve", ...(editing ? { values } : {}) });
      fields.forEach((f, i) => {
        const inp = inputs[i];
        if (f.kind === "secret" && inp) inp.value = "";
      });
      if (sent) disable("Sending…");
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
          const inp = inputFor(fields[i]);
          inputs[i] = inp;
          dd.replaceChildren(inp);
        });
        inputs.find(Boolean)?.focus();
      };
    if (openInputs) {
      editing = true;
      [...dl.querySelectorAll("dd")].forEach((dd, i) => {
        if (i === tapsAt) return;
        if (!fields[i].editable && fields[i].kind !== "bool") return;
        const inp = inputFor(fields[i]);
        if (inp instanceof HTMLInputElement && inp.type !== "checkbox")
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.isComposing) {
              e.preventDefault();
              approve.click();
            }
          });
        inputs[i] = inp;
        dd.replaceChildren(inp);
      });
    }
    cards.set(id, { el: card, resolved: false });
    return card;
  }

  function applyState(id: string, st: string): void {
    const c = cards.get(id);
    if (!c || c.resolved) return;
    c.resolved = true;
    for (const b of c.el.querySelectorAll("button")) b.setAttribute("disabled", "");
    for (const i of c.el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
      i.setAttribute("disabled", "");
      if (i.type === "password" || i.autocomplete === "one-time-code") i.value = "";
    }
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

  // The send button turns into Stop while Aha! works, but only from 1.5 s after the last send, so a double tap
  // or a second tap on Send never cancels the message just sent (SPEC §7.4).
  const STOP_GRACE = 1500;
  let lastSend = 0;
  const stopMode = () => busy && !input.value.trim() && !photo && Date.now() - lastSend >= STOP_GRACE;
  function setBusy(on: boolean): void {
    if (on !== busy) view.invalidate(); // while Aha! works, the part going on doesn't fold
    busy = on;
    working.toggleAttribute("hidden", !on);
    const stop = stopMode();
    sendBtn.classList.toggle("stop", stop);
    sendBtn.replaceChildren(icon(stop ? ICONS.stop : ICONS.send));
    sendBtn.setAttribute("aria-label", stop ? "Stop" : "Send");
    if (on && view.atBottom()) toBottom();
  }

  function showPending(cid: string, text: string, sent: boolean, image?: Photo): void {
    const el = h("div", { class: "me pending" }, text, h("span", { class: "note" }, sent ? "Sending…" : "Waiting for your computer"));
    if (image) el.prepend(h("img", { class: "photo", alt: "Your photo", src: `data:${image.mime};base64,${image.b64}` }));
    view.sending(cid, el);
  }

  const client = new Client(store, identity, ratchet, settings, {
    item(it, live) {
      view.add([it]);
      // "Working" comes only from the computer (typing frames and the sync): no guessing from what arrives,
      // which turned it off at every message a task sends while it carries on (SPEC §3.3).
      if (live) view.invalidate(true);
    },
    typing(on, queued) {
      // The model answers one request at a time for the household (SPEC §3.3): say when it's someone else's turn.
      workingText.textContent = queued ? " Aha! is finishing someone else's request first…" : " Aha! is working…";
      setBusy(on);
    },
    status(s) {
      setStatus(s.connected, s.computer);
      if (s.computer && !askedAccounts) {
        askedAccounts = true;
        void client.send({ t: "connections_request" });
      }
      for (const [, el] of view.pendingEntries()) {
        const note = el.querySelector(".note");
        if (note) note.textContent = s.computer ? "Sending…" : "Waiting for your computer";
      }
    },
    history(older) {
      view.add(older); // the view keeps what's on screen in place as older messages go in above
      loadingOlder = false;
    },
    historyStart(start) {
      historyStart = Math.max(historyStart, start);
      view.dropBefore(start);
    },
    historySettings(days) {
      settingsUi?.showHistory(days);
    },
    memories(list) {
      settingsUi?.showMemories(list);
    },
    devices(list) {
      settingsUi?.showDevices(list);
    },
    connections(emails) {
      relabel(emails);
      settingsUi?.showConnections(emails);
    },
    browser(list) {
      settingsUi?.showBrowser(list);
    },
    model(m) {
      settingsUi?.showModel(m);
    },
    trace(seq, events) {
      if (detailsUi?.seq === seq) detailsUi.show(events);
    },
    report(msg) {
      settingsUi?.onReport(msg);
    },
    error(code) {
      if (code === "bad_model") settingsUi?.modelNote("That model isn't on your computer. Run `aha models` there to download it.");
      if (code === "bad_site") settingsUi?.browserNote("That isn't a web site's name. Type it like waitrose.com.");
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
  // The device keeps the last 5 days (SPEC §7.5); older messages come from the computer on scroll.
  await pruneCache(store, settings);
  const cached = await store.items();
  view.add(cached);
  // a pending approval's card stays usable only if no state was recorded for it
  for (const m of await store.outbox()) showPending(m.cid, m.text, false, m.image);
  view.draw();
  toBottom();
  setStatus(false, false);
  await client.start();

  // older history on demand
  let loadingOlder = false;
  scroller.addEventListener("scroll", () => {
    const first = view.oldest();
    if (scroller.scrollTop < 40 && !loadingOlder && first > historyStart && first !== Infinity && client.computer) {
      loadingOlder = true;
      void client.send({ t: "history_request", before: first, limit: 50 });
    }
  });

  // composer
  const grow = () => {
    // scrollHeight leaves out the border, so the box was 2px short and always scrollable: count it in, and only
    // let the box scroll once it's at its tallest.
    input.style.height = "auto";
    const full = input.scrollHeight + input.offsetHeight - input.clientHeight;
    const max = window.innerHeight * 0.4;
    input.style.height = `${Math.min(full, max)}px`;
    input.style.overflowY = full > max ? "auto" : "hidden";
    setBusy(busy);
  };
  input.addEventListener("input", grow);
  requestAnimationFrame(grow);
  function setPhoto(p: Photo | null): void {
    photo = p;
    attachment.replaceChildren();
    attachment.hidden = !p;
    if (p) {
      const remove = h("button", { type: "button", "aria-label": "Remove the photo" }, icon(ICONS.close));
      remove.onclick = () => setPhoto(null);
      attachment.append(h("img", { alt: "Photo to send", src: `data:${p.mime};base64,${p.b64}` }), remove);
    }
    setBusy(busy);
  }
  photoBtn.onclick = () => fileInput.click();
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      setPhoto(await shrinkPhoto(file));
      input.focus();
    } catch {
      setPhoto(null);
      alert("That photo couldn't be used. Try another one, or a screenshot of it.");
    }
  });
  input.addEventListener("keydown", (e) => {
    // Enter is a new line (SPEC §7.4); the send button or Ctrl/Cmd+Enter sends.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  // Typing or pasting anywhere goes to the message box (SPEC §7.4), unless something else that takes text has the
  // focus (a card's fields, Settings, a dialog).
  const takesText = (el: Element | null) =>
    !!el && (el.matches("input, textarea, select, [contenteditable=''], [contenteditable='true']") || !!el.closest("dialog[open]"));
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 || takesText(document.activeElement) || document.querySelector("dialog[open]")) return;
    input.focus(); // the key lands in the box: focus moves before the browser inserts it
  });
  document.addEventListener("paste", (e) => {
    if (takesText(document.activeElement) || document.querySelector("dialog[open]")) return;
    const data = e.clipboardData;
    if (!data) return;
    const file = [...data.files].find((f) => f.type.startsWith("image/"));
    e.preventDefault();
    input.focus();
    if (file) {
      void shrinkPhoto(file).then(setPhoto, () => alert("That photo couldn't be used. Try another one, or a screenshot of it."));
      return;
    }
    const text = data.getData("text/plain");
    if (!text) return;
    const at = input.selectionStart ?? input.value.length;
    input.setRangeText(text, at, input.selectionEnd ?? at, "end");
    input.dispatchEvent(new Event("input")); // grows the box, and turns Stop back into Send
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !photo) {
      if (stopMode()) await client.send({ t: "stop" });
      return;
    }
    const image = photo ?? undefined;
    input.value = "";
    setPhoto(null);
    lastSend = Date.now();
    setTimeout(() => setBusy(busy), STOP_GRACE + 50);
    grow();
    const cid = await client.say(text, image);
    showPending(cid, text, client.computer, image);
  });

  let settingsUi: SettingsUi | null = null;
  menu.onclick = () => {
    if (settingsUi) return settingsUi.close(); // the menu button toggles the side pane
    settingsUi = openSettings(store, client, () => (settingsUi = null));
  };

  // A break can happen while the app is open in the background: fold when it's looked at again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    view.invalidate(true);
  });

  // keep the cache window: prune every hour while open
  setInterval(() => {
    void pruneCache(store, client.settings);
  }, 3_600_000);

  if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register("/sw.js");
}

// ---- a message's details (SPEC §3.8)

const CHECKS: Record<string, string> = {
  numbers: "a number it couldn't find on a page",
  site: "it said it did something on a site without doing it",
  blank: "it gave up on a new, blank browser window",
};

function seconds(ms: unknown): string {
  return typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : "";
}

function block(label: string, text: unknown, open = true): HTMLElement | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const d = h("details", {}, h("summary", {}, label), h("pre", { class: "report-draft" }, text));
  d.open = open;
  return d;
}

/** One record, drawn: its time and what it was, then what it said. */
function traceRow(e: TraceEvent): HTMLElement {
  const at = traceTime(e.ts);
  const time = Number.isNaN(at) ? e.ts : new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts: (HTMLElement | null)[] = [];
  let title = e.kind;
  let meta = "";
  if (e.kind === "model") {
    title = `Model · ${String(e.model ?? "")}`;
    const t = (e.timings ?? {}) as Record<string, number>;
    meta = [
      seconds(e.ms),
      `${Number(e.prompt_tokens ?? 0).toLocaleString()} prompt tokens (${Number(e.cached_tokens ?? 0).toLocaleString()} cached)`,
      t.prompt_ms !== undefined ? `read ${Number(t.prompt_n ?? 0).toLocaleString()} in ${seconds(t.prompt_ms)}` : "",
      t.predicted_ms !== undefined ? `wrote ${Number(t.predicted_n ?? 0).toLocaleString()} in ${seconds(t.predicted_ms)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    parts.push(block("Thinking", e.reasoning, false), block("Wrote", e.text));
    for (const c of Array.isArray(e.calls) ? (e.calls as { name?: string; args?: string }[]) : []) parts.push(block(`Called ${String(c.name ?? "")}`, c.args || "{}"));
  } else if (e.kind === "tool") {
    title = `Tool · ${String(e.name ?? "")}${e.error ? " · error" : ""}`;
    parts.push(block("Arguments", e.args, false), block("Result", e.result, false));
  } else if (e.kind === "check") {
    title = "Check";
    meta = `Sent the draft back: ${CHECKS[String(e.name)] ?? String(e.name)}`;
  } else if (e.kind === "user") {
    title = "You said";
    parts.push(block("Message", e.text));
  } else if (e.kind === "item") {
    title = e.t === "approval" ? "Card shown" : "Sent to the chat";
    parts.push(block("Text", e.text, false));
  } else if (e.kind === "answer") {
    title = "Task finished";
  } else if (e.kind === "stopped") {
    title = "Stopped";
  }
  return h(
    "div",
    { class: "trace-row" },
    h("div", { class: "trace-head" }, h("time", {}, time), h("b", {}, title)),
    ...(meta ? [h("small", {}, meta)] : []),
    ...parts.filter((p): p is HTMLElement => p !== null),
  );
}

/** ⋯ → Show details: everything the model wrote and called for this message, with times. */
function openDetails(client: Client, seq: number, onClose: () => void) {
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon(ICONS.close));
  const copy = h("button", { class: "btn", type: "button", hidden: "" }, "Copy all");
  const body = h("div", { class: "trace" }, h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline: details need it online."));
  const dialog = h(
    "dialog",
    { class: "sheet", "aria-label": "Message details" },
    h("div", { class: "sheet-in" }, h("header", {}, h("h2", {}, "Details"), close), h("p", { class: "fine" }, "What the model wrote, thought and called for this message, from your computer."), body, copy),
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
  void client.send({ t: "trace_request", seq });
  return {
    seq,
    show(events: TraceEvent[]) {
      if (!events.length) {
        body.replaceChildren(h("p", { class: "fine" }, "No details were kept for this message. Messages from before this version, and ones not from a task, have none."));
        return;
      }
      body.replaceChildren(...events.map(traceRow));
      copy.hidden = false;
      copy.onclick = async () => {
        await navigator.clipboard.writeText(JSON.stringify(events, null, 1));
        copy.textContent = "Copied";
      };
    },
  };
}

// ---- settings

interface SettingsUi {
  showHistory(days: number | null): void;
  showMemories(list: { id: string; text: string }[]): void;
  showDevices(list: { id: string; name: string; created: number; last_seen: number; this: boolean }[]): void;
  showBrowser(list: BrowserSite[]): void;
  showConnections(emails: string[]): void;
  showModel(m: { current: string; choices: ModelChoice[] }): void;
  modelNote(text: string): void;
  browserNote(text: string): void;
  onReport(msg: { t: string; id: string; text?: string; ok?: boolean; code?: string }): void;
  close(): void;
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
    const ok = await client.send({ t: "report_preview", count: Number(count.value), note: note.value, details: details.checked, app: `${APP_VERSION} (${BUILD})` });
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

const PANE_MEDIA = "(min-width: 1400px)"; // 30% of it is at least the sheet's 420px; keep in step with style.css

function openSettings(store: Store, client: Client, onClose: () => void): SettingsUi {
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon(ICONS.close));
  const memories = h("div", {}, h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline."));
  const devices = h("div", {}, h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline."));
  // Your browser (SPEC §3.4, §7.4): what Aha!'s browser on the computer remembers for this person.
  const sites = h("div", {}, h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline."));
  const clearBrowser = h("button", { class: "btn danger", type: "button", disabled: "" }, "Clear browser");
  const trustInput = h("input", { type: "text", placeholder: "e.g. waitrose.com", "aria-label": "A site to trust", autocapitalize: "off", spellcheck: "false" }) as HTMLInputElement;
  const trustBtn = h("button", { class: "btn", type: "button" }, "Trust") as HTMLButtonElement;
  const siteNote = h("p", { class: "fine", hidden: "" });
  // Model (SPEC §3.2): one choice for the whole household, since there is one graphics card.
  const model = h("select", { "aria-label": "Model", disabled: "" }) as HTMLSelectElement;
  const modelAbout = h("small", {}, client.computer ? "Loading…" : "Your computer is offline.");
  const modelNote = h("p", { class: "fine", hidden: "" });
  let models: ModelChoice[] = [];
  let currentModel = "";
  const setModelNote = (text: string) => {
    modelNote.textContent = text;
    modelNote.hidden = !text;
  };
  const describeModel = (id: string) => {
    modelAbout.textContent = models.find((m) => m.id === id)?.note ?? "";
  };
  // Your history (SPEC §3.8.1): kept on the computer for as long as the person chooses; this device keeps 5 days.
  const keep = h("select", { "aria-label": "Keep my history", disabled: "" }) as HTMLSelectElement;
  for (const [days, label] of HISTORY_CHOICES) keep.append(h("option", { value: days === null ? "forever" : String(days) }, label));
  const showKeep = (days: number | null | undefined) => {
    if (days === undefined) return;
    keep.value = days === null ? "forever" : String(days);
  };
  showKeep(client.settings.historyDays);
  const clearHistory = h("button", { class: "btn danger", type: "button", disabled: "" }, "Clear chat history");
  const historyNote = h("p", { class: "fine" });
  const note = (text: string) => {
    historyNote.textContent = text;
    historyNote.hidden = !text;
  };
  note(client.computer ? "" : "Your computer is offline: these need it online.");
  const notify = h("button", { class: "btn", type: "button" }, client.settings.notifications ? "On" : "Turn on");
  // Open links (links.ts): only the installed app on a phone can choose.
  const linkModes = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Open links" });
  // Dates (SPEC §7.4 "Labels"): how the date labels in replies read, on this device.
  const dateModes = h("div", { class: "segmented wrap", role: "radiogroup", "aria-label": "Dates" });
  for (const [id] of DATE_FORMATS) {
    const sample = formatDate(new Date(), id);
    const b = h("button", { type: "button", role: "radio", "aria-checked": String(id === (client.settings.dates ?? "short")) }, sample);
    b.onclick = async () => {
      for (const o of dateModes.children) o.setAttribute("aria-checked", String(o === b));
      client.settings = { ...client.settings, dates: id };
      await store.put("settings", client.settings);
      window.dispatchEvent(new Event("aha-dates")); // the chat draws its replies again
    };
    dateModes.append(b);
  }
  for (const [id, name] of [["app", "In the app"], ["browser", "In my browser"]] as const) {
    const b = h("button", { type: "button", role: "radio", "aria-checked": String(id === (client.settings.links ?? "app")) }, name);
    b.onclick = async () => {
      for (const o of linkModes.children) o.setAttribute("aria-checked", String(o === b));
      client.settings = { ...client.settings, links: id };
      await store.put("settings", client.settings);
    };
    linkModes.append(b);
  }
  const unpair = h("button", { class: "btn danger", type: "button" }, "Unpair");
  // Settings → Connections (SPEC §7.4): what Aha! is connected to for this person; the address only.
  // Settings → Connections (SPEC §7.4): one row per connected account, each with its own Disconnect.
  const connections = h("div", {}, h("p", { class: "fine" }, "Checking…"));
  const reportBtn = h("button", { class: "btn", type: "button" }, "Report");
  const modes = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Appearance" });
  for (const m of APPEARANCES) {
    const b = h("button", { type: "button", role: "radio", "aria-checked": String(m.id === (client.settings.appearance ?? "auto")) }, m.name);
    b.onclick = async () => {
      for (const o of modes.children) o.setAttribute("aria-checked", String(o === b));
      applyTheme(client.settings.theme, m.id);
      client.settings = { ...client.settings, appearance: m.id };
      await store.put("settings", client.settings);
    };
    modes.append(b);
  }
  const swatches = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Colour" });
  for (const t of THEMES) {
    const dot = h("i");
    dot.style.background = t.swatch; // CSSOM, which the CSP allows (no inline style attributes)
    const b = h("button", { class: "swatch", type: "button", role: "radio", "aria-checked": String(t.id === client.settings.theme) }, dot, t.name);
    b.onclick = async () => {
      for (const o of swatches.children) o.setAttribute("aria-checked", String(o === b));
      applyTheme(t.id, client.settings.appearance);
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
      h(
        "section",
        {},
        h("h4", {}, "Your history"),
        h("div", { class: "row" }, h("span", {}, "Keep my history", h("small", {}, "On your computer. This device keeps the last 5 days; scroll up for older messages.")), keep),
        historyNote,
      ),
      h(
        "section",
        {},
        h("h4", {}, "Your browser"),
        h("p", { class: "fine" }, "Aha!'s browser remembers sites like your own browser does, so you stay signed in. On trusted sites it acts without asking you first. Logins you chose to save are kept encrypted on your computer."),
        sites,
        h("div", { class: "row" }, h("span", {}, "Trust a site", h("small", {}, "Acts there without asking.")), h("span", { class: "site-actions" }, trustInput, trustBtn)),
        siteNote,
      ),
      h(
        "section",
        {},
        h("h4", {}, "Connections"),
        connections,
      ),
      h("section", {}, h("h4", {}, "Your devices"), devices),
      h(
        "section",
        {},
        h("h4", {}, "Model"),
        h("div", { class: "row" }, h("span", {}, "Aha!'s model", modelAbout), model),
        h("p", { class: "fine" }, "For everyone in your household. The first reply after a change takes a little longer while it loads."),
        modelNote,
      ),
      h(
        "section",
        {},
        h("h4", {}, "Clear"),
        h("div", { class: "row" }, h("span", {}, "Chat history", h("small", {}, "From your computer and all your devices. Memories, reminders and sign-ins stay.")), clearHistory),
        h("div", { class: "row" }, h("span", {}, "Browser data", h("small", {}, "Everything Aha!'s browser remembers: signs you out of every site. Trusted sites stay.")), clearBrowser),
      ),
      h(
        "section",
        {},
        h("h4", {}, "This device"),
        h("div", { class: "row" }, h("span", {}, "Notifications", h("small", {}, "They only say “New message from Aha!”.")), notify),
        h("div", { class: "row col-row" }, h("span", {}, "Open links", h("small", {}, "In the installed app on a phone: over the app, or in your phone's browser.")), linkModes),
        h("div", { class: "row col-row" }, h("span", {}, "Dates", h("small", {}, "How dates in replies read, on this device.")), dateModes),
        h("div", { class: "row" }, h("span", {}, "Unpair this device", h("small", {}, "Deletes its keys and cached messages.")), unpair),
      ),
      h("section", {}, h("h4", {}, "Appearance"), modes),
      h("section", {}, h("h4", {}, "Colour"), swatches),
      h("section", {}, h("h4", {}, "Help"), h("div", { class: "row" }, h("span", {}, "Report a problem", h("small", {}, "You choose what's shared, and see it before it's sent.")), reportBtn)),
      h(
        "section",
        {},
        h("h4", {}, "Your computer"),
        h(
          "div",
          { class: "row" },
          h("span", {}, client.identity.home, h("small", {}, client.identity.fp ? "Fingerprint: compare with `aha status` on your computer." : "Pair again to see its fingerprint.")),
          h("code", { class: "fp" }, client.identity.fp ? shortFingerprint(client.identity.fp) : "—"),
        ),
      ),
      h("p", { class: "fine" }, `Aha! ${APP_VERSION} (${BUILD}) · end-to-end encrypted (AHA-PQ v1) · `, h("a", { href: "https://github.com/axxlabs/aha-app", target: "_blank", rel: "noopener noreferrer" }, "source (AGPL-3.0)")),
    ),
  ) as HTMLDialogElement;
  document.body.append(dialog);
  // On a wide screen Settings is a pane beside the chat, which stays usable; on a narrow one, a sheet over it.
  const wide = matchMedia(PANE_MEDIA);
  const place = () => {
    if (dialog.open) dialog.close();
    document.body.classList.toggle("with-pane", wide.matches);
    if (wide.matches) dialog.show();
    else dialog.showModal();
  };
  place();
  wide.addEventListener("change", place);
  const shut = () => {
    wide.removeEventListener("change", place);
    document.body.classList.remove("with-pane");
    dialog.close();
    dialog.remove();
    onClose();
  };
  close.onclick = shut;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    shut();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dialog.matches(":modal")) shut();
  });
  void client.send({ t: "memories_request" });
  void client.send({ t: "history_settings_request" });
  void client.send({ t: "devices_request" });
  void client.send({ t: "browser_request" });
  void client.send({ t: "connections_request" });
  void client.send({ t: "model_request" });

  model.onchange = async () => {
    const id = model.value;
    describeModel(id);
    setModelNote("");
    model.disabled = true;
    if (!(await client.send({ t: "model_set", model: id }))) {
      setModelNote("Your computer is offline: try again when it's back.");
      model.value = currentModel;
      describeModel(currentModel);
      model.disabled = false;
    }
  };
  keep.onchange = async () => {
    const days = keep.value === "forever" ? null : Number(keep.value);
    const shorter = days !== null && (client.settings.historyDays == null || days < client.settings.historyDays);
    const label = keep.selectedOptions[0]?.textContent ?? "";
    if (shorter && !confirm(`Keep ${label.toLowerCase()} of history? Anything older is deleted from your computer now.`)) {
      showKeep(client.settings.historyDays);
      return;
    }
    keep.disabled = true;
    if (!(await client.send({ t: "history_settings_set", days }))) {
      note("Your computer is offline: try again when it's back.");
      showKeep(client.settings.historyDays);
      keep.disabled = false;
    }
  };
  clearHistory.onclick = async () => {
    if (!confirm("Delete your chat history from your computer and all your devices? Memories, reminders and sign-ins stay.")) return;
    clearHistory.disabled = true;
    if (await client.send({ t: "history_clear" })) clearHistory.textContent = "Chat history cleared";
    else {
      note("Your computer is offline: try again when it's back.");
      clearHistory.disabled = false;
    }
  };
  trustBtn.onclick = async () => {
    const site = trustInput.value.trim();
    if (!site) return;
    siteNote.hidden = true;
    trustBtn.disabled = true;
    if (await client.send({ t: "browser_trust", site, trusted: true })) trustInput.value = "";
    else {
      trustBtn.disabled = false;
      siteNote.textContent = "Your computer is offline: try again when it's back.";
      siteNote.hidden = false;
    }
  };
  trustInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") trustBtn.click();
  });
  clearBrowser.onclick = async () => {
    if (!confirm("Clear everything Aha!'s browser remembers? You'll be signed out of every site and saved logins are deleted. Trusted sites stay.")) return;
    clearBrowser.disabled = true;
    if (!(await client.send({ t: "browser_clear" }))) {
      clearBrowser.disabled = false;
      alert("Your computer is offline: try again when it's back.");
    }
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
    await client.send({ t: "hello", name: client.identity.deviceName, version: `${APP_VERSION} (${BUILD})`, push: sub.toJSON() });
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
    if (!confirm("Unpair this device? It won't be able to reach Aha! any more, and its keys and cached messages will be deleted. Pair it again with a new QR code.")) return;
    await client.send({ t: "revoke_device", device: client.dev });
    client.stop();
    await store.wipe();
    location.reload();
  };

  return {
    close: shut,
    showModel(m) {
      models = m.choices;
      currentModel = m.current;
      model.replaceChildren(
        ...m.choices.map((c) => h("option", c.ready || c.id === m.current ? { value: c.id } : { value: c.id, disabled: "" }, c.ready || c.id === m.current ? c.name : `${c.name} (not downloaded)`)),
      );
      model.value = m.current;
      model.disabled = m.choices.length < 2;
      describeModel(m.current);
    },
    modelNote(text) {
      setModelNote(text);
      model.value = currentModel;
      describeModel(currentModel);
      model.disabled = false;
    },
    showHistory(days) {
      showKeep(days);
      keep.disabled = false;
      clearHistory.disabled = false;
      note("");
    },
    onReport(msg) {
      report?.onReport(msg);
    },
    showMemories(list) {
      memories.replaceChildren(
        ...(list.length
          ? list.map((m) => {
              const forget = h("button", { class: "btn", type: "button" }, "Forget");
              forget.onclick = async () => {
                if (!confirm(`Forget “${m.text}”?`)) return;
                forget.setAttribute("disabled", "");
                if (!(await client.send({ t: "memory_forget", id: m.id }))) forget.removeAttribute("disabled");
              };
              return h("div", { class: "row" }, h("span", {}, m.text), forget);
            })
          : [h("p", { class: "fine" }, "Nothing yet.")]),
      );
    },
    browserNote(text) {
      siteNote.textContent = text;
      siteNote.hidden = !text;
    },
    showConnections(emails) {
      const how = `run \`aha mail connect ${client.identity.name}\` on your computer`;
      const rows = emails.map((email) => {
        const btn = h("button", { class: "btn danger", type: "button" }, "Disconnect");
        btn.onclick = async () => {
          if (!confirm(`Disconnect ${email}? Aha! won't be able to use its email or calendar until it's connected again.`)) return;
          btn.setAttribute("disabled", "");
          if (!(await client.send({ t: "email_disconnect", email }))) {
            btn.removeAttribute("disabled");
            alert("Your computer is offline: try again when it's back.");
          }
        };
        return h("div", { class: "row" }, h("span", {}, email, h("small", {}, "Google: Gmail and Calendar")), btn);
      });
      connections.replaceChildren(
        ...rows,
        h("p", { class: "fine" }, emails.length ? `To add another account, ${how} again.` : `Not connected. To connect, ${how}.`),
      );
    },
    showBrowser(list) {
      clearBrowser.disabled = !list.some((s) => !s.trusted || s.signed_in || s.login_saved);
      clearBrowser.textContent = "Clear browser";
      trustBtn.disabled = false;
      sites.replaceChildren(
        ...(list.length
          ? list.map((s) => {
              const forget = h("button", { class: "btn", type: "button" }, "Forget");
              forget.onclick = async () => {
                if (!confirm(`Forget ${s.site}? You'll be signed out there${s.login_saved ? " and its saved login is deleted" : ""}.`)) return;
                forget.setAttribute("disabled", "");
                if (!(await client.send({ t: "browser_forget", site: s.site }))) forget.removeAttribute("disabled");
              };
              const forgetLogin = h("button", { class: "btn", type: "button" }, "Forget login");
              forgetLogin.onclick = async () => {
                if (!confirm(`Forget the saved login for ${s.site}?`)) return;
                forgetLogin.setAttribute("disabled", "");
                if (!(await client.send({ t: "login_forget", site: s.site }))) forgetLogin.removeAttribute("disabled");
              };
              const tags = [s.signed_in ? "signed in" : "", s.login_saved ? "login saved" : ""].filter(Boolean);
              // Trusted (SPEC §5.7): Aha! acts on this site without asking.
              const trust = h("input", { type: "checkbox", "aria-label": `Trust ${s.site}` }) as HTMLInputElement;
              trust.checked = s.trusted;
              trust.onchange = async () => {
                trust.disabled = true;
                if (!(await client.send({ t: "browser_trust", site: s.site, trusted: trust.checked }))) {
                  trust.checked = !trust.checked;
                  trust.disabled = false;
                }
              };
              return h(
                "div",
                { class: "row" },
                h("span", {}, s.site, ...(tags.length ? [h("small", {}, tags.join(" · "))] : [])),
                h("span", { class: "site-actions" }, h("label", { class: "trust" }, trust, "Trusted"), ...(s.login_saved ? [forgetLogin] : []), forget),
              );
            })
          : [h("p", { class: "fine" }, "Nothing yet.")]),
      );
    },
    showDevices(list) {
      devices.replaceChildren(
        ...list.map((d) => {
          const seen = d.last_seen ? new Date(d.last_seen * 1000).toLocaleString() : "never";
          const row = h("div", { class: "row" }, h("span", {}, d.name + (d.this ? " (this device)" : ""), h("small", {}, `last seen ${seen}`)));
          const b = h("button", { class: "btn danger", type: "button" }, "Revoke");
          // This device too: the same as Unpair (its keys and cached messages are deleted here).
          b.onclick = d.this
            ? () => unpair.click()
            : async () => {
                if (confirm(`Revoke “${d.name}”? It won't be able to reach Aha! any more.`)) await client.send({ t: "revoke_device", device: d.id });
              };
          row.append(b);
          return row;
        }),
      );
    },
  };
}

void boot();
