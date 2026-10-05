<script lang="ts">
  import { untrack } from "svelte";
  import type { Photo } from "../lib/photos";

  let { photo }: { photo: Photo } = $props();

  let video = $state<HTMLVideoElement>();
  let failed = $state(false);
  let current = $state(0);
  let playing = false;
  let lastKey = "";
  /** Where to continue after the file was renamed (its URL changes) while being watched. */
  let resume: { ms: number; play: boolean } | null = null;

  $effect(() => {
    const key = photo.key;
    void photo.src;
    if (key !== lastKey) {
      lastKey = key;
      resume = null;
      current = 0;
      failed = false;
    } else {
      // Only re-run on key/src changes; reading `current` must not subscribe (it drops to 0 on reload).
      resume = { ms: untrack(() => current), play: playing };
    }
  });

  function onTime() {
    if (!video) return;
    current = video.currentTime * 1000;
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
      This video can't be played here (often HEVC/H.265 or ProRes outside Safari). You can still tag it.
    </div>
  {/if}
</div>

<style>
  .player { position: relative; width: 100%; height: 100%; background: #08090c; display: grid; place-items: center; }
  video { max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; }
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
