// app/src/components/chart/engine/__tests__/objectDoorDraws.test.js
//
// ⭐⭐ WHAT A MEMBER'S CHART KEEPS — THE DOOR, THE READER, THE RUNTIME, THE PAINTER.
//
// ⛔ AN EMITTED OBJECT IS NOT A DRAWN ONE. Every case here walks the member's own
// route with nothing mocked — `memberPaneDefinition` (the objects-only pane flag
// ON, as the census measures it), `objectReaderFor`, `evaluateObjects`,
// `toRenderState`, `paintObjects`/`layoutTables` — and reads the RENDERER's own
// counters, because a box whose left edge is an unreadable tree is created,
// counted, and never painted.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { paintObjects, layoutTables } from '../objectCanvas'

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus/committed')
const FIX = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8'))
const BARS = FIX.bars.slice(-600).map((b) => ({
  t: Math.floor(Date.parse(`${b.t}T00:00:00Z`) / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
}))
const LF = String.fromCharCode(10)

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

/** The member's route, end to end. */
function drawn(source) {
  const door = memberPaneDefinition({ source, id: 'u_door', name: 'P' })
  if (!door.ok) return { door }
  const reader = objectReaderFor(door.definition, BARS, { tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' } })
  const run = reader && evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  const state = run ? toRenderState(run.live, { bars: BARS }) : null
  const sink = () => {}
  const ctx = {
    save: sink, restore: sink, beginPath: sink, closePath: sink, moveTo: sink, lineTo: sink,
    stroke: sink, fill: sink, fillRect: sink, strokeRect: sink, fillText: sink, setLineDash: sink,
    rect: sink, clip: sink, arc: sink, translate: sink, rotate: sink, scale: sink,
    setTransform: sink, quadraticCurveTo: sink, bezierCurveTo: sink,
    measureText: (s) => ({ width: String(s).length * 6 }),
  }
  const mapping = {
    timeToX: (t) => (Number(t) - BARS[0].t) / 86400, priceToY: (p) => 1000 - Number(p),
    width: 100000, height: 2000,
  }
  const painted = state ? paintObjects(ctx, state, mapping) : null
  const byFamily = (painted && painted.drawn) || {}
  const kept = Object.values(byFamily).reduce((a, b) => a + (Number(b) || 0), 0)
    + (state ? (layoutTables(state) || []).length : 0)
  return { door, reader, run, kept, byFamily }
}

const read = (prefix) => {
  const f = fs.readdirSync(CORPUS).find((x) => x.startsWith(prefix))
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}

describe('⭐⭐ an object tree reads only inputs the pane document declares', () => {
  it('⭐ an OBJECTS-ONLY script folds its inputs to the author\'s defaults — the box is painted', () => {
    const r = drawn(['//@version=5', 'indicator("t", overlay=true)',
      'boxLen = input.int(10, "Box length")',
      'if close > open',
      '    box.new(bar_index, high, bar_index + boxLen, low)'].join(LF))
    expect(r.door.ok, r.door.reason || '').toBe(true)
    expect(r.reader.failed, JSON.stringify(r.reader.refusals)).toEqual([])
    expect(r.byFamily.box).toBeGreaterThan(0)
  })

  it('⭐ an input a DECLINED row declared still reaches the object that reads it', () => {
    // `thr` is declared because the alertcondition reads it; the pane declines
    // that row (ruling D1), and the label is the only drawn thing that uses it.
    const r = drawn(['//@version=5', 'indicator("t", overlay=true)',
      'thr = input.float(1.5, "Threshold")',
      'plot(close)',
      'alertcondition(close > open + thr, "a")',
      'if barstate.islast',
      '    label.new(bar_index, close + thr, "x")'].join(LF))
    expect(r.door.ok, r.door.reason || '').toBe(true)
    expect(r.reader.failed, JSON.stringify(r.reader.refusals)).toEqual([])
    expect(r.byFamily.label).toBe(1)
  })
})

describe('⭐⭐ the corpus scripts this wave completes — at the door AND on the canvas', () => {
  const clean = (d) => d.droppedOps === 0 && !d.loopBlocked
    && !(d.unsupported || []).length && !(d.getters || []).length && !(d.outOfScope || []).length

  for (const [prefix, minKept] of [
    ['contraction-box-doji-lines__', 3],
    ['fibonacci-pivot-points-cc__', 1],
    ['makuchaku039s-trade-tools-fair-value-gaps__', 1],
    ['position-size-calculator__28sGm8JqI3', 1],
  ]) {
    it(`${prefix} — a CLEAN program, every tree read, and the renderer keeps it`, () => {
      const r = drawn(read(prefix))
      expect(r.door.ok, r.door.reason || '').toBe(true)
      const d = r.door.translation.objectDiagnostics || {}
      expect(clean(d), JSON.stringify(d)).toBe(true)
      expect(r.reader.failed, JSON.stringify(r.reader.refusals)).toEqual([])
      expect(r.run.status).toBe('ok')
      expect(r.kept).toBeGreaterThanOrEqual(minKept)
    })
  }

  it('⭐ contraction-box: one line per doji AND only the boxes inside Pine\'s 50-box window', () => {
    const r = drawn(read('contraction-box-doji-lines__'))
    // Every bar creates a box (na corners when the condition is false), so the
    // 50-box pool collects all but the newest few — and only those with real
    // corners are painted. A runtime that skipped the na creates would keep
    // boxes from the whole history, which TradingView never shows.
    // ⭐ 2026-09-28 (C7): Pine collects in BATCHES — a create past 50 + 5 cuts
    // the pool back to 50 — so 600 one-per-bar creates hold 50 + (544 mod 6) =
    // 54, not exactly 50. On the vendor's own 632-bar RDDT capture of this
    // script the same rule holds exactly 50, id for id.
    expect(r.run.counts.box).toBe(50 + ((BARS.length - 56) % 6))
    expect(r.run.counts.box).toBe(54)
    expect(r.byFamily.box).toBeLessThan(r.run.counts.box)
    expect(r.byFamily.line).toBeGreaterThan(0)
  })
})
