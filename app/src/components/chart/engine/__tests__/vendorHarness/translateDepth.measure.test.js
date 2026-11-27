// Opt-in measurement (RUNTIME_PERF_CENSUS=translate-depth, an allowlisted remote switch; writes ../remote-out/depth):
// ⭐ e100 part 2 — HOW DEEP DOES THE TRANSLATOR'S RESOLUTION LEGITIMATELY GO? Every committed corpus script, through
// the three lane shapes the member door and the lenient lane call `translatePine` with, twice:
//   (a) with `Resolver.prototype.resolveBinding` wrapped to record, per call, the deepest frame that RETURNED and the
//       deepest that THREW a non-depth error before its resolver tripped the depth bound (`legit`), and the depth at
//       which a resolver first tripped (`trip`, cap or host stack);
//   (b) unwrapped (the wrapper adds a frame a level), recording the call's steps and the host-stack overflows its
//       resolvers turned into the depth refusal (`lastTranslateWindow().stackTrips`).
// A depth cap at or above the largest `legit` refuses no script that resolves today. Asserts nothing about time.
import { describe, it, vi, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { translatePine, lastTranslateWindow, Resolver, PINE_TRANSLATE_MAX_DEPTH } from '../../ast/pine'
import { probeObjectRuntime, withMemberDoorClock } from '../../runtime/runtimeColumns'
import { __resetHostKnownDivergence } from '../../hostKnownDivergence'
import { __resetHeldWithholds } from '../../heldWithholds'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'

const RUN = process.env.RUNTIME_PERF_CENSUS === 'translate-depth'
const OUT = '../remote-out/depth'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FLAGS = ['VITE_PINE_MEMBER_PANE_ENABLED', 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', 'VITE_PINE_RUNTIME_PANE_ENABLED',
  'VITE_PINE_EDITOR_STATUS', 'VITE_PINE_STRATEGY_BROKER_ENABLED', 'VITE_RS_SPLIT_ENABLED']
const SHAPES = {
  H_rt: { flags: () => true, opts: () => ({ paramManifest: true, strict: true, enumInputs: true, declareInputs: 'all',
    objectRuntimeCheck: probeObjectRuntime, refusedPresentation: true }) },
  H_prod: { flags: (f) => f !== 'VITE_PINE_RUNTIME_PANE_ENABLED', opts: () => ({ paramManifest: true, strict: true,
    enumInputs: true, declareInputs: 'all', objectRuntimeCheck: probeObjectRuntime }) },
  L: { flags: () => true, opts: () => ({}) },
}


/** A digest of the WHOLE translation result (identity-insensitive Merkle, from translate-prof's exact.mjs), with the
 *  depth refusal's own number normalised ("nested past N levels"), so two caps compare on everything else. */
function digestOf(root) {
  const memo = new Map()
  const stack = new Set()
  const h = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 32)
  const d = (v, inArray) => {
    if (v === null) return 'n'
    switch (typeof v) {
      case 'undefined': return inArray ? 'n' : undefined
      case 'function': return 'f'
      case 'symbol': return inArray ? 'n' : undefined
      case 'bigint': return 'b' + String(v)
      case 'number': return Number.isFinite(v) ? 'd' + String(v) : 'n'
      case 'boolean': return v ? 't' : 'F'
      case 'string': return 's' + JSON.stringify(v.replace(/nested past \d+ levels/g, 'nested past # levels'))
      default: break
    }
    if (memo.has(v)) return memo.get(v)
    if (stack.has(v)) return 'cycle'
    stack.add(v)
    let out
    if (Array.isArray(v)) out = 'A' + h(v.map((x) => d(x, true)).join(','))
    else if (v instanceof Map) out = 'M' + h([...v.entries()].map(([k, x]) => d(k, true) + ':' + d(x, true)).join(','))
    else if (v instanceof Set) out = 'S' + h([...v].map((x) => d(x, true)).join(','))
    else {
      const parts = []
      if (v instanceof Error) parts.push('name=' + d(v.name), 'message=' + d(v.message))
      const src = typeof v.toJSON === 'function' ? v.toJSON() : v
      if (src !== v) parts.push('toJSON=' + d(src))
      else for (const k of Object.keys(v)) { const x = d(v[k], false); if (x !== undefined) parts.push(JSON.stringify(k) + ':' + x) }
      out = 'O' + h(parts.join(','))
    }
    stack.delete(v)
    memo.set(v, out)
    return out
  }
  return d(root, true)
}

let REC = null
const orig = Resolver.prototype.resolveBinding
function wrapped(...args) {
  const d = this.depth + 1
  const pre = this.depthTripped
  try {
    const r = orig.apply(this, args)
    if (REC && !this.depthTripped && d > REC.ok) REC.ok = d
    return r
  } catch (e) {
    if (REC && !pre) {
      if (!this.depthTripped) { if (d > REC.err) REC.err = d } else if (REC.trip === null) REC.trip = d
    }
    throw e
  }
}

function translate(source, shape) {
  for (const f of FLAGS) vi.stubEnv(f, shape.flags(f) ? '1' : '')
  __resetHostKnownDivergence(); __resetHeldWithholds()
  let threw = null
  let t = null
  try { t = withMemberDoorClock(() => translatePine(source, shape.opts())) } catch (e) { threw = String(e && e.message).slice(0, 120) }
  const w = lastTranslateWindow()
  return { steps: w && w.steps, stackTrips: w && w.stackTrips, threw, digest: threw ? null : digestOf(t), ok: !!(t && t.ok) }
}

describe.runIf(RUN)('translator resolution depth over the committed corpus', () => {
  it('census', () => {
    __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests()
    const rows = []
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      const row = { slug: f.replace(/\.pine$/, ''), shapes: {} }
      for (const [name, shape] of Object.entries(SHAPES)) {
        Resolver.prototype.resolveBinding = wrapped
        REC = { ok: 0, err: 0, trip: null }
        const a = translate(source, shape)
        const rec = REC
        REC = null
        Resolver.prototype.resolveBinding = orig
        const b = translate(source, shape)
        row.shapes[name] = { legit: Math.max(rec.ok, rec.err), ok: rec.ok, err: rec.err, trip: rec.trip,
          wrappedStackTrips: a.stackTrips, stackTrips: b.stackTrips, steps: b.steps, threw: b.threw, digest: b.digest, served: b.ok }
      }
      rows.push(row)
    }
    vi.unstubAllEnvs()
    const all = rows.flatMap((r) => Object.entries(r.shapes).map(([s, v]) => ({ slug: r.slug, shape: s, ...v })))
    const top = (k) => all.slice().sort((x, y) => (y[k] || 0) - (x[k] || 0)).slice(0, 12).map((x) => [x[k], x.slug, x.shape])
    const summary = { node: process.version, cap: PINE_TRANSLATE_MAX_DEPTH, scripts: rows.length,
      legitMax: top('legit'), tripped: all.filter((x) => x.trip !== null).map((x) => [x.slug, x.shape, x.trip]),
      stackTrips: all.filter((x) => x.stackTrips).map((x) => [x.slug, x.shape, x.stackTrips]) }
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'depth.json'), JSON.stringify({ summary, rows }, null, 1))
    // eslint-disable-next-line no-console
    console.log('DEPTH SUMMARY', JSON.stringify(summary))
    expect(rows.length).toBeGreaterThan(200)
  }, 3600000)
})
