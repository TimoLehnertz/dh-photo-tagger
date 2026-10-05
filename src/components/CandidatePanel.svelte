<script lang="ts">
  import { DISCIPLINES } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Athlete, Candidate } from "../lib/matching";
  import type { Photo } from "../lib/photos";
  import { formatClock, formatWallTime } from "../lib/time";
  import { formatDuration } from "../lib/video";
  import SuitFigure from "./SuitFigure.svelte";

  let { photo }: { photo: Photo } = $props();

  const match = $derived(app.matches.get(photo.key));
  const isVideo = $derived(photo.kind === "video");

  /** For clips: is this rider on course (or passing your spot) at the current playhead? */
  function isLive(c: Candidate) {
    if (!isVideo || app.playheadMs === null || match?.utcMs == null) return false;
    if (app.position === null) {
      const at = match.utcMs + app.playheadMs;
      return at >= c.window.startMs && at <= c.window.endMs;
    }
    const d = app.playheadMs - c.clipOffsetMs; // < 0: rider still to come
    return d < 0 ? -d <= Math.max(app.beforeMs, 1000) : d <= Math.max(app.afterMs, 1000);
  }
  let query = $state("");

  function flag(country: string | null) {
    if (!country || !/^[A-Za-z]{2}$/.test(country)) return "";
    return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  }

  function disciplineLabel(id: string) {
    return DISCIPLINES.find((d) => d.id === id)?.label ?? id;
  }

  function bib(a: Athlete | undefined, discipline: string) {
    return a?.registrations.find((r) => r.discipline === discipline)?.bib ?? null;
  }

  function describe(c: Candidate) {
    const s = c.deltaMs / 1000;
    if (isVideo) {
      if (c.deltaMs === 0) {
        const verb = app.position === null ? "on course from" : "passes you at";
        return `${verb} ${formatDuration(c.clipOffsetMs)} in clip`;
      }
      return c.deltaMs < 0 ? `${(-s).toFixed(1)}s after clip ends` : `${s.toFixed(1)}s before clip starts`;
    }
    if (app.position === null) {
      if (c.deltaMs === 0) return `in run at ${Math.round(c.runFraction * 100)}%`;
      return c.deltaMs < 0 ? `${(-s).toFixed(1)}s before start` : `${s.toFixed(1)}s after finish`;
    }
    return `${s >= 0 ? "+" : ""}${s.toFixed(1)}s vs expected`;
  }

  const searchResults = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q || !app.model) return [];
    return [...app.model.athletes.values()]
      .filter((a) => a.registrations.some((r) => app.disciplines.includes(r.discipline)))
      .filter((a) => a.name.toLowerCase().includes(q) || a.registrations.some((r) => r.bib === q) || a.username?.toLowerCase().includes(q))
      .slice(0, 8);
  });

  const extraPicks = $derived(photo.picks.filter((id) => !match?.candidates.some((c) => c.profileId === id)));
</script>

<aside class="panel">
  <div class="info">
    <div class="filename" title={photo.name}>{photo.name}</div>
    {#if photo.wall}
      <div class="times mono">
        <div><span class="muted">Camera</span> {formatWallTime(photo.wall)}{photo.offsetTag ? ` (tag ${photo.offsetTag}, ignored)` : ""}</div>
        {#if match?.utcMs != null}
          <div>
            <span class="muted">Corrected</span> {formatClock(match.utcMs, app.timeZone, true)}{#if isVideo && match.durationMs}
              – {formatClock(match.utcMs + match.durationMs, app.timeZone)}{/if}
            <span class="muted">{app.timeZone}</span>
          </div>
        {/if}
        {#if isVideo}
          <div><span class="muted">Length</span> {photo.durationMs != null ? formatDuration(photo.durationMs) : "unknown"}</div>
        {/if}
      </div>
    {:else}
      <div class="warn">
        {isVideo ? "This clip has no readable recording time (only MP4/MOV metadata is supported)" : "This photo has no EXIF capture time"}
        — pick riders manually below.
      </div>
    {/if}
  </div>

  {#if !app.model}
    <p class="muted pad">{app.eventLoading ? "Loading event timing…" : "Choose an event to see candidate riders."}</p>
  {:else}
    {#if extraPicks.length}
      <h3>Tagged</h3>
      <ul class="list">
        {#each extraPicks as id (id)}
          {@const a = app.athlete(id)}
          <li>
            <button class="row picked" onclick={() => app.togglePick(photo, id)}>
              <span class="check">✓</span>
              <SuitFigure colors={a?.suitColors ?? null} size={40} />
              <span class="who"><strong>{a?.name ?? photo.pickNames[photo.picks.indexOf(id)] ?? id}</strong> <span class="muted">{flag(a?.country ?? null)}</span></span>
              <span class="muted small">remove</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <h3>
      Candidates
      {#if match?.candidates.length}<span class="muted small">— click or press 1–9 to tag{isVideo ? "; ▸ jumps to the rider" : ""}</span>{/if}
    </h3>
    {#if match?.candidates.length}
      <ul class="list">
        {#each match.candidates as c, i (c.profileId)}
          {@const a = app.athlete(c.profileId)}
          {@const picked = photo.picks.includes(c.profileId)}
          {@const suggested = match.suggestion?.profileId === c.profileId && !photo.picks.length}
          {@const b = bib(a, c.window.discipline)}
          <li class:seekable={isVideo}>
            <button class="row" class:picked class:suggested class:live={isLive(c)} onclick={() => app.togglePick(photo, c.profileId)} aria-pressed={picked}>
              <span class="check">{picked ? "✓" : i < 9 ? i + 1 : ""}</span>
              <SuitFigure colors={a?.suitColors ?? null} size={46} />
              <span class="who">
                <strong>{a?.name ?? "Unknown rider"}</strong>
                <span class="muted">{flag(a?.country ?? null)}{b ? ` · #${b}` : ""}</span>
                <span class="small muted">
                  {disciplineLabel(c.window.discipline)}{c.window.category ? ` ${c.window.category}` : ""} · {c.window.label}
                </span>
                <span class="small">{describe(c)}{a && !a.suitColors ? " · no suit info" : ""}</span>
              </span>
              <span class="score" title={`Match score ${Math.round(c.score * 100)}%`}>
                <span class="bar" style:width={`${Math.round(c.score * 100)}%`}></span>
              </span>
            </button>
            {#if isVideo}
              <button class="seek mono" title="Play from when this rider should be visible" onclick={() => app.seek(photo, Math.max(0, c.clipOffsetMs - 2000))}>
                ▸ {formatDuration(c.clipOffsetMs)}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if photo.wall}
      <p class="muted pad">
        No rider was on course {isVideo ? "during this clip" : "at this time"}. Try “Auto-detect” for the clock offset, a wider match window, or other disciplines.
      </p>
    {/if}

    <h3>Add rider manually</h3>
    <div class="pad">
      <input class="search" placeholder="Name, username or bib…" bind:value={query} />
      {#if searchResults.length}
        <ul class="list compact">
          {#each searchResults as a (a.profileId)}
            <li>
              <button class="row" class:picked={photo.picks.includes(a.profileId)} onclick={() => { app.togglePick(photo, a.profileId); query = ""; }}>
                <span class="check">{photo.picks.includes(a.profileId) ? "✓" : "+"}</span>
                <SuitFigure colors={a.suitColors} size={32} />
                <span class="who"><strong>{a.name}</strong> <span class="muted">{flag(a.country)} {a.registrations.map((r) => disciplineLabel(r.discipline)).join(", ")}</span></span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .panel { height: 100%; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--border); }
  .info { padding: 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .filename { font-weight: 600; word-break: break-all; }
  .times { display: flex; flex-direction: column; gap: 2px; }
  .warn { color: var(--warn); }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 14px 12px 6px; font-weight: 600; }
  h3 .small { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .pad { padding: 0 12px 12px; }
  .list { list-style: none; margin: 0; padding: 0 8px; display: flex; flex-direction: column; gap: 4px; }
  .list.compact { padding: 6px 0 0; }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 22px auto 1fr 54px;
    align-items: center;
    gap: 10px;
    text-align: left;
    padding: 6px 8px;
    background: var(--panel-2);
    border: 1px solid transparent;
  }
  .compact .row { grid-template-columns: 22px auto 1fr; }
  .row.picked { border-color: var(--ok); background: var(--ok-soft); }
  .row.suggested { border: 1px dashed var(--accent); }
  .row.live { box-shadow: inset 3px 0 0 var(--accent); }
  .list li { position: relative; }
  .seekable .row { padding-bottom: 26px; }
  .seek { position: absolute; right: 8px; bottom: 6px; padding: 1px 8px; font-size: 12px; }
  .check { text-align: center; color: var(--muted); font-weight: 600; }
  .picked .check { color: var(--ok); }
  .who { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .who strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .small { font-size: 12px; }
  .score { height: 6px; background: #2a2f3a; border-radius: 3px; overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--accent); }
  .picked .bar { background: var(--ok); }
  .search { width: 100%; }
</style>
