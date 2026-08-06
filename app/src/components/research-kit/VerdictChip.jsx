// app/src/components/research-kit/VerdictChip.jsx
import InfoTip, { normalizeInfo } from './InfoTip'
import { VERDICT_GLYPHS, toneGlyph } from './tones'
import styles from './VerdictChip.module.css'

export const TONE_CLASS = {
  positive: 'tonePositive',
  negative: 'toneNegative',
  caution: 'toneCaution',
  neutral: 'toneNeutral',
  gold: 'toneGold',
}

const SIZE_CLASS = { sm: 'sizeSm', md: 'sizeMd' }

/**
 * A short, source-labelled statement about one thing (spec §3.3/§3.4).
 *
 * ⚠️ §12, NORMATIVE: the word "verdict" must NEVER appear in user-facing copy —
 * it is advice-flavoured. The INTERNAL component name keeps `VerdictChip`; the
 * strings you pass in say "Setup Grade", "Earnings Profile", "PREMIUM RICH",
 * "RAISED", "Upgrade". Never "verdict".
 *
 * SHAPE-CODED, NOT HUE-ONLY (§3.3): each tone renders a leading glyph
 * (▲ ▼ ◆ — ★) so the meaning survives colour-blindness, greyscale print and a
 * badly calibrated monitor. Override with `glyph` when the caller has a better
 * marker (e.g. ✓ for a beat); pass `glyph={null}` only if some other channel in
 * the same row already carries the shape.
 *
 * `info` adds the optional ⓘ (§3.4) — used for the partial-basis case
 * ("B+ · 3 of 4 inputs") and to link the methodology page (§12).
 *
 * Stamps `data-rk-identity="chip"` always (a verdict is a CHIP, never the
 * ring RatingCrown stamps `data-rk-identity="ring"` — §4.2, P2 asserts the two
 * never coexist for the same fact) and `data-rk-gold` when `tone="gold"` — the
 * I6 audit hook `testing/restraint.js` counts the latter toward the §3.1
 * one-gold-data-highlight-per-canvas budget.
 */
export default function VerdictChip({
  label,
  tone = 'neutral',
  size = 'md',
  glyph,
  info,
  className = '',
}) {
  if (label == null || label === '') return null

  // Normalised once: an unrecognised tone falls back to 'neutral' for both the
  // glyph AND the I6 gold data-highlight check below, so a bogus tone can
  // never be mistaken for the gold surface.
  const normalizedTone = TONE_CLASS[tone] ? tone : 'neutral'
  const toneCls = styles[TONE_CLASS[normalizedTone]]
  const sizeCls = styles[SIZE_CLASS[size] || SIZE_CLASS.md]
  const mark = glyph === undefined ? toneGlyph(normalizedTone) : glyph
  const tip = normalizeInfo(info)

  return (
    <span
      className={`${styles.chip} ${toneCls} ${sizeCls} ${className}`}
      data-rk-identity="chip"
      data-rk-gold={normalizedTone === 'gold' ? '' : undefined}
    >
      {mark != null && mark !== '' && (
        <span className={styles.glyph} data-testid="rk-chip-glyph" aria-hidden="true">
          {mark}
        </span>
      )}
      <span className={styles.label}>{label}</span>
      {tip?.text && (
        <InfoTip
          label={`About ${typeof label === 'string' ? label : 'this'}`}
          text={tip.text}
          href={tip.href}
          hrefLabel={tip.hrefLabel}
        />
      )}
    </span>
  )
}

export { VERDICT_GLYPHS }
