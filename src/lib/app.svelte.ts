import { DISCIPLINES, listEvents, loadEventData, type EventData, type R4Event } from "./api";
import { applyFilters, buildRoster, type Athlete, type ColorName, type SuitPart } from "./roster";
import { athleteLabel, parseSidecar, resolveOriginals, SIDECAR_NAME, taggedFileName, type Sidecar } from "./naming";
import { photoFromScan, photosFromFiles, sortPhotos, type Photo } from "./photos";
import { fileSrc, isTauri, pickFolder, readTextInFolder, renameInFolder, scanFolder, writeTextInFolder } from "./platform";
import { captureDateRange, eventsOverlapping } from "./events";
import { videoPoster } from "./video";
import type { TextHit } from "./bibs";
import { readPhotoText } from "./bibReader";

/** Start-number reading state of one photo. */
export type NumberScan = { status: "running"; progress: number } | { status: "done"; hits: TextHit[] } | { status: "error"; error: string };

const SETTINGS_KEY = "dhpt:settings";
const PICKS_KEY = "dhpt:picks";

interface Settings {
  autoReadNumbers: boolean;
  eventIds: string[];
  disciplines: string[];
  raceFrom: string | null;
  raceTo: string | null;
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

export type PhotoFilter = "all" | "untagged" | "tagged" | "videos";

class AppState {
  events = $state.raw<R4Event[]>([]);
  eventsLoading = $state(false);
  eventsError = $state<string | null>(null);

  /** Events the athletes and schedule come from. */
  eventIds = $state<string[]>([]);
  /** Loaded data per event id. */
  eventData = $state.raw<Map<string, EventData>>(new Map());
  loadingEventIds = $state<string[]>([]);
  eventErrors = $state.raw<Map<string, string>>(new Map());

  // Filters, applied in this order.
  disciplines = $state<string[]>(DISCIPLINES.map((d) => d.id));
  raceFrom = $state<string | null>(null);
  raceTo = $state<string | null>(null);
  suit = $state<Partial<Record<SuitPart, ColorName[]>>>({});
  query = $state("");

  /** Read start numbers automatically for the photo being viewed. */
  autoReadNumbers = $state(false);
  numberScans = $state.raw<Map<string, NumberScan>>(new Map());

  photos = $state<Photo[]>([]);
  selectedKey = $state<string | null>(null);
  filter = $state<PhotoFilter>("all");
  folder = $state<string | null>(null);
  busy = $state<string | null>(null);
  notice = $state<{ kind: "info" | "error"; text: string } | null>(null);

  #sidecar: Sidecar = parseSidecar(null);
  #renameQueue: Promise<unknown> = Promise.resolve();

  selectedEvents = $derived(this.eventIds.map((id) => this.events.find((e) => e.id === id)).filter((e): e is R4Event => !!e));

  /** Capture dates (camera clock) of everything loaded. */
  captureRange = $derived(captureDateRange(this.photos.map((p) => p.wall)));
  /** Events whose dates cover the loaded files' capture dates. */
  eventsOnPhotoDates = $derived(this.captureRange ? eventsOverlapping(this.events, this.captureRange, 0) : []);

  roster = $derived(buildRoster(this.eventIds.map((id) => this.eventData.get(id)).filter((d): d is EventData => !!d)));

  filtered = $derived(
    applyFilters(this.roster, {
      disciplines: new Set(this.disciplines),
      raceFrom: this.raceFrom,
      raceTo: this.raceTo,
      suit: this.suit,
      query: this.query,
    }),
  );

  hasVideos = $derived(this.photos.some((p) => p.kind === "video"));

  visiblePhotos = $derived.by(() => {
    const f = this.filter;
    if (f === "all") return this.photos;
    return this.photos.filter((p) => {
      if (f === "tagged") return p.picks.length > 0;
      if (f === "untagged") return p.picks.length === 0;
      return p.kind === "video";
    });
  });

  selected = $derived(this.photos.find((p) => p.key === this.selectedKey) ?? null);

  stats = $derived({ total: this.photos.length, tagged: this.photos.filter((p) => p.picks.length).length });

  constructor() {
    const s = loadJson<Settings & { eventId?: string | null }>(SETTINGS_KEY, {
      autoReadNumbers: false,
      eventIds: [],
      disciplines: DISCIPLINES.map((d) => d.id),
      raceFrom: null,
      raceTo: null,
    });
    this.autoReadNumbers = s.autoReadNumbers;
    this.eventIds = s.eventIds?.length ? s.eventIds : s.eventId ? [s.eventId] : [];
    this.disciplines = s.disciplines;
    this.raceFrom = s.raceFrom;
    this.raceTo = s.raceTo;

    $effect.root(() => {
      $effect(() => {
        const p = this.selected;
        if (this.autoReadNumbers && p && p.kind !== "video" && !this.numberScans.has(p.key)) void this.readNumbers(p);
      });
      $effect(() => {
        saveJson(SETTINGS_KEY, {
          autoReadNumbers: this.autoReadNumbers,
          eventIds: this.eventIds,
          disciplines: this.disciplines,
          raceFrom: this.raceFrom,
          raceTo: this.raceTo,
        } satisfies Settings);
      });
    });
  }

  athlete(profileId: string): Athlete | undefined {
    return this.roster.athletes.get(profileId);
  }

  // ---- events ------------------------------------------------------------------------------

  async loadEvents() {
    this.eventsLoading = true;
    this.eventsError = null;
    try {
      this.events = await listEvents();
      this.eventIds = this.eventIds.filter((id) => this.events.some((e) => e.id === id));
      await Promise.all(this.eventIds.map((id) => this.loadEvent(id)));
    } catch (e) {
      this.eventsError = String((e as Error).message ?? e);
    } finally {
      this.eventsLoading = false;
    }
  }

  isEventSelected(id: string) {
    return this.eventIds.includes(id);
  }

  async toggleEvent(id: string) {
    if (this.eventIds.includes(id)) {
      this.eventIds = this.eventIds.filter((e) => e !== id);
    } else {
      this.eventIds = [...this.eventIds, id];
      await this.loadEvent(id);
    }
    this.persistFolderMeta();
  }

  async setEvents(ids: string[]) {
    this.eventIds = ids.filter((id) => this.events.some((e) => e.id === id));
    await Promise.all(this.eventIds.map((id) => this.loadEvent(id)));
  }

  async loadEvent(id: string, force = false) {
    if ((!force && this.eventData.has(id)) || this.loadingEventIds.includes(id)) return;
    const event = this.events.find((e) => e.id === id);
    if (!event) return;
    this.loadingEventIds = [...this.loadingEventIds, id];
    const errors = new Map(this.eventErrors);
    errors.delete(id);
    this.eventErrors = errors;
    try {
      const data = await loadEventData(event);
      this.eventData = new Map(this.eventData).set(id, data);
    } catch (e) {
      this.eventErrors = new Map(this.eventErrors).set(id, String((e as Error).message ?? e));
    } finally {
      this.loadingEventIds = this.loadingEventIds.filter((x) => x !== id);
    }
  }

  // ---- filters -----------------------------------------------------------------------------

  toggleDiscipline(id: string) {
    this.disciplines = this.disciplines.includes(id) ? this.disciplines.filter((d) => d !== id) : [...this.disciplines, id];
  }

  toggleSuitColor(part: SuitPart, color: ColorName) {
    const cur = this.suit[part] ?? [];
    const next = cur.includes(color) ? cur.filter((c) => c !== color) : [...cur, color];
    this.suit = { ...this.suit, [part]: next };
  }

  clearSuit(part?: SuitPart) {
    if (!part) this.suit = {};
    else this.suit = { ...this.suit, [part]: [] };
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
      if (skipped > 0) this.notify("info", `Skipped ${skipped} file(s) that are not photos or MP4/MOV videos.`);
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
      const photos = await Promise.all(
        scanned.map(async (s) => {
          const { original, entry } = originals.get(s.name)!;
          const p = await photoFromScan(s, original, dir);
          if (entry) {
            p.picks = entry.picks;
            p.pickNames = entry.names;
          }
          return p;
        }),
      );
      this.folder = dir;
      this.photos = sortPhotos(photos);
      this.selectedKey = null;
      const saved = this.#sidecar.eventIds ?? (this.#sidecar.eventId ? [this.#sidecar.eventId] : []);
      if (saved.length) await this.setEvents(saved);
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
    void this.loadPosters(added.filter((p) => p.kind === "video"));
  }

  /** Grabs a preview frame for each clip, one at a time to keep decoding light. */
  private async loadPosters(videos: Photo[]) {
    for (const v of videos) {
      if (v.thumb) continue;
      const poster = await videoPoster(v.src);
      // The list may have been replaced (new folder) while we were decoding.
      const live = this.photos.find((p) => p.key === v.key);
      if (live && poster) live.thumb = poster;
    }
  }

  clearPhotos() {
    for (const p of this.photos) if (p.src.startsWith("blob:")) URL.revokeObjectURL(p.src);
    this.photos = [];
    this.selectedKey = null;
    this.folder = null;
  }

  // ---- start numbers ---------------------------------------------------------------------

  private setScan(key: string, scan: NumberScan) {
    this.numberScans = new Map(this.numberScans).set(key, scan);
  }

  /** Reads the text in a photo locally and keeps the start-number candidates. */
  async readNumbers(photo: Photo, force = false) {
    const cur = this.numberScans.get(photo.key);
    if (cur?.status === "running" || (cur?.status === "done" && !force)) return;
    const key = photo.key;
    this.setScan(key, { status: "running", progress: 0 });
    try {
      const hits = await readPhotoText(photo, (progress) => this.setScan(key, { status: "running", progress }));
      this.setScan(key, { status: "done", hits });
    } catch (e) {
      this.setScan(key, { status: "error", error: String((e as Error).message ?? e) });
    }
  }

  /** Athletes of the selected events (and disciplines) wearing this start number. */
  athletesWithBib(bib: string): Athlete[] {
    const out: Athlete[] = [];
    for (const a of this.roster.athletes.values()) {
      if (a.registrations.some((r) => r.bib === bib && this.disciplines.includes(r.discipline))) out.push(a);
    }
    return out;
  }

  /** Clicking a detected number: search for it, and tag the athlete right away when it is unambiguous. */
  async pickNumber(photo: Photo, bib: string) {
    this.query = `#${bib}`;
    const found = this.athletesWithBib(bib);
    if (found.length === 1 && !photo.picks.includes(found[0].profileId)) await this.togglePick(photo, found[0].profileId);
  }

  // ---- tagging -----------------------------------------------------------------------------

  async togglePick(photo: Photo, profileId: string) {
    const picks = photo.picks.includes(profileId) ? photo.picks.filter((p) => p !== profileId) : [...photo.picks, profileId];
    await this.setPicks(photo, picks);
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
    this.#sidecar.eventIds = this.eventIds;
    delete this.#sidecar.eventId;
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
