// Charts family: HEADER COLORS (header-colors) — the chart header's Title color and the day change's Up-day / Down-day colors
// (Chart Settings → Header & legend → Title), KNOWN → ELIGIBLE on the ONE existing capability (chart.setSetting) over the
// product's descriptor table: the dialog's own write (COLOR_PATHS hdrTitle / hdrDayUp / hdrDayDown → header.colors.<key>,
// section spread, preset custom), read back through the pane header's one authority (headerColors), exact stored-state Undo.
// GENERATED cases: phrasings × values × rows on one chart; targeting (the chart named, the chart clicked, every chart,
// two charts with no target → asked) and wrong-target controls (the words name one chart, the plan writes another).
// Through the REAL panel (panelHarness), the model SCRIPTED from the request the panel sent.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { settingDescriptor, classifySettingPath, settingValue } from '../components/chart/chartSettingsDescriptors'
import { headerColors } from '../components/chart/pane/headerDefaultColors'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const ROWS = [
  { setting: 'header.colors.title', key: 'title', label: 'Title color',
    says: [(c) => `make the title color ${c}`, (c) => `change the ticker title color to ${c}`, (c) => `color the chart title ${c}`] },
  { setting: 'header.colors.dayChangeUp', key: 'dayChangeUp', label: 'Up-day color',
    says: [(c) => `make the up-day color ${c}`, (c) => `set the day change up color to ${c}`, (c) => `show up days in ${c} in the header`] },
  { setting: 'header.colors.dayChangeDown', key: 'dayChangeDown', label: 'Down-day color',
    says: [(c) => `make the down-day color ${c}`, (c) => `set the day change down color to ${c}`, (c) => `show down days in ${c} in the header`] },
]
// [what the member says, what the plan carries, the hex stored]
const VALUES = [['orange', 'orange', '#f59e0b'], ['teal', 'teal', '#26a69a'], ['#3366ff', '#3366ff', '#3366ff']]

const mount = (syms, { sel = null, settings = bareSettings() } = {}) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const env = (ops) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops })
const refOf = (body, sym) => body.context.charts.find(c => c.label === `Chart (${sym})`).ref
const setOn = (syms, setting, value) => (body) => env(syms.map(s => ({ action: 'chart.setSetting', target: refOf(body, s), args: { setting, value } })))
const csOf = (b, id) => b.state.widgets.find(w => w.id === id).opts.settings
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|which one/i.test(transcript())
const apply = async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)); await p.idle(); await new Promise(r => setTimeout(r, 0)); await p.idle() }

describe('the rows: KNOWN → ELIGIBLE where the dialog\'s own swatch writes them; the legend and stat colors stay known', () => {
  it('title / up-day / down-day are chart.setSetting options, typed color, read through headerColors', () => {
    const ids = getCapability('chart.setSetting').args.properties.setting.enum
    for (const r of ROWS) {
      expect(ids, r.setting).toContain(r.setting)
      const d = settingDescriptor(r.setting)
      expect(d.agent).toBe('eligible')
      expect(d.type).toBe('color')
      expect(settingValue(bareSettings(), d)).toBe(headerColors(bareSettings())[r.key])
    }
    for (const k of ['legend', 'marketCap', 'nextEarnings', 'uctRating']) {
      expect(ids).not.toContain(`header.colors.${k}`)
      expect(classifySettingPath(`header.colors.${k}`).agent).toBe('known')
    }
  })
})

const ONE_CASES = ROWS.flatMap(r => r.says.flatMap((say, si) => VALUES.map(([word, arg, hex]) => [say(word), r, arg, hex, si])))
describe('GENERATED: 3 rows × 3 phrasings × 3 values on one chart — the dialog\'s own write, a receipt, exact Undo', () => {
  it('generated: 27 cases', () => expect(ONE_CASES).toHaveLength(27))
  it.each(ONE_CASES)('"%s"', async (text, r, arg, hex) => {
    const { say, board } = mount(['SPY'])
    const before = stored(board, 'w0')
    const cs0 = csOf(board, 'w0')
    p.st.envelopes.push(setOn(['SPY'], r.setting, arg))
    const out = await say(text)
    expect(out).toContain(r.label)
    const cs = csOf(board, 'w0')
    expect(cs.header.colors[r.key]).toBe(hex)
    expect(cs.preset).toBe('custom')
    // the section is spread: every other header key and every other color kept
    expect({ ...cs.header, colors: { ...cs.header.colors, [r.key]: undefined } }).toEqual({ ...(cs0.header || {}), colors: { ...((cs0.header || {}).colors || {}), [r.key]: undefined } })
    await say('undo')
    expect(stored(board, 'w0')).toBe(before)
  }, 40000)
})

describe('TARGETING on two charts (SPY, NVDA)', () => {
  it.each(ROWS.map(r => [r.setting, r]))('%s: the chart the words name — only that chart changes; Undo restores it exactly', async (_s, r) => {
    const { say, board } = mount(['SPY', 'NVDA'])
    const spy = stored(board, 'w0'), nvda = stored(board, 'w1')
    p.st.envelopes.push(setOn(['NVDA'], r.setting, 'orange'))
    await say(`${r.says[0]('orange')} on the NVDA chart`)
    expect(csOf(board, 'w1').header.colors[r.key]).toBe('#f59e0b')
    expect(stored(board, 'w0')).toBe(spy)
    await say('undo')
    expect(stored(board, 'w1')).toBe(nvda)
  }, 40000)
  it.each(ROWS.map(r => [r.setting, r]))('%s: the chart clicked ("this chart") — that chart only', async (_s, r) => {
    const { say, board } = mount(['SPY', 'NVDA'], { sel: 'w1' })
    const spy = stored(board, 'w0')
    p.st.envelopes.push(setOn(['NVDA'], r.setting, 'teal'))
    await say(`${r.says[0]('teal')} on this chart`)
    expect(csOf(board, 'w1').header.colors[r.key]).toBe('#26a69a')
    expect(stored(board, 'w0')).toBe(spy)
  }, 40000)
  it.each(ROWS.map(r => [r.setting, r]))('%s: every chart ("on all my charts") — shown first; Apply: both change; ONE Undo restores both', async (_s, r) => {
    const { say, board } = mount(['SPY', 'NVDA'])
    const spy = stored(board, 'w0'), nvda = stored(board, 'w1')
    p.st.envelopes.push(setOn(['SPY', 'NVDA'], r.setting, '#3366ff'))
    // a write to several charts is shown first (the panel's own multi-chart card): nothing changes until Apply
    expect(await say(`${r.says[0]('#3366ff')} on all my charts`)).toMatch(/nothing has changed yet/)
    expect([stored(board, 'w0'), stored(board, 'w1')]).toEqual([spy, nvda])
    await apply()
    expect(csOf(board, 'w0').header.colors[r.key]).toBe('#3366ff')
    expect(csOf(board, 'w1').header.colors[r.key]).toBe('#3366ff')
    await say('undo')
    expect(stored(board, 'w0')).toBe(spy)
    expect(stored(board, 'w1')).toBe(nvda)
  }, 40000)
  // ⛔ WRONG-TARGET CONTROLS: the words name one chart, the plan writes the other — asked, nothing written
  it.each(ROWS.flatMap(r => [['NVDA', 'SPY'], ['SPY', 'NVDA']].map(([named, wrote]) => [r.setting, named, wrote, r])))('%s: words name %s, the plan writes %s → asked, nothing written', async (_s, named, wrote, r) => {
    const { say, board } = mount(['SPY', 'NVDA'])
    const was = [stored(board, 'w0'), stored(board, 'w1')]
    p.st.envelopes.push(setOn([wrote], r.setting, 'orange'))
    await say(`${r.says[0]('orange')} on the ${named} chart`)
    expect([stored(board, 'w0'), stored(board, 'w1')]).toEqual(was)
    expect(asked()).toBe(true)
  }, 40000)
  // ⛔ AMBIGUOUS: two charts, nothing clicked, no chart named — the plan's one chart is a guess: asked, nothing written
  it.each(ROWS.map(r => [r.setting, r]))('%s: no chart named and none clicked → asked, nothing written', async (_s, r) => {
    const { say, board } = mount(['SPY', 'NVDA'])
    const was = [stored(board, 'w0'), stored(board, 'w1')]
    p.st.envelopes.push(setOn(['SPY'], r.setting, 'orange'))
    await say(r.says[0]('orange'))
    expect([stored(board, 'w0'), stored(board, 'w1')]).toEqual(was)
    expect(asked()).toBe(true)
  }, 40000)
})

describe('REFUSALS and no-ops: nothing written', () => {
  it.each(['header.colors.dayChangeUp', 'header.colors.dayChangeDown'])('%s while the day change is off: the dialog\'s own prerequisite, said; nothing written', async (setting) => {
    const off = { ...bareSettings(), header: { ...(bareSettings().header || {}), showChange: false } }
    const { say, board } = mount(['SPY'], { settings: off })
    const was = stored(board, 'w0')
    p.st.envelopes.push(setOn(['SPY'], setting, 'orange'))
    expect(await say('make the day change color orange')).toMatch(/day change beside the title is off/)
    expect(stored(board, 'w0')).toBe(was)
  }, 40000)
  it.each(ROWS.map(r => [r.setting, r]))('%s: a value that is no color → refused with the row\'s own words, nothing written', async (_s, r) => {
    const { say, board } = mount(['SPY'])
    const was = stored(board, 'w0')
    p.st.envelopes.push(setOn(['SPY'], r.setting, 'sparkly'))
    expect(await say(r.says[0]('sparkly'))).toMatch(/needs a hex color/)
    expect(stored(board, 'w0')).toBe(was)
  }, 40000)
  it('the color it already has: said in words, nothing written, no Undo offered', async () => {
    const cs = { ...bareSettings(), header: { ...(bareSettings().header || {}), colors: { title: '#f59e0b' } } }
    const { say, board } = mount(['SPY'], { settings: cs })
    const was = stored(board, 'w0')
    p.st.envelopes.push(setOn(['SPY'], 'header.colors.title', 'orange'))
    expect(await say('make the title color orange')).toMatch(/Title color is already/)
    expect(stored(board, 'w0')).toBe(was)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  }, 40000)
  it('the legend color stays known: a plan for it is refused, nothing written', async () => {
    const { say, board } = mount(['SPY'])
    const was = stored(board, 'w0')
    p.st.envelopes.push(setOn(['SPY'], 'header.colors.legend', 'orange'))
    await say('make the legend color orange')
    expect(stored(board, 'w0')).toBe(was)
  }, 40000)
})
