// app/src/components/research-kit/tones.js
//
// TWO tone vocabularies. They are NOT interchangeable and must never be
// blended — a StatTile is grading a SCORE, a VerdictChip is stating a SEMANTIC
// outcome. Every consumer falls back to its own neutral on an unknown value
// rather than throwing.

/** Rating/score standing. Consumed by StatTile ONLY. Maps to --score-*. */
export const SCORE_TONES = ['elite', 'strong', 'neutral', 'weak', 'poor']

/** Semantic outcome. Consumed by VerdictChip, RangeSlider, ConsensusBar and
 *  RatingChangeList. Maps to --gain / --loss / --warn / --text-muted / gold. */
export const VERDICT_TONES = ['positive', 'negative', 'caution', 'neutral', 'gold']

/**
 * Shape channel for the verdict tones. Spec §3.3 is normative: hue is NEVER
 * the only channel, so every chip carries a glyph as the redundant encoding.
 * These are geometric text markers, not emoji (CLAUDE.md sanctions ▲▼◆★ as
 * text markers; UIcon covers actual iconography).
 */
export const VERDICT_GLYPHS = {
  positive: '▲',
  negative: '▼',
  caution: '◆',
  neutral: '—',
  gold: '★',
}

/** Default glyph for a tone; unknown tones get the neutral marker. */
export function toneGlyph(tone) {
  return VERDICT_GLYPHS[tone] ?? VERDICT_GLYPHS.neutral
}
