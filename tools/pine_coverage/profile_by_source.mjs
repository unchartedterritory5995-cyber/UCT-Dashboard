// tools/pine_coverage/profile_by_source.mjs
//
// A V8 CPU profile (CDP `Profiler.stop`, written by `host_lane_browser_probe.py`) -> self time by
// ORIGINAL source file, through the production build's hidden sourcemaps (`app/dist/.maps`,
// `scripts/stash-sourcemaps.mjs`). Answers "which code was the main thread running", in a minified
// bundle, without trusting a mangled function name.
//
//   node tools/pine_coverage/profile_by_source.mjs <file.cpuprofile> [--dist app/dist] [--top 15]
//        [--from <ms> --to <ms>]   (a window, in ms from the profile's start)
//
// Prints JSON: { totalMs, idleMs, programMs, gcMs, byFile: [[file, ms]...], byGroup: {...} }.
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const require = createRequire(join(REPO, 'app', 'package.json'))
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping')

const args = process.argv.slice(2)
const file = args[0]
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d }
const dist = resolve(opt('--dist', join(REPO, 'app', 'dist')))
const top = Number(opt('--top', 15))
const from = opt('--from', null) === null ? null : Number(opt('--from'))
const to = opt('--to', null) === null ? null : Number(opt('--to'))

const prof = JSON.parse(readFileSync(file, 'utf8'))
const byId = new Map(prof.nodes.map((n) => [n.id, n]))
const self = new Map()
let t = 0
for (let i = 0; i < prof.samples.length; i += 1) {
  t += (prof.timeDeltas[i] || 0) / 1000
  if (from !== null && t < from) continue
  if (to !== null && t > to) continue
  const id = prof.samples[i]
  const dt = (prof.timeDeltas[i + 1] || 0) / 1000
  self.set(id, (self.get(id) || 0) + dt)
}

const maps = new Map()
function mapFor(url) {
  if (maps.has(url)) return maps.get(url)
  let m = null
  try {
    const name = basename(new URL(url).pathname)
    const p = join(dist, '.maps', `${name}.map`)
    if (existsSync(p)) m = new TraceMap(readFileSync(p, 'utf8'))
  } catch { m = null }
  maps.set(url, m)
  return m
}

const byFile = new Map()
let idle = 0
let program = 0
let gc = 0
let total = 0
for (const [id, ms] of self) {
  total += ms
  const n = byId.get(id)
  const cf = n.callFrame
  if (cf.functionName === '(idle)') { idle += ms; continue }
  if (cf.functionName === '(program)') { program += ms; continue }
  if (cf.functionName === '(garbage collector)') { gc += ms; continue }
  let key = cf.url || `(native ${cf.functionName || 'anonymous'})`
  const m = cf.url ? mapFor(cf.url) : null
  if (m) {
    const pos = originalPositionFor(m, { line: cf.lineNumber + 1, column: Math.max(0, cf.columnNumber) })
    if (pos && pos.source) key = pos.source.replace(/^(\.\.\/)+/, '').replace(/\\/g, '/')
  } else if (cf.url) {
    key = basename(new URL(cf.url).pathname)
  }
  byFile.set(key, (byFile.get(key) || 0) + ms)
}

const group = (f) => {
  if (/engine\/ast\//.test(f)) return 'host lane (engine/ast)'
  if (/engine\/astColumns|engine\/nativeRegistry|engine\/objectColumns|engine\/objectRuntime/.test(f)) return 'host lane glue (astColumns/nativeRegistry/objects)'
  if (/engine\/runtime\//.test(f)) return 'runtime lane (main-thread side)'
  if (/engine\/binder|engine\/pool|engine\/paneLayout|engine\//.test(f)) return 'chart engine (binder/pool/…)'
  if (/lightweight-charts/.test(f)) return 'lightweight-charts'
  if (/react-dom|scheduler/.test(f)) return 'react'
  if (/StockChart|components\/chart\//.test(f)) return 'StockChart'
  return 'other'
}
const byGroup = {}
for (const [f, ms] of byFile) byGroup[group(f)] = (byGroup[group(f)] || 0) + ms
const r = (x) => Math.round(x)
console.log(JSON.stringify({
  totalMs: r(total), idleMs: r(idle), programMs: r(program), gcMs: r(gc),
  byGroup: Object.fromEntries(Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r(v)])),
  byFile: [...byFile].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => [k, r(v)]),
}, null, 1))
