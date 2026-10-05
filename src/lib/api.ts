// Read-only client for r4wrun.com's public Supabase (PostgREST) API.

const SUPABASE_URL = "https://snrizlwixvyfughwkswa.supabase.co/rest/v1";
// Publishable (anon) key, embedded in the public r4wrun.com site. Read-only.
const SUPABASE_KEY = "sb_publishable_t6puXzL0oioBZoDWfdXnrA_GmAuFLzy";
const PAGE_SIZE = 1000;

export type Discipline = "skateboarding" | "inline" | "street_luge";
export const DISCIPLINES: { id: Discipline; label: string }[] = [
  { id: "skateboarding", label: "Skateboard" },
  { id: "inline", label: "Inline" },
  { id: "street_luge", label: "Street luge" },
];

export interface SuitColors {
  chest?: string;
  helmet?: string;
  leftArm?: string;
  rightArm?: string;
  leftLeg?: string;
  rightLeg?: string;
}

export interface R4Event {
  id: string;
  name: string;
  slug: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  disciplines: string[] | null;
  location?: string | null;
}

export interface Registration {
  event_id: string;
  profile_id: string;
  discipline: string;
  category: string | null;
  bib_number: string | null;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    country: string | null;
    username: string | null;
    avatar_url: string | null;
    suit_colors: SuitColors | null;
  } | null;
}

export interface QualifyingRun {
  id: string;
  profile_id: string;
  discipline: string;
  category: string | null;
  run_number: number;
  time_ms: number | null;
  dnf: boolean;
  created_at: string;
  session: string | null;
}

export interface RunSplit {
  profile_id: string;
  discipline: string;
  board: string | null;
  run_number: number;
  sector_count: number | null;
  line: number | null;
  split_ms: number | null;
  created_at: string;
}

export interface Bracket {
  id: string;
  discipline: string;
  category: string | null;
  bracket_heats: {
    id: string;
    round: number;
    heat_number: number;
    is_consolation: boolean | null;
    running_at: string | null;
    completed_at: string | null;
    bracket_entries: { profile_id: string }[];
  }[];
}

export interface EventData {
  event: R4Event;
  registrations: Registration[];
  runs: QualifyingRun[];
  splits: RunSplit[];
  brackets: Bracket[];
}

async function get<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(`${SUPABASE_URL}/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).message ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(`r4wrun request failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.json() as Promise<T>;
}

/** Fetches every row of a PostgREST query, paging past the server's row limit. */
async function getAll<T>(path: string, fetchImpl?: typeof fetch): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await get<T[]>(`${path}&limit=${PAGE_SIZE}&offset=${offset}`, fetchImpl);
    out.push(...page);
    if (page.length < PAGE_SIZE) return out;
  }
}

export function listEvents(fetchImpl?: typeof fetch): Promise<R4Event[]> {
  return getAll<R4Event>(
    "events?select=id,name,slug,start_date,end_date,timezone,disciplines,location&order=start_date.desc.nullslast",
    fetchImpl,
  );
}

export async function loadEventData(event: R4Event, fetchImpl?: typeof fetch): Promise<EventData> {
  const id = encodeURIComponent(event.id);
  const [registrations, runs, splits, brackets] = await Promise.all([
    getAll<Registration>(
      `event_registrations?event_id=eq.${id}&select=event_id,profile_id,discipline,category,bib_number,` +
        "profiles!event_registrations_profile_id_fkey(first_name,last_name,country,username,avatar_url,suit_colors)" +
        "&order=profile_id",
      fetchImpl,
    ),
    getAll<QualifyingRun>(
      `qualifying_runs?event_id=eq.${id}&select=id,profile_id,discipline,category,run_number,time_ms,dnf,created_at,session&order=created_at`,
      fetchImpl,
    ),
    getAll<RunSplit>(
      `run_splits?event_id=eq.${id}&select=profile_id,discipline,board,run_number,sector_count,line,split_ms,created_at&order=created_at`,
      fetchImpl,
    ),
    // Heats only matter once they have actually run; tolerate failures (finals data is optional).
    getAll<Bracket>(
      `brackets?event_id=eq.${id}&select=id,discipline,category,` +
        "bracket_heats(id,round,heat_number,is_consolation,running_at,completed_at,bracket_entries(profile_id))&order=id",
      fetchImpl,
    ).catch(() => [] as Bracket[]),
  ]);
  return { event, registrations, runs, splits, brackets };
}

export function eventUrl(event: R4Event): string {
  return `https://r4wrun.com/events/${event.slug}/riders`;
}
