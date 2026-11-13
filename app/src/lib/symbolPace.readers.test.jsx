// app/src/lib/symbolPace.readers.test.jsx
//
// ─── EVERY PER-SYMBOL READ OF A CHART GOES THROUGH THE REST GATE ─────────────
//
// `symbolPace.test.jsx` pins the gate. This file pins that the readers a chart mounts are
// behind it: the REAL hooks, the real fetchers, a real `fetch` that is counted. The first
// change of this programme that was tested only through its own unit never ran for a
// member (the weekly pre-load, #1196); these cases drive what the chart drives.
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
import useDelisted from '../hooks/useDelisted'
import useSingleStockEtfs from '../hooks/useSingleStockEtfs'
import useTickerMeta from '../hooks/useTickerMeta'
import useTickerIpo from '../hooks/useTickerIpo'
import useFundamentalSnapshot from '../hooks/useFundamentalSnapshot'
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
  { name: 'delisted', part: '/api/delisted/', Use: ({ sym }) => { useDelisted(sym); return null } },
  { name: 'leveraged family', part: '/api/single-stock-etfs/', Use: ({ sym }) => { useSingleStockEtfs(sym); return null } },
  { name: 'name and sector', part: '/api/ticker-meta/', Use: ({ sym }) => { useTickerMeta(sym); return null } },
  { name: 'listing date', part: '/api/ticker-ipo/', Use: ({ sym }) => { useTickerIpo(sym); return null } },
  { name: 'snapshot', part: '/api/research/snapshot/', Use: ({ sym }) => { useFundamentalSnapshot(sym, true); return null } },
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
  await wait(3000)                                         // and stops on the last
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

// ─── source rails ────────────────────────────────────────────────────────────
// Comments are stripped first: a sentence that names the helper is not a call of it.
const code = (rel) => readFileSync(resolve(SRC, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

describe('the readers that cannot be mounted here are wired in source', () => {
  it('the chart\'s event markers are read through the gate', () => {
    const src = code('components/StockChart.jsx')
    expect(src).toMatch(/import \{ useRestedSWR \} from '\.\.\/lib\/symbolPace'/)
    const at = src.indexOf('markersKeyOf(sym) : null')
    expect(at, 'the markers read is still here').toBeGreaterThan(0)
    const call = src.slice(src.lastIndexOf('const {', at), at)
    expect(call).toMatch(/markersData\s*\}\s*=\s*useRestedSWR\(/)
  })

  it('⛔ a POLLING read never goes through `useRestedSWR` (the polling rail counts `useSWR` sites)', () => {
    const files = ['hooks/useDelisted.js', 'hooks/useSingleStockEtfs.js', 'hooks/useTickerMeta.js', 'components/chart/AdjustmentLabel.jsx', 'components/StockChart.jsx']
    const offenders = []
    for (const rel of files) {
      const src = code(rel)
      let from = 0
      for (;;) {
        const i = src.indexOf('useRestedSWR(', from)
        if (i < 0) break
        // the call's own argument list (balanced parentheses from its opening one)
        let depth = 0; let j = i + 'useRestedSWR'.length
        for (; j < src.length; j++) { if (src[j] === '(') depth += 1; else if (src[j] === ')') { depth -= 1; if (!depth) break } }
        if (/refreshInterval/.test(src.slice(i, j))) offenders.push(rel)
        from = j
      }
    }
    expect(offenders).toEqual([])
    // CONTROL: the check sees a poll when one is there
    const planted = "const x = useRestedSWR(key, f, { refreshInterval: 30_000 })"
    const i = planted.indexOf('useRestedSWR(')
    expect(/refreshInterval/.test(planted.slice(i))).toBe(true)
    // and the reader that DOES poll keeps its own `useSWR` call, with the gate beside it
    const ipo = code('hooks/useTickerIpo.js')
    expect(ipo).toMatch(/useSWR\(\s*key,/)
    expect(ipo).toMatch(/isPaused: rest\.isPaused/)
    expect(ipo).not.toMatch(/useRestedSWR\(/)
  })
})
