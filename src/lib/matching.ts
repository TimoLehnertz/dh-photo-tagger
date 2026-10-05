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
  /** How far (ms) the photo time may be from the expected moment before the score halves-ish (Gaussian σ). */
  toleranceMs: number;
}

export interface Candidate {
  profileId: string;
  score: number; // 0..1
  window: RunWindow;
  /** Photo time minus the expected passing time (or minus the nearest run edge when outside). */
  deltaMs: number;
  /** Where in the run the photo falls: 0 = start, 1 = finish (may be outside 0..1). */
  runFraction: number;
}

const MIN_SCORE = 0.02;

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

function scoreWindow(photoMs: number, w: RunWindow, opts: MatchOptions, model: MatchModel): { score: number; deltaMs: number } {
  const tol = Math.max(opts.toleranceMs, 1);
  let deltaMs: number;
  if (opts.position === null) {
    deltaMs = photoMs < w.startMs ? photoMs - w.startMs : photoMs > w.endMs ? photoMs - w.endMs : 0;
  } else if (w.kind === "heat") {
    deltaMs = photoMs - (w.startMs + opts.position * (w.endMs - w.startMs));
  } else {
    deltaMs = photoMs - expectedPassMs(w, opts.position, model.splitFraction.get(w.discipline));
  }
  return { score: Math.exp(-0.5 * (deltaMs / tol) ** 2), deltaMs };
}

/** Ranked candidate riders for a photo taken at `photoMs` (UTC, already clock-corrected). */
export function rankCandidates(photoMs: number, model: MatchModel, opts: MatchOptions, limit = 12): Candidate[] {
  const reach = opts.toleranceMs * 4;
  const best = new Map<string, Candidate>();
  for (const w of model.windows) {
    if (w.startMs - reach > photoMs) break; // windows are sorted by start
    if (w.endMs + reach < photoMs) continue;
    if (!opts.disciplines.has(w.discipline)) continue;
    const { score, deltaMs } = scoreWindow(photoMs, w, opts, model);
    if (score < MIN_SCORE) continue;
    const runFraction = (photoMs - w.startMs) / (w.endMs - w.startMs);
    for (const profileId of w.profileIds) {
      const prev = best.get(profileId);
      if (!prev || score > prev.score) best.set(profileId, { profileId, score, window: w, deltaMs, runFraction });
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

export interface OffsetSuggestion {
  offsetMs: number;
  matched: number;
  total: number;
}

/**
 * Finds the camera clock offset that puts the most photos inside some run window.
 * `photoMs` are the uncorrected UTC times. Exact sweep over offset space: for every photo the
 * set of offsets that place it inside a run is a union of intervals; we find where most overlap.
 */
export function suggestOffset(
  photoMs: number[],
  windows: RunWindow[],
  disciplines: ReadonlySet<string>,
  rangeMs = 6 * 3600_000,
  marginMs = 5_000,
): OffsetSuggestion | null {
  const ws = windows.filter((w) => disciplines.has(w.discipline));
  if (!photoMs.length || !ws.length) return null;
  const events: [number, number][] = [];
  for (const t of photoMs) {
    const spans: [number, number][] = [];
    for (const w of ws) {
      const lo = Math.max(w.startMs - marginMs - t, -rangeMs);
      const hi = Math.min(w.endMs + marginMs - t, rangeMs);
      if (lo <= hi) spans.push([lo, hi]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    // Merge so that each photo counts at most once at any offset.
    let cur: [number, number] | null = null;
    for (const s of spans) {
      if (cur && s[0] <= cur[1]) cur[1] = Math.max(cur[1], s[1]);
      else {
        if (cur) events.push([cur[0], 1], [cur[1], -1]);
        cur = [s[0], s[1]];
      }
    }
    if (cur) events.push([cur[0], 1], [cur[1], -1]);
  }
  if (!events.length) return { offsetMs: 0, matched: 0, total: photoMs.length };
  // Opening edges sort before closing ones at the same offset (intervals are closed).
  events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);

  let count = 0;
  let bestCount = 0;
  let bestLo = 0;
  let bestHi = 0;
  for (let i = 0; i < events.length; i++) {
    count += events[i][1];
    const lo = events[i][0];
    const hi = i + 1 < events.length ? events[i + 1][0] : lo;
    if (events[i][1] === -1) continue; // count just dropped; the segment after a close can't beat the one before
    const better =
      count > bestCount ||
      (count === bestCount &&
        (hi - lo > bestHi - bestLo ||
          (hi - lo === bestHi - bestLo && Math.abs((lo + hi) / 2) < Math.abs((bestLo + bestHi) / 2))));
    if (better) {
      bestCount = count;
      bestLo = lo;
      bestHi = hi;
    }
  }
  return { offsetMs: Math.round((bestLo + bestHi) / 2 / 1000) * 1000, matched: bestCount, total: photoMs.length };
}

/**
 * Clock offset implied by photos the user has already tagged: the offset that puts every
 * confirmed photo inside its rider's run (or, with a known position, at the expected moment).
 */
export function fitOffsetToPicks(
  pairs: { photoMs: number; window: RunWindow }[],
  position: number | null,
  model: MatchModel,
): number | null {
  if (!pairs.length) return null;
  const spans = pairs.map(({ photoMs, window: w }) => {
    if (position === null) return [w.startMs - photoMs, w.endMs - photoMs] as const;
    const e =
      w.kind === "heat"
        ? w.startMs + position * (w.endMs - w.startMs)
        : expectedPassMs(w, position, model.splitFraction.get(w.discipline));
    return [e - photoMs, e - photoMs] as const;
  });
  const lo = Math.max(...spans.map((s) => s[0]));
  const hi = Math.min(...spans.map((s) => s[1]));
  const raw = lo <= hi ? (lo + hi) / 2 : median(spans.map((s) => (s[0] + s[1]) / 2))!;
  return Math.round(raw / 1000) * 1000;
}

/** For a confirmed (photo, rider) pair, the run window that best explains the photo. */
export function bestWindowFor(profileId: string, photoMs: number, model: MatchModel): RunWindow | null {
  let best: RunWindow | null = null;
  let bestDist = Infinity;
  for (const w of model.windows) {
    if (!w.profileIds.includes(profileId)) continue;
    const dist = photoMs < w.startMs ? w.startMs - photoMs : photoMs > w.endMs ? photoMs - w.endMs : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = w;
    }
  }
  return best;
}
