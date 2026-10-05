<script lang="ts">
  import { DISCIPLINES, eventUrl } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { isTauri } from "../lib/platform";
  import { formatOffset, parseOffset } from "../lib/time";

  let { onAddFiles }: { onAddFiles: () => void } = $props();

  const zones: string[] = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  })();

  let offsetText = $state(formatOffset(app.offsetMs));
  let offsetInvalid = $state(false);
  $effect(() => {
    offsetText = formatOffset(app.offsetMs);
    offsetInvalid = false;
  });

  function commitOffset() {
    const ms = parseOffset(offsetText);
    if (ms === null) {
      offsetInvalid = true;
      return;
    }
    app.setOffset(ms);
  }

  let tzText = $state(app.timeZoneOverride ?? "");
  function commitTz() {
    app.timeZoneOverride = tzText.trim() || null;
  }

  const eventsSorted = $derived(app.events);
  function eventLabel(e: (typeof app.events)[number]) {
    const date = e.start_date ? ` — ${e.start_date}` : "";
    return `${e.name}${date}`;
  }
</script>

<header class="toolbar">
  <div class="row">
    <div class="brand">📸 <strong>DH Photo Tagger</strong></div>

    <label class="field event">
      <span>Event</span>
      <select
        value={app.eventId ?? ""}
        onchange={(e) => app.selectEvent((e.currentTarget as HTMLSelectElement).value || null)}
        disabled={app.eventsLoading}
      >
        <option value="">{app.eventsLoading ? "Loading events…" : "Choose an r4wrun event…"}</option>
        {#each eventsSorted as e (e.id)}
          <option value={e.id}>{eventLabel(e)}</option>
        {/each}
      </select>
      {#if app.event}
        <a class="ext" href={eventUrl(app.event)} target="_blank" rel="noreferrer" title="Open on r4wrun.com">↗</a>
      {/if}
      {#if app.eventLoading}<span class="muted">loading…</span>{/if}
    </label>

    <div class="chips" role="group" aria-label="Disciplines">
      {#each DISCIPLINES as d (d.id)}
        <button class="chip" class:on={app.disciplines.includes(d.id)} onclick={() => app.toggleDiscipline(d.id)} aria-pressed={app.disciplines.includes(d.id)}>
          {d.label}
        </button>
      {/each}
    </div>

    <div class="spacer"></div>

    {#if isTauri}
      <button class="primary" onclick={() => app.openFolder()}>Open folder…</button>
      {#if app.folder}
        <button onclick={() => app.loadFolder(app.folder!)} title="Rescan folder">↻</button>
      {/if}
    {:else}
      <button class="primary" onclick={onAddFiles}>Add photos…</button>
      {#if app.photos.length}<button onclick={() => app.clearPhotos()}>Clear</button>{/if}
    {/if}
  </div>

  <div class="row secondary">
    <label class="field" title="Time zone the camera clock was set to. Defaults to the event's time zone; the EXIF offset tag is ignored because cameras often get it wrong.">
      <span>Camera zone</span>
      <input list="tz-list" placeholder={app.event?.timezone ?? app.timeZone} bind:value={tzText} onchange={commitTz} size="16" />
      <datalist id="tz-list">
        {#each zones as z}<option value={z}></option>{/each}
      </datalist>
    </label>

    <label class="field" title="Added to every photo's capture time. Accepts +h:mm:ss, -35:30 (mm:ss), 90 (s), -1h30m.">
      <span>Clock offset</span>
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs - 60_000)} title="−1 minute">−1m</button>
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs - 5_000)} title="−5 seconds">−5s</button>
      <input class="mono offset" class:invalid={offsetInvalid} bind:value={offsetText} onchange={commitOffset} onkeydown={(e) => e.key === "Enter" && commitOffset()} size="9" />
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs + 5_000)} title="+5 seconds">+5s</button>
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs + 60_000)} title="+1 minute">+1m</button>
    </label>
    <button onclick={() => app.autoOffset()} disabled={!app.model || !app.photos.length} title="Find the offset that puts the most photos inside a run">Auto-detect</button>
    <button onclick={() => app.fitToPicks()} disabled={!app.model || !app.stats.tagged} title="Refine the offset using the photos you already tagged with one rider">Fit to tagged</button>
    {#if app.lastSuggestion}
      <span class="muted small">{app.lastSuggestion.matched}/{app.lastSuggestion.total} in a run</span>
    {/if}

    <label class="field position" title="Where you stood on the course. Unknown = any moment during a run counts. Set it to rank riders by when they should have passed you.">
      <span>Your position</span>
      <input type="checkbox" checked={app.position !== null} onchange={(e) => (app.position = (e.currentTarget as HTMLInputElement).checked ? 0.5 : null)} />
      {#if app.position !== null}
        <span class="small muted">start</span>
        <input type="range" min="0" max="1" step="0.01" bind:value={app.position} />
        <span class="small muted">finish</span>
      {:else}
        <span class="small muted">unknown</span>
      {/if}
    </label>

    <label class="field" title="How far a photo may be from a run (or from the expected passing moment) and still count.">
      <span>Tolerance</span>
      <select bind:value={app.toleranceMs}>
        {#each [3, 5, 10, 15, 30, 60] as s}<option value={s * 1000}>±{s}s</option>{/each}
      </select>
    </label>

  </div>
</header>

<style>
  .toolbar {
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .secondary { font-size: 13px; }
  .brand { font-size: 15px; margin-right: 6px; }
  .spacer { flex: 1; }
  .field { display: flex; align-items: center; gap: 6px; }
  .field > span:first-child { color: var(--muted); font-size: 12px; }
  .event select { max-width: 340px; }
  .ext { color: var(--muted); text-decoration: none; }
  .ext:hover { color: var(--accent); }
  .chips { display: flex; gap: 4px; }
  .chip { border-radius: 999px; padding: 3px 10px; color: var(--muted); }
  .chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
  .nudge { padding: 3px 6px; font-size: 12px; }
  .offset { text-align: center; }
  .invalid { border-color: var(--danger); }
  .small { font-size: 12px; }
  .position input[type="range"] { width: 120px; accent-color: var(--accent); }
  input[type="checkbox"] { accent-color: var(--accent); }
</style>
