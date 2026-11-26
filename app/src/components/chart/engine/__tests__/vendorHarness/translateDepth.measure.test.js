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
  try { withMemberDoorClock(() => translatePine(source, shape.opts())) } catch (e) { threw = String(e && e.message).slice(0, 120) }
  const w = lastTranslateWindow()
  return { steps: w && w.steps, stackTrips: w && w.stackTrips, threw }
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
          wrappedStackTrips: a.stackTrips, stackTrips: b.stackTrips, steps: b.steps, threw: b.threw }
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
