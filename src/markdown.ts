// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// Safe Markdown for aha's replies (SPEC §7.4): no raw HTML, no remote images (they would leak that you read
// the message), links only http(s) and mailto, opened without a referrer.

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
md.disable(["image", "lheading"]);
// A heading reads as a bold line in a chat bubble, not a page title (the computer leaves the model's words alone).
md.renderer.rules.heading_open = () => "<p><strong>";
md.renderer.rules.heading_close = () => "</strong></p>\n";

const SAFE_LINK = /^(https?:|mailto:)/i;
md.validateLink = (url: string) => SAFE_LINK.test(url.trim());

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer nofollow");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// Labels (SPEC §7.4 "Labels"): every email address in a reply shows as a small tag, not plain text or a mail link;
// the person's own connected accounts in another colour, so "in fe@work.com" stands out from someone else's
// address. Decided here, from the addresses the computer sent; the model only writes the address.
const escape = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
md.renderer.rules.email_label = (tokens, idx) => {
  const mine = tokens[idx].meta?.mine === true;
  return `<span class="label${mine ? " mine" : ""}" title="${mine ? "Your account" : "Email address"}">${escape(tokens[idx].content)}</span>`;
};
md.core.ruler.push("email_labels", (state) => {
  const accounts: string[] = (state.env as { accounts?: string[] })?.accounts ?? [];
  const mine = new Set(accounts.map((a) => a.toLowerCase()));
  const label = (address: string) => {
    const tok = new state.Token("email_label", "", 0);
    tok.content = address;
    tok.meta = { mine: mine.has(address.toLowerCase()) };
    return tok;
  };
  const text = (content: string) => {
    const tok = new state.Token("text", "", 0);
    tok.content = content;
    return tok;
  };
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out: typeof block.children = [];
    const kids = block.children;
    for (let i = 0; i < kids.length; i++) {
      const t = kids[i];
      // A mailto: link (linkify makes one of every address): the whole link becomes the tag.
      const href = t.type === "link_open" ? String(t.attrGet("href") ?? "") : "";
      if (href.toLowerCase().startsWith("mailto:")) {
        out.push(label(decodeURIComponent(href.slice(7))));
        while (i < kids.length && kids[i].type !== "link_close") i++;
        continue;
      }
      if (t.type !== "text" || !t.content.includes("@")) {
        out.push(t);
        continue;
      }
      let last = 0;
      for (const m of t.content.matchAll(EMAIL)) {
        if (m.index > last) out.push(text(t.content.slice(last, m.index)));
        out.push(label(m[0]));
        last = m.index + m[0].length;
      }
      if (last < t.content.length) out.push(text(t.content.slice(last)));
    }
    block.children = out;
  }
});

// Date labels (SPEC §7.4 "Labels"): sha writes every date as a full date, DD/MM/YYYY, never a weekday (it guesses
// weekdays wrong). Each one shows here as a label, its weekday worked out by the app, in the person's format.
export type DateFormat = "short" | "day" | "long" | "plain" | "numeric";
export const DATE_FORMATS: [DateFormat, string][] = [
  ["short", "Wed, 2 of Dec"],
  ["day", "Wed 2 Dec"],
  ["long", "Wednesday 2 December"],
  ["plain", "2 Dec 2026"],
  ["numeric", "02/12/2026"],
];
// DD/MM/YYYY, and YYYY-MM-DD as the computer's tools write dates (the model may copy one).
const DATE = /\b(?:(\d{1,2})\/(\d{1,2})\/(\d{4})|(\d{4})-(\d{2})-(\d{2}))\b/g;
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date as the person likes it; the year only when it isn't this year (always in "plain" and "numeric"). */
export function formatDate(d: Date, format: DateFormat = "short", now = new Date()): string {
  const wd = WD[d.getDay()], mon = MON[d.getMonth()], day = d.getDate(), year = d.getFullYear();
  const other = year !== now.getFullYear() ? ` ${year}` : "";
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (format) {
    case "day":
      return `${wd.slice(0, 3)} ${day} ${mon.slice(0, 3)}${other}`;
    case "long":
      return `${wd} ${day} ${mon}${other}`;
    case "plain":
      return `${day} ${mon.slice(0, 3)} ${year}`;
    case "numeric":
      return `${pad(day)}/${pad(d.getMonth() + 1)}/${year}`;
    default:
      return `${wd.slice(0, 3)}, ${day} of ${mon.slice(0, 3)}${other}`;
  }
}

/** DD/MM/YYYY as a date, or null if there's no such day (31/02/2026). */
export function parseDate(day: string, month: string, year: string): Date | null {
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return d.getDate() === Number(day) && d.getMonth() === Number(month) - 1 ? d : null;
}

md.renderer.rules.date_label = (tokens, idx) => {
  const { date: d, format } = tokens[idx].meta as { date: Date; format: DateFormat };
  const full = `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  return `<span class="label date" title="${full}">${escape(formatDate(d, format))}</span>`;
};
md.core.ruler.push("date_labels", (state) => {
  const format: DateFormat = (state.env as { dateFormat?: DateFormat })?.dateFormat ?? "short";
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out: typeof block.children = [];
    for (const t of block.children) {
      if (t.type !== "text" || !/\d{4}/.test(t.content)) {
        out.push(t);
        continue;
      }
      let last = 0;
      for (const m of t.content.matchAll(DATE)) {
        const d = m[1] ? parseDate(m[1], m[2], m[3]) : parseDate(m[6], m[5], m[4]);
        if (!d) continue;
        if (m.index > last) {
          const tok = new state.Token("text", "", 0);
          tok.content = t.content.slice(last, m.index);
          out.push(tok);
        }
        const tok = new state.Token("date_label", "", 0);
        tok.meta = { date: d, format };
        out.push(tok);
        last = m.index + m[0].length;
      }
      if (last === 0) {
        out.push(t);
        continue;
      }
      if (last < t.content.length) {
        const tok = new state.Token("text", "", 0);
        tok.content = t.content.slice(last);
        out.push(tok);
      }
    }
    block.children = out;
  }
});

/** A reply as safe HTML; `accounts`: the person's connected addresses, tagged in their own colour; dates as
 * labels in `dateFormat`. */
export function render(text: string, accounts: string[] = [], dateFormat: DateFormat = "short"): string {
  return md.render(text, { accounts, dateFormat });
}
