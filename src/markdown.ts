// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// Safe Markdown for aha's replies (SPEC §7.4): no raw HTML, no remote images (they would leak that you read
// the message), links only http(s) and mailto, opened without a referrer.

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
md.disable(["image", "heading", "lheading"]);

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

/** A reply as safe HTML; `accounts`: the person's connected addresses, tagged in their own colour. */
export function render(text: string, accounts: string[] = []): string {
  return md.render(text, { accounts });
}
