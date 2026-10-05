<script lang="ts">
  import { DISCIPLINES, eventUrl } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { isTauri } from "../lib/platform";
  import { DOWNLOADS, detectOs } from "../lib/downloads";
  import { formatRange } from "../lib/events";
  import { formatOffset, parseOffset } from "../lib/time";

  const os = detectOs();

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

  const filtering = $derived(app.onlyEventsOnPhotoDates && !!app.captureRange && app.eventsOnPhotoDates.length > 0);
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
        {#each app.pickableEvents as e (e.id)}
          <option value={e.id}>{eventLabel(e)}{app.isEventDuringPhotos(e) ? "  ✓ timing matches your photos" : ""}</option>
        {/each}
      </select>
      {#if app.event}
        <a class="ext" href={eventUrl(app.event)} target="_blank" rel="noreferrer" title="Open on r4wrun.com">↗</a>
      {/if}
      {#if app.eventLoading}<span class="muted">loading…</span>{/if}
    </label>
    {#if app.captureRange}
      <label class="field small" title="Only list r4wrun events that ran on the dates your photos/videos were taken (±1 day).">
        <input type="checkbox" bind:checked={app.onlyEventsOnPhotoDates} />
        <span class="muted">
          {#if app.eventsOnPhotoDates.length}
            only events on {formatRange(app.captureRange)} ({app.eventsOnPhotoDates.length})
          {:else}
            no event on {formatRange(app.captureRange)} — showing all
          {/if}
        </span>
      </label>
    {/if}

    <div class="field chips" role="group" aria-label="Disciplines to match">
      <span title="Click a discipline to include or exclude its riders">Match</span>
      {#each DISCIPLINES as d (d.id)}
        {@const on = app.disciplines.includes(d.id)}
        <button
          class="chip"
          class:on
          onclick={() => app.toggleDiscipline(d.id)}
          aria-pressed={on}
          title={on ? `Click to exclude ${d.label} riders` : `Click to include ${d.label} riders`}
        >
          <span class="box" aria-hidden="true">{on ? "✓" : ""}</span>{d.label}
        </button>
      {/each}
      {#if !app.disciplines.length}<span class="warn small">select at least one</span>{/if}
    </div>

    <div class="spacer"></div>

    {#if isTauri}
      <button class="primary" onclick={() => app.openFolder()}>Open folder…</button>
      {#if app.folder}
        <button onclick={() => app.loadFolder(app.folder!)} title="Rescan folder">↻</button>
      {/if}
    {:else}
      <span class="downloads small" title="The desktop app opens a folder and writes rider names into the file names">
        <span class="muted">Desktop app:</span>
        <a href={DOWNLOADS.mac} class:mine={os === "mac"}>macOS</a>
        <a href={DOWNLOADS.linuxAppImage} class:mine={os === "linux"}>Linux</a>
      </span>
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
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs - 3_600_000)} title="−1 hour">−1h</button>
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs - 60_000)} title="−1 minute">−1m</button>
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs - 5_000)} title="−5 seconds">−5s</button>
      <input class="mono offset" class:invalid={offsetInvalid} bind:value={offsetText} onchange={commitOffset} onkeydown={(e) => e.key === "Enter" && commitOffset()} size="9" />
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs + 5_000)} title="+5 seconds">+5s</button>
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs + 60_000)} title="+1 minute">+1m</button>
      <button class="nudge" onclick={() => app.setOffset(app.offsetMs + 3_600_000)} title="+1 hour">+1h</button>
    </label>
    <button onclick={() => app.fitToPicks()} disabled={!app.model || !app.stats.tagged} title="Refine the offset using the photos you already tagged with one rider">Fit to tagged</button>

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

    {#if app.hasVideos}
      <label class="field" title="How to read video timestamps. Most cameras store their own clock reading (like photo EXIF); phones store real UTC. Some cameras stamp the end of the recording instead of the start.">
        <span>Video time</span>
        <select bind:value={app.videoClock}>
          <option value="local">camera clock</option>
          <option value="utc">UTC (phones)</option>
        </select>
        <select bind:value={app.videoStamp}>
          <option value="start">= start</option>
          <option value="end">= end</option>
        </select>
      </label>
    {/if}

    <label class="field" title="How long before a run starts and after it finishes a photo still counts as that rider. With a position set, the window is around the moment the rider should pass you.">
      <span>Match window</span>
      <input class="secs" type="number" min="0" step="1" value={app.beforeMs / 1000} onchange={(e) => (app.beforeMs = Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) * 1000)} />
      <span class="small muted">s before</span>
      <input class="secs" type="number" min="0" step="1" value={app.afterMs / 1000} onchange={(e) => (app.afterMs = Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) * 1000)} />
      <span class="small muted">s after</span>
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
  .chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 10px 3px 6px; color: var(--muted); text-decoration: line-through; text-decoration-color: rgba(154, 162, 177, 0.6); }
  .chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); text-decoration: none; }
  .chip .box { width: 14px; height: 14px; border: 1.5px solid currentColor; border-radius: 3px; display: grid; place-items: center; font-size: 11px; line-height: 1; }
  .chip.on .box { background: var(--accent); border-color: var(--accent); color: #111; font-weight: 700; }
  .warn { color: var(--warn); }
  .nudge { padding: 3px 6px; font-size: 12px; }
  .offset { text-align: center; }
  .invalid { border-color: var(--danger); }
  .small { font-size: 12px; }
  .secs { width: 58px; }
  .downloads { display: flex; gap: 8px; align-items: center; }
  .downloads a { color: var(--muted); }
  .downloads a.mine, .downloads a:hover { color: var(--accent); }
  .position input[type="range"] { width: 120px; accent-color: var(--accent); }
  input[type="checkbox"] { accent-color: var(--accent); }
</style>
