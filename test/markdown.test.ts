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

  it("tags every email address, the person's own in their own colour", () => {
    const accounts = ["fe@example.com", "fe.work@example.com"];
    const html = render("Found in **fe.work@example.com**, and fe@example.com. Sam is sam@example.com.", accounts);
    expect(html).toContain('<strong><span class="label mine" title="Your account">fe.work@example.com</span></strong>');
    expect(html).toContain('<span class="label mine" title="Your account">fe@example.com</span>.');
    expect(html).toContain('<span class="label" title="Email address">sam@example.com</span>.');
    expect(html).not.toContain("mailto:"); // tags, not mail links
    expect(render("write to [Sam](mailto:sam@example.com)", accounts)).toContain('title="Email address">sam@example.com<');
    expect(render("in fe@example.com", [])).toContain('class="label"'); // before the accounts are known: still a tag
    expect(render("`a@b.co` stays code", accounts)).toContain("<code>a@b.co</code>");
    expect(render('x <b y="q@w.co">', ['q@w.co"><script>'])).not.toContain("<script>");
  });
});
