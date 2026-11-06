// app/src/components/chart/engine/__tests__/w4T17T13Probes.test.js
//
// W4-T17 (probes) and W4-T13 (spike): what the engine does TODAY with the new probes, and what the
// candle-row renderer path can and cannot carry. Docs-and-probes lane: NO engine source is changed.
// Write-up: docs/pine/evidence/2026-11-03-w4-t17-t13/EVIDENCE.md.
//
// THE BASELINE TABLES BELOW ARE REFUSALS PINNED ON PURPOSE. They record "ours today", measured
// 2026-11-03 at master d8d4f0937d. The T17 build (after the D1 / M1-M5 captures) and the T13 build
// are EXPECTED to flip some of them: change the expected value in the same commit and cite the
// capture. A flip with no capture behind it is the failure these rows exist to catch.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import * as registry from '../nativeRegistry'
import { parseSource, symbolSource } from '../sourceRef'
import { ohlcCapabilityOf, OHLC_FAMILY, OHLC_REFUSAL } from '../ohlcCapability'
import { poolKey, OHLC_POOL_KEYS } from '../pool'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../../../../..')
const PROBES = path.join(ROOT, 'tools/visual_conformance/probes')
const read = (f) => fs.readFileSync(path.join(PROBES, f), 'utf8')

const D1_FILES = {
  v6: 'vw-w4-int-div-window.pine',
  v5: 'vw-w4-int-div-window-v5.pine',
  v4: 'vw-w4-int-div-window-v4.pine',
}
const MBB_FILES = {
  M1: 'vw-w4-max-bars-back.pine',
  M2: 'vw-w4-max-bars-back-m2.pine',
  M3: 'vw-w4-max-bars-back-m3.pine',
  M4: 'vw-w4-max-bars-back-m4.pine',
  M5: 'vw-w4-max-bars-back-m5.pine',
}
const ALL = [...Object.values(D1_FILES), ...Object.values(MBB_FILES)]

const mkBars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i, c: 101 + i + (i % 3), v: 1000,
}))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
const guardOf = (src, bars = mkBars(40)) => {
  const b = buildRuntimeIr(src, { bars, inputs: {} })
  return b.ok ? 'ok' : b.refusal.guard
}
function runPlots(src, n) {
  const bars = mkBars(n)
  const built = buildRuntimeIr(src, { bars, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: n, series: seriesOf(bars), columns: program.columns, confirmed: true,
    barTimes: bars.map((b) => b.t),
  })
  return res.outputs.map((o) => Array.from(o))
}

describe('W4-T17 probes are well formed', () => {
  for (const f of ALL) {
    it(`${f}: version header, a unique title per plot, never-compiled note`, () => {
      const src = read(f)
      const want = f.endsWith('-v4.pine') ? '//@version=4' : f.endsWith('-v5.pine') ? '//@version=5' : '//@version=6'
      expect(src.split('\n')[0]).toBe(want)
      expect(src).toMatch(/NEVER COMPILED ON TRADINGVIEW/)
      const titles = [...src.matchAll(/^plot\(.*"([A-Z][0-9A-Za-z_]*)"\s*\)\s*$/gm)].map((m) => m[1])
      expect(titles.length).toBeGreaterThanOrEqual(2)
      expect(new Set(titles).size, 'duplicate plot title').toBe(titles.length)
    })
  }
})

// -- D1: what the runtime lane does today with each row, per version (ok = it builds) --
const ROW_RE = /^plot\(.*"([RC]\d\d[^"]*)"\s*\)\s*$/
function d1Rows(file) {
  const lines = read(file).split('\n')
  const pre = lines.filter((l) => /^(\/\/@version|indicator|study|len |dlen |CLEN|CDLEN|const int)/.test(l))
  const rows = {}
  for (const l of lines) {
    const m = ROW_RE.exec(l)
    if (m) rows[m[1].slice(0, 3)] = guardOf(`${pre.join('\n')}\n${l}\n`)
  }
  return rows
}

describe('W4-D1 baseline: ours today (the captures settle which of these are RIGHT)', () => {
  // v4/v5 already truncate a literal/const int quotient used as a length (R01, R03) and fold a const
  // offset (R04); the literal offset `21 / 2 + 1` (R02) and every input.int operand (R05-R08)
  // refuse. v6 refuses every division, by name, because the v6 quotient is a fraction.
  const FOLDS = {
    R01: 'ok', R02: 'pine:offset-literal', R03: 'ok', R04: 'ok', R05: 'pine:window',
    R06: 'pine:offset-literal', R07: 'pine:window', R08: 'pine:offset-literal', R09: 'ok', R10: 'ok',
  }
  const V6 = { ...FOLDS, R01: 'pine:window', R03: 'pine:window', R04: 'pine:offset-literal' }
  it('v4 and v5 rows', () => {
    expect(d1Rows(D1_FILES.v4)).toMatchObject(FOLDS)
    expect(d1Rows(D1_FILES.v5)).toMatchObject(FOLDS)
  })
  it('v6 rows', () => {
    expect(d1Rows(D1_FILES.v6)).toMatchObject(V6)
  })
  it('controls build in every version (the probe harness itself is sound)', () => {
    for (const f of Object.values(D1_FILES)) {
      const r = d1Rows(f)
      for (const c of ['C01', 'C02', 'C03', 'C04', 'C05']) expect(r[c], `${f} ${c}`).toBe('ok')
    }
  })
})

describe('W4-M1..M5 baseline: ours today', () => {
  it('M1 / M5 refuse the constant offset by name; M4 refuses max_bars_back(x, n); M2 / M3 build', () => {
    expect(guardOf(read(MBB_FILES.M1))).toBe('runtime:directive')
    expect(guardOf(read(MBB_FILES.M5))).toBe('runtime:directive')
    expect(guardOf(read(MBB_FILES.M4))).toBe('runtime:directive')
    expect(guardOf(read(MBB_FILES.M2), mkBars(400))).toBe('ok')
    expect(guardOf(read(MBB_FILES.M3), mkBars(400))).toBe('ok')
  })
  it('M2: the VM stops on the read that passes the declared buffer, saying so', () => {
    expect(() => runPlots(read(MBB_FILES.M2), 400))
      .toThrow(/history offset of 25 reaches past Pine's history buffer of 20/)
  })
  it('M3: no declaration, the 250-bar offset after bar 300 is served from the 5,000-bar default', () => {
    const [, closeAtN] = runPlots(read(MBB_FILES.M3), 400)
    expect(closeAtN[300]).toBe(mkBars(400)[299].c) // n = 1 at bar 301 reads one bar back
    expect(closeAtN[399]).toBe(mkBars(400)[149].c) // n = 250 at bar 399
  })
})

// -- T13 spike --
describe('W4-T13 spike: can the member pane draw an OHLC row from the run?', () => {
  const head = '//@version=6\nindicator("t")\n'
  it('the run refuses plotcandle / plotbar by name today', () => {
    expect(guardOf(`${head}plotcandle(open, high, low, close)\nplot(close)`)).toBe('runtime:presentation')
    expect(guardOf(`${head}plotbar(open, high, low, close)\nplot(close)`)).toBe('runtime:presentation')
  })
  it('the run CAN compute the four columns, and an na open is NaN on exactly that bar', () => {
    const [o, h, l, c] = runPlots(
      `${head}o = bar_index == 2 ? na : open\nplot(o)\nplot(high)\nplot(low)\nplot(close)`, 6)
    expect(o.map((x) => (Number.isNaN(x) ? 'na' : x))).toEqual([100, 101, 'na', 103, 104, 105])
    expect(h[2]).toBe(104)
    expect(l[2]).toBe(100)
    expect(c[2]).toBe(105)
  })
  it('the RENDERER exists: a candles / ohlcBars plot gets a candlestick / bar series', () => {
    expect(poolKey({ style: 'candles' })).toBe('candlestick')
    expect(poolKey({ style: 'ohlcBars' })).toBe('bar')
    expect(OHLC_POOL_KEYS).toEqual(['candlestick', 'bar'])
  })
  it('but the only OHLC FEED reads a symbol\'s bars: a computed row is refused as NOT_PASSTHROUGH', () => {
    const parsed = parseSource(symbolSource('QQQ', 'close'))
    const bars = [{ t: '2026-09-01', o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }]
    const v = ohlcCapabilityOf(registry.getDefinition('movingAverage'), parsed, { bars }, () => OHLC_FAMILY.SECURITY)
    expect(v.ok).toBe(false)
    expect(v.reason).toBe(OHLC_REFUSAL.NOT_PASSTHROUGH)
  })
  it('the library draws a PER-POINT candle colour, wick and border (bars carry colour only)', () => {
    const dts = fs.readFileSync(path.join(ROOT, 'app/node_modules/lightweight-charts/dist/typings.d.ts'), 'utf8')
    const block = (name) => {
      const at = dts.indexOf(`export interface ${name}`)
      return dts.slice(at, at + 700)
    }
    expect(block('CandlestickData')).toMatch(/color\?: string[\s\S]*borderColor\?: string[\s\S]*wickColor\?: string/)
    expect(block('BarData')).toMatch(/color\?: string/)
    expect(block('BarData')).not.toMatch(/wickColor|borderColor/)
  })
})
