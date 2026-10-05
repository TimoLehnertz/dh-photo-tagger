<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./lib/app.svelte";
  import { DOWNLOADS } from "./lib/downloads";
  import { isTauri } from "./lib/platform";
  import CandidatePanel from "./components/CandidatePanel.svelte";
  import PhotoGrid from "./components/PhotoGrid.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import VideoPlayer from "./components/VideoPlayer.svelte";
  import ZoomImage from "./components/ZoomImage.svelte";

  let fileInput: HTMLInputElement;
  let dragDepth = $state(0);

  onMount(() => {
    app.loadEvents();
  });

  $effect(() => {
    if (!app.notice) return;
    const n = app.notice;
    const t = setTimeout(() => {
      if (app.notice === n) app.notice = null;
    }, 6000);
    return () => clearTimeout(t);
  });

  async function filesFromDrop(e: DragEvent): Promise<File[]> {
    const items = [...(e.dataTransfer?.items ?? [])];
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
    if (!entries.length) return [...(e.dataTransfer?.files ?? [])];
    const out: File[] = [];
    async function walk(entry: FileSystemEntry) {
      if (entry.isFile) {
        out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const child of batch) await walk(child);
        }
      }
    }
    for (const entry of entries) await walk(entry);
    return out;
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    if (isTauri) return;
    const files = await filesFromDrop(e);
    if (files.length) await app.addFiles(files);
  }

  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("input, select, textarea")) return;
    if ((e.key === "Enter" || e.key === " ") && target.closest("button")) return;
    const photo = app.selected;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      app.step(1);
      e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      app.step(-1);
      e.preventDefault();
    } else if (photo && /^[1-9]$/.test(e.key)) {
      const c = app.matches.get(photo.key)?.candidates[Number(e.key) - 1];
      if (c) app.togglePick(photo, c.profileId);
    } else if (photo && e.key === "Enter") {
      const s = app.matches.get(photo.key)?.suggestion;
      if (s && !photo.picks.length) app.togglePick(photo, s.profileId);
      app.step(1);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="app"
  role="application"
  ondragenter={(e) => { e.preventDefault(); if (!isTauri) dragDepth++; }}
  ondragleave={() => (dragDepth = Math.max(0, dragDepth - 1))}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  <Toolbar onAddFiles={() => fileInput.click()} />

  {#if app.eventsError}
    <div class="banner error">Could not load events from r4wrun: {app.eventsError} <button onclick={() => app.loadEvents()}>Retry</button></div>
  {/if}
  {#if app.eventError}
    <div class="banner error">Could not load event timing: {app.eventError} <button onclick={() => app.selectEvent(app.eventId)}>Retry</button></div>
  {/if}

  {#if app.photos.length}
    <main class="workspace">
      <PhotoGrid />
      <section class="viewer">
        {#if app.selected?.kind === "video"}
          <VideoPlayer photo={app.selected} />
        {:else if app.selected}
          <ZoomImage src={app.selected.src} alt={app.selected.name} />
        {:else}
          <p class="muted center">Select a photo or clip.</p>
        {/if}
      </section>
      {#if app.selected}
        <CandidatePanel photo={app.selected} />
      {:else}
        <aside></aside>
      {/if}
    </main>
  {:else}
    <main class="welcome">
      <div class="card">
        <h1>Tag downhill race photos and videos with rider names</h1>
        <ol>
          <li>
            Choose the <strong>r4wrun event</strong> the photos are from{app.event ? ` (✓ ${app.event.name})` : ""} — or just load
            your files first: the list narrows to events on their dates and picks the event if only one matches.
          </li>
          <li>
            {#if isTauri}
              <strong>Open the folder</strong> with your photos and videos. Picked riders are appended to the file names.
            {:else}
              <strong>Drop photos and videos</strong> (or a folder) here, or <button class="link" onclick={() => fileInput.click()}>browse</button>.
              Files stay on your computer — nothing is uploaded.
            {/if}
          </li>
          <li>Set the <strong>Clock offset</strong> to how far the camera clock was off, then confirm riders for each photo or clip.</li>
        </ol>
        {#if isTauri}
          <button class="primary" onclick={() => app.openFolder()}>Open folder…</button>
        {:else}
          <p class="muted small">
            The web version can't rename files; tags are shown in the app and remembered in this browser. To write rider
            names into the file names, use the desktop app:
          </p>
          <p class="dl">
            <a class="button" href={DOWNLOADS.mac}>⬇ macOS (.dmg)</a>
            <a class="button" href={DOWNLOADS.linuxAppImage}>⬇ Linux (AppImage)</a>
            <a class="small" href={DOWNLOADS.linuxTarball}>Linux binary (.tar.gz, Arch/Omarchy)</a>
            <a class="small" href={DOWNLOADS.releasePage}>all downloads</a>
          </p>
        {/if}
      </div>
    </main>
  {/if}

  {#if dragDepth > 0}
    <div class="dropzone">Drop photos or videos to add them</div>
  {/if}
  {#if app.busy}
    <div class="toast">{app.busy}</div>
  {:else if app.notice}
    <button class="toast" class:error={app.notice.kind === "error"} onclick={() => (app.notice = null)}>{app.notice.text}</button>
  {/if}

  <input
    bind:this={fileInput}
    type="file"
    accept="image/*,video/mp4,video/quicktime,.jpg,.jpeg,.heic,.mp4,.mov,.m4v"
    multiple
    hidden
    onchange={(e) => {
      const input = e.currentTarget as HTMLInputElement;
      const files = [...(input.files ?? [])];
      input.value = "";
      if (files.length) app.addFiles(files);
    }}
  />
</div>

<style>
  .app { height: 100%; display: flex; flex-direction: column; position: relative; }
  .workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(260px, 30%) 1fr 360px;
  }
  .workspace > :global(*) { min-height: 0; min-width: 0; }
  .viewer { border-left: 1px solid var(--border); min-height: 0; }
  .center { text-align: center; margin-top: 40%; }
  .welcome { flex: 1; display: grid; place-items: center; padding: 24px; }
  .welcome .card { max-width: 560px; background: var(--panel); border: 1px dashed var(--border); border-radius: 14px; padding: 28px 32px; }
  .welcome h1 { font-size: 20px; margin: 0 0 12px; }
  .welcome ol { padding-left: 20px; line-height: 1.7; }
  .link { background: none; border: none; color: var(--accent); padding: 0; text-decoration: underline; }
  .small { font-size: 12px; }
  .dl { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .dl a { color: var(--muted); }
  .dl a.button { color: var(--text); text-decoration: none; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; }
  .dl a.button:hover { border-color: var(--accent); }
  .banner { padding: 8px 12px; font-size: 13px; display: flex; gap: 10px; align-items: center; }
  .banner.error { background: rgba(255, 92, 92, 0.12); color: var(--danger); }
  .dropzone {
    position: absolute;
    inset: 8px;
    border: 3px dashed var(--accent);
    border-radius: 16px;
    background: rgba(15, 17, 21, 0.85);
    display: grid;
    place-items: center;
    font-size: 22px;
    pointer-events: none;
    z-index: 10;
  }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    max-width: 70%;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 16px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
    z-index: 20;
    white-space: normal;
    text-align: center;
  }
  .toast.error { border-color: var(--danger); color: var(--danger); }

  @media (max-width: 900px) {
    .workspace { grid-template-columns: 1fr; grid-template-rows: 40% 30% 30%; }
  }
</style>
