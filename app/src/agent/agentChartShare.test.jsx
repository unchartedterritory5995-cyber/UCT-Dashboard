// Charts family (2026-11-13): chartShare.export (marker: chartShare.export) and the Shift+T palette through chart.setSetting
// ('theme', KNOWN → ELIGIBLE) — through the REAL panel on the fixture board, the model scripted (no paid call). One chart only:
// the chart the targeting rules name (the clicked one, a relation to it — #988: the clicked chart is the anchor, never the
// target); every other chart untouched. The PNG counts only once the chart's own Share → Download PNG door made one; the Share
// menu counts only once it is read back open; nothing ever reaches a clipboard (a browser lets only a click copy). No Undo for
// the share (nothing on the chart changed); exact Undo for the palette. The widget half (StockChart's own doors through
// ChartPane → ChartWidget) is components/StockChart.chartShareAgent.test.jsx.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { wordsSelect, groupOfAction, GROUPS } from './routing'
import { CHART_SHARE_ACTION, NO_SHARE } from './capabilities/chartShare'
import { settingDescriptor } from '../components/chart/chartSettingsDescriptors'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const SH = CHART_SHARE_ACTION
// 2×2: c0 TL (SPY), c1 TR (QQQ), c2 BL (NVDA), c3 BR (TSLA), each its own symbol
const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const WIDGETS = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
const IDS = ['c0', 'c1', 'c2', 'c3']

// The Share popover doors of every chart, as StockChart exposes them (ChartPane → ChartWidget adapter → host.charts):
// Download PNG resolves to the file name (null = no PNG made); the popover opened is read back as `shareOpen`.
function mountOn(clicked, { doors = true, png = (sym, tf) => `${sym}-${tf}.png`, opens = true, canvasTheme = null } = {}) {
  const open = {}
  const decorate = (s) => ({ ...s, label: `Chart (${s.ref})`, ...(canvasTheme ? { canvasTheme } : {}), ...(doors ? { canShare: true, shareOpen: !!open[s.ref] } : {}) })
  const m = p.mount(WIDGETS, SYMS, { decorate })
  const downloads = [], opened = []
  m.h.charts.shareDownload = async (ref) => { const s = m.h.charts.read(ref); const f = png(s.symbol, s.tf); downloads.push({ ref, file: f, tf: s.tf }); return f }
  m.h.charts.shareOpen = (ref) => { opened.push(ref); if (opens) open[ref] = true; return true }
  if (clicked) p.select(clicked)
  return { ...m, downloads, opened }
}
const others = (b, id) => JSON.stringify(b.state.widgets.filter(w => w.id !== id).map(w => w.opts))
const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const plan = (...ops) => (body) => p.env('apply', ops.map(([id, action, args]) => ({ action, target: refOf(body, id), args })))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const settingsOf = (b, id) => b.state.widgets.find(w => w.id === id).opts.settings
const undoable = () => screen.queryAllByTestId('agent-receipt').some(r => r.getAttribute('data-undoable') === 'true')

describe('chartShare.export: a PNG through the chart\'s own Share → Download PNG', () => {
  it.each(['take a screenshot of this chart', 'download this chart as a png', 'save the chart as an image', 'grab a screen shot of this one'])(
    '"%s": the clicked chart only, the door made the PNG; the board is unchanged; no Undo', async (t) => {
      const { say, board: b, downloads, opened } = mountOn('c2')
      const before = JSON.stringify(b.state.widgets)
      p.st.envelopes.push(plan(['c2', SH, { output: 'image' }]))
      const out = await say(t)
      expect(out).toMatch(/Downloaded a PNG of the NVDA chart/)
      expect(downloads.map(d => d.ref)).toEqual([downloads[0].ref])
      expect(downloads.map(d => d.file)).toEqual(['NVDA-D.png'])
      expect(opened).toEqual([])
      expect(JSON.stringify(b.state.widgets)).toBe(before)
      expect(undoable()).toBe(false)
    }, 40000)
  it('the door made NO PNG: a failure that says so, never "Downloaded"', async () => {
    const { say, downloads } = mountOn('c1', { png: () => null })
    p.st.envelopes.push(plan(['c1', SH, { output: 'image' }]))
    await say('screenshot this chart')
    expect(downloads).toHaveLength(1)
    expect(transcript()).toMatch(/could not be captured as a PNG/)
    expect(transcript()).not.toMatch(/Downloaded a PNG/)
  }, 40000)
  it('no Share doors on that chart (a Multi Chart cell): refused, nothing is pressed', async () => {
    const { say, downloads, opened } = mountOn('c0', { doors: false })
    p.st.envelopes.push(plan(['c0', SH, { output: 'both' }]))
    await say('take a screenshot of this chart')
    expect(transcript()).toContain(NO_SHARE)
    expect(downloads).toEqual([])
    expect(opened).toEqual([])
  }, 40000)
})

describe('chartShare.export: the share link is the member\'s own click — never a faked copy', () => {
  it.each(['give me a share link for this chart', 'share this chart', 'open the share menu on this chart', 'copy the chart link'])(
    '"%s": the Share menu opens on the clicked chart (read back); no clipboard write; no Undo', async (t) => {
      const writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText, write: writeText }, configurable: true })
      const { say, board: b, downloads, opened } = mountOn('c1')
      const before = JSON.stringify(b.state.widgets)
      p.st.envelopes.push(plan(['c1', SH, { output: 'link' }]))
      const out = await say(t)
      expect(out).toMatch(/opened its Share menu — click Copy Share URL there/i)
      expect(out).not.toMatch(/\bcopied\b/i)                  // ⛔ never claims a copy
      expect(writeText).not.toHaveBeenCalled()
      expect(opened).toHaveLength(1)
      expect(downloads).toEqual([])
      expect(JSON.stringify(b.state.widgets)).toBe(before)
      expect(undoable()).toBe(false)
    }, 40000)
  it('MUTANT: the door says yes but the menu never opens — "did not take effect", never a receipt', async () => {
    const { say, opened } = mountOn('c1', { opens: false })
    p.st.envelopes.push(plan(['c1', SH, { output: 'link' }]))
    await say('share this chart')
    expect(opened).toHaveLength(1)
    expect(transcript()).toMatch(/did not take effect/)
    expect(transcript()).not.toMatch(/opened its Share menu/)
  }, 40000)
  it('both: the PNG first, then the menu, on the same chart', async () => {
    const { say, downloads, opened } = mountOn('c3')
    p.st.envelopes.push(plan(['c3', SH, { output: 'both' }]))
    const out = await say('screenshot this chart and give me its share link')
    expect(out).toMatch(/Downloaded a PNG of the TSLA chart.*opened its Share menu/)
    expect(downloads.map(d => d.file)).toEqual(['TSLA-D.png'])
    expect(opened).toHaveLength(1)
  }, 40000)
})

describe('chartShare.export: targeting and additive requests', () => {
  it('#988: "the one next to this" (clicked c2) captures TSLA, never the clicked chart', async () => {
    const { say, downloads } = mountOn('c2')
    p.st.envelopes.push(plan(['c3', SH, { output: 'image' }]))
    await say('take a screenshot of the one next to this')
    expect(downloads.map(d => d.file)).toEqual(['TSLA-D.png'])
    expect(transcript()).not.toMatch(/Which chart do you mean/)
  }, 40000)
  it('NEGATIVE #988: a plan on the CLICKED chart for "the one next to this" is not run', async () => {
    const { say, downloads } = mountOn('c2')
    p.st.envelopes.push(plan(['c2', SH, { output: 'image' }]))
    await say('take a screenshot of the one next to this')
    expect(downloads).toEqual([])
  }, 40000)
  it('a change and a screenshot of the same chart: the change lands first, the PNG is of the chart as it then is; Undo takes back only the change', async () => {
    const { say, board: b, downloads } = mountOn('c0')
    const before = others(b, 'c0')
    p.st.envelopes.push(plan(['c0', 'chart.setTimeframe', { timeframe: 'W' }], ['c0', SH, { output: 'image' }]))
    const out = await say('switch this chart to weekly and take a screenshot')
    expect(out).toMatch(/Downloaded a PNG of the SPY chart/)
    expect(downloads.map(d => d.tf)).toEqual(['W'])           // captured AFTER the timeframe landed
    expect(b.state.widgets.find(w => w.id === 'c0').opts.tf).toBe('W')
    expect(others(b, 'c0')).toBe(before)
    await say('undo')
    expect(b.state.widgets.find(w => w.id === 'c0').opts.tf).toBe('D')
    expect(downloads).toHaveLength(1)                          // the Undo never re-presses the door
  }, 40000)
})

describe('the Shift+T palette: chart.setSetting theme (KNOWN → ELIGIBLE)', () => {
  it.each(['switch this chart to the light palette', 'make this chart light mode', 'put the chart on the light palette like shift+t'])(
    '"%s": the clicked chart\'s theme is Shift+T\'s write (light); the others untouched; Undo puts dark back exactly', async (t) => {
      const { say, board: b } = mountOn('c2')
      const before = others(b, 'c2'), was = JSON.stringify(settingsOf(b, 'c2'))
      p.st.envelopes.push(plan(['c2', 'chart.setSetting', { setting: 'theme', value: 'light' }]))
      const out = await say(t)
      expect(out).toMatch(/Light\/dark palette \(Shift\+T\): light/)
      expect(settingsOf(b, 'c2').theme).toBe('light')
      expect(settingsOf(b, 'c2').preset).toBe('custom')       // Shift+T's updateField shape: { ...cs, theme, preset: 'custom' }
      expect(others(b, 'c2')).toBe(before)
      await say('undo')
      expect(JSON.stringify(settingsOf(b, 'c2'))).toBe(was)
    }, 40000)
  it('on the Sunrise canvas (which ignores the palette): refused, nothing written', async () => {
    const { say, board: b } = mountOn('c1', { canvasTheme: 'sunrise' })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c1', 'chart.setSetting', { setting: 'theme', value: 'light' }]))
    await say('switch this chart to the light palette')
    expect(transcript()).toMatch(/Sunrise theme/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('a value that is not a palette is refused', async () => {
    const { say, board: b } = mountOn('c1')
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c1', 'chart.setSetting', { setting: 'theme', value: 'sepia' }]))
    await say('make this chart sepia')
    expect(transcript()).toMatch(/Light\/dark palette \(Shift\+T\): .*dark, light/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('the descriptor: eligible, dark | light, fixed only by Sunrise', () => {
    expect(settingDescriptor('theme')).toMatchObject({ agent: 'eligible', type: 'enum', options: ['dark', 'light'], fixedBy: ['sunrise'] })
  })
})

describe('chartShare.export: contract and routing', () => {
  it('no Undo (nothing on the chart changes), an undo note, inside the manifest limits', () => {
    const c = getCapability(SH)
    expect(c.undo).toBe('none')
    expect(c.undoNote).toMatch(/nothing to undo/)
    const L = MANIFEST_CONTRACT.limits
    const m = manifestFor({ surface: 'charts' }).find(x => x.name === SH)
    expect(m.summary.length).toBeLessThanOrEqual(L.maxSummary)
    expect((m.hints || '').length).toBeLessThanOrEqual(L.maxHints)
    expect(manifestFor({ surface: 'charts' }).find(x => x.name === 'chart.setSetting').hints.length).toBeLessThanOrEqual(L.maxHints)
  })
  it('its own words-only, fill-last group', () => {
    const g = GROUPS.find(x => x.id === 'chartShare')
    expect(g).toMatchObject({ wordsOnly: true, fillLast: true })
    expect(groupOfAction(SH)).toBe('chartShare')
  })
  it.each(['take a screenshot of this chart', 'screenshot the nvda chart', 'download this chart as a png', 'save the chart as an image',
    'export a png of the left chart', 'give me a share link for this chart', 'share this chart', 'open the share menu', 'copy the chart link',
    'get me a link to this chart', 'a picture of this chart please'])('selected by its own words: "%s"', (t) => expect(wordsSelect('chartShare', t)).toBe(true))
  it.each(['recreate this indicator from a screenshot', 'build an indicator from my screenshot', 'send this chart to my journal',
    'link this chart to the left one', 'change the chart link group to blue', 'show the share price on the chart', 'turn on shared chart settings',
    'what are the shares outstanding', 'unlink the charts', 'save my layout', 'show the image of the company logo'])('NEGATIVE: not its words: "%s"', (t) => expect(wordsSelect('chartShare', t)).toBe(false))
})
