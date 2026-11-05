// A receipt follows a real change. Chart settings /charts ignores (or draws from somewhere else) were reporting success.
// Through the REAL panel (panelHarness), scripted model: each case asserts the state the CHART READS, not the wording.
//   D1  volume.separatePane is forced by PANE_LOOK; volume.paneHeightPct draws from the charts_vol_pane_pct pref
//   D2  watermark.x/y draw from opts.watermarkPos
//   the sweep: scale text color, volume MA style, the opacity /charts treats as unset, Sunrise / light canvases, and
//   the settings a timeframe does not draw
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { paneLookProps } from '../components/chart/pane/paneLook'
import { settingDescriptor, CHART_SETTING_DESCRIPTORS } from '../components/chart/chartSettingsDescriptors'
import { getCapability } from './capabilities'
import { TOPICS, answerTopic } from './discovery'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const widget = (board) => board.state.widgets.find(w => w.id === 'c')
const stored = (board) => JSON.stringify(widget(board).opts.settings ?? null)
const set = (setting, value) => p.env('apply', [{ action: 'chart.setSetting', target: 'c', args: { setting, value } }])
// the member's prefs: the Charts page's own shape (write resolves true once accepted; `refuse` plays a server that said no)
function withPrefs(h, initial = {}) {
  const box = { prefs: { ...initial }, refuse: false, writes: [] }
  h.prefs = {
    read: () => box.prefs,
    write: async (k, v) => { box.writes.push([k, v]); if (box.refuse) return false; box.prefs = { ...box.prefs, [k]: v }; return true },
  }
  return box
}
const say1 = async (say, setting, value, words) => { p.st.envelopes.push(set(setting, value)); return say(words) }

describe('discovery and descriptors say what is true (D3, D4)', () => {
  it('no topic lists what it can do under what it cannot: `known` never repeats a feature the topic registers', () => {
    const charts = TOPICS.find(t => t.id === 'charts')
    expect(charts.caps).toContain('chart.replay')
    expect(charts.known().join(' ')).not.toMatch(/replay/i)
    expect(answerTopic(charts).text.split('In UCT itself')[1] || '').not.toMatch(/replay/i)
  })
  it('each descriptor names the capability that really writes it, and nothing the Agent does is listed as not doable', () => {
    expect(settingDescriptor('comparisonSymbols').agent).toBe('specialized:chart.compare')
    expect(settingDescriptor('compareHideBase').agent).toBe('specialized:chartSetup.compareDisplay')
    expect(settingDescriptor('watermark.lines.*')).toBe(null)
    expect(settingDescriptor('hideDrawings').agent).toBe('internal')
    expect(settingDescriptor('heikinAshi').ui).not.toMatch(/not drawn on \/charts/)
    for (const d of CHART_SETTING_DESCRIPTORS) {
      const m = /^specialized:(.+)$/.exec(d.agent || '')
      if (m) expect(getCapability(m[1]), d.id).toBeTruthy()
    }
  })
})

describe('D1 — the Volume pane on /charts', () => {
  it('the height: writes the pref the chart sizes from (not the blob), and what the chart would draw changes', async () => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const prefs = withPrefs(h)
    const before = stored(board)
    expect(paneLookProps({ cs: {}, theme: null, prefs: prefs.prefs }).volumePaneHeightPct).toBe(12)
    await say1(say, 'volume.paneHeightPct', 30, 'make the volume pane 30 percent')
    expect(paneLookProps({ cs: {}, theme: null, prefs: prefs.prefs }).volumePaneHeightPct).toBe(30)
    expect(prefs.writes).toEqual([['charts_vol_pane_pct', '30']])
    expect(stored(board)).toBe(before)
  }, 40000)

  it('the height: Undo puts an unset pref back unset', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const prefs = withPrefs(h)
    await say1(say, 'volume.paneHeightPct', 30, 'make the volume pane 30 percent')
    await say('undo')
    expect(paneLookProps({ cs: {}, theme: null, prefs: prefs.prefs }).volumePaneHeightPct).toBe(12)
    expect(prefs.writes.at(-1)).toEqual(['charts_vol_pane_pct', ''])
  }, 40000)

  it('the height: a server that refuses the write leaves no success behind', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const prefs = withPrefs(h)
    prefs.refuse = true
    const out = await say1(say, 'volume.paneHeightPct', 30, 'make the volume pane 30 percent')
    expect(out).not.toMatch(/Volume pane height \(% of the chart\): 30/)
    expect(paneLookProps({ cs: {}, theme: null, prefs: prefs.prefs }).volumePaneHeightPct).toBe(12)
  }, 40000)

  it('the height: hidden Volume refuses (there is no pane to size) and writes nothing', async () => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const prefs = withPrefs(h)
    await say('hide volume')
    const out = await say1(say, 'volume.paneHeightPct', 30, 'make the volume pane 30 percent')
    expect(out).toMatch(/Show Volume first/)
    expect(prefs.writes).toEqual([])
    expect(widget(board).opts.settings.volume.paneHeightPct).not.toBe(30)
  }, 40000)

  it('own pane: /charts forces it, so the request refuses either way and changes nothing', async () => {
    expect(paneLookProps({ cs: {}, theme: null, prefs: {} }).volumeSeparatePane).toBe(true)      // the fact the refusal states
    expect(settingDescriptor('volume.separatePane').inert).toBeTruthy()                           // ...and it is derived from that prop
    const { say, board } = p.mount(...ONE('NVDA'))
    const before = stored(board)
    expect(await say1(say, 'volume.separatePane', false, 'put volume back on the price pane')).toMatch(/always draws Volume in its own pane/)
    expect(await say1(say, 'volume.separatePane', true, 'put volume in its own pane')).toMatch(/always draws Volume in its own pane/)
    expect(stored(board)).toBe(before)
  }, 40000)
})

describe('D2 — moving the watermark', () => {
  it('writes opts.watermarkPos, the position the chart draws (cs.watermark.x/y untouched); the other axis keeps its spot', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    const before = stored(board)
    await say1(say, 'watermark.x', 0.2, 'move the watermark left')
    expect(widget(board).opts.watermarkPos).toEqual({ x: 0.2, y: 0.5, anchor: null })
    await say1(say, 'watermark.y', 0.1, 'and to the top')
    expect(widget(board).opts.watermarkPos).toEqual({ x: 0.2, y: 0.1, anchor: null })
    expect(stored(board)).toBe(before)
  }, 40000)

  it('a hand-placed mark moves too: its pixel anchor is dropped, or it would out-vote the new fraction', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    widget(board).opts.watermarkPos = { x: 0.8, y: 0.3, anchor: { ax: 'right', ay: 'top', dx: 10, dy: 10 } }
    await say1(say, 'watermark.x', 0.2, 'move the watermark left')
    expect(widget(board).opts.watermarkPos).toEqual({ x: 0.2, y: 0.3, anchor: null })
  }, 40000)

  it('Undo puts a centred watermark back to centred', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    await say1(say, 'watermark.x', 0.2, 'move the watermark left')
    await say('undo')
    expect(widget(board).opts.watermarkPos ?? null).toBe(null)
  }, 40000)

  it('a value already there is a no-op (read from where the chart reads it)', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    widget(board).opts.watermarkPos = { x: 0.2, y: 0.3, anchor: null }
    const out = await say1(say, 'watermark.x', 0.2, 'move the watermark left')
    expect(out).toMatch(/already 0\.2/)
    expect(widget(board).opts.watermarkPos).toEqual({ x: 0.2, y: 0.3, anchor: null })
  }, 40000)
})

describe('the sweep: nothing else reports a change the chart will not show', () => {
  for (const [setting, value, words, why] of [
    ['textColor', '#ff0000', 'make the axis text red', /pick their text color from the chart background/],
    ['volume.maLineStyle', 'dashed', 'dash the volume average', /always drawn solid/],
  ]) {
    it(`${setting}: nothing reads it on /charts, so it refuses and stores nothing`, async () => {
      const { say, board } = p.mount(...ONE('NVDA'))
      const before = stored(board)
      expect(await say1(say, setting, value, words)).toMatch(why)
      expect(stored(board)).toBe(before)
    }, 40000)
  }

  it('watermark.opacity: the value /charts treats as unset refuses; a neighbouring value writes', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    const before = stored(board)
    expect(await say1(say, 'watermark.opacity', 0.07, 'watermark opacity 0.07')).toMatch(/treats 0\.07 as/)
    expect(stored(board)).toBe(before)
    await say1(say, 'watermark.opacity', 0.08, 'watermark opacity 0.08')
    expect(widget(board).opts.settings.watermark.opacity).toBe(0.08)
    expect(paneLookProps({ cs: widget(board).opts.settings, theme: null, prefs: {} }).watermarkOpacity).toBe(0.08)
  }, 40000)

  it('a Sunrise canvas: background, grid and candle colors refuse and store nothing', async () => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const base = h.charts.read
    h.charts.read = (ref) => { const s = base(ref); return s && { ...s, canvasTheme: 'sunrise' } }
    const baseList = h.charts.list
    h.charts.list = () => baseList().map(s => ({ ...s, canvasTheme: 'sunrise' }))
    const before = stored(board)
    expect(await say('background to black')).toMatch(/Sunrise theme/)
    expect(await say1(say, 'grid.color', '#ff0000', 'red grid')).toMatch(/Sunrise theme/)
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.setCandleColors', target: 'c', args: { up: '#00ff00', down: null } }]))
    expect(await say('green candles')).toMatch(/Sunrise theme/)
    expect(stored(board)).toBe(before)
  }, 40000)

  it('the light palette: the canvas color refuses; candle colors, which it keeps, still write', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    widget(board).opts.settings = { ...widget(board).opts.settings, theme: 'light' }
    const before = stored(board)
    expect(await say('background to black')).toMatch(/light palette/)
    expect(stored(board)).toBe(before)
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.setCandleColors', target: 'c', args: { up: '#00ff00', down: null } }]))
    await say('green candles')
    expect(widget(board).opts.settings.candles.upColor).toBe('#00ff00')
  }, 40000)

  it('a timeframe that does not draw it: saved, and the receipt says it cannot be seen here; one that does says nothing extra', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    widget(board).opts.tf = '5'
    const off = await say1(say, 'swingLabels.enabled', true, 'turn on swing labels')
    expect(widget(board).opts.settings.swingLabels.enabled).toBe(true)
    expect(off).toMatch(/only shows on daily, weekly and monthly charts/)
    const on = await say1(say, 'prevDayLevels.high.enabled', true, 'show the prior day high')
    expect(widget(board).opts.settings.prevDayLevels.high.enabled).toBe(true)
    expect(on).not.toMatch(/only shows on/)
  }, 40000)
})
