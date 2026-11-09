// P1 GAPS, batch 3 (pl-exec, agent/pl/exec-p1-gaps): each through the REAL panel on the fixture board, read back from the chart's
// own stored state through the product's own resolvers, with Undo where one exists. Held-out: agentP1GapsHeldOut (committed
// first, 7274ae33a5). Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): native Windows Node v24, jsdom, scripted plans.
//   C1-051 / C1-064 / C1-070 / C1-072  a chart's on/off and mode settings (crosshair, legend, event markers, prev-day lines),
//           and the WHOLE FAMILY: every on/off or mode row of the descriptor table round-trips through the panel (write, read-back
//           through settingValue, receipt, exact Undo); a row the dialog hides behind another setting is refused, never written
//   C1-007  switch to a custom timeframe already saved in the chart's menu: the chart moves, the menu gains no duplicate
//   C1-076  restore defaults: a proposal first; nothing is written before Approve; the look resets, indicators are kept; Undo exact
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { mergeChartSettings, CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { ELIGIBLE_SETTINGS, settingDescriptor, settingValue, settingUnavailable, withSetting } from '../components/chart/chartSettingsDescriptors'
import { SETTINGS_HELD_OUT, SAVED_TF_HELD_OUT, RESTORE_HELD_OUT } from './agentP1GapsHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const widget = (board) => board.state.widgets.find(w => w.id === 'c')
const stored = (board) => JSON.stringify(widget(board).opts.settings ?? null)
const readBack = (board, id) => settingValue(mergeChartSettings(widget(board).opts.settings || null), settingDescriptor(id))
const setSetting = (setting, value) => p.env('apply', [{ action: 'chart.setSetting', target: 'c', args: { setting, value } }])
// ONE chart on `tf`, its stored settings run through `seed` first (the member's own earlier choices)
function mountOne({ tf = 'D', seed = (s) => s } = {}) {
  const [ws, groups] = ONE('NVDA')
  ws[0].opts = { ...ws[0].opts, tf, settings: seed(ws[0].opts.settings) }
  return p.mount(ws, groups)
}
// the value a descriptor row is NOT at — the other side of an on/off, else the first other option
const otherValue = (d, cur) => (d.type === 'bool' ? !cur : d.options.find(o => o !== cur))

// ── C1-051 / C1-064 / C1-070 / C1-072: the held-out phrasings ──
describe('C1-051 / C1-064 / C1-070 / C1-072: a chart\'s on/off and mode settings, in the member\'s words', () => {
  it.each(SETTINGS_HELD_OUT.map(c => [c.text, c]))('held-out "%s": the chart reads back the new value; the receipt says so; Undo restores the stored blob exactly', async (t, c) => {
    const d = settingDescriptor(c.setting)
    // the member's starting point is the OTHER side, so the change is a real one
    const { say, board } = mountOne({ tf: c.tf, seed: (s) => withSetting(s, d, otherValue(d, c.value)) })
    expect(readBack(board, c.setting)).not.toEqual(c.value)
    const before = stored(board)
    p.st.envelopes.push(setSetting(c.setting, c.value))
    const out = await say(t)
    expect(readBack(board, c.setting), out).toEqual(c.value)
    expect(out).toContain(d.label)
    // ⛔ a prev-day line on a daily chart is SAVED but not drawn: the receipt says so, never "it's on your chart"
    if (c.hiddenOnTf) expect(out).toMatch(/only shows on the 1, 5, 15, 30 and 60 minute charts/)
    else expect(out).not.toMatch(/only shows on/)
    await say('undo')
    expect(stored(board)).toBe(before)
  }, 40000)
})

// ── the whole family: every on/off or mode row of the descriptor table, through the panel ──
const FAMILY = ELIGIBLE_SETTINGS.filter(d => (d.type === 'bool' || d.type === 'enum') && d.store == null && !d.inert)
describe('every on/off or mode chart setting round-trips through the panel', () => {
  it('the family is the descriptor table (no hand-picked list)', () => {
    expect(FAMILY.length).toBeGreaterThan(30)
    for (const id of ['crosshair.mode', 'header.legendMode', 'markers.earnings', 'markers.dividends', 'markers.splits', 'prevDayLevels.high.enabled']) expect(FAMILY.map(d => d.id)).toContain(id)
    // the refusal branch below is exercised: on the fixture chart some rows sit behind another setting (thin bars → Bars / HLC)
    const cs = mergeChartSettings(null)
    expect(FAMILY.filter(d => settingUnavailable(d, cs)).map(d => d.id)).toContain('candles.thinBars')
  })
  it.each(FAMILY.map(d => [d.id, d]))('%s: written, read back through the product resolver, Undo exact — or refused when the dialog hides it', async (id, d) => {
    const { say, board } = mountOne({ tf: '5' })
    const cs = mergeChartSettings(widget(board).opts.settings || null)
    const want = otherValue(d, settingValue(cs, d))
    const before = stored(board)
    p.st.envelopes.push(setSetting(id, want))
    const out = await say(`set ${d.label} to ${String(want)}`)
    const blocked = settingUnavailable(d, cs)
    if (blocked) {
      // the dialog would not offer it here: nothing is written and the reason is said
      expect(stored(board), out).toBe(before)
      expect(out).toContain(blocked)
      return
    }
    expect(readBack(board, id), out).toEqual(want)
    expect(out).toContain(d.label)
    await say('undo')
    expect(stored(board), id).toBe(before)
  }, 40000)
})

// ── C1-007 ──
describe('C1-007: a custom timeframe already saved in the chart\'s menu', () => {
  it.each(SAVED_TF_HELD_OUT.map(c => [c.text, c]))('held-out "%s": the chart moves to it; the menu gains no duplicate; Undo puts the old timeframe back', async (t, c) => {
    const code = c.unit === 'minutes' ? String(c.count) : String(c.count * 60)
    const { say, board } = mountOne({ tf: 'D', seed: (s) => ({ ...s, header: { ...(s.header || {}), customTimeframes: [code] } }) })
    const menu = JSON.stringify(widget(board).opts.settings.header.customTimeframes)
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.addCustomTimeframe', target: 'c', args: { unit: c.unit, count: c.count, switch: true } }]))
    const out = await say(t)
    expect(widget(board).opts.tf, out).toBe(code)
    expect(JSON.stringify(widget(board).opts.settings.header.customTimeframes)).toBe(menu)
    expect(out).toMatch(/Switched to/)
    expect(out).not.toMatch(/Added a/)
    await say('undo')
    expect(widget(board).opts.tf).toBe('D')
  }, 40000)
  it('a plan that puts the saved code through chart.setTimeframe (native timeframes only) changes nothing and claims nothing', async () => {
    const { say, board } = mountOne({ tf: 'D', seed: (s) => ({ ...s, header: { ...(s.header || {}), customTimeframes: ['45'] } }) })
    const before = JSON.stringify(widget(board).opts)
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.setTimeframe', target: 'c', args: { timeframe: '45' } }]))
    const out = await say('go to my 45 minute timeframe')
    expect(JSON.stringify(widget(board).opts), out).toBe(before)
    expect(out).not.toMatch(/Switched/)
  }, 40000)
})

// ── C1-076 ──
describe('C1-076: restore one chart\'s look to the defaults', () => {
  it.each(RESTORE_HELD_OUT.map(c => [c.text]))('held-out "%s": a proposal first (nothing written); Approve resets the look and keeps the indicators; Undo restores exactly', async (t) => {
    const custom = (s) => withSetting(withSetting({ ...s, background: '#123456' }, settingDescriptor('markers.splits'), !settingValue(s, settingDescriptor('markers.splits'))),
      settingDescriptor('crosshair.mode'), 'off')
    const { say, board, click } = mountOne({ seed: custom })
    const before = stored(board)
    const indicators = JSON.stringify([widget(board).opts.settings.overlays, widget(board).opts.settings.indicatorInstances ?? null])
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.resetDefaults', target: 'c', args: {} }]))
    const out = await say(t)
    expect(stored(board), out).toBe(before)                           // ⛔ proposed only
    expect(p.proposals().length, out).toBe(1)
    await click('Apply')
    const now = mergeChartSettings(widget(board).opts.settings || null)
    expect(now.background).toBe(mergeChartSettings(CHART_DEFAULTS).background)
    expect(settingValue(now, settingDescriptor('crosshair.mode'))).toBe(settingValue(mergeChartSettings(CHART_DEFAULTS), settingDescriptor('crosshair.mode')))
    expect(JSON.stringify([widget(board).opts.settings.overlays, widget(board).opts.settings.indicatorInstances ?? null])).toBe(indicators)
    await say('undo')
    expect(stored(board)).toBe(before)
  }, 40000)
})
