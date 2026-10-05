import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatDuration, parseMvhd, readVideoMeta, type RangeReader } from "./video";

function bufferReader(buf: Uint8Array): RangeReader & { reads: number; bytes: number } {
  const r = Object.assign(
    async (offset: number, length: number) => {
      r.reads++;
      r.bytes += length;
      return buf.subarray(offset, offset + length);
    },
    { reads: 0, bytes: 0 },
  );
  return r;
}

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test-images/${name}`, import.meta.url)));
const MAC_EPOCH = 2_082_844_800;

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(body, 8);
  return out;
}

describe("readVideoMeta", () => {
  it("reads an MP4 with moov at the start (faststart)", async () => {
    const buf = fixture("03_10_DOWNHILL_SKB_CLIP-0001.mp4");
    const r = bufferReader(buf);
    const meta = await readVideoMeta(r, buf.length);
    expect(new Date(meta!.creationMs!).toISOString()).toBe("2026-10-04T17:21:00.000Z");
    expect(meta!.durationMs).toBe(20_000);
    expect(r.bytes).toBeLessThan(1000); // only box headers + mvhd are read
  });

  it("reads a MOV with moov at the end", async () => {
    const buf = fixture("03_10_DOWNHILL_SKB_CLIP-0002.MOV");
    const r = bufferReader(buf);
    const meta = await readVideoMeta(r, buf.length);
    expect(new Date(meta!.creationMs!).toISOString()).toBe("2026-10-04T17:39:50.000Z");
    expect(meta!.durationMs).toBe(12_000);
    expect(r.bytes).toBeLessThan(1000);
  });

  it("parses version-1 (64-bit) mvhd boxes", async () => {
    const body = new Uint8Array(32);
    const v = new DataView(body.buffer);
    body[0] = 1;
    v.setBigUint64(4, BigInt(MAC_EPOCH + 1_791_000_000));
    v.setUint32(20, 600);
    v.setBigUint64(24, 600n * 90n);
    const file = box("moov", box("mvhd", body));
    const withFtyp = new Uint8Array([...box("ftyp", new Uint8Array(8)), ...file]);
    const meta = await readVideoMeta(bufferReader(withFtyp), withFtyp.length);
    expect(meta).toEqual({ creationMs: 1_791_000_000_000, durationMs: 90_000 });
  });

  it("treats a zero creation time as unknown", () => {
    const body = new Uint8Array(20);
    new DataView(body.buffer).setUint32(12, 1000);
    new DataView(body.buffer).setUint32(16, 5000);
    expect(parseMvhd(body)).toEqual({ creationMs: null, durationMs: 5000 });
  });

  it("returns null for non-MP4 data and truncated files", async () => {
    const jpeg = fixture("03_10_DOWNHILL_SKB_TIMETRIAL-0271.jpg");
    expect(await readVideoMeta(bufferReader(jpeg), jpeg.length)).toBeNull();
    const mp4 = fixture("03_10_DOWNHILL_SKB_CLIP-0002.MOV").subarray(0, 5000);
    expect(await readVideoMeta(bufferReader(mp4), mp4.length)).toBeNull();
    expect(await readVideoMeta(bufferReader(new Uint8Array(0)), 0)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats clip lengths", () => {
    expect(formatDuration(5_000)).toBe("0:05");
    expect(formatDuration(65_400)).toBe("1:05");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });
});
