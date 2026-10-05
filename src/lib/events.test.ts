import { describe, expect, it } from "vitest";
import type { R4Event } from "./api";
import { captureDateRange, eventsOverlapping, formatRange } from "./events";
import { parseExifDateTime } from "./time";

const ev = (id: string, start: string | null, end: string | null = null): R4Event => ({
  id, name: id, slug: id, start_date: start, end_date: end, timezone: null, disciplines: null,
});
const events = [
  ev("asu26", "2026-10-01", "2026-10-05"),
  ev("lago", "2026-09-20", "2026-09-20"),
  ev("next-day", "2026-10-06"),
  ev("later", "2026-10-18"),
  ev("undated", null),
];

describe("eventsOverlapping", () => {
  it("keeps events running on the capture dates, with a day of slack", () => {
    const r = captureDateRange([parseExifDateTime("2026:10:04 14:48:07"), parseExifDateTime("2026:10:05 09:00:00"), null])!;
    expect(formatRange(r)).toBe("2026-10-04 – 2026-10-05");
    expect(eventsOverlapping(events, r).map((e) => e.id)).toEqual(["asu26", "next-day"]);
    expect(eventsOverlapping(events, r, 0).map((e) => e.id)).toEqual(["asu26"]);
  });
  it("treats a missing end date as a one-day event", () => {
    const r = captureDateRange([parseExifDateTime("2026:09:21 10:00:00")])!;
    expect(eventsOverlapping(events, r).map((e) => e.id)).toEqual(["lago"]);
  });
  it("has no range without capture times", () => {
    expect(captureDateRange([null])).toBeNull();
  });
});
