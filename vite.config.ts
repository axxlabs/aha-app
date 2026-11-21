// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { execSync } from "node:child_process";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vitest/config";

function build(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

// Strict Content-Security-Policy in built pages only (SPEC §7.4): scripts and styles from this origin, nothing
// third-party, connections only to gateways.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' wss: ws://127.0.0.1:* ws://localhost:*",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp: Plugin = {
  name: "aha-csp",
  apply: "build",
  transformIndexHtml(html) {
    return html.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
  },
};

// Development on the LAN (AHA_DEV_LAN=1, SPEC §7.6): https with a self-signed certificate, and /v1/device
// forwarded to the local gateway, which stays on 127.0.0.1.
const lan = process.env.AHA_DEV_LAN === "1";

export default defineConfig({
  plugins: [csp, ...(lan ? [basicSsl()] : [])],
  define: { __BUILD__: JSON.stringify(build()) },
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0, modulePreload: { polyfill: false } },
  server: {
    port: 5173,
    strictPort: true,
    host: lan ? "0.0.0.0" : "127.0.0.1",
    proxy: lan ? { "/v1/device": { target: "ws://127.0.0.1:8700", ws: true } } : undefined,
  },
  test: { globals: true, environment: "node" },
});
