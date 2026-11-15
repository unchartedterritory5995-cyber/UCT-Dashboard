// W1-B (Wave 1, BOARD B-04; owner-approved, announced to Charts) — chart settings KNOWN → ELIGIBLE: gradient background
// colours, the Volume pane's colours / label / MA / bar style / height, watermark opacity and position, IPO marker,
// dark-pool levels, Heikin Ashi, Chart IQ, position-calculator defaults — through the ONE existing capability
// (chart.setSetting) over the product's descriptor table, with the dialog's own prerequisites and a new `number` type.
// Through the REAL panel (panelHarness): the fast path, receipts, exact stored-state Undo, refusals.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { setupPanel, ONE } from './testing/panelHarness'
import { ELIGIBLE_SETTINGS, settingDescriptor } from '../components/chart/chartSettingsDescriptors'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const stored = (board) => JSON.stringify(board.state.widgets.find(w => w.id === 'c').opts.settings ?? null)
const settings = (board) => board.state.widgets.find(w => w.id === 'c').opts.settings
const set = (setting, value) => p.env('apply', [{ action: 'chart.setSetting', target: 'c', args: { setting, value } }])

describe('KNOWN → ELIGIBLE rows (W1-B)', () => {
  it('the promoted rows are chart.setSetting options; the Info-row flags and volume.plotStyle are not (theme is eligible since the C1-078 gap, pl-grid)', () => {
    const ids = getCapability('chart.setSetting').args.properties.setting.enum
    for (const id of ['bgGradient.top', 'bgGradient.bottom', 'volume.upColor', 'volume.downColor', 'volume.hvcEnabled', 'volume.separatePane', 'volume.paneHeightPct',
      'volume.labelVisible', 'volume.labelColor', 'volume.maPeriod', 'volume.maColor', 'volume.maLineWidth', 'volume.maLineStyle', 'volume.barStyle',
      'watermark.opacity', 'watermark.x', 'watermark.y', 'markers.ipo', 'markers.ipoColor', 'darkPool.enabled', 'darkPool.barColor', 'darkPool.labelColor',
      'heikinAshi', 'showChartIq', 'positionCalc.accountSize', 'positionCalc.riskPct']) {
      expect(ids, id).toContain(id)
      expect(settingDescriptor(id).agent, id).toBe('eligible')
    }
    for (const id of ['header.showMarketCap', 'header.showNextEarnings', 'header.showUctRating', 'volume.plotStyle', 'hideDrawings']) expect(ids, id).not.toContain(id)
    expect(ids).toContain('theme')
    expect(ELIGIBLE_SETTINGS.filter(d => d.type === 'number').map(d => d.id).sort()).toEqual(['positionCalc.accountSize', 'positionCalc.riskPct', 'volume.maPeriod', 'volume.paneHeightPct', 'watermark.opacity', 'watermark.x', 'watermark.y'])
  })

  it('"turn on dark pool" → the fast path (0 model turns): the dialog\'s own write (section spread, preset custom); receipt; Undo restores the stored blob byte for byte', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    const before = stored(board)
    const out = await say('turn on dark pool')
    expect(out).toMatch(/Dark-pool levels: on/)
    expect(settings(board).darkPool).toMatchObject({ enabled: true })
    expect(settings(board).darkPool.barColor).toBeTruthy()                    // siblings kept, as setSetting({ darkPool: { ...darkPool, enabled } }) keeps them
    expect(settings(board).preset).toBe('custom')
    expect(p.turns()).toBe(0)
    await say('undo')
    expect(stored(board)).toBe(before)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('a number setting (scripted): written in range; out of range refused in words; a control the dialog hides behind another setting refuses until it holds — and Undo walks back exactly', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push(set('watermark.opacity', 0.5))
    expect(await say('set the watermark opacity to 0.5')).toMatch(/Watermark opacity \(0 to 1\): 0\.5/)
    expect(settings(board).watermark.opacity).toBe(0.5)
    const afterOpacity = stored(board)
    p.st.envelopes.push(set('watermark.opacity', 1.5))
    expect(await say('make the watermark opacity 1.5')).toMatch(/Watermark opacity \(0 to 1\): Watermark opacity \(0 to 1\) is from 0 to 1/)
    expect(stored(board)).toBe(afterOpacity)                                   // a refusal writes nothing
    p.st.envelopes.push(set('watermark.sizeScale', 2))
    expect(await say('bigger watermark')).toMatch(/Watermark size: 2/)
    await say('hide the watermark')
    const afterHide = stored(board)
    p.st.envelopes.push(set('watermark.sizeScale', 1))
    expect(await say('smaller watermark')).toMatch(/Turn the watermark on first/)
    expect(stored(board)).toBe(afterHide)
    await say('undo')
    expect(settings(board).watermark.visible).not.toBe(false)
    expect(settings(board).watermark.sizeScale).toBe(2)
  }, 60000)

  it('colours: a dark-pool colour keeps the 8-digit form the color menu stores; a gradient colour needs the Gradient background first', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push(set('darkPool.barColor', '#c9a84c80'))
    expect(await say('make the dark pool bars half transparent gold')).toMatch(/Turn dark-pool levels on first/)   // the dialog's own prerequisite
    p.st.envelopes.push(p.env('apply', [
      { action: 'chart.setSetting', target: 'c', args: { setting: 'darkPool.enabled', value: true } },
      { action: 'chart.setSetting', target: 'c', args: { setting: 'darkPool.barColor', value: '#c9a84c80' } },
    ]))
    expect(await say('turn on dark pool and make the bars half transparent gold')).toMatch(/Dark-pool bar color: #c9a84c80/)
    expect(settings(board).darkPool).toMatchObject({ enabled: true, barColor: '#c9a84c80' })
    p.st.envelopes.push(set('bgGradient.top', 'navy'))
    expect(await say('make the gradient top navy')).toMatch(/Switch the background to Gradient first/)
    expect(settings(board).bgGradient?.top).not.toBe('#000080')
  }, 40000)
})
