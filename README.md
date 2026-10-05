# DH Photo Tagger

Match downhill race photos and videos to athletes using [r4wrun.com](https://r4wrun.com) timing data. The app
reads each photo's EXIF capture time (or each clip's recording time and length), compares it with when every
rider was on course, and shows a ranked list of candidates (with their suit colours) so you can tag files quickly.

- **Web:** https://timolehnertz.github.io/dh-photo-tagger/. Drop photos and videos (or a whole folder) in.
  Files never leave your computer. Tags are shown in the app and remembered in the browser; files are not renamed.
- **Desktop app (macOS, Linux):** open a folder and every image and video in it is imported. Tagging appends
  the riders to the file name, e.g. `03_10_DOWNHILL_SKB_TIMETRIAL-0271_Enric-Umbert.jpg` or
  `…CLIP-0001_Enric-Umbert.mp4`.

## Download

Always the newest build of `main` (also linked from the web app):

- **macOS** (Apple silicon + Intel): [DH-Photo-Tagger-macOS.dmg](https://github.com/TimoLehnertz/dh-photo-tagger/releases/latest/download/DH-Photo-Tagger-macOS.dmg).
  Not code-signed: on first launch right-click → *Open*, or run
  `xattr -dr com.apple.quarantine "/Applications/DH Photo Tagger.app"`.
- **Linux**: [AppImage](https://github.com/TimoLehnertz/dh-photo-tagger/releases/latest/download/DH-Photo-Tagger-Linux-x86_64.AppImage)
  (`chmod +x` it and run; needs `fuse2` on Arch),
  [.deb](https://github.com/TimoLehnertz/dh-photo-tagger/releases/latest/download/DH-Photo-Tagger-Linux-amd64.deb) for Debian/Ubuntu.
- **Arch / Omarchy**: the [plain binary](https://github.com/TimoLehnertz/dh-photo-tagger/releases/latest/download/DH-Photo-Tagger-Linux-x86_64.tar.gz)
  uses the system WebKitGTK, which avoids AppImage blank-window issues on Hyprland/Wayland:
  ```sh
  sudo pacman -S --needed webkit2gtk-4.1 gst-plugins-good gst-plugins-bad gst-libav
  tar xzf DH-Photo-Tagger-Linux-x86_64.tar.gz && ./dh-photo-tagger/install.sh   # installs to ~/.local
  ```
  (GStreamer plugins are only needed for video playback.)

## Using it

1. Load photos and/or videos. The event list narrows to r4wrun events on their capture dates. Events whose
   timing data overlaps the photo times are marked "✓ timing matches your photos", and if exactly one does, it
   is selected for you. Untick the filter to see all events.
2. Check the **event** and tick the **disciplines** to match (Skateboard / Inline / Street luge).
3. Set the **Clock offset** to how far the camera clock was off: type it (e.g. `-34:24`) or use the
   ±1h buttons. Camera clocks are often several minutes off. (The sample camera was about
   34 min fast, so its offset is `-0:34:24`.) The offset is never guessed; it only changes when you set it.
4. Click a photo to see it large (scroll or double-click to zoom) next to the riders who were on course at that
   moment. Click a rider, or press `1`–`9`, to tag them. `←`/`→` moves between photos; `Enter` accepts the
   suggestion and moves on.
5. Once a few photos are tagged with a single rider, **Fit to tagged** refines the offset from them. Tags whose
   rider has no recorded run within 15 min of the photo are skipped.
   If you know roughly where you stood on the course, set **Your position**. Riders are then ranked by when
   they should have passed you rather than just "on course".
6. **Match window** sets how long before a run starts and after it finishes (in seconds) a photo still counts
   as that rider. Defaults are 10 s / 10 s. With a position set, the window is around the moment the rider
   should pass you. Riders inside the run score highest; the score falls off towards the edge of the window.
7. **Accept suggestions** tags every photo that has one clearly leading candidate.

### Videos

MP4, MOV and M4V clips are supported. The app reads the recording time and length from the file's `mvhd`
header (only a few hundred bytes, so even huge files load instantly). A clip covers a span of time, so every
rider on course at any point during it is a candidate. Each candidate shows **when in the clip** they appear
(or pass your position), and **▸ 0:14** jumps the player there. While the clip plays, riders on course at
the playhead are highlighted. Clips also count for *Fit to tagged*.

Cameras disagree about video timestamps, so the **Video time** setting (shown once a clip is loaded) lets you
choose:

- *camera clock* (default, like photo EXIF; Canon, Sony, GoPro…) or *UTC* (phones);
- whether the timestamp marks the *start* (most cameras) or the *end* of the recording.

Playback uses the system's decoders. Safari and the Mac app play HEVC; Chrome may not, but matching still works.

Photo times are read in the **event's time zone**, and the EXIF `OffsetTime` tag is ignored because it is
often wrong. You can override the zone under *Camera zone*.

### How matching works

- `qualifying_runs.created_at` is when the result was recorded, which is roughly the finish. So a run spans
  `[created_at − time_ms, created_at]`. `run_splits` (the first intermediate split) refine where a rider was
  mid-run when a position is set. Bracket heats with `running_at`/`completed_at` count too (all heat riders).
- Each run is scored by how far the photo time is from the run (or from the expected passing moment): 1 inside,
  falling linearly to 0.1 at the edge of the match window, and excluded beyond it. Each rider keeps their best score.
- In a time trial, several riders are on course at once, so the app shows a ranked list. It only pre-selects
  a rider who is clearly ahead.

On the Mac, a hidden `.dh-photo-tagger.json` in the photo folder records each file's original name, its
picks, the event and the clock offset. Re-tagging a photo then rewrites its name cleanly.

## Development

```sh
npm install
npm run dev          # web version at http://localhost:5173/dh-photo-tagger/
npm test             # unit tests (test-images/exif.json, the sample clips, and an ASU26 API snapshot)
npm run check        # svelte-check / TypeScript
npm run tauri dev    # desktop app (needs Rust; on Linux also the WebKitGTK dev packages)
npm run tauri build -- --bundles appimage   # e.g. build the Linux AppImage locally
cargo test --manifest-path src-tauri/Cargo.toml
```

Layout: all API and matching logic is TypeScript in `src/lib/` and shared by both builds. `src-tauri/` only
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
