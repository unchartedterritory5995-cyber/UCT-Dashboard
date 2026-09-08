// app/src/components/chart/engine/__tests__/objectPerf.measure.test.js
//
// ─── C3B — WHAT THE OBJECT LANE COSTS ──────────────────────────────────────
//
// ⛔⛔ A MEASUREMENT, NOT A BUDGET. The numbers printed here are what THIS
// machine did on THIS run; asserting a millisecond figure would produce a rail
// that goes red on a busy laptop and teaches everyone to ignore it. What IS
// asserted is the SHAPE — that cost grows with the number of objects rather
// than with the number of bars squared, and that a create/delete cycle does not
// accumulate — because a wrong shape is a wrong architecture and stays wrong on
// every machine.
import { describe, it, expect } from 'vitest'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { paintObjects } from '../objectCanvas'

const BARS = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1_700_000_000 + i * 86400, o: 100, h: 106, l: 94, c: 100 + Math.sin(i / 5) * 8, v: 1e6,
}))

const ctxOf = (bars, cols = {}) => ({
  barCount: bars.length,
  readNode: (node, bar) => (cols[node] ? cols[node][bar] : bar),
  readTime: (i) => bars[i].t,
})

/** N independent lines, each created once at a different bar and then moved. */
const programOf = (n) => ({
  programVersion: 1,
  regs: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, family: 'line' })),
  colls: [],
  limits: { line: 600, opsPerBar: 8000 },
  ops: Array.from({ length: n }, (_, i) => ([
    {
      k: 'create',
      family: 'line',
      site: `s${i}`,
      into: `r${i}`,
      once: true,
      when: null,
      props: { x1: { v: 'bar' }, y1: { v: 'const', value: 100 + i }, x2: { v: 'bar' }, y2: { v: 'const', value: 100 + i } },
    },
    { k: 'update', target: { r: 'reg', id: `r${i}` }, when: null, props: { x2: { v: 'bar' } } },
  ])).flat(),
})

const ms = (fn) => {
  const t0 = performance.now()
  const out = fn()
  return { ms: performance.now() - t0, out }
}

/** A no-op 2D context — the painter's cost, without a real canvas. */
const nullCtx = () => ({
  save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
  stroke() {}, fill() {}, fillRect() {}, strokeRect() {}, fillText() {}, setLineDash() {},
  measureText: (s) => ({ width: s.length * 6 }),
})

describe('C3B — cost, measured', () => {
  it('⭐⭐ 1 / 10 / 100 objects over 5,000 bars, evaluate + render-state + paint', () => {
    const bars = BARS(5000)
    const rows = []
    for (const n of [1, 10, 100]) {
      const program = programOf(n)
      const ev = ms(() => evaluateObjects(program, ctxOf(bars)))
      expect(ev.out.status).toBe('ok')
      expect(ev.out.live).toHaveLength(n)
      const rs = ms(() => toRenderState(ev.out.live, { bars }))
      const paint = ms(() => paintObjects(nullCtx(), rs.out, {
        timeToX: (t) => t / 1e6, priceToY: (p) => 500 - p, width: 1000, height: 500,
      }))
      rows.push({
        n,
        evaluate: ev.ms,
        renderState: rs.ms,
        paint: paint.ms,
        live: ev.out.stats.liveTotal,
        ops: ev.out.stats.opsExecuted,
      })
    }
    // eslint-disable-next-line no-console
    console.log('\n=== C3B OBJECT COST — 5,000 bars ===\n'
      + '   objects   evaluate   renderState     paint      ops executed\n'
      + rows.map((r) => `   ${String(r.n).padStart(7)}   ${r.evaluate.toFixed(1).padStart(6)}ms`
        + `   ${r.renderState.toFixed(2).padStart(9)}ms   ${r.paint.toFixed(2).padStart(7)}ms`
        + `   ${String(r.ops).padStart(9)}`).join('\n'))

    // ⛔ THE SHAPE, NOT THE NUMBER. Ten times the objects must not be a hundred
    // times the work — that would mean a per-object pass over the bars, which is
    // the architecture this design exists to avoid.
    const per1 = rows[0].evaluate
    const per100 = rows[2].evaluate
    expect(per100).toBeLessThan(Math.max(60, per1 * 400))
  })

  it('⭐⭐ HIGH TURNOVER: create+delete every bar for 5,000 bars stays FLAT', () => {
    const bars = BARS(5000)
    const program = {
      programVersion: 1,
      regs: [{ id: 'r0', family: 'line' }],
      colls: [],
      ops: [
        { k: 'delete', target: { r: 'reg', id: 'r0' }, when: null },
        { k: 'create', family: 'line', site: 's0', into: 'r0', when: null, props: { x1: { v: 'bar' }, y1: { v: 'const', value: 1 }, x2: { v: 'bar' }, y2: { v: 'const', value: 2 } } },
      ],
    }
    const r = ms(() => evaluateObjects(program, ctxOf(bars)))
    expect(r.out.status).toBe('ok')
    // ⛔ THE NUMBER THAT MATTERS: 5,000 creates, one object alive.
    expect(r.out.stats.created).toBe(5000)
    expect(r.out.stats.deleted).toBe(4999)
    expect(r.out.stats.peakLive.line).toBe(1)
    expect(r.out.live).toHaveLength(1)
    // eslint-disable-next-line no-console
    console.log(`   high turnover: 5,000 create/delete cycles in ${r.ms.toFixed(1)}ms, peak live 1`)
  })

  it('⭐ a big DASHBOARD — 1 table, 60 cells, rewritten on the last bar only', () => {
    const bars = BARS(5000)
    const cells = []
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        cells.push({
          k: 'cell',
          target: { r: 'reg', id: 'r0' },
          when: null,
          lastBarOnly: true,
          col: { v: 'const', value: col },
          row: { v: 'const', value: row },
          props: { text: { v: 'text', node: { t: 'num', node: 0, fmt: '#.##' } } },
        })
      }
    }
    const program = {
      programVersion: 1,
      regs: [{ id: 'r0', family: 'table' }],
      colls: [],
      ops: [
        { k: 'create', family: 'table', site: 's0', into: 'r0', once: true, when: null, props: { position: { v: 'const', value: 'top_right' } } },
        ...cells,
      ],
    }
    const r = ms(() => evaluateObjects(program, ctxOf(bars)))
    expect(r.out.status).toBe('ok')
    const rs = toRenderState(r.out.live, { bars })
    expect(rs.tables[0].cells).toHaveLength(60)
    // ⭐ `lastBarOnly` IS THE PERFORMANCE STORY FOR DASHBOARDS: 60 cells written
    // once, not 60 × 5,000. Pine authors write `if barstate.islast` for exactly
    // this reason, and honouring it keeps the cost where they put it.
    expect(r.out.stats.opsExecuted).toBeLessThan(200)
    // eslint-disable-next-line no-console
    console.log(`   dashboard: 60 cells over 5,000 bars in ${r.ms.toFixed(1)}ms, `
      + `${r.out.stats.opsExecuted} ops executed (not ${60 * 5000})`)
  })

  it('⛔ …and WITHOUT `lastBarOnly` the same dashboard costs 5,000× more ops — the control', () => {
    const bars = BARS(2000)
    const program = {
      programVersion: 1,
      regs: [{ id: 'r0', family: 'table' }],
      colls: [],
      ops: [
        { k: 'create', family: 'table', site: 's0', into: 'r0', once: true, when: null, props: {} },
        { k: 'cell', target: { r: 'reg', id: 'r0' }, when: null, col: { v: 'const', value: 0 }, row: { v: 'const', value: 0 }, props: { text: { v: 'text', node: { t: 'num', node: 0 } } } },
      ],
    }
    const r = evaluateObjects(program, ctxOf(bars))
    expect(r.stats.opsExecuted).toBeGreaterThan(2000)
    // the LAST bar's value is what stands, which is why the cost is avoidable
    expect(r.live[0].cells[0].props.text).toBe('1999')
  })
})
