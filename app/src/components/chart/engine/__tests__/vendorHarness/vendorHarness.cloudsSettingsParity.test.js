// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.cloudsSettingsParity.test.js
//
// ─── ⭐⭐ UNCHARTED CLOUDS AT A MEMBER'S OWN SETTINGS — set E vs TradingView ─────
//
// Set E (`tests/fixtures/vendor/reference/E/`) is TradingView's own output for the
// same script on the same SPY 1D window as capture A, each with one group of
// inputs changed the way a member changes them in the settings dialog (E8: NVDA
// 4H). This rail applies EACH capture's changed inputs through the product's own
// doors (`cloudsDraw.js` says which) — never a hand-built document — then grades,
// per capture, what the chart draws:
//
//   • values  — 2 MAs + 21 layers, every window bar, ≤ 1e-9 relative;
//   • bands   — every band's PAINTED colour on every bar, hue and alpha BYTE;
//   • lines   — each MA's colour, alpha byte and line width (and, for a hidden
//               MA, that it draws nothing).
//
// ⛔⛔ A SETTING THE PRODUCT CANNOT EXPRESS IS NOT SKIPPED — IT IS PINNED. Each
// capture's row in `PINNED` names the Pine inputs no door reaches (`gaps`) and the
// verdict of each family. A family a gap breaks must read `differ`, so the gap is
// shown to be CONSEQUENTIAL (the chart really is wrong), and the day a door is
// built the pin goes red and has to be updated to `equal` — the rail cannot be
// quietly satisfied by closing nothing, or by closing something without saying.
//
// ⭐ The alpha byte is TradingView's: `round(opacity × 255)` half-up, which E5's
// own bull colour proves (0.7 × 255 = 178.5 → 179, `0xB376E600`).
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { unpackVendorColor } from '../../colorInt'
import { withAlphaByte } from '../../../designTokens'
import { REF, runCloudsCapture, tvColumns, ourKeys, cssToRgba, fmt, pineInputOrder, uninstallHarness } from './cloudsDraw'

const DIR = path.join(REF, 'E')
const PLATFORM_INPUTS = new Set(['__fast_calc', '__profile', 'pineId', 'pineVersion', 'pineFeatures'])

const CAPTURES = fs.readdirSync(DIR).filter((f) => f.endsWith('.meta.json')).sort().map((f) => {
  const name = f.replace(/\.meta\.json$/, '')
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
  const order = pineInputOrder()
  const settings = {}
  const platform = {}
  for (const li of meta.capture.liveInputs) {
    if (JSON.stringify(li.value) === JSON.stringify(li.defval)) continue
    if (PLATFORM_INPUTS.has(li.id)) { platform[li.id] = li.value; continue }
    const m = /^in_(\d+)$/.exec(li.id)
    if (!m) throw new Error(`${name}: unrecognised input id ${li.id}`)
    settings[order[Number(m[1])]] = li.value
  }
  return { id: meta.capture.id, name, settings, platform }
})

/** Per capture: the Pine inputs no product door reaches, and each family's verdict. */
const PINNED = {
  E0: { gaps: [], values: 'equal', bands: 'equal', lines: 'equal' },
  E1: { gaps: ['ma1Type', 'ma2Type'], values: 'differ', bands: 'differ', lines: 'equal' },
  E2: { gaps: ['ma1Type', 'ma1Source', 'ma2Source'], values: 'differ', bands: 'differ', lines: 'equal' },
  E3: { gaps: [], values: 'equal', bands: 'equal', lines: 'equal' },
  E4: { gaps: [], values: 'equal', bands: 'equal', lines: 'equal' },
  // ⛔ E5 lines are a DEFECT, not a gap: the Style colour door takes the member's
  // colour, but the plot still carries the SCRIPT DEFAULT's transparency as
  // `plots[].opacity` (0 for `color.new(white, 100)`, 0.05 for `(white, 95)`) and
  // the renderer multiplies the two — so a member's opaque yellow draws alpha 0 and
  // their 60% blue draws 3%. Pinned exactly in the test below.
  E5: { gaps: ['bullColor', 'bearColor'], values: 'equal', bands: 'differ', lines: 'differ' },
  E6: { gaps: [], values: 'equal', bands: 'equal', lines: 'equal' },
  E7a: { gaps: [], values: 'equal', bands: 'equal', lines: 'equal' },
  E7b: { gaps: [], values: 'equal', bands: 'equal', lines: 'equal' },
  E8: { gaps: ['ma1Type', 'ma2Type'], values: 'differ', bands: 'differ', lines: 'equal' },
}

const RUNS = new Map()
const runOf = (c) => {
  if (!RUNS.has(c.id)) RUNS.set(c.id, runCloudsCapture({ dir: DIR, name: c.name, settings: c.settings }))
  return RUNS.get(c.id)
}
afterAll(() => uninstallHarness())

/** Values: every bar where either side is finite. `skip` = TV plot ids TradingView blanks. */
function valuesVerdict(r) {
  const tv = tvColumns(r)
  const keys = ourKeys(r)
  const bad = []
  keys.forEach((k, j) => {
    const ours = r.cols[k]
    const theirs = tv.col(tv.lines[j])
    for (let i = 0; i < r.n; i += 1) {
      const a = ours[i]
      const b = theirs[i]
      if (Number.isFinite(a) !== Number.isFinite(b)) { bad.push(`${tv.lines[j]} bar ${i}: ${a} vs ${b}`); continue }
      if (Number.isFinite(b) && Math.abs(a - b) / Math.max(Math.abs(b), 1) > 1e-9) bad.push(`${tv.lines[j]} bar ${i}: ${a} vs ${b}`)
    }
  })
  return bad
}

function bandsVerdict(r) {
  const tv = tvColumns(r)
  const bad = []
  r.bands.forEach((band, j) => {
    if (band.twice.length) bad.push(`band ${j}: bars painted twice ${band.twice.slice(0, 3)}`)
    const theirs = tv.col(tv.colourOf(`fill_${j}`))
    for (let i = 0; i < r.n; i += 1) {
      if (!Number.isFinite(theirs[i])) { if (band.perBar[i] !== null) bad.push(`band ${j} bar ${i}: painted where TradingView has none`); continue }
      const t = unpackVendorColor(theirs[i])
      const o = cssToRgba(band.perBar[i])
      if (!o || o.hex !== t.hex || o.a !== t.alphaByte) bad.push(`band ${j} bar ${i}: ours ${fmt(o)} vs TradingView ${t.hex}/${t.alphaByte}`)
    }
  })
  return bad
}

function linesVerdict(r) {
  const tv = tvColumns(r)
  const styles = r.meta.plotStyles || r.study.properties.styles
  const bad = []
  r.drawnPlots.forEach((plot, j) => {
    const pid = tv.lines[j]
    const s = r.lineOf.get(plot.key)
    const theirs = [...new Set(tv.col(tv.colourOf(pid)).filter(Number.isFinite).map((v) => {
      const u = unpackVendorColor(v)
      return `${u.hex}/${u.alphaByte}`
    }))]
    if (theirs.length !== 1) bad.push(`${pid}: TradingView colour not constant: ${theirs}`)
    // ⛔ a hidden MA: TradingView blanks the plot; ours must DRAW NOTHING there —
    // either no series at all, or a series (the bands' host) holding no value.
    const blank = tv.col(pid).every((v) => !Number.isFinite(v))
    const drawn = s ? ((r.setDataOf(s) || []).slice(r.pre).filter((p) => p && Number.isFinite(p.value)).length) : 0
    if (blank) {
      if (drawn) bad.push(`${pid}: TradingView draws nothing, ours draws ${drawn} points`)
      return
    }
    if (!s) { bad.push(`${pid}: TradingView draws a line, ours binds no series`); return }
    const ours = fmt(cssToRgba(s.__options.color))
    if (ours !== theirs[0]) bad.push(`${pid} colour: ours ${ours} vs TradingView ${theirs[0]}`)
    if (s.__options.lineWidth !== styles[pid].linewidth) bad.push(`${pid} linewidth: ours ${s.__options.lineWidth} vs ${styles[pid].linewidth}`)
  })
  return bad
}

describe('set E — the captures and their settings are what the meta says', () => {
  it('NON-VACUITY — ten captures, each pinned, the changed inputs read from the meta', () => {
    expect(CAPTURES.map((c) => c.id)).toEqual(Object.keys(PINNED))
    const byId = Object.fromEntries(CAPTURES.map((c) => [c.id, c.settings]))
    expect(byId.E0).toEqual({})
    expect(byId.E3).toEqual({ ma1Length: 5, ma2Length: 50 })
    expect(byId.E5).toMatchObject({ bullColor: 'rgba(0,230,118,0.7)', bearColor: '#FF6D00' })
    expect(byId.E6).toEqual({ showMA1: false, showMA2: false })
  })

  it('⭐ TradingView rounds alpha HALF-UP to a byte, and so does our encoder', () => {
    // E5's bull colour, as the capture's own study title carries it.
    const e5 = JSON.parse(fs.readFileSync(path.join(DIR, 'e5-custom-colours-spy-1d-250.meta.json'), 'utf8'))
    const title = e5.studies.find((s) => s.slug === 'uncharted_clouds').title
    expect(title).toContain('3,010,913,792')
    expect(unpackVendorColor(3010913792)).toMatchObject({ hex: '#00E676', alphaByte: 179 })
    expect(withAlphaByte('#00E676', 0.7)).toBe('#00E676B3')
  })

  it('⭐ E7a / E7b are CONTROLS: a platform input changes nothing TradingView emits', () => {
    const read = (c) => fs.readFileSync(path.join(DIR, `${c.name}.csv`), 'utf8').split(/\r?\n/).slice(1).map((l) => l.split(',').slice(1).join(','))
    const e0 = read(CAPTURES.find((c) => c.id === 'E0'))
    for (const id of ['E7a', 'E7b']) {
      const c = CAPTURES.find((x) => x.id === id)
      expect(Object.keys(c.settings), `${id} changes a script input`).toEqual([])
      expect(Object.keys(c.platform).length, `${id} changes no platform input`).toBe(1)
      expect(read(c)).toEqual(e0)
    }
  })
})

describe("⛔ E5 — a member's MA colour is multiplied by the script default's opacity (open defect)", () => {
  it('pins the exact wrong bytes, so a fix turns this red and the pin to "equal"', () => {
    const c = CAPTURES.find((x) => x.id === 'E5')
    const r = runOf(c)
    const [fast, slow] = r.drawnPlots
    expect(fmt(cssToRgba(r.lineOf.get(fast.key).__options.color))).toBe('#FFEB3B/0')     // TradingView #FFEB3B/255
    expect(fmt(cssToRgba(r.lineOf.get(slow.key).__options.color))).toBe('#2196F3/8')     // TradingView #2196F3/153 (0.6 x 0.05)
    expect(linesVerdict(r)).toEqual([
      'plot_0 colour: ours #FFEB3B/0 vs TradingView #FFEB3B/255',
      'plot_2 colour: ours #2196F3/8 vs TradingView #2196F3/153',
    ])
  })
})

describe.each(CAPTURES)('Uncharted Clouds at $id ($name)', (c) => {
  const pin = PINNED[c.id]

  it('the settings reach the chart through the product, and the gaps are exactly the pinned ones', () => {
    const r = runOf(c)
    expect(r.supply.kind === 'warm' || r.pre === 0).toBe(true)
    expect(r.gaps.map((g) => g.name).sort(), JSON.stringify(r.gaps)).toEqual([...pin.gaps].sort())
    expect(r.applied.length + r.gaps.length).toBe(Object.keys(c.settings).length)
  })

  it(`values: ${pin.values}`, () => {
    const r = runOf(c)
    if (pin.values === 'equal') expect(r.supply.kind, `${c.id} needs warm prehistory: ${r.supply.reason}`).toBe('warm')
    const bad = valuesVerdict(r)
    if (pin.values === 'equal') expect(bad.slice(0, 8), `${bad.length} value(s) off`).toEqual([])
    else expect(bad.length, 'a pinned gap must make the values WRONG, or it is not a gap').toBeGreaterThan(0)
  })

  it(`bands, every bar, hue + alpha byte: ${pin.bands}`, () => {
    const r = runOf(c)
    expect(r.bands).toHaveLength(20)
    const bad = bandsVerdict(r)
    if (pin.bands === 'equal') expect(bad.slice(0, 8), `${bad.length} band bar(s) off`).toEqual([])
    else expect(bad.length, 'a pinned gap must make the bands WRONG, or it is not a gap').toBeGreaterThan(0)
  })

  it(`MA lines — colour, alpha byte, line width: ${pin.lines}`, () => {
    const r = runOf(c)
    expect(r.drawnPlots).toHaveLength(2)
    const bad = linesVerdict(r)
    if (pin.lines === 'equal') expect(bad, 'line(s) off').toEqual([])
    else expect(bad.length).toBeGreaterThan(0)
  })
})
