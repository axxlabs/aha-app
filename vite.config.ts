// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
import { defineConfig } from "vitest/config";

export default defineConfig({
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
  server: { port: 5173, strictPort: true },
  test: { globals: true, environment: "node" },
});
