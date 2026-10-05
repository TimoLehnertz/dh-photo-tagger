// Desktop builds are published by .github/workflows/desktop.yml to a rolling "latest" GitHub release
// with fixed asset names, so these links always point at the newest build of main.
declare const __REPO__: string; // owner/name, injected by vite.config.ts

const BASE = `https://github.com/${__REPO__}/releases/latest/download`;

export const DOWNLOADS = {
  mac: `${BASE}/DH-Photo-Tagger-macOS.dmg`,
  linuxAppImage: `${BASE}/DH-Photo-Tagger-Linux-x86_64.AppImage`,
  linuxTarball: `${BASE}/DH-Photo-Tagger-Linux-x86_64.tar.gz`,
  releasePage: `https://github.com/${__REPO__}/releases/latest`,
};

export type DesktopOs = "mac" | "linux" | "other";

export function detectOs(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): DesktopOs {
  if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return "mac";
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return "other";
}
