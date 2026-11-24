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

// Labels (SPEC §7.4 "Labels"): the person's own connected accounts, mentioned in a reply ("in fe@work.com"),
// show as a small box rather than plain text or a mail link. Decided here, from the addresses the computer sent;
// the model only writes the address.
const escape = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
md.renderer.rules.account_label = (tokens, idx) => `<span class="label" title="Your account">${escape(tokens[idx].content)}</span>`;
md.core.ruler.push("account_labels", (state) => {
  const accounts: string[] = (state.env as { accounts?: string[] })?.accounts ?? [];
  if (!accounts.length) return;
  const known = new Map(accounts.map((a) => [a.toLowerCase(), a]));
  const pattern = new RegExp(`(${accounts.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out: typeof block.children = [];
    const kids = block.children;
    for (let i = 0; i < kids.length; i++) {
      const t = kids[i];
      // A mailto: link to one of their accounts (linkify makes those): the whole link becomes the label.
      const href = t.type === "link_open" ? String(t.attrGet("href") ?? "") : "";
      const mailto = href.toLowerCase().startsWith("mailto:") ? known.get(href.slice(7).toLowerCase()) : undefined;
      if (mailto) {
        const label = new state.Token("account_label", "", 0);
        label.content = mailto;
        out.push(label);
        while (i < kids.length && kids[i].type !== "link_close") i++;
        continue;
      }
      if (t.type !== "text" || !pattern.test(t.content)) {
        out.push(t);
        continue;
      }
      pattern.lastIndex = 0;
      for (const piece of t.content.split(pattern)) {
        if (!piece) continue;
        const account = known.get(piece.toLowerCase());
        const tok = new state.Token(account ? "account_label" : "text", "", 0);
        tok.content = account ?? piece;
        out.push(tok);
      }
    }
    block.children = out;
  }
});

/** A reply as safe HTML; `accounts`: the person's connected addresses, shown as labels. */
export function render(text: string, accounts: string[] = []): string {
  return md.render(text, { accounts });
}
