// re-merged onto master 28f8d6bda9 (2026-11-13): this line starts the Agent CI push run for a merge-only head.
// Charts family: uctIntelligence.set (marker: uctIntelligence.set) through the REAL panel on the fixture board, the model scripted
// (no paid call). The UCT Intelligence chart INDICATOR as a member's own switches drive it — the Indicators library row's add /
// remove (addUctIntelligence / removeUctIntelligence) and the panel's toggles (setUctIntelligenceLayer; Auto patterns = the
// Patterns button's `showPatterns`) — on the chart the targeting rules name, gated by the product's own layerAvailability()
// (published by StockChart as snap.uctIntel; decorated here), read back, exact Undo of showPatterns + the uctIntelligence block.
// The widget half (ChartWidget adapter → ChartPane → StockChart, ONE onOptsChange, reload, the overlay prop) is
// pages/charts/widgets/ChartWidget.uctIntelligence.test.jsx and components/StockChart.uctIntelligenceAgent.test.jsx.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { wordsSelect, groupOfAction, GROUPS } from './routing'
import { pendingLine } from './proposalWording'
import { readUctIntelligence, addUctIntelligence, setUctIntelligenceLayer, removeUctIntelligence } from '../components/chart/uctIntelligence'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { settingDescriptor } from '../components/chart/chartSettingsDescriptors'
import { UCT_INTELLIGENCE_ACTION, uctIntelligenceSettings } from './capabilities/uctIntelligence'
import { buildWorkspaceHost } from './host'
import { planOps, collectTargets } from './executor'
import { commitPlan } from './runtime'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const A = UCT_INTELLIGENCE_ACTION
// what StockChart publishes for a viewer with the pattern layer: S/R and Setups released, Candlestick patterns and Caution not
const AV = { supportResistance: true, supportResistanceEmpty: false, candles: false, setups: true, caution: false }
const UCI = { available: true, known: true, availability: AV }
const cell = (id, x, y, color, extra) => ({ id, type: 'chart', x, y, w: 12, h: 10, color, opts: { settings: { ...bareSettings(), ...(extra || {}) } } })
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', A: 'NVDA', B: 'TSLA' }
const IDS = ['c0', 'c1', 'c2', 'c3']
const board = (s = {}) => [cell('c0', 0, 0, 'N', s.c0), cell('c1', 12, 0, 'N', s.c1), cell('c2', 0, 10, 'A', s.c2), cell('c3', 12, 10, 'B', s.c3)]
const withUci = (gates = {}) => (s) => (s ? { ...s, label: `Chart (${s.ref})`, ...(gates[s.ref] === undefined ? { uctIntel: UCI } : gates[s.ref] === 'absent' ? {} : { uctIntel: gates[s.ref] }) } : s)
function mountOn(clicked, settings, gates) {
  const m = p.mount(board(settings), SYMS, { decorate: withUci(gates) })
  if (clicked) p.select(clicked)
  return m
}
const stored = (b, id) => b.state.widgets.find(w => w.id === id).opts.settings
const uci = (b, id) => readUctIntelligence(mergeChartSettings(stored(b, id)))
const others = (b, id) => JSON.stringify(b.state.widgets.filter(w => w.id !== id).map(w => w.opts))
const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const plan = (...ops) => (body) => p.env('apply', ops.map(([id, args]) => ({ action: A, target: refOf(body, id), args })))
const op = (o, layer = null) => ({ op: o, layer })
const undoButton = () => screen.queryByRole('button', { name: 'Undo' })
const pick = (s) => ({ showPatterns: s?.showPatterns ?? null, uctIntelligence: s?.uctIntelligence ?? null })

describe('U1 · add / remove the indicator, as its Indicators library row does', () => {
  it.each(['add uct intelligence to this chart', 'put the UCT Intelligence indicator on this chart', 'turn on uct intelligence here'])(
    '"%s": Auto patterns + labels on, exactly the row\'s add; the other three untouched; Undo restores both keys', async (t) => {
      const { say, board: b } = mountOn('c2')
      const before = others(b, 'c2'), was = stored(b, 'c2')
      p.st.envelopes.push(plan(['c2', op('add')]))
      const out = await say(t)
      expect(out).toMatch(/Added UCT Intelligence to this chart — showing Auto patterns and Pattern labels/)
      expect(pick(stored(b, 'c2'))).toEqual(pick(addUctIntelligence(mergeChartSettings(was))))
      expect(uci(b, 'c2')).toMatchObject({ added: true, autoPatterns: true, labels: true, setups: false })
      expect(others(b, 'c2')).toBe(before)                  // wrong-target control
      await say('undo')
      expect(stored(b, 'c2')).toEqual(was)                  // showPatterns AND the (absent) uctIntelligence block, exactly
    }, 40000)
  it('remove keeps the sub-choices (as the product does) and the receipt claims no more; Undo brings every layer back', async () => {
    const mine = { showPatterns: true, uctIntelligence: { added: true, labels: false, setups: true, supportResistance: true } }
    const { say, board: b } = mountOn('c0', { c0: mine })
    const was = stored(b, 'c0')
    p.st.envelopes.push(plan(['c0', op('remove')]))
    const out = await say('remove uct intelligence from this chart')
    expect(out).toMatch(/Removed UCT Intelligence from this chart — its layers are off \(its panel keeps your choices/)
    expect(out).not.toMatch(/deleted|reset|cleared/i)
    expect(pick(stored(b, 'c0'))).toEqual(pick(removeUctIntelligence(was)))
    expect(stored(b, 'c0').uctIntelligence).toEqual({ added: false, labels: false, setups: true, supportResistance: true })
    await say('undo')
    expect(stored(b, 'c0')).toEqual(was)
  }, 40000)
})

describe('U2 · layers on / off, as the panel\'s switches do', () => {
  it('setups ON (released): the panel toggle\'s write; Undo exact', async () => {
    const mine = { showPatterns: true, uctIntelligence: { added: true, labels: true } }
    const { say, board: b } = mountOn('c1', { c1: mine })
    const was = stored(b, 'c1')
    p.st.envelopes.push(plan(['c1', op('on', 'setups')]))
    expect(await say('turn on the setups layer in uct intelligence')).toMatch(/Turned Setups on \(UCT Intelligence\)/)
    expect(pick(stored(b, 'c1'))).toEqual(pick(setUctIntelligenceLayer(was, 'setups', true)))
    await say('undo')
    expect(stored(b, 'c1')).toEqual(was)
  }, 40000)
  it('auto patterns OFF writes showPatterns (the Patterns button\'s key) and leaves the indicator added; Undo restores showPatterns', async () => {
    const mine = { showPatterns: true, uctIntelligence: { added: true, labels: true } }
    const { say, board: b } = mountOn('c3', { c3: mine })
    const was = stored(b, 'c3')
    p.st.envelopes.push(plan(['c3', op('off', 'autoPatterns')]))
    expect(await say('turn off auto patterns')).toMatch(/Turned Auto patterns off \(UCT Intelligence\)/)
    expect(stored(b, 'c3').showPatterns).toBe(false)
    expect(stored(b, 'c3').uctIntelligence).toEqual(mine.uctIntelligence)
    await say('undo')
    expect(stored(b, 'c3').showPatterns).toBe(true)
    expect(stored(b, 'c3')).toEqual(was)
  }, 40000)
  it('a sub-layer ON on a chart WITHOUT the indicator adds it in the SAME write (one Undo), and says so', async () => {
    const { say, board: b } = mountOn('c0')
    const was = stored(b, 'c0')
    p.st.envelopes.push(plan(['c0', op('on', 'supportResistance')]))
    expect(await say('turn on support and resistance')).toMatch(/Added UCT Intelligence to this chart with Support & resistance on — showing Auto patterns, Pattern labels and Support & resistance/)
    expect(uci(b, 'c0')).toMatchObject({ added: true, autoPatterns: true, supportResistance: true })
    await say('undo')
    expect(stored(b, 'c0')).toEqual(was)
  }, 40000)
})

describe('U3 · gates: a layer the panel has no switch for is refused with the product\'s reason, never written, never "done"', () => {
  it.each([
    ['candlestick patterns (not released)', op('on', 'candles'), UCI, /Candlestick patterns aren’t released to your account on this chart/],
    ['caution (not released)', op('on', 'caution'), UCI, /Caution isn’t released to your account/],
    ['S/R released but nothing to draw (the quiet switch)', op('on', 'supportResistance'), { ...UCI, availability: { ...AV, supportResistanceEmpty: true } }, /no clear levels on this chart/],
    ['setups while the gates have not answered', op('on', 'setups'), { available: true, known: false, availability: { ...AV, setups: false } }, /can’t tell yet whether Setups is available/],
    ['the indicator itself for a viewer without the pattern layer', op('add'), { available: false, known: false, availability: {} }, /isn’t offered on this chart for your account/],
  ])('%s', async (_n, args, gate, re) => {
    const mine = { showPatterns: true, uctIntelligence: { added: true, labels: true } }
    const { say, board: b } = mountOn('c0', { c0: mine }, { c0: gate })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', args]))
    const out = await say('switch that layer for me please')
    expect(out).toMatch(re)
    expect(out).not.toMatch(/Turned|Added/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
    expect(undoButton()).toBeNull()
  }, 40000)
  it('the admin-only switches (learned lines, all tiers, key levels) are not layers this action offers', () => {
    const layers = getCapability(A).args.properties.layer.enum
    expect(layers).toEqual(['autoPatterns', 'labels', 'supportResistance', 'candles', 'setups', 'caution', null])
  })
  it.each([['a Multi Chart cell (no adapter door)', 'absent', /isn’t available on that chart here/], ['a chart still loading', null, /hasn’t finished loading/]])(
    '%s: "not available here", nothing written', async (_n, gate, re) => {
      const { say, board: b } = mountOn('c0', {}, { c0: gate })
      const was = JSON.stringify(b.state.widgets)
      p.st.envelopes.push(plan(['c0', op('add')]))
      expect(await say('add uct intelligence')).toMatch(re)
      expect(JSON.stringify(b.state.widgets)).toBe(was)
    }, 40000)
})

describe('U4 · a no-op says so, writes nothing, offers no Undo', () => {
  it.each([
    ['add uct intelligence', { showPatterns: true, uctIntelligence: { added: true, labels: true } }, op('add'), /UCT Intelligence is already on this chart/],
    ['remove uct intelligence', { showPatterns: false }, op('remove'), /isn’t on this chart, so there is nothing to remove/],
    ['turn the pattern labels on', { showPatterns: true, uctIntelligence: { added: true, labels: true } }, op('on', 'labels'), /Pattern labels are already on/],
    ['turn off the caution layer', { showPatterns: true, uctIntelligence: { added: true, caution: true } }, op('off', 'caution'), /Caution is not available on this chart right now/],
    ['turn off setups', { showPatterns: true }, op('off', 'setups'), /UCT Intelligence isn’t on this chart, so Setups isn’t showing/],
  ])('"%s"', async (t, mine, args, re) => {
    const { say, board: b } = mountOn('c0', { c0: mine })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', args]))
    expect(await say(t)).toMatch(re)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
    expect(undoButton()).toBeNull()
  }, 40000)
  it('remove when only the Patterns button is on: nothing to remove, and it says how to turn Auto patterns off', async () => {
    const { say } = mountOn('c0', { c0: { showPatterns: true } })
    p.st.envelopes.push(plan(['c0', op('remove')]))
    expect(await say('remove uct intelligence')).toMatch(/Auto patterns is on from the chart’s Patterns button: say “turn off auto patterns”/)
  }, 40000)
  it('pattern labels off on a chart without the panel: refused (the switch is in the panel), nothing written', async () => {
    const { say, board: b } = mountOn('c0', { c0: { showPatterns: true } })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', op('off', 'labels')]))
    expect(await say('turn off the pattern labels')).toMatch(/Pattern labels are switched in the UCT Intelligence panel/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
})

describe('U5 · targeting: the clicked chart, a named ticker\'s chart, every chart, exceptions', () => {
  it('"add uct intelligence to the NVDA chart" (c0 clicked): only NVDA\'s chart', async () => {
    const { say, board: b } = mountOn('c0')
    const before = others(b, 'c2')
    p.st.envelopes.push(plan(['c2', op('add')]))
    await say('add uct intelligence to the NVDA chart')
    expect(uci(b, 'c2').added).toBe(true)
    expect(uci(b, 'c0').added).toBe(false)
    expect(others(b, 'c2')).toBe(before)
  }, 40000)
  it('"add uct intelligence to every chart": all four; one Undo takes all four back', async () => {
    const { say, board: b } = mountOn(null)
    const was = IDS.map(id => stored(b, id))
    p.st.envelopes.push(plan(...IDS.map(id => [id, op('add')])))
    await say('add uct intelligence to every chart')
    expect(IDS.map(id => uci(b, id).added)).toEqual([true, true, true, true])
    await say('undo')
    expect(IDS.map(id => stored(b, id))).toEqual(was)
  }, 40000)
  it.each([['add uct intelligence to every chart except mine', 'c1'], ['add uct intelligence to every chart except the NVDA one', 'c2']])(
    '"%s": a plan that also names the excluded chart is not run on it', async (t, excluded) => {
      const { say, board: b } = mountOn('c1')
      p.st.envelopes.push(plan(...IDS.map(id => [id, op('add')])))
      await say(t)
      expect(uci(b, excluded).added).toBe(false)
    }, 40000)
  it('every chart, one of them a Multi Chart-like chart with no door: that one is refused, nothing at all is written', async () => {
    const { say, board: b } = mountOn(null, {}, { c3: 'absent' })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(...IDS.map(id => [id, op('add')])))
    expect(await say('add uct intelligence to every chart')).toMatch(/isn’t available on that chart here/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
})

describe('U6 · read-back: a write the chart did not keep is never reported as done', () => {
  it('the chart adapter accepts the commit but its stored settings never change → no "Added", no Undo', async () => {
    const m = mountOn('c0')
    const base = m.h.charts
    m.h.charts.commit = () => true                        // a widget that drops the write (its onOptsChange never lands)
    void base
    const was = JSON.stringify(m.board.state.widgets)
    p.st.envelopes.push(plan(['c0', op('add')]))
    const out = await m.say('add uct intelligence')
    expect(out).not.toMatch(/Added UCT Intelligence/)
    expect(JSON.stringify(m.board.state.widgets)).toBe(was)
    expect(undoButton()).toBeNull()
  }, 40000)
})

describe('U7 · Undo after a later member edit restores showPatterns + the block, keeps the member\'s edit', () => {
  it('add, then the member turns the grid off themselves, then Undo: patterns back off, grid stays off', async () => {
    const { say, board: b } = mountOn('c0')
    const was = stored(b, 'c0')
    p.st.envelopes.push(plan(['c0', op('add')]))
    await say('add uct intelligence')
    const w = b.state.widgets.find(x => x.id === 'c0')
    w.opts = { ...w.opts, settings: { ...w.opts.settings, grid: { ...(w.opts.settings.grid || {}), visible: false } } }
    await say('undo')
    const now = stored(b, 'c0')
    expect(now.showPatterns).toBe(was.showPatterns ?? false)
    expect(now.uctIntelligence ?? null).toEqual(was.uctIntelligence ?? null)
    expect(now.grid.visible).toBe(false)
  }, 40000)
})

describe('contract, wording and routing', () => {
  it('the marker action is registered on the Charts surface, inside the manifest limits', () => {
    const c = getCapability(A)
    expect(c.target).toBe('chart')
    expect(c.surfaces).toEqual(['charts'])
    expect(groupOfAction(A)).toBe('uctIntelligence')
    const m = manifestFor({ surface: 'charts' }).find(x => x.name === A)
    expect(JSON.stringify(m).length).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxCapBytes)
  })
  it('its own words-only, fill-last group', () => {
    const g = GROUPS.find(x => x.id === 'uctIntelligence')
    expect([g.wordsOnly, g.fillLast, g.domains]).toEqual([true, true, ['uctIntelligence']])
  })
  it('receipt lines turn pending on a card', () => {
    expect(pendingLine('Added UCT Intelligence to this chart — showing Auto patterns and Pattern labels')).toMatch(/^Add UCT Intelligence/)
    expect(pendingLine('Turned Setups on (UCT Intelligence)')).toMatch(/^Turn Setups on/)
    expect(pendingLine('Removed UCT Intelligence from this chart — its layers are off')).toMatch(/^Remove UCT Intelligence/)
  })
  it('the generic chart-settings path never writes showPatterns (internal), and names this action instead', () => {
    const d = settingDescriptor('showPatterns')
    expect(d.agent).toBe('internal')
    expect(d.why).toMatch(/uctIntelligence\.set/)
    expect(getCapability('chart.setSetting').args.properties.setting.enum).not.toContain('showPatterns')
  })
  it('the transforms are the product\'s: identity when nothing changes (no write), ONE object otherwise', () => {
    const cs = mergeChartSettings(null)
    expect(uctIntelligenceSettings(cs, op('remove'))).toBe(cs)
    expect(uctIntelligenceSettings(cs, op('off', 'setups'), AV)).toBe(cs)
    const added = uctIntelligenceSettings(cs, op('add'))
    expect(uctIntelligenceSettings(added, op('add'))).toBe(added)
    expect(uctIntelligenceSettings(added, op('on', 'setups'), AV)).toEqual(setUctIntelligenceLayer(added, 'setups', true))
  })
  it.each(['add uct intelligence to this chart', 'remove the UCT Intelligence indicator', 'turn on auto patterns', 'turn off the pattern labels',
    'hide the chart patterns', 'turn the patterns off', 'show candlestick patterns on this chart', 'turn on the setups layer', 'enable caution setups',
    'turn on support and resistance', 'switch off the s/r layer', 'show the uct intelligence panel'])('selected by its own words: "%s"', (t) => expect(wordsSelect('uctIntelligence', t)).toBe(true))
  // ⛔ AUTHORING: "Modify / create … with UCT Intelligence" is the indicator builder, never this action
  it.each(['modify with uct intelligence', 'Modify this indicator with UCT Intelligence', 'create an indicator with UCT Intelligence',
    'build me an RSI divergence indicator using uct intelligence', 'use UCT Intelligence to make a new indicator', 'ask uct intelligence to write a custom indicator',
    'edit my indicator with uct intelligence', 'make a custom indicator in uct intelligence'])('NEGATIVE (authoring): "%s"', (t) => expect(wordsSelect('uctIntelligence', t)).toBe(false))
  // ⛔ "patterns" / "setups" / "labels" / "support" questions and other features are not its words
  it.each(['what patterns do you see on nvda', 'is this a cup with handle pattern', 'find stocks with bull flag patterns', 'turn on chart iq pattern recognition',
    'describe the setup on this chart', 'what setups are working this week', 'hide the labels', 'show price labels', 'draw support at 50',
    'where is support on nvda', 'explain support and resistance', 'what is a candlestick pattern', 'show me the setups for spy'])('NEGATIVE: not its words: "%s"', (t) => expect(wordsSelect('uctIntelligence', t)).toBe(false))
  it('the authoring flow keeps its own capabilities: the UCT Intelligence words do not reach indicatorAuthoring\'s group', () => {
    expect(groupOfAction('indicator.draft')).not.toBe('uctIntelligence')
  })
})

// a commit straight through the planner + runtime (no panel): the plan carries ONE settings patch for the action
describe('U8 · one settings commit per action', () => {
  it('add + setups on in one plan on one chart = ONE commit of both keys', async () => {
    const writes = []
    let stored0 = { ...bareSettings() }
    const api = { agent: {
      read: () => ({ chartId: 'w1', tabId: null, groupKey: 'N1', symbol: 'NVDA', tf: 'D', cs: mergeChartSettings(stored0), stored: stored0 }),
      uctIntelligence: () => UCI,
      commit: (patch) => { writes.push(patch); if ('settings' in patch) stored0 = patch.settings; return true },
    } }
    const host = buildWorkspaceHost({ chartApiById: { current: new Map([['w1', api]]) }, getWidgets: () => [{ id: 'w1', type: 'chart', color: 'N1', x: 0, y: 0, w: 24, h: 20, opts: {} }] })
    const ref = host.charts.list()[0].ref
    const pl = planOps(collectTargets(host, ['chart']), [{ action: A, target: ref, args: op('add') }, { action: A, target: ref, args: op('on', 'setups') }], {}, { surface: 'charts' })
    expect(pl.ok, JSON.stringify(pl.refusals)).toBe(true)
    const res = await commitPlan(host, pl)
    expect(res.ok).toBe(true)
    expect(writes).toHaveLength(1)
    expect(readUctIntelligence(writes[0].settings)).toMatchObject({ added: true, autoPatterns: true, setups: true })
  })
})

// ── AUDIT #1172 ruling 1: "patterns" is two features (Chart IQ's button, showChartIq; UCT Intelligence's Patterns button,
// showPatterns). On a chart with UCT Intelligence's patterns the bare word ASKS; elsewhere master's Chart IQ fast path is unchanged.
describe('U9 · a bare "patterns" toggle on a chart with UCT Intelligence asks which; never a silent Chart IQ write', () => {
  it.each([
    ['UCT Intelligence added', { showPatterns: true, uctIntelligence: { added: true, labels: true } }],
    ['UCT Intelligence added, Auto patterns off', { showPatterns: false, uctIntelligence: { added: true } }],
    ['only the Patterns button on', { showPatterns: true }],
  ])('%s: "turn the patterns off on this chart" asks, writes nothing, calls no model', async (_n, mine) => {
    const { say, board: b } = mountOn('c0', { c0: { ...mine, showChartIq: true } })
    const was = JSON.stringify(b.state.widgets)
    expect(await say('turn the patterns off on this chart')).toMatch(/Which patterns do you mean — UCT Intelligence’s Auto patterns \(the chart’s Patterns button\) or Chart IQ pattern recognition\?/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
    expect(p.turns()).toBe(0)
  }, 40000)
  it('a chart WITHOUT UCT Intelligence patterns: master\'s fast path, Chart IQ, named on the receipt', async () => {
    const { say, board: b } = mountOn('c0', { c0: { showPatterns: false, showChartIq: true } })
    const out = await say('turn the patterns off on this chart')
    expect(out).not.toMatch(/Which patterns/)
    expect(out).toMatch(/Chart IQ pattern recognition/)
    expect(stored(b, 'c0').showChartIq).toBe(false)
    expect(stored(b, 'c0').showPatterns).toBe(false)
  }, 40000)
  it('naming Chart IQ on a chart WITH UCT Intelligence: no question, Chart IQ only — Auto patterns untouched', async () => {
    const { say, board: b } = mountOn('c0', { c0: { showPatterns: true, showChartIq: true, uctIntelligence: { added: true } } })
    const out = await say('turn off chart iq')
    expect(out).not.toMatch(/Which patterns/)
    expect(stored(b, 'c0').showChartIq).toBe(false)
    expect(stored(b, 'c0').showPatterns).toBe(true)
  }, 40000)
})

// ── AUDIT #1172 ruling 2: gates not known yet — honest wording either way, and a compound refused whole
describe('U10 · unknown gates: "still loading" on a chart WITH the indicator, "add it first" on one without', () => {
  const UNKNOWN = { available: true, known: false, loading: false, availability: { setups: false } }
  it('added, the patterns request IN FLIGHT: "can\'t tell yet … still loading", never "add it first"; nothing written', async () => {
    const { say, board: b } = mountOn('c0', { c0: { showPatterns: true, uctIntelligence: { added: true } } }, { c0: { ...UNKNOWN, loading: true } })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', op('on', 'supportResistance')]))
    const out = await say('turn on support and resistance')
    expect(out).toMatch(/can’t tell yet whether Support & resistance is available on this chart — UCT Intelligence’s pattern data is still loading/)
    expect(out).not.toMatch(/Add UCT Intelligence first/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('added, NO request in flight (never fetched, or it ended without the gates): "can\'t tell yet" WITHOUT "loading", and how to get them', async () => {
    const { say, board: b } = mountOn('c0', { c0: { showPatterns: false, uctIntelligence: { added: true } } }, { c0: UNKNOWN })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', op('on', 'supportResistance')]))
    const out = await say('turn on support and resistance')
    expect(out).toMatch(/can’t tell yet whether Support & resistance is available on this chart — it has no pattern data for UCT Intelligence\. Turn on Auto patterns \(the chart’s Patterns button\)/)
    expect(out).not.toMatch(/loading/i)
    expect(out).not.toMatch(/Add UCT Intelligence first/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('not added: "add UCT Intelligence first"; nothing written', async () => {
    const { say, board: b } = mountOn('c0', {}, { c0: UNKNOWN })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', op('on', 'candles')]))
    expect(await say('turn on support and resistance')).toMatch(/until UCT Intelligence is on it .* Add UCT Intelligence first, then ask again/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('the compound "add it with S/R on" on a chart without it: refused WHOLE (no add either), add-first wording', async () => {
    const { say, board: b } = mountOn('c0', {}, { c0: UNKNOWN })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', op('add')], ['c0', op('on', 'supportResistance')]))
    const out = await say('add uct intelligence with support and resistance on')
    expect(out).toMatch(/Add UCT Intelligence first/)
    expect(out).not.toMatch(/Added UCT Intelligence/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
    expect(undoButton()).toBeNull()
  }, 40000)
})

// ── AUDIT #1172 ruling 4: the panel's ADMIN switches are refused by the capability itself, by key
describe('U11 · admin-only switches are never a layer of this action', () => {
  const ADMIN_KEYS = ['admin-learned', 'admin-all', 'admin-levels', 'showLearned', 'showAll', 'showLevels', 'learned', 'keyLevels', 'allTiers']
  const env = { target: { uctIntel: { available: true, known: true, availability: { ...AV, supportResistance: true } }, cs: mergeChartSettings(null) } }
  it.each(ADMIN_KEYS)('check() refuses %s by key (capability level, not only the manifest enum)', (k) => {
    for (const o of ['on', 'off']) expect(getCapability(A).check({ cs: mergeChartSettings(null) }, { op: o, layer: k }, env)).toMatch(/admin-only switches/)
  })
  it.each(ADMIN_KEYS)('a model plan naming %s is refused; nothing written', async (k) => {
    const { say, board: b } = mountOn('c0', { c0: { showPatterns: true, uctIntelligence: { added: true } } })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', op('on', k)]))
    const out = await say('switch that layer for me please')
    expect(out).not.toMatch(/Turned|Added/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
})
