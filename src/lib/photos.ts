import exifr from "exifr";
import { mediaKindOf, type MediaKind } from "./naming";
import { fileSrc, readFileRange, type ScannedImage } from "./platform";
import { formatWallTime, parseExifDateTime, type WallTime } from "./time";
import { fileRangeReader, readVideoMeta, type RangeReader, type VideoMeta } from "./video";

/** A photo or a video clip. (Named Photo for history; `kind` tells them apart.) */
export interface Photo {
  /** Stable identity across renames: original file name + raw capture time. */
  key: string;
  kind: MediaKind;
  /** Current file name (changes on the Mac when riders are appended). */
  name: string;
  originalName: string;
  /** Absolute path (Mac only). */
  path: string | null;
  src: string;
  /** Small preview image: embedded EXIF thumbnail, or a frame grabbed from a video. */
  thumb: string | null;
  orientation: number;
  /**
   * Capture time as written by the camera, without a zone. For videos this is the container's
   * creation time read as a clock reading (see `videoClock` in the app settings).
   */
  wall: WallTime | null;
  offsetTag: string | null;
  /** Clip length; null for photos. */
  durationMs: number | null;
  /** Confirmed riders (profile ids) and the labels that were written for them. */
  picks: string[];
  pickNames: string[];
}

export function photoKey(originalName: string, wall: WallTime | null): string {
  return `${originalName}|${wall ? formatWallTime(wall) : "?"}`;
}

/** The container stores seconds since an epoch; expose its clock reading as a WallTime. */
export function wallFromVideoMeta(meta: VideoMeta | null): WallTime | null {
  if (!meta?.creationMs) return null;
  const d = new Date(meta.creationMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}

async function videoMeta(read: RangeReader, size: number): Promise<VideoMeta | null> {
  try {
    return await readVideoMeta(read, size);
  } catch {
    return null;
  }
}

async function photoFromFile(file: File, kind: MediaKind): Promise<Photo> {
  const base = {
    kind,
    name: file.name,
    originalName: file.name,
    path: null,
    src: URL.createObjectURL(file),
    picks: [],
    pickNames: [],
  };
  if (kind === "video") {
    const meta = await videoMeta(fileRangeReader(file), file.size);
    const wall = wallFromVideoMeta(meta);
    return { ...base, key: photoKey(file.name, wall), thumb: null, orientation: 1, wall, offsetTag: null, durationMs: meta?.durationMs ?? null };
  }
  let tags: Record<string, unknown> = {};
  try {
    tags =
      (await exifr.parse(file, {
        pick: ["DateTimeOriginal", "CreateDate", "SubSecTimeOriginal", "OffsetTimeOriginal", "Orientation"],
        reviveValues: false,
        translateValues: false,
      })) ?? {};
  } catch {
    /* no EXIF */
  }
  let thumb: string | null = null;
  try {
    thumb = (await exifr.thumbnailUrl(file)) ?? null;
  } catch {
    /* no embedded thumbnail */
  }
  const raw = (tags.DateTimeOriginal ?? tags.CreateDate) as string | undefined;
  const wall = parseExifDateTime(raw, tags.SubSecTimeOriginal as string | undefined);
  return {
    ...base,
    key: photoKey(file.name, wall),
    thumb,
    orientation: Number(tags.Orientation) || 1,
    wall,
    offsetTag: (tags.OffsetTimeOriginal as string) ?? null,
    durationMs: null,
  };
}

/** Reads dropped/selected files in the browser. Files that are neither images nor supported videos are skipped. */
export async function photosFromFiles(files: File[]): Promise<Photo[]> {
  const media = files.map((f) => [f, mediaKindOf(f.name, f.type)] as const).filter((x): x is [File, MediaKind] => x[1] !== null);
  return Promise.all(media.map(([f, kind]) => photoFromFile(f, kind)));
}

/** Builds a Photo from the Mac folder scan; videos need their header read first. */
export async function photoFromScan(img: ScannedImage, originalName: string, dir: string): Promise<Photo> {
  const base = {
    kind: img.kind,
    name: img.name,
    originalName,
    path: img.path,
    src: fileSrc(img.path),
    picks: [],
    pickNames: [],
  };
  if (img.kind === "video") {
    const meta = await videoMeta((offset, length) => readFileRange(dir, img.name, offset, length), img.size);
    const wall = wallFromVideoMeta(meta);
    return { ...base, key: photoKey(originalName, wall), thumb: null, orientation: 1, wall, offsetTag: null, durationMs: meta?.durationMs ?? null };
  }
  const wall = parseExifDateTime(img.dateTimeOriginal, img.subSecTimeOriginal);
  return {
    ...base,
    key: photoKey(originalName, wall),
    thumb: img.thumbnail,
    orientation: img.orientation ?? 1,
    wall,
    offsetTag: img.offsetTimeOriginal,
    durationMs: null,
  };
}

/** CSS transform that turns an embedded EXIF thumbnail (stored unrotated) upright. */
export function orientationTransform(orientation: number): string {
  switch (orientation) {
    case 3:
      return "rotate(180deg)";
    case 6:
      return "rotate(90deg)";
    case 8:
      return "rotate(-90deg)";
    default:
      return "";
  }
}

export function sortPhotos(photos: Photo[]): Photo[] {
  return [...photos].sort((a, b) => {
    const ka = a.wall ? formatWallTime(a.wall) + String(a.wall.millisecond).padStart(3, "0") : "~";
    const kb = b.wall ? formatWallTime(b.wall) + String(b.wall.millisecond).padStart(3, "0") : "~";
    return ka.localeCompare(kb) || a.originalName.localeCompare(b.originalName);
  });
}
