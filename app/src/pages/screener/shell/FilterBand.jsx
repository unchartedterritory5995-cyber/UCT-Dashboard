import styles from './FilterBand.module.css'

/* FilterBand — the measured universe distribution, ON SCREEN, under the control
 * a member is about to set a threshold on.
 *
 * 🔴 THE DEFECT THIS EXISTS FOR, ONE LAYER DOWN FROM THE LAST ONE. A 594-metric
 * benchmark scored this screener LAST in the honesty family — not because our
 * honesty machinery is weak but because it is INTERNAL. The fix for the column
 * descriptions was `ColumnDesc`; the fix for the blank filter box was
 * `distribution.py`, which measures p5/p25/p50/p75/p95 over our own rows and
 * ships them in `/api/screener/meta`. That payload then reached NO SURFACE:
 * `grep -rn 'distribution_basis|\.distribution' app/src` returned zero hits, so
 * a member opening /screener saw the identical blank box the benchmark measured.
 * Honest text nobody can read loses to weaker text on screen. This is the read.
 *
 * ⛔ IT WRITES NO THRESHOLD AND NO OPINION. Every number here is transcribed
 * from the payload; the heading is `basis.label` and the paragraph under the
 * rail's search box is `basis.note`, both verbatim from the server, because
 * `distribution.py` owns that wording and a second copy of it here is the
 * second-authority-over-one-value defect this repo keeps paying for. What this
 * file owns is the SHAPE — a grid, a coverage line, and one plain sentence per
 * refusal reason.
 *
 * ⛔ A REFUSAL RENDERS IN WORDS, NEVER AS A BLANK. `distribution.py`'s contract
 * is that "we hold nothing here" is a fact a member is entitled to, and a
 * refusal reason the UI silently drops breaks it exactly as badly as omitting
 * the column would. `REASONS` below is keyed on the backend's own constant
 * strings and `tests/test_screener_distribution.py::
 * test_every_refusal_reason_is_answered_in_words_by_the_filter_rail` reads those
 * constants off the module and fails BY NAME when one has no entry here. The
 * `default` branch is the belt to that test's braces: an unrecognised reason
 * prints itself rather than vanishing.
 *
 * ⛔ NO BAND WITHOUT ITS BASIS. `meta()` ships `distribution_basis: null`
 * exactly when the snapshot could not be read — in which case no band exists
 * either — so requiring both is not defensive coding, it is the rule that five
 * unlabelled numbers never reach a member's screen.
 */

// Compact enough for a 264px rail, and never lossy about magnitude: the exact
// value rides in `title` on every cell. Nearest-rank guarantees each of these
// is a value some symbol actually holds, so rounding is a display choice about
// a real number, not an invented one.
const compact = v => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `${(v / 1e12).toFixed(a >= 1e13 ? 0 : 1)}T`
  if (a >= 1e9) return `${(v / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`
  if (a >= 100) return v.toFixed(a >= 1000 ? 0 : 1)
  if (a >= 1) return v.toFixed(2)
  if (a === 0) return '0'
  return `${Number(v.toPrecision(2))}`
}

const withUnit = (v, unit) => {
  const s = compact(v)
  if (!unit) return s
  return unit === '$' ? `$${s}` : `${s}${unit}`
}

const count = n => (typeof n === 'number' ? n.toLocaleString('en-US') : '—')
const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')

// One plain sentence per refusal, built from the numbers the payload carries —
// including the published floor it fell under, so the member reads the rule and
// not just the verdict. Keys ARE `distribution.py`'s constants.
const REASONS = {
  no_data: () => 'Nothing in tonight’s snapshot holds a value here.',
  not_numeric: b =>
    `All ${count(b.non_null)} values here are non-numeric — there is no range to measure.`,
  binary: () => 'A yes/no flag — there is no range to measure.',
  too_few_levels: () =>
    'Too few distinct values to be a range — this reads as a category, not a scale.',
  no_spread: (b, unit) =>
    `Almost every symbol reads ${withUnit(b.saturated_at, unit)} — there is no spread to show.`,
  below_min_non_null: (b, unit, basis) =>
    `Only ${count(b.usable)} of ${count(b.universe)} symbols carry a value — under the ` +
    `${count(basis.min_non_null)} it takes to describe a range.`,
  below_coverage_floor: (b, unit, basis) =>
    `Only ${count(b.usable)} of ${count(b.universe)} symbols (${pct(b.usable, b.universe)}) ` +
    `carry a value — under the ${Math.round((basis.coverage_floor || 0) * 100)}% it takes ` +
    'before a range describes the universe.',
  column_absent: () => 'This snapshot does not hold this column yet.',
}

export default function FilterBand({ band, basis, unit }) {
  if (!band || !basis) return null

  if (band.refused) {
    const say = REASONS[band.refused]
    return (
      <p className={styles.refused} data-band={band.refused}>
        {say ? say(band, unit, basis) : `No range measured (${band.refused}).`}
      </p>
    )
  }

  const points = (basis.percentiles || []).map(p => [p, band[`p${p}`]])
  if (!points.length) return null
  // The emphasised point is the MIDDLE of whatever set the server published —
  // never the literal 50. A typed 50 here would be a second authority over
  // `PERCENTILES` and would quietly stop matching the day it grows deciles.
  const midPct = points[Math.floor(points.length / 2)][0]

  return (
    <div className={styles.band} data-band="measured">
      <div className={styles.head}>
        <span className={styles.label}>{basis.label}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
        <span className={styles.cover}>
          {count(band.usable)} of {count(band.universe)}
        </span>
      </div>
      {/* A definition list, not a table: a screen reader reads each percentile
          with its value as a pair without a caption anyone had to invent. The
          two-row column flow is CSS; the DOM order stays dt,dd,dt,dd… */}
      <dl className={styles.points}>
        {points.map(([p, v]) => (
          <div key={p} className={p === midPct ? styles.mid : undefined}>
            <dt>{p}%</dt>
            {/* ⚠️ BARE NUMBER, UNIT IN THE HEADING ONCE. Repeating it per cell
                was measured overflowing its 48px column on the 3-glyph units
                ("-3.85ATR" wants 53px) — five cells that bleed into each other
                is a measurement rendered as a smudge. */}
            <dd title={String(v)}>{compact(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
