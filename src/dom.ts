// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// Small DOM helpers shared by the app's screens.
declare const __BUILD__: string;
export const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

export function icon(path: string): SVGSVGElement {
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

export const ICONS = {
  send: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  memory: '<path d="M2 4h6a4 4 0 014 4v13a3 3 0 00-3-3H2z"/><path d="M22 4h-6a4 4 0 00-4 4v13a3 3 0 013-3h7z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  photo: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
};

// A photo for sha (SPEC §7.4): at most 1600 px on its longest side, re-encoded as JPEG, which also drops its

const PANE_MEDIA = "(min-width: 1400px)"; // 30% of it is at least the sheet's 420px; keep in step with style.css

/** A panel (Settings, Memory): a pane beside the chat on a wide screen, which stays usable; on a narrow one, a
 * sheet over it. `shut` closes and removes it, then calls `onClose`. */
let infoIds = 0;

/** A small (i) button with its popup (SPEC §7.4): a card's "why". Shown on hover or focus, kept open by a click or
 * tap (phones have no hover), closed by another click, a tap elsewhere or Escape. Append both, the popup right
 * after the button. */
export function infoPopup(content: string | Node, label: string): [HTMLButtonElement, HTMLElement] {
  const tip = h("div", { class: "why", role: "tooltip", id: `info-${++infoIds}` }, content);
  const info = h("button", { class: "info", type: "button", "aria-label": label, title: label, "aria-expanded": "false", "aria-describedby": tip.id }, "i") as HTMLButtonElement;
  const outside = (e: Event) => {
    if (!info.contains(e.target as Node) && !tip.contains(e.target as Node)) pin(false);
  };
  const pin = (open: boolean) => {
    info.setAttribute("aria-expanded", String(open));
    if (open) document.addEventListener("pointerdown", outside, true);
    else document.removeEventListener("pointerdown", outside, true);
  };
  // Opens downward, or upward when there's no room below: the chat's own area clips it (the input box under it,
  // the last topic's popup hidden behind it).
  const place = () =>
    requestAnimationFrame(() => {
      tip.classList.remove("up");
      const box = tip.getBoundingClientRect();
      if (!box.height) return; // not shown
      const area = (info.closest("main") ?? document.documentElement).getBoundingClientRect();
      const bottom = Math.min(area.bottom, window.innerHeight);
      const above = info.getBoundingClientRect().top - Math.max(area.top, 0);
      if (box.bottom > bottom - 4 && above > box.height + 8) tip.classList.add("up");
    });
  info.addEventListener("pointerenter", place);
  info.addEventListener("focus", place);
  info.onclick = (e) => {
    e.stopPropagation();
    pin(info.getAttribute("aria-expanded") !== "true");
    place();
  };
  info.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") pin(false);
  };
  tip.onclick = (e) => e.stopPropagation();
  return [info, tip];
}

export function openSheet(label: string, content: Node, onClose: () => void): { dialog: HTMLDialogElement; shut: () => void } {
  const dialog = h("dialog", { class: "sheet", "aria-label": label }, content) as HTMLDialogElement;
  document.body.append(dialog);
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
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    shut();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dialog.matches(":modal")) shut();
  });
  return { dialog, shut };
}
