<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { app } from "../lib/app.svelte";
  import type { Photo } from "../lib/photos";
  import { formatClock } from "../lib/time";

  let { photo }: { photo: Photo } = $props();

  let video = $state<HTMLVideoElement>();
  let failed = $state(false);
  let current = $state(0);
  let playing = false;
  let lastKey = "";
  /** Where to continue after the file was renamed (its URL changes) while being watched. */
  let resume: { ms: number; play: boolean } | null = null;

  const match = $derived(app.matches.get(photo.key));

  $effect(() => {
    const key = photo.key;
    void photo.src;
    if (key !== lastKey) {
      lastKey = key;
      resume = null;
      current = 0;
      failed = false;
      app.playheadMs = 0;
    } else {
      // Only re-run on key/src changes; reading `current` must not subscribe (it drops to 0 on reload).
      resume = { ms: untrack(() => current), play: playing };
    }
  });

  onDestroy(() => {
    app.playheadMs = null;
  });

  $effect(() => {
    const req = app.seekRequest;
    if (!req || req.key !== photo.key || !video) return;
    app.seekRequest = null; // handled; don't replay it when this clip is selected again
    video.currentTime = req.ms / 1000;
    video.play().catch(() => undefined);
  });

  function onTime() {
    if (!video) return;
    current = video.currentTime * 1000;
    app.playheadMs = current;
  }

  function onLoaded() {
    if (!video || !resume) return;
    video.currentTime = resume.ms / 1000;
    if (resume.play) video.play().catch(() => undefined);
    resume = null;
  }
</script>

<div class="player">
  {#key photo.key}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={video}
      src={photo.src}
      controls
      playsinline
      preload="metadata"
      ontimeupdate={onTime}
      onseeked={onTime}
      onloadedmetadata={onLoaded}
      onplay={() => (playing = true)}
      onpause={() => (playing = false)}
      onerror={() => (failed = true)}
    ></video>
  {/key}
  {#if failed}
    <div class="error">
      This video can't be played here (often HEVC/H.265 or ProRes outside Safari). Matching still works from its
      recording time and length.
    </div>
  {/if}
  {#if match?.utcMs != null}
    <div class="clock mono" title="Clock-corrected time at the playhead">{formatClock(match.utcMs + current, app.timeZone)}</div>
  {/if}
</div>

<style>
  .player { position: relative; width: 100%; height: 100%; background: #08090c; display: grid; place-items: center; }
  video { max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; }
  .clock {
    position: absolute;
    left: 10px;
    top: 10px;
    background: rgba(15, 17, 21, 0.8);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 13px;
  }
  .error {
    position: absolute;
    inset: auto 16px 70px;
    background: rgba(15, 17, 21, 0.9);
    border: 1px solid var(--warn);
    color: var(--warn);
    border-radius: 8px;
    padding: 10px 14px;
    text-align: center;
  }
</style>
