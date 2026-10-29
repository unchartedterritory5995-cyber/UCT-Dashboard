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
//   • values  — 2 MAs + 21 layers, every graded bar, ≤ 1e-9 relative;
//   • bands   — every band's PAINTED colour on every graded bar, hue and alpha BYTE;
//   • lines   — each MA's colour, alpha byte and line width (and, for a hidden
//               MA, that it draws nothing).
//
// ⭐⭐ EVERY SETTING TRADINGVIEW OFFERS REACHES THE CHART, and every capture is a
// full PASS. Round 1 pinned three gaps (MA type, MA source, cloud colours: no
// door) and one defect (a member's MA colour multiplied by the default's opacity);
// each is closed and the rail below would read red if any reopened:
//   • `input.string(…, options)` is a live dropdown knob (`pine.js::enumCompare`);
//   • a band's `input.color` is the member's pick (`fill.colorUpInput`);
//   • a row's colour carries its own alpha, so a pick replaces both (`rowColour`).
// `gaps` must be EMPTY for every capture: a door that stops reaching a setting is
// named here, never quietly graded around.
//
// ⭐ The alpha byte is TradingView's: `round(opacity × 255)` half-up, which E5's
// own bull colour proves (0.7 × 255 = 178.5 → 179, `0xB376E600`).
//
// ⭐ E8 (NVDA 4H) has no committed NVDA 4H history before its window, so it replays
// COLD. Both of its averages are SMAs, and an SMA reads exactly its own window:
// from bar `max(len) − 1` on, a cold SMA is the same number as a warm one, so E8 is
// graded from that bar — derived from the capture's own inputs, never typed.
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
  const live = {}
  for (const li of meta.capture.liveInputs) {
    const m = /^in_(\d+)$/.exec(li.id)
    if (m) live[order[Number(m[1])]] = li.value
    if (JSON.stringify(li.value) === JSON.stringify(li.defval)) continue
    if (PLATFORM_INPUTS.has(li.id)) { platform[li.id] = li.value; continue }
    if (!m) throw new Error(`${name}: unrecognised input id ${li.id}`)
    settings[order[Number(m[1])]] = li.value
  }
  return { id: meta.capture.id, name, settings, platform, live }
})

const RUNS = new Map()
const runOf = (c) => {
  if (!RUNS.has(c.id)) RUNS.set(c.id, runCloudsCapture({ dir: DIR, name: c.name, settings: c.settings }))
  return RUNS.get(c.id)
}
afterAll(() => uninstallHarness())

/** The first window bar graded: 0 on a warm replay; on a COLD one, the bar from
 *  which both averages are exact — only provable for an SMA (its window is its
 *  whole memory), so a cold EMA replay grades nothing and the NON-VACUITY test
 *  refuses it. */
function firstGraded(c, r) {
  if (r.supply.kind === 'warm') return 0
  if (c.live.ma1Type === 'SMA' && c.live.ma2Type === 'SMA') return Math.max(c.live.ma1Length, c.live.ma2Length) - 1
  return null
}

function valuesVerdict(r, from) {
  const tv = tvColumns(r)
  const keys = ourKeys(r)
  const bad = []
  keys.forEach((k, j) => {
    const ours = r.cols[k]
    const theirs = tv.col(tv.lines[j])
    for (let i = from; i < r.n; i += 1) {
      const a = ours[i]
      const b = theirs[i]
      if (Number.isFinite(a) !== Number.isFinite(b)) { bad.push(`${tv.lines[j]} bar ${i}: ${a} vs ${b}`); continue }
      if (Number.isFinite(b) && Math.abs(a - b) / Math.max(Math.abs(b), 1) > 1e-9) bad.push(`${tv.lines[j]} bar ${i}: ${a} vs ${b}`)
    }
  })
  return bad
}

function bandsVerdict(r, from) {
  const tv = tvColumns(r)
  const bad = []
  r.bands.forEach((band, j) => {
    if (band.twice.length) bad.push(`band ${j}: bars painted twice ${band.twice.slice(0, 3)}`)
    const theirs = tv.col(tv.colourOf(`fill_${j}`))
    for (let i = from; i < r.n; i += 1) {
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
    // ⛔ a hidden MA: TradingView blanks the plot; ours must DRAW NOTHING there.
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
  it('NON-VACUITY — ten captures, the changed inputs read from the meta', () => {
    expect(CAPTURES.map((c) => c.id)).toEqual(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7a', 'E7b', 'E8'])
    const byId = Object.fromEntries(CAPTURES.map((c) => [c.id, c.settings]))
    expect(byId.E0).toEqual({})
    expect(byId.E1).toEqual({ ma1Type: 'SMA', ma2Type: 'SMA' })
    expect(byId.E2).toEqual({ ma1Type: 'SMA', ma1Source: 'High', ma2Source: 'Low' })
    expect(byId.E3).toEqual({ ma1Length: 5, ma2Length: 50 })
    expect(byId.E5).toMatchObject({ bullColor: 'rgba(0,230,118,0.7)', bearColor: '#FF6D00' })
    expect(byId.E6).toEqual({ showMA1: false, showMA2: false })
  })

  it('⭐ TradingView rounds alpha HALF-UP to a byte, and so does our encoder', () => {
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

// ⭐⭐ ONE MA HIDDEN, THE OTHER SHOWN. No capture holds these, and none is needed:
// `showMA1` gates only the Fast MA PLOT's value (`showMA1 ? fastMA : na`); every
// layer and every band reads `fastMA` itself, so TradingView's bands are E0's.
// ⚰️ The reviewer's case: with the Fast MA bound EMPTY as the band host, every band
// rode a series lightweight-charts maps no price on, and vanished on a real chart.
describe.each([
  { id: 'MA1 off / MA2 on', settings: { showMA1: false }, blank: 0 },
  { id: 'MA1 on / MA2 off', settings: { showMA2: false }, blank: 1 },
])('Uncharted Clouds at E0 with $id', ({ id, settings, blank }) => {
  const e0 = CAPTURES.find((x) => x.id === 'E0')
  let r = null
  const run = () => { r = r || runCloudsCapture({ dir: DIR, name: e0.name, settings }); return r }
  it('every band, every bar, is E0\'s — hue + alpha byte exact', () => {
    expect(run().bands).toHaveLength(20)
    expect(bandsVerdict(run(), 0).slice(0, 8)).toEqual([])
  })
  it('the hidden MA draws nothing; the shown one is E0\'s line exactly', () => {
    const rr = run()
    const tv = tvColumns(rr)
    const styles = rr.meta.plotStyles || rr.study.properties.styles
    rr.drawnPlots.forEach((plot, j) => {
      const s = rr.lineOf.get(plot.key)
      const drawn = s ? (rr.setDataOf(s) || []).slice(rr.pre).filter((p) => p && Number.isFinite(p.value)).length : 0
      if (j === blank) { expect(drawn, `${id}: the hidden MA drew`).toBe(0); return }
      expect(s, `${id}: the shown MA has no series`).toBeTruthy()
      expect(drawn).toBe(rr.n)
      const pid = tv.lines[j]
      const u = unpackVendorColor(tv.col(tv.colourOf(pid))[0])
      expect(fmt(cssToRgba(s.__options.color))).toBe(`${u.hex}/${u.alphaByte}`)
      expect(s.__options.lineWidth).toBe(styles[pid].linewidth)
    })
  })
})

describe.each(CAPTURES)('Uncharted Clouds at $id ($name)', (c) => {
  it('every setting reaches the chart through the product — no gap', () => {
    const r = runOf(c)
    expect(r.gaps, JSON.stringify(r.gaps)).toEqual([])
    expect(r.applied.length).toBe(Object.keys(c.settings).length)
    const from = firstGraded(c, r)
    expect(from, `${c.id}: cold replay with no provable convergence bar (${r.supply.reason})`).not.toBe(null)
    expect(r.n - from).toBeGreaterThanOrEqual(250)
  })

  it('values: every graded bar within 1e-9 relative', () => {
    const r = runOf(c)
    const bad = valuesVerdict(r, firstGraded(c, r))
    expect(bad.slice(0, 8), `${bad.length} value(s) off`).toEqual([])
  })

  it('bands, every graded bar: hue + alpha byte exact', () => {
    const r = runOf(c)
    expect(r.bands).toHaveLength(20)
    const bad = bandsVerdict(r, firstGraded(c, r))
    expect(bad.slice(0, 8), `${bad.length} band bar(s) off`).toEqual([])
  })

  it('MA lines — colour, alpha byte, line width', () => {
    const r = runOf(c)
    expect(r.drawnPlots).toHaveLength(2)
    expect(linesVerdict(r)).toEqual([])
  })
})
