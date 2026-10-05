# DH Photo Tagger — handoff notes

Handoff from a local Claude Code session (2026-10-05). Nothing is built yet; this file is
the spec + API research so the next agent can start implementing.

## What to build

A photo tagger for downhill skate races that guesses which athletes are in each photo by
matching the photo's EXIF capture time against run timing from r4wrun.com.

- **Tauri 2 app (Rust) for macOS** + the **same frontend deployed as a static site on GitHub Pages**.
- **Web version:** drag & drop photos in. Photos are read in-browser (EXIF via e.g. `exifr`).
  It cannot rename files — it only *displays* the assigned athlete names next to each file.
- **Mac version:** user selects a folder → all images in it are imported automatically.
  When the user picks athletes for a photo, their names are **appended to the file name**
  (e.g. `03_10_DOWNHILL_SKB_TIMETRIAL-0271_Enric-Umbert.jpg`). Renaming is done in Rust.
- **File explorer** pane listing all photos (thumbnails), each auto-linked to likely athletes.
- **Click a photo** → large view (zoomable) + ranked list of candidate athletes. Each candidate
  shows a **suit color summary** (a small body figure painted with helmet/chest/arms/legs
  colors from the API) so the user can visually compare against the photo.
- **Event picker:** user selects any r4wrun event (not hard-coded).
- **Discipline filter:** skateboarding / inline / street_luge.
- Repo: github.com/TimoLehnertz/media-tagger. Add GitHub Actions for:
  1. Pages deploy of the web build.
  2. macOS Tauri build (`.dmg`) on a `macos-latest` runner (no Mac available locally).

## r4wrun API (Supabase, public read)

r4wrun.com is a SvelteKit app backed by Supabase. The anon/publishable key is embedded in
the public site and allows reads via PostgREST:

```
URL:  https://snrizlwixvyfughwkswa.supabase.co/rest/v1/<table>?<postgrest query>
Headers: apikey: sb_publishable_t6puXzL0oioBZoDWfdXnrA_GmAuFLzy
         Authorization: Bearer sb_publishable_t6puXzL0oioBZoDWfdXnrA_GmAuFLzy
```

CORS appeared fine for browser use (Supabase default) — verify from the Pages origin.

### Relevant tables

- `events` — `id, name, slug, start_date, end_date, timezone`. Example event:
  `World Skate Games ASU26`, id `ddd877bb-6375-40eb-adf9-71eca9b644cf`,
  slug `world-skate-games-asu26-0tj9BMMc`, timezone `America/Asuncion` (UTC-3).
  Riders page: https://r4wrun.com/events/world-skate-games-asu26-0tj9BMMc/riders
- `event_registrations` — `event_id, profile_id, discipline, category, bib_number,
  transponder_id, registration_type`. Embed profile with
  `select=*,profiles(first_name,last_name,country,username,avatar_url,suit_colors)`.
  ASU26: 199 regs (skateboarding 107, inline 69, street_luge 23; categories ws-men/ws-women).
- `profiles.suit_colors` — `{chest, helmet, leftArm, rightArm, leftLeg, rightLeg}` hex
  strings, or `null` for many riders (handle gracefully: "no suit info").
- `qualifying_runs` — `event_id, profile_id, discipline, category, run_number, time_ms,
  dnf, created_at, session (q1a/q1b/q2/q3)`. **`created_at` ≈ when the result was
  recorded, i.e. roughly the finish time.** Run start ≈ `created_at - time_ms`.
  ASU26 has 414 rows.
- `run_splits` — `profile_id, discipline, board, run_number, sector_count, line, split_ms,
  source (raceresult), created_at`. Intermediate split times; useful to refine where on
  course a rider was at a given moment.
- Others seen in the bundle (likely relevant for finals/brackets): `bracket_heats`
  (`running_at, completed_at`), `bracket_entries`, `race_results`, `practice_runs`,
  `timetrial_configs`, `start_orders`, `heat_timing_reads`.

ASU26 qualifying windows (UTC, from `qualifying_runs.created_at`):

```
2026-10-03 inline       q1a 12:23→13:50  q1b 14:09→14:57  q2 17:09→17:54
2026-10-04 street_luge  q1a 16:32→16:47  q2 18:55→19:08  q3 21:02→21:10
2026-10-04 skateboarding q1a 16:53→18:25  q2 19:32→20:21  q3 21:11→21:42
```

## Test photos

`test-images/` holds the 31 sample photos (`03_10_DOWNHILL_SKB_TIMETRIAL-*.jpg`, Canon EOS
R6m2), downscaled to max 1200px with EXIF preserved (originals are ~1.4 MB each and stay
on the user's machine). Two originals had a `.JPG` extension; the copies use `.jpg` — the
app must handle both cases. `test-images/exif.json` has the extracted EXIF per file, for
unit-testing the matching without decoding images.

EXIF: `DateTimeOriginal` `2026:10:04 14:48:07` … `17:40:02`, `OffsetTimeOriginal -08:00`,
`SubSecTimeOriginal` present. Filenames say `03_10` but EXIF says 10-04.

**Clock finding:** the -08:00 offset tag is wrong. If the EXIF *wall-clock* time is read as
Asunción local time (UTC-3), the photos (14:48–17:40 local = 17:48–20:40 UTC) fall neatly
inside the 10-04 skateboarding q1a/q2 windows, with gaps lining up with street luge
sessions. So:

> **Update (implementation):** checked against the actual runs, only ~5 of the 31 photos fall
> inside a skateboarding run at UTC-3 with no correction. Sweeping clock offsets puts 25–26 of 31
> photos inside runs at about **−35 min**, so this camera's clock was also ~35 min fast.
> (An "Auto-detect" button that swept offsets for the best overlap existed until 2026-10-05; the user
> asked for it to be removed so the offset is never guessed. It is now set by hand: typed, or ±1h buttons.) Riders start every ~20–30 s on ~70 s runs, so 3–4 are on course at once.
> Timing alone can't tell the photographer's position or the exact offset within about ±1.5 min.
> "Fit to tagged" refines the offset once the user has confirmed a few photos.
>
> Other API notes: embedding profiles in `event_registrations` needs the hint
> `profiles!event_registrations_profile_id_fkey` (several FKs point at `profiles`). The
> `practice_runs.created_at` values for ASU26 are bulk-imported (2 s apart), so they're not usable
> as timing and are ignored. `bracket_heats` has no `event_id`; go through `brackets?event_id=…`.

- Default: interpret EXIF wall time in the **event's timezone**, ignore the EXIF offset.
- Still expose a **per-import clock offset** (± hours/minutes/seconds) in the UI, since
  camera clocks drift. Nice-to-have: auto-suggest the offset that maximises photo/run overlap.

## Matching approach (suggested)

For each photo at time `t` (UTC after offset correction), for each run in the selected
event + discipline filter:

- run interval ≈ `[created_at - time_ms, created_at]` (expand by a margin, e.g. ±30 s).
- Score by closeness of `t` to the interval (inside = high; decays with distance).
  Use `run_splits` when available to estimate the rider's position more precisely.
- Riders start in intervals (time trial), so several riders can be on course at once →
  show a ranked list, not a single answer. Auto-assign only the top candidate if it is
  clearly ahead; the user confirms/changes picks.
- Persist picks: Mac → rename file (+ maybe a sidecar JSON); web → localStorage keyed
  by filename + capture time.

## Suggested stack

Tauri 2 + Vite + (Svelte or React) + TypeScript. Keep all API/matching logic in the
frontend (TS) so the web and Mac builds share it; Rust side only for folder scanning,
reading files and renaming (`tauri-plugin-dialog`, `tauri-plugin-fs`). Detect runtime with
`window.__TAURI_INTERNALS__` to switch between folder-mode and drag-and-drop mode.
Set Vite `base` to `/<repo name>/` for Pages (derived from `GITHUB_REPOSITORY`).

## Videos (added later)

Requirement: the app must also work with videos. Implementation:

- `src/lib/video.ts` walks the ISO-BMFF boxes (`moov/mvhd`) through a byte-range reader:
  `File.slice` on the web, the `read_file_range` Tauri command on the Mac. It reads only box
  headers, so `moov`-at-end files cost the same as fast-start ones.
- `mvhd.creation_time` is nominally UTC, but many cameras store their local clock reading there.
  The default treats it like photo EXIF (wall time in the camera zone), with a UI toggle for UTC
  (phones) and for start-vs-end stamping.
- Matching treats a clip as a span `[start, start + duration]`; photos are zero-length spans.
  Candidates carry `clipOffsetMs`, the moment in the clip when the rider appears or passes.
- `test-images/03_10_DOWNHILL_SKB_CLIP-0001.mp4` (moov first) and `CLIP-0002.MOV` (moov last)
  are small synthetic clips made from the sample photos with ffmpeg. Their `creation_time` is set
  to the camera clock (17:21:00 and 17:39:50), not real footage.

## Handoff status (2026-10-05, end of first Claude Code cloud session)

All work is on `main` (last feature commit `c51000f`). Implemented: everything in the spec above,
plus videos, an event pre-filter, the match window and Linux builds. See README.md for usage.

Live:
- Web app: https://timolehnertz.github.io/media-tagger/ (Pages, source = GitHub Actions, deployed by `pages.yml`)
- Desktop builds: `desktop.yml` publishes to the rolling `latest` release with fixed asset names
  (`DH-Photo-Tagger-macOS.dmg`, `-Linux-x86_64.AppImage`, `-Linux-amd64.deb`, `-Linux-x86_64.tar.gz`).
  The web app links to `releases/latest/download/<name>`.

**Verified in the second cloud session (2026-10-05):** `desktop.yml` run 2 (commit `c7eb331`) is green
across all three jobs (macos, linux, publish). Run 1 (`c51000f`) was cancelled by the concurrency group
once `c7eb331` was pushed, so nothing is wrong there. The `latest` release exists, the API reports it as the
repo's latest release, and it carries all four assets under the names `src/lib/downloads.ts` links to
(dmg 6.3 MB, AppImage 82 MB, deb 3.3 MB, tar.gz 3.2 MB). `npm test` (41) and `npm run check` still pass.
Fetching the Pages site or the download redirects directly wasn't possible from the container (the egress
proxy blocks it). The Pages deploy for `c7eb331` succeeded.

Verified before handoff:
- `npm test` (41 vitest tests), `npm run check`, `cargo test` (6 tests).
- Browser end-to-end runs (Playwright, scripts not in repo):
  - Web: photos + clips; auto-detected offset -0:34:24, 28/33 matched.
  - Event filter: 42 events → 3 on 2026-10-04; ASU26 auto-selected via timing overlap.
  - Mac mode with a faked Tauri IPC: renames, sidecar, reload, clip rename keeps playback position.

Open questions / ideas:
- Video timestamps from real Canon R6m2 footage are untested (default: mvhd read as camera clock;
  UI toggle for UTC and start/end).
- Old branch `ccr-1882d3c1-l8q6bl` can be deleted.
- User asked that the discipline filters be obviously toggleable; they're now checkbox chips.
  Confirm with the user that this is clear enough.

## Redesign (2026-10-05): manual tagging with filters

The user found the time matching unreliable (wrong camera clocks, missing sessions such as ASU26 skateboarding
Q1B) and asked to drop it. The app no longer matches by time at all. Instead:

- Several events can be selected; events whose dates cover the photo capture dates are highlighted.
- The sidebar lists athletes of the selected events and narrows them with filters applied in order:
  disciplines, race range (from/to in the schedule built from `qualifying_runs` sessions and bracket heats),
  suit colours per body part, name/bib search. Logic in `src/lib/roster.ts` (`buildRoster`, `applyFilters`,
  `colorNames`), tested in `roster.test.ts`.
- Removed: clock offset, camera zone, match window, position, video time settings, suggestions, fit to tagged,
  `matching.ts`. The sidecar now stores `eventIds` (old `eventId` is still read).

## Start-number reading (2026-10-05)

Local OCR: `src/lib/bibs.ts` runs PaddleOCR PP-OCRv4 det + rec ONNX models (npm `@gutenye/ocr-models`, used only
for the model files) with `onnxruntime-web/wasm` in a worker (`bibs.worker.ts`, `bibReader.ts`). Own DB
post-processing (thresholded map, connected components, unclip) and CTC decoding, no OpenCV. Models are served
from `<base>/ocr/` by a small plugin in `vite.config.ts`. Digits are extracted by `numbersIn` and only offered
when the reading confidence is >= 0.5; the UI marks numbers that are a registered bib.

Findings on the 31 downscaled samples (1200 px): bibs are small helmet stickers. "386" (Owen Fox) in 0380 is read
at 0.99; stickers of ~20 px (0360 "317", 0549) are not legible at that size, and upscaling only adds noise. Real
recall needs a test on full-size originals, where large images are also scanned in tiles.
