// app/src/components/screener/CoverageLine.jsx
//
// ─── A SCREEN STATES ITS OWN COVERAGE (spec §6.3) ───────────────────────────
//
// ⭐ "3,742 evaluated · 3,699 answered · 2 dropped · 41 not computable — here
// they are." FOUR counts, because "we could not compute it" and "something
// broke" are different facts to a trader (controller resolution 5).
//
// ⛔ DO NOT COLLAPSE THEM TO MAKE THE LINE SHORTER. A screen that silently loses
// symbols returns fewer hits and looks like a quiet market. 43 dropped would
// tell a trader the screen is broken; 2 dropped and 41 short of history tells
// them what is true.
//
// ⛔ AND THE COUNT ALONE IS NOT THE ANSWER. Measured on the real 3,742-symbol
// universe, the phase's own acceptance formula returns
// `answered=0, not_computable=2615` — because `rs_rank` is NULL in all 3,589
// screener rows on this box. A line that rendered that as "0 matches" would be
// a lie a member would act on: it reads as a quiet market when the truth is we
// have no data. So when nothing could be answered and something could not be
// computed, this says so IN THOSE WORDS, above the counts.
//
// ⛔ `withheld` IS BESIDE THE FOUR, NEVER INSIDE THEM. A withheld symbol was
// never looked at, so folding it into `dropped` would claim a failure that did
// not happen, and folding it into `evaluated` would claim work that was not
// done. E-3's envelope keeps it out of the closing identity for that reason and
// so does this.

import UIcon from '../ui/UIcon'
import styles from './CoverageLine.module.css'

/** ⛔ AN EXPLICIT LOCALE. `toLocaleString()` with no argument formats to
 *  whatever the browser is set to, so the same screen would read `3,742` for one
 *  member and `3.742` for another — and the second one reads as a decimal. */
const n = (v) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US') : '—')

export default function CoverageLine({ coverage = null, max = 12 }) {
  if (!coverage) return null

  const evaluated = Number(coverage.evaluated)
  const answered = Number(coverage.answered)
  const dropped = Number(coverage.dropped)
  const notComputable = Number(coverage.not_computable)
  const withheld = Number(coverage.withheld)
  const symbols = Array.isArray(coverage.dropped_symbols) ? coverage.dropped_symbols : []

  // ⛔ THE RECEIPT MUST CLOSE, AND A UI THAT RENDERS ONE THAT DOES NOT IS THE
  // SAME DEFECT ONE LAYER UP. `scan_evaluator._assert_coverage_closes` refuses
  // to WRITE a receipt whose arithmetic is broken; this refuses to present one
  // as if it were sound.
  const closes = [evaluated, answered, dropped, notComputable].every(Number.isFinite)
    && answered + dropped + notComputable === evaluated

  return (
    <div className={styles.wrap}>
      {!closes && (
        <p className={styles.broken} role="alert" data-testid="coverage-broken">
          <UIcon name="warning" size={14} />
          This screen&rsquo;s coverage does not add up ({n(answered)} answered + {n(dropped)} dropped
          {' '}+ {n(notComputable)} not computable is not {n(evaluated)}), so the counts below
          {' '}cannot be trusted.
        </p>
      )}

      {closes && answered === 0 && notComputable > 0 && (
        <p className={styles.nodata} role="status" data-testid="coverage-nodata">
          <UIcon name="warning" size={14} />
          No symbol could be answered. {n(notComputable)} of {n(evaluated)} are missing the data
          {' '}this screen needs — that is a gap in what we hold, not a quiet market.
        </p>
      )}

      <p className={styles.line} data-testid="coverage-line">
        <span className={styles.count}>{n(evaluated)} evaluated</span>
        <span aria-hidden="true" className={styles.dot}>·</span>
        <span className={styles.count}>{n(answered)} answered</span>
        <span aria-hidden="true" className={styles.dot}>·</span>
        <span className={styles.count}>{n(dropped)} dropped</span>
        <span aria-hidden="true" className={styles.dot}>·</span>
        <span className={styles.count}>{n(notComputable)} not computable</span>
      </p>

      {Number.isFinite(withheld) && withheld > 0 && (
        // BESIDE, on its own line, and worded as breadth rather than failure.
        <p className={styles.withheld} data-testid="coverage-withheld">
          {n(withheld)} more were not looked at on your plan
          {coverage.withheld_reason ? ` (${coverage.withheld_reason})` : ''}.
        </p>
      )}

      {symbols.length > 0 && (
        <details className={styles.details} data-testid="coverage-dropped-symbols">
          <summary className={styles.summary}>Which ones</summary>
          <p className={styles.symbols}>
            {symbols.slice(0, max).map((s) => (typeof s === 'string' ? s : s?.ticker)).join(', ')}
            {symbols.length > max ? ` … and ${n(symbols.length - max)} more` : ''}
          </p>
        </details>
      )}
    </div>
  )
}
