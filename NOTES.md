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
- Repo: github.com/TimoLehnertz/dh-photo-tagger. Add GitHub Actions for:
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
> photos inside runs at about **−35 min**, so this camera's clock was also ~35 min fast. Because
> of that, auto-detecting the offset is a core feature (`suggestOffset` in `src/lib/matching.ts`),
> not a nice-to-have. Riders start every ~20–30 s on ~70 s runs, so 3–4 are on course at once.
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
Set Vite `base` to `/dh-photo-tagger/` for Pages.
