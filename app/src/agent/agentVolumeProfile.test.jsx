// Charts family: volumeProfile.set (marker: 'volumeProfile.set') through the REAL panel on the fixture board, the model scripted
// (no paid call), plus the member's own obvious words on the fast path. What Chart Settings → Indicators' Volume Profile row
// does (its toggle, its Bins / Color / Point of control fields — `applyRowPatch` on the carved-out row; the library's
// `toggledRow` makes the same shape) on ONE chart's `indicators.volumeProfile`, the chart the targeting rules name; read back;
// exact Undo of the prior block. Never a definition, never an instance. The widget half (ONE onOptsChange, the overlay prop,
// the reload) is pages/charts/widgets/ChartWidget.volumeProfile.test.jsx.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings, MODEL_SENTINEL } from './testing/panelHarness'
import { getCapability, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { wordsSelect, groupOfAction, GROUPS } from './routing'
import { pendingLine } from './proposalWording'
import { fastParse } from './fastPath'
import { mergeChartSettings, CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { toggledRow } from '../components/chart/IndicatorLibraryDialog'
import { CARVED_OUT_ROWS } from '../components/chart/indicatorCatalog'
import { listAllIndicators, applyRowPatch } from '../components/chart/indicatorRegistry'
import * as nativeRegistry from '../components/chart/engine/nativeRegistry'
import { writeVolumeProfile, volumeProfileOf, confirmVolumeProfile, checkVolumeProfilePatch } from '../components/chart/builder/agentMutations'
import { VOLUME_PROFILE_ACTION, vpPatchOf } from './capabilities/volumeProfile'
import { defIdOfWords, VP_NOT_AN_ADD } from './capabilities/indicatorEdits'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const VP = 'volumeProfile.set'
const DEF = CHART_DEFAULTS.indicators.volumeProfile
const withVp = (vp) => ({ ...bareSettings(), indicators: { ...bareSettings().indicators, volumeProfile: { ...DEF, ...vp } } })
// 2×2: c0 TL (SPY, own), c1 TR (QQQ, own), c2 BL (NVDA, group A), c3 BR (TSLA, group B)
const cell = (id, x, y, color, settings) => ({ id, type: 'chart', x, y, w: 12, h: 10, color, opts: { settings: settings || bareSettings() } })
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', A: 'NVDA', B: 'TSLA' }
const board = (s = {}) => [cell('c0', 0, 0, 'N', s.c0), cell('c1', 12, 0, 'N', s.c1), cell('c2', 0, 10, 'A', s.c2), cell('c3', 12, 10, 'B', s.c3)]
const IDS = ['c0', 'c1', 'c2', 'c3']
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
function mountOn(clicked, settings, decorate = label) {
  const m = p.mount(board(settings), SYMS, { decorate })
  if (clicked) p.select(clicked)
  return m
}
const stored = (b, id) => b.state.widgets.find(w => w.id === id).opts.settings
const vpOf = (b, id) => volumeProfileOf(stored(b, id))
const others = (b, id) => JSON.stringify(b.state.widgets.filter(w => w.id !== id).map(w => w.opts))
const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const plan = (...ops) => (body) => p.env('apply', ops.map(([id, action, args]) => ({ action, target: refOf(body, id), args })))
const vp = (o = {}) => ({ enabled: null, bins: null, color: null, pocColor: null, ...o })
const undoButton = () => screen.queryByRole('button', { name: 'Undo' })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const instancesJson = (b, id) => JSON.stringify(mergeChartSettings(stored(b, id)).indicatorInstances || [])

describe('P1 · on / off through the settings row\'s own writer; read back; exact Undo', () => {
  it.each(['turn on volume profile', 'add volume profile', 'show the volume profile', 'add vpvr', 'enable volume profile on this chart', 'turn on vp'])(
    '"%s" (fast path, no model): the clicked chart\'s indicators.volumeProfile.enabled flips; no instance; others untouched; Undo exact', async (t) => {
      const { say, board: b } = mountOn('c2')
      const before = others(b, 'c2')
      const blob = JSON.stringify(stored(b, 'c2'))
      const inst = instancesJson(b, 'c2')
      const out = await say(t)
      expect(out).toMatch(/Turned on Volume Profile/)
      expect(p.turns()).toBe(0)
      expect(vpOf(b, 'c2')).toEqual({ ...DEF, enabled: true })
      expect(instancesJson(b, 'c2')).toBe(inst)                       // ⛔ never a definition / instance
      expect(others(b, 'c2')).toBe(before)                            // wrong-target control
      await say('undo')
      expect(JSON.stringify(stored(b, 'c2'))).toBe(blob)              // the prior block, exactly
    }, 40000)
  it.each(['turn off volume profile', 'remove the volume profile', 'hide volume profile', 'volume profile off', 'take the volume profile off'])(
    '"%s": off, its bins and colours kept; Undo turns it back on with the member\'s own 30 bins', async (t) => {
      const mine = withVp({ enabled: true, bins: 30, pocColor: '#ff0000' })
      const { say, board: b } = mountOn('c0', { c0: mine })
      expect(await say(t)).toMatch(/Turned off Volume Profile/)
      expect(vpOf(b, 'c0')).toEqual({ ...DEF, enabled: false, bins: 30, pocColor: '#ff0000' })
      await say('undo')
      expect(vpOf(b, 'c0')).toEqual({ ...DEF, enabled: true, bins: 30, pocColor: '#ff0000' })
    }, 40000)
  it('the write IS the product\'s: the same blob Chart Settings\' row toggle (applyRowPatch) and the library\'s toggledRow make', () => {
    const cs = bareSettings()
    const row = listAllIndicators(cs, nativeRegistry).find(r => r.id === 'volumeProfile')
    const settingsRow = applyRowPatch(row, { enabled: true }, cs, nativeRegistry)
    const library = toggledRow(CARVED_OUT_ROWS[0], cs, nativeRegistry)
    const agent = writeVolumeProfile(cs, { enabled: true }, nativeRegistry)
    expect(agent.ok).toBe(true)
    expect(agent.cs).toEqual(settingsRow)
    expect(agent.cs).toEqual(library)
    expect(agent.cs.indicatorInstances).toEqual(cs.indicatorInstances)
    expect(confirmVolumeProfile(agent.cs, { enabled: true })).toBe(true)
    expect(confirmVolumeProfile(cs, { enabled: true })).toBe(false)
  })
  it('a commit the chart did not keep is never a success (read-back): nothing claimed, no Undo', async () => {
    const { say, board: b, h } = mountOn('c0')
    const real = h.charts.commit
    h.charts.commit = () => true                                       // the widget "accepted" but stored nothing
    const out = await say('turn on volume profile')
    h.charts.commit = real
    expect(out).not.toMatch(/Turned on Volume Profile/)
    expect(vpOf(b, 'c0').enabled).toBe(false)
    expect(undoButton()).toBeNull()
  }, 40000)
})

describe('P2 · bins and colours: the row\'s own bounds; asked, never clamped', () => {
  it.each([['set the volume profile bins to 30', 30], ['change the volume profile bins to 8', 8], ['set volume profile to 50 bins', 50]])(
    '"%s": bins %i on a profile that is on; receipt says what it was; Undo exact', async (t, n) => {
      const { say, board: b } = mountOn('c1', { c1: withVp({ enabled: true }) })
      const blob = JSON.stringify(stored(b, 'c1'))
      expect(await say(t)).toMatch(new RegExp(`Set Volume Profile to ${n} bins \\(was 24\\)`))
      expect(vpOf(b, 'c1').bins).toBe(n)
      await say('undo')
      expect(JSON.stringify(stored(b, 'c1'))).toBe(blob)
    }, 40000)
  it('bins 24.5: not a whole number — the closed schema refuses it, nothing written', async () => {
    const { say, board: b } = mountOn('c1', { c1: withVp({ enabled: true }) })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c1', VP, vp({ bins: 24.5 })]))
    expect(await say('set the volume profile bins')).toMatch(/didn't change anything/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it.each([60, 7, 0, 51])('bins %s: outside 8–50 → asked, nothing written (never clamped)', async (n) => {
    const { say, board: b } = mountOn('c1', { c1: withVp({ enabled: true }) })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c1', VP, vp({ bins: n })]))
    expect(await say('set the volume profile bins')).toMatch(/whole number from 8 to 50 .* nothing was changed\. How many bins\?/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('"turn on volume profile with 40 bins": one write, one Undo', async () => {
    const { say, board: b } = mountOn('c0')
    expect(await say('turn on volume profile with 40 bins')).toMatch(/Turned on Volume Profile with 40 bins/)
    expect(vpOf(b, 'c0')).toEqual({ ...DEF, enabled: true, bins: 40 })
    await say('undo')
    expect(vpOf(b, 'c0')).toEqual({ ...DEF })
  }, 40000)
  it('colours: a name → the hex the picker stores; POC separately; Undo restores the rgba defaults', async () => {
    const { say, board: b } = mountOn('c0', { c0: withVp({ enabled: true }) })
    p.st.envelopes.push(plan(['c0', VP, vp({ color: 'blue', pocColor: '#FF8800' })]))
    expect(await say('make the volume profile blue with an orange-ish point of control')).toMatch(/Set Volume Profile to colour blue \(was rgba\(120,160,100,0\.25\)\) and point of control colour #ff8800/)
    expect(vpOf(b, 'c0')).toMatchObject({ color: '#2962ff', pocColor: '#ff8800' })
    await say('undo')
    expect(vpOf(b, 'c0')).toEqual({ ...DEF, enabled: true })
  }, 40000)
  it.each(['token:accent', 'chartreuse-ish', 'rgb(1,2)'])('colour "%s": refused (the canvas cannot paint it), nothing written', async (c) => {
    const { say, board: b } = mountOn('c0', { c0: withVp({ enabled: true }) })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', VP, vp({ color: c })]))
    expect(await say('change the volume profile colour')).toMatch(/isn’t a colour I can set for Volume Profile/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('bins on a profile that is OFF: asked first, nothing written', async () => {
    const { say, board: b } = mountOn('c0')
    const was = JSON.stringify(b.state.widgets)
    expect(await say('set the volume profile bins to 30')).toMatch(/Volume Profile is off on this chart\. Turn it on with 30 bins\?/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('the seam refuses by the row\'s own field table', () => {
    expect(checkVolumeProfilePatch({ bins: 51 }).ok).toBe(false)
    expect(checkVolumeProfilePatch({ bins: 8 }).ok).toBe(true)
    expect(checkVolumeProfilePatch({ period: 8 }).ok).toBe(false)
    expect(vpPatchOf({ color: 'red', bins: null })).toEqual({ color: '#df4646' })
  })
})

describe('P3 · "already" is an honest receipt: no write, no Undo', () => {
  it.each([
    ['turn on volume profile', { c0: withVp({ enabled: true }) }, /Volume Profile is already on on this chart/],
    ['turn off volume profile', {}, /Volume Profile is already off on this chart/],
    ['set the volume profile bins to 24', { c0: withVp({ enabled: true }) }, /already on on this chart with 24 bins/],
  ])('"%s"', async (t, s, re) => {
    const { say, board: b } = mountOn('c0', s)
    const was = JSON.stringify(b.state.widgets)
    expect(await say(t)).toMatch(re)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
    expect(undoButton()).toBeNull()
  }, 40000)
})

describe('P4 · targeting: the clicked chart, a named ticker\'s chart, every chart, exceptions', () => {
  it('"turn on volume profile on the NVDA chart" (c0 clicked): only NVDA\'s chart', async () => {
    const { say, board: b } = mountOn('c0')
    const before = others(b, 'c2')
    p.st.envelopes.push(plan(['c2', VP, vp({ enabled: true })]))
    await say('turn on volume profile on the NVDA chart')
    expect(vpOf(b, 'c2').enabled).toBe(true)
    expect(others(b, 'c2')).toBe(before)
  }, 40000)
  it('"turn on volume profile on every chart": all four; one Undo takes all four back', async () => {
    const { say, board: b } = mountOn(null)
    p.st.envelopes.push(plan(...IDS.map(id => [id, VP, vp({ enabled: true })])))
    await say('turn on volume profile on every chart')
    expect(IDS.map(id => vpOf(b, id).enabled)).toEqual([true, true, true, true])
    await say('undo')
    expect(IDS.map(id => vpOf(b, id).enabled)).toEqual([false, false, false, false])
  }, 40000)
  it.each([
    ['turn on volume profile on every chart except mine', 'c1'],
    ['turn on volume profile on every chart except the NVDA one', 'c2'],
    ['turn on volume profile on every chart except my chart', 'c1'],
  ])('"%s": a plan that also names the excluded chart is not run on it — that chart stays byte-identical', async (t, excluded) => {
    const { say, board: b } = mountOn('c1')
    const keep = JSON.stringify(b.state.widgets.find(w => w.id === excluded).opts)
    p.st.envelopes.push(plan(...IDS.map(id => [id, VP, vp({ enabled: true })])))
    await say(t)
    expect(JSON.stringify(b.state.widgets.find(w => w.id === excluded).opts), transcript()).toBe(keep)
  }, 40000)
  it('END TO END: every chart except mine → exactly the other three, the excluded chart untouched', async () => {
    const { say, board: b } = mountOn('c1')
    const keep = JSON.stringify(b.state.widgets.find(w => w.id === 'c1').opts)
    p.st.envelopes.push(plan(...['c0', 'c2', 'c3'].map(id => [id, VP, vp({ enabled: true })])))
    await say('turn on volume profile on every chart except mine')
    expect(IDS.map(id => vpOf(b, id).enabled)).toEqual([true, false, true, true])
    expect(JSON.stringify(b.state.widgets.find(w => w.id === 'c1').opts)).toBe(keep)
  }, 40000)
  it('END TO END: every chart except NVDA → the other three', async () => {
    const { say, board: b } = mountOn('c1')
    p.st.envelopes.push(plan(...['c0', 'c1', 'c3'].map(id => [id, VP, vp({ enabled: true })])))
    await say('turn on volume profile on every chart except NVDA')
    expect(IDS.map(id => vpOf(b, id).enabled)).toEqual([true, true, false, true])
  }, 40000)
  it('a chart with no traded volume (an economic series): "not available here", nothing written', async () => {
    const econ = (s) => (s.ref === 'c0' || String(s.ref).startsWith('c0') ? { ...label(s), symbol: 'econ:CPIAUCSL' } : label(s))
    const { say, board: b } = mountOn('c0', {}, econ)
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', VP, vp({ enabled: true })]))
    expect(await say('turn on the volume profile here please')).toMatch(/isn’t available on that chart/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
})

describe('P5 · NOT_ADDABLE: Volume Profile is still never an indicator.add; the moving-average refusals unchanged', () => {
  it('indicator.add of a moving-average overlay word refuses exactly as before', async () => {
    const { say, board: b } = mountOn('c0')
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicator.add', target: body.context.indicatorEdits?.[0]?.ref || `ixe:${refOf(body, 'c0')}`, args: { defId: 'moving average', inputs: null } }]))
    expect(await say('add a moving average overlay')).toMatch(/That indicator can’t be added this way\. Classic overlay averages and Volume Profile are added from Chart Settings\./)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it.each(['ma', 'moving average', 'classic', 'overlay'])('check refuses defId "%s" with the unchanged sentence', (d) => {
    const cap = getCapability('indicator.add')
    expect(cap.check({ cs: bareSettings(), rows: [] }, { defId: d, inputs: null })).toBe('That indicator can’t be added this way. Classic overlay averages and Volume Profile are added from Chart Settings.')
  })
  it.each(['volumeProfile', 'volume profile', 'vpvr', 'VP'])('indicator.add of "%s" still refuses — and points at the new action', (d) => {
    expect(getCapability('indicator.add').check({ cs: bareSettings(), rows: [] }, { defId: d, inputs: null })).toBe(VP_NOT_AN_ADD)
  })
  it.each(['volume profile', 'vp', 'moving average', 'ma'])('defIdOfWords("%s") stays null', (w) => expect(defIdOfWords(w)).toBeNull())
})

describe('P6 · disambiguation: the Volume pane, VWAP, volume alerts, a bare "VP"', () => {
  it.each([['hide volume', 'volume.setState'], ['remove the volume pane', 'volume.setState'], ['add vwap', 'indicator.add']])(
    '"%s" is %s on the fast path, never volumeProfile.set', (t, action) => {
      const r = fastParse(t)
      expect(r?.ops?.map(o => o.action)).toEqual([action])
    })
  it.each(['turn on volume profile', 'add vpvr', 'hide vp'])('"%s" fast-matches volumeProfile.set only', (t) => {
    expect(fastParse(t)?.ops?.map(o => o.action)).toEqual([VP])
  })
  it.each(['vp', 'what is vp', 'my vp of sales said so', 'volume'])('"%s": not a fast hit', (t) => {
    expect((fastParse(t)?.ops || []).some(o => o.action === VP)).toBe(false)
  })
  it('a bare "vp" goes to the model (which asks) — nothing written', async () => {
    const { say, board: b } = mountOn('c0')
    const was = JSON.stringify(b.state.widgets)
    expect(await say('vp')).toMatch(new RegExp(MODEL_SENTINEL))
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
})

describe('contract and routing', () => {
  it('the marker action is registered on the Charts surface, exact Undo, inside the manifest limits', () => {
    expect(VOLUME_PROFILE_ACTION).toBe('volumeProfile.set')
    const L = MANIFEST_CONTRACT.limits
    const mine = manifestFor({ surface: 'charts' }).filter(x => x.name.startsWith('volumeProfile.'))
    expect(mine.map(c => c.name)).toEqual([VP])
    expect(getCapability(VP).undo).toBe('exact')
    expect(mine[0].summary.length).toBeLessThanOrEqual(L.maxSummary)
    expect((mine[0].hints || '').length).toBeLessThanOrEqual(L.maxHints)
    expect(manifestFor({ surface: 'screener' }).some(x => x.name === VP)).toBe(false)     // not available here
  })
  it('its own words-only, fill-last group', () => {
    expect(GROUPS.find(x => x.id === 'volumeProfile')).toMatchObject({ wordsOnly: true, fillLast: true })
    expect(groupOfAction(VP)).toBe('volumeProfile')
  })
  it.each(['turn on volume profile', 'add the volume-profile', 'set the vpvr bins to 30', 'show the visible range volume profile', 'hide vp', 'vp off', 'volume profiles on all charts'])(
    'selected by its own words: "%s"', (t) => expect(wordsSelect('volumeProfile', t)).toBe(true))
  it.each(['hide the volume pane', 'show volume', 'remove volume', 'add vwap', 'anchored vwap from the low', 'alert me when volume spikes', 'volume alert on nvda',
    'what is the volume today', 'vp', 'the vp of sales', 'unusual volume scan'])('NEGATIVE: not its words: "%s"', (t) => expect(wordsSelect('volumeProfile', t)).toBe(false))
  it('receipt lines turn pending through PAST_TO_PENDING', () => {
    expect(pendingLine('Turned on Volume Profile with 40 bins')).toBe('Turn on Volume Profile with 40 bins')
    expect(pendingLine('Set Volume Profile to 30 bins (was 24)')).toMatch(/^Set /)
  })
})
