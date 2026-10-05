<script lang="ts">
  let { src, alt = "" }: { src: string; alt?: string } = $props();

  let scale = $state(1);
  let x = $state(0);
  let y = $state(0);
  let dragging = $state(false);
  let container: HTMLDivElement;
  let last = { x: 0, y: 0 };

  $effect(() => {
    void src;
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
  onwheel={onWheel}
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  ondblclick={onDouble}
  role="img"
  aria-label={alt}
>
  <img {src} {alt} draggable="false" style:transform={`translate(${x}px, ${y}px) scale(${scale})`} />
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
  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transform-origin: center;
    will-change: transform;
  }
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
