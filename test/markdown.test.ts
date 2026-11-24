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

  it("shows the person's own accounts as labels, and only those", () => {
    const accounts = ["fe@example.com", "fe.work@example.com"];
    const html = render("Found in **fe.work@example.com**, and fe@example.com. Sam is sam@example.com.", accounts);
    expect(html).toContain('<strong><span class="label" title="Your account">fe.work@example.com</span></strong>');
    expect(html).toContain('<span class="label" title="Your account">fe@example.com</span>.');
    expect(html).toContain('href="mailto:sam@example.com"'); // someone else's address stays a link
    expect(html).not.toContain('href="mailto:fe@example.com"');
    expect(render("in fe@example.com", [])).not.toContain("label");
    expect(render('in <b x="fe@example.com">', ['fe@example.com"><script>'])).not.toContain("<script>");
  });
});
