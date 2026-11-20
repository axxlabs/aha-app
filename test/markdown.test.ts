// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { render } from "../src/markdown";

describe("markdown", () => {
  it("renders the safe subset", () => {
    const html = render("**Booked** at [Flat Iron](https://flatironsteak.co.uk)\n- Fri 27 Nov");
    expect(html).toContain("<strong>Booked</strong>");
    expect(html).toContain('href="https://flatironsteak.co.uk"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("<li>Fri 27 Nov</li>");
  });

  it("never passes HTML, scripts, remote images or javascript: links", () => {
    const html = render('<img src=x onerror=alert(1)> <script>alert(1)</script> ![t](https://tracker.example/p.png) [x](javascript:alert(1)) [y](data:text/html,hi)');
    const tags = [...html.matchAll(/<([a-z0-9]+)([^>]*)>/gi)];
    for (const [, name, attrs] of tags) {
      expect(["p", "a", "strong", "em", "code", "br", "ul", "ol", "li"]).toContain(name.toLowerCase());
      expect(attrs).not.toMatch(/\son\w+=|javascript:|data:/i);
    }
    expect(html).toContain("&lt;script&gt;");
  });

  it("turns headings into plain text", () => {
    expect(render("## Hello")).not.toContain("<h2");
  });
});
