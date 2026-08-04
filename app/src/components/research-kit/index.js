// app/src/components/research-kit/index.js
//
// The research-kit barrel (spec §3.4). Both redesigned surfaces — the earnings
// modal and /research/:sym — import their vocabulary from here so "the modal is
// the page in miniature" is enforced by construction rather than by discipline.
//
// LOADING IDIOM: there is no Skeleton in this kit. Use the EXISTING
// components/Skeleton.jsx `SkeletonBlock` with its `size` contract — a second
// identically-named component is explicitly banned (§3.4).
export { default as InfoTip } from './InfoTip'
export { default as EyebrowLabel } from './EyebrowLabel'
export { default as GlassCard } from './GlassCard'
export { default as StatTile } from './StatTile'
export { default as VerdictChip } from './VerdictChip'
export { SCORE_TONES, VERDICT_TONES, VERDICT_GLYPHS, toneGlyph } from './tones'
export {
  default as RangeSlider,
  positionPct,
  labelPct,
  LABEL_EDGE_CLAMP_PCT,
  resolveBelowLabels,
  BAND_LABEL_COLLISION_PCT,
} from './RangeSlider'
export { default as EmptyState } from './EmptyState'
export { default as ConsensusBar, consensusSegments, LABEL_MIN_PCT } from './ConsensusBar'
export { default as RatingChangeList, actionTone } from './RatingChangeList'

// Charts (P1F-B). Every one of these draws through charts/echartsCore.js or
// hand-written SVG — no component imports 'echarts' or 'echarts-for-react'.
export { default as EChart, CHART_INK, echarts } from './charts/echartsCore'
export {
  default as LollipopChart,
  SIZE as LOLLIPOP_SIZE,
  beatState,
  buildLollipopOption,
  horizonLabel,
} from './charts/LollipopChart'
export {
  default as ReactionBars,
  SIZE as REACTION_BARS_SIZE,
  reactionGeometry,
  reactionStats,
  outcomeOf,
} from './charts/ReactionBars'
export {
  default as ImpliedVsRealized,
  SIZE as IMPLIED_VS_REALIZED_SIZE,
  pairQuarters,
  coldStartState,
  impliedVerdict,
} from './charts/ImpliedVsRealized'
export {
  default as RevisionColumns,
  SIZE as REVISION_COLUMNS_SIZE,
  revisionTotals,
  buildRevisionOption,
} from './charts/RevisionColumns'
export {
  default as Histogram,
  SIZE as HISTOGRAM_SIZE,
  binValues,
  buildHistogramOption,
} from './charts/Histogram'
export {
  default as RatingCrown,
  SIZE as RATING_CROWN_SIZE,
  scoreTier,
  letterTier,
  ringGeometry,
  basisPill,
  COMPONENT_ORDER,
} from './RatingCrown'
export { default as CheckupRow, normalizeStatus } from './CheckupRow'
export {
  default as HeatGrid,
  heatTier,
  HEAT_TIERS,
  DEFAULT_HEAT_STOPS,
  formatSigned,
} from './charts/HeatGrid'
export {
  default as MetricTrendChart,
  SIZE as METRIC_TREND_SIZE,
  buildTrendOption,
} from './charts/MetricTrendChart'

// Shell (P1F-B) — the three pinned pieces that make the modal the page in
// miniature (§3.4). All PURE DISPLAY: no fetching, no timers.
export {
  default as IdentityBanner,
  LIFECYCLE_STATES,
  normalizeLifecycle,
  timingVariant,
} from './shell/IdentityBanner'
export { default as SectionRail, nextIndex } from './shell/SectionRail'
export { default as PinnedFooter } from './shell/PinnedFooter'
