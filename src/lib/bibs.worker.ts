// Runs start-number reading off the main thread so the UI stays responsive.
//
// onnxruntime starts its WebAssembly threads with this same script (named "em-pthread…"). Importing
// the runtime eagerly lets it take over those threads as soon as they load; only the real worker
// listens for our jobs.
import "onnxruntime-web/wasm";
import { readText, setThreads } from "./bibs";

if (!self.name?.startsWith("em-pthread")) {
  self.onmessage = async (e: MessageEvent<{ id: number; bitmap: ImageBitmap; threads: number }>) => {
    const { id, bitmap, threads } = e.data;
    setThreads(threads);
    try {
      const hits = await readText(bitmap, (done, total) => self.postMessage({ id, progress: done / total }));
      self.postMessage({ id, hits });
    } catch (err) {
      self.postMessage({ id, error: String((err as Error)?.message ?? err) });
    } finally {
      bitmap.close();
    }
  };
}
