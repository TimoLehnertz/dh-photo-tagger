// Runs start-number reading off the main thread so the UI stays responsive.
import { readText } from "./bibs";

self.onmessage = async (e: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
  const { id, bitmap } = e.data;
  try {
    const hits = await readText(bitmap, (done, total) => self.postMessage({ id, progress: done / total }));
    self.postMessage({ id, hits });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  } finally {
    bitmap.close();
  }
};
