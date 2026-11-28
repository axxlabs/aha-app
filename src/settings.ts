// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Settings (SPEC §7.4), and the problem report view inside it (§7.7).
import { APPEARANCES, THEMES, applyTheme } from "./themes";
import { APP_VERSION, type BrowserSite, type Client, HISTORY_CHOICES, type ModelChoice, shortFingerprint } from "./client";
import { DATE_FORMATS, formatDate } from "./markdown";
import { BUILD, ICONS, h, icon, openSheet } from "./dom";
import { b64urlDecode } from "./crypto";
import type { Store } from "./store";
export interface SettingsUi {
  showHistory(days: number | null): void;
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
    h("label", { class: "row", for: "report-details" }, h("span", {}, "Include technical details", h("small", {}, "The searches, pages and tools SHA used for these messages. Helps us find the problem.")), details),
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

export function openSettings(store: Store, client: Client, onClose: () => void): SettingsUi {
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon(ICONS.close));
  const devices = h("div", {}, h("p", { class: "fine" }, client.computer ? "Loading…" : "Your computer is offline."));
  // Your browser (SPEC §3.4, §7.4): what SHA's browser on the computer remembers for this person.
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
  // Settings → Connections (SPEC §7.4): what SHA is connected to for this person; the address only.
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
  const content = h(
      "div",
      { class: "sheet-in" },
      h("header", {}, h("h2", {}, "Settings"), close),
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
        h("p", { class: "fine" }, "SHA's browser remembers sites like your own browser does, so you stay signed in. On trusted sites it acts without asking you first. Logins you chose to save are kept encrypted on your computer."),
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
        h("div", { class: "row" }, h("span", {}, "SHA's model", modelAbout), model),
        h("p", { class: "fine" }, "For everyone in your household. The first reply after a change takes a little longer while it loads."),
        modelNote,
      ),
      h(
        "section",
        {},
        h("h4", {}, "Clear"),
        h("div", { class: "row" }, h("span", {}, "Chat history", h("small", {}, "From your computer and all your devices. Memories, tasks and sign-ins stay.")), clearHistory),
        h("div", { class: "row" }, h("span", {}, "Browser data", h("small", {}, "Everything SHA's browser remembers: every site is forgotten, with its sign-in, saved login and trust.")), clearBrowser),
      ),
      h(
        "section",
        {},
        h("h4", {}, "This device"),
        h("div", { class: "row" }, h("span", {}, "Notifications", h("small", {}, "They only say “New message from SHA”.")), notify),
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
      h("p", { class: "fine" }, `SHA ${APP_VERSION} (${BUILD}) · end-to-end encrypted (AHA-PQ v1) · `, h("a", { href: "https://github.com/axxlabs/aha-app", target: "_blank", rel: "noopener noreferrer" }, "source (AGPL-3.0)")),
    );
  const { dialog, shut } = openSheet("Settings", content, onClose);
  close.onclick = shut;
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
    if (!confirm("Delete your chat history from your computer and all your devices? Memories, tasks and sign-ins stay.")) return;
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
    if (!confirm("Clear everything SHA's browser remembers? Every site is forgotten: you'll be signed out everywhere, saved logins are deleted and no site stays trusted.")) return;
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
    if (!confirm("Unpair this device? It won't be able to reach SHA any more, and its keys and cached messages will be deleted. Pair it again with a new QR code.")) return;
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
    browserNote(text) {
      siteNote.textContent = text;
      siteNote.hidden = !text;
    },
    showConnections(emails) {
      const how = `run \`aha mail connect ${client.identity.name}\` on your computer`;
      const rows = emails.map((email) => {
        const btn = h("button", { class: "btn danger", type: "button" }, "Disconnect");
        btn.onclick = async () => {
          if (!confirm(`Disconnect ${email}? SHA won't be able to use its email or calendar until it's connected again.`)) return;
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
      clearBrowser.disabled = !list.length;
      clearBrowser.textContent = "Clear browser";
      trustBtn.disabled = false;
      sites.replaceChildren(
        ...(list.length
          ? list.map((s) => {
              const forget = h("button", { class: "btn", type: "button" }, "Forget");
              forget.onclick = async () => {
                if (!confirm(`Forget ${s.site}? You'll be signed out there${s.login_saved ? ", its saved login is deleted" : ""}${s.trusted ? ", and it's no longer trusted" : ""}.`)) return;
                forget.setAttribute("disabled", "");
                if (!(await client.send({ t: "browser_forget", site: s.site }))) forget.removeAttribute("disabled");
              };
              // A saved login (SPEC §5.8): a toggle that can only be turned off; a login card saves one.
              const login = h("input", { type: "checkbox", "aria-label": `Saved login for ${s.site}` }) as HTMLInputElement;
              login.checked = true;
              login.onchange = async () => {
                if (!confirm(`Forget the saved login for ${s.site}?`)) {
                  login.checked = true;
                  return;
                }
                login.disabled = true;
                if (!(await client.send({ t: "login_forget", site: s.site }))) {
                  login.checked = true;
                  login.disabled = false;
                }
              };
              // Trusted (SPEC §5.7): SHA acts on this site without asking.
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
                h("span", {}, s.site),
                h("span", { class: "site-actions" }, h("label", { class: "trust" }, trust, "Trusted"), ...(s.login_saved ? [h("label", { class: "trust" }, login, "Login saved")] : []), forget),
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
                if (confirm(`Revoke “${d.name}”? It won't be able to reach SHA any more.`)) await client.send({ t: "revoke_device", device: d.id });
              };
          row.append(b);
          return row;
        }),
      );
    },
  };
}
