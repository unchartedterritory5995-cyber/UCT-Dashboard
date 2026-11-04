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
    expect(p.stdout).toMatch(/HP-1 GREEN: (\d+)\/\1 cases equal the committed digests/)
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
    expect(p.status).toBe(0)
  }, 60000)
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
    expect(hp.distinguishes({ a: rec('x'), b: rec('x') })).toMatch(/one digest/)
    expect(hp.distinguishes({ a: rec('x'), b: rec('x'), c: rec('y') })).toMatch(/share one digest/)
    expect(hp.distinguishes({ a: rec('x'), b: { status: 'withheld', digest: 'x', guards: ['g'] }, c: rec('y') })).toBeNull()
  })

  const corpus = hp.loadCorpus()
  const expected = JSON.parse(readFileSync(hp.EXPECTED_FILE, 'utf8'))
  const got = () => ({ identity: { ...expected.identity }, barsSha256: { ...expected.barsSha256 },
    records: JSON.parse(JSON.stringify(expected.cases)) })

  it('the committed file passes its own check; a moved digest is red, named, and says whether the engine was bumped', () => {
    expect(hp.checkAgainst(expected, got(), corpus)).toEqual({ code: 0, lines: [] })
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
