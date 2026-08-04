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
