import exifr from "exifr";
import { isImageName } from "./naming";
import { fileSrc, type ScannedImage } from "./platform";
import { formatWallTime, parseExifDateTime, type WallTime } from "./time";

export interface Photo {
  /** Stable identity across renames: original file name + raw capture time. */
  key: string;
  /** Current file name (changes on the Mac when riders are appended). */
  name: string;
  originalName: string;
  /** Absolute path (Mac only). */
  path: string | null;
  src: string;
  thumb: string | null;
  orientation: number;
  wall: WallTime | null;
  offsetTag: string | null;
  /** Confirmed riders (profile ids) and the labels that were written for them. */
  picks: string[];
  pickNames: string[];
}

export function photoKey(originalName: string, wall: WallTime | null): string {
  return `${originalName}|${wall ? formatWallTime(wall) : "?"}`;
}

/** Reads dropped/selected files in the browser. Non-images are skipped. */
export async function photosFromFiles(files: File[]): Promise<Photo[]> {
  const images = files.filter((f) => f.type.startsWith("image/") || isImageName(f.name));
  const out = await Promise.all(
    images.map(async (file): Promise<Photo> => {
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
        key: photoKey(file.name, wall),
        name: file.name,
        originalName: file.name,
        path: null,
        src: URL.createObjectURL(file),
        thumb,
        orientation: Number(tags.Orientation) || 1,
        wall,
        offsetTag: (tags.OffsetTimeOriginal as string) ?? null,
        picks: [],
        pickNames: [],
      };
    }),
  );
  return out;
}

export function photoFromScan(img: ScannedImage, originalName: string): Photo {
  const wall = parseExifDateTime(img.dateTimeOriginal, img.subSecTimeOriginal);
  return {
    key: photoKey(originalName, wall),
    name: img.name,
    originalName,
    path: img.path,
    src: fileSrc(img.path),
    thumb: img.thumbnail,
    orientation: img.orientation ?? 1,
    wall,
    offsetTag: img.offsetTimeOriginal,
    picks: [],
    pickNames: [],
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
