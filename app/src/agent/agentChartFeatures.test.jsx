// Charts family: chartFeatures.companyPanel / chartFeatures.earningsStrip (marker: chartFeatures.companyPanel) through the REAL
// panel on the fixture board, the model scripted (no paid call). What a member's own clicks do — Indicators → Add to Chart's
// add / remove (addFeature / removeFeature), the panel's chevron / edge rail (setFeatureOpen), its tab strip — on ONE chart
// widget's opts.dock, the chart the targeting rules name; read back; exact Undo of the raw dock snapshot. The widget half
// (the ChartWidget adapter, ONE onOptsChange, the reload) is pages/charts/widgets/ChartWidget.chartFeatures.test.jsx.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { wordsSelect, groupOfAction, GROUPS } from './routing'
import { pendingLine } from './proposalWording'
import { normalizeDock, DEFAULT_RIGHT_W } from '../pages/charts/widgets/chartDock'
import { addFeature, EARNINGS_STRIP } from '../pages/charts/widgets/chartFeatures'
import { companyPanelDock, earningsStripDock, COMPANY_PANEL_ACTION } from './capabilities/chartFeatures'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const CP = 'chartFeatures.companyPanel', ES = 'chartFeatures.earningsStrip'
// a member's own dock: Company Info added, COLLAPSED, on Ownership, dragged to 520px; the strip shown at 140px
const MINE = { company: true, open: false, tab: 'ownership', rightW: 520, strip: true, stripH: 140 }
// 2×2: c0 TL (SPY, own), c1 TR (QQQ, own), c2 BL (NVDA, group A), c3 BR (TSLA, group B)
const cell = (id, x, y, color, dock) => ({ id, type: 'chart', x, y, w: 12, h: 10, color, opts: { settings: bareSettings(), ...(dock ? { dock } : {}) } })
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', A: 'NVDA', B: 'TSLA' }
const board = (docks = {}) => [cell('c0', 0, 0, 'N', docks.c0), cell('c1', 12, 0, 'N', docks.c1), cell('c2', 0, 10, 'A', docks.c2), cell('c3', 12, 10, 'B', docks.c3)]
const IDS = ['c0', 'c1', 'c2', 'c3']
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
function mountOn(clicked, docks, decorate = label) {
  const m = p.mount(board(docks), SYMS, { decorate })
  if (clicked) p.select(clicked)
  return m
}
const optsOf = (b, id) => b.state.widgets.find(w => w.id === id).opts
const rawDock = (b, id) => optsOf(b, id).dock
const dockOf = (b, id) => normalizeDock(rawDock(b, id))
const others = (b, id) => JSON.stringify(b.state.widgets.filter(w => w.id !== id).map(w => w.opts))
const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const plan = (...ops) => (body) => p.env('apply', ops.map(([id, action, args]) => ({ action, target: refOf(body, id), args })))
const cp = (op, tab = null) => ({ op, tab })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const undoButton = () => screen.queryByRole('button', { name: 'Undo' })

describe('P1 · add / remove the Company Info panel and the Earnings Strip, by any of their names', () => {
  it.each(['add the company panel to this chart', 'show the company info on this chart', 'open the profile panel here', 'put the company information panel on this chart'])(
    '"%s": the clicked chart gets the panel (added, expanded, default width); the other three untouched; Undo removes the key exactly', async (t) => {
      const { say, board: b } = mountOn('c2')
      const before = others(b, 'c2')
      p.st.envelopes.push(plan(['c2', CP, cp('open')]))
      const out = await say(t)
      expect(out).toMatch(/Added the Company Info panel, open on Overview/)
      expect(dockOf(b, 'c2')).toMatchObject({ company: true, open: true, tab: 'overview', rightW: DEFAULT_RIGHT_W })
      expect(others(b, 'c2')).toBe(before)                 // wrong-target control
      await say('undo')
      expect('dock' in optsOf(b, 'c2')).toBe(false)         // never written before → the key is gone again
    }, 40000)
  it.each(['show the earnings strip on this chart', 'show the fundamentals strip', 'add the strip under the chart', 'put the eps strip under the chart'])(
    '"%s": the Earnings Strip (dock.strip) — never DOCK_PANELS\' unrendered dock.bottom; Undo exact', async (t) => {
      const { say, board: b } = mountOn('c1')
      p.st.envelopes.push(plan(['c1', ES, { op: 'open' }]))
      const out = await say(t)
      expect(out).toMatch(/Added the Earnings Strip under this chart/)
      expect(rawDock(b, 'c1').strip).toBe(true)
      expect(rawDock(b, 'c1').bottom).toBe(false)          // ⛔ the dock.bottom guard: DOCK_PANELS' 'fundamentals' is never written
      // exactly what Add to Chart's add writes (setDock(d => addFeature(d, EARNINGS_STRIP)) over the normalised dock)
      expect(rawDock(b, 'c1')).toEqual(addFeature(normalizeDock(undefined), EARNINGS_STRIP))
      await say('undo')
      expect('dock' in optsOf(b, 'c1')).toBe(false)
    }, 40000)
  it('remove the earnings strip: Undo brings it back at the member\'s own height (stripH), not the default', async () => {
    const { say, board: b } = mountOn('c0', { c0: MINE })
    p.st.envelopes.push(plan(['c0', ES, { op: 'remove' }]))
    expect(await say('take the earnings strip off this chart')).toMatch(/Removed the Earnings Strip from this chart/)
    expect(dockOf(b, 'c0').strip).toBe(false)
    await say('undo')
    expect(rawDock(b, 'c0')).toEqual(MINE)
  }, 40000)
})

describe('P2 · collapse keeps it added; remove takes it off; a bare "close" never removes', () => {
  it.each(['hide the company panel', 'collapse the company info', 'minimise the company panel', 'close the company panel'])(
    '"%s" (collapse): it stays on the chart as the edge rail; Undo expands it exactly', async (t) => {
      const open = { ...MINE, open: true }
      const { say, board: b } = mountOn('c3', { c3: open })
      p.st.envelopes.push(plan(['c3', CP, cp('collapse')]))
      const out = await say(t)
      expect(out).toMatch(/Collapsed the Company Info panel to its edge rail \(it stays on the chart\)/)
      expect(dockOf(b, 'c3')).toMatchObject({ company: true, open: false })
      await say('undo')
      expect(rawDock(b, 'c3')).toEqual(open)
    }, 40000)
  it.each(['remove the company panel on this chart', 'take the company info off', 'get rid of the company panel'])(
    '"%s" (remove): it is off the chart; Undo restores the member\'s own width (520), tab and state — not DEFAULT_RIGHT_W', async (t) => {
      const { say, board: b } = mountOn('c3', { c3: MINE })
      p.st.envelopes.push(plan(['c3', CP, cp('remove')]))
      expect(await say(t)).toMatch(/Removed the Company Info panel from this chart/)
      expect(dockOf(b, 'c3')).toMatchObject({ company: false, open: false })
      await say('undo')
      expect(rawDock(b, 'c3')).toEqual(MINE)
      expect(dockOf(b, 'c3').rightW).toBe(520)
    }, 40000)
  it('KNOWN (generic targeting): "remove the company panel FROM this chart" reads "from this chart" as a source, so it asks — nothing written', async () => {
    const { say, board: b } = mountOn('c3', { c3: MINE })
    p.st.envelopes.push(plan(['c3', CP, cp('remove')]))
    expect(await say('remove the company panel from this chart')).toMatch(/Which chart do you mean\?/)
    expect(rawDock(b, 'c3')).toEqual(MINE)
  }, 40000)
  it('KNOWN (generic targeting): "the strip below this chart" is a relation to the chart below — asked, never written on the clicked one', async () => {
    const { say, board: b } = mountOn('c1')
    p.st.envelopes.push(plan(['c1', ES, { op: 'open' }]))
    expect(await say('put the eps strip below this chart')).toMatch(/Did you mean Chart \(c3\)\?/)
    expect(IDS.map(id => 'dock' in optsOf(b, id))).toEqual([false, false, false, false])
  }, 40000)
  it('collapse and remove are different writes (the split): collapse never clears `company`', () => {
    const d = normalizeDock(MINE)
    const open = companyPanelDock(normalizeDock({ ...MINE, open: true }), { op: 'collapse' })
    expect([open.company, open.open]).toEqual([true, false])
    const gone = companyPanelDock(d, { op: 'remove' })
    expect([gone.company, gone.open]).toEqual([false, false])
  })
  it('"close the earnings strip": the strip has no collapsed state — asked, never removed; nothing written', async () => {
    const { say, board: b } = mountOn('c0', { c0: MINE })
    p.st.envelopes.push(plan(['c0', ES, { op: 'collapse' }]))
    expect(await say('close the earnings strip')).toMatch(/has no collapsed state\. Say “remove the earnings strip”/)
    expect(rawDock(b, 'c0')).toEqual(MINE)
  }, 40000)
  it('collapse on a chart WITHOUT the panel: refused (nothing to collapse), nothing written', async () => {
    const { say, board: b } = mountOn('c1')
    p.st.envelopes.push(plan(['c1', CP, cp('collapse')]))
    expect(await say('collapse the company panel')).toMatch(/no Company Info panel to collapse/)
    expect('dock' in optsOf(b, 'c1')).toBe(false)
  }, 40000)
  it('the capability says the split to the model: bare "close" is collapse, remove only for remove words', () => {
    expect(getCapability(CP).hints).toMatch(/collapse \(hide \/ minimise \/ bare "close"/)
    expect(getCapability(CP).hints).toMatch(/remove \(only for remove \/ take off \/ get rid of\)/)
    expect(getCapability(ES).hints).toMatch(/bare "close": it has no collapsed state, so this asks/)
  })
})

describe('P4 · a no-op says "already…", writes nothing and offers no Undo', () => {
  it.each([
    ['add the company panel', { c0: { ...MINE, open: true } }, CP, cp('open'), /already open on this chart/],
    ['collapse the company panel', { c0: MINE }, CP, cp('collapse'), /already collapsed to its edge rail/],
    ['remove the company panel', {}, CP, cp('remove'), /no Company Info panel, so there is nothing to remove/],
    ['show the ownership tab of the company panel', { c0: { ...MINE, open: true } }, CP, cp(null, 'ownership'), /already open on Ownership/],
    ['add the earnings strip', { c0: MINE }, ES, { op: 'open' }, /Earnings Strip is already under this chart/],
    ['remove the earnings strip', {}, ES, { op: 'remove' }, /no Earnings Strip, so there is nothing to remove/],
  ])('"%s"', async (t, docks, action, args, re) => {
    const { say, board: b } = mountOn('c0', docks)
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', action, args]))
    expect(await say(t)).toMatch(re)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
    expect(undoButton()).toBeNull()
  }, 40000)
})

describe('P5 · targeting: the clicked chart, a named ticker\'s chart, every chart, exceptions', () => {
  it('"add the company panel to the NVDA chart" (c0 clicked): only NVDA\'s chart; the clicked one is untouched', async () => {
    const { say, board: b } = mountOn('c0')
    const before = others(b, 'c2')
    p.st.envelopes.push(plan(['c2', CP, cp('open')]))
    await say('add the company panel to the NVDA chart')
    expect(dockOf(b, 'c2').company).toBe(true)
    expect(others(b, 'c2')).toBe(before)
  }, 40000)
  it('"add the earnings strip to every chart": all four; one Undo takes all four back', async () => {
    const { say, board: b } = mountOn(null)
    p.st.envelopes.push(plan(...IDS.map(id => [id, ES, { op: 'open' }])))
    await say('add the earnings strip to every chart')
    expect(IDS.map(id => dockOf(b, id).strip)).toEqual([true, true, true, true])
    await say('undo')
    expect(IDS.map(id => 'dock' in optsOf(b, id))).toEqual([false, false, false, false])
  }, 40000)
  it.each([['add the company panel to every chart except mine', 'c1'], ['add the company panel to every chart except the NVDA one', 'c2']])(
    '"%s": a plan that also names the excluded chart is not run on it', async (t, excluded) => {
      const { say, board: b } = mountOn('c1')
      p.st.envelopes.push(plan(...IDS.map(id => [id, CP, cp('open')])))
      await say(t)
      expect(dockOf(b, excluded).company, transcript()).toBe(false)
    }, 40000)
  it('the plan on every chart but the excluded one runs on exactly those three', async () => {
    const { say, board: b } = mountOn('c1')
    p.st.envelopes.push(plan(...['c0', 'c2', 'c3'].map(id => [id, CP, cp('open')])))
    await say('add the company panel to every chart except mine')
    expect(IDS.map(id => dockOf(b, id).company)).toEqual([true, false, true, true])
  }, 40000)
  it('the dock is per WIDGET: a chart widget with several tabs says the change shows on all of them', async () => {
    const chartTabs = [{ id: 't1', color: 'N', tf: 'W' }, { id: 't2', color: 'N', tf: '60' }]
    const widgets = board()
    widgets[0] = { ...widgets[0], opts: { ...widgets[0].opts, chartTabs } }
    const m = p.mount(widgets, SYMS, { decorate: label })
    p.select('c0')
    p.st.envelopes.push(plan(['c0', CP, cp('open')]))
    expect(await m.say('add the company panel to this chart')).toMatch(/shared by all 3 tabs of this chart widget/)
  }, 40000)
})

describe('P6 · a chart with no dock (Multi Chart cell, pop-out): "not available here", nothing written', () => {
  it.each([[CP, cp('open'), 'add the company panel'], [ES, { op: 'open' }, 'show the earnings strip']])('%s', async (action, args, t) => {
    const noDock = (s) => { const { canDock, dock, dockTabs, ...rest } = label(s); return rest }
    const { say, board: b } = mountOn('c0', {}, noDock)
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', action, args]))
    expect(await say(t)).toMatch(/aren’t available on that chart here/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
})

describe('P7 · the panel\'s own options without the panel; the compound "add it and open News"', () => {
  it('widget.setOption companyTab on a chart without the panel still gives DOCK_WHY; nothing written', async () => {
    const { say, board: b } = p.mount([cell('c0', 0, 0, 'N')], { 'N:c0': 'SPY' }, { decorate: label })
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'widget.setOption', target: body.context.board[0].ref, args: { widget: 'c0', key: 'companyTab', value: 'news' } }]))
    expect(await say('show the news tab of the company panel')).toMatch(/no Company Info panel\. Add it from the chart’s Add to Chart menu first/)
    expect('dock' in optsOf(b, 'c0')).toBe(false)
  }, 40000)
  it.each([
    ['one op', [['c0', CP, cp('open', 'news')]]],
    ['two ops in order', [['c0', CP, cp('open')], ['c0', CP, cp(null, 'news')]]],
    ['a tab alone (it opens the panel)', [['c0', CP, cp(null, 'news')]]],
  ])('"add the company panel and open News" as %s: added AND on News, one write, one Undo', async (_n, ops) => {
    const { say, board: b } = mountOn('c0')
    p.st.envelopes.push(plan(...ops))
    const out = await say('add the company panel and open news')
    expect(out).toMatch(/Added the Company Info panel, open on News/)
    expect(dockOf(b, 'c0')).toMatchObject({ company: true, open: true, tab: 'news' })
    await say('undo')
    expect('dock' in optsOf(b, 'c0')).toBe(false)
  }, 40000)
})

describe('P8 · wording: past tense on the receipt, pending on a card; "valuation" is the Ownership tab', () => {
  it('receipt lines turn pending through PAST_TO_PENDING', () => {
    expect(pendingLine('Expanded the Company Info panel on News')).toBe('Expand the Company Info panel on News')
    expect(pendingLine('Collapsed the Company Info panel to its edge rail (it stays on the chart)')).toMatch(/^Collapse /)
    expect(pendingLine('Added the Earnings Strip under this chart')).toMatch(/^Add /)
    expect(pendingLine('Removed the Company Info panel from this chart')).toMatch(/^Remove /)
    expect(pendingLine('Switched the Company Info panel to News')).toMatch(/^Switch /)
  })
  it('"show the valuation tab": lands on Ownership, as the panel maps the old tab, and says so', async () => {
    const { say, board: b } = mountOn('c0', { c0: { ...MINE, open: true, tab: 'news' } })
    p.st.envelopes.push(plan(['c0', CP, cp(null, 'valuation')]))
    const out = await say('show the valuation tab of the company panel')
    expect(dockOf(b, 'c0').tab).toBe('ownership')
    expect(out).toMatch(/Switched the Company Info panel to Ownership \(Valuation is now the Ownership tab; valuation figures are in Overview\)/)
  }, 40000)
  it('expanding a collapsed panel on a tab, then Undo: collapsed on its old tab again', async () => {
    const { say, board: b } = mountOn('c0', { c0: MINE })
    p.st.envelopes.push(plan(['c0', CP, cp('open', 'earnings')]))
    expect(await say('open the company panel on earnings')).toMatch(/Expanded the Company Info panel on Earnings/)
    expect(dockOf(b, 'c0')).toMatchObject({ company: true, open: true, tab: 'earnings', rightW: 520 })
    await say('undo')
    expect(rawDock(b, 'c0')).toEqual(MINE)
  }, 40000)
})

describe('contract and routing', () => {
  it('the marker action is registered on the Charts surface, with exact Undo, inside the manifest limits', () => {
    expect(COMPANY_PANEL_ACTION).toBe('chartFeatures.companyPanel')
    const L = MANIFEST_CONTRACT.limits
    const mine = manifestFor({ surface: 'charts' }).filter(x => x.name.startsWith('chartFeatures.'))
    expect(mine.map(c => c.name).sort()).toEqual([CP, ES])
    for (const c of mine) {
      expect(getCapability(c.name).undo, c.name).toBe('exact')
      expect(c.summary.length, c.name).toBeLessThanOrEqual(L.maxSummary)
      expect((c.hints || '').length, c.name).toBeLessThanOrEqual(L.maxHints)
    }
  })
  it('only the product transforms write: the strip transform never touches dock.bottom', () => {
    const d = normalizeDock(null)
    expect(earningsStripDock(d, 'open')).toEqual({ ...d, strip: true })
    expect(earningsStripDock(d, 'collapse')).toBe(d)
  })
  it('its own words-only, fill-last group', () => {
    expect(GROUPS.find(x => x.id === 'chartFeatures')).toMatchObject({ wordsOnly: true, fillLast: true })
    expect(groupOfAction(CP)).toBe('chartFeatures')
    expect(groupOfAction(ES)).toBe('chartFeatures')
  })
  it.each(['add the company panel', 'show the company info on the nvda chart', 'remove the profile panel', 'hide the company panel',
    'show the earnings strip', 'add the fundamentals strip', 'take the strip under the chart off', 'switch to the financials tab',
    'open the news tab of the company panel', 'show the valuation tab'])('selected by its own words: "%s"', (t) => expect(wordsSelect('chartFeatures', t)).toBe(true))
  it.each(['when does nvda report earnings', 'show me the latest news on amd', 'what are nvda fundamentals', 'open the settings panel',
    'strip the indicators off this chart', 'add the earnings calendar widget', 'show the news tab'])('NEGATIVE: not its words: "%s"', (t) => expect(wordsSelect('chartFeatures', t)).toBe(false))
})
