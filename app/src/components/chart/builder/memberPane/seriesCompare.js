// app/src/components/chart/builder/memberPane/seriesCompare.js
//
// ─── ⭐⭐ T5 — PER-SERIES AGREEMENT WITH THE VENDOR, ON THE OWNER'S TERMS ────
//
// Owner ruling, 2026-09-12: *"integers exact, floats max rel ≤ 1e-9 with abs
// beside, per-series table."* Three separate instructions, and each one is here
// because the obvious single rule gets one of the three cases wrong:
//
//   * AN INTEGER SERIES IS EXACT OR IT IS WRONG. A volume of 45,510,000 against
//     45,510,001 passes any relative tolerance you would pick for a float and is
//     a different number of shares. Tolerance on a count is not tolerance, it is
//     a hidden rounding rule.
//   * A FLOAT IS COMPARED RELATIVELY, because the same engine on the same bars
//     must agree to the last bit of a double and the magnitudes here span volume
//     (1e8) and a ratio (1e0). An ABSOLUTE bound would be vacuous at one end and
//     unmeetable at the other.
//   * AND THE ABSOLUTE ERROR IS REPORTED BESIDE IT, never instead of it: a
//     relative figure alone cannot be sanity-checked by a human reading the
//     table, and 3e-10 relative on a volume column is 0.015 shares.
//
// ⛔ IT REPORTS, IT DOES NOT ASSERT. The verdict per series is a value the caller
// tests, so the same function serves the rail and the report. A comparator that
// threw could not print the table the ruling asks for.

/** The relative bound the ruling names. */
export const MAX_REL = 1e-9

/** A value that is present in neither series — the two blanks agree. */
const blank = (v) => v === null || v === undefined
  || (typeof v === 'number' && Number.isNaN(v))

/**
 * One series against one series.
 *
 * ⛔ `kind` IS DECLARED BY THE CALLER, NOT SNIFFED. "Every value happens to be a
 * whole number on these 600 bars" is not the same claim as "this column counts
 * things", and a comparator that guessed would silently relax the moment a
 * fixture happened to carry a fractional bar.
 *
 * @param {string} name
 * @param {Array<number|null>} ours
 * @param {Array<number|null>} theirs the vendor's reading
 * @param {'int'|'float'} kind
 * @returns {{name, kind, n, compared, blanks, mismatches, maxRel, absAtMaxRel,
 *            worstBar, worstPair, ok, reason}}
 */
export function compareSeries(name, ours, theirs, kind = 'float') {
  const a = Array.isArray(ours) ? ours : []
  const b = Array.isArray(theirs) ? theirs : []
  const row = {
    name,
    kind,
    n: b.length,
    compared: 0,
    blanks: 0,
    mismatches: 0,
    maxRel: 0,
    absAtMaxRel: 0,
    worstBar: -1,
    worstPair: null,
    ok: false,
    reason: null,
  }
  if (a.length !== b.length) {
    // ⛔ A LENGTH MISMATCH IS NOT A TOLERANCE QUESTION. Comparing the overlap
    // would quietly grade a 600-bar series against a 599-bar one and call the
    // missing bar agreement.
    row.reason = `length: ours ${a.length}, vendor ${b.length}`
    return row
  }
  for (let i = 0; i < b.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (blank(x) && blank(y)) { row.blanks += 1; continue }
    if (blank(x) !== blank(y)) {
      // ⛔ A BLANK AGAINST A NUMBER IS A MISMATCH, NOT A SKIP. Warm-up that ends
      // one bar early is exactly the defect a parity run exists to catch, and
      // skipping the pair is how it hides.
      row.mismatches += 1
      if (row.worstBar < 0) { row.worstBar = i; row.worstPair = [x ?? null, y ?? null] }
      continue
    }
    row.compared += 1
    if (kind === 'int') {
      if (x !== y) {
        row.mismatches += 1
        if (row.worstBar < 0) { row.worstBar = i; row.worstPair = [x, y] }
      }
      continue
    }
    const abs = Math.abs(x - y)
    // ⭐ THE DENOMINATOR IS THE VENDOR'S MAGNITUDE, with a floor of 1 so a
    // vendor value of 0 does not make every difference infinitely relative.
    // A difference against zero is then read as an ABSOLUTE one, which is the
    // only meaningful reading there.
    const rel = abs / Math.max(Math.abs(y), 1)
    if (rel > row.maxRel) { row.maxRel = rel; row.absAtMaxRel = abs; row.worstBar = i; row.worstPair = [x, y] }
  }
  if (row.reason === null) {
    if (row.mismatches > 0) {
      row.reason = kind === 'int'
        ? `${row.mismatches} integer values differ`
        : `${row.mismatches} bars are blank on one side only`
    } else if (row.maxRel > MAX_REL) {
      row.reason = `max relative error ${row.maxRel.toExponential(3)} exceeds ${MAX_REL.toExponential(0)}`
    }
  }
  row.ok = row.reason === null
  return row
}

/** Every series, as the table the ruling asks for. */
export function compareAll(spec) {
  return spec.map(({ name, ours, theirs, kind }) => compareSeries(name, ours, theirs, kind))
}

/** The table as text, for the report and for a failure message.
 *  ⭐ ONE RENDERER, so the report a human reads and the sentence a red test
 *  prints cannot describe the same run differently. */
export function renderTable(rows) {
  const pad = (v, n) => String(v).padEnd(n)
  const lines = [
    `${pad('series', 24)} ${pad('kind', 6)} ${pad('bars', 6)} ${pad('cmp', 6)} `
    + `${pad('blank', 6)} ${pad('max rel', 12)} ${pad('abs there', 14)} ${pad('worst bar', 10)} verdict`,
  ]
  for (const r of rows) {
    lines.push(`${pad(r.name, 24)} ${pad(r.kind, 6)} ${pad(r.n, 6)} ${pad(r.compared, 6)} `
      + `${pad(r.blanks, 6)} ${pad(r.kind === 'int' ? '—' : r.maxRel.toExponential(3), 12)} `
      + `${pad(r.kind === 'int' ? '—' : r.absAtMaxRel.toExponential(3), 14)} `
      + `${pad(r.worstBar < 0 ? '—' : r.worstBar, 10)} ${r.ok ? 'AGREES' : r.reason}`)
  }
  return lines.join('\n')
}
