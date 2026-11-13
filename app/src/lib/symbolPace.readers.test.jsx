// app/src/lib/symbolPace.readers.test.jsx
//
// ─── EVERY PER-SYMBOL READ OF A CHART GOES THROUGH THE REST GATE ─────────────
//
// `symbolPace.test.jsx` pins the gate. This file pins that the readers a chart mounts are
// behind it: the hooks THE CHART CALLS (components/chart/restedReaders.js, over the real
// generic hooks and their real fetchers), with `fetch` counted. The first change of this
// programme that was tested only through its own unit never ran for a member (the weekly
// pre-load, #1196); these cases drive what the chart drives, and the source rails at the end
// pin that the chart's call sites are the gated ones and nobody else pays for the gate.
//
// The six below are the reads the production measurement counted per chart passed
// (2026-11-13: about 30 of each in a 40-chart run). The chart's event markers are the
// seventh; they are read inside StockChart, which the source rail at the end covers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  useChartDelisted, useChartSingleStockEtfs, useChartTickerMeta, useChartTickerIpo, useChartSnapshot,
} from '../components/chart/restedReaders'
import useTickerMeta from '../hooks/useTickerMeta'
import AdjustmentLabel from '../components/chart/AdjustmentLabel'
import { REST_GATE_OFF_KEY, __resetRestGate } from './symbolPace'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let urls
beforeEach(() => {
  vi.useFakeTimers()
  urls = []
  // every request is counted and left open: what is asserted is what was ASKED
  vi.stubGlobal('fetch', vi.fn((url) => { urls.push(String(url)); return new Promise(() => {}) }))
  localStorage.removeItem(REST_GATE_OFF_KEY)
  __resetRestGate()
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem(REST_GATE_OFF_KEY)
  __resetRestGate()
  vi.useRealTimers()
})

const READERS = [
  { name: 'delisted', part: '/api/delisted/', Use: ({ sym }) => { useChartDelisted(sym); return null } },
  { name: 'leveraged family', part: '/api/single-stock-etfs/', Use: ({ sym }) => { useChartSingleStockEtfs(sym); return null } },
  { name: 'name and sector', part: '/api/ticker-meta/', Use: ({ sym }) => { useChartTickerMeta(sym); return null } },
  { name: 'listing date', part: '/api/ticker-ipo/', Use: ({ sym }) => { useChartTickerIpo(sym); return null } },
  { name: 'snapshot', part: '/api/research/snapshot/', Use: ({ sym }) => { useChartSnapshot(sym, true); return null } },
  { name: 'split basis', part: '/api/adjustment-basis/', Use: ({ sym }) => <AdjustmentLabel sym={sym} tf="D" /> },
]

const wait = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
/** the symbols this reader asked the server for, in order */
const askedFor = (part) => urls.filter((u) => u.includes(part)).map((u) => u.split(part)[1].split(/[/?]/)[0])

async function scan(reader, tag, stepMs) {
  const ui = (sym) => (
    <SWRConfig value={{ provider: () => new Map() }}>
      <reader.Use sym={sym} />
    </SWRConfig>
  )
  const syms = ['A', 'B', 'C', 'D', 'E'].map((x) => `${tag}${x}`)
  const r = render(ui(syms[0]))
  await wait(900)                                          // the member reads the first chart
  for (const s of syms.slice(1)) { act(() => { r.rerender(ui(s)) }); await wait(stepMs) }
  // ...and stops on the last. (Two waits: React arms the ask's own short timer in the commit that
  // follows the hold, and under `act` that commit happens when the first wait returns.)
  await wait(700)
  await wait(2300)
  r.unmount()
  return syms
}

describe('⭐ a chart\'s per-symbol reads wait while the member races through symbols', () => {
  for (const reader of READERS) {
    it(`${reader.name}: the symbols raced past are never asked for; the one stopped on is`, async () => {
      const syms = await scan(reader, `Q${READERS.indexOf(reader)}`, 150)
      // [0] was read, [1] was reached at a reader's pace, [2] and [3] were raced past, [4] is where the member stopped
      expect(askedFor(reader.part)).toEqual([syms[0], syms[1], syms[4]])
    })

    it(`${reader.name}: CONTROL, a scan at a reading pace asks for every symbol`, async () => {
      const syms = await scan(reader, `S${READERS.indexOf(reader)}`, 700)
      expect(askedFor(reader.part)).toEqual(syms)
    })
  }

  it('CONTROL: with the per-browser switch, every reader asks for every symbol at any pace', async () => {
    localStorage.setItem(REST_GATE_OFF_KEY, '1')
    __resetRestGate()
    for (const reader of READERS) {
      urls.length = 0
      const syms = await scan(reader, `K${READERS.indexOf(reader)}`, 150)
      expect(askedFor(reader.part), reader.name).toEqual(syms)
    }
  })
})

// ─── the same hooks, anywhere else in the app ────────────────────────────────
describe('CONTROL: off a chart, the generic hook is an ordinary read at any pace', () => {
  it('name and sector, read by a page that is not a chart, asks for every symbol', async () => {
    const reader = { part: '/api/ticker-meta/', Use: ({ sym }) => { useTickerMeta(sym); return null } }
    const syms = await scan(reader, 'G', 150)
    expect(askedFor(reader.part)).toEqual(syms)
  })

  it('two chart readers of one key (the pane and the chart) that stop together send one request', async () => {
    const Both = ({ sym }) => { useChartTickerMeta(sym); useChartTickerMeta(sym); return null }
    const syms = await scan({ Use: Both }, 'B', 150)
    expect(askedFor('/api/ticker-meta/')).toEqual([syms[0], syms[1], syms[4]])
  })
})

// ─── source rails ────────────────────────────────────────────────────────────
// Comments are stripped first: a sentence that names a hook is not a call of it.
const code = (rel) => readFileSync(resolve(SRC, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

describe('the chart\'s call sites are the gated ones', () => {
  const SITES = [
    ['components/chart/pane/ChartPane.jsx', ['useChartTickerMeta', 'useChartDelisted'], ['hooks/useTickerMeta', 'hooks/useDelisted']],
    ['components/StockChart.jsx', ['useChartTickerMeta', 'useChartTickerIpo'], ['hooks/useTickerMeta', 'hooks/useTickerIpo']],
    ['pages/charts/widgets/ChartWidget.jsx', ['useChartSingleStockEtfs'], ['hooks/useSingleStockEtfs']],
    ['pages/charts/widgets/LeverageInverseControl.jsx', ['useChartSingleStockEtfs'], ['hooks/useSingleStockEtfs']],
    ['components/chart/pane/useHeaderSnapshot.js', ['useChartSnapshot'], ['hooks/useFundamentalSnapshot']],
  ]
  for (const [rel, gated, bare] of SITES) {
    it(`${rel} reads through restedReaders, and no longer through the bare hook`, () => {
      const src = code(rel)
      for (const name of gated) expect(src, name).toMatch(new RegExp(`\\b${name}\\b[^\\n]*from '[^']*restedReaders'`))
      for (const hook of bare) expect(src.includes(`${hook}'`), `still imports ${hook}`).toBe(false)
    })
  }

  it('the chart\'s event markers and the split basis are read through the gate', () => {
    const chart = code('components/StockChart.jsx')
    expect(chart).toMatch(/import \{ useRestedSWR \} from '\.\.\/lib\/symbolPace'/)
    const at = chart.indexOf('markersKeyOf(sym) : null')
    expect(at, 'the markers read is still here').toBeGreaterThan(0)
    expect(chart.slice(chart.lastIndexOf('const {', at), at)).toMatch(/markersData\s*\}\s*=\s*useRestedSWR\(/)
    expect(code('components/chart/AdjustmentLabel.jsx')).toMatch(/const \{ data \} = useRestedSWR\(key, fetchJson/)
  })

  it('⛔ the generic hooks import nothing from the gate: it stays out of the app\'s first bytes', () => {
    const hooks = ['hooks/useDelisted.js', 'hooks/useSingleStockEtfs.js', 'hooks/useTickerMeta.js', 'hooks/useTickerIpo.js', 'hooks/useFundamentalSnapshot.js', 'hooks/useMobileSWR.js']
    const offenders = hooks.filter((rel) => /symbolPace|restedReaders/.test(code(rel)))
    expect(offenders).toEqual([])
    // CONTROL: the check sees an import when one is there
    expect(/symbolPace|restedReaders/.test(code('components/chart/restedReaders.js'))).toBe(true)
    // ...and each of them takes the pause it is handed
    for (const rel of hooks.slice(0, 5)) expect(code(rel), rel).toMatch(/\.\.\.\(isPaused && \{ isPaused \}\)/)
  })

  it('⛔ a POLLING read never goes through `useRestedSWR` (the polling rail counts `useSWR` sites)', () => {
    const offenders = []
    for (const rel of ['components/chart/AdjustmentLabel.jsx', 'components/StockChart.jsx']) {
      const src = code(rel)
      let from = 0
      for (;;) {
        const i = src.indexOf('useRestedSWR(', from)
        if (i < 0) break
        let depth = 0; let j = i + 'useRestedSWR'.length
        for (; j < src.length; j++) { if (src[j] === '(') depth += 1; else if (src[j] === ')') { depth -= 1; if (!depth) break } }
        if (/refreshInterval/.test(src.slice(i, j))) offenders.push(rel)
        from = j
      }
    }
    expect(offenders).toEqual([])
    // CONTROL: the check sees a poll when one is there
    expect(/refreshInterval/.test('const x = useRestedSWR(key, f, { refreshInterval: 30_000 })')).toBe(true)
    // the reader that DOES poll keeps its own `useSWR` call
    expect(code('hooks/useTickerIpo.js')).toMatch(/useSWR\(\s*tickerIpoKey\(sym\),/)
  })
})
