// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.cap5Captures.test.js
//
// CAP5 (2026-10-04, `docs/pine/capture-round-5-runbook.md` § 6) - the round-5 queue, captured
// on the TradingView rig as unsaved Create-new drafts (each source fetched at the pinned commit
// and admitted only when its sha256 equalled the committed blob's), read with `tv_capture.js`,
// moved out through the hash-receipted clipboard and assembled by `verify_capture.mjs`
// (VERDICT: PASS). H11 (branch `pine/h11-cap5-findings`) wrote this file (runbook § 8 step 3).
//
// Three kinds of rail here, on the model of `vendorHarness.cap4Captures.test.js`:
//   1. VENDOR FACTS - what TradingView printed / plotted, read straight off each capture
//      (its `source.sha256` = the committed probe's). The owning lanes serve from these.
//   2. READINGS WITHOUT A FIXTURE - the runbook's § 6 records the errors TradingView raised
//      (RE10001, RE10137, the v5 bare `alma` compile error); each one's engine answer is
//      railed here against the vendor's own words.
//   3. OUR GRADE - each row of `cap5-verdicts.json` (written by `cap5Captures.measure.test.js`
//      from the harness's own verdict, never by hand): MATCH is an `expect`; DIVERGE is an
//      `it.fails` asserting MATCH beside the named signature control.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { cap3Signature } from './cap3Signature'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { clearPineLibraries } from '../../ast/pineLibraryStore'
import { translatePine } from '../../ast/pine.js'
import { pivotAt } from '../../ast/interpret.js'
import { historyReachOf, AUTO_MAX_BARS_BACK } from '../../ast/objectProgram.js'
import { versionObjectDefaults } from '../../objectDefaults.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { DEFAULT_LIMITS } from '../../runtime/limits.js'

afterEach(() => { vi.unstubAllEnvs() })
const T = 600000
const STORE_DIR = process.env.PINE_LIBRARY_STORE || ''
const CAP5 = JSON.parse(fs.readFileSync(path.join(__dirname, 'cap5-verdicts.json'), 'utf8')).captures
  .filter((row) => row.id)
const cap = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const col = (c, title) => {
  const plot = c.study.plots.find((p) => p.title === title)
  expect(plot, `plot ${title}`).toBeTruthy()
  const at = c.plotValues.fields.indexOf(plot.id)
  return c.plotValues.rows.map((r) => r[at])
}
const cellsByRow = (c) => {
  const m = {}
  for (const x of c.objects.records.tableCells) (m[x.row] = m[x.row] || [])[x.col] = x.t
  return m
}
// TradingView's direct colorer columns pack a colour as 0xAABBGGRR; this reads it as #rrggbbaa.
const hex = (n) => (n === null ? null : `#${[0, 8, 16].map((sh) => ((n >>> sh) & 255).toString(16).padStart(2, '0')).join('')}${((n >>> 24) & 255).toString(16).padStart(2, '0')}`)
const colorer = (c, title) => {
  const target = c.study.plots.find((p) => p.title === title).id
  const p = c.study.plots.find((x) => x.type === 'colorer' && x.target === target)
  if (!p) return null
  const at = c.plotValues.fields.indexOf(p.id)
  return c.plotValues.rows.map((r) => r[at])
}

const gradeRow = (row) => {
  if (row.library) loadPineLibraryStore(STORE_DIR)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  if (row.state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const v = gradeCapture(cap(row.id)).verdict
  vi.unstubAllEnvs()
  clearPineLibraries()
  return v
}

// The runtime lane run directly (the `arrays.test.js` / `requests.test.js` harness shape).
const RN = 4
const RBARS = Array.from({ length: RN }, (_, i) => ({ t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const RSERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(RBARS.map((b) => b[k])))
const runPine = (src, extra = {}, limits) => {
  const built = buildRuntimeIr(`//@version=6\nindicator("t")\n${src}`, { bars: RBARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, { bars: RN, series: RSERIES, columns: program.columns, confirmed: true, barTimes: RBARS.map((b) => b.t), ...extra }, limits)
  return res.outputs.map((o) => Array.from(o))
}

describe('CAP5 S2-8 - a declared buffer OVERRUN, AMEX:SPY 1D full history (vendor witness)', () => {
  const ID = 'vw-cap5-buffer-overrun-spy-1d-2026-10-04'
  it('the source is the committed probe (`max_bars_back = 50`); 8477 bars from the listing', () => {
    const c = cap(ID)
    expect(c.source.sha256).toBe('92629caf69b0e47bec8a52e55a30d00dfb3c1ee101fccbdd997756cc15c7e42e')
    expect(c.history.startsAtBar0).toBe(true)
    expect(c.bars.count).toBe(8477)
  })
  it('NO runtime error: V02 `close[bar_index % 60]` is the real close on every bar, the 1,410 bars past 50 included (0 `na`)', () => {
    const c = cap(ID)
    const e = col(c, 'V01 e (reaches 50..59 every 60 bars)')
    const v = col(c, 'V02 close[e] past max_bars_back = 50')
    expect(e.filter((k) => k >= 50).length).toBe(1410)
    expect(v.every((x, i) => x === c.bars.rows[i - e[i]][4])).toBe(true)
  })
  it('ours: a declared buffer is not a ceiling - the reach is max(declared, the measured automatic 400)', () => {
    expect(historyReachOf(50)).toBe(AUTO_MAX_BARS_BACK)
    expect(historyReachOf(500)).toBe(500)
    expect(historyReachOf(null)).toBe(AUTO_MAX_BARS_BACK)
  })
})

describe('CAP5 S2-7 - `max_bars_back(x, n)`, AMEX:SPY 1D (vendor witness)', () => {
  const ID = 'vw-cap5-max-bars-back-spy-1d-2026-10-04'
  it('the source is the committed probe; the per-series call compiles', () => {
    expect(cap(ID).source.sha256).toBe('dfd6f9095e36c9fc4d413dcde0e73e7a236c50136c2c169bac3d5be964744d65')
  })
  it('`src[e]` after `max_bars_back(src, 50)` is the real `close[e]` on all 8477 bars (M04 0, M05 0 everywhere)', () => {
    const c = cap(ID)
    const e = col(c, 'M01 e (0..44, inside the declared 50)')
    expect(col(c, 'M02 src[e], max_bars_back(src, 50)').every((x, i) => x === c.bars.rows[i - e[i]][4])).toBe(true)
    expect(new Set(col(c, 'M04 difference (0, or na where the buffer is short)'))).toEqual(new Set([0]))
    expect(new Set(col(c, 'M05 src[e] is na'))).toEqual(new Set([0]))
  })
})

describe('CAP5 S1-1 / S2-1 - Q-F9a/b/c colour rules, NYSE:RDDT 1D and AMEX:SPY 1D (vendor witness)', () => {
  for (const ID of ['vw-cap5-f9-h6-rddt-1d-2026-10-04', 'vw-cap5-f9-h6-spy-1d-2026-10-04']) {
    it(`${ID}: the source is the combined committed probe`, () => {
      expect(cap(ID).source.sha256).toBe('39ace87d2d4497da04b334683e85c0968310529f6c24218238db075f9a2314d0')
    })
    it(`${ID}: Q-F9a - an \`na\` leaf under \`color.new(…, t)\` is BLACK at t (N01 #00000099, N02 #000000ff)`, () => {
      const c = cap(ID)
      const up = c.bars.rows.map((b) => b[4] > b[1])
      expect(colorer(c, 'N01 new(cond ? blue : na, 40)').map(hex)).toEqual(up.map((u) => (u ? '#2962ff99' : '#00000099')))
      expect(colorer(c, 'N02 new(cond ? na : red, 0)').map(hex)).toEqual(up.map((u) => (u ? '#000000ff' : '#f23645ff')))
    })
    it(`${ID}: Q-F9b - a \`var\` colour's \`na\` write is NO colour bare (V01) and black under color.new (V02)`, () => {
      const c = cap(ID)
      const B = c.bars.rows
      // the var's running value: white, lime on a higher close, na on a lower one
      let v = 'w'
      const state = B.map((b, i) => {
        if (i > 0 && b[4] > B[i - 1][4]) v = 'l'
        if (i > 0 && b[4] < B[i - 1][4]) v = 'na'
        return v
      })
      expect(colorer(c, 'V01 var colour with an na write').map(hex)).toEqual(state.map((s) => ({ w: '#ffffffff', l: '#00e676ff', na: null })[s]))
      expect(colorer(c, 'V02 new(var with na, 40)').map(hex)).toEqual(state.map((s) => ({ w: '#ffffff99', l: '#00e67699', na: '#00000099' })[s]))
    })
    it(`${ID}: Q-F9c - a colour name read ABOVE its reassignment is the value at that line (R01 static red, R02 the rule)`, () => {
      const c = cap(ID)
      const r01 = c.study.plots.find((p) => p.title === 'R01 colour read before its reassignment')
      expect(colorer(c, 'R01 colour read before its reassignment')).toBeNull()
      expect(c.study.styleState[r01.id].color).toBe('#F23645')
      const up = c.bars.rows.map((b) => b[4] > b[1])
      expect(colorer(c, 'R02 the same name after it').map(hex)).toEqual(up.map((u) => (u ? '#4caf50ff' : '#ff9800ff')))
    })
  }
})

describe('CAP5 S1-2 / S2-9 - Q-RT15b `nz(<colour>)`, NYSE:RDDT 1D and AMEX:SPY 1D (vendor witness)', () => {
  for (const ID of ['vw-rt15-colour-nz-rddt-1d-2026-10-04', 'vw-rt15-colour-nz-spy-1d-2026-10-04']) {
    it(`${ID}: N03 \`nz(c, gray)\` is GRAY (palette 2) on bars 0-9 where \`c\` is na, then c's green / red`, () => {
      const c = cap(ID)
      expect(c.source.sha256).toBe('6cb2e5e6886af1cfec290bb0dd4b2ea79e7dc0ed99ee60ce939abde1ceb1c815')
      expect(c.study.palettes.palette_2.colors['2'].color).toBe('#787B86')
      const n03 = colorer(c, 'N03 nz(c, gray) plot colour')
      expect(n03.slice(0, 10)).toEqual(new Array(10).fill(2))
      expect(n03.slice(10)).toEqual(c.bars.rows.slice(10).map((b) => (b[4] > b[1] ? 0 : 1)))
    })
    it(`${ID}: N01 \`nz(c)\` is c's green / red from bar 10; on bars 0-9 the palette colorer records index 0 for the na colour (B01's screenshot: no paint)`, () => {
      const c = cap(ID)
      const n01 = colorer(c, 'N01 nz(c) plot colour')
      expect(n01.slice(0, 10)).toEqual(new Array(10).fill(0))
      expect(n01.slice(10)).toEqual(c.bars.rows.slice(10).map((b) => (b[4] > b[1] ? 0 : 1)))
    })
  }
})

describe('CAP5 S1-9 / S1-10 - owed row 14, the unset v6 / v4 object colours, NYSE:RDDT 1D (vendor witness)', () => {
  const pal = (c) => c.study.paletteState.palette_common.colors
  it('v6: an unset box border AND fill are OPAQUE `color.blue`; an unset cell text is `color.black`', () => {
    const c = cap('vw-cap5-version-defaults-v6-rddt-1d-2026-10-04')
    expect(c.source.sha256).toBe('95e12bff5994aff25c42cb656e2d2c98e0861c42a56cb3efc196d752a7728a11')
    const P = pal(c)
    const [plain, redBorder, blueFill] = [...c.objects.records.boxes].sort((a, b) => a.id - b.id)
    expect([plain, redBorder, blueFill].map((b) => [P[b.c].color, P[b.bc].color])).toEqual([
      ['rgba(41,98,255,1)', 'rgba(41,98,255,1)'], ['rgba(242,54,69,1)', 'rgba(41,98,255,1)'], ['rgba(41,98,255,1)', 'rgba(41,98,255,1)']])
    expect(c.objects.records.tableCells.map((x) => P[x.tc].color)).toEqual(['rgba(54,58,69,1)', 'rgba(54,58,69,1)', 'rgba(54,58,69,1)'])
    expect(versionObjectDefaults(6)).toEqual({ box: { bgcolor: '#2962FF' }, cell: { text_color: '#363A45' } })
  })
  it('v4: an unset box border AND fill are OPAQUE v4 `color.blue` (#2196F3); an unset cell text is `color.black`', () => {
    const c = cap('vw-cap5-version-defaults-v4-rddt-1d-2026-10-04')
    expect(c.source.sha256).toBe('a1cecb5665d3527544da011cd69b24264c4aabc4059306a4a3e965081fd8bfcd')
    const P = pal(c)
    const boxes = [...c.objects.records.boxes].sort((a, b) => a.id - b.id)
    expect(boxes.map((b) => [P[b.c].color, P[b.bc].color])).toEqual([['#2196F3', '#2196F3'], ['#2196F3', '#2196F3'], ['#FF5252', '#2196F3']])
    expect(c.objects.records.tableCells.map((x) => P[x.tc].color)).toEqual(['#363A45', '#363A45'])
    expect(versionObjectDefaults(4)).toMatchObject({ box: { border_color: '#2196F3', bgcolor: '#2196F3' }, cell: { text_color: '#363A45' } })
  })
})

describe('CAP5 S1-8 - Q-RT10a pivots over runtime state, NYSE:RDDT 1D (vendor witness)', () => {
  const ID = 'vw-rt10-runtime-walls-rddt-1d-2026-10-04'
  it('the source is the committed probe; the duplicate `1 =>` switch arm compiled', () => {
    expect(cap(ID).source.sha256).toBe('ff03bd0478f3c8f06542e7061cf245163648c4261952788fe75bd15e0369c36f')
  })
  it('an `na` in the pivot window is a BARRIER: `pivotAt` answers all 4 x 636 bars of P01-P04', () => {
    const c = cap(ID)
    const x = col(c, 'P00 x control').map((v) => (v === null ? NaN : v))
    const at = (s, L, R, beats) => s.map((_, i) => (i - R - L >= 0 && pivotAt(s, i - R, L, R, beats) ? s[i - R] : null))
    const hi = (a, b) => a > b
    const lo = (a, b) => a < b
    expect(col(c, 'P01 pivothigh(x,2,3)')).toEqual(at(x, 2, 3, hi))
    expect(col(c, 'P02 pivotlow(x,2,2)')).toEqual(at(x, 2, 2, lo))
    expect(col(c, 'P03 f(x) pivotlow(1,2)')).toEqual(at(x, 1, 2, lo))
    expect(col(c, 'P04 f(x+1) pivotlow(1,2)')).toEqual(at(x.map((v) => v + 1), 1, 2, lo))
    // the hole-adjacent bar that tells the barrier from a veto: candidate 116.38 (bar 36),
    // bar 37 `na`, bar 38 121.26 - still TradingView's pivot high on bar 39
    expect(col(c, 'P01 pivothigh(x,2,3)')[39]).toBe(116.38)
  })
})

describe('CAP5 S2-4 / S2-3 - Q-RT11b bare `alma`, AMEX:SPY 1D (vendor witness)', () => {
  const ID = 'vw-rt11-alma-v3-bare-spy-1d-2026-10-04'
  it('v3 bare `alma(close, 9, 0.85, 6)` COMPILES and is `pine_alma` on all 8477 bars (first value on bar 8)', () => {
    const c = cap(ID)
    expect(c.source.sha256).toBe('2f1bf87721ba3ab02927e64433cf4482eb84459e17cea17089f35bc728aa4e44')
    const C = c.bars.rows.map((b) => b[4])
    const n = 9
    const m = 0.85 * (n - 1)
    const s = n / 6
    const want = C.map((_, i) => {
      if (i < n - 1) return null
      let norm = 0
      let sum = 0
      for (let k = 0; k < n; k += 1) { const w = Math.exp(-((k - m) ** 2) / (2 * s * s)); norm += w; sum += w * C[i - (n - 1) + k] }
      return sum / norm
    })
    const got = col(c, 'A01 bare alma v3')
    expect(got.findIndex((v) => v !== null)).toBe(8)
    expect(got.every((v, i) => (v === null ? want[i] === null : Math.abs(v - want[i]) < 1e-9 * Math.max(1, Math.abs(v))))).toBe(true)
    // v3's `n` is the bar index (A00)
    expect(col(c, 'A00 bar index CONTROL').every((v, i) => v === i)).toBe(true)
  })
  it('ours: the alma gate admits bare `alma` in v3 (its next wall is v3\'s `n`), and still refuses it in v5 (TradingView: "Could not find function or function reference \'alma\'")', () => {
    const at = (v, body) => translatePine(`//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("t")\n${body}\n`, { strict: true })
    const v3 = at(3, 'plot(alma(close, 9, 0.85, 6))')
    expect(v3.ok, JSON.stringify(v3.refusal)).toBe(true)
    const v5 = at(5, 'plot(alma(close, 9, 0.85, 6))')
    expect(v5.ok).toBe(false)
    const probe = at(3, 'plot(n, "A00")\nplot(alma(close, 9, 0.85, 6), "A01")')
    expect(probe.ok).toBe(false)
    expect(probe.refusal.message).toMatch(/`n`/)
  })
})

describe('CAP5 S2-6 - Q-H7a `format.volume` edges and Q-C31b `for` direction, AMEX:SPY 1D (vendor witness)', () => {
  const ID = 'vw-cap5-spy-text-spy-1d-2026-10-04'
  it('the source is the committed probe; one table, 63 cells', () => {
    const c = cap(ID)
    expect(c.source.sha256).toBe('0b6425252febf4888d385686b44233b961e9a91a18d6d2a50ff8333f7e0f7c22')
    expect(c.objects.counts).toMatchObject({ tables: 1, tableCells: 63 })
  })
  it('format.volume: below 1,000 rounds to a whole number and a .5 tie rounds AWAY from zero (999.5 -> "1000", no K); -0 is "0"; T never rolls over', () => {
    const m = cellsByRow(cap(ID))
    expect(Object.fromEntries(Object.entries(m).filter(([r]) => Number(r) <= 14).map(([r, cells]) => [r, cells.slice(1)]))).toEqual({
      0: ['3.126M', '3125951'],
      1: ['0', '0.25'],
      2: ['8', '7.5'],
      3: ['999', '999.4'],
      4: ['1000', '999.5'],
      5: ['1000', '999.9999'],
      6: ['-7', '-7'],
      7: ['-1000', '-999.5'],
      8: ['0', '0'],
      9: ['-3.126M', '-3125500'],
      10: ['-1.501K', '-1500.5'],
      11: ['1000T', '1000000000000000'],
      12: ['2500T', '2500000000000000'],
      13: ['1000000T', '1000000000000000000'],
      14: ['123.457T', '123456789012345'],
    })
  })
  it('`for i = a to b` counts DOWN when b < a, a positive `by` is a magnitude, and `0 to -1` runs TWICE (0, -1) - it is not empty', () => {
    const m = cellsByRow(cap(ID))
    expect(m[16].slice(1)).toEqual(['9,8,7,6,5,4,3,2,1,0,', '10'])
    expect(m[17].slice(1)).toEqual(['0,-1,', '2'])
    expect(m[18].slice(1)).toEqual(['3,', '1'])
    expect(m[19].slice(1)).toEqual(['9,6,3,0,', '4'])
    expect(m[20].slice(1)).toEqual(['0,2,4,6,', '4'])
    expect(m[21].slice(1)).toEqual(['0,-1,', '2'])
  })
})

describe('CAP5 S2-21 - vendor packet M7 `array.sort_indices` ties, AMEX:SPY 1D (vendor witness)', () => {
  const ID = 'vw-m7-sort-indices-ties-spy-1d-2026-10-04'
  it('ties keep their order ascending and reverse descending; all-equal ascending 0..n-1, descending n-1..0', () => {
    const c = cap(ID)
    expect(c.source.sha256).toBe('6da09bd94ef707acd5aa9054bdb68cbe050d0c397d2f185c574a89672fd1f0b9')
    const m = cellsByRow(c)
    expect([1, 2, 4, 5, 6].map((r) => m[r][1])).toEqual(['3,1,4,0,2,5', '5,2,0,4,1,3', '0,1,2,3', '3,2,1,0', '2,1,0'])
  })
  it('ours (runtime lane): `array.sort_indices` answers every M7 row', () => {
    const idx = (vals, order, k) => runPine(`a = array.from(${vals.map((v) => v.toFixed(1)).join(', ')})\n`
      + `i = array.sort_indices(a${order ? `, ${order}` : ''})\nplot(array.get(i, ${k}))\n`)[0][0]
    const all = (vals, order) => vals.map((_, k) => idx(vals, order, k)).join(',')
    expect(all([5, 3, 5, 1, 3, 5])).toBe('3,1,4,0,2,5')
    expect(all([5, 3, 5, 1, 3, 5], 'order.descending')).toBe('5,2,0,4,1,3')
    expect(all([7, 7, 7, 7])).toBe('0,1,2,3')
    expect(all([7, 7, 7, 7], 'order.descending')).toBe('3,2,1,0')
    expect(all([3, 2, 1])).toBe('2,1,0')
  })
  it('ours: `array.sort` reorders the values in place - on the runtime lane, and the host lane no longer reads the CREATION order', () => {
    const src = 'a = array.from(3.0, 1.0, 2.0)\narray.sort(a)\nplot(array.get(a, 0) * 100 + array.get(a, 1) * 10 + array.get(a, 2))\n'
    expect(runPine(src)[0]).toEqual(new Array(RN).fill(123))
    expect(runPine(src.replace('array.sort(a)', 'array.sort(a, order.descending)'))[0]).toEqual(new Array(RN).fill(321))
    // ⚰️ the host vector lane drew 312 (the creation order) on every bar: now an unmodelled write
    const host = translatePine(`//@version=6\nindicator("t")\n${src}`, { strict: true })
    expect(host.ok).toBe(false)
    expect(host.refusal.guard).toBe('pine:collection')
    // an `na` element: where Pine sorts it is unmeasured - the run stops by name
    expect(() => runPine('a = array.from(3.0, na, 2.0)\narray.sort(a)\nplot(array.get(a, 0))\n')).toThrow(/array\.sort.*na/)
  })
})

describe('CAP5 - readings with no fixture (runbook § 6), and our answer to each', () => {
  it('S1-7 / S2-5: `ta.lowest(low, <na or 0>)` - TradingView stops on bar 0 with RE10001; ours refuses in its words and draws nothing', () => {
    for (const body of ['plot(ta.lowest(low, 0))', 'int n = na\nplot(ta.lowest(low, n))']) {
      const t = translatePine(`//@version=6\nindicator("t")\n${body}\n`, { strict: true })
      expect(t.ok).toBe(false)
      expect(t.refusal.message).toContain("Invalid value of the 'length' argument (0) in the 'lowest' function. It must be > 0.")
    }
    // control - a whole length still translates
    expect(translatePine('//@version=6\nindicator("t")\nplot(ta.lowest(low, 3))\n', { strict: true }).ok).toBe(true)
  })
  it('S2-20 (M5): 40 unique `request.*()` calls run on TradingView Premium, the 41st stops (RE10137) - and here', () => {
    expect(DEFAULT_LIMITS.REQUEST_COUNT).toBe(40)
    const syms = (k) => Array.from({ length: k }, (_, i) => `S${i}`).join(',')
    const src = (k) => `p = str.split("${syms(k)}", ",")\nfloat s = 0.0\nfor i = 0 to array.size(p) - 1\n`
      + '    s := s + nz(request.security(array.get(p, i), "D", close))\nplot(s)\n'
    expect(() => runPine(src(40))).not.toThrow()
    expect(() => runPine(src(41))).toThrow(/REQUEST_COUNT/)
  })
})

describe('CAP5 - our grade of each capture, pinned by measured signature', () => {
  it('every captured row carries a measured signature', () => {
    expect(CAP5.length).toBeGreaterThan(0)
    for (const row of CAP5) expect(row.signature, `${row.id} ${row.state}`).toBeTruthy()
  })
  for (const row of CAP5) {
    const run = row.library && !STORE_DIR ? it.skip : it
    if (row.signature && row.signature.verdict === 'MATCH') {
      run(`${row.id} (${row.state}): MATCH`, () => { expect(gradeRow(row).verdict).toBe('MATCH') }, T)
      continue
    }
    if (row.signature && row.signature.verdict === 'DIVERGE') {
      ;(row.library && !STORE_DIR ? it.skip : it.fails)(`${row.id} (${row.state}): MATCH`, () => {
        expect(gradeRow(row).verdict).toBe('MATCH')
      }, T)
    }
    run(`control: ${row.id} (${row.state}) - the grade is the measured signature (${row.signature && row.signature.verdict})`, () => {
      expect(cap3Signature(gradeRow(row))).toEqual(row.signature)
    }, T)
  }
})
