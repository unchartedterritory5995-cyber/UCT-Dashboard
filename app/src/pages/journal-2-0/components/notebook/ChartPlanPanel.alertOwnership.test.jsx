// @vitest-environment jsdom
// Finish program, lane FE, finding C1 — two callers of ONE alert sync on ONE symbol.
//
// The Notebook's plan panel and every chart both mount `useBoundDrawingAlerts`. The panel
// hands it the NOTE's drawings (ids `nb:<embedId>:<id>`); a chart hands it the member's own
// per-symbol drawings. Each used to treat "this alert's drawing is not in MY list" as "the
// member deleted it", so each deleted the other's alerts.
//
// ⛔ The assertions are on REQUESTS (which DELETEs reached the fake alerts API), never on
// state: the defect is destructive on the wire and invisible in the panel.
//
// The chart side is `ChartCaller`, which calls the hook with EXACTLY the argument keys
// `StockChart.jsx` passes; the last test reads StockChart's source and fails if that call
// ever gains or loses a key, so the stand-in cannot drift from the real caller.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'
import ChartPlanPanel, { boundAlertId } from './ChartPlanPanel'
import useBoundDrawingAlerts, { _resetBoundAlertSync } from '../../../../components/chart/useBoundDrawingAlerts'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({ addSeries: () => ({}), timeScale: () => ({}), remove: () => {} }),
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
  CandlestickSeries: {}, LineStyle: { Dashed: 2 }, ColorType: { Solid: 'solid' },
}))

const line = (id, price) => ({ id, type: 'horizontal', points: [{ time: 1758000000, price }] })
const noteAttrs = (annotations, embedId = 'emb-1') => ({
  widgetId: 'chart', embedId, params: { symbol: 'AMD', tf: 'D', to: '2026-03-13' },
  annotations, ta: null, capturedAt: '2026-03-13T20:00:00Z',
})
const alertRow = (id, drawingId, price) => ({
  id, sym: 'AMD', is_active: 1, drawing_id: drawingId, alert_type: 'line', target_price: price,
  anchor_t1: null, anchor_p1: null, anchor_t2: null, anchor_p2: null,
})

let calls
let alertsList
const realFetch = global.fetch
beforeEach(() => {
  _resetBoundAlertSync()
  calls = []
  alertsList = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    calls.push({ url: String(url), method })
    const ok = (data) => ({ ok: true, status: 200, json: async () => data })
    if (String(url) === '/api/watchlist-alerts') return ok(alertsList)
    if (String(url).startsWith('/api/watchlist-alerts/bound/')) return ok({ ok: true })
    return ok({})
  })
})
afterEach(() => { global.fetch = realFetch })

const deletes = () => calls.filter((c) => c.method === 'DELETE').map((c) => decodeURIComponent(c.url))
const listFetched = () => calls.some((c) => c.url === '/api/watchlist-alerts')
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })

// The chart's call, key for key (see the source check at the bottom of this file).
const noBars = () => []
function ChartCaller({ drawings }) {
  useBoundDrawingAlerts({ sym: 'AMD', drawings, tf: 'D', etOffset: -14400, getBars: noBars })
  return null
}

function Both({ chartDrawings, annotations, panel = true, chart = true, embedId = 'emb-1' }) {
  return (
    <>
      {chart && <ChartCaller drawings={chartDrawings} />}
      {panel && (
        <ChartPlanPanel attrs={noteAttrs(annotations, embedId)} noteId="note-1" open={false} updateAttributes={vi.fn()} />
      )}
    </>
  )
}
const mountBoth = (props) => {
  const cache = new Map()
  const wrap = (p) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><Both {...p} /></SWRConfig>
  )
  const view = render(wrap(props))
  return { ...view, rerenderWith: (p) => view.rerender(wrap(p)) }
}

describe('C1 — a note chart and a Charts chart on one symbol never delete each other’s alerts', () => {
  it('scenario A: opening a note with a drawn line sends NO delete for the member’s Charts alert', async () => {
    alertsList = [alertRow('a-charts', 'c1', 150)]
    // The chart is up first (it has SEEN c1); then the note's panel mounts beside it.
    const view = mountBoth({ chartDrawings: [line('c1', 150)], annotations: [line('n1', 140)], panel: false })
    await waitFor(() => expect(listFetched()).toBe(true))
    await settle()
    view.rerenderWith({ chartDrawings: [line('c1', 150)], annotations: [line('n1', 140)], panel: true })
    await settle()
    expect(deletes()).toEqual([])
  })

  it('scenario B: a plan alert armed in the note is NOT deleted by the chart, which holds other lines', async () => {
    alertsList = [alertRow('a-note', boundAlertId('emb-1', 'n1'), 140)]
    // The note is open first (its panel has SEEN the plan line); then a chart of AMD mounts.
    const view = mountBoth({ chartDrawings: [line('c1', 150)], annotations: [line('n1', 140)], chart: false })
    await waitFor(() => expect(listFetched()).toBe(true))
    await settle()
    view.rerenderWith({ chartDrawings: [line('c1', 150)], annotations: [line('n1', 140)], chart: true })
    await settle()
    expect(deletes()).toEqual([])
  })

  it('a second note’s plan alert on the same symbol is not this note’s to delete', async () => {
    alertsList = [alertRow('a-other', boundAlertId('emb-2', 'n1'), 140)]
    const cache = new Map()
    render(
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <ChartPlanPanel attrs={noteAttrs([line('n1', 140)], 'emb-2')} noteId="note-2" open={false} updateAttributes={vi.fn()} />
        <ChartPlanPanel attrs={noteAttrs([line('zz', 99)], 'emb-1')} noteId="note-1" open={false} updateAttributes={vi.fn()} />
      </SWRConfig>,
    )
    await waitFor(() => expect(listFetched()).toBe(true))
    await settle()
    expect(deletes()).toEqual([])
  })

  it('CONTROL — each caller still deletes ITS OWN alert when its own line is removed', async () => {
    alertsList = [alertRow('a-charts', 'c1', 150), alertRow('a-note', boundAlertId('emb-1', 'n1'), 140)]
    const view = mountBoth({ chartDrawings: [line('c1', 150), line('c2', 151)], annotations: [line('n1', 140), line('n2', 141)] })
    await waitFor(() => expect(listFetched()).toBe(true))
    await settle()
    expect(deletes()).toEqual([])
    // the member deletes the NOTE's line: only the note's alert goes
    view.rerenderWith({ chartDrawings: [line('c1', 150), line('c2', 151)], annotations: [line('n2', 141)] })
    await waitFor(() => expect(deletes().length).toBe(1))
    expect(deletes()).toEqual([`/api/watchlist-alerts/bound/${boundAlertId('emb-1', 'n1')}`])
    // then the CHARTS line: only the chart's alert goes
    view.rerenderWith({ chartDrawings: [line('c2', 151)], annotations: [line('n2', 141)] })
    await waitFor(() => expect(deletes().length).toBe(2))
    expect(deletes()[1]).toBe('/api/watchlist-alerts/bound/c1')
  })

  it('CENSUS — the hook has exactly two callers, and only the Notebook one hands it its own drawing list', () => {
    // Why C1 cannot happen with the chart-plan flag off: every chart hands the hook the symbol's
    // ONE shared drawing list, so two charts never disagree; the plan panel is the only caller
    // with a list of its own, and it mounts only behind the flag. A third caller with a third
    // list must pass a namespace: this rail is where that decision gets made, by name.
    const here = dirname(fileURLToPath(import.meta.url))
    const srcRoot = resolve(here, '../../../..')
    const callers = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue }
        if (!/\.(js|jsx)$/.test(name) || /\.test\.(js|jsx)$/.test(name)) continue
        const code = readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
        if (/\buseBoundDrawingAlerts\(\{/.test(code) && !/export default function useBoundDrawingAlerts/.test(code)) {
          callers.push(p.slice(srcRoot.length + 1).split(sep).join('/'))
        }
      }
    }
    walk(srcRoot)
    expect(callers.sort()).toEqual([
      'components/StockChart.jsx',
      'pages/journal-2-0/components/notebook/ChartPlanPanel.jsx',
    ])
  })

  it('the stand-in calls the hook with the same argument keys StockChart does', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../../../../components/StockChart.jsx'), 'utf8')
    const m = src.match(/useBoundDrawingAlerts\(\{([\s\S]*?)\}\)\s*\n/)
    expect(m).not.toBeNull()
    const keys = [...m[1].matchAll(/(?:^|[,{\n])\s*([A-Za-z_]\w*)\s*(?=[:,]|\s*$)/gm)].map((x) => x[1])
    expect([...new Set(keys)].sort()).toEqual(['drawings', 'etOffset', 'getBars', 'sym', 'tf'])
  })
})
