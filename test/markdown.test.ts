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

  it("shows a heading as a bold line, not a page title", () => {
    const html = render("## Hours\nOpen 10:00");
    expect(html).not.toContain("<h2");
    expect(html).toContain("<p><strong>Hours</strong></p>");
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

import { formatDate, render as renderDates } from "../src/markdown";

describe("date labels", () => {
  it("shows every DD/MM/YYYY as a dated label with its weekday worked out here", () => {
    const html = renderDates("Sync with Natalia on 29/11/2026 at 17:00", [], "short");
    expect(html).toContain('<span class="label date" title="Sunday 29 November 2026">Sun, 29 of Nov');
    expect(html).toContain("at 17:00");
  });
  it("labels the tools' YYYY-MM-DD too", () => {
    expect(renderDates("School play: 2026-11-27 18:00")).toContain('title="Friday 27 November 2026">Fri, 27 of Nov');
  });
  it("leaves impossible dates and other slashes alone", () => {
    expect(renderDates("31/02/2026 and 1/2 cup")).not.toContain("label date");
  });
  it("formats as the person chose", () => {
    const d = new Date(2026, 11, 2);
    const now = new Date(2026, 10, 24);
    expect(formatDate(d, "short", now)).toBe("Wed, 2 of Dec");
    expect(formatDate(d, "day", now)).toBe("Wed 2 Dec");
    expect(formatDate(d, "long", now)).toBe("Wednesday 2 December");
    expect(formatDate(d, "plain", now)).toBe("2 Dec 2026");
    expect(formatDate(d, "numeric", now)).toBe("02/12/2026");
    expect(formatDate(new Date(2027, 0, 1), "short", now)).toBe("Fri, 1 of Jan 2027");
  });
});
