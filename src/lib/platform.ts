// Thin wrapper over the Tauri (Mac) backend. Everything here is unavailable in the web build.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ScannedImage {
  name: string;
  path: string;
  dateTimeOriginal: string | null;
  subSecTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
  orientation: number | null;
  /** Embedded EXIF thumbnail as a data: URL, when the file has one. */
  thumbnail: string | null;
}

export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({ directory: true, multiple: false, title: "Choose a folder of photos" });
  return typeof dir === "string" ? dir : null;
}

export function scanFolder(dir: string): Promise<ScannedImage[]> {
  return invoke<ScannedImage[]>("scan_folder", { dir });
}

/** Renames `from` → `to` inside `dir`. Fails rather than overwriting an existing file. */
export function renameInFolder(dir: string, from: string, to: string): Promise<string> {
  return invoke<string>("rename_file", { dir, from, to });
}

export function readTextInFolder(dir: string, name: string): Promise<string | null> {
  return invoke<string | null>("read_text_file", { dir, name });
}

export function writeTextInFolder(dir: string, name: string, contents: string): Promise<void> {
  return invoke<void>("write_text_file", { dir, name, contents });
}

export function fileSrc(path: string): string {
  return convertFileSrc(path);
}
