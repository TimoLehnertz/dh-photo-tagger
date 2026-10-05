import type { EventData, R4Event, SuitColors } from "./api";

/** One rider across the selected events. */
export interface Athlete {
  profileId: string;
  firstName: string;
  lastName: string;
  name: string;
  country: string | null;
  username: string | null;
  avatarUrl: string | null;
  suitColors: SuitColors | null;
  registrations: { eventId: string; discipline: string; category: string | null; bib: string | null }[];
}

/** One entry of the schedule: a qualifying session or a bracket heat, with who rode in it. */
export interface Race {
  id: string;
  eventId: string;
  eventName: string;
  /** Zone to show the race times in. */
  timeZone: string | null;
  kind: "qualifying" | "heat";
  discipline: string;
  /** Categories riding in it (a qualifying session usually mixes men and women). */
  categories: string[];
  label: string;
  /** First start / last finish in UTC ms; null for heats that have not run (or carry no times). */
  startMs: number | null;
  endMs: number | null;
  profileIds: Set<string>;
}

export interface Roster {
  athletes: Map<string, Athlete>;
  /** Chronological; races without times last, in round/heat order. */
  races: Race[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function buildRoster(datas: EventData[]): Roster {
  const athletes = new Map<string, Athlete>();
  const races: Race[] = [];
  // Heats without times sort after everything else, in event/round/heat order.
  const untimedOrder = new Map<string, number>();

  for (const data of datas) {
    const ev: R4Event = data.event;
    for (const reg of data.registrations) {
      let a = athletes.get(reg.profile_id);
      if (!a) {
        const p = reg.profiles;
        const firstName = (p?.first_name ?? "").trim();
        const lastName = (p?.last_name ?? "").trim();
        a = {
          profileId: reg.profile_id,
          firstName,
          lastName,
          name: [firstName, lastName].filter(Boolean).join(" ") || p?.username || "Unknown rider",
          country: p?.country ?? null,
          username: p?.username ?? null,
          avatarUrl: p?.avatar_url || null,
          suitColors: p?.suit_colors && SUIT_KEYS.some((k) => p.suit_colors?.[k]) ? p.suit_colors : null,
          registrations: [],
        };
        athletes.set(reg.profile_id, a);
      }
      a.registrations.push({ eventId: ev.id, discipline: reg.discipline, category: reg.category, bib: reg.bib_number });
    }

    // Qualifying: one race per (discipline, session). created_at is when the result was recorded,
    // roughly the finish, so a run starts about time_ms earlier.
    const durations = new Map<string, number[]>();
    for (const r of data.runs) {
      if (r.time_ms && r.time_ms > 0 && !r.dnf) durations.set(r.discipline, [...(durations.get(r.discipline) ?? []), r.time_ms]);
    }
    const sessions = new Map<string, Race>();
    for (const r of data.runs) {
      const session = r.session ? r.session.toUpperCase() : `Run ${r.run_number}`;
      const key = `q:${ev.id}:${r.discipline}:${session}`;
      let race = sessions.get(key);
      if (!race) {
        race = {
          id: key,
          eventId: ev.id,
          eventName: ev.name,
          timeZone: ev.timezone,
          kind: "qualifying",
          discipline: r.discipline,
          categories: [],
          label: session,
          startMs: null,
          endMs: null,
          profileIds: new Set(),
        };
        sessions.set(key, race);
      }
      race.profileIds.add(r.profile_id);
      if (r.category && !race.categories.includes(r.category)) race.categories.push(r.category);
      const endMs = Date.parse(r.created_at);
      if (Number.isNaN(endMs)) continue;
      const duration = r.time_ms && r.time_ms > 0 ? r.time_ms : (median(durations.get(r.discipline) ?? []) ?? 0);
      race.startMs = Math.min(race.startMs ?? Infinity, endMs - duration);
      race.endMs = Math.max(race.endMs ?? -Infinity, endMs);
    }
    races.push(...sessions.values());

    for (const b of data.brackets) {
      const heats = [...(b.bracket_heats ?? [])].sort((x, y) => x.round - y.round || x.heat_number - y.heat_number);
      for (const h of heats) {
        const start = h.running_at ? Date.parse(h.running_at) : NaN;
        const end = h.completed_at ? Date.parse(h.completed_at) : NaN;
        const id = `h:${h.id}`;
        if (Number.isNaN(start)) untimedOrder.set(id, untimedOrder.size);
        races.push({
          id,
          eventId: ev.id,
          eventName: ev.name,
          timeZone: ev.timezone,
          kind: "heat",
          discipline: b.discipline,
          categories: b.category ? [b.category] : [],
          label: `${h.is_consolation ? "Consolation" : "Round"} ${h.round} · heat ${h.heat_number}`,
          startMs: Number.isNaN(start) ? null : start,
          endMs: Number.isNaN(end) ? null : end,
          profileIds: new Set(h.bracket_entries.map((e) => e.profile_id)),
        });
      }
    }
  }

  races.sort((a, b) => {
    if (a.startMs !== null && b.startMs !== null) return a.startMs - b.startMs;
    if (a.startMs !== null) return -1;
    if (b.startMs !== null) return 1;
    return (untimedOrder.get(a.id) ?? 0) - (untimedOrder.get(b.id) ?? 0);
  });
  return { athletes, races };
}

// ---- suit colours ------------------------------------------------------------------------------

const SUIT_KEYS = ["helmet", "chest", "leftArm", "rightArm", "leftLeg", "rightLeg"] as const;

/** Body parts the colour filter offers; arms and legs cover both sides. */
export type SuitPart = "helmet" | "chest" | "arms" | "legs";
export const SUIT_PARTS: { id: SuitPart; label: string; keys: (keyof SuitColors)[] }[] = [
  { id: "helmet", label: "Helmet", keys: ["helmet"] },
  { id: "chest", label: "Chest", keys: ["chest"] },
  { id: "arms", label: "Arms", keys: ["leftArm", "rightArm"] },
  { id: "legs", label: "Legs", keys: ["leftLeg", "rightLeg"] },
];

export type ColorName = "black" | "white" | "grey" | "red" | "orange" | "yellow" | "green" | "turquoise" | "blue" | "purple" | "pink" | "brown";
export const COLORS: { id: ColorName; label: string; hex: string }[] = [
  { id: "black", label: "Black", hex: "#141414" },
  { id: "white", label: "White", hex: "#f4f4f4" },
  { id: "grey", label: "Grey", hex: "#8a8f98" },
  { id: "red", label: "Red", hex: "#e53935" },
  { id: "orange", label: "Orange", hex: "#f57c00" },
  { id: "yellow", label: "Yellow", hex: "#fdd835" },
  { id: "green", label: "Green", hex: "#43a047" },
  { id: "turquoise", label: "Turquoise", hex: "#00bcd4" },
  { id: "blue", label: "Blue", hex: "#1e63d6" },
  { id: "purple", label: "Purple", hex: "#7b1fa2" },
  { id: "pink", label: "Pink", hex: "#ec4899" },
  { id: "brown", label: "Brown", hex: "#795548" },
];

function hsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

/**
 * The colour names a suit colour can be called. Borderline shades get more than one: a very dark
 * blue also counts as black and a pale pink as white, since that is how they look in a photo.
 */
export function colorNames(hex: string): Set<ColorName> {
  const out = new Set<ColorName>();
  const v = hsl(hex);
  if (!v) return out;
  const [h, s, l] = v;
  if (l <= 0.1) return out.add("black");
  if (l >= 0.95) return out.add("white");
  if (s < 0.15) {
    out.add(l < 0.25 ? "black" : l > 0.8 ? "white" : "grey");
    if (l < 0.35) out.add("black");
    if (l > 0.7) out.add("white");
    return out;
  }
  if (h >= 345 || h < 15) out.add(l > 0.72 ? "pink" : "red");
  else if (h < 42) out.add("orange");
  else if (h < 70) out.add("yellow");
  else if (h < 165) out.add("green");
  else if (h < 200) out.add("turquoise");
  else if (h < 255) out.add("blue");
  else if (h < 290) out.add("purple");
  else out.add("pink");
  // Dark reds, oranges and yellows read as brown.
  if ((h >= 345 || h < 70) && l < 0.35) out.add("brown");
  if (l < 0.2) out.add("black");
  if (l > 0.85) out.add("white");
  return out;
}

/** The colours an athlete wears on a body part (front of the suit, as the figure shows it). */
export function partColors(a: Athlete, part: SuitPart): string[] {
  const sc = a.suitColors;
  if (!sc) return [];
  return SUIT_PARTS.find((p) => p.id === part)!.keys.map((k) => sc[k]).filter((c): c is string => !!c);
}

// ---- filtering ---------------------------------------------------------------------------------

export interface Filters {
  disciplines: ReadonlySet<string>;
  /** Inclusive range of race ids within the schedule; either end may be open. */
  raceFrom: string | null;
  raceTo: string | null;
  /** Per body part the colours it may have (any of them); missing or empty = no constraint. */
  suit: Partial<Record<SuitPart, ColorName[]>>;
  query: string;
}

export interface FilterStage {
  label: string;
  count: number;
}

export interface FilterResult {
  /** The schedule for the chosen disciplines, i.e. what the race range is picked from. */
  schedule: Race[];
  /** Index range in `schedule` that is selected, or null when no range is set. */
  range: [number, number] | null;
  athletes: Athlete[];
  /** Athletes left after each filter, in the order they are applied. */
  stages: FilterStage[];
}

function bibNumber(a: Athlete): number {
  const n = Math.min(...a.registrations.map((r) => (r.bib && /^\d+$/.test(r.bib) ? Number(r.bib) : Infinity)));
  return Number.isFinite(n) ? n : Infinity;
}

function matchesQuery(a: Athlete, q: string): boolean {
  // "#343" is an exact start number, "34" any number starting with it.
  const exact = q.startsWith("#");
  const bib = q.replace(/^#/, "");
  if (/^\d+$/.test(bib)) return a.registrations.some((r) => (exact ? r.bib === bib : r.bib?.startsWith(bib)));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [a.name, a.username ?? "", a.country ?? ""].join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return words.every((w) => hay.includes(w.normalize("NFD").replace(/[̀-ͯ]/g, "")));
}

/**
 * Applies the filters one after another: disciplines, then the race range, then suit colours,
 * then the name/bib search. Each one only narrows what the previous left.
 */
export function applyFilters(roster: Roster, f: Filters): FilterResult {
  let list = [...roster.athletes.values()];
  const stages: FilterStage[] = [{ label: "Events", count: list.length }];

  list = list.filter((a) => a.registrations.some((r) => f.disciplines.has(r.discipline)));
  stages.push({ label: "Disciplines", count: list.length });

  const schedule = roster.races.filter((r) => f.disciplines.has(r.discipline));
  let range: [number, number] | null = null;
  if (f.raceFrom || f.raceTo) {
    const from = f.raceFrom ? schedule.findIndex((r) => r.id === f.raceFrom) : 0;
    const to = f.raceTo ? schedule.findIndex((r) => r.id === f.raceTo) : schedule.length - 1;
    if (from >= 0 && to >= 0) {
      range = [Math.min(from, to), Math.max(from, to)];
      const inRange = new Set<string>();
      for (const race of schedule.slice(range[0], range[1] + 1)) for (const id of race.profileIds) inRange.add(id);
      list = list.filter((a) => inRange.has(a.profileId));
    }
  }
  stages.push({ label: "Races", count: list.length });

  for (const part of SUIT_PARTS) {
    const wanted = f.suit[part.id];
    if (!wanted?.length) continue;
    list = list.filter((a) => partColors(a, part.id).some((c) => [...colorNames(c)].some((n) => wanted.includes(n))));
  }
  stages.push({ label: "Suit", count: list.length });

  const q = f.query.trim();
  if (q) list = list.filter((a) => matchesQuery(a, q));
  stages.push({ label: "Search", count: list.length });

  list.sort((a, b) => bibNumber(a) - bibNumber(b) || a.name.localeCompare(b.name));
  return { schedule, range, athletes: list, stages };
}
