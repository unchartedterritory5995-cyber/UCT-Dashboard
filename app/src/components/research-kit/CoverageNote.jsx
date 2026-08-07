// app/src/components/research-kit/CoverageNote.jsx
import InfoTip from './InfoTip'
import styles from './CoverageNote.module.css'

/**
 * Says how much of the UCT Composite a given score actually measured.
 *
 * WHY THIS EXISTS
 *   `_composite` renormalizes over the components that exist, which is the
 *   right maths — a company with no EPS-growth figure is not a company with
 *   the WORST EPS growth. But it means the score is computed on a different
 *   basis per ticker, and a bare "70" discloses none of that. Sampled live
 *   2026-08-06 across 40 liquid names, 8 (20%) had no EPS rating at all, and
 *   EPS carries the joint-largest weight (0.25) — so one ticker in five was
 *   rendering a hero number built on 75% of the intended basis, typeset
 *   identically to a fully-informed one.
 *
 *   The gap mostly cannot be backfilled away: 5 of those 8 had a NEGATIVE
 *   prior-year earnings base, which makes a growth percentage mathematically
 *   undefined rather than missing. Inventing a value would be worse than the
 *   gap; disclosing it is the honest move — the same principle as the earnings
 *   modal's `history_unresolved`.
 *
 * RENDERS NOTHING AT FULL COVERAGE. This is a caveat, not a badge; a note on
 * every ticker would be noise and would stop reading as a signal on the ones
 * that need it.
 */

/** Display names for the composite's inputs. Keys match `_COMPOSITE_WEIGHTS`
 *  in `api/services/research/ratings.py` — the server names them, this maps
 *  them to the same labels the component grid already uses. */
export const COMPONENT_LABELS = {
  eps: 'EPS',
  rs: 'Rel Strength',
  growth: 'Growth',
  smr: 'SMR',
  accdis: 'Acc/Dis',
  value: 'Value',
}

export function coverageText(coverage) {
  if (!coverage || typeof coverage.counted !== 'number') return null
  const { counted, of } = coverage
  if (!of || counted >= of) return null          // full basis → say nothing
  return `Measured on ${counted} of ${of} inputs`
}

export function missingText(coverage) {
  const missing = (coverage?.missing || []).map((k) => COMPONENT_LABELS[k] || k)
  if (!missing.length) return ''
  const list = missing.length === 1
    ? missing[0]
    : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
  return `${list} ${missing.length === 1 ? 'is' : 'are'} unavailable for this company, `
    + 'so the composite was re-weighted across the inputs that remain. '
    + 'A growth rating is undefined — not merely missing — when the '
    + 'prior-year figure was a loss, which is the most common reason here. '
    + 'Compare this score with others cautiously.'
}

export default function CoverageNote({ coverage, className }) {
  const text = coverageText(coverage)
  if (!text) return null
  return (
    <div className={[styles.note, className].filter(Boolean).join(' ')}>
      <span>{text}</span>
      <InfoTip text={missingText(coverage)} label="Why this score is partial" />
    </div>
  )
}
