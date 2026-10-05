import { DISCIPLINES, listEvents, loadEventData, type R4Event } from "./api";
import {
  bestWindowFor,
  buildMatchModel,
  clearWinner,
  fitOffsetToPicks,
  rankCandidates,
  suggestOffset,
  type Athlete,
  type Candidate,
  type MatchModel,
  type OffsetSuggestion,
} from "./matching";
import { athleteLabel, parseSidecar, resolveOriginals, SIDECAR_NAME, taggedFileName, type Sidecar } from "./naming";
import { photoFromScan, photosFromFiles, sortPhotos, type Photo } from "./photos";
import { fileSrc, isTauri, pickFolder, readTextInFolder, renameInFolder, scanFolder, writeTextInFolder } from "./platform";
import { isValidTimeZone, localTimeZone, wallTimeToUtcMs } from "./time";

const SETTINGS_KEY = "dhpt:settings";
const PICKS_KEY = "dhpt:picks";

interface Settings {
  eventId: string | null;
  disciplines: string[];
  timeZone: string | null;
  offsetMs: number;
  position: number | null;
  toleranceMs: number;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

export type PhotoFilter = "all" | "untagged" | "tagged" | "suggested" | "unmatched";

export interface PhotoMatch {
  utcMs: number | null;
  candidates: Candidate[];
  suggestion: Candidate | null;
}

class AppState {
  events = $state.raw<R4Event[]>([]);
  eventsLoading = $state(false);
  eventsError = $state<string | null>(null);

  eventId = $state<string | null>(null);
  model = $state.raw<MatchModel | null>(null);
  eventLoading = $state(false);
  eventError = $state<string | null>(null);

  disciplines = $state<string[]>(DISCIPLINES.map((d) => d.id));
  /** Zone the camera's wall-clock times are read in; null = use the event's zone. */
  timeZoneOverride = $state<string | null>(null);
  offsetMs = $state(0);
  position = $state<number | null>(null);
  toleranceMs = $state(15_000);

  photos = $state<Photo[]>([]);
  selectedKey = $state<string | null>(null);
  filter = $state<PhotoFilter>("all");
  folder = $state<string | null>(null);
  busy = $state<string | null>(null);
  notice = $state<{ kind: "info" | "error"; text: string } | null>(null);
  lastSuggestion = $state<OffsetSuggestion | null>(null);

  #sidecar: Sidecar = parseSidecar(null);
  #renameQueue: Promise<unknown> = Promise.resolve();

  event = $derived(this.events.find((e) => e.id === this.eventId) ?? null);

  timeZone = $derived.by(() => {
    if (this.timeZoneOverride && isValidTimeZone(this.timeZoneOverride)) return this.timeZoneOverride;
    if (isValidTimeZone(this.event?.timezone)) return this.event!.timezone!;
    return localTimeZone();
  });

  disciplineSet = $derived(new Set(this.disciplines));

  /** Photo time in UTC before the clock offset is applied. */
  rawUtc = $derived.by(() => {
    const tz = this.timeZone;
    return new Map(this.photos.map((p) => [p.key, p.wall ? wallTimeToUtcMs(p.wall, tz) : null]));
  });

  matches = $derived.by(() => {
    const out = new Map<string, PhotoMatch>();
    const model = this.model;
    const opts = { disciplines: this.disciplineSet, position: this.position, toleranceMs: this.toleranceMs };
    for (const p of this.photos) {
      const raw = this.rawUtc.get(p.key);
      const utcMs = raw == null ? null : raw + this.offsetMs;
      const candidates = model && utcMs != null ? rankCandidates(utcMs, model, opts) : [];
      out.set(p.key, { utcMs, candidates, suggestion: clearWinner(candidates) });
    }
    return out;
  });

  visiblePhotos = $derived.by(() => {
    const f = this.filter;
    if (f === "all") return this.photos;
    return this.photos.filter((p) => {
      const m = this.matches.get(p.key);
      if (f === "tagged") return p.picks.length > 0;
      if (f === "untagged") return p.picks.length === 0;
      if (f === "suggested") return p.picks.length === 0 && !!m?.suggestion;
      return !m?.candidates.length; // unmatched
    });
  });

  selected = $derived(this.photos.find((p) => p.key === this.selectedKey) ?? null);

  stats = $derived.by(() => {
    let tagged = 0;
    let suggested = 0;
    let matched = 0;
    for (const p of this.photos) {
      const m = this.matches.get(p.key);
      if (p.picks.length) tagged++;
      else if (m?.suggestion) suggested++;
      if (m?.candidates.length) matched++;
    }
    return { total: this.photos.length, tagged, suggested, matched };
  });

  constructor() {
    const s = loadJson<Settings>(SETTINGS_KEY, {
      eventId: null,
      disciplines: DISCIPLINES.map((d) => d.id),
      timeZone: null,
      offsetMs: 0,
      position: null,
      toleranceMs: 15_000,
    });
    this.eventId = s.eventId;
    this.disciplines = s.disciplines;
    this.timeZoneOverride = s.timeZone;
    this.offsetMs = s.offsetMs;
    this.position = s.position;
    this.toleranceMs = s.toleranceMs;

    $effect.root(() => {
      $effect(() => {
        saveJson(SETTINGS_KEY, {
          eventId: this.eventId,
          disciplines: this.disciplines,
          timeZone: this.timeZoneOverride,
          offsetMs: this.offsetMs,
          position: this.position,
          toleranceMs: this.toleranceMs,
        } satisfies Settings);
      });
    });
  }

  athlete(profileId: string): Athlete | undefined {
    return this.model?.athletes.get(profileId);
  }

  async loadEvents() {
    this.eventsLoading = true;
    this.eventsError = null;
    try {
      this.events = await listEvents();
      if (this.eventId && this.events.some((e) => e.id === this.eventId)) await this.selectEvent(this.eventId);
      else this.eventId = null;
    } catch (e) {
      this.eventsError = String((e as Error).message ?? e);
    } finally {
      this.eventsLoading = false;
    }
  }

  async selectEvent(id: string | null) {
    this.eventId = id;
    this.model = null;
    this.eventError = null;
    const event = this.events.find((e) => e.id === id);
    if (!event) {
      this.eventLoading = false;
      return;
    }
    this.eventLoading = true;
    try {
      const data = await loadEventData(event);
      if (this.eventId !== id) return; // user switched events meanwhile
      this.model = buildMatchModel(data);
      if (!this.model.windows.length) this.notify("info", "This event has no timed runs yet — there is nothing to match photos against.");
    } catch (e) {
      if (this.eventId === id) this.eventError = String((e as Error).message ?? e);
    } finally {
      if (this.eventId === id) this.eventLoading = false;
    }
  }

  toggleDiscipline(id: string) {
    this.disciplines = this.disciplines.includes(id) ? this.disciplines.filter((d) => d !== id) : [...this.disciplines, id];
  }

  notify(kind: "info" | "error", text: string) {
    this.notice = { kind, text };
  }

  // ---- importing ----------------------------------------------------------------------------

  async addFiles(files: File[]) {
    this.busy = `Reading ${files.length} file(s)…`;
    try {
      const incoming = await photosFromFiles(files);
      const saved = loadJson<Record<string, { picks: string[]; names: string[] }>>(PICKS_KEY, {});
      const known = new Set(this.photos.map((p) => p.key));
      const fresh = incoming.filter((p) => !known.has(p.key));
      for (const p of fresh) {
        const s = saved[p.key];
        if (s) {
          p.picks = s.picks;
          p.pickNames = s.names;
        }
      }
      this.photos = sortPhotos([...this.photos, ...fresh]);
      const skipped = files.length - incoming.length;
      if (skipped > 0) this.notify("info", `Skipped ${skipped} file(s) that are not images.`);
      this.afterImport(fresh);
    } finally {
      this.busy = null;
    }
  }

  async openFolder() {
    const dir = await pickFolder();
    if (dir) await this.loadFolder(dir);
  }

  async loadFolder(dir: string) {
    this.busy = "Scanning folder…";
    try {
      const [scanned, sidecarText] = await Promise.all([scanFolder(dir), readTextInFolder(dir, SIDECAR_NAME)]);
      this.#sidecar = parseSidecar(sidecarText);
      const originals = resolveOriginals(
        scanned.map((s) => s.name),
        this.#sidecar,
      );
      const photos = scanned.map((s) => {
        const { original, entry } = originals.get(s.name)!;
        const p = photoFromScan(s, original);
        if (entry) {
          p.picks = entry.picks;
          p.pickNames = entry.names;
        }
        return p;
      });
      this.folder = dir;
      this.photos = sortPhotos(photos);
      this.selectedKey = null;
      if (typeof this.#sidecar.offsetMs === "number") this.offsetMs = this.#sidecar.offsetMs;
      if (this.#sidecar.eventId && this.#sidecar.eventId !== this.eventId && this.events.some((e) => e.id === this.#sidecar.eventId)) {
        await this.selectEvent(this.#sidecar.eventId);
      }
      if (!photos.length) this.notify("info", "No images found in that folder.");
      this.afterImport(photos);
    } catch (e) {
      this.notify("error", `Could not read folder: ${(e as Error).message ?? e}`);
    } finally {
      this.busy = null;
    }
  }

  private afterImport(added: Photo[]) {
    if (!this.selectedKey && this.photos.length) this.selectedKey = this.photos[0].key;
    const noExif = added.filter((p) => !p.wall).length;
    if (noExif) this.notify("info", `${noExif} photo(s) have no capture time in EXIF and can't be matched automatically.`);
  }

  clearPhotos() {
    for (const p of this.photos) if (p.src.startsWith("blob:")) URL.revokeObjectURL(p.src);
    this.photos = [];
    this.selectedKey = null;
    this.folder = null;
  }

  // ---- clock offset ------------------------------------------------------------------------

  autoOffset() {
    if (!this.model) return;
    const times = [...this.rawUtc.values()].filter((t): t is number => t != null);
    const s = suggestOffset(times, this.model.windows, this.disciplineSet);
    this.lastSuggestion = s;
    if (!s || s.matched === 0) {
      this.notify("info", "No clock offset within ±6 h puts any photo inside a run. Check the event, disciplines and time zone.");
      return;
    }
    this.offsetMs = s.offsetMs;
    this.persistFolderMeta();
  }

  /** Re-derives the offset from photos the user already confirmed. */
  fitToPicks() {
    const model = this.model;
    if (!model) return;
    const pairs: { photoMs: number; window: NonNullable<ReturnType<typeof bestWindowFor>> }[] = [];
    for (const p of this.photos) {
      const raw = this.rawUtc.get(p.key);
      if (raw == null || p.picks.length !== 1) continue; // single-rider photos are unambiguous
      const w = bestWindowFor(p.picks[0], raw + this.offsetMs, model);
      if (w) pairs.push({ photoMs: raw, window: w });
    }
    const off = fitOffsetToPicks(pairs, this.position, model);
    if (off === null) {
      this.notify("info", "Tag a few photos with a single rider first, then fit the clock to them.");
      return;
    }
    this.offsetMs = off;
    this.persistFolderMeta();
    this.notify("info", `Clock offset fitted to ${pairs.length} tagged photo(s).`);
  }

  setOffset(ms: number) {
    this.offsetMs = ms;
    this.persistFolderMeta();
  }

  // ---- picking -----------------------------------------------------------------------------

  isPicked(photo: Photo, profileId: string) {
    return photo.picks.includes(profileId);
  }

  async togglePick(photo: Photo, profileId: string) {
    const picks = photo.picks.includes(profileId) ? photo.picks.filter((p) => p !== profileId) : [...photo.picks, profileId];
    await this.setPicks(photo, picks);
  }

  async acceptSuggestions() {
    const todo = this.photos.filter((p) => !p.picks.length && this.matches.get(p.key)?.suggestion);
    for (const p of todo) await this.setPicks(p, [this.matches.get(p.key)!.suggestion!.profileId]);
    this.notify("info", `Accepted ${todo.length} suggestion(s).`);
  }

  async setPicks(photo: Photo, picks: string[]) {
    const names = picks.map((id) => {
      const a = this.athlete(id);
      const i = photo.picks.indexOf(id);
      return a ? athleteLabel(a.firstName, a.lastName) || athleteLabel(a.name, "") : (photo.pickNames[i] ?? id);
    });
    const prev = { picks: photo.picks, names: photo.pickNames };
    photo.picks = picks;
    photo.pickNames = names;
    if (isTauri && this.folder) {
      try {
        await this.queue(() => this.renameForPicks(photo));
      } catch (e) {
        photo.picks = prev.picks;
        photo.pickNames = prev.names;
        this.notify("error", `Rename failed: ${(e as Error).message ?? e}`);
      }
    } else {
      const saved = loadJson<Record<string, { picks: string[]; names: string[] }>>(PICKS_KEY, {});
      if (picks.length) saved[photo.key] = { picks, names };
      else delete saved[photo.key];
      saveJson(PICKS_KEY, saved);
    }
  }

  private queue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#renameQueue.then(task, task);
    this.#renameQueue = next.catch(() => undefined);
    return next;
  }

  private async renameForPicks(photo: Photo) {
    const dir = this.folder!;
    const target = taggedFileName(photo.originalName, photo.pickNames);
    if (target !== photo.name) {
      const finalName = await renameInFolder(dir, photo.name, target);
      const newPath = photo.path!.slice(0, photo.path!.length - photo.name.length) + finalName;
      photo.name = finalName;
      photo.path = newPath;
      photo.src = fileSrc(newPath);
    }
    if (photo.picks.length || photo.name !== photo.originalName) {
      this.#sidecar.files[photo.originalName] = { current: photo.name, picks: photo.picks, names: photo.pickNames };
    } else {
      delete this.#sidecar.files[photo.originalName];
    }
    await this.writeSidecar();
  }

  private persistFolderMeta() {
    if (!isTauri || !this.folder) return;
    void this.queue(() => this.writeSidecar()).catch(() => undefined);
  }

  private async writeSidecar() {
    if (!this.folder) return;
    this.#sidecar.eventId = this.eventId ?? undefined;
    this.#sidecar.offsetMs = this.offsetMs;
    await writeTextInFolder(this.folder, SIDECAR_NAME, JSON.stringify(this.#sidecar, null, 2));
  }

  // ---- navigation --------------------------------------------------------------------------

  step(delta: number) {
    const list = this.visiblePhotos;
    if (!list.length) return;
    const i = list.findIndex((p) => p.key === this.selectedKey);
    const next = Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
    this.selectedKey = list[next].key;
  }
}

export const app = new AppState();
