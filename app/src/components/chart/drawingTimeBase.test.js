// ONE time base for stored intraday points: raw unix. A hand-drawn trendline
// (overlay stores bars[i].t) and an Agent trendline (drawingTimeFor) with a
// point past the last candle must give the SAME, true-UTC alert slope.
import { describe, it, expect } from 'vitest'
import { anchorsForDrawing } from './drawingAlertAnchors'
import { drawingTimeFor } from './drawingTools'
import { toChartTime, fromChartTime } from './barTime'
import { isLegacyChartTimePoint, pointUnixTime, toUnixTimeBase, toRawUnixView, stampTimeBase, pointChartTime } from './drawingTimeBase'

const open = (y, mo, d) => {   // 09:30 ET as unix
  for (const off of [4, 5]) {
    const u = Date.UTC(y, mo - 1, d, 9 + off, 30) / 1000
    if (toChartTime(u) === Date.UTC(y, mo - 1, d, 9, 30) / 1000) return u
  }
  throw new Error('no open')
}

describe('stored intraday drawing points share one time base', () => {
  const a = open(2026, 10, 30)                 // EDT side of the DST change
  const lastBar = open(2026, 11, 2)            // EST side
  const bars = [{ t: a }, { t: lastBar }]      // the raw series the overlay and StockChart hold
  const geomOf = (d) => anchorsForDrawing(d, { bars, tf: '60', etOffset: fromChartTime })

  it('manual trendline (raw bar t) with a future point', () => {
    const g = geomOf({ type: 'trendline', points: [{ time: a, price: 100 }, { futureBars: 3, price: 110 }] })
    expect(g.anchor_t1).toBe(a)
    expect(g.anchor_t2).toBe(lastBar + 3 * 3600)
  })

  it('agent trendline (drawingTimeFor) with a future point — same anchors as the manual one', () => {
    const t = drawingTimeFor('2026-10-30', '60')
    expect(t).toBe(a)                                         // raw unix now
    const g = geomOf({ type: 'trendline', tb: 'unix', points: [{ time: t, price: 100 }, { futureBars: 3, price: 110 }] })
    expect(g.anchor_t1).toBe(a)
    expect(g.anchor_t2).toBe(lastBar + 3 * 3600)
  })

  it('a LEGACY agent drawing (chart-time 09:30 anchor, no stamp) still reads true UTC', () => {
    const legacy = toChartTime(a)
    expect(isLegacyChartTimePoint(legacy)).toBe(true)
    const g = geomOf({ type: 'trendline', points: [{ time: legacy, price: 100 }, { futureBars: 3, price: 110 }] })
    expect(g.anchor_t1).toBe(a)
    expect(pointUnixTime(legacy)).toBe(a)
    // stamped drawings never reinterpret
    expect(isLegacyChartTimePoint(legacy, { tb: 'unix' })).toBe(false)
  })

  it('raw unix points never look legacy, on either side of DST', () => {
    for (const u of [a, lastBar, a + 1800, lastBar + 6 * 3600]) expect(isLegacyChartTimePoint(u)).toBe(false)
  })

  it('toUnixTimeBase converts legacy points and stamps the drawing', () => {
    const d = toUnixTimeBase({ type: 'trendline', points: [{ time: toChartTime(a), price: 1 }, { time: lastBar, price: 2 }] })
    expect(d.tb).toBe('unix')
    expect(d.points.map(p => p.time)).toEqual([a, lastBar])
  })
})

describe('the overlay working copy (toRawUnixView / stampTimeBase / pointChartTime)', () => {
  const u = Date.UTC(2026, 9, 29, 13, 30) / 1000          // 09:30 EDT
  it('re-expresses only legacy agent drawings, keeps identity otherwise', () => {
    const manual = { id: 'm', type: 'vertical', points: [{ time: u }] }
    const legacy = { id: 'a', type: 'vertical', points: [{ time: toChartTime(u) }] }
    const list = [manual, legacy]
    const view = toRawUnixView(list)
    expect(view[0]).toBe(manual)
    expect(view[1]).toEqual({ ...legacy, tb: 'unix', points: [{ time: u }] })
    const clean = [manual]
    expect(toRawUnixView(clean)).toBe(clean)
  })
  it('stamps numeric-point writes; LWC is asked in chart time', () => {
    expect(stampTimeBase({ points: [{ time: u, price: 1 }] }).tb).toBe('unix')
    expect(stampTimeBase({ points: [{ time: '2026-10-29', price: 1 }] }).tb).toBeUndefined()
    expect(stampTimeBase({ color: 'red' })).toEqual({ color: 'red' })
    expect(pointChartTime(u)).toBe(toChartTime(u))
    expect(pointChartTime('2026-10-29')).toBe('2026-10-29')
  })
})

describe('chart drawing writes are stamped (useChartDrawings, the chart write door)', () => {
  it('addDrawing converts a legacy chart-time point and stamps; updateDrawing stamps numeric points', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { default: useChartDrawings } = await import('./useChartDrawings')
    const read = () => JSON.parse(localStorage.getItem('uct-chart-drawings') || '{}').TBTEST || []
    const { result } = renderHook(() => useChartDrawings('TBTEST'))
    const u = Date.UTC(2026, 9, 29, 13, 30) / 1000
    let id, id2
    act(() => { id = result.current.addDrawing({ type: 'vertical', points: [{ time: toChartTime(u) }], color: '#fff' }) })
    const d = read().find(x => x.id === id)
    expect(d.tb).toBe('unix')
    expect(d.points[0].time).toBe(u)
    act(() => { id2 = result.current.addDrawing({ type: 'horizontal', points: [{ price: 5 }] }) })
    act(() => { result.current.updateDrawing(id2, { color: '#000' }) })
    expect(read().find(x => x.id === id2).tb).toBeUndefined()
    act(() => { result.current.updateDrawing(id2, { points: [{ time: u, price: 5 }] }) })
    expect(read().find(x => x.id === id2).tb).toBe('unix')
  })
})
