<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { COLORS, SUIT_PARTS, type SuitPart } from "../lib/roster";

  let active = $state<SuitPart>("chest");

  const NONE = "#3a404c";
  const hex = (id: string) => COLORS.find((c) => c.id === id)?.hex ?? NONE;

  /** Fill of a body part: its chosen colour, or stripes when several are allowed. */
  function fill(part: SuitPart) {
    const cs = app.suit[part] ?? [];
    if (!cs.length) return NONE;
    if (cs.length === 1) return hex(cs[0]);
    return `url(#mix-${part})`;
  }

  const anySet = $derived(SUIT_PARTS.some((p) => app.suit[p.id]?.length));
</script>

<div class="suit">
  <svg viewBox="0 0 62 100" width="68" height="110" role="group" aria-label="Pick a body part">
    <defs>
      {#each SUIT_PARTS as p (p.id)}
        {@const cs = app.suit[p.id] ?? []}
        {#if cs.length > 1}
          <linearGradient id={`mix-${p.id}`} x1="0" y1="0" x2="1" y2="1">
            {#each cs as c, i (c)}
              <stop offset={`${(i / cs.length) * 100}%`} stop-color={hex(c)} />
              <stop offset={`${((i + 1) / cs.length) * 100}%`} stop-color={hex(c)} />
            {/each}
          </linearGradient>
        {/if}
      {/each}
    </defs>
    {#snippet part(id: SuitPart, children: import("svelte").Snippet)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <g class="part" class:active={active === id} role="button" tabindex="-1" aria-label={id} onclick={() => (active = id)} fill={fill(id)}>
        {@render children()}
      </g>
    {/snippet}
    {#snippet helmet()}<circle cx="31" cy="12" r="10" />{/snippet}
    {#snippet chest()}<rect x="19" y="24" width="24" height="32" rx="5" />{/snippet}
    {#snippet arms()}<rect x="6" y="25" width="11" height="30" rx="5" /><rect x="45" y="25" width="11" height="30" rx="5" />{/snippet}
    {#snippet legs()}<rect x="19" y="58" width="11" height="40" rx="5" /><rect x="32" y="58" width="11" height="40" rx="5" />{/snippet}
    {@render part("helmet", helmet)}
    {@render part("chest", chest)}
    {@render part("arms", arms)}
    {@render part("legs", legs)}
  </svg>

  <div class="side">
    <div class="parts" role="tablist">
      {#each SUIT_PARTS as p (p.id)}
        {@const n = app.suit[p.id]?.length ?? 0}
        <button role="tab" class:active={active === p.id} aria-selected={active === p.id} onclick={() => (active = p.id)}>
          {p.label}{#if n}<span class="dot">{n}</span>{/if}
        </button>
      {/each}
    </div>
    <div class="palette" aria-label={`Colours for ${active}`}>
      {#each COLORS as c (c.id)}
        {@const on = app.suit[active]?.includes(c.id) ?? false}
        <button class="swatch" class:on style:--c={c.hex} title={c.label} aria-pressed={on} onclick={() => app.toggleSuitColor(active, c.id)}></button>
      {/each}
    </div>
    <div class="actions small">
      <button class="link" disabled={!app.suit[active]?.length} onclick={() => app.clearSuit(active)}>any {SUIT_PARTS.find((p) => p.id === active)?.label.toLowerCase()}</button>
      <button class="link" disabled={!anySet} onclick={() => app.clearSuit()}>clear all</button>
    </div>
  </div>
</div>

<style>
  .suit { display: flex; gap: 12px; align-items: flex-start; }
  svg { flex: none; }
  .part { cursor: pointer; }
  .part :global(circle), .part :global(rect) { stroke: rgba(0, 0, 0, 0.5); stroke-width: 1.5; }
  .part.active :global(circle), .part.active :global(rect) { stroke: var(--accent); stroke-width: 2.5; }
  .side { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .parts { display: flex; gap: 4px; flex-wrap: wrap; }
  .parts button { padding: 2px 8px; font-size: 12px; display: inline-flex; gap: 4px; align-items: center; }
  .parts button.active { border-color: var(--accent); background: var(--accent-soft); }
  .dot { background: var(--accent); color: #111; border-radius: 999px; font-size: 10px; padding: 0 5px; font-weight: 700; }
  .palette { display: grid; grid-template-columns: repeat(6, 24px); gap: 6px; }
  .swatch { width: 24px; height: 24px; padding: 0; border-radius: 6px; background: var(--c); border: 2px solid rgba(255, 255, 255, 0.15); }
  .swatch:hover:not(:disabled) { background: var(--c); border-color: rgba(255, 255, 255, 0.5); }
  .swatch.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
  .actions { display: flex; gap: 12px; }
  .link { background: none; border: none; color: var(--accent); padding: 0; text-decoration: underline; font-size: 12px; }
  .link:disabled { color: var(--muted); text-decoration: none; }
  .small { font-size: 12px; }
</style>
