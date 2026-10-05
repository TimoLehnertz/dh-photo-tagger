<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { isTauri } from "../lib/platform";
  import { DOWNLOADS, detectOs } from "../lib/downloads";
  import EventPicker from "./EventPicker.svelte";

  const os = detectOs();

  let { onAddFiles }: { onAddFiles: () => void } = $props();
</script>

<header class="toolbar">
  <div class="brand"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="20" height="20" /> <strong>DH Photo Tagger</strong></div>

  <div class="field">
    <span>Events</span>
    <EventPicker />
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
</header>

<style>
  .toolbar {
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .brand { font-size: 15px; display: flex; align-items: center; gap: 8px; margin-right: 6px; }
  .spacer { flex: 1; }
  .field { display: flex; align-items: center; gap: 6px; }
  .field > span:first-child { color: var(--muted); font-size: 12px; }
  .small { font-size: 12px; }
  .downloads { display: flex; gap: 8px; align-items: center; }
  .downloads a { color: var(--muted); }
  .downloads a.mine, .downloads a:hover { color: var(--accent); }
</style>
