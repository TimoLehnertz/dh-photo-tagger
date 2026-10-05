// Local start-number (bib) reading: PaddleOCR (PP-OCRv4) text detection + recognition, run in the
// browser with onnxruntime-web. Nothing leaves the computer. The models (~15 MB, copied to <base>/ocr/
// by vite.config.ts) and the WebAssembly runtime (~14 MB) are only fetched once detection is first used.
import type { InferenceSession, Tensor } from "onnxruntime-web";

export interface TextHit {
  /** Recognised text of the region. */
  text: string;
  /** Digit groups in it (1–4 digits), i.e. the start-number candidates. */
  numbers: string[];
  /** Region in source-image pixels. */
  box: { x: number; y: number; w: number; h: number };
  /** Mean recognition confidence 0..1. */
  score: number;
}

type Ort = typeof import("onnxruntime-web");

const BASE = `${import.meta.env.BASE_URL}ocr/`;

/** Longest side the detector sees per pass. */
const DET_SIZE = 1280;
/** Pixels above this probability belong to text. */
const DET_THRESH = 0.3;
/** Minimum mean probability of a region to keep it. */
const BOX_THRESH = 0.55;
const UNCLIP_RATIO = 1.6;
const REC_HEIGHT = 48;
/** Images larger than DET_SIZE × this are also scanned in tiles, so small helmet stickers keep their detail. */
const TILE_FROM = 1.5;
/** Readings below this confidence are not offered as start numbers. */
const MIN_NUMBER_SCORE = 0.5;

interface Engine {
  ort: Ort;
  det: InferenceSession;
  rec: InferenceSession;
  keys: string[];
  digitIdx: Set<number>;
}

let enginePromise: Promise<Engine> | null = null;

/** Loads the runtime and both models (once). */
export function loadEngine(): Promise<Engine> {
  enginePromise ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const opts: InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
    const [det, rec, keysText] = await Promise.all([
      ort.InferenceSession.create(`${BASE}det.onnx`, opts),
      ort.InferenceSession.create(`${BASE}rec.onnx`, opts),
      fetch(`${BASE}keys.txt`).then((r) => r.text()),
    ]);
    // CTC classes: 0 = blank, 1..n = dictionary, n+1 = space.
    const keys = ["", ...keysText.split(/\r?\n/).filter((l, i, a) => l !== "" || i < a.length - 1), " "];
    const digitIdx = new Set(keys.flatMap((k, i) => (/^\d$/.test(k) ? [i] : [])));
    return { ort: ort as unknown as Ort, det, rec, keys, digitIdx };
  })();
  enginePromise.catch(() => (enginePromise = null));
  return enginePromise;
}

// ---- image helpers ------------------------------------------------------------------------------

type Source = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

function canvas(w: number, h: number) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  return { c, ctx };
}

function sizeOf(src: Source) {
  if ("naturalWidth" in src) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

/** RGBA pixels → CHW float tensor data in BGR order (as PaddleOCR is trained), normalised. */
function toCHW(data: Uint8ClampedArray, w: number, h: number, mean: number[], std: number[]) {
  const out = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    out[i] = (b - mean[0]) / std[0];
    out[plane + i] = (g - mean[1]) / std[1];
    out[2 * plane + i] = (r - mean[2]) / std[2];
  }
  return out;
}

// ---- detection ----------------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Text regions in one crop of the image, in source pixels. */
async function detectRegions(e: Engine, src: Source, crop: Box): Promise<Box[]> {
  // Never enlarge: on small images the stickers are not legible anyway and only noise appears.
  const scale = Math.min(1, DET_SIZE / Math.max(crop.w, crop.h));
  const w = Math.max(32, Math.round((crop.w * scale) / 32) * 32);
  const h = Math.max(32, Math.round((crop.h * scale) / 32) * 32);
  const { ctx } = canvas(w, h);
  ctx.drawImage(src as CanvasImageSource, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const input = new e.ort.Tensor("float32", toCHW(px, w, h, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]), [1, 3, h, w]);
  const out = await e.det.run({ [e.det.inputNames[0]]: input });
  const prob = (out[e.det.outputNames[0]] as Tensor).data as Float32Array;

  // Connected components of the thresholded probability map.
  const label = new Int32Array(w * h);
  const boxes: Box[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (label[start] || prob[start] <= DET_THRESH) continue;
    next++;
    label[start] = next;
    stack.push(start);
    let minX = w, minY = h, maxX = 0, maxY = 0, sum = 0, n = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      sum += prob[i];
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || label[j] || prob[j] <= DET_THRESH) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        label[j] = next;
        stack.push(j);
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (n < 6 || Math.min(bw, bh) < 3 || sum / n < BOX_THRESH) continue;
    // Shrunk text kernels are grown back (DB "unclip").
    const d = (bw * bh * UNCLIP_RATIO) / (2 * (bw + bh));
    const x0 = Math.max(0, minX - d);
    const y0 = Math.max(0, minY - d);
    const x1 = Math.min(w, maxX + 1 + d);
    const y1 = Math.min(h, maxY + 1 + d);
    const sx = crop.w / w;
    const sy = crop.h / h;
    boxes.push({ x: crop.x + x0 * sx, y: crop.y + y0 * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy });
  }
  return boxes;
}

/** Merges boxes found twice (overlapping tiles). */
function dedupe(boxes: Box[]): Box[] {
  const out: Box[] = [];
  const iou = (a: Box, b: Box) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / Math.min(a.w * a.h, b.w * b.h);
  };
  for (const b of boxes.sort((p, q) => q.w * q.h - p.w * p.h)) if (!out.some((o) => iou(o, b) > 0.6)) out.push(b);
  return out;
}

// ---- recognition --------------------------------------------------------------------------------

async function recognise(e: Engine, src: Source, b: Box, rotate: 0 | 90 | -90): Promise<{ text: string; score: number }> {
  const upright = rotate === 0;
  const bw = upright ? b.w : b.h;
  const bh = upright ? b.h : b.w;
  const w = Math.min(960, Math.max(REC_HEIGHT, Math.round((bw * REC_HEIGHT) / bh)));
  const h = REC_HEIGHT;
  const { ctx } = canvas(w, h);
  ctx.save();
  if (!upright) {
    ctx.translate(w / 2, h / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.drawImage(src as CanvasImageSource, b.x, b.y, b.w, b.h, -h / 2, -w / 2, h, w);
  } else {
    ctx.drawImage(src as CanvasImageSource, b.x, b.y, b.w, b.h, 0, 0, w, h);
  }
  ctx.restore();
  const px = ctx.getImageData(0, 0, w, h).data;
  const input = new e.ort.Tensor("float32", toCHW(px, w, h, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), [1, 3, h, w]);
  const out = (await e.rec.run({ [e.rec.inputNames[0]]: input }))[e.rec.outputNames[0]] as Tensor;
  const [, steps, classes] = out.dims as number[];
  const data = out.data as Float32Array;
  let text = "";
  let prev = -1;
  let conf = 0;
  let n = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestP = -Infinity;
    for (let c = 0; c < classes; c++) {
      const p = data[t * classes + c];
      if (p > bestP) {
        bestP = p;
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      text += e.keys[best] ?? "";
      conf += bestP;
      n++;
    }
    prev = best;
  }
  return { text: text.trim(), score: n ? conf / n : 0 };
}

/**
 * Digit groups that could be start numbers: 1–4 digits standing on their own, not glued to letters
 * ("ASU26" is a logo, not number 26) and not part of a decimal ("9.81"). Inside an otherwise numeric
 * token, O and I/l are read as 0 and 1, the usual confusions on stickers.
 */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s/,;:()[\]]+/)) {
    if (!/\d/.test(raw)) continue;
    const token = /^[\dOoIl|]+$/.test(raw) ? raw.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1") : raw;
    for (const m of token.matchAll(/(?<![\p{L}\d.])\d{1,4}(?![\p{L}\d]|[.,]\d)/gu)) out.push(m[0].replace(/^0+(?=\d)/, ""));
  }
  return [...new Set(out)];
}

/**
 * Finds text in a photo and reads it. Large images are also scanned in overlapping tiles so that
 * small numbers (on a helmet or a leg) are still big enough for the detector.
 */
export async function readText(src: Source, onProgress?: (done: number, total: number) => void): Promise<TextHit[]> {
  const e = await loadEngine();
  const { w, h } = sizeOf(src);
  const crops: Box[] = [{ x: 0, y: 0, w, h }];
  if (Math.max(w, h) > DET_SIZE * TILE_FROM) {
    // About two detector widths per tile is enough for helmet stickers (~75 px tall in a 24 MP frame).
    const tiles = Math.min(3, Math.ceil(Math.max(w, h) / (DET_SIZE * 2)));
    const tw = w / tiles;
    const th = h / tiles;
    for (let i = 0; i < tiles; i++) {
      for (let j = 0; j < tiles; j++) {
        const x = Math.max(0, i * tw - tw * 0.15);
        const y = Math.max(0, j * th - th * 0.15);
        crops.push({ x, y, w: Math.min(w - x, tw * 1.3), h: Math.min(h - y, th * 1.3) });
      }
    }
  }
  const regions: Box[] = [];
  for (const [i, c] of crops.entries()) {
    regions.push(...(await detectRegions(e, src, c)));
    onProgress?.(i + 1, crops.length + 1);
  }
  const hits: TextHit[] = [];
  for (const b of dedupe(regions)) {
    const tries: (0 | 90 | -90)[] = b.h > b.w * 1.5 ? [90, -90] : [0];
    let best = { text: "", score: 0 };
    for (const r of tries) {
      const res = await recognise(e, src, b, r);
      if (res.score > best.score) best = res;
    }
    if (!best.text) continue;
    hits.push({ text: best.text, numbers: best.score >= MIN_NUMBER_SCORE ? numbersIn(best.text) : [], box: b, score: best.score });
  }
  onProgress?.(crops.length + 1, crops.length + 1);
  return hits;
}
