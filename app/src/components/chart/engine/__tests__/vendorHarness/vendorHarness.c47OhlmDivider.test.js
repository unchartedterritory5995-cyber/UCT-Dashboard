// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47OhlmDivider.test.js
//
// ─── C47 — THE ONE LINE high-low-open-mid-ranges DOES NOT HOLD (503 of 504) ───
//
// C44 left it as "one unexplained line: the vendor's oldest, id 2151". This file
// is the explanation, held as arithmetic on the committed capture — and it is a
// record of what is NOT served, not a fix.
//
//   1. Every object we hold pairs with TradingView's, and TradingView's id is
//      ours + 46 on all 503 lines and all 504 labels. So the vendor created
//      exactly 46 more objects than we did, all of them BEFORE the oldest
//      object either side still holds.
//   2. 45 of the 46 are the table's cells: the capture numbers them 14..58, the
//      ids straight after the table's own (13 — which is also OUR table's id).
//      TradingView draws a cell's id from the same counter; this engine does not.
//   3. That leaves ONE object, and the line count says it is a LINE: lines are
//      collected five at a time past the cap (C7), so one more line created
//      anywhere in history moves which of the oldest group survives — 504, not 503.
//   4. The only line site whose condition this engine cannot compute on a bar
//      where it might be true is the session divider,
//          vline(a) =>
//              if ta.change(time(higherTF)) and i_v1
//                  line.new(a, low - ta.tr, a, high + ta.tr, …, extend.both, …)
//      on bars 0, 1 and 2. Bar 2 is the first Monday: the first week boundary of
//      a history that starts at the listing (Thursday 2024-03-21). There
//      `ta.change(time("W"))` needs `time("W")` on bar 1 — the anchor of the
//      listing's own PARTIAL week — and that value is withheld
//      (`time-anchor:session-open-missing`: the calendar opens that week on a
//      Monday the chart has no bar for; no capture says whether TradingView
//      answers the calendar's Monday or the first bar).
//   5. The control: the same script with ONE divider added on bar 2 holds 504
//      lines, every one of them TradingView's, at ours + 45 — the cells alone.
//
// ⛔ NOT SERVED. Either answer to (4) makes the change non-zero, so the line
// exists under both — but the engine has no "known to differ, value unknown",
// and the anchor's VALUE on those bars is unwitnessed. The capture that settles
// it is queued (`docs/pine/capture-queue-2026-10-01-c47.md`, Q-C47-1).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { isoDay, tfBucket } from '../../ast/interpret'

const HARNESS = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const OHLM = 'high-low-open-mid-ranges-rddt-1d-2026-09-28.json'

afterEach(() => { vi.unstubAllEnvs() })

const DIVIDER_CALL = 'vline(bar_index)'
const ONE_MORE_DIVIDER = [
  'if bar_index == 2',
  '    line.new(bar_index, low - ta.tr, bar_index, high + ta.tr, xloc.bar_index, extend.both, i_v4, i_v2a, i_v3a)',
  DIVIDER_CALL,
]

const run = (edit) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const loaded = loadCapture(path.join(HARNESS, OHLM))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  const cap = loaded.capture
  const bars = toProductBars(cap)
  const source = edit ? edit(cap.source.text) : cap.source.text
  const d = memberPaneDefinition({ source, id: 'u_c47_divider', name: 'c47' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true),
  })
  const out = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  const byId = (a, b) => a.id - b.id
  const ours = (family) => out.live.filter((o) => o.family === family).sort(byId)
  const vendor = cap.objects.records
  return { cap, bars, d, reader, out, ours, vendor, vendorLines: [...vendor.lines].sort(byId), vendorLabels: [...vendor.labels].sort(byId) }
}

/** Pair newest-first (the oldest end is where the two sides differ) and return
 *  the set of `vendor id − our id`, checking each pair is the same line. */
const offsets = (ours, vendor, same) => {
  const seen = new Set()
  const n = Math.min(ours.length, vendor.length)
  for (let k = 1; k <= n; k++) {
    const a = ours[ours.length - k]
    const b = vendor[vendor.length - k]
    if (same) same(a, b)
    seen.add(b.id - a.id)
  }
  return [...seen]
}
const sameLine = (a, b) => {
  expect(a.props.y1).toBeCloseTo(b.y1, 9)
  expect(a.props.y2).toBeCloseTo(b.y2, 9)
}

describe('C47 — high-low-open-mid-ranges: the one line we do not hold is the first week\'s divider', () => {
  it('⭐ 503 of 504: every line and label we hold is TradingView\'s, at its id − 46', () => {
    const r = run()
    expect(r.vendor.lines).toHaveLength(504)
    // ⭐ wave 12: C49's session calendar answers the first week boundary (bar 2) that C47
    // traced as the one uncomputable divider - so all 504 of TradingView's lines are ours.
    expect(r.ours('line')).toHaveLength(504)
    expect(r.ours('label')).toHaveLength(504)
    expect(offsets(r.ours('line'), r.vendorLines, sameLine)).toEqual([45])
    expect(offsets(r.ours('label'), r.vendorLabels)).toEqual([45]) // wave 12: one more line is created before them
    // the vendor's oldest (C44's "id 2151") now HAS its partner: our first line
    expect(r.vendorLines[0].id).toBe(2151)
    expect(r.vendorLines[0].y1).toBe(82.21)
    expect(r.ours('line')[0].props.y1).toBe(82.21)
  }, 120000)

  it('45 of the 46 are the table\'s cells — the capture numbers them straight after the table', () => {
    const r = run()
    const table = r.ours('table')
    expect(table).toHaveLength(1)
    expect(r.vendor.tables).toHaveLength(1)
    expect(table[0].id).toBe(r.vendor.tables[0].id)          // 13 on both sides
    const ids = r.vendor.tableCells.map((c) => c.id).sort((a, b) => a - b)
    expect(ids).toHaveLength(45)
    expect(ids[0]).toBe(r.vendor.tables[0].id + 1)
    expect(ids[44] - ids[0]).toBe(44)                       // contiguous: 14..58
  }, 120000)

  it('⛔ the divider\'s condition is not computable on bars 0–2 only, and bar 2 is the first week boundary', () => {
    const r = run()
    const ops = r.d.definition.objects.ops
    const dividers = ops.filter((o) => o.k === 'create' && o.family === 'line'
      && o.props.extend && o.props.extend.v === 'const' && o.props.extend.value === 'both')
    expect(dividers).toHaveLength(1)
    const tree = dividers[0].when.tree
    const unknownAt = []
    for (let b = 0; b < r.bars.length; b++) if (r.reader.readUnknown(tree, b)) unknownAt.push(b)
    // wave 12 (C49): only bar 0 (the listing day: the week's open is before the series) is
    // unknown now; bars 1-2 are answered from the calendar, and bar 2 draws the divider.
    // ⚰️ RE-PINNED 2026-10-04 (G16, the wave-16 gate): WAS `[0]` / 1 withheld. H5
    // (8579b64f75, ruling R-W) stopped withholding a period anchor for "the bar before
    // the series" when the run is FROM THE LISTING: there is no such bar, and Pine reads
    // na there, which is what this lane answers (graded: C49 SPY W 1758/1758, M 406/406
    // events equal TradingView on bar 0). So bar 0 is answered now - and it draws NO
    // divider, which is TradingView's answer too: we still hold 504 of its 504 lines (the
    // first test, unchanged), and one more divider is still one too many (the control).
    expect(unknownAt).toEqual([])
    expect(r.out.stats.withheldUnknown || 0).toBe(0)  // the key is absent when nothing is withheld
    expect(r.reader.readNode(tree, 0) ? 1 : 0).toBe(0)
    // the listing: a Thursday, then Friday, then the first Monday
    const week = (b) => tfBucket(isoDay(r.bars[b].t), 'W')
    expect(r.cap.history.startsAtBar0).toBe(true)
    expect(isoDay(r.bars[0].t)).toBe('2024-03-21')
    expect(week(1)).toBe(week(0))
    expect(week(2)).not.toBe(week(1))
    // from bar 3 on the divider fires on exactly the bars a week opens
    for (let b = 1; b < r.bars.length; b++) {
      expect(r.reader.readNode(tree, b) ? 1 : 0, `bar ${b}`).toBe(week(b) !== week(b - 1) ? 1 : 0)
    }
  }, 120000)

  it('⭐ the control: ONE more divider on bar 2 is now one TOO MANY (505 against 504) - the bar-2 divider is drawn', () => {
    // ⚰️ On C47 alone this added the missing first-week divider and reached 504 of 504.
    // wave 12: C49 already draws that divider, so the extra one is a duplicate - which is
    // exactly what proves the bar-2 divider is now ours.
    const r = run((text) => {
      expect(text.split(DIVIDER_CALL).length).toBe(2)       // the call appears once
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      return text.replace(DIVIDER_CALL, ONE_MORE_DIVIDER.join(eol))
    })
    expect(r.ours('line')).toHaveLength(505)
    expect(r.ours('label')).toHaveLength(504)
  }, 120000)
})
