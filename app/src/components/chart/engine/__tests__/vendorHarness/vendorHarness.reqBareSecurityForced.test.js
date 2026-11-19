// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.reqBareSecurityForced.test.js
//
// ─── ⭐⭐ REQ-B1 — A v3 / v4 BARE `security(…)` IS THE REQUEST DOOR'S, GRADED ON THE RUNTIME LANE FORCED ───
//
// Coordinator ruling 2026-11-18: route a v3 / v4 bare `security` through `admitRequest` (v1 / v2 stay refused by
// name: their look-ahead default differs, Q-REQ4), witnessed by `support-and-resistance-multi-time-frame`
// (SR-MTF, //@version=4: `security(…, 'D' | 'W' | 'M', valuewhen(…))`). The member door draws SR-MTF on the HOST
// lane, so the witness is the RUNTIME lane FORCED (`__forceRuntimeLaneForTests`): every row, every bar.
// Pinned here:
//   * forced, the door answers with the runtime lane, and every one of SR-MTF's six plots MATCHES TradingView on
//     both committed captures (RDDT and SPY 1D, 2026-10-02);
//   * CONTROL: not forced, the door still draws SR-MTF on the host lane (the seam is what moved it);
//   * the routing's limits: v1 / v2 (and no version line) stay refused by name; a v3 / v4 value that reads this run's
//     own mutable state is refused by name (TradingView does not compile it); a v3 weekly read builds;
//   * no member surface imports the seam.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { gradeCapture, loadCapture } from './harness'
import { enterMemberDoor } from './ourSide'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { __forceRuntimeLaneForTests } from '../../../builder/memberPane/memberPaneDefinition'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { TF_MERGE_NEWEST_CODE } from '../../ast/interpret'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAPS = ['support-and-resistance-multi-time-frame-rddt-1d-2026-10-02.json',
  'support-and-resistance-multi-time-frame-spy-1d-2026-10-02.json']
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]

beforeAll(() => {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
})
afterAll(() => { __forceRuntimeLaneForTests(false); vi.unstubAllEnvs() })

describe('⭐⭐ SR-MTF on the runtime lane, FORCED: every plot MATCHES TradingView on every bar', () => {
  for (const f of CAPTURES()) {
    it(f, () => {
      const capture = loadCapture(path.join(H, f)).capture
      __forceRuntimeLaneForTests(true)
      try {
        const door = enterMemberDoor(capture.source.text)
        expect(door.built.ok, door.refusal || '').toBe(true)
        expect(door.built.lane).toBe('runtime')
        const { verdict } = gradeCapture(capture)
        const plots = verdict.plots || []
        const why = plots.filter((p) => p.verdict !== 'MATCH')
          .map((p) => {
            const m = String(p.reason || '').match(/(\d+) steady-state bars? disagrees?; first at bar (\d+) \(([^)]*)\)/)
            return `${p.title.replace(/ /g, '')}:${m ? `${m[1]}@${m[2]}[${m[3].slice(0, 40)}]` : String(p.reason || '').slice(0, 50)}`
          }).join('|')
        expect(verdict.verdict, why).toBe('MATCH')
        expect(plots.length).toBe(6)
        for (const p of plots) {
          expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
          // every bar compared but the warm-up both sides leave blank and the newest bar, which the run withholds
          // on EVERY plot by name (its monthly read cannot know that bar yet: RS RATING L5's run-wide rule)
          expect(p.withheldNewest, p.title).toBe(TF_MERGE_NEWEST_CODE)
          expect(p.stats.oursUnread, p.title).toBe(1)
          expect(p.stats.steady.compared, p.title).toBeGreaterThan(capture.bars.rows.length - 60)
        }
      } finally { __forceRuntimeLaneForTests(false) }
    }, 180000)
  }

  it('CONTROL: not forced, the door draws SR-MTF on the HOST lane (the seam is what moved it)', () => {
    const capture = loadCapture(path.join(H, CAPS[0])).capture
    const door = enterMemberDoor(capture.source.text)
    expect(door.built.ok).toBe(true)
    expect(door.built.lane).not.toBe('runtime')
  }, 120000)
})

function CAPTURES() { return CAPS }

describe('the routing\'s limits, by name', () => {
  const body = 'r = security(tickerid, "W", valuewhen(high >= highest(high, 34), high, 0))\nplot(r)\n'
  const build = (src) => buildRuntimeIr(src, { bars: [], inputs: {}, tf: 'D' })

  it('⭐ a v3 weekly read over a carried state builds as a request (v3 shares v4\'s look-ahead default)', () => {
    const r = build(`//@version=3\nstudy("t")\n${body}`)
    expect(r.ok, r.ok ? '' : r.refusal.message).toBe(true)
    expect((r.ir.requests || []).length).toBe(1)
  })

  for (const head of ['//@version=2\n', '']) {
    it(`⛔ ${head ? 'v2' : 'no version line (v1)'}: still refused by name (its look-ahead default is the other one)`, () => {
      const r = build(`${head}study("t")\n${body}`)
      expect(r.ok).toBe(false)
      expect(r.refusal.guard).toBe('runtime:request-with-state')
    })
  }

  for (const v of [3, 4]) {
    it(`⛔ v${v}: a value that reads this run's own mutable state is refused by name, even at the chart's own period`, () => {
      const r = build(`//@version=${v}\nstudy("t")\nx = 0.0\nx := nz(x[1]) + 1\nr = security(tickerid, period, sma(x, 3))\nplot(r)\n`)
      expect(r.ok).toBe(false)
      expect(r.refusal.guard).toBe('runtime:request-with-state')
    })
  }
})

describe('⛔ the forced lane is a test seam only', () => {
  const SEAM_USE = /import\s*\{[^}]*__forceRuntimeLaneForTests[^}]*\}\s*from|__forceRuntimeLaneForTests\s*\(/
  it('CONTROL: the pattern finds an import and a call, and passes a mention', () => {
    expect(SEAM_USE.test('import { __forceRuntimeLaneForTests } from "x"')).toBe(true)
    expect(SEAM_USE.test('__forceRuntimeLaneForTests(true)')).toBe(true)
    expect(SEAM_USE.test('// `__forceRuntimeLaneForTests` is a seam')).toBe(false)
  })
  it('no member surface imports or calls `__forceRuntimeLaneForTests`', () => {
    const root = path.resolve(process.cwd(), 'src')
    const hits = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); continue }
        if (!/\.(jsx?|tsx?|mjs)$/.test(e.name) || /\.test\.|\.spec\./.test(e.name)) continue
        const text = fs.readFileSync(p, 'utf8')
        if (p.endsWith(path.join('memberPane', 'memberPaneDefinition.js'))) continue   // the seam's own home
        if (SEAM_USE.test(text)) hits.push(path.relative(root, p))
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
