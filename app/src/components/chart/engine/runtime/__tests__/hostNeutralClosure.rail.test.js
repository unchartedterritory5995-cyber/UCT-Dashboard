// @vitest-environment node
// app/src/components/chart/engine/runtime/__tests__/hostNeutralClosure.rail.test.js
//
// ⭐⭐ W5-T2 — THE HOST-NEUTRAL CLOSURE (docs/pine/SERVER-RUNTIME-DESIGN.md 2.1, 2.2 H3/H4/H5,
// section 7 T2, section 8 step 4). One semantic source runs on two hosts, so:
//   * the compute closure imports no network module, no build gate and no transport
//     (`tools/pine_runtime_closure.mjs --check`, railed here and proved able to fail);
//   * every wall clock a run reads is the host's to inject (`opts.now`): the pane budget,
//     the VM's `WALL_TIME` and the translator's `pine:timeout`. Proved by running with
//     `Date.now`, `performance.now` and `fetch` all throwing;
//   * the two cut edges still work at their doors: the C18 values register through a leaf
//     (`objectRuntimeSeam.js`), the lower-timeframe gate through another
//     (`lowerTfServing.js`, registered by `lowerTfGate.js`, imported by the registry).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { walk, findings, ROOTS } from '../../../../../../../tools/pine_runtime_closure.mjs'
import { buildPineRuntime } from '../../../../../../scripts/build-pine-runtime.mjs'
import {
  computeRuntimeColumns, runtimeObjectValues, resetRuntimeSessions, resetRuntimeLedgers,
} from '../runtimeColumns.js'
import {
  translatePine, Resolver, withTranslateClock, beginTranslateBudget, endTranslateBudget,
  translateBudgetExpired, tickTranslateBudget,
} from '../../ast/pine.js'
import { TABLE } from '../../ast/parse.js'
import { registeredObjectRuntimeValues, registerObjectRuntimeValues as viaSeam } from '../../objectRuntimeSeam.js'
import { registerObjectRuntimeValues as viaColumns } from '../../objectColumns.js'
import { registerLowerTfGate, lowerTfServingEnabled as servedAtTranslator } from '../../lowerTfServing.js'
import { lowerTfServingEnabled as flagAtDoor } from '../../lowerTfGate.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition.js'

const APP = path.resolve(process.cwd())
const REPO = path.resolve(APP, '..')
const TOOL = path.join(REPO, 'tools', 'pine_runtime_closure.mjs')

const doc = (body, { head = 'indicator("hn")', outputs = { a: 0 }, listing = true } = {}) => ({
  id: 'rt-hn', meta: listing ? { runtimeHistory: 'listing' } : {},
  compute: { kind: 'runtime', fn: 'runtime:rt-hn', outputs, source: `//@version=5\n${head}\n${body}` },
})
const mk = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 3 * Math.sin(i / 4) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const FROM_LISTING = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const OFF_LISTING = { tf: 'D', newestBarIsForming: false }

/** Runs `fn` with every host wall clock throwing; returns how many reads were attempted. */
function clocksForbidden(fn) {
  let reads = 0
  const boom = () => { reads += 1; throw new Error('W5-T2: a host wall clock was read') }
  const d = vi.spyOn(Date, 'now').mockImplementation(boom)
  const p = vi.spyOn(performance, 'now').mockImplementation(boom)
  try { return { value: fn(), reads } } catch (err) { return { error: err, reads } } finally { d.mockRestore(); p.mockRestore() }
}
const counting = () => { let t = 0; const f = () => { f.calls += 1; t += 1; return t }; f.calls = 0; return f }

afterEach(() => { resetRuntimeSessions(); resetRuntimeLedgers(); vi.unstubAllEnvs() })

describe('the compute closure (tools/pine_runtime_closure.mjs)', () => {
  it('is host-neutral: no forbidden module, network, build flag, uninjectable clock or unwatched file', () => {
    const closure = walk()
    expect(closure.unresolved).toEqual([])
    expect(findings(closure)).toEqual([])
    expect([...closure.bare.keys()]).toEqual(['jsep'])
    // liveTail.js (F2, 2026-11-10): the benchmark tail store; `defSchema.js` reads its grammar from the leaf `liveTailSchema.js`
    for (const m of ['nativeRegistry.js', 'objectColumns.js', 'serverCompute.js', 'runtimeKill.js', 'runtimePaneGate.js', 'lowerTfGate.js', 'liveTail.js']) {
      expect(closure.modules.has(`app/src/components/chart/engine/${m}`), m).toBe(false)
    }
  })

  it('--check exits 0 on this tree and says so', () => {
    const r = spawnSync(process.execPath, [TOOL, '--check'], { encoding: 'utf8', timeout: 60000 })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('closure: host-neutral (0 findings)')
  })

  it('CONTROL — on a tree that breaks every rule, each rule is a named finding and --check is red', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'pine-closure-ctl-'))
    const eng = path.join(repo, 'app', 'src', 'components', 'chart', 'engine')
    mkdirSync(path.join(eng, 'runtime'), { recursive: true })
    mkdirSync(path.join(repo, 'app', 'src', 'other'), { recursive: true })
    writeFileSync(path.join(eng, 'runtime', 'runtimeColumns.js'), [
      "import '../nativeRegistry.js'",
      "import x from 'lodash'",
      "import j from 'jsep'",
      "import '../../../../other/y.js'",
      'const t = Date.now()',
      "// fetch('/a comment is not code') import" + ".meta.env",
      "const url = 'http://not-a-comment'",
    ].join('\n'))
    // line 1: a string holding a slash-star must not open a comment that hides the fetch on line 2
    // (spelled in pieces: vite's own transform reads a slash-star or an env read even inside a string)
    writeFileSync(path.join(eng, 'nativeRegistry.js'), "const glob = 'src/" + "*.js'\nexport const f = () => fetch('/x')\nconst g = import" + ".meta.env\n")
    writeFileSync(path.join(eng, 'runtime', 'serverEntry.js'), "export * from './runtimeColumns.js'\n")
    writeFileSync(path.join(repo, 'app', 'src', 'other', 'y.js'), 'export const y = 1\n')
    const closure = walk(ROOTS, repo)
    expect(closure.unresolved).toEqual([])
    const got = findings(closure, { repo })
    const has = (re) => expect(got.some((f) => re.test(f)), String(re)).toBe(true)
    has(/^forbidden module app\/src\/components\/chart\/engine\/nativeRegistry\.js .*runtimeColumns\.js -> .*nativeRegistry\.js$/)
    has(/^network in the closure at app\/src\/components\/chart\/engine\/nativeRegistry\.js:2:/)
    has(/^build flag in the closure at app\/src\/components\/chart\/engine\/nativeRegistry\.js:3:/)
    has(/^bare import 'lodash'/)
    has(/^wall clock the host cannot inject at app\/src\/components\/chart\/engine\/runtime\/runtimeColumns\.js:5:/)
    has(/^stale ALLOWED_CLOCKS entry: app\/src\/components\/chart\/engine\/runtime\/vm\.js/)
    has(/^outside the service's watch patterns: app\/src\/other\/y\.js/)
    has(/^door registration missing: app\/src\/components\/chart\/engine\/nativeRegistry\.js no longer reaches .*lowerTfGate\.js/)
    expect(got.some((f) => f.startsWith("bare import 'jsep'"))).toBe(false)
    expect(got.filter((f) => /runtimeColumns\.js:[67]:/.test(f))).toEqual([])
    // the CLI on the same tree: red (1), naming the module
    const red = spawnSync(process.execPath, [TOOL, '--check', '--repo', repo], { encoding: 'utf8', timeout: 60000 })
    expect(red.status).toBe(1)
    expect(red.stdout).toContain('FINDING forbidden module app/src/components/chart/engine/nativeRegistry.js')
    // ...and a tree the walk cannot even enter is 2, never clean
    const empty = mkdtempSync(path.join(tmpdir(), 'pine-closure-empty-'))
    const none = spawnSync(process.execPath, [TOOL, '--check', '--repo', empty], { encoding: 'utf8', timeout: 60000 })
    expect(none.status).toBe(2)
    expect(none.stderr).toContain('cannot resolve')
  })
})

describe('every wall clock a run reads is injectable (opts.now)', () => {
  const body = 'e = ta.ema(close, 5)\nplot(e + ta.sma(close, 3))\n'

  it('CONTROL — with no clock injected the run reads the host clock (so the spies can see a read)', () => {
    const r = clocksForbidden(() => computeRuntimeColumns(doc(body), mk(60), FROM_LISTING, { incremental: false }))
    expect(r.reads).toBeGreaterThan(0)
    expect(r.error).toBeTruthy()
  })

  it('from the listing, under the pane budget: the injected clock is the only clock read', () => {
    const now = counting()
    const r = clocksForbidden(() => computeRuntimeColumns(doc(body), mk(60), FROM_LISTING, { incremental: false, budgetMs: 1e9, now }))
    expect(r.error).toBeUndefined()
    expect(r.reads).toBe(0)
    expect(Number.isFinite(r.value.a[59])).toBe(true)
    expect(now.calls).toBeGreaterThan(2)
    // the run's clock was SCOPED: a translation after it reads the host's clock again
    const after = clocksForbidden(() => translatePine('//@version=5\nindicator("hn")\nplot(close)\n'))
    expect(after.reads, 'withTranslateClock restored the clock').toBeGreaterThan(0)
  })

  it('off the listing (the warm-up curtain\'s two runs) and with sessions on', () => {
    const now = counting()
    const r = clocksForbidden(() => computeRuntimeColumns(doc(body), mk(200), OFF_LISTING, { budgetMs: 1e9, now }))
    expect(r.error).toBeUndefined()
    expect(r.reads).toBe(0)
    expect(Number.isFinite(r.value.a[199])).toBe(true)
  })

  it('in a calc_bars_count window whose run reads bar_index (the window\'s probe budget)', () => {
    const now = counting()
    const d = doc('plot(close + (bar_index - bar_index[1]))\n', { head: 'indicator("hn", calc_bars_count = 20)' })
    const r = clocksForbidden(() => computeRuntimeColumns(d, mk(60), FROM_LISTING, { incremental: false, budgetMs: 1e9, now }))
    expect(r.error).toBeUndefined()
    expect(r.reads).toBe(0)
    expect(Number.isFinite(r.value.a[59])).toBe(true)
  })

  it('the VM\'s WALL_TIME reads the injected clock: a clock that leaps stops the run by name', () => {
    let t = 0
    const leap = () => { t += 1e7; return t }
    expect(() => computeRuntimeColumns(doc(body), mk(60), FROM_LISTING, { incremental: false, now: leap }))
      .toThrow(/WALL_TIME|time/)
  })

  it('the translator: translatePine reads only the injected clock, and its deadline is that clock\'s', () => {
    const src = '//@version=5\nindicator("hn")\nplot(close)\nplot(open)\nplot(high)\n'
    const control = clocksForbidden(() => translatePine(src))
    expect(control.reads).toBeGreaterThan(0)
    const now = counting()
    const r = clocksForbidden(() => translatePine(src, { now }))
    expect(r.reads).toBe(0)
    expect(r.value.ok).toBe(true)
    expect(now.calls).toBeGreaterThan(0)
    let t = 0
    const leap = () => { t += 1e7; return t }
    const late = translatePine(src, { now: leap })
    expect(late.refusal && late.refusal.guard).toBe('pine:timeout')
  })

  it('each limb of `pine:timeout` that reads time reads the clock it was handed', () => {
    let t = 0
    const leap = () => { t += 1e7; return t }
    // the whole-script window: `translateBudgetExpired` and `tickTranslateBudget`
    beginTranslateBudget(10000, 'hn.pine', leap)
    try {
      expect(translateBudgetExpired()).toBe(true)
      expect(() => { for (let i = 0; i < 5000; i += 1) tickTranslateBudget() }).toThrow(/gave up after 10000ms/)
    } finally { endTranslateBudget() }
    expect(translateBudgetExpired(), 'closed window').toBe(false)
    // a Resolver outside any window: its own deadline, on its own clock (opts.now)
    const own = new Resolver(new Map(), TABLE, new Map(), { now: leap })
    expect(() => own.checkClock(null)).toThrow(/gave up after 10000ms/)
    // ...or on the scoped clock (`withTranslateClock`), which is how the runtime lane hands it
    const scoped = withTranslateClock(leap, () => new Resolver(new Map(), TABLE, new Map(), {}))
    expect(() => scoped.checkClock(null)).toThrow(/gave up after 10000ms/)
    // ...and inside a window, the window's clock
    const steady = counting()
    beginTranslateBudget(10000, null, steady)
    try {
      const inWindow = new Resolver(new Map(), TABLE, new Map(), {})
      const r = clocksForbidden(() => inWindow.checkClock(null))
      expect(r.error).toBeUndefined()
      expect(r.reads).toBe(0)
    } finally { endTranslateBudget() }
    // ...and a handed clock that does NOT advance never expires, and no host clock is read
    // (a leaping clock alone cannot tell its own clock from the host's: both are past the deadline)
    const still = () => 0
    beginTranslateBudget(10000, null, still)
    try {
      const w = clocksForbidden(() => {
        for (let i = 0; i < 5000; i += 1) tickTranslateBudget()
        return translateBudgetExpired()
      })
      expect(w.error).toBeUndefined()
      expect(w.reads).toBe(0)
      expect(w.value).toBe(false)
    } finally { endTranslateBudget() }
    const stillResolver = new Resolver(new Map(), TABLE, new Map(), { now: still })
    const sr = clocksForbidden(() => stillResolver.checkClock(null))
    expect(sr.error).toBeUndefined()
    expect(sr.reads).toBe(0)
    // CONTROL — with nothing handed in, a Resolver reads the host clock
    const control = clocksForbidden(() => new Resolver(new Map(), TABLE, new Map(), {}))
    expect(control.reads).toBeGreaterThan(0)
  })

  it('the C18 object values (`runtimeObjectValues`) take the clock on their ctx', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const src = [
      '//@version=6', 'indicator("t", overlay = true)', 'if barstate.islast', '    int i = 0', '    float s = 0.0',
      '    while i < 3', '        s += close[i]', '        i += 1', '    if s > 0', '        label.new(bar_index, s, "sum")', '',
    ].join(String.fromCharCode(10))
    const d = memberPaneDefinition({ source: src, id: 'u_hn_rt', name: 'rt' })
    expect(d.ok, d.reason).toBe(true)
    const rt = d.definition.objects.runtime
    expect(rt, 'the door built a runtime-backed object program').toBeTruthy()
    const ctx = { tf: 'D', fromListing: true, atDefaults: true, newestBarIsForming: false }
    const control = clocksForbidden(() => runtimeObjectValues(rt, mk(12), ctx))
    expect(control.reads).toBeGreaterThan(0)
    expect(control.value && control.value.served).toBe(false)
    const now = counting()
    const r = clocksForbidden(() => runtimeObjectValues(rt, mk(12), { ...ctx, now }))
    expect(r.reads).toBe(0)
    expect(r.value.served).toBe(true)
  })
})

describe('the two cut edges still work at their doors', () => {
  it('C18: one slot, written by the runtime lane on import, read by the object reader', () => {
    expect(viaColumns).toBe(viaSeam)
    expect(registeredObjectRuntimeValues()).toBe(runtimeObjectValues)
  })

  it('the lower-timeframe gate reaches the translator through its leaf, late, and fails closed', () => {
    vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')
    expect(flagAtDoor()).toBe(true)
    expect(servedAtTranslator()).toBe(true)
    vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '')
    expect(servedAtTranslator()).toBe(false)
    vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')
    try {
      registerLowerTfGate(null)
      expect(servedAtTranslator(), 'unregistered is OFF').toBe(false)
      registerLowerTfGate(() => { throw new Error('x') })
      expect(servedAtTranslator(), 'a gate that throws is OFF').toBe(false)
      registerLowerTfGate(() => 1)
      expect(servedAtTranslator(), 'only a literal true serves').toBe(false)
    } finally { registerLowerTfGate(() => flagAtDoor()) }
    expect(servedAtTranslator()).toBe(true)
  })
})

describe('the server bundle under bare node, with fetch and every host clock throwing', () => {
  it('runs on the injected clock alone, and no build flag moves it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pine-rt-hn-'))
    const off = await buildPineRuntime({ outfile: path.join(dir, 'off', 'pine-runtime.mjs'), logLevel: 'silent', env: {} })
    const on = await buildPineRuntime({ outfile: path.join(dir, 'on', 'pine-runtime.mjs'), logLevel: 'silent',
      env: { VITE_PINE_LOWER_TF_ENABLED: '1', VITE_PINE_RUNTIME_PANE_ENABLED: '1' } })
    expect(on.manifest.sha256, 'no VITE_* value reaches the compute closure').toBe(off.manifest.sha256)
    const probe = path.join(dir, 'probe.mjs')
    writeFileSync(probe, [
      "const hits = { fetch: 0, clock: 0 }",
      "globalThis.fetch = () => { hits.fetch += 1; throw new Error('fetch') }",
      "Date.now = () => { hits.clock += 1; throw new Error('Date.now') }",
      "performance.now = () => { hits.clock += 1; throw new Error('performance.now') }",
      `const rt = await import(${JSON.stringify(pathToFileURL(off.outfile).href)})`,
      "const rows = Array.from({ length: 300 }, (_, i) => { const c = 100 + 3 * Math.sin(i / 4) + i * 0.05; return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i } })",
      "const def = { id: 'hn', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:hn', outputs: { a: 0, b: 1 }, source: '//@version=5\\nindicator(\"hn\")\\nplot(ta.rsi(close, 14))\\nplot(ta.ema(close, 9))\\n' } }",
      "let t = 0",
      "const cols = rt.computeRuntimeColumns(def, rows, { tf: 'D', newestBarIsForming: false, historyFromListing: true }, { incremental: false, budgetMs: 1e9, now: () => (t += 1) })",
      "rt.resetRuntimeSessions(); rt.resetRuntimeLedgers()",
      "console.log(JSON.stringify({ hits, n: cols.a.length, finite: cols.a.filter(Number.isFinite).length + cols.b.filter(Number.isFinite).length, ticks: t }))",
    ].join('\n'))
    const r = spawnSync(process.execPath, [probe], { cwd: dir, encoding: 'utf8', timeout: 120000 })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout.trim().split('\n').pop())
    expect(out.hits).toEqual({ fetch: 0, clock: 0 })
    expect(out.n).toBe(300)
    expect(out.finite).toBeGreaterThan(500)
    expect(out.ticks).toBeGreaterThan(2)
  }, 180000)
})
