/**
 * THE CANDLE SERIES' `data()` HOLDS THE ROWS UNPAINTED (review of #2632). With net-change colours on, the candles are
 * set through the render window's SET_DATA_PAINTED: the library holds painted rows, but `data()` returns the rows the
 * app handed `setData`, without the colours (windowedChart.js `data`). No reader used a colour when that changed. This
 * pins it: every place that reads the candle series' `data()` is listed below with what it reads, found from SOURCE,
 * so a NEW reader fails here until someone decides whether it reads a colour (it must use `dataByIndex`, which reads
 * the library's painted rows, if it does).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')   // app/src
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/')

/** Every candle `data()` read, as `file :: the line, trimmed`, with what it reads. */
const KNOWN = {
  'components/StockChart.jsx :: const d = candleSeriesRef.current?.data?.()': 'renderedTail: time and OHLC',
  'components/StockChart.jsx :: const d = candleSeries?.data?.() || []': 'the newest real candle: whitespace and time',
  'components/StockChart.jsx :: const d = s.candleRef.current?.data?.() || []': 'the frame restate: whitespace and time',
  'components/StockChart.jsx :: const _newestOf = () => candleSeriesRef.current?.data?.()?.length || __heavy.committed.filteredBars.length': 'length',
  'components/StockChart.jsx :: const d = candleSeriesRef.current?.data?.() || []': "_logicalOffsetOf: whitespace and time",
  "components/chart/legacyLiveWriters.js :: const _has = typeof _series.data === 'function' && _series.data().some(p => p && p.time === _cb.time)": 'time (a final correction: does the series hold that bar?)',
  'components/chart/newestSeriesBar.js :: get count() { try { return series.data().length } catch { return null } },': 'count',
}
/** Files that read `data()` of a series handed in as the candles under another name (scanned for any `.data()`). */
const INDIRECT = {
  'components/chart/legacyLiveWriters.js': /\b_series\.data\(\)/,
  'components/chart/newestSeriesBar.js': /\bseries\.data\(\)/,
}
const CANDLE_DATA = /candle[A-Za-z]*(\.current)?\??\.data\??\.?\(\)/i
const isComment = (s) => s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p, out) }
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

describe('the candle series\' data() readers', () => {
  it('every reader is listed with what it reads (a new one is a decision: data() is unpainted)', () => {
    const found = []
    for (const f of walk(path.join(SRC, 'components')).concat(walk(path.join(SRC, 'pages')))) {
      const r = rel(f)
      const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
      for (const raw of lines) {
        const s = raw.trim()
        if (!s || isComment(s)) continue
        if (CANDLE_DATA.test(s) || (INDIRECT[r] && INDIRECT[r].test(s))) found.push(`${r} :: ${s}`)
      }
    }
    expect(found.length).toBeGreaterThanOrEqual(Object.keys(KNOWN).length)   // the scan sees them (or this proves nothing)
    const unknown = found.filter((k) => !(k in KNOWN))
    expect(unknown, 'a new candle data() reader: data() holds the rows UNPAINTED (read a colour via dataByIndex); check it and list it in KNOWN').toEqual([])
    const gone = Object.keys(KNOWN).filter((k) => !found.includes(k))
    expect(gone, 'a listed reader is gone: drop it from KNOWN').toEqual([])
  })
})
