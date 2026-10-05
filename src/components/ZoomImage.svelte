<script lang="ts" module>
  /** A clickable region on the image, in the image's own pixels. */
  export interface Mark {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    title: string;
    strong: boolean;
    onclick: () => void;
  }
</script>

<script lang="ts">
  let { src, alt = "", marks = [] }: { src: string; alt?: string; marks?: Mark[] } = $props();

  let natural = $state({ w: 0, h: 0 });
  let box = $state({ w: 0, h: 0 });
  /** Size of the image when fitted into the view (before zooming). */
  const fitted = $derived.by(() => {
    if (!natural.w || !box.w) return null;
    const k = Math.min(box.w / natural.w, box.h / natural.h);
    return { w: natural.w * k, h: natural.h * k };
  });

  let scale = $state(1);
  let x = $state(0);
  let y = $state(0);
  let dragging = $state(false);
  let container: HTMLDivElement;
  let last = { x: 0, y: 0 };

  $effect(() => {
    void src;
    natural = { w: 0, h: 0 };
    reset();
  });

  function reset() {
    scale = 1;
    x = 0;
    y = 0;
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const rect = container.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const next = Math.min(12, Math.max(1, scale * factor));
    const k = next / scale;
    x = cx - (cx - x) * k;
    y = cy - (cy - y) * k;
    scale = next;
    if (scale === 1) reset();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  }

  function onDown(e: PointerEvent) {
    if (scale === 1) return;
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    x += e.clientX - last.x;
    y += e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
  }

  function onDouble(e: MouseEvent) {
    if (scale > 1) reset();
    else zoomAt(e.clientX, e.clientY, 3);
  }
</script>

<div
  class="zoom"
  class:zoomed={scale > 1}
  class:dragging
  bind:this={container}
  bind:clientWidth={box.w}
  bind:clientHeight={box.h}
  onwheel={onWheel}
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  ondblclick={onDouble}
  role="img"
  aria-label={alt}
>
  <div
    class="stage"
    style:width={fitted ? `${fitted.w}px` : undefined}
    style:height={fitted ? `${fitted.h}px` : undefined}
    style:transform={`translate(${x}px, ${y}px) scale(${scale})`}
  >
    <img {src} {alt} draggable="false" onload={(e) => { const i = e.currentTarget as HTMLImageElement; natural = { w: i.naturalWidth, h: i.naturalHeight }; }} />
    {#if fitted}
      {#each marks as m, i (i)}
        <button
          class="mark"
          class:strong={m.strong}
          title={m.title}
          style:left={`${(m.x / natural.w) * 100}%`}
          style:top={`${(m.y / natural.h) * 100}%`}
          style:width={`${(m.w / natural.w) * 100}%`}
          style:height={`${(m.h / natural.h) * 100}%`}
          style:--inv={1 / scale}
          onpointerdown={(e) => e.stopPropagation()}
          ondblclick={(e) => e.stopPropagation()}
          onclick={(e) => { e.stopPropagation(); m.onclick(); }}
        ><span class="label">{m.label}</span></button>
      {/each}
    {/if}
  </div>
  <div class="controls">
    <button title="Zoom out" onclick={() => { const r = container.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.5); }}>−</button>
    <span class="mono">{Math.round(scale * 100)}%</span>
    <button title="Zoom in" onclick={() => { const r = container.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.5); }}>+</button>
    <button title="Fit (double-click)" onclick={reset}>Fit</button>
  </div>
</div>

<style>
  .zoom {
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    background: #08090c;
    display: grid;
    place-items: center;
    cursor: zoom-in;
    touch-action: none;
    user-select: none;
  }
  .zoomed { cursor: grab; }
  .dragging { cursor: grabbing; }
  .stage {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    transform-origin: center;
    will-change: transform;
  }
  .stage img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .mark {
    position: absolute;
    padding: 0;
    border: calc(2px * var(--inv)) solid rgba(255, 255, 255, 0.55);
    border-radius: calc(4px * var(--inv));
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
  }
  .mark.strong { border-color: var(--accent); background: rgba(255, 122, 26, 0.18); }
  .mark:hover { border-color: var(--ok); }
  .mark .label {
    position: absolute;
    left: 50%;
    bottom: 100%;
    transform: translate(-50%, calc(-2px * var(--inv))) scale(var(--inv));
    transform-origin: bottom center;
    background: rgba(15, 17, 21, 0.9);
    color: var(--text);
    border: 1px solid currentColor;
    border-radius: 4px;
    padding: 0 5px;
    font-size: 12px;
    white-space: nowrap;
  }
  .mark.strong .label { color: var(--accent); }
  .controls {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: rgba(15, 17, 21, 0.8);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .controls button { padding: 2px 9px; }
  .controls span { min-width: 44px; text-align: center; }
</style>
