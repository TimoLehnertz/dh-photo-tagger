// Minimal ISO-BMFF (MP4 / MOV) reader: just enough to get a clip's recording time and length
// from the `moov/mvhd` box without loading the video. Works on any random-access byte source.

/** Reads `length` bytes at `offset` (fewer at end of file). */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

export interface VideoMeta {
  /** mvhd creation_time as Unix ms. Cameras disagree whether this is UTC or local wall time. */
  creationMs: number | null;
  durationMs: number | null;
}

const MAC_EPOCH_OFFSET_S = 2_082_844_800; // 1904-01-01 → 1970-01-01
const MAX_BOXES = 10_000;

interface BoxHeader {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

async function readHeader(read: RangeReader, offset: number, end: number): Promise<BoxHeader | null> {
  if (offset + 8 > end) return null;
  const b = await read(offset, 16);
  if (b.length < 8) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let size = v.getUint32(0);
  const type = String.fromCharCode(b[4], b[5], b[6], b[7]);
  let headerSize = 8;
  if (size === 1) {
    if (b.length < 16) return null;
    size = Number(v.getBigUint64(8));
    headerSize = 16;
  } else if (size === 0) {
    size = end - offset; // box extends to the end of its parent
  }
  if (size < headerSize || offset + size > end) return null;
  return { type, start: offset, headerSize, size };
}

async function findChild(read: RangeReader, from: number, end: number, type: string): Promise<BoxHeader | null> {
  let offset = from;
  for (let i = 0; i < MAX_BOXES; i++) {
    const h = await readHeader(read, offset, end);
    if (!h) return null;
    if (h.type === type) return h;
    offset += h.size;
  }
  return null;
}

export function parseMvhd(body: Uint8Array): VideoMeta | null {
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (body.length < 20) return null;
  const version = body[0];
  let creation: number;
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (body.length < 32) return null;
    creation = Number(v.getBigUint64(4));
    timescale = v.getUint32(20);
    duration = Number(v.getBigUint64(24));
  } else {
    creation = v.getUint32(4);
    timescale = v.getUint32(12);
    duration = v.getUint32(16);
  }
  const creationMs = creation > MAC_EPOCH_OFFSET_S ? (creation - MAC_EPOCH_OFFSET_S) * 1000 : null;
  const validDuration = timescale > 0 && duration > 0 && duration !== 0xffffffff;
  return { creationMs, durationMs: validDuration ? Math.round((duration / timescale) * 1000) : null };
}

export async function readVideoMeta(read: RangeReader, fileSize: number): Promise<VideoMeta | null> {
  const moov = await findChild(read, 0, fileSize, "moov");
  if (!moov) return null;
  const mvhd = await findChild(read, moov.start + moov.headerSize, moov.start + moov.size, "mvhd");
  if (!mvhd) return null;
  const body = await read(mvhd.start + mvhd.headerSize, Math.min(mvhd.size - mvhd.headerSize, 112));
  return parseMvhd(body);
}

export function fileRangeReader(file: Blob): RangeReader {
  return async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

/** "1:05" / "12:03" / "1:02:03". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * Grabs a frame from a video URL as a small JPEG data URL, or null when the browser can't decode
 * the codec (e.g. HEVC in Chrome) or the source forbids canvas reads.
 */
export function videoPoster(src: string, atMs = 1000, width = 320): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 8000);
    v.muted = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(atMs / 1000, (v.duration || 0) / 2);
    };
    v.onseeked = () => {
      try {
        const h = Math.round((v.videoHeight / v.videoWidth) * width) || Math.round(width * 0.5625);
        const c = document.createElement("canvas");
        c.width = width;
        c.height = h;
        c.getContext("2d")!.drawImage(v, 0, 0, width, h);
        finish(c.toDataURL("image/jpeg", 0.75));
      } catch {
        finish(null);
      }
    };
    v.src = src;
  });
}
