<script lang="ts">
  import { DISCIPLINES } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Race } from "../lib/roster";

  let open = $state(false);

  const schedule = $derived(app.filtered.schedule);
  const range = $derived(app.filtered.range);
  const multiEvent = $derived(app.eventIds.length > 1);

  function zone(r: Race) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: r.timeZone ?? undefined });
      return r.timeZone ?? undefined;
    } catch {
      return undefined;
    }
  }

  function day(r: Race) {
    if (r.startMs === null) return "No time";
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone(r), weekday: "short", day: "2-digit", month: "short" }).format(r.startMs);
  }

  function clock(ms: number | null, r: Race) {
    if (ms === null) return "";
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone(r), hour: "2-digit", minute: "2-digit" }).format(ms);
  }

  function title(r: Race) {
    const d = DISCIPLINES.find((x) => x.id === r.discipline)?.label ?? r.discipline;
    return `${d} ${r.label}`;
  }

  const summary = $derived.by(() => {
    if (!range) return "All races";
    const a = schedule[range[0]];
    const b = schedule[range[1]];
    return a === b ? title(a) : `${title(a)} → ${title(b)}`;
  });

  function setFrom(r: Race) {
    app.raceFrom = r.id;
    if (!app.raceTo) app.raceTo = r.id;
  }
  function setTo(r: Race) {
    app.raceTo = r.id;
    if (!app.raceFrom) app.raceFrom = r.id;
  }
  function clear() {
    app.raceFrom = null;
    app.raceTo = null;
  }
</script>

<div class="races">
  <div class="summary">
    <button class="toggle" onclick={() => (open = !open)} aria-expanded={open}>
      <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      <span class="what">{summary}</span>
    </button>
    {#if range}<button class="small" onclick={clear}>Clear</button>{/if}
  </div>

  {#if open}
    {#if !schedule.length}
      <p class="muted small">No races in the selected events and disciplines.</p>
    {:else}
      <p class="muted small hint">Set the first and the last race. Only riders who rode in those races (and the ones between) stay in the list.</p>
      <ol class="list">
        {#each schedule as r, i (r.id)}
          {@const inRange = !!range && i >= range[0] && i <= range[1]}
          {#if i === 0 || day(r) !== day(schedule[i - 1])}
            <li class="day">{day(r)}</li>
          {/if}
          <li class="race" class:inRange>
            <span class="time mono">{clock(r.startMs, r)}{r.endMs !== null && r.startMs !== null ? `–${clock(r.endMs, r)}` : ""}</span>
            <span class="name">
              <strong>{title(r)}</strong>
              <span class="muted small">
                {r.categories.join(", ")}{r.categories.length ? " · " : ""}{r.profileIds.size} riders{multiEvent ? ` · ${r.eventName}` : ""}
              </span>
            </span>
            <span class="btns">
              <button class:on={app.raceFrom === r.id} onclick={() => setFrom(r)} title="First race of the range">from</button>
              <button class:on={app.raceTo === r.id} onclick={() => setTo(r)} title="Last race of the range">to</button>
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</div>

<style>
  .summary { display: flex; gap: 8px; align-items: center; }
  .toggle { flex: 1; display: flex; gap: 8px; text-align: left; min-width: 0; }
  .what { overflow: hidden; text-overflow: ellipsis; }
  .hint { margin: 8px 0; }
  .list { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; }
  .day { position: sticky; top: 0; background: var(--panel); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: 6px 8px 4px; border-bottom: 1px solid var(--border); }
  .race { display: grid; grid-template-columns: 82px 1fr auto; gap: 8px; align-items: center; padding: 5px 8px; border-bottom: 1px solid var(--border); }
  .race.inRange { background: var(--accent-soft); }
  .name { display: flex; flex-direction: column; min-width: 0; }
  .name strong { font-weight: 600; }
  .btns { display: flex; gap: 4px; }
  .btns button { padding: 1px 6px; font-size: 11px; }
  .btns button.on { background: var(--accent); border-color: var(--accent); color: #111; font-weight: 600; }
  .small { font-size: 12px; }
</style>
