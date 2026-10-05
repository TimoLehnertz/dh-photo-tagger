// Main-thread side of start-number reading: loads a photo's pixels and hands them to the worker.
import type { TextHit } from "./bibs";
import type { Photo } from "./photos";
import { isTauri, readFileRange } from "./platform";

const CHUNK = 1 << 20; // the Tauri range-read command's limit

/**
 * Workers that read photos in parallel. In a cross-origin-isolated page each one can also use several
 * threads (WebAssembly threads need SharedArrayBuffer); otherwise more single-threaded workers run side
 * by side. Each worker holds its own copy of the models (~100 MB of memory), hence the small cap.
 */
const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2;
export const POOL_SIZE = globalThis.crossOriginIsolated ? Math.min(2, Math.max(1, Math.floor(cores / 4))) : Math.min(3, Math.max(1, Math.floor(cores / 2)));
const THREADS = globalThis.crossOriginIsolated ? Math.max(1, Math.min(4, Math.floor(cores / POOL_SIZE))) : 1;

interface Job {
  resolve: (h: TextHit[]) => void;
  reject: (e: Error) => void;
  onProgress?: (p: number) => void;
}
interface PoolWorker {
  worker: Worker;
  jobs: Map<number, Job>;
}

const pool: (PoolWorker | null)[] = Array.from({ length: POOL_SIZE }, () => null);
let nextId = 0;

function spawn(slot: number): PoolWorker {
  const w: PoolWorker = { worker: new Worker(new URL("./bibs.worker.ts", import.meta.url), { type: "module" }), jobs: new Map() };
  w.worker.onmessage = (e: MessageEvent<{ id: number; hits?: TextHit[]; error?: string; progress?: number }>) => {
    const job = w.jobs.get(e.data.id);
    if (!job) return;
    if (e.data.progress !== undefined) return job.onProgress?.(e.data.progress);
    w.jobs.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve(e.data.hits ?? []);
  };
  w.worker.onerror = (e) => {
    for (const job of w.jobs.values()) job.reject(new Error(e.message || "Number reading failed"));
    w.worker.terminate();
    pool[slot] = null;
  };
  pool[slot] = w;
  return w;
}

/** An idle worker, else a new one in a free slot, else the least busy. */
function pickWorker(): PoolWorker {
  const live = pool.filter((w): w is PoolWorker => !!w);
  const idle = live.find((w) => w.jobs.size === 0);
  if (idle) return idle;
  const free = pool.indexOf(null);
  if (free >= 0) return spawn(free);
  return live.reduce((a, b) => (b.jobs.size < a.jobs.size ? b : a));
}

/** The full-resolution file as a Blob (on the desktop read through the backend, in chunks). */
async function photoBlob(photo: Photo): Promise<Blob> {
  if (isTauri && photo.path) {
    const dir = photo.path.slice(0, photo.path.length - photo.name.length);
    const parts: Uint8Array[] = [];
    for (let offset = 0; ; offset += CHUNK) {
      const part = await readFileRange(dir, photo.name, offset, CHUNK);
      parts.push(part);
      if (part.length < CHUNK) break;
    }
    return new Blob(parts as BlobPart[]);
  }
  return (await fetch(photo.src)).blob();
}

/** Reads the text (and start-number candidates) in a photo. */
export async function readPhotoText(photo: Photo, onProgress?: (p: number) => void): Promise<TextHit[]> {
  const bitmap = await createImageBitmap(await photoBlob(photo));
  const id = nextId++;
  const w = pickWorker();
  return new Promise((resolve, reject) => {
    w.jobs.set(id, { resolve, reject, onProgress });
    w.worker.postMessage({ id, bitmap, threads: THREADS }, [bitmap]);
  });
}
