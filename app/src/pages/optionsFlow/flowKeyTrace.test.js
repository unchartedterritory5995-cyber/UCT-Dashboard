// The key trace must be FREE when off and HONEST when on.
import { describe, it, expect, beforeEach } from 'vitest'
import { traceDataset, markFirstContent, tracingArmed } from './flowKeyTrace'

const D = { bootstrap: 1, CONV: [1], TICKER_DB: [2], clean_confirmed: [3], WATCH: [4] }

function arm(on) {
  window.localStorage.clear()
  if (on) window.localStorage.setItem('uct.flow.traceKeys', '1')
  delete window.__flowKeyReads
}

describe('off by default, and free when off', () => {
  beforeEach(() => arm(false))

  it('is not armed unless asked', () => {
    expect(tracingArmed()).toBe(false)
  })

  it('⛔ returns the SAME object, not a wrapper', () => {
    // Identity, not deep-equality: a Proxy would pass a value check while still
    // costing a trap on every property read in the hot render path.
    expect(traceDataset(D)).toBe(D)
  })

  it('records nothing at all', () => {
    const t = traceDataset(D)
    void t.CONV
    expect(window.__flowKeyReads).toBeUndefined()
  })
})

describe('armed, it records the FIRST read of each key', () => {
  beforeEach(() => arm(true))

  it('CONTROL: it really is armed and really does wrap', () => {
    expect(tracingArmed()).toBe(true)
    expect(traceDataset(D)).not.toBe(D)
  })

  it('records only what was touched, and returns the real values', () => {
    const t = traceDataset(D)
    expect(t.CONV).toEqual([1])
    expect(t.TICKER_DB).toEqual([2])
    expect(Object.keys(window.__flowKeyReads.firstRead).sort()).toEqual(['CONV', 'TICKER_DB'])
    expect(window.__flowKeyReads.unread(Object.keys(D)).sort())
      .toEqual(['WATCH', 'bootstrap', 'clean_confirmed'])
  })

  it('splits reads either side of first content', () => {
    const t = traceDataset(D)
    void t.CONV
    markFirstContent()
    void t.WATCH
    expect(window.__flowKeyReads.beforePaint()).toContain(
      'CONV@' + window.__flowKeyReads.firstRead.CONV.ms + 'ms')
    expect(window.__flowKeyReads.firstRead.WATCH.paintedYet).toBe(true)
  })

  it('⛔ `__raw` unwraps WITHOUT recording, so a spread cannot poison the trace', () => {
    // The merge site does `{...prev.__raw}`. Without the hatch, spreading the
    // Proxy reads every key and the trace would claim first paint needs the
    // whole dataset — the exact wrong answer for a partition decision.
    const t = traceDataset(D)
    const merged = { ...t.__raw, extra: 1 }
    expect(merged.CONV).toEqual([1])
    expect(Object.keys(window.__flowKeyReads.firstRead)).toEqual([])
  })

  it('CONTROL: spreading the PROXY does record everything — the hatch is load-bearing', () => {
    const t = traceDataset(D)
    void { ...t }
    expect(Object.keys(window.__flowKeyReads.firstRead).length).toBeGreaterThan(3)
  })
})

describe('field-level trace on the row arrays', () => {
  const BIG = {
    TICKER_DB: Array.from({ length: 50 }, (_, i) => ({ s: 'T' + i, n: i, prem: i * 10, unused: 'x' })),
    WATCH: [{ s: 'W', deep: 1 }],
  }

  beforeEach(() => arm(true))

  it('records WHICH fields and HOW MANY rows a consumer touched', () => {
    const t = traceDataset(BIG)
    // A consumer shaped like the real ones: find one row, read two fields.
    const hit = t.TICKER_DB.find(r => r.s === 'T3')
    void hit.prem
    const rep = window.__flowKeyReads.fieldReport()
    expect(rep.TICKER_DB.rowCount).toBe(50)
    expect(rep.TICKER_DB.fields.some(f => f.startsWith('s:'))).toBe(true)
    expect(rep.TICKER_DB.fields.some(f => f.startsWith('prem:'))).toBe(true)
    // ⛔ The point of the whole exercise: an untouched field must NOT appear,
    // or the report cannot size a derived product.
    expect(rep.TICKER_DB.fields.some(f => f.startsWith('unused:'))).toBe(false)
    expect(rep.TICKER_DB.arrayOps).toContain('find')
  })

  it('counts only the rows actually visited', () => {
    const t = traceDataset(BIG)
    void t.TICKER_DB[0].s
    void t.TICKER_DB[1].s
    expect(window.__flowKeyReads.fieldReport().TICKER_DB.rowsTouched).toBe(2)
  })

  it('CONTROL: a non-deep key is not field-traced', () => {
    // Deep-proxying everything would distort the timings this file reports.
    const t = traceDataset(BIG)
    void t.WATCH[0].deep
    expect(window.__flowKeyReads.fieldReport().WATCH).toBeUndefined()
  })

  it('values still come back correct through both proxies', () => {
    const t = traceDataset(BIG)
    expect(t.TICKER_DB.filter(r => r.n < 3).map(r => r.s)).toEqual(['T0', 'T1', 'T2'])
  })
})
