// app/src/components/chart/engine/runtime/__tests__/draw1CountAtCap.test.js
//
// ─── ⭐⭐ DRAW-1 GC — THE BOX CARVE-OUT IS THE SHAPE NO CAPTURE WITNESSES, NEVER THE WHOLE FAMILY ──
//
// The engine-66 carve-out withheld EVERY box family whose collector ran, and so drew 0 boxes where
// TradingView keeps the newest max_boxes_count (rs-arm-label-last-bar-spy, s10: 503 held at cap 500;
// sonarlab-order-blocks: 24 at cap 20). TradingView's collector (`objectPool.js` C7: a create past
// cap + 5 deletes the oldest down to cap) is witnessed there and is kept. The committed
// vw-draw-count-at-cap captures (2026-11-16, cap 20, one create per family every third bar) separate the
// one shape C7 does not describe: lines never held and labels held in a `var` follow C7 on both charts,
// BOXES held in a `var` whose past value the script reads (`myBox[1]`, inside-bar-boxes' shape) do not.
// Only that shape is withheld by name (`objects:count-at-cap`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeObjectStore } from '../objectStore.js'
import {
  COUNT_AT_CAP_GUARD, COUNT_AT_CAP_PREFIX, COUNT_AT_CAP_FAMILIES, collectsAbove, historyHeldOf,
} from '../../objectPool.js'
import { runtimeWithheldCause, runtimeWithheldWhy, NOT_SHOWN } from '../../ast/objectLoss.js'
import { strippedForScan } from '../../ast/pine.js'

const REPO = path.resolve(process.cwd(), '..')
const held = () => ({ vars: new Set(), containers: new Set(), arrays: new Set() })
const sourceOf = (id) => JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/harness', `${id}.json`), 'utf8')).source.text

function run(op, args, caps, creates) {
  const s = makeObjectStore({ pineVersion: 6, caps })
  for (let bar = 0; bar < creates; bar += 1) s.call(op, args(bar), bar, held)
  return s.finish()
}
const boxes = (caps, creates) => run('box.new', (b) => [b, 2, b + 1, 1], caps, creates)
const labels = (caps, creates) => run('label.new', (b) => [b, 1, 'L'], caps, creates)
/** C7's held count after `k` creates, one per bar, nothing held: the sawtooth cap .. cap + 5. */
const c7 = (cap, k) => (k <= collectsAbove(cap) ? k : cap + ((k - collectsAbove(cap) - 1) % (collectsAbove(cap) - cap + 1)))

describe('DRAW-1 GC — the box count at the cap', () => {
  it('⭐ a box family past its cap keeps TradingView\'s collection: the newest, by C7, nothing withheld', () => {
    for (const [cap, k] of [[3, 30], [20, 2836], [20, 223], [500, 1500]]) {
      const f = boxes({ box: cap }, k)
      expect(f.withheld.box, `cap ${cap}, ${k} made`).toBeUndefined()
      const live = f.live.filter((r) => r.family === 'box')
      expect(live.length, `cap ${cap}, ${k} made`).toBe(c7(cap, k))
      // the NEWEST are kept: the last one made is held, the first is gone
      const bars = live.map((r) => r.createdBar)
      expect(Math.max(...bars)).toBe(k - 1)
      expect(Math.min(...bars)).toBe(k - live.length)
    }
  })

  it('the C7 count matches the committed captures it is witnessed on', () => {
    // vw-draw-count-at-cap lines (never held): SPY 22 of 2836, RDDT 25 of 223, at cap 20
    expect(c7(20, 2836)).toBe(22)
    expect(c7(20, 223)).toBe(25)
  })

  it('a box family whose handle the script reads at a past offset is withheld once its collector runs, by name', () => {
    const f = boxes({ box: 3, historyHeld: ['box'] }, collectsAbove(3) + 4)
    expect(String(f.withheld.box || '')).toMatch(new RegExp(`^${COUNT_AT_CAP_PREFIX}`))
    expect(f.live.filter((r) => r.family === 'box')).toEqual([])
    expect(f.withheldCounts.box).toBeGreaterThan(0)
  })

  it('CONTROL: the same shape under its trigger is drawn whole', () => {
    const f = boxes({ box: 3, historyHeld: ['box'] }, collectsAbove(3))
    expect(f.withheld.box).toBeUndefined()
    expect(f.live.filter((r) => r.family === 'box').length).toBe(collectsAbove(3))
  })

  it('CONTROL: a label family past its cap is drawn by C7, even with the history flag', () => {
    expect(COUNT_AT_CAP_FAMILIES).toEqual(['box'])
    const f = labels({ label: 3, historyHeld: ['box'] }, 30)
    expect(f.withheld.label).toBeUndefined()
    expect(f.live.filter((r) => r.family === 'label').length).toBe(c7(3, 30))
  })

  it('the reason maps to its own member sentence, never the generic one', () => {
    const f = boxes({ box: 3, historyHeld: ['box'] }, collectsAbove(3) + 1)
    expect(runtimeWithheldCause(f.withheld.box, 'box')).toBe(NOT_SHOWN.COUNT_AT_CAP)
    expect(NOT_SHOWN.COUNT_AT_CAP).toBe(COUNT_AT_CAP_GUARD)
    expect(runtimeWithheldWhy(f.withheld).box).toMatch(/approximate/)
  })
})

describe('DRAW-1 GC — which scripts read a box handle at a past offset (`historyHeldOf`)', () => {
  it('the captures C7 does NOT describe are the shape', () => {
    for (const id of ['inside-bar-boxes-rddt-1d-2026-11-14', 'vw-draw-count-at-cap-spy-1d-2026-11-16',
      'vw-draw-count-at-cap-rddt-1d-2026-11-16']) {
      expect(historyHeldOf(strippedForScan(sourceOf(id))), id).toEqual({ historyHeld: ['box'] })
    }
  })

  it('CONTROL: the box captures C7 DOES describe are not', () => {
    for (const id of ['rs-arm-label-last-bar-spy-1d-2026-11-15', 'rs-arm-label-last-bar-rddt-1d-2026-11-15',
      'sonarlab-order-blocks-spy-1d-2026-10-02', 'sonarlab-order-blocks-brk-a-1d-2026-10-02']) {
      expect(historyHeldOf(strippedForScan(sourceOf(id))), id).toEqual({})
    }
  })

  it('reads the declaration, the constructor and the past offset, never a comment or an array', () => {
    expect(historyHeldOf('var box b = na\nb := box.new(0, 1, 1, 0)\nbox.set_right(b[1], 2)')).toEqual({ historyHeld: ['box'] })
    expect(historyHeldOf('b = box.new(0, 1, 1, 0)\nx = b[2]')).toEqual({ historyHeld: ['box'] })
    expect(historyHeldOf('var box b = na\nb := box.new(0, 1, 1, 0)\nbox.set_right(b, 2)')).toEqual({})
    expect(historyHeldOf('var box[] bs = array.new_box()\ny = bs[1]')).toEqual({})
    expect(historyHeldOf(strippedForScan('// box b = na\n// b[1]\nplot(close)'))).toEqual({})
  })
})
