/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Start-number reading (src/lib/bibs.ts) loads the PaddleOCR models from <base>/ocr/. Served from
 * node_modules in dev and copied into the build; nothing is committed. (Vite bundles the onnxruntime
 * WebAssembly itself.)
 */
const OCR_FILES: Record<string, string> = {
  "det.onnx": "@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx",
  "rec.onnx": "@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx",
  "keys.txt": "@gutenye/ocr-models/assets/ppocr_keys_v1.txt",
};
const resolveOcr = (name: string) => fileURLToPath(new URL(`./node_modules/${OCR_FILES[name]}`, import.meta.url));

function ocrAssets(): Plugin {
  let base = "/";
  return {
    name: "ocr-assets",
    configResolved(c) {
      base = c.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        const name = path.startsWith(`${base}ocr/`) ? path.slice(`${base}ocr/`.length) : null;
        if (!name || !OCR_FILES[name]) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(readFileSync(resolveOcr(name)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(OCR_FILES)) this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: readFileSync(resolveOcr(name)) });
    },
  };
}

// The Pages build is served from /<repo name>/; the Tauri build loads from the app root.
// In GitHub Actions the repo comes from GITHUB_REPOSITORY, so a rename needs no code change.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const repo = process.env.GITHUB_REPOSITORY || "TimoLehnertz/media-tagger";
const repoName = repo.split("/")[1];

export default defineConfig({
  base: isTauri ? "/" : `/${repoName}/`,
  define: { __REPO__: JSON.stringify(repo) },
  plugins: [svelte(), ocrAssets()],
  clearScreen: false,
  // Cross-origin isolation lets start-number reading use several threads (in production the
  // service worker in public/coi-serviceworker.js adds these headers).
  server: { port: 5173, strictPort: true, headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: {
    target: isTauri ? "safari15" : "es2022",
    outDir: "dist",
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
