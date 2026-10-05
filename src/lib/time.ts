/** A calendar date + clock time with no time zone attached (what a camera writes to EXIF). */
export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/**
 * Parses EXIF `DateTimeOriginal` ("2026:10:04 14:48:07") plus optional `SubSecTimeOriginal`
 * ("54" = .54 s). Also accepts ISO-ish "2026-10-04T14:48:07". Returns null when unparseable.
 */
export function parseExifDateTime(value: string | null | undefined, subSec?: string | number | null): WallTime | null {
  if (!value) return null;
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, hour, minute, second, millisecond: parseSubSec(subSec) };
}

/** EXIF SubSec is the fractional part's digits: "5" → 500 ms, "54" → 540 ms, "123" → 123 ms. */
export function parseSubSec(subSec: string | number | null | undefined): number {
  if (subSec === null || subSec === undefined) return 0;
  const digits = String(subSec).trim().replace(/\D.*$/, "");
  if (!digits) return 0;
  return Math.round(Number(`0.${digits}`) * 1000);
}

function wallAsUtcMs(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.millisecond);
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of `timeZone` from UTC at instant `utcMs`, in ms (e.g. -3h for America/Asuncion). */
export function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Interprets a wall-clock time as local time in `timeZone` and returns the UTC instant (ms). */
export function wallTimeToUtcMs(w: WallTime, timeZone: string): number {
  const naive = wallAsUtcMs(w);
  // Two passes handle instants near DST transitions.
  let utc = naive - timeZoneOffsetMs(naive, timeZone);
  utc = naive - timeZoneOffsetMs(utc, timeZone);
  return utc;
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Formats a signed duration as "+1:02:03" / "-0:35:30". */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? "-" : "+";
  const total = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Parses "+1:02:03", "-35:30", "-0:35:30", "90" (seconds), "-2h", "35m", "-1h30m10s". Null if invalid. */
export function parseOffset(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  if (!t) return 0;
  const sign = t.startsWith("-") ? -1 : 1;
  const body = t.replace(/^[+-]/, "");
  const unitMatch = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(body);
  if (unitMatch && /[hms]$/.test(body)) {
    const [, h, m, s] = unitMatch;
    return sign * Math.round(((Number(h ?? 0) * 60 + Number(m ?? 0)) * 60 + Number(s ?? 0)) * 1000);
  }
  const parts = body.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  while (nums.length < 3) nums.unshift(0);
  const [h, m, s] = nums;
  return sign * Math.round((h * 3600 + m * 60 + s) * 1000);
}

/** "14:48:07" in the given zone. */
export function formatClock(utcMs: number, timeZone: string, withDate = false): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  if (withDate) Object.assign(opts, { year: "numeric", month: "2-digit", day: "2-digit" });
  return new Intl.DateTimeFormat("en-CA", opts).format(new Date(utcMs)).replace(",", "");
}

export function formatWallTime(w: WallTime): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)} ${p(w.hour)}:${p(w.minute)}:${p(w.second)}`;
}
