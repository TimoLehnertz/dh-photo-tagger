import type { R4Event } from "./api";
import type { WallTime } from "./time";

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS : null;
}

function wallDay(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day) / DAY_MS;
}

export interface DateRange {
  /** Inclusive day numbers (days since 1970-01-01). */
  first: number;
  last: number;
}

export function captureDateRange(walls: (WallTime | null)[]): DateRange | null {
  const days = walls.filter((w): w is WallTime => !!w).map(wallDay);
  if (!days.length) return null;
  return { first: Math.min(...days), last: Math.max(...days) };
}

export function formatDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function formatRange(r: DateRange): string {
  return r.first === r.last ? formatDay(r.first) : `${formatDay(r.first)} – ${formatDay(r.last)}`;
}

/**
 * Events whose dates overlap the photos' capture dates. One day of slack on each side covers
 * camera clocks in another time zone and late-evening/early-morning shots.
 */
export function eventsOverlapping(events: R4Event[], range: DateRange, slackDays = 1): R4Event[] {
  return events.filter((e) => {
    const start = e.start_date ? dayNumber(e.start_date) : null;
    if (start === null) return false;
    const end = (e.end_date ? dayNumber(e.end_date) : null) ?? start;
    return start - slackDays <= range.last && end + slackDays >= range.first;
  });
}
