<script lang="ts">
  import { app, type PhotoFilter } from "../lib/app.svelte";
  import { orientationTransform, type Photo } from "../lib/photos";
  import { formatClock } from "../lib/time";
  import { formatDuration } from "../lib/video";

  const filters: { id: PhotoFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "untagged", label: "Untagged" },
    { id: "suggested", label: "Suggested" },
    { id: "tagged", label: "Tagged" },
    { id: "unmatched", label: "No match" },
    { id: "videos", label: "Videos" },
  ];

  function pickedNames(p: Photo) {
    return p.picks.map((id, i) => app.athlete(id)?.name ?? p.pickNames[i]?.replace(/-/g, " ") ?? id);
  }

  $effect(() => {
    // Keep the selected card in view when navigating with the keyboard.
    const key = app.selectedKey;
    if (!key) return;
    document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  });
</script>

<section class="explorer">
  <div class="tabs" role="tablist">
    {#each filters.filter((f) => f.id !== "videos" || app.hasVideos) as f (f.id)}
      <button role="tab" class:active={app.filter === f.id} aria-selected={app.filter === f.id} onclick={() => (app.filter = f.id)}>
        {f.label}
      </button>
    {/each}
    <span class="spacer"></span>
    <button class="accept" onclick={() => app.acceptSuggestions()} disabled={!app.stats.suggested} title="Tag every untagged photo that has one clearly leading candidate">
      Accept {app.stats.suggested} suggestion{app.stats.suggested === 1 ? "" : "s"}
    </button>
  </div>
  <div class="stats muted">
    {app.stats.total} files · {app.stats.matched} matched · {app.stats.tagged} tagged
  </div>

  <div class="grid">
    {#each app.visiblePhotos as p (p.key)}
      {@const m = app.matches.get(p.key)}
      <button class="card" class:selected={p.key === app.selectedKey} data-key={p.key} onclick={() => (app.selectedKey = p.key)} title={p.name}>
        <div class="thumb">
          {#if p.thumb}
            <img src={p.thumb} alt="" loading="lazy" decoding="async" style:transform={orientationTransform(p.orientation)} />
          {:else if p.kind === "video"}
            <span class="film" aria-hidden="true">🎞</span>
          {:else}
            <img src={p.src} alt="" loading="lazy" decoding="async" />
          {/if}
          {#if p.kind === "video"}
            <span class="badge mono">▶ {p.durationMs != null ? formatDuration(p.durationMs) : "video"}</span>
          {/if}
          {#if m?.utcMs != null}
            <span class="time mono">{formatClock(m.utcMs, app.timeZone)}</span>
          {/if}
        </div>
        <div class="name">{p.name}</div>
        <div class="tags">
          {#if p.picks.length}
            {#each pickedNames(p) as n}<span class="tag picked">✓ {n}</span>{/each}
          {:else if m?.suggestion}
            <span class="tag suggested">{app.athlete(m.suggestion.profileId)?.name}?</span>
          {:else if m?.candidates.length}
            <span class="tag">{m.candidates.length} candidate{m.candidates.length === 1 ? "" : "s"}</span>
          {:else if !p.wall}
            <span class="tag warn">no {p.kind === "video" ? "recording" : "capture"} time</span>
          {:else if app.model}
            <span class="tag none">no run at this time</span>
          {/if}
        </div>
      </button>
    {:else}
      <p class="empty muted">
        {app.photos.length ? "Nothing matches this filter." : "No photos or videos loaded yet."}
      </p>
    {/each}
  </div>
</section>

<style>
  .explorer { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--panel); }
  .tabs { display: flex; align-items: center; gap: 2px; padding: 8px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .tabs button { border: none; background: none; color: var(--muted); padding: 4px 8px; }
  .tabs .spacer { flex: 1; }
  .tabs button.accept { border: 1px solid var(--border); color: var(--text); }
  .stats { font-size: 12px; padding: 6px 12px 0; }
  .tabs button.active { color: var(--text); background: var(--panel-2); }
  .grid {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
    align-content: start;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    text-align: left;
    background: var(--panel-2);
    border: 2px solid transparent;
    border-radius: var(--radius);
    content-visibility: auto;
    contain-intrinsic-size: 150px 170px;
  }
  .card.selected { border-color: var(--accent); }
  .thumb { position: relative; aspect-ratio: 3 / 2; overflow: hidden; border-radius: 5px; background: #0a0b0e; display: grid; place-items: center; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .time { position: absolute; left: 4px; bottom: 4px; background: rgba(0, 0, 0, 0.65); padding: 1px 4px; border-radius: 4px; font-size: 11px; }
  .badge { position: absolute; right: 4px; top: 4px; background: rgba(0, 0, 0, 0.7); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
  .film { font-size: 34px; opacity: 0.6; }
  .name { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tags { display: flex; flex-wrap: wrap; gap: 3px; min-height: 18px; }
  .tag { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #2a2f3a; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag.picked { background: var(--ok-soft); color: var(--ok); }
  .tag.suggested { background: none; border: 1px dashed var(--accent); color: var(--accent); }
  .tag.warn { color: var(--warn); }
  .tag.none { opacity: 0.7; }
  .empty { grid-column: 1 / -1; text-align: center; padding: 24px; }
</style>
