// Capability ROUTING — the browser half: deterministic group selection, safe fallbacks, the
// bounded reroute, and an offline accuracy benchmark over the real-model benchmark's messages.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { registerBuiltins } from './builtins'
import { manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { selectGroups, routeManifest, groupOfAction, GROUPS } from './routing'
import { fastParse } from './fastPath'
import AgentPanel from './AgentPanel'

registerBuiltins()
const FULL = manifestFor({ surface: 'charts', createIndicator: true })   // the widest member manifest (M1: openCreate needs access)

describe('routing — selection', () => {
  it('every registered capability belongs to exactly one routing group (a new domain fails here)', () => {
    for (const c of FULL) expect(groupOfAction(c.name), c.name).not.toBe(null)
    const ids = GROUPS.map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('nothing recognised → the FULL manifest (the pre-routing behaviour), never a guess', () => {
    const r = routeManifest(FULL, 'What is a pullback, in plain words?')
    expect(r.routing).toBe(null)
    expect(r.manifest).toBe(FULL)
  })
  it('M1: an indicator word (EMA, SMA, RSI…) is recognised now — the indicators group (agreed with Indicators), the model may still just answer', () => {
    const r = routeManifest(FULL, 'What is the difference between an EMA and an SMA?')
    expect(r.routing.selected).toEqual(['indicators', 'agent'])
  })
  it('a recognised request gets its groups plus the always-on agent group, and names the rest', () => {
    const r = routeManifest(FULL, 'Rename my Growth watchlist to Leaders')
    expect(r.routing.selected).toEqual(['lists', 'agent'])
    expect(r.manifest.every(c => ['lists', 'agent'].includes(groupOfAction(c.name)))).toBe(true)
    expect(r.routing.groups.map(g => g.id)).toEqual(expect.arrayContaining(['charts', 'workspace', 'screener', 'alerts', 'data', 'settings']))
    expect(r.manifest.length).toBeLessThan(FULL.length / 2)
  })
  it('multi-intent requests select every group they touch', () => {
    const { selected } = selectGroups('Run my Momentum Screen and put the results into a new watchlist called Momentum Picks, then open the top three in charts')
    expect(selected).toEqual(expect.arrayContaining(['screener', 'lists', 'workspace']))
  })
  it('follow-ups keep the groups of a pending proposal and of the last change', () => {
    expect(selectGroups('only the first two', { pendingActions: ['watchlist.add'] }).selected).toContain('lists')
    expect(selectGroups('do the same on the right one', { recentActions: ['layout.open'] }).selected).toContain('workspace')
  })
  it('a ticker in a symbol request routes to charts (case-sensitive on the raw text)', () => {
    expect(selectGroups('put NVDA on the left chart').selected).toContain('charts')
    expect(selectGroups('Switch to AMD').selected).toContain('charts')
  })
  it('the kill switch sends the full manifest', () => {
    expect(routeManifest(FULL, 'Rename my Growth watchlist to Leaders', { enabled: false }).routing).toBe(null)
  })
  it('a reroute ADDS the requested groups', () => {
    const r = routeManifest(FULL, 'Rename my Growth watchlist to Leaders', {}, ['lists', 'agent', 'alerts'])
    expect(r.routing.selected).toEqual(['lists', 'alerts', 'agent'])
  })
})

// The real-model benchmark's messages (scratchpad b4_bench.js / Batch 5 additions) with the action
// groups their correct plans need. Routing is deterministic, so its accuracy is measured offline:
// a case PASSES when every needed group is selected (or the full manifest is sent).
const CASES = [
  ['Create a new blank layout called Momentum Desk', ['layouts']],
  ['Start a fresh layout called Swing Trading', ['layouts']],
  ['Make me an empty workspace', ['workspace']],
  ['Make a blank layout called Research and switch to it', ['layouts']],
  ['Make a copy of my Swing Layout', ['layouts']],
  ['Duplicate my Trading Layout and call it Morning Prep', ['layouts']],
  ['Delete my Old Momentum watchlist', ['lists']],
  ['Delete my Momentum watchlist', ['lists']],
  ['Clear everything from my Test Watchlist', ['lists']],
  ['Rename my Growth watchlist to Leaders', ['lists']],
  ['How many stocks are in my Breakout watchlist?', ['lists']],
  ['Duplicate my Semiconductor watchlist', ['lists']],
  ['Save this scan as High ADR Momentum', ['screener']],
  ['Duplicate my Breakout Screen', ['screener']],
  ['Rename my Earnings Scan to Earnings Movers', ['screener']],
  ['Delete my Old Test Scan', ['screener']],
  ['Delete my test scan', ['screener']],
  ['Show my saved screens', ['screener']],
  ['Run my Momentum Screen and put the results into a new watchlist called Momentum Picks', ['screener', 'lists']],
  ['Open the stocks from my Semiconductor watchlist in charts', ['lists', 'workspace']],
  ['Run my saved Breakout Screen and show me the top five stocks', ['screener']],
  ['Create a watchlist called Scan Picks from this screen and open the first three names in charts', ['lists', 'screener', 'workspace']],
  ['Delete my Main Trading layout', ['layouts']],
  ['Show me the latest NVDA news', ['data']],
  ['Switch to light mode', ['settings']],
  ['Hide the grid on the left chart and turn the crosshair off', ['charts']],
  ['Turn on earnings markers on the right chart', ['charts']],
  ['Make the watermark on the left chart more transparent', ['charts']],
  ['Can you draw trendlines for me?', ['agent']],
  ['What can you do with layouts?', ['agent']],
  ['Can you backtest a moving average crossover strategy?', ['agent']],
  ['Can you switch the left chart to weekly?', ['charts']],
  ['Apply the cream theme to the right chart', ['charts']],
  // Batch 5: arrangement + widget configuration
  ['Remove the bottom-right chart and make the remaining charts fill the space', ['workspace']],
  ['Move my watchlist to the left and make it narrower', ['workspace']],
  ['Link these two charts using the same color', ['workspace']],
  ['Save these changes to my current layout', ['layouts']],
  ['Apply this chart theme to every chart in the workspace', ['charts']],
  ['Change the watchlist widget to show my Semiconductor list', ['workspace', 'lists']],
  ['Show my Momentum Screen in the scanner widget', ['workspace']],
  ['Duplicate my Trading Layout, open the copy, and rearrange the charts', ['layouts']],
  ['Alert me if NVDA crosses 150', ['alerts']],
  ['Compare AMD and NVDA', ['data']],
]

describe('routing — offline accuracy over the benchmark messages', () => {
  const rows = CASES.map(([msg, need]) => {
    const r = routeManifest(FULL, msg, { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
    const sent = new Set(r.manifest.map(c => groupOfAction(c.name)))
    return { msg, ok: need.every(g => sent.has(g)), full: r.routing === null, caps: r.manifest.length }
  })
  it('every case gets the groups its correct plan needs (100% — a miss would cost a reroute)', () => {
    const misses = rows.filter(r => !r.ok).map(r => r.msg)
    expect(misses).toEqual([])
  })
  it('routing actually narrows: most cases send far fewer capabilities than the full manifest', () => {
    const routed = rows.filter(r => !r.full)
    const avg = routed.reduce((n, r) => n + r.caps, 0) / routed.length
    // printed for the batch report
    console.log(`[routing] ${routed.length}/${rows.length} routed; mean ${avg.toFixed(1)} of ${FULL.length} capabilities; ${rows.length - routed.length} full`)
    expect(routed.length / rows.length).toBeGreaterThan(0.75)
    expect(avg).toBeLessThan(FULL.length * 0.6)
  })
  it('deterministic commands still never reach the model (fast paths unchanged by routing)', () => {
    expect(fastParse('create a new blank layout called Momentum Desk').ops[0].action).toBe('layout.create')
    expect(fastParse('turn off the grid').ops[0].action).toBe('chart.setSetting')
    expect(fastParse('Can you backtest this strategy?').ops[0]).toEqual({ action: 'agent.capabilities', args: { topic: 'backtest' } })
  })
})

// ── the panel: the bounded reroute ──
function makeHost() {
  const st = { stored: null, tf: 'D', symbol: 'SPY' }
  const read = (ref) => (ref === 'w1' ? { ref, label: 'Chart (SPY)', symbol: st.symbol, tf: st.tf, stored: st.stored, cs: mergeChartSettings(st.stored || {}), linkedCount: 0 } : null)
  return {
    commits: [], charts: { list: () => [read('w1')], read, commit(ref, patch) { this.n = (this.n || 0) + 1; if ('settings' in patch) st.stored = patch.settings; if ('tf' in patch) st.tf = patch.tf; return true } },
    otherWidgets: () => [], raw: () => st,
  }
}
let turns, bodies
beforeEach(() => {
  turns = []; bodies = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { bodies.push(body); return json({ conversationId: 'ac_1', turnId: 1, envelope: turns.shift(), usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
})
afterEach(() => { vi.restoreAllMocks() })
const env = (disposition, ops = [], extra = {}) => ({ disposition, reply: '', question: null, ops, unsupported_category: null, ...extra })
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('routing — the bounded reroute in the panel', () => {
  it('need_groups → ONE more call with those groups added (marked reroute); the plan then runs once', async () => {
    const host = makeHost()
    turns.push(env('clarify', [], { need_groups: ['charts'], question: { text: 'Looking at more of UCT…', choices: [] } }))
    turns.push(env('apply', [{ action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'W' } }]))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('Rename my Growth watchlist to Leaders')
    await screen.findByText(/Switched timeframe to Weekly/)
    expect(bodies).toHaveLength(2)
    expect(bodies[0].routing.selected).not.toContain('charts')
    expect(bodies[1].reroute).toBe(true)
    expect(bodies[1].routing.selected).toContain('charts')
    expect(bodies[1].capabilities.some(c => c.name === 'chart.setTimeframe')).toBe(true)
    expect(host.raw().tf).toBe('W')
    expect(screen.queryByText(/Looking at more of UCT/)).toBe(null)        // plumbing is never shown
  })
  it('a second need_groups is NOT chased again — one bounded retry, then an honest sentence', async () => {
    const host = makeHost()
    turns.push(env('clarify', [], { need_groups: ['alerts'] }))
    turns.push(env('clarify', [], { need_groups: ['data'] }))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('Rename my Growth watchlist to Leaders')
    await screen.findByText(/more of UCT than I can plan in one step/)
    expect(bodies).toHaveLength(2)
    expect(host.charts.n || 0).toBe(0)
  })
})

describe('release audit: every registered action is reachable through routing', () => {
  it('each group can be sent (by its words or a reroute) within the per-request limit, and the groups cover the whole catalog', () => {
    const covered = new Set()
    for (const g of GROUPS) {
      const r = routeManifest(FULL, 'zzz unrelated', { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }, [g.id])
      const names = r.manifest.map(c => c.name)
      const mine = FULL.filter(c => groupOfAction(c.name) === g.id).map(c => c.name)
      expect(mine.every(n => names.includes(n)), g.id).toBe(true)
      expect(r.manifest.length).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxCapabilities)
      for (const n of mine) covered.add(n)
    }
    expect(FULL.filter(c => !covered.has(c.name)).map(c => c.name)).toEqual([])
    expect(FULL.length).toBe(184)             // compare.openView (the Compare panel's Rotation / Overlay view, onto a1015528d3): master 183 + compare.openView = 184. #1106 re-merge onto 4d6c43659c (after every other Charts family): master 181 + chartMenu.askAi, chartMenu.resetWatermark = 183. #1104 re-merge onto 3f13cc4435 (after #1074, #1030, #1076, #1070, #1082, #1110): master 180 + chartSetup.zoom = 181. #1110 re-merge onto e0b3fd7be7 (after #1074, #1030, #1076, #1070, #1082): master 177 + drawing.positionCalculator, drawing.saveDefaults, drawing.favoriteTool = 180. #1082 re-merge onto c0e2581780 (after #1074 + #1030 + #1076 + #1070): master 175 + periodSort.run, periodSort.dock = 177. #1070 re-merge onto 2dbfe20852 (after #1074 + #1030 + #1076): master 171 + 4 Drawing Boards (drawing.setActiveBoard/createBoard/renameBoard/deleteBoard) = 175. #1076 re-merge onto d5f3f9bf6e (after #1074 + #1030): master 169 + drawing.duplicate, drawing.setPositionAlerts = 171. #1030 re-merge onto 8dba68b056 (after #1074): master 167 + multiChart.set, multiChart.cell = 169. #1074 re-merge onto 64421f770d: master 164 + #1074 3 (layout.pinToBar/unpinFromBar/moveOnBar, C3-037..039; #1074 base 157 -> 160) = 167. #1073 re-merge onto 9d5e0847b8: master 163 (unchanged by #1084 / #1085) + chartSetup.compareGroup = 164. #1073 re-merge onto a15b666119: master 163 + chartSetup.compareGroup (C1-035/037/040) = 164. re-merge onto 24a4b8350b: master 160 + #1027 3 (watchlist.showList own words-only group, watchlist.exportList, watchlist.arrangeColumns) = 163. pl-exec4 (#1077): + chartSetup.stepBars/autoScale. C1-127: + chartSetup.openSettings. Agent Phase 1: + indicatorAlert.list, + 4 indicatorTemplate (list/apply/save/delete), + chartSetup.setRange/resetView/setIndicatorsHidden/setMovingAverages, + watchlist.sortColumn/setColumns/step/readView/setFlag/keepOnly, + drawing.add/setAnchors/setProps/setFibLevels/setAlert. hotfix 2026-11-03: + agent.undo. W1-B (2026-11-02): + widget.setOption, + chart.replay, + 3 indicatorAlert (create/toggle/delete), + 7 anchored drawing tools (addTrendline/Ray/HorizontalRay/Rectangle/Fib/Text/Avwap). Phase 3: + board.swap, board.duplicateChart. Phase 2 guide: + guide.explain, guide.show. live test 2026-10-28: + chartGrid.set. Indicators P2: + indicatorStyle.set/placeIn, pane.move/resize, indicatorCopy.duplicate/copyTo, definition.search/describe/duplicate/delete. Charts operator P1: + 6 chartSetup, + 5 drawing, + widget.addTab, + watchlist.reorder/setNote, + indicator.discardDraft. Gate C: + indicator.update. Phase 1: + watchlist.open; MI breadth slice 1: + breadth.show; breadth intelligence: + breadth.history
    // M2: + indicator.add / remove / show / hide; M3: + draft / previewDraft / saveDraft / undoDraft
  })
})

// Lead 2026-11-09: a WORDS-ONLY group (a niche action: what one Watchlist widget shows) is sent only when the words name it. It
// never fills a message nothing recognised, nor a knowledge-only one, so adding one never displaces what those requests pack.
describe('words-only groups never fill an unrecognised or knowledge-only request', () => {
  const opts = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
  const wordsOnly = GROUPS.filter(g => g.wordsOnly)
  const sentOf = (msg, extra = []) => new Set(routeManifest(FULL, msg, opts, extra).manifest.map(c => groupOfAction(c.name)))
  it('the flag is declared (the Watchlist widget\'s list group)', () => {
    expect(wordsOnly.map(g => g.id)).toContain('watchlistShow')
  })
  it.each(['zzz unrelated', 'scratch that', 'what is an EP setup', 'how does the team think about patience', 'go back to how it was before', 'hmm'])
  ('"%s": no words-only group is in the request', (msg) => {
    const sent = sentOf(msg)
    for (const g of wordsOnly) expect(sent.has(g.id), `${g.id} for "${msg}"`).toBe(false)
  })
  it('named by its own words, or asked for by a reroute, it is sent', () => {
    expect(sentOf('put my flagged list in the watchlist widget').has('watchlistShow')).toBe(true)
    expect(sentOf('zzz unrelated', ['watchlistShow']).has('watchlistShow')).toBe(true)
  })
})
