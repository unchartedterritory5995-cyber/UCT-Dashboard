// Charts family: boardDetach.* (marker: the action ids 'boardDetach.float' / 'boardDetach.dock' / 'boardDetach.intoTabs' /
// 'boardDetach.setMerged') through the REAL panel on the fixture board, the model scripted (no paid call), plus the member's
// own obvious words on the fast path. What the in-canvas float's own handlers (handleFloatWidget / handleDockFloatWidget),
// its "Move into tabs" (handleFloatWidgetToTab → widgetTabs.moveIntoTabs) and the Merge widgets toggle (charts_merged) do,
// read back, with exact Undo. The fixture's `detach` source plays ChartsWorkspace's floating / popped / merged state.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { wordsSelect, groupOfAction, GROUPS } from './routing'
import { pendingLine } from './proposalWording'
import { fastParse } from './fastPath'
import { moveIntoTabs, addWidgetTab } from '../pages/charts/widgetTabs'
import { BOARD_DETACH_ACTIONS, OWN_TABS, ON_PHONE, IN_GRID } from './capabilities/boardDetach'
import { stateEffects, stateRailRefusal } from './stateRail'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const [FLOAT, DOCK, TABS, MERGED] = BOARD_DETACH_ACTIONS
// 2×2: c0 TL chart (SPY, group N), c1 TR chart (NVDA, group N), news BL, wl BR (a Watchlist)
const board = (extra = {}) => [
  { id: 'c0', type: 'chart', x: 0, y: 0, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } },
  { id: 'c1', type: 'chart', x: 12, y: 0, w: 12, h: 10, color: 'N', opts: { settings: { ...bareSettings(), logScale: true } } },
  { id: 'news', type: 'news', x: 0, y: 10, w: 12, h: 10, color: 'A', opts: {}, ...(extra.news || {}) },
  { id: 'wl', type: 'watchlist', x: 12, y: 10, w: 12, h: 10, color: 'A', opts: { watchName: 'Momentum' }, ...(extra.wl || {}) },
]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'NVDA', A: 'AAPL' }
function mountOn(detach = {}, extra = {}) {
  return p.mount(board(extra), SYMS, { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }), geometry: { detach } })
}
const plan = (...ops) => (body) => p.env('apply', ops.map(([action, args]) => ({ action, target: body.context.board[0].ref, args })))
const propose = (...ops) => (body) => p.env('propose', ops.map(([action, args]) => ({ action, target: body.context.board[0].ref, args })))
const undoButton = () => screen.queryByRole('button', { name: 'Undo' })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const widgetsJson = (b) => JSON.stringify(b.state.widgets)
// the board kind's Undo writes an absent field back as null (applyBoard merges a set): compare with those nulls dropped
const norm = (ws) => JSON.parse(JSON.stringify(ws, (k, v) => (v === null ? undefined : v)))
// a new tab's id is random (widgetTabs._newTabId): compare with it blanked
const noTabIds = (ws) => JSON.parse(JSON.stringify(ws, (k, v) => (k === 'id' && typeof v === 'string' && v.startsWith('wt') ? '·' : v)))
const apply = async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)); await p.idle(); await new Promise(r => setTimeout(r, 0)); await p.idle() }

describe('float / dock — the in-canvas float\'s own handlers, read back, exact Undo', () => {
  it.each(['float the news widget', 'float my news panel', 'detach the news widget'])('"%s" (fast path): floats; the receipt says "floating until reload"; Undo docks it', async (t) => {
    const { say, board: b } = mountOn()
    const was = widgetsJson(b)
    const out = await say(t)
    expect(out).toMatch(/Floated the News .* over the board \(floating until reload — a reload docks it; its spot on the board is kept, so Dock puts it back\)/)
    expect(p.turns()).toBe(0)
    expect(b.state.detach.floating).toEqual(['news'])
    expect(widgetsJson(b)).toBe(was)                                   // the board itself never changes: the slot is kept
    await say('undo')
    expect(b.state.detach.floating).toEqual([])
    expect(b.state.detach.calls).toEqual([['float', 'news'], ['dock', 'news']])
  }, 40000)
  it('"dock the news widget back": docks; the receipt says the dragged position is not restored by Undo; Undo floats it again', async () => {
    const { say, board: b } = mountOn({ floating: ['news'] })
    expect(await say('dock the news widget back')).toMatch(/Docked the News .* back into its spot on the board \(Undo floats it again — the panel's dragged position isn't restored\)/)
    expect(b.state.detach.floating).toEqual([])
    await say('undo')
    expect(b.state.detach.floating).toEqual(['news'])
  }, 40000)
  it('"dock everything": every floating widget, ONE Undo floats them all again', async () => {
    const { say, board: b } = mountOn({ floating: ['news', 'wl'] })
    expect(await say('dock everything')).toMatch(/Docked the News .* and the Watchlist .* back into their spots/)
    expect(b.state.detach.floating).toEqual([])
    await say('undo')
    expect([...b.state.detach.floating].sort()).toEqual(['news', 'wl'])
  }, 40000)
  it('a float the workspace did not take is never a success (read-back): nothing claimed, no Undo', async () => {
    const { say, board: b, h } = mountOn()
    h.detach.float = () => true                                          // "accepted", but nothing floats
    expect(await say('float the news widget')).not.toMatch(/Floated/)
    expect(b.state.detach.floating).toEqual([])
    expect(undoButton()).toBeNull()
  }, 40000)
  it.each([
    [FLOAT, { floating: ['news'] }, /The News .* is already floating/],
    [DOCK, {}, /The News .* is already on the board/],
  ])('no-op %s: an honest receipt, no write, no Undo', async (action, detach, re) => {
    const { say, board: b } = mountOn(detach)
    p.st.envelopes.push(plan([action, { widget: 'news' }]))
    expect(await say('do that to the news one please')).toMatch(re)
    expect(b.state.detach.calls || []).toEqual([])
    expect(undoButton()).toBeNull()
  }, 40000)
  it('a popped-out widget is never floated', async () => {
    const { say, board: b } = mountOn({ popped: ['wl'] })
    p.st.envelopes.push(plan([FLOAT, { widget: 'wl' }]))
    expect(await say('float that one')).toMatch(/popped out into its own window/)
    expect(b.state.detach.floating).toEqual([])
  }, 40000)
})

describe('intoTabs — the SAME transform as the handler, always a card, exact Undo', () => {
  it('a card first; applied, the board EQUALS moveIntoTabs on it (the handler\'s result); Undo restores both widgets', async () => {
    const { say, board: b } = mountOn()
    const before = JSON.parse(widgetsJson(b))
    p.st.envelopes.push(propose([TABS, { widget: 'news', into: 'wl' }]))
    await say('move the news widget into the watchlist tabs')
    expect(screen.getAllByTestId('agent-proposal').at(-1).textContent).toMatch(/Move the News .* into the Watchlist .*’s tabs — its spot on the board is now empty/)
    expect(widgetsJson(b)).toBe(JSON.stringify(before))                 // nothing before Apply
    await apply()
    expect(transcript()).toMatch(/Moved the News .* into the Watchlist .*’s tabs — its spot on the board is now empty/)
    expect(noTabIds(b.state.widgets)).toEqual(noTabIds(moveIntoTabs(before, 'news', 'wl')))
    expect(b.state.boardWrites).toBe(1)                                  // ONE board write
    await say('undo')
    expect(norm(b.state.widgets).sort((x, y) => x.id.localeCompare(y.id))).toEqual(norm(before).sort((x, y) => x.id.localeCompare(y.id)))
  }, 40000)
  it('a CHART moved into tabs keeps its settings byte-identical inside the new tab (the chart rail)', async () => {
    const { say, board: b } = mountOn()
    const settings = JSON.stringify(b.state.widgets.find(w => w.id === 'c1').opts)
    p.st.envelopes.push(plan([TABS, { widget: 'c1', into: 'c0' }]))
    await say('move the NVDA chart into the SPY chart’s tabs')
    await apply()
    const host = b.state.widgets.find(w => w.id === 'c0')
    expect(b.state.widgets.some(w => w.id === 'c1')).toBe(false)
    expect(JSON.stringify(host.wtabs.at(-1).opts)).toBe(settings)
  }, 40000)
  it('a FLOATING source is docked first (as the handler clears its float) and Undo floats it back', async () => {
    const m = mountOn({ floating: ['news'] }); const { say, board: b } = m
    p.st.envelopes.push(plan([TABS, { widget: 'news', into: 'wl' }]))
    await say('move the floating news widget into the watchlist tabs')
    await apply()
    expect(b.state.detach.floating).toEqual([])
    expect(b.state.widgets.some(w => w.id === 'news')).toBe(false)
    await say('undo')
    expect(b.state.widgets.some(w => w.id === 'news')).toBe(true)
    expect(b.state.detach.floating).toEqual(['news'])
  }, 40000)
  it.each([
    ['a source with its OWN tabs (they would be lost)', { news: addWidgetTab({ id: 'news', type: 'news' }, { type: 'calendar' }) }, ['news', 'wl'], {}, new RegExp(OWN_TABS.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
    ['itself', {}, ['news', 'news'], {}, /can’t move into its own tabs/],
    ['a floating target', {}, ['news', 'wl'], { floating: ['wl'] }, /floating or popped out — dock it first/],
  ])('refused: %s — nothing written', async (_n, extra, [src, into], detach, re) => {
    const { say, board: b } = mountOn(detach, extra)
    const was = widgetsJson(b)
    p.st.envelopes.push(plan([TABS, { widget: src, into }]))
    expect(await say('move it into the other tabs')).toMatch(re)
    expect(widgetsJson(b)).toBe(was)
  }, 40000)
  // ⛔ AUDIT T2 (#1304): its OWN words, structurally (the routing group's into-tabs pattern) — never a modify verb alone
  it.each(['move the news widget to the right', 'move the news widget over a bit', 'make the news widget bigger'])('"%s" with a model plan of intoTabs: refused by the askedBy gate, nothing written, no card', async (t) => {
    const { say, board: b } = mountOn()
    const was = widgetsJson(b)
    p.st.envelopes.push(propose([TABS, { widget: 'news', into: 'wl' }]))
    expect(await say(t)).toMatch(/a widget moves into another widget’s tabs only when you ask for exactly that/)
    expect(widgetsJson(b)).toBe(was)
    expect(screen.queryAllByTestId('agent-proposal').filter(e => e.getAttribute('data-status') === 'pending')).toHaveLength(0)
  }, 40000)
  it('"move the news widget into the chart’s tabs": still a card, as before', async () => {
    const { say, board: b } = mountOn()
    const was = widgetsJson(b)
    p.st.envelopes.push(propose([TABS, { widget: 'news', into: 'c0' }]))
    await say('move the news widget into the chart’s tabs')
    expect(screen.getAllByTestId('agent-proposal').at(-1).textContent).toMatch(/Move the News .* into the Chart .*’s tabs/)
    expect(widgetsJson(b)).toBe(was)
  }, 40000)
  it('the receipt sentence for own tabs is the AUDIT wording', () => {
    expect(OWN_TABS).toMatch(/its own tabs, and moving it into another widget’s tabs would lose them\. Move its tabs first, or dock it/)
  })
})

describe('setMerged — the Merge widgets toggle\'s own key, on every layout, exact Undo', () => {
  it.each([['merge the board', true, 'Merged the board’s widgets (no gaps between them) — on every layout'], ['unmerge the widgets', false, 'Unmerged the board’s widgets (gaps between them again) — on every layout']])(
    '"%s" (fast path): writes charts_merged, read back, names the scope; Undo puts it back', async (t, want, line) => {
      const { say, board: b } = mountOn({ merged: !want })
      expect(await say(t)).toContain(line)
      expect(b.state.detach.prefWrites).toEqual([['charts_merged', JSON.stringify(want)]])
      expect(b.state.detach.merged).toBe(want)
      await say('undo')
      expect(b.state.detach.merged).toBe(!want)
      expect(b.state.detach.prefWrites.at(-1)).toEqual(['charts_merged', JSON.stringify(!want)])
    }, 40000)
  it('already merged: honest no-op, no write, no Undo', async () => {
    const { say, board: b } = mountOn({ merged: true })
    expect(await say('merge the board')).toMatch(/already merged/)
    expect(b.state.detach.prefWrites || []).toEqual([])
    expect(undoButton()).toBeNull()
  }, 40000)
  it('a server that refuses the pref: nothing claimed', async () => {
    const { say, board: b } = mountOn({ failPref: true })
    expect(await say('merge the board')).not.toMatch(/Merged the board/)
    expect(b.state.detach.merged).toBe(false)
  }, 40000)
  it.each(['could i get some more news on my board somewhere', 'i would like another chart please', 'put one more watchlist up for me'])('NEVER from additive words alone: "%s" with a model plan of setMerged is refused, nothing written', async (t) => {
    const { say, board: b } = mountOn()
    p.st.envelopes.push(plan([MERGED, { merged: true }]))
    expect(await say(t)).toMatch(/merged view changes only when you ask for it/)
    expect(b.state.detach.merged).toBe(false)
    expect(b.state.detach.prefWrites || []).toEqual([])
  }, 40000)
  it.each(['add a news widget', 'add another chart', 'put a watchlist on the board', 'add a news tab'])('routing: additive "%s" never selects the boardDetach words, never a fast setMerged', (t) => {
    expect(wordsSelect('boardDetach', t)).toBe(false)
    expect((fastParse(t)?.ops || []).some(o => o.action === MERGED)).toBe(false)
  })
})

describe('the phone view and Multi Chart: nothing floats or merges there', () => {
  it.each([[FLOAT, { widget: 'news' }], [DOCK, { widget: null }], [TABS, { widget: 'news', into: 'wl' }], [MERGED, { merged: true }]])('%s on the phone view: refused, nothing written', async (action, args) => {
    const { say, board: b } = mountOn({ mobile: true, floating: action === DOCK ? ['news'] : [] })
    const was = widgetsJson(b)
    p.st.envelopes.push(plan([action, args]))
    // (intoTabs needs its own words — the askedBy gate — so the phone refusal is reached with them)
    expect(await say(action === TABS ? 'move the news widget into the watchlist tabs' : 'do that to the board please, merge it')).toContain(ON_PHONE.slice(0, 40))
    expect(widgetsJson(b)).toBe(was)
    expect(b.state.detach.calls || []).toEqual([])
    expect(b.state.detach.prefWrites || []).toEqual([])
  }, 40000)
  it.each([[FLOAT, { widget: 'news' }], [MERGED, { merged: true }]])('%s in Multi Chart: refused, nothing written', async (action, args) => {
    const { say, board: b } = mountOn({ gridMode: true })
    p.st.envelopes.push(plan([action, args]))
    expect(await say('float it and merge the board')).toContain(IN_GRID.slice(0, 40))
    expect(b.state.detach.calls || []).toEqual([])
    expect(b.state.detach.prefWrites || []).toEqual([])
  }, 40000)
})

describe('the detached-widget rule stays: arranging waits while a widget floats', () => {
  it.each([['widget.arrange', { pattern: 'fill' }], ['widget.move', { widget: 'wl', x: 0, y: 0, w: null, h: null }]])('%s while the news widget floats (this family floated it): refused, nothing moves', async (action, args) => {
    const { say, board: b } = mountOn()
    await say('float the news widget')
    expect(b.state.detach.floating).toEqual(['news'])
    const was = widgetsJson(b)
    p.st.envelopes.push(plan([action, args]))
    expect(await say('tidy up the board layout for me')).toMatch(/floating or popped out right now — dock it back first/)
    expect(widgetsJson(b)).toBe(was)
  }, 40000)
})

describe('targeting: an excluded chart is never touched', () => {
  it.each([['float every chart except the NVDA one'], ['float all the charts but leave NVDA alone']])('"%s": a plan that also floats NVDA\'s chart never floats it', async (t) => {
    const { say, board: b } = mountOn()
    p.st.envelopes.push(plan([FLOAT, { widget: 'c0' }], [FLOAT, { widget: 'c1' }]))
    await say(t)
    expect(b.state.detach.floating, transcript()).not.toContain('c1')
  }, 40000)
})

describe('the STATE RAIL (#1247): intoTabs is a destroy of a grid widget, setMerged an every-layout setting — never from additive words', () => {
  const W0 = [{ id: 'news', type: 'news', x: 0, y: 0, w: 12, h: 10, color: 'A', opts: {} }, { id: 'wl', type: 'watchlist', x: 12, y: 0, w: 12, h: 10, color: 'A', opts: { watchName: 'Momentum' } }]
  const intoPlan = () => {
    const after = moveIntoTabs(W0, 'news', 'wl', { tabId: 'wtmnews' })
    const t = after.find(w => w.id === 'wl')
    return { ok: true, plans: [{ kind: 'board', ref: 'board', before: { board: W0 }, after: { board: after }, patch: { remove: ['news'], set: { wl: { wtabs: t.wtabs, activeWtab: t.activeWtab } } } }] }
  }
  const mergedPlan = () => ({ ok: true, plans: [{ kind: 'board', ref: 'board', before: { board: W0 }, after: { board: W0 }, patch: { viewDo: { merged: true } } }] })
  it('both are read as destroying effects (overwrite) by stateEffects', () => {
    expect(stateEffects(intoPlan()).map(e => `${e.state}:${e.type}`)).toEqual(['widget:overwrite'])
    expect(stateEffects(mergedPlan()).map(e => `${e.state}:${e.type}`)).toEqual(['widget:overwrite'])
  })
  it.each(['add a news widget', 'could i get some more news on my board somewhere', 'add another chart', 'put a watchlist on the board too'])('additive "%s": BOTH refused by the state rail alone (independent of askedBy)', (w) => {
    expect(stateRailRefusal(intoPlan(), { words: w })).toMatch(/^I didn’t change anything: you asked to add/)
    expect(stateRailRefusal(mergedPlan(), { words: w })).toMatch(/^I didn’t change anything: you asked to add/)
  })
  it.each([['move the news widget into the watchlist tabs', 'into'], ['merge the board', 'merged'], ['unmerge the widgets', 'merged'], ['add the news widget into the watchlist tabs', 'into']])(
    'its own words "%s" license it', (w, which) => {
      expect(stateRailRefusal(which === 'into' ? intoPlan() : mergedPlan(), { words: w })).toBeNull()
    })
  it('the merge words never license the move (the rail is kind-matched: within the widget class a modify verb licenses both — the merged view’s own words are then askedBy’s)', () => {
    expect(stateRailRefusal(intoPlan(), { words: 'merge the board' })).toBeTruthy()
  })
  it('through the panel: additive words + a model plan of intoTabs → refused, nothing written, no card', async () => {
    const { say, board: b } = mountOn()
    const was = widgetsJson(b)
    p.st.envelopes.push(propose([TABS, { widget: 'news', into: 'wl' }]))
    // (refused first by intoTabs' askedBy gate since AUDIT T2; the state rail alone refuses it too — the unit rails above)
    expect(await say('could i get some more news on my board somewhere')).toMatch(/^.*I didn’t change anything/)
    expect(widgetsJson(b)).toBe(was)
    expect(screen.queryAllByTestId('agent-proposal').filter(e => e.getAttribute('data-status') === 'pending')).toHaveLength(0)
  }, 40000)
})

describe('contract, routing and wording', () => {
  it('the four markers are registered on the Charts surface, exact Undo, inside the manifest limits; intoTabs is a card', () => {
    const L = MANIFEST_CONTRACT.limits
    const mine = manifestFor({ surface: 'charts' }).filter(x => x.name.startsWith('boardDetach.'))
    expect(mine.map(c => c.name).sort()).toEqual([...BOARD_DETACH_ACTIONS].sort())
    for (const c of mine) {
      expect(getCapability(c.name).undo, c.name).toBe('exact')
      expect(c.summary.length, c.name).toBeLessThanOrEqual(L.maxSummary)
      expect((c.hints || '').length, c.name).toBeLessThanOrEqual(L.maxHints)
    }
    expect(getCapability(TABS).risk).toBe('confirm')
    expect(manifestFor({ surface: 'screener' }).some(x => x.name.startsWith('boardDetach.'))).toBe(false)
  })
  it('its own words-only, fill-last group', () => {
    expect(GROUPS.find(x => x.id === 'boardDetach')).toMatchObject({ wordsOnly: true, fillLast: true })
    for (const a of BOARD_DETACH_ACTIONS) expect(groupOfAction(a)).toBe('boardDetach')
  })
  it.each(['float the news widget', 'float my watchlist panel', 'dock it back', 'dock all the floating widgets', 'dock the news widget',
    'move the news widget into the chart’s tabs', 'put the watchlist into the news tabs', 'merge the board', 'unmerge the widgets', 'turn off the merged view'])(
    'selected by its own words: "%s"', (t) => expect(wordsSelect('boardDetach', t)).toBe(true))
  it.each(['show me low float stocks', 'what is the float of NVDA', 'float of tsla', 'dock the ranking', 'dock the period sort as a widget', 'add a news tab',
    'merge my layouts', 'remove the volume pane', 'move the news widget to the left', 'stocks with a small float'])('NEGATIVE: not its words: "%s"', (t) => expect(wordsSelect('boardDetach', t)).toBe(false))
  it('receipts turn pending through PAST_TO_PENDING', () => {
    expect(pendingLine('Floated the News (bottom left) over the board')).toMatch(/^Float /)
    expect(pendingLine('Docked the News back into its spot')).toMatch(/^Dock /)
    expect(pendingLine('Merged the board’s widgets (no gaps between them) — on every layout')).toMatch(/^Merge /)
    expect(pendingLine('Unmerged the board’s widgets')).toMatch(/^Unmerge /)
    expect(pendingLine('Moved the News into the Watchlist’s tabs')).toMatch(/^Move /)
  })
})
