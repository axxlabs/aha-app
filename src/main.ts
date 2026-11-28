// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// The SHA app (SPEC §7.4): one GPT-style conversation with your own computer, end-to-end encrypted.

import "./style.css";
import { applyTheme } from "./themes";
import { APP_VERSION, Client, pruneCache, shortFingerprint, DEFAULT_SETTINGS, type Identity, type Settings, pair, parsePairLink } from "./client";
import { type Tap, MAX_TAPS, checkButton, tapOnImage, tapsValue } from "./taps";
import { Ratchet, type RatchetState, b64e } from "./crypto";
import { chatView } from "./view";
import { BUILD, ICONS, h, icon, infoPopup } from "./dom";
import { detailsLines } from "./details";
import { statsPanel } from "./stats";
import { type SettingsUi, openSettings } from "./settings";
import { type MemoryUi, openMemory } from "./memory";
import { type BackgroundTask, type TasksUi, everyWords, openTasks, runningCards, startedMarks } from "./tasks";
import { NOTE_KINDS, type Part, dayWords, gist } from "./fold";
import { render } from "./markdown";
import { receipt, receiptLines } from "./receipt";
import { externalUrl, platform, standalone } from "./links";
import { type Item, type Photo, Store } from "./store";

const app = document.getElementById("app") as HTMLElement;

// A photo for SHA (SPEC §7.4): at most 1600 px on its longest side, re-encoded as JPEG, which also drops its
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
  return h("div", { class: "mark", "aria-label": "SHA" }, h("span", {}, "ah"), h("span", { class: "a" }, "a"));
}

function screen(...children: (Node | string)[]): HTMLElement {
  app.replaceChildren(h("div", { class: "screen" }, ...children));
  return app;
}

// ---- boot

async function boot(): Promise<void> {
  if (!window.isSecureContext || !crypto.subtle) {
    screen(mark(), h("h1", {}, "Secure connection needed"), h("p", {}, "Open SHA over https (or on this computer at localhost)."));
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
    h("h1", {}, "SHA, a self-hosted assistant"),
    h("p", {}, "To use SHA, pair this device with your own computer: run ", h("code", {}, "aha pair <your name>"), " there and scan the QR code it shows."),
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
      copy.textContent = "Copied: now open SHA from your Home Screen and paste it";
    } catch {
      copy.textContent = "Couldn't copy";
    }
  };
  const iphoneBox =
    onIphone() && !standalone()
      ? h(
          "div",
          { class: "note-box" },
          h("p", {}, h("b", {}, "Using SHA from your Home Screen?"), " Pair there, not here: on iPhone the Home Screen app keeps its own data, separate from Safari, so a pairing made in Safari isn't in it."),
          h("p", { class: "fine" }, "Copy the link, add SHA to your Home Screen (Share → Add to Home Screen), open it from there and paste the link."),
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
    h("p", {}, `This connects this device to SHA on “${data.home}”. Everything you write is end-to-end encrypted to that computer.`),
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
      screen(mark(), h("h1", {}, "SHA is open in another tab"), h("p", {}, "Use that tab, or close it and reload this one."));
      return;
    }
  }

  const statusText = h("b", {});
  const dot = h("span", { class: "dot" });
  const statusBox = h("div", { class: "status" }, h("span", {}, dot, statusText), h("span", { class: "lock" }, icon(ICONS.lock), " End-to-end encrypted"));
  const live = statsPanel(); // between "home · online" and the buttons (SPEC §7.4 "Live diagnostics")
  const menu = h("button", { class: "icon-btn", type: "button", "aria-label": "Settings", title: "Settings" }, icon(ICONS.gear));
  const memoryBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Memory", title: "Memory" }, icon(ICONS.memory));
  const tasksBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Tasks", title: "Tasks" }, icon(ICONS.tasks));
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
  const workingText = h("span", {}, " SHA is working…");
  const working = h("div", { class: "working", hidden: "", role: "status" }, h("i"), h("i"), h("i"), workingText);
  const input = h("textarea", { rows: "1", placeholder: "Ask SHA anything", "aria-label": "Message", enterkeyhint: "enter", maxlength: "20000" }) as HTMLTextAreaElement;
  const sendBtn = h("button", { class: "send", type: "submit", "aria-label": "Send" }, icon(ICONS.send));
  const photoBtn = h("button", { class: "attach", type: "button", "aria-label": "Add a photo" }, icon(ICONS.photo));
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: "" }) as HTMLInputElement;
  const attachment = h("div", { class: "attachment", hidden: "" });
  let photo: Photo | null = null;
  const form = h("form", {}, photoBtn, fileInput, input, sendBtn);
  // Fold the conversation going on now, on every device; the next message starts a new part (SPEC §7.4).
  const cutBtn = h("button", { class: "cut", type: "button", hidden: "", title: "Fold this conversation away: what you write next starts a new topic" }, "[close current conversation into new topic]");
  cutBtn.onclick = () => void client.send({ t: "cut" });
  const collapseAllBtn = h("button", { class: "cut", type: "button", hidden: "", title: "Fold every topic you opened" }, "[collapse all]");
  collapseAllBtn.onclick = () => view.collapseAll();
  const chatActions = h("div", { class: "chat-actions" }, collapseAllBtn, cutBtn);
  // Safari deletes a non-installed site's storage after 7 days without a visit, and the pairing with it (SPEC §9.2).
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const installHint = h("div", { class: "banner" }, "Safari may delete this pairing after 7 days without a visit. To keep SHA on your Home Screen, add it (Share → Add to Home Screen) and pair it again there: it keeps its own data, so this pairing isn't in it.");
  installHint.hidden = !ios || installed;
  app.replaceChildren(
    h("header", { class: "top" }, mark(), h("div", { class: "right" }, statusBox, live.el, tasksBtn, memoryBtn, menu)),
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
    marks,
    cut: cutBtn,
    collapseAll: collapseAllBtn,
    actions: chatActions,
  });
  // The background tasks, to mark the topics that started them (null until the computer sent the list).
  let tasks: BackgroundTask[] | null = null;

  /** Which task cards' tasks still run, over the whole chat (a task belongs to one card only). */
  function running(states: Map<string, string>): Map<string, BackgroundTask> | null {
    const cards = [...view.items.values()].filter((it) => it.t === "approval" && it.kind === "task").map((it) => ({ id: String(it.id), ts: it.ts }));
    return runningCards(cards, states, tasks);
  }

  /** A folded topic's icons (SPEC §7.4 "Folding"): a small box for each kind of task note in it, drawn like the
   * note itself, and the tasks it started, still running or ended. Each is a button with the (i)'s popup: which
   * task, and the gist of what it found. */
  function marks(p: Part, states: Map<string, string>): Node[] {
    const mark = (face: Node, label: string, ...lines: Node[]) => h("span", { class: "mark-wrap" }, ...infoPopup(h("div", {}, ...lines), label, "mark", face));
    const line = (title: string, words: string) => h("p", {}, h("b", {}, title || "A background task"), words ? h("small", {}, words) : "");
    const run = running(states);
    const started = startedMarks(p.started, states, run).map(({ running: on, cards }) => {
      const head = `Started here: ${cards.length > 1 ? `${cards.length} background tasks` : "a background task"}, ${on ? "still running" : "ended"}`;
      const lines = cards.map((c) => {
        const t = run?.get(c.id);
        return line(t?.title || c.title, !on ? "" : t?.last ? `Last check: ${gist(t.last)}` : "Not checked yet");
      });
      return mark(h("span", { class: `task-mark ${on ? "running" : "ended"}` }, icon(ICONS.tasks)), head, h("header", {}, head), ...lines);
    });
    const heads: Record<string, string> = { update: "Task update", done: "Task done", failed: "Task failed" };
    const notes = NOTE_KINDS.flatMap((k) => {
      const of = p.notes.filter((n) => n.kind === k);
      if (!of.length) return [];
      const head = of.length > 1 ? `${heads[k]} ×${of.length}` : heads[k];
      // The latest three, newest last, as in the chat.
      return [mark(h("span", { class: `note-mark ${k}` }), `${head} in this topic`, h("header", { class: k }, head), ...of.slice(-3).map((n) => line(n.title, gist(n.text))))];
    });
    return [...started, ...notes];
  }

  const toBottom = view.toBottom;

  function dayLabel(ts: number): string {
    return dayWords(ts, Date.now() / 1000, client.settings.dates);
  }

  /** Live diagnostics only while the app is on screen (SPEC §7.4): each reading is a saved step of the device's
   * encryption on the computer, so a hidden app asks for none. */
  function watchStats(): void {
    if (client?.computer) void client.send({ t: "stats_watch", on: document.visibilityState === "visible" });
  }
  let details: ReturnType<typeof detailsLines> | null = null; // each request's Details line (SPEC §7.4); made with the client
  // The person's connected accounts, shown as labels in replies (SPEC §7.4 "Labels"); asked once online.
  let accounts: string[] = [];
  let askedAccounts = false;
  function relabel(list: string[]): void {
    if (list.join() === accounts.join()) return;
    accounts = list;
    view.remake((it) => it.t === "msg" && it.role === "aha"); // drawn again with the labels
  }
  window.addEventListener("aha-dates", () => view.remake((it) => it.t === "msg" && it.role === "aha"));

  /** A background task's note on a message: its kind's words and the task's title, or null. */
  function taskNote(task: unknown): { kind: string; head: string; title: string; prompt: string; every: number } | null {
    if (!task || typeof task !== "object") return null;
    const { kind, title, prompt, every } = task as { kind?: unknown; title?: unknown; prompt?: unknown; every?: unknown };
    const heads: Record<string, string> = { update: "Task update", done: "Task done", failed: "Task failed" };
    const k = typeof kind === "string" && kind in heads ? kind : "update";
    return { kind: k, head: heads[k], title: typeof title === "string" ? title : "", prompt: typeof prompt === "string" ? prompt : "", every: typeof every === "number" && every > 0 ? every : 0 };
  }

  function node(it: Item): HTMLElement | null {
    if (it.t === "msg" && it.role === "me") {
      const el = h("div", { class: "me" }, String(it.text ?? ""));
      const img = it.image as { mime?: string; b64?: string } | undefined;
      if (img && /^image\/(png|jpeg|webp)$/.test(img.mime ?? "")) el.prepend(h("img", { class: "photo", alt: "Your photo", src: `data:${img.mime};base64,${img.b64}` }));
      return el;
    }
    if (it.t === "msg") {
      const text = String(it.text ?? "");
      const el = h("div", { class: "aha" });
      el.innerHTML = render(text, accounts, client.settings.dates); // html disabled; labels
      const img = it.image as { mime?: string; b64?: string } | undefined;
      if (img && /^image\/(png|jpeg|webp)$/.test(img.mime ?? "")) el.append(h("img", { class: "shot", alt: "Screenshot", src: `data:${img.mime};base64,${img.b64}` }));
      const run = typeof it.run === "string" ? it.run : "";
      if (run) {
        // A request's answer (SPEC §7.4): what it did is already in the chat, where each thing happened; its
        // Details line comes after the answer, closed, one click to open.
        const tail = details ? [details.line(it.seq, run)] : [];
        return h("div", { class: "aha-turn" }, ...(text.trim() || img ? [el] : []), ...tail);
      }
      // A background task's note, or an answer from before boxes: the receipt, drawn apart from the model's words.
      const done = receiptLines(it.record);
      const rec = done.length ? receipt(done) : null;
      const body = rec && !text.trim() && !img ? rec : rec ? h("div", { class: "aha-turn" }, el, rec) : el;
      const note = taskNote(it.task);
      if (note) {
        // A background task's news (SPEC §7.4 "Task notes"): a box with a small title saying which task ran.
        const box = h("section", { class: `task-note ${note.kind}`, "aria-label": `${note.head}: ${note.title}` }, h("header", {}, h("b", {}, note.head), h("span", {}, note.title)), body);
        // Its (i): the task's full description, what each check does and how often (SPEC §7.4 "Task notes").
        if (note.prompt) {
          const about = h("div", {}, h("b", {}, note.title), h("p", {}, note.prompt), note.every ? h("small", {}, everyWords(note.every)) : "");
          box.append(...infoPopup(about, "What this task does", "about"));
        }
        return box;
      }
      return body;
    }
    if (it.t === "approval") return approvalCard(it);
    // A request's Details line (SPEC §7.4 "Details"): what the model is doing, live, closed until opened.
    // Where a request's work starts: nothing shows there (SPEC §7.4).
    if (it.t === "steps") return null;
    // One thing a request did, where it happened (SPEC §7.4 "What SHA did"): the computer's line, not the model's.
    if (it.t === "act" && typeof it.text === "string") return h("div", { class: "act", role: "note", "aria-label": "SHA did" }, h("span", { class: "tick", "aria-hidden": "true" }, "✓"), it.text);
    // A tool line from before Details lines: side info, not part of a reply.
    return null;
  }

  function approvalCard(it: Item): HTMLElement {
    const id = String(it.id);
    const fields = (it.fields as { label: string; value: string; editable: boolean; kind?: string }[]) ?? [];
    const buttons = (it.buttons as string[]) ?? ["Approve", "Decline"];
    const dl = h("dl", {});
    const inputs: (HTMLInputElement | HTMLTextAreaElement | null)[] = [];
    fields.forEach((f) => {
      const hidden: Record<string, string> = f.kind === "taps" ? { hidden: "" } : {}; // a check card's taps are made on the screenshot
      const cls = f.kind === "longtext" ? "long" : f.kind === "bool" ? "tick" : "";
      dl.append(h("dt", cls === "tick" ? { class: "tick", ...hidden } : hidden, f.label));
      // A tick reads as ✓ or —; only Edit makes it a checkbox.
      const dd = h("dd", cls ? { class: cls, ...hidden } : hidden, cls === "tick" ? (f.value === "true" ? "✓" : "—") : f.value);
      dl.append(dd);
      inputs.push(null);
    });
    const stateEl = h("div", { class: "state" });
    const actions = h("div", { class: "actions" });
    // The computer sends each card's icon (SPEC §6.5); a card from an older computer has none.
    const icon = typeof it.icon === "string" && it.icon.length <= 8 ? it.icon : "✋";
    const card = h("article", { class: `card card-${String(it.kind ?? "action")}` }, h("h3", {}, `${icon} ${String(it.title)}`));
    // Why this card is shown, as the computer's code decided it (SPEC §5.2, §7.4): one popup under the (i), shown
    // on hover and kept open by a click or tap (phones have no hover); a click elsewhere or Escape closes it.
    const why = typeof it.why === "string" ? it.why.trim() : "";
    if (why) {
      card.classList.add("has-why");
      card.append(...infoPopup(why, "Why am I asked?"));
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
    // "Always allow for this task" (SPEC §5.3): on every action card; ticked, the same action isn't asked again
    // in this request, or in any of a background task's checks.
    const always = it.always === true ? (h("input", { type: "checkbox" }) as HTMLInputElement) : null;
    card.append(dl, ...(always ? [h("label", { class: "always" }, always, h("span", {}, "Always allow for this task"))] : []), actions, stateEl);
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
      const sent = await client.send({ t: "approval_reply", id, decision: "approve", ...(editing ? { values } : {}), ...(always?.checked ? { always: true } : {}) });
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
          if (!fields[i].editable && fields[i].kind !== "bool") return; // a tick: Edit can revoke it
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
    // A background task's check asks (SPEC §7.4): the card is drawn in that task's box, like its notes.
    const task = it.task && typeof it.task === "object" ? (it.task as { title?: unknown }) : null;
    if (task) {
      const title = typeof task.title === "string" ? task.title : "";
      return h("section", { class: "task-note asks", "aria-label": `Task asks: ${title}` }, h("header", {}, h("b", {}, "Task asks"), h("span", {}, title)), card);
    }
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
    banner.textContent = "Your SHA computer is offline. What you write waits here and is sent when it's back.";
  }

  // The send button turns into Stop while SHA works, but only from 1.5 s after the last send, so a double tap
  // or a second tap on Send never cancels the message just sent (SPEC §7.4).
  const STOP_GRACE = 1500;
  let lastSend = 0;
  const stopMode = () => busy && !input.value.trim() && !photo && Date.now() - lastSend >= STOP_GRACE;
  function setBusy(on: boolean): void {
    if (on !== busy) view.invalidate(); // while SHA works, the part going on doesn't fold
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
      workingText.textContent = queued ? " SHA is finishing someone else's request first…" : " SHA is working…";
      setBusy(on);
      if (!on) details?.idle();
    },
    status(s) {
      setStatus(s.connected, s.computer);
      if (!s.computer) live.hide();
      else watchStats(); // a reconnected computer has forgotten who's watching
      if (s.computer && !askedAccounts) {
        askedAccounts = true;
        void client.send({ t: "connections_request" });
        void client.send({ t: "tasks_request" }); // which topics' tasks still run (their fold lines' icons)
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
    memories(list, topics) {
      memoryUi?.show(list, topics);
    },
    tasks(state) {
      tasksUi?.show(state);
      tasks = state.items;
      view.invalidate();
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
      details?.trace(seq, events);
    },
    step(task, event) {
      details?.step(task, event);
    },
    stats(s) {
      live.show(s);
    },
    report(msg) {
      settingsUi?.onReport(msg);
    },
    error(code) {
      if (code === "bad_model") settingsUi?.modelNote("That model isn't on your computer. Run `aha models` there to download it.");
      if (code === "bad_site") settingsUi?.browserNote("That isn't a web site's name. Type it like waitrose.com.");
      if (code === "other_tab") screen(mark(), h("h1", {}, "SHA is open somewhere else"), h("p", {}, "This device connected again from another tab or window."));
      if (code === "pin") screen(mark(), h("h1", {}, "Gateway key changed"), h("p", { class: "error" }, "The gateway's key no longer matches the one from pairing, so SHA won't connect. Pair this device again."));
    },
    async revoked() {
      client.stop();
      await store.wipe();
      screen(mark(), h("h1", {}, "This device was unpaired"), h("p", {}, "Its keys and cached messages were deleted. Pair it again with a new QR code from your computer."));
    },
  });
  details = detailsLines(client);

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

  // Settings, Memory and Tasks share the side pane: each button toggles its own, and opening one closes the others.
  let settingsUi: SettingsUi | null = null;
  let memoryUi: MemoryUi | null = null;
  let tasksUi: TasksUi | null = null;
  const closePanes = () => {
    settingsUi?.close();
    memoryUi?.close();
    tasksUi?.close();
  };
  menu.onclick = () => {
    if (settingsUi) return settingsUi.close();
    closePanes();
    settingsUi = openSettings(store, client, () => (settingsUi = null));
  };
  memoryBtn.onclick = () => {
    if (memoryUi) return memoryUi.close();
    closePanes();
    memoryUi = openMemory(client, () => (memoryUi = null));
  };
  tasksBtn.onclick = () => {
    if (tasksUi) return tasksUi.close();
    closePanes();
    tasksUi = openTasks(client, () => (tasksUi = null), {
      // A task's latest note in the chat (it carries the task's id), for the panel's link to it.
      latest(id) {
        let found: { seq: number; text: string } | null = null;
        for (const it of view.items.values()) {
          const task = it.task as { id?: unknown } | undefined;
          if (it.t === "msg" && task?.id === id && (!found || it.seq > found.seq)) found = { seq: it.seq, text: String(it.text ?? "") };
        }
        return found;
      },
      reveal: (seq) => view.reveal(seq),
    });
  };

  // A break can happen while the app is open in the background: fold when it's looked at again.
  document.addEventListener("visibilitychange", () => {
    watchStats();
    if (document.visibilityState !== "visible") return;
    view.invalidate(true);
  });

  // keep the cache window: prune every hour while open
  setInterval(() => {
    void pruneCache(store, client.settings);
  }, 3_600_000);

  if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register("/sw.js");
}

void boot();
