# DH Photo Tagger

Tag downhill race photos and videos with athletes from [r4wrun.com](https://r4wrun.com). Pick the events, then
narrow the athlete list step by step (disciplines, a range of races from the schedule, suit colours, name or
bib) and click the rider to tag the photo.

- **Web:** https://timolehnertz.github.io/media-tagger/. Drop photos and videos (or a whole folder) in.
  Files never leave your computer. Tags are shown in the app and remembered in the browser; files are not renamed.
- **Desktop app (macOS, Linux):** open a folder and every image and video in it is imported. Tagging appends
  the riders to the file name, e.g. `03_10_DOWNHILL_SKB_TIMETRIAL-0271_Enric-Umbert.jpg` or
  `…CLIP-0001_Enric-Umbert.mp4`.

## Download

Always the newest build of `main` (also linked from the web app):

- **macOS** (Apple silicon + Intel): [DH-Photo-Tagger-macOS.dmg](https://github.com/TimoLehnertz/media-tagger/releases/latest/download/DH-Photo-Tagger-macOS.dmg).
  Not code-signed: on first launch right-click → *Open*, or run
  `xattr -dr com.apple.quarantine "/Applications/DH Photo Tagger.app"`.
- **Linux**: [AppImage](https://github.com/TimoLehnertz/media-tagger/releases/latest/download/DH-Photo-Tagger-Linux-x86_64.AppImage)
  (`chmod +x` it and run; needs `fuse2` on Arch),
  [.deb](https://github.com/TimoLehnertz/media-tagger/releases/latest/download/DH-Photo-Tagger-Linux-amd64.deb) for Debian/Ubuntu.
- **Arch / Omarchy**: the [plain binary](https://github.com/TimoLehnertz/media-tagger/releases/latest/download/DH-Photo-Tagger-Linux-x86_64.tar.gz)
  uses the system WebKitGTK, which avoids AppImage blank-window issues on Hyprland/Wayland:
  ```sh
  sudo pacman -S --needed webkit2gtk-4.1 gst-plugins-good gst-plugins-bad gst-libav
  tar xzf DH-Photo-Tagger-Linux-x86_64.tar.gz && ./dh-photo-tagger/install.sh   # installs to ~/.local
  ```
  (GStreamer plugins are only needed for video playback.)

## Using it

1. Choose one or more **events** at the top. Once photos are loaded, events whose dates cover the photos'
   capture dates are highlighted and listed first.
2. Load photos and/or videos (MP4, MOV, M4V). Click one to see it large (scroll or double-click to zoom).
3. Narrow the athletes in the sidebar. The filters apply one after another, and the row at the top shows how
   many athletes are left after each:
   1. **Disciplines**: Skateboard / Inline / Street luge.
   2. **Races**: the schedule of the selected events (qualifying sessions and bracket heats). Set a *from* and a
      *to* race; only riders who rode in those races, or in the races between, stay.
   3. **Suit colours**: click a body part (helmet, chest, arms, legs) and choose one or more colours. Riders
      without suit colours on r4wrun drop out once a colour is set. Dark shades also count as black and very
      light ones as white.
   4. **Name or bib**: type a name or a bib number (`343` or `#343`).
4. Click an athlete, or press `1`–`9`, to tag the photo; click again (or the tag at the top) to remove it.
   `Enter` in the search field tags the first match. `←`/`→` (or `Enter` outside the search) move between photos,
   and `/` jumps to the search.

### Start numbers

**Read start numbers** (top left of the photo, or tick *auto* to do it for every photo you open) finds the
start numbers in the photo, e.g. the bib stickers on helmets, and draws a box around each one. Numbers that
belong to an athlete of the selected events are highlighted with the name. Click a box (or the number in the
sidebar) to search for that number; if exactly one athlete has it, they are tagged right away.

It runs entirely on your computer: PaddleOCR (PP-OCRv4) text detection and recognition in WebAssembly
(onnxruntime-web), in a background worker. The first use downloads about 30 MB of models and runtime, which the
browser then caches. Expect about 1 s per photo at 1200 px; full-size camera files take a few seconds because
they are also scanned in tiles so that small helmet stickers keep their detail. Stickers that are only a few
pixels tall (downscaled exports) can't be read.

On the Mac, a hidden `.dh-photo-tagger.json` in the photo folder records each file's original name, its tags
and the selected events. Re-tagging a photo then rewrites its name cleanly.

The schedule comes from r4wrun's recorded results, so a session whose results were never uploaded (for ASU26 the
skateboarding Q1B) is missing from it, and its riders only appear through the races they have results for.

## Development

```sh
npm install
npm run dev          # web version at http://localhost:5173/media-tagger/
npm test             # unit tests (test-images/exif.json, the sample clips, and an ASU26 API snapshot)
npm run check        # svelte-check / TypeScript
npm run tauri dev    # desktop app (needs Rust; on Linux also the WebKitGTK dev packages)
npm run tauri build -- --bundles appimage   # e.g. build the Linux AppImage locally
cargo test --manifest-path src-tauri/Cargo.toml
```

Layout: all API and filter logic is TypeScript in `src/lib/` and shared by both builds. `src-tauri/` only
scans folders, reads EXIF, serves byte ranges of video files (for the TypeScript MP4 header parser in
`src/lib/video.ts`), renames files and reads/writes the sidecar.

### CI / deployment

- `pages.yml`: on push to `main`, tests and builds the web app and deploys it to GitHub Pages. One-time
  setup: *Settings → Pages → Source: GitHub Actions*.
- `desktop.yml`: on push to `main` (or a manual run), builds the universal macOS `.dmg` and the Linux
  AppImage, `.deb` and plain-binary tarball, then publishes them to the rolling `latest` release with fixed
  file names.
- `ci.yml`: type-checks, tests and builds the web app on pull requests and other branches.


See [NOTES.md](NOTES.md) for the original spec and API research.
