<script lang="ts">
  import { eventUrl, type R4Event } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatRange } from "../lib/events";

  let open = $state(false);
  let search = $state("");
  let root: HTMLDivElement;

  const onDates = $derived(new Set(app.eventsOnPhotoDates.map((e) => e.id)));

  function dates(e: R4Event) {
    if (!e.start_date) return "no date";
    return e.end_date && e.end_date !== e.start_date ? `${e.start_date} – ${e.end_date}` : e.start_date;
  }

  const list = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const hit = (e: R4Event) => !q || `${e.name} ${e.location ?? ""}`.toLowerCase().includes(q);
    return {
      highlighted: app.eventsOnPhotoDates.filter(hit),
      rest: app.events.filter((e) => !onDates.has(e.id) && hit(e)),
    };
  });

  const label = $derived.by(() => {
    const sel = app.selectedEvents;
    if (!sel.length) return app.eventsLoading ? "Loading events…" : "Choose events…";
    return sel.length === 1 ? sel[0].name : `${sel[0].name} +${sel.length - 1}`;
  });

  function onWindowClick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === "Escape" && (open = false)} />

<div class="picker" bind:this={root}>
  <button class="trigger" class:empty={!app.eventIds.length} onclick={() => (open = !open)} aria-expanded={open}>
    <span class="label">{label}</span>
    {#if app.loadingEventIds.length}<span class="muted small">loading…</span>{/if}
    <span aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="menu">
      <input class="search" placeholder="Search events…" bind:value={search} />
      {#if app.captureRange}
        <div class="head">
          On your photo dates ({formatRange(app.captureRange)})
          {#if !app.eventsOnPhotoDates.length}<span class="muted">: none</span>{/if}
        </div>
        {#each list.highlighted as e (e.id)}
          {@render row(e, true)}
        {/each}
        <div class="head">Other events</div>
      {/if}
      {#each list.rest as e (e.id)}
        {@render row(e, false)}
      {:else}
        <div class="muted pad">No events match.</div>
      {/each}
    </div>
  {/if}
</div>

{#snippet row(e: R4Event, highlighted: boolean)}
  {@const on = app.isEventSelected(e.id)}
  <label class="row" class:on class:highlighted>
    <input type="checkbox" checked={on} onchange={() => app.toggleEvent(e.id)} />
    <span class="name">{e.name}</span>
    <span class="muted small mono">{dates(e)}</span>
    {#if app.loadingEventIds.includes(e.id)}<span class="muted small">…</span>{/if}
    {#if app.eventErrors.has(e.id)}<button class="small warn" title={app.eventErrors.get(e.id)} onclick={() => app.loadEvent(e.id, true)}>retry</button>{/if}
    <a class="ext" href={eventUrl(e)} target="_blank" rel="noreferrer" title="Open on r4wrun.com">↗</a>
  </label>
{/snippet}

<style>
  .picker { position: relative; }
  .trigger { display: flex; align-items: center; gap: 8px; max-width: 360px; }
  .trigger .label { overflow: hidden; text-overflow: ellipsis; }
  .trigger.empty { border-color: var(--accent); }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    width: min(520px, 90vw);
    max-height: 70vh;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    padding: 8px;
  }
  .search { width: 100%; margin-bottom: 6px; }
  .head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 10px 6px 4px; }
  .row { display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 8px; align-items: center; padding: 5px 6px; border-radius: 6px; cursor: pointer; }
  .row:hover { background: var(--panel-2); }
  .row.highlighted { background: var(--accent-soft); }
  .row.highlighted .name { font-weight: 600; }
  .row.on { box-shadow: inset 3px 0 0 var(--accent); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ext { color: var(--muted); text-decoration: none; }
  .ext:hover { color: var(--accent); }
  .small { font-size: 12px; }
  .warn { color: var(--warn); padding: 1px 6px; }
  .pad { padding: 8px; }
  input[type="checkbox"] { accent-color: var(--accent); }
</style>
