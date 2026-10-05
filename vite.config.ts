/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The Pages build is served from /dh-photo-tagger/; the Tauri build loads from the app root.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  base: isTauri ? "/" : "/dh-photo-tagger/",
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: isTauri ? "safari15" : "es2022",
    outDir: "dist",
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
