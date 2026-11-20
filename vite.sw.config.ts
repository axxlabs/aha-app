// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
// The service worker is built on its own, as one classic script at /sw.js (all imports inlined).
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    emptyOutDir: false,
    sourcemap: false,
    lib: { entry: "src/sw.ts", formats: ["iife"], name: "ahaSw", fileName: () => "sw.js" },
  },
});
