// Main-thread side of start-number reading: loads a photo's pixels and hands them to the worker.
import type { TextHit } from "./bibs";
import type { Photo } from "./photos";
import { isTauri, readFileRange } from "./platform";

const CHUNK = 1 << 20; // the Tauri range-read command's limit

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (h: TextHit[]) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./bibs.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; hits?: TextHit[]; error?: string; progress?: number }>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    if (e.data.progress !== undefined) return job.onProgress?.(e.data.progress);
    pending.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve(e.data.hits ?? []);
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || "Number reading failed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
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
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, bitmap }, [bitmap]);
  });
}
