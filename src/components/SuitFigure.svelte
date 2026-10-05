<script lang="ts">
  import type { SuitColors } from "../lib/api";

  let { colors, size = 44 }: { colors: SuitColors | null; size?: number } = $props();

  const NONE = "#3a404c";
  const c = (k: keyof SuitColors) => colors?.[k] || NONE;
</script>

<!-- A tiny rider seen from the front, painted with the suit colours registered on r4wrun. -->
<svg
  class="suit"
  class:empty={!colors}
  width={size * 0.62}
  height={size}
  viewBox="0 0 62 100"
  role="img"
  aria-label={colors ? "Suit colours" : "No suit info"}
>
  <title>{colors ? "Suit colours: " + Object.entries(colors).map(([k, v]) => `${k} ${v}`).join(", ") : "No suit info"}</title>
  <circle cx="31" cy="12" r="10" fill={c("helmet")} />
  <rect x="19" y="24" width="24" height="32" rx="5" fill={c("chest")} />
  <rect x="6" y="25" width="11" height="30" rx="5" fill={c("rightArm")} />
  <rect x="45" y="25" width="11" height="30" rx="5" fill={c("leftArm")} />
  <rect x="19" y="58" width="11" height="40" rx="5" fill={c("rightLeg")} />
  <rect x="32" y="58" width="11" height="40" rx="5" fill={c("leftLeg")} />
  {#if !colors}
    <text x="31" y="48" text-anchor="middle" font-size="22" fill="#9aa2b1">?</text>
  {/if}
</svg>

<style>
  .suit { flex: none; }
  .suit :global(circle), .suit :global(rect) { stroke: rgba(0, 0, 0, 0.45); stroke-width: 1.5; }
  .empty { opacity: 0.7; }
</style>
