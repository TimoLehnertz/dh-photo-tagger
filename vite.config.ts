/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The Pages build is served from /<repo name>/; the Tauri build loads from the app root.
// In GitHub Actions the repo comes from GITHUB_REPOSITORY, so a rename needs no code change.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const repo = process.env.GITHUB_REPOSITORY || "TimoLehnertz/media-tagger";
const repoName = repo.split("/")[1];

export default defineConfig({
  base: isTauri ? "/" : `/${repoName}/`,
  define: { __REPO__: JSON.stringify(repo) },
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
