// app/src/components/chart/engine/ast/tfMergeNestedMasks.test.js
//
// ─── A WINDOW SITE INSIDE A WEEKLY `request.security`: WHAT THE ROOT STILL WITHHOLDS, AND WHY ───
//
// Engine 59's open note. `request.security(…, "W", …)` with look-ahead off is `tf_merge`. Its child is
// evaluated on the WEEKLY bars through `interpret`, where the window masks run on the bars the site
// reads. `builtinWitnessMask` and `windowHoleMask` list `tf`, `tf_live`, `sym` and `ltf` as such reads
// and NOT `tf_merge`, so the ROOT asks the site about the chart's own daily bars as well and withholds
// daily bars the weekly read does not need. It never draws a wrong value.
//
// ⛔ LEFT AS IT IS, ON PURPOSE (2026-11-16). Serving those bars means drawing a weekly window call on
// daily bars no committed capture plots: the only committed script with one (`smarter-snr`) is refused
// at the door, and no probe capture plots a `ta.stoch` / `ta.highest` inside a weekly request. So the
// bars stay withheld until a capture exists (`docs/pine/capture-queue-2026-11-16-tick-tie-and-htf-windows.md`,
// H01-H05). This rail pins what is withheld today, so that listing `tf_merge` in either mask is a
// decision somebody takes with that capture in hand, not a tidy-up. Python twin:
// `tests/test_pine_tfmerge_nested_masks.py` (same fixture).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret, builtinWitnessMask, windowHoleMask, tfMergeMask, withheldReadMask, STOCH_FLAT_WINDOW } from './interpret.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const FIX = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/pine_tfmerge_nested_masks.json'), 'utf8'))
const BARS = JSON.parse(fs.readFileSync(path.join(REPO, FIX.bars), 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const OPTS = FIX.opts
const ones = (m) => (m ? Array.from(m).map((v, i) => (v ? i : -1)).filter((i) => i >= 0) : null)
const span = ({ first, last }) => Array.from({ length: last - first + 1 }, (_, k) => first + k)
const retype = (n, to) => {
  if (Array.isArray(n)) return n.map((c) => retype(c, to))
  if (!n || typeof n !== 'object') return n
  const o = {}
  for (const k of Object.keys(n)) o[k] = k === 'type' && n[k] === 'tf_merge' ? to : retype(n[k], to)
  return o
}

describe('the fixture is the Pine door\'s own tree', () => {
  it('the weekly `ta.stoch` flat-run shape translates to `tf_merge` over `stochPine`, and the fixture holds that tree', () => {
    const t = translatePine(FIX.source, { strict: true, basePeriod: 'D' })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    const tree = t.outputs.filter((o) => o.kind !== 'alertcondition')[0].ast
    expect(JSON.parse(JSON.stringify(tree))).toEqual(FIX.tree)
    expect(JSON.stringify(tree)).toContain('"type":"tf_merge"')
    expect(BARS.length).toBe(666)
  })
})

describe('⭐ the root asks a `tf_merge` site about the chart\'s own bars too (over-withholding, never a wrong value)', () => {
  it(`builtinWitnessMask withholds ${FIX.rootWithheld.count} daily bars at the root, by the flat-window code`, () => {
    const clock = new Map()
    const mask = builtinWitnessMask(FIX.tree, BARS, undefined, undefined, undefined, { ...OPTS, chartClockSink: clock })
    expect(ones(mask)).toEqual(span(FIX.rootWithheld))
    expect(ones(mask).length).toBe(FIX.rootWithheld.count)
    expect([...clock.keys()]).toEqual([STOCH_FLAT_WINDOW])
    expect(FIX.rootWithheld.code).toBe(STOCH_FLAT_WINDOW)
    // no other root mask speaks on this tree from the listing: the root's withholding is this mask's alone
    expect(tfMergeMask(FIX.tree, BARS, OPTS)).toBeNull()
    expect(windowHoleMask(FIX.tree, BARS, undefined, undefined, undefined, OPTS)).toBeNull()
    expect(ones(withheldReadMask(FIX.tree, BARS, undefined, undefined, undefined, OPTS))).toEqual(span(FIX.rootWithheld))
  })

  it('those bars are withheld in the served column, with the weekly read\'s own flat run beside them', () => {
    const col = Array.from(interpret(FIX.tree, BARS, undefined, undefined, undefined, OPTS))
    for (const i of span(FIX.rootWithheld)) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
    for (const i of span(FIX.weeklyReadWithheld)) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
    expect(Number.isFinite(col[FIX.rootWithheld.first - 1]) && Number.isFinite(col[FIX.rootWithheld.last + 1])).toBe(true)
    expect(col.filter(Number.isNaN).length).toBe(20 + FIX.rootWithheld.count + FIX.weeklyReadWithheld.count)
  })

  it('what the weekly read alone would draw there: every one of them (the same site under a nested read)', () => {
    // `tf_live` IS listed as a nested read, so its root mask is silent and only the child withholds
    const live = retype(FIX.tree, 'tf_live')
    expect(builtinWitnessMask(live, BARS, undefined, undefined, undefined, OPTS)).toBeNull()
    const col = Array.from(interpret(live, BARS, undefined, undefined, undefined, OPTS))
    for (const i of span(FIX.rootWithheld)) expect(Number.isFinite(col[i]), `bar ${i}`).toBe(true)
  })
})
