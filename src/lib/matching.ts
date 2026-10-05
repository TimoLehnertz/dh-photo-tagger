import type { EventData, SuitColors } from "./api";

export interface Athlete {
  profileId: string;
  firstName: string;
  lastName: string;
  name: string;
  country: string | null;
  username: string | null;
  avatarUrl: string | null;
  suitColors: SuitColors | null;
  registrations: { discipline: string; category: string | null; bib: string | null }[];
}

/** A time span during which one or more riders were on course. */
export interface RunWindow {
  id: string;
  kind: "qualifying" | "heat";
  profileIds: string[];
  discipline: string;
  category: string | null;
  label: string;
  startMs: number;
  endMs: number;
  /** Time from start to the first intermediate split, when known. */
  splitMs: number | null;
  dnf: boolean;
}

export interface MatchModel {
  athletes: Map<string, Athlete>;
  windows: RunWindow[]; // sorted by startMs
  /** Per discipline: median fraction of the run time at which riders reach the first split. */
  splitFraction: Map<string, number>;
}

export interface MatchOptions {
  disciplines: ReadonlySet<string>;
  /**
   * Photographer's position on course as a fraction of the average run time (0 = start,
   * 1 = finish), or null when unknown (then any moment inside a run scores equally).
   */
  position: number | null;
  /**
   * Match window: how long before a run starts / after it finishes (ms) a photo or clip still counts
   * for that rider. With a known position, the window is around the expected passing moment instead.
   * Anything outside the window is not a candidate.
   */
  beforeMs: number;
  afterMs: number;
}

/** Score at the very edge of the match window; inside the run (or at the expected moment) it is 1. */
const EDGE_SCORE = 0.1;
/** With a known position the moment is exact, so a zero-width window would never match. */
const MIN_POSITION_WINDOW_MS = 1000;

export interface Candidate {
  profileId: string;
  score: number; // 0..1
  window: RunWindow;
  /**
   * Signed gap between the media and the rider: 0 when they overlap; negative when the photo/clip
   * ends before the expected passing moment (or before the run starts), positive when it starts after.
   */
  deltaMs: number;
  /** Where in the run the rider is at `moment`: 0 = start, 1 = finish (may be outside 0..1). */
  runFraction: number;
  /** For a clip: how far into it (ms) the rider should be visible. Always 0 for photos. */
  clipOffsetMs: number;
}

/** A photo is an instant (durationMs 0); a video clip covers [startMs, startMs + durationMs]. */
export interface TimeSpan {
  startMs: number;
  durationMs?: number;
}

function spanOf(t: number | TimeSpan): [number, number] {
  if (typeof t === "number") return [t, t];
  return [t.startMs, t.startMs + Math.max(0, t.durationMs ?? 0)];
}

/** Signed distance from the span [a, b] to the moment/range [lo, hi]; 0 when they overlap. */
function gap(a: number, b: number, lo: number, hi: number): number {
  if (b < lo) return b - lo;
  if (a > hi) return a - hi;
  return 0;
}


function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sessionLabel(session: string | null, runNumber: number): string {
  const s = session ? session.toUpperCase() : null;
  return s ? `${s} · run ${runNumber}` : `Run ${runNumber}`;
}

export function buildMatchModel(data: EventData): MatchModel {
  const athletes = new Map<string, Athlete>();
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
        suitColors: p?.suit_colors && Object.values(p.suit_colors).some(Boolean) ? p.suit_colors : null,
        registrations: [],
      };
      athletes.set(reg.profile_id, a);
    }
    a.registrations.push({ discipline: reg.discipline, category: reg.category, bib: reg.bib_number });
  }

  // First intermediate split per (rider, discipline, run).
  const splitByRun = new Map<string, number>();
  for (const s of data.splits) {
    if (s.split_ms == null || s.split_ms <= 0) continue;
    if (s.board && s.board !== "qualifying") continue;
    const key = `${s.profile_id}|${s.discipline}|${s.run_number}`;
    const prev = splitByRun.get(key);
    if (prev === undefined || s.split_ms < prev) splitByRun.set(key, s.split_ms);
  }

  const durationsByDiscipline = new Map<string, number[]>();
  for (const r of data.runs) {
    if (r.time_ms && r.time_ms > 0 && !r.dnf) {
      const list = durationsByDiscipline.get(r.discipline) ?? [];
      list.push(r.time_ms);
      durationsByDiscipline.set(r.discipline, list);
    }
  }
  const medianDuration = new Map([...durationsByDiscipline].map(([d, v]) => [d, median(v)!]));

  const windows: RunWindow[] = [];
  const fractions = new Map<string, number[]>();
  for (const r of data.runs) {
    // created_at is when the result was recorded ≈ the finish time.
    const endMs = Date.parse(r.created_at);
    if (Number.isNaN(endMs)) continue;
    const duration = r.time_ms && r.time_ms > 0 ? r.time_ms : medianDuration.get(r.discipline);
    if (!duration) continue;
    let splitMs = splitByRun.get(`${r.profile_id}|${r.discipline}|${r.run_number}`) ?? null;
    if (splitMs !== null && (r.dnf || splitMs >= duration)) splitMs = null;
    if (splitMs !== null) {
      const list = fractions.get(r.discipline) ?? [];
      list.push(splitMs / duration);
      fractions.set(r.discipline, list);
    }
    windows.push({
      id: `q:${r.id}`,
      kind: "qualifying",
      profileIds: [r.profile_id],
      discipline: r.discipline,
      category: r.category,
      label: sessionLabel(r.session, r.run_number) + (r.dnf ? " · DNF" : ""),
      startMs: endMs - duration,
      endMs,
      splitMs,
      dnf: r.dnf,
    });
  }

  for (const b of data.brackets) {
    for (const h of b.bracket_heats ?? []) {
      if (!h.running_at || !h.completed_at) continue;
      const startMs = Date.parse(h.running_at);
      const endMs = Date.parse(h.completed_at);
      // Ignore missing/implausible timing (e.g. heats marked complete without ever running).
      if (!(endMs > startMs) || endMs - startMs > 30 * 60_000) continue;
      windows.push({
        id: `h:${h.id}`,
        kind: "heat",
        profileIds: h.bracket_entries.map((e) => e.profile_id),
        discipline: b.discipline,
        category: b.category,
        label: `${h.is_consolation ? "Consolation" : "Round"} ${h.round} · heat ${h.heat_number}`,
        startMs,
        endMs,
        splitMs: null,
        dnf: false,
      });
    }
  }

  windows.sort((a, b) => a.startMs - b.startMs);
  const splitFraction = new Map([...fractions].map(([d, v]) => [d, median(v)!]));
  return { athletes, windows, splitFraction };
}

/**
 * When a rider at course `position` (fraction of the average run time) is expected to pass.
 * With a known split, the run is modelled piecewise so a fast start / slow finish is respected.
 */
export function expectedPassMs(w: RunWindow, position: number, refSplitFraction: number | undefined): number {
  const duration = w.endMs - w.startMs;
  if (w.splitMs !== null && refSplitFraction && refSplitFraction > 0 && refSplitFraction < 1) {
    if (position <= refSplitFraction) return w.startMs + (position / refSplitFraction) * w.splitMs;
    return w.startMs + w.splitMs + ((position - refSplitFraction) / (1 - refSplitFraction)) * (duration - w.splitMs);
  }
  return w.startMs + position * duration;
}

function expectedMoment(w: RunWindow, position: number, model: MatchModel): number {
  return w.kind === "heat"
    ? w.startMs + position * (w.endMs - w.startMs)
    : expectedPassMs(w, position, model.splitFraction.get(w.discipline));
}

/** Linear falloff from 1 (deltaMs = 0) to EDGE_SCORE at the window edge; 0 outside the window. */
export function windowScore(deltaMs: number, beforeMs: number, afterMs: number): number {
  if (deltaMs === 0) return 1;
  // deltaMs < 0: the photo/clip is earlier than the run (or than the expected passing moment).
  const margin = deltaMs < 0 ? beforeMs : afterMs;
  const d = Math.abs(deltaMs);
  if (d > margin) return 0;
  return 1 - (1 - EDGE_SCORE) * (d / margin);
}

function scoreWindow(a: number, b: number, w: RunWindow, opts: MatchOptions, model: MatchModel) {
  let deltaMs: number;
  let moment: number; // the instant inside [a, b] that best shows this rider
  let before = opts.beforeMs;
  let after = opts.afterMs;
  if (opts.position === null) {
    deltaMs = gap(a, b, w.startMs, w.endMs);
    moment = Math.min(Math.max(w.startMs, a), b);
  } else {
    const e = expectedMoment(w, opts.position, model);
    deltaMs = gap(a, b, e, e);
    moment = Math.min(Math.max(e, a), b);
    before = Math.max(before, MIN_POSITION_WINDOW_MS);
    after = Math.max(after, MIN_POSITION_WINDOW_MS);
  }
  return { score: windowScore(deltaMs, before, after), deltaMs, moment };
}

/**
 * Ranked candidate riders for a photo taken at `media` (UTC ms, already clock-corrected), or for a
 * video clip spanning `{ startMs, durationMs }`.
 */
export function rankCandidates(media: number | TimeSpan, model: MatchModel, opts: MatchOptions, limit = 12): Candidate[] {
  const [a, b] = spanOf(media);
  const reach = Math.max(opts.beforeMs, opts.afterMs, MIN_POSITION_WINDOW_MS);
  const best = new Map<string, Candidate>();
  for (const w of model.windows) {
    if (w.startMs - reach > b) break; // windows are sorted by start
    if (w.endMs + reach < a) continue;
    if (!opts.disciplines.has(w.discipline)) continue;
    const { score, deltaMs, moment } = scoreWindow(a, b, w, opts, model);
    if (score <= 0) continue;
    const runFraction = (moment - w.startMs) / (w.endMs - w.startMs);
    const clipOffsetMs = moment - a;
    for (const profileId of w.profileIds) {
      const prev = best.get(profileId);
      if (!prev || score > prev.score) best.set(profileId, { profileId, score, window: w, deltaMs, runFraction, clipOffsetMs });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || Math.abs(a.deltaMs) - Math.abs(b.deltaMs))
    .slice(0, limit);
}

/** The single candidate worth pre-selecting, if one is clearly ahead of the rest. */
export function clearWinner(candidates: Candidate[]): Candidate | null {
  const [top, second] = candidates;
  if (!top || top.score < 0.5) return null;
  if (second && second.score > top.score * 0.5) return null;
  return top;
}

/**
 * Clock offset implied by photos the user has already tagged: the offset that puts every
 * confirmed photo inside its rider's run (or, with a known position, at the expected moment).
 */
export function fitOffsetToPicks(
  pairs: { media: number | TimeSpan; window: RunWindow }[],
  position: number | null,
  model: MatchModel,
): number | null {
  if (!pairs.length) return null;
  const spans = pairs.map(({ media, window: w }) => {
    const [a, b] = spanOf(media);
    if (position === null) return [w.startMs - b, w.endMs - a] as const;
    const e = expectedMoment(w, position, model);
    return [e - b, e - a] as const;
  });
  const lo = Math.max(...spans.map((s) => s[0]));
  const hi = Math.min(...spans.map((s) => s[1]));
  const raw = lo <= hi ? (lo + hi) / 2 : median(spans.map((s) => (s[0] + s[1]) / 2))!;
  return Math.round(raw / 1000) * 1000;
}

/**
 * For a confirmed (photo/clip, rider) pair, the run window that best explains it. Runs further than
 * `maxGapMs` from the (clock-corrected) media are ignored: when the rider's run at that moment is
 * missing from the timing data, their nearest other run is the wrong one to fit a clock to.
 */
export function bestWindowFor(profileId: string, media: number | TimeSpan, model: MatchModel, maxGapMs = Infinity): RunWindow | null {
  const [a, b] = spanOf(media);
  let best: RunWindow | null = null;
  let bestDist = maxGapMs;
  for (const w of model.windows) {
    if (!w.profileIds.includes(profileId)) continue;
    const dist = Math.abs(gap(a, b, w.startMs, w.endMs));
    if (dist < bestDist) {
      bestDist = dist;
      best = w;
    }
  }
  return best;
}
