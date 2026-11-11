// app/src/components/chart/engine/runtime/__tests__/hostParity.v8.rail.test.js
//
// W5 T19 -- HP-1 on a V8 other than the one the digests were recorded on. The deploy gate runs
// Node 20 (V8 11.3); the digests were recorded on Node 24 (V8 13.6); V8's sin/cos differ by one
// ulp between them (docs/pine/evidence/2026-11-04-w5-t4/EVIDENCE.md). The tool therefore REPORTS
// the two NAMED trig cases (corpus.json `reportOnly`) -- and ONLY them -- when the V8 moved, and
// only when their sole difference is the digest. Everything else stays gated.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as hp from '../../../../../../../tools/pine_runtime_host_parity.mjs'

const corpus = hp.loadCorpus()
const expected = JSON.parse(readFileSync(hp.EXPECTED_FILE, 'utf8'))
const LISTED = ['transcendental@forming', 'transcendental@listing']
const OTHER_V8 = `not-${expected.recordedOn.v8}`

const got = (v8) => ({
  identity: { ...expected.identity },
  barsSha256: { ...expected.barsSha256 },
  records: JSON.parse(JSON.stringify(expected.cases)),
  recordedOn: { node: 'vX', v8 },
})
const F = 'f'.repeat(64)
const unlisted = () => Object.keys(expected.cases).find((k) => expected.cases[k].status === 'ok' && !LISTED.includes(k))

describe('HP-1 on a V8 other than the recording V8', () => {
  it('the premise: the committed file records a V8, and the list is exactly the two trig cases', () => {
    expect(typeof expected.recordedOn.v8).toBe('string')
    expect([...hp.reportOnlyOf(corpus).keys()].sort()).toEqual(LISTED)
  })

  it('on the RECORDING V8 a listed case that differs is RED (no report-only on the V8 it was recorded on)', () => {
    const g = got(expected.recordedOn.v8)
    g.records[LISTED[0]].digest = F
    const r = hp.checkAgainst(expected, g, corpus)
    expect(r.code).toBe(1)
    expect(r.lines).toContain(`RED ${LISTED[0]}: digest "${F}" != committed "${expected.cases[LISTED[0]].digest}"`)
    expect(r.lines.some((l) => l.startsWith('REPORTED'))).toBe(false)
  })

  it('on another V8 both listed cases differing in digest only are REPORTED, named, and the run is green', () => {
    const g = got(OTHER_V8)
    LISTED.forEach((n, i) => { g.records[n].digest = String(i).repeat(64) }) // distinct, so the corpus still distinguishes
    const r = hp.checkAgainst(expected, g, corpus)
    expect(r.code).toBe(0)
    for (const n of LISTED) {
      const line = r.lines.find((l) => l.startsWith(`REPORTED ${n}:`))
      expect(line).toContain(expected.recordedOn.v8)
      expect(line).toContain(OTHER_V8)
      expect(line).toContain('V8 Math.sin/Math.cos')
    }
    expect(r.lines.some((l) => l.startsWith('RED'))).toBe(false)
  })

  it('on another V8 an UNLISTED case that differs is still RED', () => {
    const g = got(OTHER_V8)
    const n = unlisted()
    g.records[n].digest = F
    const r = hp.checkAgainst(expected, g, corpus)
    expect(r.code).toBe(1)
    expect(r.lines.some((l) => l.startsWith(`RED ${n}:`))).toBe(true)
  })

  it('on another V8 a listed case that differs in more than its digest is RED (status, guards, warm-up)', () => {
    for (const field of ['status', 'guards', 'warmup']) {
      const g = got(OTHER_V8)
      g.records[LISTED[0]].digest = F
      g.records[LISTED[0]][field] = field === 'status' ? 'withheld' : field === 'guards' ? ['runtime:limit'] : 123456
      const r = hp.checkAgainst(expected, g, corpus)
      expect(r.code, field).toBe(1)
      expect(r.lines.some((l) => l.startsWith(`RED ${LISTED[0]}:`)), field).toBe(true)
    }
  })

  it('a missing recorded or running V8 is not "moved": the listed cases stay gated', () => {
    const noRun = got(undefined)
    noRun.records[LISTED[0]].digest = F
    expect(hp.checkAgainst(expected, noRun, corpus).code).toBe(1)
    const noRec = { ...expected, recordedOn: undefined }
    const g = got(OTHER_V8)
    g.records[LISTED[0]].digest = F
    expect(hp.checkAgainst(noRec, g, corpus).code).toBe(1)
  })

  it('on another V8 the engine-bump rule and the corpus guards still hold', () => {
    const g = got(OTHER_V8)
    const n = unlisted()
    g.records[n].digest = F
    expect(hp.checkAgainst(expected, g, corpus).lines.some((l) => /WITHOUT an engine bump/.test(l))).toBe(true)
    const h = got(OTHER_V8)
    h.barsSha256.d5000 = '0'.repeat(64)
    expect(hp.checkAgainst(expected, h, corpus).code).toBe(1)
  })

  it('the HP-1 verdict line counts REPORTED cases apart and says why', () => {
    const lines = [`REPORTED ${LISTED[0]}: x`, `REPORTED ${LISTED[1]}: y`, 'NOTE something']
    expect(hp.hp1Summary({ code: 0, lines }, 166)).toBe('HP-1 GREEN: 164/166 cases equal the committed digests; 2 REPORTED, not gated (V8 differs from the recording V8)')
    expect(hp.hp1Summary({ code: 0, lines: [] }, 166)).toBe('HP-1 GREEN: 166/166 cases equal the committed digests')
    expect(hp.hp1Summary({ code: 1, lines }, 166)).toBe('HP-1 RED')
    expect(hp.hp1Summary({ code: 2, lines: [] }, 166)).toBe('HP-1 INCONCLUSIVE')
  })

  it('end to end: --check on this runner exits 0 and prints REPORTED only when this V8 is not the recording V8', async () => {
    const { spawnSync } = await import('node:child_process')
    const { resolve, join } = await import('node:path')
    const repo = resolve(__dirname, '../../../../../../..')
    const p = spawnSync(process.execPath, [join(repo, 'tools', 'pine_runtime_host_parity.mjs'), '--host', 'node', '--check'], { cwd: repo, encoding: 'utf8', timeout: 240000 })
    expect(p.status, p.stdout + p.stderr).toBe(0)
    const sameV8 = process.versions.v8 === expected.recordedOn.v8
    expect(/^REPORTED /m.test(p.stdout)).toBe(!sameV8)
    expect(p.stdout).toMatch(sameV8 ? /HP-1 GREEN: (\d+)\/\1 cases equal/ : /HP-1 GREEN: \d+\/\d+ cases equal the committed digests; 2 REPORTED, not gated/)
  }, 240000)
})
