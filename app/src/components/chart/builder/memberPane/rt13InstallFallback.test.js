// app/src/components/chart/builder/memberPane/rt13InstallFallback.test.js
//
// ─── ⭐⭐ RT13 — THE INSTALL DOOR'S REFUSAL IS OFFERED TO THE PER-BAR LANE ─────
//
// The builder could mint a host document that the install door then refused
// (`installUserDefinitions` -> `validateAstLane` -> `checkBudget`: a tree over
// the series-reference or lookback budget). Since RT1 every HOST refusal is
// offered to the per-bar runtime lane — but this one arrived AFTER the builder
// said `ok`, so the runtime lane was never asked: the wave-17 census read five
// scripts as `none:install` (mtf-key-levels-support-and-resistance,
// vwap-fibo-dev-extensions-strategy, pivot-high-low-points, rsi-vwap-indicator,
// volume-spikes-growing-volume-signals-with-alerts-scanner).
//
// The door now asks the install door's own validation (read-only:
// `validateUserDefinitions` installs nothing) while the runtime pane is on, and a
// refused document is offered to the runtime lane, which has its own budgets.
//   * built there  -> the runtime document, drawn bar by bar;
//   * declined     -> the HOST document, exactly as before, so the install door
//                     refuses it with its own sentence (the decline rides beside
//                     it as `runtimeDeclined`, for the census);
//   * pane off     -> nothing is asked; byte-identical to before.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

const FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'
const DEF_ID = 'u_member-pane-rt13-install'
const CORPUS = path.resolve(process.cwd(), '..', 'corpus', 'committed')
const corpus = (slug) => {
  const f = fs.readdirSync(CORPUS).find((x) => x.split('__')[0] === slug)
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.sin(i / 3) * 4,
  h: 106 + Math.sin(i / 3) * 4 + (i % 4),
  l: 94 + Math.sin(i / 3) * 4 - (i % 3),
  c: 100 + Math.sin(i / 3) * 4 + ((i * 7) % 5) - 2,
  v: 1000 + (i % 9) * 120,
}))
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

// ⭐ A host tree over the series-reference budget: the five bar series and four
// declared inputs are nine distinct series reads (the cap is 8,
// `budget.js::seriesRefs`), and its value is plain arithmetic a hand loop states.
const OVER_SERIES = `//@version=5
indicator("rt13 over series")
k1 = input.float(1.5, "k1")
k2 = input.float(2.5, "k2")
k3 = input.float(3.5, "k3")
k4 = input.float(4.5, "k4")
plot(open * k1 + high * k2 + low * k3 + close * k4 + volume, "S")
`
const expectedOverSeries = BARS.map((b) => b.o * 1.5 + b.h * 2.5 + b.l * 3.5 + b.c * 4.5 + b.v)

beforeEach(() => {
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
})
afterEach(() => {
  registry.uninstallUserDefinition(DEF_ID)
  vi.unstubAllEnvs()
})

function build(source, runtimeOn) {
  vi.stubEnv(FLAG, runtimeOn ? '1' : '')
  return memberPaneDefinition({ source, id: DEF_ID })
}

describe('⭐⭐ RT13 — an install-door refusal reaches the per-bar lane', () => {
  it('⛔ CONTROL (pane off): the host document is minted and the install door refuses it by budget', () => {
    const built = build(OVER_SERIES, false)
    expect(built.ok).toBe(true)
    expect(built.lane || 'host').toBe('host')
    expect(built.runtimeDeclined).toBeUndefined()
    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(installed.length).toBe(0)
    expect(errors.join(' | ')).toMatch(/budget:series/)
  })

  it('⭐ pane on: the same script is a runtime document, installed, and draws the stated arithmetic', () => {
    const built = build(OVER_SERIES, true)
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(installed.length, errors.join(' | ')).toBe(1)
    const cols = computeRuntimeColumns(built.definition, BARS, CTX)
    const got = Array.from(cols[built.rows[0].key])
    expect(got.length).toBe(N)
    got.forEach((v, i) => {
      if (Number.isNaN(expectedOverSeries[i])) expect(Number.isFinite(v), `bar ${i}`).toBe(false)
      else expect(v, `bar ${i}`).toBeCloseTo(expectedOverSeries[i], 9)
    })
    expect(got.filter(Number.isFinite).length).toBe(N) // non-vacuity
  })

  it('⛔ a host document the install door ACCEPTS is untouched by the check (pane on)', () => {
    const src = `//@version=5
indicator("rt13 fits")
plot(close + open[2], "S")
`
    const on = build(src, true)
    const off = build(src, false)
    expect(on.ok && off.ok).toBe(true)
    expect(on.lane || 'host').toBe('host')
    expect(on.runtimeDeclined).toBeUndefined()
    expect(JSON.stringify(on.definition.compute)).toBe(JSON.stringify(off.definition.compute))
  })

  // ⚠️ H10 (merge of H9): these two were the corpus proof of the fallback, refused
  // `budget:series` on the host. H9 showed both refusals were MIS-COUNTS (clock
  // columns and `accum`'s self counted as base series) and fixed the count, so
  // both now install on the HOST lane and the runtime lane is never asked. A
  // corpus sweep at the merge (266 committed scripts, pane off -> install, pane
  // on -> build + install) found NO real script that the install door refuses
  // and the runtime lane serves: the only two install refusals left are the
  // declined cases below. The served path is proven by the synthetic
  // OVER_SERIES case above.
  it('⭐ corpus: mtf-key-levels-support-and-resistance and vwap-fibo-dev-extensions-strategy install on the HOST lane (H9 count fix)', () => {
    for (const slug of ['mtf-key-levels-support-and-resistance', 'vwap-fibo-dev-extensions-strategy']) {
      const src = corpus(slug)
      const off = build(src, false)
      expect(off.ok, slug).toBe(true)
      expect(off.lane || 'host', slug).toBe('host')
      const a = registry.installUserDefinitions([off.definition])
      expect(a.installed.length, `${slug}: ${a.errors.join(' | ')}`).toBe(1)
      registry.uninstallUserDefinition(DEF_ID)
      const on = build(src, true)
      expect(on.ok, slug).toBe(true)
      expect(on.lane || 'host', slug).toBe('host')
      expect(on.runtimeDeclined, slug).toBeUndefined()
      expect(JSON.stringify(on.definition.compute), slug).toBe(JSON.stringify(off.definition.compute))
      const b = registry.installUserDefinitions([on.definition])
      expect(b.installed.length, `${slug}: ${b.errors.join(' | ')}`).toBe(1)
      registry.uninstallUserDefinition(DEF_ID)
    }
  })

  it('⛔ corpus declined by a different wall: volume-spikes (lookback 1000 > 960) - the runtime lane names `pine:function`, the host document is unchanged', () => {
    const src = corpus('volume-spikes-growing-volume-signals-with-alerts-scanner')
    const off = build(src, false)
    const on = build(src, true)
    expect(on.ok).toBe(true)
    expect(on.lane || 'host').toBe('host')
    expect(on.runtimeDeclined && on.runtimeDeclined.code).toBe('pine:function')
    expect(JSON.stringify(on.definition.compute)).toBe(JSON.stringify(off.definition.compute))
    const a = registry.installUserDefinitions([off.definition])
    const b = registry.installUserDefinitions([on.definition])
    expect(a.installed.length + b.installed.length).toBe(0)
    expect(a.errors.join(' | ')).toMatch(/budget:lookback/)
    expect(b.errors).toEqual(a.errors)
  })

  it('⛔ declined: the HOST document comes back unchanged and the install door says what it always said', () => {
    // rsi-vwap-indicator: `vwapOf()` reaches a whole session (976 > 960); the
    // runtime lane meets the same lookback budget and declines.
    const src = corpus('rsi-vwap-indicator')
    const off = build(src, false)
    const on = build(src, true)
    expect(on.ok).toBe(true)
    expect(on.lane || 'host').toBe('host')
    expect(on.runtimeDeclined && on.runtimeDeclined.code).toBe('budget:lookback')
    expect(JSON.stringify(on.definition.compute)).toBe(JSON.stringify(off.definition.compute))
    const a = registry.installUserDefinitions([off.definition])
    const b = registry.installUserDefinitions([on.definition])
    expect(a.installed.length + b.installed.length).toBe(0)
    expect(b.errors).toEqual(a.errors)
  })

  it('⛔ the pane permission withdrawn: nothing is asked (the gate is the runtime pane gate)', () => {
    __resetRuntimePanePermission()
    const built = build(OVER_SERIES, true)
    expect(built.lane || 'host').toBe('host')
    expect(built.runtimeDeclined).toBeUndefined()
  })
})
