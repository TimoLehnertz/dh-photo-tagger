export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff", "webp"];

export function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(splitExt(name).ext.slice(1).toLowerCase());
}

/** "a.b.JPG" → { stem: "a.b", ext: ".JPG" }. Extension case is preserved. */
export function splitExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf(".");
  if (i <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

/** File-name-safe label for a rider: "Enric Umbert" → "Enric-Umbert", "José Ñúñez" → "Jose-Nunez". */
export function athleteLabel(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `03_..-0271.jpg` + ["Enric-Umbert"] → `03_..-0271_Enric-Umbert.jpg`. */
export function taggedFileName(originalName: string, labels: string[]): string {
  const { stem, ext } = splitExt(originalName);
  const clean = labels.filter(Boolean);
  return clean.length ? `${stem}_${clean.join("_")}${ext}` : originalName;
}

/** Sidecar stored next to the photos (Mac) so renamed files can be mapped back to their originals. */
export const SIDECAR_NAME = ".dh-photo-tagger.json";

export interface SidecarEntry {
  current: string;
  picks: string[];
  names: string[];
}

export interface Sidecar {
  version: 1;
  eventId?: string;
  offsetMs?: number;
  files: Record<string, SidecarEntry>; // keyed by original file name
}

export function emptySidecar(): Sidecar {
  return { version: 1, files: {} };
}

export function parseSidecar(text: string | null): Sidecar {
  if (!text) return emptySidecar();
  try {
    const data = JSON.parse(text);
    if (data && data.version === 1 && data.files && typeof data.files === "object") return data as Sidecar;
  } catch {
    /* fall through */
  }
  return emptySidecar();
}

/** Maps the files currently on disk back to their original names using the sidecar. */
export function resolveOriginals(currentNames: string[], sidecar: Sidecar): Map<string, { original: string; entry?: SidecarEntry }> {
  const byCurrent = new Map<string, [string, SidecarEntry]>();
  for (const [original, entry] of Object.entries(sidecar.files)) byCurrent.set(entry.current, [original, entry]);
  const out = new Map<string, { original: string; entry?: SidecarEntry }>();
  for (const name of currentNames) {
    const hit = byCurrent.get(name);
    out.set(name, hit ? { original: hit[0], entry: hit[1] } : { original: name });
  }
  return out;
}
