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

/**
 * ⭐⭐ R-L — "EXACT" IS REDEFINED, NOT LOOSENED (owner ruling, 2026-09-12).
 *
 * An integer series compares EXACTLY **after the coarser side's granularity is
 * applied**. Anything the granularity does not explain is a real divergence.
 *
 * ⚰️ WHY. T5 compared four SPY volume bars and all four "differed". Two of them
 * differed by **25 and 11 shares**:
 *
 *     2026-09-10   ours 42,740,400   vendor 42,740,375   -25
 *     2026-09-09   ours 32,812,400   vendor 32,812,411   +11
 *
 * Our store QUANTISES SPY's volume to 100 shares and the vendor does not —
 * measured, not guessed: **5,000 of 5,000 SPY daily bars are multiples of 100**,
 * and 100% of every year back to 2002 over a 6,000-bar window. Both those deltas
 * are exactly what rounding to the nearest 100 produces. Under the old rule the
 * column could never agree, on any bar, for a reason that is not a disagreement
 * about the market.
 *
 * ⛔⛔ AND IT IS NOT A PROPERTY OF THE STORE — IT IS A PROPERTY OF THE SYMBOL AND
 * THE ERA, WHICH IS WHY THE UNIT IS DECLARED PER FIXTURE AND NEVER INFERRED.
 * AGEN, measured the same day: **1.1% multiples of 100 before 2024-04-12** (a
 * chance rate) and **100% of the 606 bars since**. Its last unrounded bar is
 * 2024-04-11. A comparator that sniffed the unit from the fixture in hand would
 * read AGEN's modern bars as rounded and its history as exact, and would be
 * describing a provider switch as a property of volume.
 *
 * ⛔ AND IT IS NOT A TOLERANCE. A tolerance says "close enough"; this says the
 * two sides are being asked the same question at the resolution the coarser one
 * can answer. Snapping BOTH sides to the unit and then demanding equality keeps
 * the comparison exact — a bar that differs by 101 shares still fails, and the
 * ~35,000-share deltas on the other two SPY bars still fail, which is the whole
 * point of not writing this as `abs(x - y) <= 100`.
 */
export const NO_GRANULARITY = 1

/** Snap to the nearest multiple of `unit`. `unit = 1` is the identity. */
export function quantise(value, unit = NO_GRANULARITY) {
  const u = Number(unit)
  if (!Number.isFinite(u) || u <= 1) return value
  return Math.round(value / u) * u
}

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
 * @param {number} [unit] the coarser side's granularity — R-L. `1` means both
 *        sides answer at full resolution and the comparison is bit-exact.
 *        ⛔ DECLARED, LIKE `kind`, AND FOR THE SAME REASON: "every bar here
 *        happens to be a multiple of 100" is not the same claim as "this store
 *        rounds to 100", and a comparator that inferred it would relax itself
 *        the first time a fixture's bars happened to line up.
 * @returns {{name, kind, n, compared, blanks, mismatches, maxRel, absAtMaxRel,
 *            worstBar, worstPair, ok, reason, roundedEqual, unit}}
 */
export function compareSeries(name, ours, theirs, kind = 'float', unit = NO_GRANULARITY) {
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
    // ⭐ R-L: pairs that agree only once the granularity is applied.
    roundedEqual: 0,
    unit,
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
      // ⭐ R-L: both sides at the coarser side's resolution, then EXACT. See
      // `quantise` for why this is a redefinition and not a tolerance.
      const qx = quantise(x, unit)
      const qy = quantise(y, unit)
      if (qx !== qy) {
        row.mismatches += 1
        if (row.worstBar < 0) { row.worstBar = i; row.worstPair = [x, y] }
      } else if (x !== y) {
        // ⛔ EXPLAINED IS NOT IDENTICAL, AND THE TABLE SAYS SO. A run where every
        // bar needed the granularity to agree is a different fact from one where
        // none did — the first is a resolution difference and the second is two
        // stores that actually match. Counting them the same would let a
        // provider change quietly widen what "exact" means.
        row.roundedEqual += 1
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
  return spec.map(({ name, ours, theirs, kind, unit }) =>
    compareSeries(name, ours, theirs, kind, unit))
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
    // ⭐ AN INT ROW SPENDS THOSE TWO COLUMNS ON THE THING THAT DECIDES IT: the
    // granularity the comparison ran at, and how many pairs needed it. `— / —`
    // there said nothing, and "AGREES" with no unit beside it cannot be told
    // apart from "AGREES" at full resolution.
    const c6 = r.kind === 'int'
      ? (r.unit > 1 ? `unit ${r.unit}` : 'exact')
      : r.maxRel.toExponential(3)
    const c7 = r.kind === 'int'
      ? (r.roundedEqual ? `rounded ${r.roundedEqual}` : 'no rounding')
      : r.absAtMaxRel.toExponential(3)
    lines.push(`${pad(r.name, 24)} ${pad(r.kind, 6)} ${pad(r.n, 6)} ${pad(r.compared, 6)} `
      + `${pad(r.blanks, 6)} ${pad(c6, 12)} `
      + `${pad(c7, 14)} `
      + `${pad(r.worstBar < 0 ? '—' : r.worstBar, 10)} ${r.ok ? 'AGREES' : r.reason}`)
  }
  return lines.join('\n')
}
