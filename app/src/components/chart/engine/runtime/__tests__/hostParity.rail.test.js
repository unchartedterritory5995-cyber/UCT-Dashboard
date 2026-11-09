// app/src/components/chart/engine/runtime/__tests__/hostParity.rail.test.js
//
// W5 T4 — the host-parity rail's own rails (docs/pine/SERVER-RUNTIME-DESIGN.md 2.3):
//   HP-1 the server bundle reproduces the committed digests; HP-4 a perturbed bundle is red BY
//   CASE NAME; HP-5 a guard-only difference is a difference; HP-7 the adapters agree; and every
//   guard of the harness itself (distinguishability, the bump rule, the hostile stops, the
//   wall-clock stop read as inconclusive, the one encoder).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as hp from '../../../../../../../tools/pine_runtime_host_parity.mjs'

const REPO = resolve(__dirname, '../../../../../../..')
const TOOL = join(REPO, 'tools', 'pine_runtime_host_parity.mjs')

const run = (...args) => spawnSync(process.execPath, [TOOL, ...args, '--quiet'], { cwd: REPO, encoding: 'utf8', timeout: 240000 })
const ID = { script_engine: 5, runtime_language: 'pine', runtime_frontend: 1, runtime_ir: 1, bundle_sha256: hp.ARTIFACT_NEUTRAL_SHA }
const okRaw = (cols) => ({ ok: true, encoded: hp.encodeColumnsB64(cols), warmup: null })
const errRaw = (guard, bar = null) => ({ ok: false, error: { name: 'Error', guard, bar } })

describe('HP-1 / HP-4 / HP-7 end to end (the server bundle, built fresh)', () => {
  it('HP-1: the bundle computes exactly the committed digests over the whole corpus', () => {
    const p = run('--host', 'node', '--check')
    // hp1Summary contract: equal count on the recording V8, N-k equal plus k REPORTED on another V8 (the V8 rail owns the split)
    expect(p.stdout).toMatch(/HP-1 GREEN: [0-9]+\/[0-9]+ cases equal the committed digests/)
    expect(p.status).toBe(0)
  }, 240000)

  it('HP-4: one VM operator through Math.fround turns the rail red, by case name', () => {
    const p = run('--mutation-control')
    expect(p.status).toBe(0)
    expect(p.stdout).toMatch(/HP-4 GREEN: the perturbed bundle is red on \d+ case/)
    expect(p.stdout).toMatch(/^RED [a-z0-9_]+@[a-z0-9_]+: digest /m)
  }, 240000)

  it('HP-7: the worker and the Node half build the same call, modulo the named exemptions', () => {
    const p = run('--adapters')
    expect(p.stdout).toContain('HP-7 GREEN')
    expect(p.stdout).toMatch(/worker: args \(def, rows \|\| \[\], ctx \|\| \{\}\) opts \{budgetMs\}/)
    // H6: the Node half runs with no session (`incremental: false`), as the service will
    expect(p.stdout).toContain('node: args (c.def, rows, c.ctx) opts {incremental}')
    // W5-INT: one HP-7 authority per adapter; the service's is services/pine_runtime/test/adapter.test.mjs
    expect(p.stdout).not.toMatch(/^job:/m)
    expect(Object.keys(hp.ADAPTER_FILES)).toEqual(['worker', 'node'])
    expect(p.status).toBe(0)
  }, 60000)
})

describe('an interrupted run (SIGINT / SIGTERM / harness timeout) is INTERRUPTED, never runtime:failed', () => {
  it('cases after the stop are interrupted, none is failed, and --write refuses the run', () => {
    // esbuild cannot build under jsdom: the run happens in a child Node, the stop lands mid-run
    // (after the second case finished, before the third starts), the child prints what it got
    const src = `import * as hp from ${JSON.stringify(pathToFileURL(TOOL).href)}
const b = await hp.buildBundle(); const ac = new AbortController(); let seen = 0
const got = await hp.runNode({ bundle: b.bundle, signal: ac.signal, log: () => { seen += 1; if (seen === 2) ac.abort() } })
let refusal = null
try { hp.writeExpected(null, got, hp.loadCorpus()) } catch (e) { refusal = e.message }
process.stdout.write(JSON.stringify({ got, refusal }))`
    const p = spawnSync(process.execPath, ['--input-type=module', '-e', src], { cwd: REPO, encoding: 'utf8', timeout: 240000 })
    expect(p.stderr).toBe('')
    const { got, refusal } = JSON.parse(p.stdout)
    const recs = Object.values(got.records)
    expect(got.interrupted).toBe(true)
    expect(recs.length).toBeGreaterThan(2)
    expect(recs.filter((r) => r.status === 'interrupted').length).toBe(recs.length - 2)
    for (const r of recs.filter((x) => x.status === 'interrupted')) expect(r).toEqual({ status: 'interrupted', digest: null, guards: [hp.INTERRUPTED_GUARD], warmup: null })
    // the two finished cases keep their committed verdict (a genuine runtime:failed stays one); the rest
    // carry no engine verdict at all
    const committed = JSON.parse(readFileSync(hp.EXPECTED_FILE, 'utf8')).cases
    for (const [name, r] of Object.entries(got.records)) {
      if (r.status === 'interrupted') expect(committed[name].guards).not.toEqual(r.guards)
      else expect({ status: r.status, digest: r.digest, guards: r.guards }).toEqual({ status: committed[name].status, digest: committed[name].digest, guards: committed[name].guards })
    }
    expect(refusal).toMatch(/^refused: the run was interrupted/)
    // the flag alone refuses, even over records that all look finished
    const prev = JSON.parse(readFileSync(hp.EXPECTED_FILE, 'utf8'))
    expect(() => hp.writeExpected(prev, { ...got, interrupted: true, records: prev.cases }, hp.loadCorpus())).toThrow(/interrupted/)
  }, 240000)

  it('the CLI: a SIGINT mid-run exits 130 naming the interruption, with no verdict and no file touched', () => {
    const before = readFileSync(hp.EXPECTED_FILE)
    // the signal is delivered when the first case line is logged, i.e. mid-run, deterministically
    const src = `const log = console.log; let sent = false
console.log = (...a) => { log(...a); if (!sent && / ms /.test(String(a[0]))) { sent = true; process.emit('SIGINT', 'SIGINT') } }
const hp = await import(${JSON.stringify(pathToFileURL(TOOL).href)})
process.exitCode = await hp.main(['--host', 'node', '--check'])`
    const p = spawnSync(process.execPath, ['--input-type=module', '-e', src], { cwd: REPO, encoding: 'utf8', timeout: 240000 })
    expect(p.stdout).toMatch(/^HP-1 INTERRUPTED by SIGINT: 1\/\d+ cases ran; nothing written, no verdict$/m)
    expect(p.stdout.split(/\r?\n/).filter((l) => / ms /.test(l)).length).toBe(1) // no case ran after the stop
    expect(p.stdout).not.toMatch(/^wrote /m)
    expect(p.status).toBe(hp.INTERRUPTED_EXIT)
    expect(readFileSync(hp.EXPECTED_FILE).equals(before)).toBe(true)
  }, 240000)
})

describe('the record: one normalisation for both hosts', () => {
  it('null, undefined and holes are na; -0 and the infinities are kept; a non-number is reported', () => {
    // eslint-disable-next-line no-sparse-arrays
    const e = hp.encodeColumnsB64({ a: [1, null, undefined, , -0, Infinity] })
    const f = new Float64Array(Uint8Array.from(atob(e.columns.a), (ch) => ch.charCodeAt(0)).buffer)
    expect(Number.isNaN(f[1]) && Number.isNaN(f[2]) && Number.isNaN(f[3])).toBe(true)
    expect(Object.is(f[4], -0)).toBe(true)
    expect(f[5]).toBe(Infinity)
    expect(hp.encodeColumnsB64({ a: [1, 'x'] }).nonNumeric).toEqual(['a'])
    expect(hp.recordOf(okRaw({ a: [true] }), ID).status).toBe('failed')
  })

  it('the encoder is self-contained, so the page can run its own source', () => {
    // eslint-disable-next-line no-new-func
    const again = new Function(`return (${hp.encodeColumnsB64.toString()})`)()
    expect(again({ a: [1.5, null] })).toEqual(hp.encodeColumnsB64({ a: [1.5, null] }))
  })

  it('a refusal is digested by guard and bar; a wall-clock stop is inconclusive, never a digest', () => {
    const a = hp.recordOf(errRaw('runtime:limit', 3), ID)
    expect(a.status).toBe('withheld')
    expect(a.digest).not.toBe(hp.recordOf(errRaw('runtime:limit', 4), ID).digest)
    expect(a.digest).not.toBe(hp.recordOf(errRaw('runtime:varip', 3), ID).digest)
    expect(hp.recordOf(errRaw(null), ID).guards).toEqual(['unnamed:Error'])
    const t = hp.recordOf(errRaw('runtime:time-budget'), ID)
    expect(t).toMatchObject({ status: 'inconclusive', digest: null })
  })

  it('columns are digested bit for bit: one ulp is another digest', () => {
    const x = 0.1 + 0.2
    const one = hp.recordOf(okRaw({ a: [x] }), ID).digest
    expect(hp.recordOf(okRaw({ a: [x] }), ID).digest).toBe(one)
    expect(hp.recordOf(okRaw({ a: [Math.fround(x)] }), ID).digest).not.toBe(one)
  })
})

describe('the checks', () => {
  const rec = (digest, extra = {}) => ({ status: 'ok', digest, guards: [], warmup: null, ...extra })

  it('HP-5: a guard-only or a warm-up-only difference is a difference', () => {
    const a = { c: { status: 'withheld', digest: 'd', guards: ['runtime:limit'], warmup: null } }
    expect(hp.compareRecords(a, { c: { ...a.c, guards: ['runtime:varip'] } }).map((d) => d.field)).toEqual(['guards'])
    expect(hp.compareRecords({ c: rec('d') }, { c: rec('d', { warmup: { withheldBars: 2 } }) }).map((d) => d.field)).toEqual(['warmup'])
    expect(hp.compareRecords({ c: rec('d') }, {})).toEqual([{ case: 'c', field: 'missing', a: true, b: false }])
  })

  it('a corpus that cannot distinguish is rejected', () => {
    const w = (d) => ({ status: 'withheld', digest: d, guards: ['g'] })
    expect(hp.distinguishes({ a: w('x'), b: w('x') })).toMatch(/produces one digest for every case/)
    expect(hp.distinguishes({ a: rec('x'), b: rec('x'), c: rec('y') })).toMatch(/share one digest/)
    expect(hp.distinguishes({ a: rec('x'), b: { status: 'withheld', digest: 'x', guards: ['g'] }, c: rec('y') })).toBeNull()
  })

  const corpus = hp.loadCorpus()
  const expected = JSON.parse(readFileSync(hp.EXPECTED_FILE, 'utf8'))
  const got = () => ({ identity: { ...expected.identity }, barsSha256: { ...expected.barsSha256 },
    records: JSON.parse(JSON.stringify(expected.cases)) })

  it('the committed file passes its own check; a moved digest is red, named, and says whether the engine was bumped', () => {
    expect(hp.checkAgainst(expected, got(), corpus)).toEqual({ code: 0, lines: [] })
    const same = got()
    const oks = Object.keys(same.records).filter((k) => same.records[k].status === 'ok')
    for (const k of oks) same.records[k].digest = expected.cases[oks[0]].digest
    expect(hp.checkAgainst({ ...expected, cases: same.records }, same, corpus).lines).toContain(`RED corpus: cases ${oks[0]} and ${oks[1]} share one digest`)
    const g = got()
    const name = Object.keys(g.records).find((k) => g.records[k].status === 'ok')
    g.records[name].digest = 'f'.repeat(64)
    const r = hp.checkAgainst(expected, g, corpus)
    expect(r.code).toBe(1)
    expect(r.lines[0]).toMatch(/WITHOUT an engine bump/)
    expect(r.lines).toContain(`RED ${name}: digest "${'f'.repeat(64)}" != committed "${expected.cases[name].digest}"`)
    g.recordedOn = { node: 'vX', v8: 'not-' + expected.recordedOn.v8 }
    expect(hp.checkAgainst(expected, g, corpus).lines.some((l) => l.startsWith(`NOTE committed on V8 ${expected.recordedOn.v8}`))).toBe(true)
    g.identity.script_engine = Number(g.identity.script_engine) + 1
    expect(hp.checkAgainst(expected, g, corpus).lines[0]).toMatch(/identity moved/)
  })

  it('moved bars, a hostile case that stops on the wrong guard, and an inconclusive case are each caught', () => {
    const b = got()
    b.barsSha256.d5000 = '0'.repeat(64)
    expect(hp.checkAgainst(expected, b, corpus).lines[0]).toMatch(/^RED bars "d5000"/)
    const h = got()
    const hostile = Object.keys(h.records).find((k) => k.startsWith('h_'))
    h.records[hostile] = { ...h.records[hostile], guards: ['runtime:other'] }
    expect(hp.checkAgainst(expected, h, corpus).lines.some((l) => l.startsWith(`RED hostile ${hostile}`))).toBe(true)
    const i = got()
    const first = Object.keys(i.records)[0]
    i.records[first] = { status: 'inconclusive', digest: null, guards: ['runtime:time-budget'], warmup: null }
    expect(hp.checkAgainst(expected, i, corpus).code).toBe(2)
  })

  it('--write refuses to move a committed digest without an engine bump, and accepts one with it', () => {
    const g = got()
    const name = Object.keys(g.records).find((k) => g.records[k].status === 'ok')
    g.records[name].digest = 'e'.repeat(64)
    expect(() => hp.writeExpected(expected, g, corpus)).toThrow(/without an engine bump/)
    g.identity.script_engine = Number(g.identity.script_engine) + 1
    expect(hp.writeExpected(expected, g, corpus).cases[name].digest).toBe('e'.repeat(64))
    const b = got()
    b.barsSha256.listing = '1'.repeat(64)
    expect(() => hp.writeExpected(expected, b, corpus)).toThrow(/bars "listing" moved/)
  })

  it('the perturbation applies at exactly one site, or refuses', () => {
    expect(hp.perturb(`a\n${hp.PERTURB_FROM}\nb`)).toBe(`a\n${hp.PERTURB_TO}\nb`)
    expect(() => hp.perturb('nothing here')).toThrow(/found 0 times/)
    expect(() => hp.perturb(`${hp.PERTURB_FROM}${hp.PERTURB_FROM}`)).toThrow(/found 2 times/)
  })

  it('HP-7 is red on an adapter that adds an option, or calls twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hp7-'))
    try {
      const extra = join(dir, 'a.mjs')
      writeFileSync(extra, 'computeRuntimeColumns(d, r, c, { incremental: false, warmupCurtain: false })\n')
      const r = hp.checkAdapters({ worker: hp.ADAPTER_FILES.worker, job: extra })
      expect(r.code).toBe(1)
      expect(r.lines.join('\n')).toMatch(/RED job: options \["warmupCurtain"\]/)
      const twice = join(dir, 'b.mjs')
      writeFileSync(twice, 'computeRuntimeColumns(d, r, c, {}); x.computeRuntimeColumns(d, r, c, {})\n')
      expect(hp.checkAdapters({ worker: hp.ADAPTER_FILES.worker, job: twice }).lines[0]).toMatch(/RED job: 2 computeRuntimeColumns calls/)
      expect(hp.checkAdapters({ worker: hp.ADAPTER_FILES.worker, node: hp.ADAPTER_FILES.node }).code).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('the corpus', () => {
  const corpus = hp.loadCorpus()

  it('is first-party: every committed script is an "hp " indicator in v5, and every file is listed', () => {
    const files = readdirSync(join(hp.FIXTURE_DIR, 'corpus'))
    expect(files.length).toBeGreaterThanOrEqual(30)
    for (const f of files) {
      const s = readFileSync(join(hp.FIXTURE_DIR, 'corpus', f), 'utf8')
      expect(s.startsWith('//@version=5\nindicator("hp ')).toBe(true)
    }
    expect(corpus.scripts.filter((s) => s.file).map((s) => s.file.replace('corpus/', '')).sort()).toEqual([...files].sort())
  })

  it('a corpus file that corpus.json does not list is refused, never silently skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hpc-'))
    try {
      mkdirSync(join(dir, 'corpus'))
      writeFileSync(join(dir, 'corpus.json'), JSON.stringify({ barSets: {}, scripts: [{ name: 'a', file: 'corpus/a.pine' }] }))
      writeFileSync(join(dir, 'corpus', 'a.pine'), '')
      expect(hp.loadCorpus(dir).scripts).toHaveLength(1)
      writeFileSync(join(dir, 'corpus', 'b.pine'), '')
      expect(() => hp.loadCorpus(dir)).toThrow(/corpus\/b.pine is not listed/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('covers the five bar sets of design 2.3 and the hostile corpus of section 4', () => {
    const sets = corpus.barSets
    expect(sets.d5000).toMatchObject({ tf: 'D', n: 5000 })
    expect(sets.m5_32768).toMatchObject({ tf: '5', n: 32768 })
    expect(sets.listing.ctx.historyFromListing).toBe(true)
    expect(sets.forming.ctx.newestBarIsForming).toBe(true)
    expect(sets.calcbars.calcBars).toBeGreaterThan(0)
    const hostile = corpus.scripts.filter((s) => s.hostile)
    expect(hostile.length).toBeGreaterThanOrEqual(9)
    for (const h of hostile) expect(typeof h.expectGuard).toBe('string')
  })

  it('the bars are generated, deterministic, and pinned by the committed file', () => {
    const expected = JSON.parse(readFileSync(hp.EXPECTED_FILE, 'utf8'))
    for (const [set, spec] of Object.entries(corpus.barSets)) {
      const rows = hp.makeBars(spec)
      expect(rows).toHaveLength(spec.n)
      expect(hp.barsSha256(rows)).toBe(expected.barsSha256[set])
      for (let i = 1; i < rows.length; i += 1) expect(rows[i].t > rows[i - 1].t).toBe(true)
    }
  })

  it('a calc_bars_count window rewrites only the one-line header', () => {
    expect(hp.withCalcBars('//@version=5\nindicator("hp x", overlay=false)\nplot(close)\n', 400))
      .toBe('//@version=5\nindicator("hp x", overlay=false, calc_bars_count=400)\nplot(close)\n')
    expect(() => hp.withCalcBars('plot(close)', 400)).toThrow(/no one-line indicator/)
  })
})

describe('report-only cases (the V8 sin/cos 1-ulp finding): named, pinned, measured', () => {
  const corpus = JSON.parse(readFileSync(join(hp.FIXTURE_DIR, 'corpus.json'), 'utf8'))
  const cols = (arr) => hp.encodeColumnsB64({ p0: Float64Array.from(arr) }).columns
  const withCols = (digest, arr) => ({ status: 'ok', digest, guards: [], warmup: null, cols: cols(arr) })
  const next = (x) => { const f = new Float64Array([x]); const i = new BigUint64Array(f.buffer); i[0] += 1n; return f[0] }
  const A = { 'x@s': withCols('d1', [1, 2, 3]), 'y@s': withCols('d1', [1, 2, 3]) }
  const B = { 'x@s': withCols('d2', [1, next(2), 3]), 'y@s': withCols('d2', [1, next(2), 3]) }

  it('the list is the two trig cases and nothing else (pinned), each a real corpus case', () => {
    expect([...hp.reportOnlyOf(corpus).keys()].sort()).toEqual(['transcendental@forming', 'transcendental@listing'])
    expect(corpus.reportOnly.reason).toMatch(/Math\.sin/)
    expect(() => hp.reportOnlyOf({ ...corpus, reportOnly: { reason: 'r', cases: ['no_such@case'] } })).toThrow(/not a corpus case/)
  })

  it('rail 1: a case that is NOT listed and differs is RED and fails HP-3', () => {
    const c = hp.classifyDiffs(hp.compareRecords(A, B), A, B, new Map())
    expect(c.red.map((d) => d.case).sort()).toEqual(['x@s', 'y@s'])
    expect(c.reported).toEqual([])
    const only = hp.classifyDiffs(hp.compareRecords(A, B), A, B, new Map([['x@s', 'why']]))
    expect(only.red.map((d) => d.case)).toEqual(['y@s'])
  })

  it('rail 2: a listed case that differs is REPORTED with its row count and max ulp, and is not red', () => {
    const c = hp.classifyDiffs(hp.compareRecords(A, B), A, B, new Map([['x@s', 'why'], ['y@s', 'why']]))
    expect(c.red).toEqual([])
    expect(c.reported.map((r) => r.text)).toEqual([
      'REPORTED x@s: digest differs; 1/3 values differ, max 1 ulp; why',
      'REPORTED y@s: digest differs; 1/3 values differ, max 1 ulp; why',
    ])
  })

  it('a listed case is still RED when anything but its digest differs (status, guards, warm-up)', () => {
    const G = { 'x@s': { ...B['x@s'], guards: ['runtime:limit'] } }
    const c = hp.classifyDiffs(hp.compareRecords({ 'x@s': A['x@s'] }, G), { 'x@s': A['x@s'] }, G, new Map([['x@s', 'why']]))
    expect(c.red.map((d) => d.field).sort()).toEqual(['digest', 'guards'])
    expect(c.reported).toEqual([])
  })

  it('ulp distance counts adjacent doubles across zero and ignores matching NaN', () => {
    expect(hp.ulpStats(withCols('a', [0, NaN, -1]), withCols('b', [-0, NaN, -1]))).toMatchObject({ rows: 1, maxUlp: 0 })
    expect(hp.ulpStats(withCols('a', [5e-324]), withCols('b', [-5e-324]))).toMatchObject({ rows: 1, maxUlp: 2 })
    expect(hp.ulpStats({ cols: null }, B['x@s'])).toBeNull()
  })

  it('--compare end to end: exit 0 with REPORTED lines for the two named cases, exit 1 for any other', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hp-rep-'))
    try {
      const names = ['transcendental@listing', 'transcendental@forming', 'switch_ternary@listing']
      const mk = (arr, nm) => Object.fromEntries(nm.map((n) => [n, withCols('d' + arr.join(',') + n, arr)]))
      const a = { records: mk([1, 2, 3], names) }
      const wr = (f, o) => { writeFileSync(join(dir, f), JSON.stringify(o)); return join(dir, f) }
      const b1 = { records: { ...mk([1, 2, 3], names), ...mk([1, next(2), 3], names.slice(0, 2)) } }
      const ok = spawnSync(process.execPath, [TOOL, '--compare', wr('a.json', a), wr('b1.json', b1)], { cwd: REPO, encoding: 'utf8' })
      expect(ok.stdout).toMatch(/REPORTED transcendental@listing: digest differs; 1\/3 values differ, max 1 ulp/)
      expect(ok.stdout).toMatch(/2 REPORTED, not gated/)
      expect(ok.stdout).toMatch(/max 1 ulp; V8 Math\.sin\/Math\.cos differ by 1 ulp/)
      expect(ok.status).toBe(0)
      const b2 = { records: { ...b1.records, ...mk([1, next(2), 3], ['switch_ternary@listing']) } }
      const bad = spawnSync(process.execPath, [TOOL, '--compare', wr('a.json', a), wr('b2.json', b2)], { cwd: REPO, encoding: 'utf8' })
      expect(bad.stdout).toMatch(/RED switch_ternary@listing: digest/)
      expect(bad.status).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
