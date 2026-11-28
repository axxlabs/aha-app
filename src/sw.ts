// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// Service worker (SPEC §6.6, §7.4): lets the app open offline, and shows notifications. A notification's text
// is fixed ("New message from sha") unless the push carries a preview that decrypts and verifies under this
// device's push key, so a forged push can't put words on the screen. It never shows anything else.

/// <reference lib="webworker" />
import type { Identity } from "./client";
import { b64d, pushOpen, type SealedPush } from "./crypto";
import { Store } from "./store";

declare const self: ServiceWorkerGlobalScope;
const CACHE = "aha-shell-v1";
const FIXED = "New message from sha";

self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Same-origin GETs: network first, the cached copy when offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(e.request);
        if (res.ok) await cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(e.request)) ?? (await cache.match("/")) ?? Response.error();
      }
    })(),
  );
});

async function previewFrom(data: unknown): Promise<string | null> {
  try {
    const store = await Store.open();
    const identity = await store.get<Identity>("identity");
    if (!identity) return null;
    const payload = pushOpen(b64d(identity.pushKey, 32), data as SealedPush) as { preview?: unknown };
    return typeof payload.preview === "string" && payload.preview.trim() ? payload.preview.slice(0, 120) : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      let data: unknown = null;
      try {
        data = e.data?.json();
      } catch {
        data = null;
      }
      const preview = data ? await previewFrom(data) : null;
      await self.registration.showNotification("sha", { body: preview ?? FIXED, icon: "/sha-192.png", tag: "aha", renotify: true } as NotificationOptions);
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) await (open as WindowClient).focus();
      else await self.clients.openWindow("/");
    })(),
  );
});
