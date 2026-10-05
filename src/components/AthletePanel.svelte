<script lang="ts">
  import { DISCIPLINES } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Photo } from "../lib/photos";
  import type { Athlete } from "../lib/roster";
  import { formatWallTime } from "../lib/time";
  import { formatDuration } from "../lib/video";
  import RaceRange from "./RaceRange.svelte";
  import SuitFigure from "./SuitFigure.svelte";
  import SuitPicker from "./SuitPicker.svelte";

  let { photo }: { photo: Photo | null } = $props();

  let searchInput = $state<HTMLInputElement>();
  let suitOpen = $state(false);
  const LIMIT = 150;

  const result = $derived(app.filtered);
  const shown = $derived(result.athletes.slice(0, LIMIT));
  const suitCount = $derived(Object.values(app.suit).reduce((n, cs) => n + (cs?.length ? 1 : 0), 0));

  function flag(country: string | null) {
    if (!country || !/^[A-Za-z]{2}$/.test(country)) return "";
    return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  }

  function disciplineLabel(id: string) {
    return DISCIPLINES.find((d) => d.id === id)?.label ?? id;
  }

  function regs(a: Athlete) {
    const seen = new Set<string>();
    return a.registrations
      .filter((r) => app.disciplines.includes(r.discipline))
      .map((r) => `${r.bib ? `#${r.bib} ` : ""}${disciplineLabel(r.discipline)}${r.category ? ` ${r.category}` : ""}`)
      .filter((s) => !seen.has(s) && !!seen.add(s));
  }

  function pickName(p: Photo, id: string) {
    return app.athlete(id)?.name ?? p.pickNames[p.picks.indexOf(id)]?.replace(/-/g, " ") ?? id;
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === "Enter" && photo && result.athletes[0]) {
      app.togglePick(photo, result.athletes[0].profileId);
      app.query = "";
    } else if (e.key === "Escape") {
      app.query = "";
      searchInput?.blur();
    }
  }

  export function focusSearch() {
    searchInput?.focus();
    searchInput?.select();
  }
</script>

<aside class="panel">
  {#if photo}
    <div class="info">
      <div class="filename" title={photo.name}>{photo.name}</div>
      <div class="muted small mono">
        {photo.wall ? formatWallTime(photo.wall) : "no capture time"}{photo.kind === "video" && photo.durationMs != null ? ` · ${formatDuration(photo.durationMs)}` : ""}
      </div>
      <div class="tags">
        {#each photo.picks as id (id)}
          <button class="tag" onclick={() => app.togglePick(photo, id)} title="Remove">✓ {pickName(photo, id)} <span aria-hidden="true">×</span></button>
        {:else}
          <span class="muted small">Not tagged yet. Click an athlete below.</span>
        {/each}
      </div>
    </div>
  {/if}

  {#if !app.eventIds.length}
    <p class="muted pad">Choose one or more events at the top to list their athletes.</p>
  {:else}
    <div class="funnel small" title="Athletes left after each filter, applied top to bottom">
      {#each result.stages as s, i (s.label)}
        {#if i}<span class="arrow" aria-hidden="true">›</span>{/if}
        <span class="stage"><span class="muted">{s.label}</span> <strong>{s.count}</strong></span>
      {/each}
    </div>

    <section>
      <h3>1 · Disciplines</h3>
      <div class="chips" role="group" aria-label="Disciplines">
        {#each DISCIPLINES as d (d.id)}
          {@const on = app.disciplines.includes(d.id)}
          <button class="chip" class:on onclick={() => app.toggleDiscipline(d.id)} aria-pressed={on}>
            <span class="box" aria-hidden="true">{on ? "✓" : ""}</span>{d.label}
          </button>
        {/each}
      </div>
    </section>

    <section>
      <h3>2 · Races</h3>
      <RaceRange />
    </section>

    <section>
      <h3>
        <button class="fold" onclick={() => (suitOpen = !suitOpen)} aria-expanded={suitOpen}>
          {suitOpen ? "▾" : "▸"} 3 · Suit colours{#if suitCount}<span class="muted">&nbsp;({suitCount} part{suitCount === 1 ? "" : "s"})</span>{/if}
        </button>
      </h3>
      {#if suitOpen}
        <SuitPicker />
        <p class="muted small">Riders without suit colours on r4wrun drop out once a colour is set.</p>
      {/if}
    </section>

    <section>
      <h3>4 · Name or bib</h3>
      <input
        bind:this={searchInput}
        class="search"
        placeholder="Name or bib… (Enter tags the first match)"
        bind:value={app.query}
        onkeydown={onSearchKey}
      />
    </section>

    {#if app.loadingEventIds.length}
      <p class="muted pad">Loading athletes…</p>
    {:else if !result.athletes.length}
      <p class="muted pad">No athlete matches all filters.</p>
    {:else}
      <ul class="list">
        {#each shown as a, i (a.profileId)}
          {@const picked = !!photo && photo.picks.includes(a.profileId)}
          <li>
            <button class="row" class:picked disabled={!photo} onclick={() => photo && app.togglePick(photo, a.profileId)} aria-pressed={picked}>
              <span class="key">{picked ? "✓" : i < 9 ? i + 1 : ""}</span>
              <SuitFigure colors={a.suitColors} size={44} />
              <span class="who">
                <strong>{a.name}</strong>
                <span class="muted small">{flag(a.country)} {regs(a).join(" · ")}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if result.athletes.length > LIMIT}
        <p class="muted small pad">Showing {LIMIT} of {result.athletes.length}. Narrow the filters to see the rest.</p>
      {/if}
    {/if}
  {/if}
</aside>

<style>
  .panel { height: 100%; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--border); padding-bottom: 16px; }
  .info { padding: 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .filename { font-weight: 600; word-break: break-all; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { background: var(--ok-soft); color: var(--ok); border-color: transparent; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
  .tag:hover:not(:disabled) { background: var(--ok-soft); border-color: var(--ok); }
  .funnel { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .arrow { color: var(--muted); }
  section { padding: 0 12px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 14px 0 6px; font-weight: 600; }
  .fold { background: none; border: none; padding: 0; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; }
  .pad { padding: 8px 12px; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 10px 3px 6px; color: var(--muted); text-decoration: line-through; text-decoration-color: rgba(154, 162, 177, 0.6); }
  .chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); text-decoration: none; }
  .chip .box { width: 14px; height: 14px; border: 1.5px solid currentColor; border-radius: 3px; display: grid; place-items: center; font-size: 11px; line-height: 1; }
  .chip.on .box { background: var(--accent); border-color: var(--accent); color: #111; font-weight: 700; }
  .search { width: 100%; }
  .list { list-style: none; margin: 12px 0 0; padding: 0 8px; display: flex; flex-direction: column; gap: 4px; }
  .row { width: 100%; display: grid; grid-template-columns: 22px auto 1fr; align-items: center; gap: 10px; text-align: left; padding: 6px 8px; background: var(--panel-2); border: 1px solid transparent; }
  .row:disabled { opacity: 1; cursor: default; }
  .row.picked { border-color: var(--ok); background: var(--ok-soft); }
  .key { text-align: center; color: var(--muted); font-weight: 600; }
  .picked .key { color: var(--ok); }
  .who { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .who strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who .small { white-space: normal; }
  .small { font-size: 12px; }
</style>
