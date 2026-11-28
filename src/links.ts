// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// Where a link in sha's replies opens (SPEC §7.4, Settings → This device → Open links). In the installed app a
// link opens in a browser view over the app (iOS: a Safari sheet; Android: a Chrome tab). "In my browser" hands
// it to the phone's browser app instead: Safari's own scheme on iOS 17+, an Android intent with no package (the
// default browser, or the app for that link), falling back to the plain link.

export type LinkMode = "app" | "browser";
export type Platform = "ios" | "android" | "other";

export function platform(ua: string, touchPoints: number): Platform {
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** The URL that opens `url` in the phone's browser app, or `url` itself where there's no such thing. */
export function externalUrl(url: string, on: Platform): string {
  const m = /^(https?):\/\/(.+)$/i.exec(url);
  if (!m) return url; // mailto: and anything else is left to the system
  const scheme = m[1].toLowerCase();
  if (on === "ios") return `x-safari-${scheme}://${m[2]}`;
  if (on === "android") {
    const [rest, fragment] = m[2].split("#", 2);
    void fragment; // an intent URL has its own fragment: the page's is dropped
    return `intent://${rest}#Intent;scheme=${scheme};action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  }
  return url;
}

/** Only the installed app has a choice to make: in a browser tab a link already opens in a new tab. */
export function standalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}
