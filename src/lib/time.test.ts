import { describe, expect, it } from "vitest";
import { formatOffset, parseExifDateTime, parseOffset, parseSubSec, timeZoneOffsetMs, wallTimeToUtcMs } from "./time";

describe("parseExifDateTime", () => {
  it("parses EXIF format with sub-seconds", () => {
    expect(parseExifDateTime("2026:10:04 14:48:07", "54")).toEqual({
      year: 2026, month: 10, day: 4, hour: 14, minute: 48, second: 7, millisecond: 540,
    });
  });
  it("rejects garbage and empty EXIF dates", () => {
    expect(parseExifDateTime("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDateTime("")).toBeNull();
    expect(parseExifDateTime(undefined)).toBeNull();
  });
  it("interprets sub-second digits as a fraction", () => {
    expect(parseSubSec("5")).toBe(500);
    expect(parseSubSec("05")).toBe(50);
    expect(parseSubSec("123")).toBe(123);
    expect(parseSubSec(null)).toBe(0);
  });
});

describe("time zones", () => {
  it("reads wall time in the event's zone, ignoring the camera offset tag", () => {
    const w = parseExifDateTime("2026:10:04 14:48:07")!;
    expect(new Date(wallTimeToUtcMs(w, "America/Asuncion")).toISOString()).toBe("2026-10-04T17:48:07.000Z");
    expect(new Date(wallTimeToUtcMs(w, "UTC")).toISOString()).toBe("2026-10-04T14:48:07.000Z");
  });
  it("handles DST zones", () => {
    const w = parseExifDateTime("2026:07:01 12:00:00")!;
    expect(new Date(wallTimeToUtcMs(w, "Europe/Berlin")).toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(timeZoneOffsetMs(Date.UTC(2026, 0, 1), "Europe/Berlin")).toBe(3600_000);
  });
});

describe("offsets", () => {
  it("round-trips", () => {
    for (const ms of [0, 1000, -35 * 60_000 - 30_000, 3 * 3600_000 + 61_000]) expect(parseOffset(formatOffset(ms))).toBe(ms);
  });
  it("accepts several notations", () => {
    expect(parseOffset("-35:30")).toBe(-(35 * 60 + 30) * 1000);
    expect(parseOffset("90")).toBe(90_000);
    expect(parseOffset("-1h30m")).toBe(-90 * 60_000);
    expect(parseOffset("10s")).toBe(10_000);
    expect(parseOffset("")).toBe(0);
    expect(parseOffset("abc")).toBeNull();
  });
});
