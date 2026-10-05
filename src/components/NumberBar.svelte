<script lang="ts">
  import { app } from "../lib/app.svelte";
  import type { Photo } from "../lib/photos";

  let { photo }: { photo: Photo } = $props();

  const scan = $derived(app.numberScans.get(photo.key));
  const numbers = $derived(scan?.status === "done" ? scan.hits.flatMap((h) => h.numbers) : []);
  const known = $derived(numbers.filter((n) => app.athletesWithBib(n).length));
</script>

<div class="bar" title="Start numbers are read on this computer; the photo is not uploaded.">
  {#if scan?.status === "running"}
    <span class="muted">Reading numbers… {Math.round(scan.progress * 100)}%</span>
  {:else}
    <button onclick={() => app.readNumbers(photo, scan?.status === "done")}>
      {scan?.status === "done" ? "↻ Read again" : "Read start numbers"}
    </button>
    {#if scan?.status === "done"}
      <span class="muted">
        {#if numbers.length}{known.length} of {numbers.length} number{numbers.length === 1 ? "" : "s"} {known.length === 1 ? "matches" : "match"} an athlete{:else}no numbers found{/if}
      </span>
    {:else if scan?.status === "error"}
      <span class="err" title={scan.error}>failed</span>
    {/if}
  {/if}
  <label class="auto"><input type="checkbox" bind:checked={app.autoReadNumbers} /> auto</label>
</div>

<style>
  .bar {
    position: absolute;
    left: 10px;
    top: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px;
    background: rgba(15, 17, 21, 0.85);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 12px;
    z-index: 2;
  }
  .bar button { padding: 2px 8px; font-size: 12px; }
  .auto { display: flex; align-items: center; gap: 4px; color: var(--muted); }
  .auto input { accent-color: var(--accent); }
  .err { color: var(--danger); }
</style>
