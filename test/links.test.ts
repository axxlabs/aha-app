// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { describe, expect, it } from "vitest";
import { externalUrl, platform } from "../src/links";

describe("Open links → In my browser (SPEC §7.4)", () => {
  it("knows the phone", () => {
    expect(platform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)", 5)).toBe("ios");
    expect(platform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios"); // an iPad asking for desktop sites
    expect(platform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("other");
    expect(platform("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBe("android");
  });
  it("hands the link to Safari on iOS and to the default browser on Android", () => {
    expect(externalUrl("https://www.waitrose.com/a?b=1", "ios")).toBe("x-safari-https://www.waitrose.com/a?b=1");
    expect(externalUrl("https://x.co/p?q=1#top", "android")).toBe(
      "intent://x.co/p?q=1#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=https%3A%2F%2Fx.co%2Fp%3Fq%3D1%23top;end",
    );
    expect(externalUrl("https://x.co/", "other")).toBe("https://x.co/");
    expect(externalUrl("mailto:a@b.co", "ios")).toBe("mailto:a@b.co");
  });
});
