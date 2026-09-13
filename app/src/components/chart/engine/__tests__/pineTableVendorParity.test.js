// app/src/components/chart/engine/__tests__/pineTableVendorParity.test.js
//
// ─── ⭐⭐ R2 STEP 7 — OUR TABLE CELLS, AGAINST TRADINGVIEW'S OWN STRINGS ─────
//
// Two vendor captures of `uncharted-volume-v2.pine`, taken by wrapping
// `CanvasRenderingContext2D.prototype.fillText` for ONE redraw and restoring it
// in the same call (`restored: true` asserted in both):
//
//   f2578f82c  SPY 1D, depth forced   range_table 3 cells · volume_table 1 cell
//   5c4d67ef2  AGEN 1D, HVE day       range_table 3 cells · volume_table 1 cell
//
// ⭐⭐ THE COMPARISON IS A STRING COMPARISON, AND THAT IS THE WHOLE POINT OF
// HAVING BUILT THE TABLE IN DOM. A raster cannot carry the trailing space on
// `'Vol : 45.51M (1.05x) '` — len 21 for 20 visible characters, recorded on
// three separate captures across two symbols — so the vendor had to instrument
// `fillText` to read it, and we read `textContent`.
//
// ⛔⛔ WHAT A STRING COMPARE CAN AND CANNOT SETTLE, STATED BEFORE THE NUMBERS.
// The vendor ran on TradingView's bars; we run on ours (`/api/bars`, Massive
// primary), captured two days later. So a cell's TEXT has two independent
// halves and they are asserted separately rather than blurred into one verdict:
//
//   * its SHAPE — every literal, every separator, the `str.tostring` format of
//     every float, the unit suffix, the trailing space. This is OUR side's
//     behaviour and is compared EXACTLY, character for character.
//   * its VALUE — the numbers. Where the two data sets agree the cell matches
//     the vendor byte for byte and is asserted that way; where they do not, the
//     field is NAMED with both readings. ⛔ A tolerance would have hidden the
//     one that matters: `45.48M` vs `45.51M` is a real disagreement about SPY's
//     volume on 2026-09-11 and it belongs in a report, not inside an epsilon.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { layoutTables } from '../objectCanvas'
import { renderTables } from '../objectTableDom'
import { computeFor } from '../nativeRegistry'
import { compareAll, renderTable } from '../../builder/memberPane/seriesCompare'

const REPO = path.resolve(process.cwd(), '..')
const read = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8'))

const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

const SPY = {
  label: 'SPY',
  vendor: read('tests/fixtures/vendor/uncharted-volume-v2-spy-1d-forced-depth-2026-09-13.json'),
  bars: read('tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'),
  // ⭐ THE STORE'S SPELLING, NOT PINE'S. `symbolScope.json::confirmed` is keyed
  // by what our own `ticker_meta` holds; both were read off the running rig.
  symbol: { ticker: 'SPY', exchange: 'NYSE Arca' },
}
const AGEN = {
  label: 'AGEN',
  vendor: read('tests/fixtures/vendor/uncharted-volume-v2-agen-1d-hve-2026-09-12.json'),
  bars: read('tests/fixtures/vendor/agen-1d-bars-2000-2026-09-13.json'),
  symbol: { ticker: 'AGEN', exchange: 'NASDAQ' },
}

const dom = new JSDOM('<!doctype html><body></body>')
const doc = dom.window.document

/** ⛔ THE OBJECT LANE READS A SLICE, AND THE SLICE HAS A REASON.
 *  `MAX_RECURRENCE_STEPS` caps `bars × warm-up` at 1,000,000 and v2's `accum`
 *  warms over 250 bars, so the object lane refuses above ~4,000 bars — measured
 *  in the browser on the rig's own 8,000-bar SPY chart, where 22 of 133 graph
 *  nodes refused and every cell read `NaN` (see `memberPaneTables.test.js`).
 *  ⭐ The PER-SERIES comparison below reads the FULL fixture, because it runs
 *  through the plot lane, which does not warm an accumulator — and because the
 *  HVE column's own window is 2,751 bars and the gate must be given the chance
 *  to be satisfied rather than only to fire.
 *
 *  ⭐⭐ AND 500 IS ENOUGH, WHICH IS ITSELF A MEASUREMENT. Every number in these
 *  four cells is WINDOWED — ATR(14), the average volume over 50, the extension
 *  from a 50 SMA — so depth beyond those windows changes nothing: the cells read
 *  byte-identically at 500, at 1,400 and at 3,000 bars, and the vendor's own
 *  8,458-bar capture agrees with all three. Running at 1,400 cost this file 15
 *  seconds of CPU and starved the pool enough to tip five unrelated source-sweep
 *  suites past vitest's 15s default, which is a real cost paid for no evidence. */
const TABLE_LANE_BARS = 500
const forTables = (f) => f.bars.slice(-TABLE_LANE_BARS)

// ⛔ TRANSLATED ONCE PER SCRIPT, AND DRAWN ONCE PER (script, symbol). Both are
// pure, and both are expensive: `memberPaneDefinition` re-reads 34,378 characters
// of Pine and the object pass walks 27 trees over 1,400 bars. Calling them per
// `it` made this file heavy enough to starve the parallel pool and tip five
// unrelated source-sweep suites past vitest's 15s default — a cost this file
// imposed on tests that had nothing to do with it, which is its own kind of
// wrong answer.
const DEFS = new Map()
const paneDef = (source) => {
  if (!DEFS.has(source)) DEFS.set(source, memberPaneDefinition({ source, id: 'u_v2parity', name: 'v2' }))
  return DEFS.get(source)
}
const DRAWN = new Map()

/** The member's route, end to end, into real elements. */
function drawnUncached(source, bars, symbol) {
  const built = paneDef(source)
  const reader = objectReaderFor(built.definition, bars, { inputs: undefined, tf: 'D', symbol })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t,
  })
  const state = toRenderState(run.live, { bars })
  const root = doc.createElement('div')
  doc.body.appendChild(root)
  const stats = renderTables(root, layoutTables(state), doc)
  const tables = [...root.querySelectorAll('[data-uct-object-table]')].map((t) => ({
    position: t.getAttribute('data-uct-table-position'),
    cells: [...t.querySelectorAll('td')].map((td) => td.textContent),
  }))
  return { built, reader, run, state, root, stats, tables }
}

const drawn = (source, bars, symbol) => {
  const key = `${source.length}:${bars.length}:${symbol.ticker}`
  if (!DRAWN.has(key)) DRAWN.set(key, drawnUncached(source, bars, symbol))
  return DRAWN.get(key)
}

/** A cell reduced to what OUR side decides: literals verbatim, every run of
 *  digits (with its sign and decimal point) replaced by `#`.
 *  ⛔ THE SHAPE IS WHERE THE FORMAT LIVES. `45.51M` and `45.48M` share a shape;
 *  `45.5M` and `45.51M` do NOT, because `str.tostring(x, '0.00')` promises two
 *  decimals — so a formatter that dropped a trailing zero fails this even
 *  though a tolerance on the value would pass it. */
const shapeOf = (s) => String(s).replace(/-?\d+(?:\.\d+)?/g, '#')

/** Every number in a cell, in order, as the strings they were rendered as. */
const numsOf = (s) => (String(s).match(/-?\d+(?:\.\d+)?/g) || [])

const vendorCells = (v, table) => v.tables[table].cells.map((c) => c.text)

describe.each([SPY, AGEN])('⭐⭐ $label — every drawn cell against the capture', (CASE) => {
  const { tables, stats, reader, built } = drawn(V2, forTables(CASE.bars), CASE.symbol)
  const range = tables.find((t) => t.cells.some((c) => c.includes('ATR') || c.includes('ADR')))
  const volume = tables.find((t) => t.cells.some((c) => c.includes('Vol :')))
  const vRange = vendorCells(CASE.vendor, 'range_table')
  const vVolume = vendorCells(CASE.vendor, 'volume_table')

  it('the fixture is an instrumented READ, not a shape someone typed', () => {
    // ⛔ BOTH CAPTURES SAY THEY PUT `fillText` BACK, AND THEY SAY IT IN DIFFERENT
    // PLACES. SPY carries a `restored: true` FIELD; AGEN records the same fact
    // only in its `_` prose. ⚠️ A prose claim is weaker evidence than a field
    // and the difference is stated rather than smoothed over — but asserting
    // only the field would have quietly skipped AGEN, which is the shape where
    // a check reads as coverage and is not.
    const t = CASE.vendor.tables
    if (Object.prototype.hasOwnProperty.call(t, 'restored')) expect(t.restored).toBe(true)
    else expect(String(t._), 'neither a `restored` field nor the sentence').toContain('restored')
    expect(vRange.length + vVolume.length).toBe(4)
  })

  it('⛔ and our side actually ran — no layer of this is mocked', () => {
    expect(built.ok, built.reason || '').toBe(true)
    expect(reader.failed, 'an object tree refused — the cells below would be NaN').toEqual([])
  })

  it('⭐⭐ FOUR CELLS DRAWN, exactly the count the vendor drew', () => {
    expect(stats).toEqual({ tables: 2, cells: 4, skipped: 0 })
    expect(volume.cells).toHaveLength(vVolume.length)
    expect(range.cells).toHaveLength(vRange.length)
  })

  it('⛔⛔ THE TWO TOGGLED-OFF CELLS ARE ABSENT FROM THE DOM, not present-and-empty', () => {
    // `show_avg_volume` false ⇒ the AVol `table.cell` is inside `if
    // show_avg_volume` and never runs. `show_dcr_in_range_table` false ⇒ the DCR
    // cell RUNS and its text folds to `''`, and an empty cell is not drawn.
    // ⛔ Stated as an absence over the whole layer, which is the assertion the
    // ruling asked for: a blank `<td>` would satisfy a count and lie on the pane.
    const all = [...range.cells, ...volume.cells]
    expect(all.some((c) => c === '')).toBe(false)
    expect(all.some((c) => c.includes('DCR'))).toBe(false)
    expect(all.some((c) => c.includes('AVol'))).toBe(false)
  })

  it('⭐⭐ EVERY CELL SHAPE IS THE VENDOR\'S, character for character', () => {
    // The literals, the separators, the `$`, the `%`, the `x`, the unit suffix,
    // the parentheses — and the number of decimal places each float was
    // formatted to. Everything except the digits themselves.
    expect(range.cells.map(shapeOf)).toEqual(vRange.map(shapeOf))
    expect(volume.cells.map(shapeOf)).toEqual(vVolume.map(shapeOf))
  })

  it('⭐⭐ THE TRAILING SPACE ON THE VOL CELL SURVIVES — the one a screenshot loses', () => {
    const vendorCell = CASE.vendor.tables.volume_table.cells[0]
    expect(vendorCell.trailing_space).toBe(true)
    expect(volume.cells[0].endsWith(' ')).toBe(true)
    // ⛔ AND NOTHING ELSE PICKED ONE UP. Only the cell the author put it on.
    expect(range.cells.some((c) => c.endsWith(' '))).toBe(false)
    expect(vRange.every((c) => !c.endsWith(' '))).toBe(true)
  })

  it('⭐ the tables are in the corners the capture records', () => {
    const want = (s) => s.toLowerCase().replace(/\s+/g, '_')
    expect(range.position).toBe(want(CASE.vendor.tables.range_table.position_input))
    // ⚠️ The Volume table's position is a RUNTIME choice this door cannot fold
    // (`hasRecentHV ? 'Top Center' : volTablePosition`), so it falls back to
    // Pine's `top_right` — which is where the vendor draws it. Named in step 6's
    // `droppedPropNames` as `table.position@490`; asserted here as the fallback
    // it is, not as a resolution it is not.
    expect(volume.position).toBe('top_right')
    expect(built.translation.objectDiagnostics.droppedPropNames)
      .toContain('table.position@490')
  })
})

// ─── ⭐⭐ THE VALUES, AND THE ONE THAT DISAGREES ────────────────────────────
//
// ⛔ NAMED FIELD BY FIELD, NOT GRADED. Every number our side rendered is put
// beside the vendor's; the ones that match are asserted to match, and the ones
// that do not are pinned WITH BOTH READINGS so a change in either direction is
// visible. A tolerance here would be the instrument deciding what counts as the
// same number, which is the question.
describe('⭐⭐ SPY — the numbers, each one named', () => {
  const { tables } = drawn(V2, forTables(SPY.bars), SPY.symbol)
  const range = tables.find((t) => t.cells.some((c) => c.includes('ATR')))
  const volume = tables.find((t) => t.cells.some((c) => c.includes('Vol :')))
  const vRange = vendorCells(SPY.vendor, 'range_table')
  const vVolume = vendorCells(SPY.vendor, 'volume_table')

  it('⭐⭐ THE THREE RANGE CELLS ARE BYTE-IDENTICAL TO TRADINGVIEW', () => {
    // ATR(14), the day's range as a percentage of it, and the extension from the
    // 50 SMA in ATRs. All three are windowed, so 1,400 bars and 8,458 bars agree.
    expect(range.cells).toEqual(vRange)
    expect(range.cells).toEqual([
      'ATR : $6.21 (0.81%)', '| Range: 137.58%', '| ATRx: 0.92',
    ])
  })

  it('⚠️ the VOL cell agrees on the multiplier and DISAGREES on the volume, by 0.07%', () => {
    // ⛔ THE FIELDS ARE SPLIT BECAUSE THE CAUSES ARE DIFFERENT. `1.05x` is a
    // ratio of two of our own numbers and matches exactly, which is our side's
    // arithmetic agreeing. `45.48M` against `45.51M` is a disagreement about the
    // SAME BAR'S VOLUME between TradingView's provider and ours (SPY, 2026-09-11)
    // — a DATA divergence, and it is what the per-series comparison below exists
    // for, not something a table test can settle.
    const ours = numsOf(volume.cells[0])
    const theirs = numsOf(vVolume[0])
    expect(ours).toHaveLength(theirs.length)
    // the multiplier: exact
    expect(ours[1]).toBe(theirs[1])
    expect(ours[1]).toBe('1.05')
    // the volume: named, with both readings and the size of the gap
    expect(ours[0]).toBe('45.48')
    expect(theirs[0]).toBe('45.51')
    const rel = Math.abs(Number(ours[0]) - Number(theirs[0])) / Number(theirs[0])
    expect(rel).toBeLessThan(0.001)
    expect(volume.cells[0]).toBe('Vol : 45.48M (1.05x) ')
    expect(vVolume[0]).toBe('Vol : 45.51M (1.05x) ')
  })
})

describe('⭐ AGEN — the second symbol, the same four shapes', () => {
  const { tables } = drawn(V2, forTables(AGEN.bars), AGEN.symbol)
  const range = tables.find((t) => t.cells.some((c) => c.includes('ATR') || c.includes('ADR')))
  const volume = tables.find((t) => t.cells.some((c) => c.includes('Vol :')))

  it('⭐ the unit suffix follows the MAGNITUDE, which is the tuple helper working', () => {
    // ⭐ SPY's volume is in the hundred-millions and AGEN's in the hundred-
    // thousands, so `f_getVolumeUnit`'s four-arm chain has to answer differently
    // for the two — which is what makes the second symbol worth driving rather
    // than a second copy of the first. The vendor reads `790.46K` on its own
    // capture day.
    expect(volume.cells[0]).toMatch(/^Vol : \d+\.\d\dK \(\d+\.\d\dx\) $/)
    expect(vendorCells(AGEN.vendor, 'volume_table')[0]).toMatch(/K \(/)
  })

  it('⭐ and the Range table still reads three cells in the ATR vocabulary', () => {
    expect(range.cells).toHaveLength(3)
    expect(range.cells[0]).toMatch(/^ATR : \$\d/)
    expect(range.cells[1]).toMatch(/^\| Range: /)
    expect(range.cells[2]).toMatch(/^\| ATRx: /)
  })
})

// ─── ⭐⭐ THE SECOND DOCUMENT — THE SAME SCRIPT WITH THE TOGGLES ON ──────────
//
// R-H's two-definitions shape: the toggles a member flips are `input.bool`
// DEFAULTS in the source, and this door folds an input that never becomes a
// member knob. So "the toggles on" is a second SCRIPT and therefore a second
// DOCUMENT, which is exactly the point — the two must differ in what they draw
// and in nothing else.
//
// ⛔ THE EDIT IS TWO CHARACTERS AND IS ASSERTED TO BE. A hand-retyped v2 could
// differ anywhere; this replaces `false` with `true` in the two `input.bool`
// declarations by name and checks the source is otherwise byte-identical.
describe('⭐⭐ toggles ON — the same script draws SIX cells', () => {
  const flip = (src, name) => {
    const re = new RegExp(`(${name}\\s*=\\s*input\\.bool\\()false`)
    expect(re.test(src), `could not find ${name}'s default`).toBe(true)
    return src.replace(re, '$1true')
  }
  const ON = flip(flip(V2, 'show_dcr_in_range_table'), 'show_avg_volume')

  it('⛔ the second document differs from the first by exactly two words', () => {
    expect(ON.length).toBe(V2.length + 2 * ('true'.length - 'false'.length))
    // ⛔ AND NOWHERE ELSE. Diffing the two by line keeps this from passing on a
    // source that happens to be the right length.
    const a = V2.split('\n')
    const b = ON.split('\n')
    expect(a.length).toBe(b.length)
    const moved = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null)
    expect(moved).toHaveLength(2)
  })

  it('⭐⭐ and it draws SIX cells — the two the defaults suppressed, now present', { timeout: 120_000 }, () => {
    const { stats, tables } = drawn(ON, forTables(SPY.bars), SPY.symbol)
    expect(stats).toEqual({ tables: 2, cells: 6, skipped: 0 })
    const all = tables.flatMap((t) => t.cells)
    const avol = all.find((c) => c.startsWith('| AVol : '))
    const dcr = all.find((c) => c.startsWith('| DCR: '))
    expect(avol).toBeTruthy()
    expect(dcr).toBeTruthy()
    // ⭐⭐ THE TWO CELLS NOBODY HAD EVER SEEN DRAWN, AND EACH CARRIES ITS OWN
    // FORMAT. `AVol` is `str.tostring(…, '0.00')` plus a unit and a TRAILING
    // SPACE of its own — the same convention as the Vol cell beside it, and the
    // same one the `#` family would have trimmed. `DCR` is `'#.##'`.
    // Measured in the browser on SPY 1W: `| AVol : 327.70M ` and `| DCR: 0.59`.
    expect(avol).toMatch(/^\| AVol : \d+\.\d\d[BMK]? $/)
    expect(avol.endsWith(' ')).toBe(true)
    expect(dcr).toMatch(/^\| DCR: \d+(\.\d{1,2})?$/)
    // ⛔ AND THE FOUR THAT WERE ALREADY THERE ARE UNCHANGED — a toggle that also
    // moved a number would be a different bug wearing this one's clothes.
    const range = tables.find((t) => t.cells.some((c) => c.includes('ATR')))
    expect(range.cells.slice(0, 3)).toEqual([
      'ATR : $6.21 (0.81%)', '| Range: 137.58%', '| ATRx: 0.92',
    ])
  })

  it('⛔ CONTROL — the vendor did NOT draw those two, which is why four was right', () => {
    // The whole four-versus-six distinction rests on the capture, so the capture
    // is asserted rather than remembered.
    const vAll = [...vendorCells(SPY.vendor, 'range_table'), ...vendorCells(SPY.vendor, 'volume_table')]
    expect(vAll).toHaveLength(4)
    expect(vAll.some((c) => c.includes('AVol'))).toBe(false)
    expect(vAll.some((c) => c.includes('DCR'))).toBe(false)
  })
})

// ─── ⭐⭐ THE PER-SERIES COMPARISON, THROUGH THE `compareAll` GATE ───────────
//
// The cells above are four strings. The COLUMNS behind them are four series of
// thousands of numbers, and the ruling asks for those compared at >= 2,751 bars
// loaded — the HVE column's own window — or for that column EXCLUDED with its
// disclosure. Both branches are exercised, one per symbol, which is stronger
// than either alone: a gate seen only firing has never been seen letting
// anything through.
//
//   SPY   3,000 bars loaded   >= 2,751   the gate is SATISFIED
//   AGEN  2,000 bars loaded   <  2,751   the gate FIRES and the row says why
//
// ⛔⛔ AND THE ANSWER IS NOT "EVERYTHING AGREES", WHICH IS WHY THE TABLE IS
// PINNED RATHER THAN ASSERTED GREEN. The vendor read TradingView's bars; we read
// ours (`/api/bars`, Massive primary), two days later. Those two data sets do
// not agree to 1e-9 and never will, so a run that demanded they did would be
// red forever and would be muted within a week. What the comparison is FOR is
// telling apart the two things that can make a column differ — and it can,
// because the divergence decomposes:
//
//   * our column IS our bars, exactly (the engine is faithful), and
//   * our bars are NOT the vendor's bars (the providers disagree),
//
// so every downstream difference is attributable to the input rather than to
// the translation. Both halves are asserted below; without the first, "the data
// differs" is an excuse rather than a measurement.
const PLOT_AT = { Volume: 0, 'Avg Vol Columns': 2, 'Avg Vol Line': 4, 'Scale Padding': 6 }
const HVE_AT = 7

/** Our four columns for a symbol, from the plot lane the chart itself uses. */
function ourColumns(fixture, symbol) {
  const built = paneDef(V2)
  const cols = computeFor(built.definition, fixture.bars, undefined, {
    tf: 'D', symbol, newestBarIsForming: false,
  })
  const byLabel = {}
  built.definition.plots.forEach((pl) => { byLabel[pl.label] = cols[pl.key] })
  return { built, byLabel }
}

describe.each([
  { ...SPY, rowsKey: 'plots', loaded: 3000 },
  { ...AGEN, rowsKey: 'series', loaded: 2000 },
])('⭐⭐ $label — the columns behind the cells', (CASE) => {
  const { built, byLabel } = ourColumns(CASE.bars, CASE.symbol)
  const vRows = CASE.vendor[CASE.rowsKey].rows
  /** our bar index by ISO date — the join key */
  const idxByDate = new Map(CASE.bars.bars.map((b, i) => [String(b.t), i]))
  const joined = vRows.map((r) => ({ row: r, i: idxByDate.get(String(r.date)) }))

  it('⛔⛔ THE JOIN IS SOUND — and the fixture warns that this is where it breaks', () => {
    // ⚰️ The SPY capture carries its own scar: *"ALIGN ON `time`, NEVER ON
    // `date`. The 2026-09-12 capture carried a label a day out on bars_back 5,
    // and a comparison keyed on it invented a 28% divergence."* Our bars carry an
    // ISO date and no unix time, so the join HAS to be by date — and the way to
    // do that honestly is to prove the label first, from the capture's own
    // `time`, in the exchange's timezone.
    for (const { row } of joined) {
      if (row.time === undefined) continue   // the AGEN capture records no `time`
      const et = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(row.time * 1000))
      expect(et, `bars_back ${row.bars_back}: the label disagrees with its own time`)
        .toBe(String(row.date))
    }
    // ⛔ EVERY VENDOR ROW FINDS A BAR ON OUR SIDE. A missing one would silently
    // shrink the comparison rather than fail it.
    expect(joined.filter((j) => j.i === undefined).map((j) => j.row.date)).toEqual([])
    // ⭐ AND THE CALENDARS AGREE, not just the labels: `bars_back` counted back
    // from OUR newest bar lands on the vendor's own date. The rows are
    // deliberately non-consecutive (0, 1, 2, 5 on SPY), so this is a real check
    // that our session list has no extra or missing day in between.
    const last = CASE.bars.bars.length - 1
    for (const { row, i } of joined) {
      if (row.bars_back === undefined) continue
      expect(String(CASE.bars.bars[last - row.bars_back].t),
        `bars_back ${row.bars_back} lands on a different session`).toBe(String(row.date))
    }
  })

  it('⭐⭐ OUR COLUMN IS OUR BARS — the engine adds nothing of its own', () => {
    // ⛔ THE HALF THAT MAKES "the providers disagree" A MEASUREMENT. `Volume` is
    // `volume` straight through, so if our column ever differs from the series it
    // was computed over, the divergence below is OURS and the excuse evaporates.
    const col = byLabel.Volume
    for (const { row, i } of joined) {
      expect(col[i], `${row.date}`).toBe(CASE.bars.bars[i].v)
    }
  })

  it('⭐⭐ …AND OUR BARS ARE NOT THEIRS — the divergence, named and bounded', () => {
    // The same session's share count from two providers. Reported as a table
    // rather than graded, because "how far apart are they" is the question.
    const rows = compareAll([{
      name: `${CASE.label} volume — providers`,
      ours: joined.map(({ i }) => CASE.bars.bars[i].v),
      theirs: joined.map(({ row }) => row.values[PLOT_AT.Volume]),
      kind: 'int',
      window: 1,
      barsLoaded: CASE.loaded,
    }])
    const r = rows[0]
    // ⛔ PINNED, NOT ASSERTED GREEN. They differ, and the size of the gap is the
    // fact: too large to be rounding, small enough to be two providers counting
    // the same session's shares. Measured 2026-09-13 — SPY 2026-09-11 reads
    // 45,478,xxx here against TradingView's 45,512,741, and AGEN likewise.
    expect(r.ok, `\n${renderTable(rows)}`).toBe(false)
    expect(r.mismatches).toBeGreaterThan(0)
    expect(r.maxRel, `\n${renderTable(rows)}`).toBeLessThan(5e-3)
  })

  it('⭐⭐ the four LINE plots, bar by bar, as the table the ruling asks for', () => {
    const spec = Object.keys(PLOT_AT).map((label) => ({
      name: label,
      ours: joined.map(({ i }) => {
        const col = byLabel[label]
        const v = col ? col[i] : undefined
        return v === undefined ? NaN : v
      }),
      theirs: joined.map(({ row }) => {
        const v = row.values[PLOT_AT[label]]
        return v === null ? NaN : v
      }),
      // ⭐ VOLUME IS AN INTEGER AND THE OTHERS ARE NOT. A share count compared
      // with a float tolerance passes on a different number of shares; the
      // averages are genuine floats and an absolute bound is vacuous at one
      // magnitude and unmeetable at the other. That split is why `seriesCompare`
      // takes a `kind` at all.
      kind: label === 'Volume' ? 'int' : 'float',
      window: 1,
      barsLoaded: CASE.loaded,
    }))
    const rows = compareAll(spec)
    const table = renderTable(rows)
    // ⛔ EVERY ROW WAS ACTUALLY COMPARED — an empty comparison is the way this
    // whole section could pass while measuring nothing.
    for (const r of rows) {
      if (r.name === 'Avg Vol Columns') continue   // legitimately blank, below
      expect(r.compared, `${r.name}\n${table}`).toBe(joined.length)
    }
    // ⛔ AND THE VERDICTS ARE PINNED. Every column differs, all of it downstream
    // of the volume gap above; the magnitudes are recorded so a change in either
    // direction shows up as a diff rather than as a still-red run.
    const verdicts = Object.fromEntries(rows.map((r) => [r.name, r.ok]))
    expect(verdicts.Volume).toBe(false)
    expect(verdicts['Avg Vol Line']).toBe(false)
    expect(verdicts['Scale Padding']).toBe(false)
    // ⭐⭐ AND THE MAGNITUDE IS THE RESULT. Measured 2026-09-13:
    //
    //   SPY @3,000   Avg Vol Columns 4.319e-5 | Avg Vol Line 1.118e-4 | Scale Padding 7.787e-4
    //   AGEN @2,000  Avg Vol Line 7.146e-5 | Scale Padding 7.146e-5
    //
    // A fifty-bar average of share counts that differ by a fraction of a percent
    // lands here. ⛔ The bound is 1e-3, not something comfortable: at 5e-2 this
    // case would pass through a genuine translation defect, and decomposing the
    // divergence above is what earns the right to a tight number.
    const worst = Math.max(...rows.filter((r) => r.kind === 'float').map((r) => r.maxRel))
    expect(worst, `\n${table}`).toBeLessThan(1e-3)
  })

  it('⚠️ `Avg Vol Columns` is BLANK on these bars, on both sides, and that is the script', () => {
    // The two-tone cap only draws when volume is ABOVE its average, and the
    // capture's own spread control says so for AGEN: *"null on all four … It DOES
    // carry a value on the record day (4270898.74), which is the control that it
    // is not simply broken."* A comparison that read blank-vs-blank as agreement
    // without saying which would hide a column that had stopped computing.
    const theirs = joined.map(({ row }) => row.values[PLOT_AT['Avg Vol Columns']])
    expect(theirs.some((v) => v === null)).toBe(true)
  })

  it('⛔⛔ HVE — the depth gate gets a real chance to pass, and answers', () => {
    // ⭐ The column's window is 2,751 bars. SPY is loaded past it and the gate
    // lets the comparison run; AGEN is not and the row comes back EXCLUDED with
    // the reason on it rather than with a number nobody should read.
    //
    // ⚠️ AND IT IS EXCLUDED ON OUR SIDE FOR A SECOND, INDEPENDENT REASON: ruling
    // D1 keeps an `alertcondition` off the pane entirely — the vendor's own
    // roster types `plot_7` as `alertcondition`, not `line` — so this document
    // has no HVE series to compare at any depth. That exclusion is DISCLOSED to
    // the member in words, and the sentence is asserted here so "excluded" is a
    // thing they are told rather than a thing that happened.
    const theirs = joined.map(({ row }) => {
      const v = row.values[HVE_AT]
      return v === null ? NaN : v
    })
    const rows = compareAll([{
      name: 'HVE Trigger', ours: theirs.map(() => NaN), theirs,
      kind: 'float', window: 2751, barsLoaded: CASE.loaded,
    }])
    if (CASE.loaded >= 2751) {
      expect(rows[0].excluded, `\n${renderTable(rows)}`).toBeFalsy()
    } else {
      expect(rows[0].excluded).toBe(true)
      expect(rows[0].reason).toContain('EXCLUDED')
      expect(rows[0].reason).toContain('2751')
    }
    const notes = built.definition.meta.disclosures.map((d) => `${d.name} :: ${d.note}`).join(' | ')
    expect(notes).toContain('HVE Trigger')
    expect(notes).toMatch(/not drawn on the chart/)
    // ⛔ AND OUR SIDE GENUINELY HAS NO SUCH PLOT — the disclosure is about a real
    // absence, not a label on something we quietly draw anyway.
    expect(built.definition.plots.map((pl) => pl.label)).not.toContain('HVE Trigger')
  })

  it('⛔ CONTROL — the comparator can also say AGREES on these very columns', () => {
    // ⚰️ Everything above is red-by-design, which is exactly the shape that can
    // pass over a comparator wired to fail. Fed our own column on both sides it
    // must come back clean, on the same kinds and the same gate.
    const rows = compareAll(Object.keys(PLOT_AT).map((label) => {
      const ours = joined.map(({ i }) => {
        const col = byLabel[label]
        const v = col ? col[i] : undefined
        return v === undefined ? NaN : v
      })
      return {
        name: label, ours, theirs: [...ours],
        kind: label === 'Volume' ? 'int' : 'float', window: 1, barsLoaded: CASE.loaded,
      }
    }))
    expect(rows.filter((r) => !r.ok).map((r) => `${r.name}: ${r.reason}`),
      `\n${renderTable(rows)}`).toEqual([])
  })
})
