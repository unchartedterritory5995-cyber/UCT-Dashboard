// app/scripts/measure-pine-runtime.mjs
//
// THE FIRST MEASURED BARE-NODE RUN (docs/pine/SERVER-RUNTIME-DESIGN.md T1): imports the built
// server bundle and runs a Pine document over N daily bars, with NO node_modules reachable.
// Prints ONE JSON line: bars, wall ms (import, cold run, warm runs), RSS/heap, column digest.
//
//   node scripts/measure-pine-runtime.mjs --bundle <pine-runtime.mjs> --bars <series.json> [--n 5000] [--runs 5]
//
// `--bars` is a committed capture whose `bars.rows` are `[t,o,h,l,c,v]`. The Pine source is a
// fixed, first-party indicator (below); no vendor script text is read or embedded.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE = `//@version=5
indicator("bare-node probe", overlay=false)
fast = ta.ema(close, 12)
slow = ta.ema(close, 26)
macd = fast - slow
sig = ta.ema(macd, 9)
rsi = ta.rsi(close, 14)
atr = ta.atr(14)
plot(macd, "macd")
plot(sig, "signal")
plot(rsi, "rsi")
plot(atr, "atr")
`

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const bundle = arg('bundle')
const barsFile = arg('bars')
const n = Number(arg('n', '5000'))
const runs = Number(arg('runs', '5'))
if (!bundle || !barsFile) throw new Error('usage: --bundle <pine-runtime.mjs> --bars <series.json> [--n 5000] [--runs 5]')

const t0 = performance.now()
const rt = await import(pathToFileURL(resolve(bundle)).href)
const importMs = performance.now() - t0

const cap = JSON.parse(readFileSync(resolve(barsFile), 'utf8'))
const rows = cap.bars.rows.slice(-n)
if (rows.length !== n) throw new Error(`series has ${rows.length} bars, need ${n}`)
const fresh = () => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const def = {
  id: 'bare-node-probe', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:bare-node-probe', outputs: { macd: 0, signal: 1, rsi: 2, atr: 3 }, source: SOURCE },
}
const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

const times = []
let cols
for (let k = 0; k < runs; k += 1) {
  rt.resetRuntimeSessions(); rt.resetRuntimeLedgers()
  const s = performance.now()
  cols = rt.computeRuntimeColumns(def, fresh(), ctx, { incremental: false })
  times.push(performance.now() - s)
}
const keys = Object.keys(def.compute.outputs)
const h = createHash('sha256')
let finite = 0
for (const key of keys) {
  const col = cols[key]
  if (!col || col.length !== n) throw new Error(`column ${key}: length ${col && col.length}, expected ${n}`)
  const buf = new Float64Array(n)
  for (let i = 0; i < n; i += 1) { const v = col[i]; buf[i] = Number.isFinite(v) ? v : NaN; if (Number.isFinite(v)) finite += 1 }
  h.update(Buffer.from(buf.buffer))
}
const mem = process.memoryUsage()
const sorted = [...times].sort((a, b) => a - b)
console.log(JSON.stringify({
  node: process.version, bars: n, columns: keys.length, finiteValues: finite,
  importMs: Number(importMs.toFixed(1)),
  coldRunMs: Number(times[0].toFixed(1)),
  medianRunMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)),
  runsMs: times.map((t) => Number(t.toFixed(1))),
  rssMb: Number((mem.rss / 1048576).toFixed(1)), heapUsedMb: Number((mem.heapUsed / 1048576).toFixed(1)),
  columnsSha256: h.digest('hex'),
  engine: { SCRIPT_ENGINE_VERSION: rt.SCRIPT_ENGINE_VERSION, RUNTIME_IR_VERSION: rt.RUNTIME_IR_VERSION,
    RUNTIME_FRONTEND_LANGUAGE: rt.RUNTIME_FRONTEND_LANGUAGE, RUNTIME_FRONTEND_VERSION: rt.RUNTIME_FRONTEND_VERSION },
}))
