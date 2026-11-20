// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { execSync } from "node:child_process";
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

export default defineConfig({
  plugins: [csp],
  define: { __BUILD__: JSON.stringify(build()) },
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0, modulePreload: { polyfill: false } },
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  test: { globals: true, environment: "node" },
});
