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

  const toneCls = styles[TONE_CLASS[tone] || TONE_CLASS.neutral]
  const sizeCls = styles[SIZE_CLASS[size] || SIZE_CLASS.md]
  const mark = glyph === undefined ? toneGlyph(TONE_CLASS[tone] ? tone : 'neutral') : glyph
  const tip = normalizeInfo(info)

  return (
    <span className={`${styles.chip} ${toneCls} ${sizeCls} ${className}`}>
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
