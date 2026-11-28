// PRODUCTION'S EXACT UCT_AGENT_DATA_KINDS (web), as armed on 2026-11-24 by the integrator under the owner's delegation of
// 2026-11-24 ("you decide it all and get it all done"): the 11 kinds production served since 2026-11-03, plus
// cot.positioning and history.eventStudy (not model-isolated), plus every model-isolated kind of terminal data waves
// 1-13 except the excluded ones; each isolated one is ALSO named in UCT_AGENT_ISOLATED_KINDS (D9: one entry per kind;
// ADR-005 strict isolation unchanged). Generated from the code (kinds.py's isolated set minus the exclusions), never by
// hand. Railway values: docs/agent/program/RESUME.md. The server half: tests/test_uct_agent_data_kinds_allowlist.py.
// Pins which server-gated capabilities register with it: history.afterEvent YES (history.eventStudy is listed); research.ask
// NO (research.company stays dark). EXCLUDED kinds stay dark, each reason in docs/feature_flags.json
// knobs.UCT_AGENT_ISOLATED_KINDS: third-party text (earnings.callSearch, earnings.callThemes, fed.watch, catalysts.board),
// a vendor call on the Agent's path (leaders.longRun), not isolated over Massive figures (sectors.performance), no
// licensed source (index / commodity / crypto quotes), a paid web search (research.company), owner HOLD (knowledge kinds).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import handshake from './__fixtures__/program/isolation.json'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import './terminalWaves'  // the Terminal data waves: registerServerGatedBuiltins() runs them only once this module has loaded (terminalWavesHook.js)
import { allCapabilityNames, manifestFor } from './capabilities'
import { loadAgentConfig, _resetAgentConfig, serverDataKinds } from './agentClient'
import { match as describeMatch } from './capabilities/chartDescribe'
import { match as afterEventMatch } from './capabilities/history'
import { match as researchMatch } from './capabilities/research'

export const PROD_KINDS = ['instrument.resolve', 'quote', 'quotes', 'bars.daily', 'fundamentals', 'earnings',
  'news.company', 'themes', 'screen.run', 'screen.count', 'screen.saved', 'cot.positioning', 'history.eventStudy',
  'breadth.current', 'ratings', 'rs.leadership', 'analyst.actions', 'highsLows.session', 'levels.darkpool',
  'highsLows.yearly', 'themes.rotation', 'confluence.board', 'earnings.expectedMove', 'levels.gamma',
  'flow.topPicks', 'flow.record', 'earnings.reactions', 'earnings.season', 'group.drill', 'short.interest',
  'short.list', 'seasonality.stock', 'seasonality.board', 'options.tideHistory', 'options.oiChange',
  'rates.treasury', 'market.regime', 'stock.setups', 'stock.eventsTimeline', 'uct20.list', 'options.ivHistory',
  'dilution.watch', 'stock.corporateActions', 'calendar.ipos', 'calendar.dividends', 'rates.auctions',
  'rates.realYields', 'stock.stats', 'stock.volumeFootprint', 'stock.factorExposure', 'stock.setupHistory',
  'company.publicRecords', 'ownership.funds', 'groups.rank', 'groups.crowding', 'earnings.seasonBySector',
  'estimates.revisionBreadth', 'options.ivRankLeaders', 'ipo.lockups', 'cot.byTrader', 'estimates.history',
  'analyst.ratings', 'company.segments', 'stock.failsToDeliver', 'company.deals', 'insider.market', 'market.history',
  'econ.latest', 'market.liquidity', 'market.oil', 'market.analogs']

// kept dark (never in PROD_KINDS); reasons: docs/feature_flags.json knobs.UCT_AGENT_ISOLATED_KINDS
const EXCLUDED = ['earnings.callSearch', 'earnings.callThemes', 'fed.watch', 'catalysts.board', 'sectors.performance', 'index.quote',
  'commodity.quote', 'crypto.quote', 'research.company', 'knowledge.search', 'setup.playbook', 'setup.record',
  'leaders.longRun']
// what only the excluded kinds register (stays unregistered with PROD_KINDS)
const DARK_ONLY = ['news.movers', 'playbook.explain', 'playbook.record', 'playbook.setup', 'research.ask', 'stock.callSearch',
  'stock.callThemes', 'stock.fomcWatch', 'stock.longRunLeaders', 'stock.sectorPerformance']
const ISOLATED_SERVED = 58

registerBuiltins()
const UNGATED = new Set(allCapabilityNames())

function wire(cfg) {
  globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('/api/agent/config') ? cfg : {}),
    { status: String(url).endsWith('/api/agent/config') ? 200 : 404, headers: { 'content-type': 'application/json' } }))
}

describe("production's data kinds (armed 2026-11-24)", () => {
  beforeEach(() => { _resetAgentConfig() })

  it('registers exactly the intended server-gated capabilities: describeSetup and afterEvent yes, research.ask no', async () => {
    wire({ stream: false, nl1: false, data: true, scan: false, data_kinds: PROD_KINDS })
    await loadAgentConfig()
    expect(serverDataKinds()).toEqual(PROD_KINDS)
    registerServerGatedBuiltins()
    const gated = allCapabilityNames().filter(n => !UNGATED.has(n)).sort()
    expect(gated).toEqual(GATED_EXPECTED)
    expect(gated).toContain('chart.describeSetup')
    expect(gated).toContain('stock.dailyBars')
    expect(gated).toContain('history.afterEvent')
    expect(gated).toContain('cot.positioning')
    for (const n of DARK_ONLY) expect(gated, n).not.toContain(n)
    expect(describeMatch('describe this setup')).not.toBeNull()
    expect(afterEventMatch('how has NVDA behaved after 5%+ gaps?')).not.toBeNull()
    expect(researchMatch('why is NVDA down today')).toBeNull()
    const manifest = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true }).map(c => c.name)
    expect(manifest).toContain('chart.describeSetup')
    expect(manifest).toContain('history.afterEvent')
    expect(manifest).not.toContain('research.ask')
  })

  it('every EXCLUDED kind stays dark; the isolated kinds served are named one by one (D9) and all are isolated', () => {
    expect(handshake.isolated_kinds.length).toBeGreaterThan(0)
    for (const k of EXCLUDED) expect(PROD_KINDS, k).not.toContain(k)
    expect(new Set(PROD_KINDS).size).toBe(PROD_KINDS.length)
    const served = PROD_KINDS.filter(k => handshake.isolated_kinds.includes(k))
    expect(served.length).toBe(ISOLATED_SERVED)
    // the excluded isolated kinds are real isolated kinds (a typo here would make the "stays dark" check vacuous)
    for (const k of ['earnings.callSearch', 'earnings.callThemes', 'fed.watch', 'catalysts.board', 'leaders.longRun']) {
      expect(handshake.isolated_kinds, k).toContain(k)
    }
  })

  it('CONTROL: the research.ask phrase IS claimed once research.company is served (the "no" above is the gate)', async () => {
    wire({ stream: false, nl1: false, data: true, scan: false, data_kinds: [...PROD_KINDS, 'research.company'] })
    await loadAgentConfig()
    expect(researchMatch('why is NVDA down today')).not.toBeNull()
  })
})

const GATED_EXPECTED = ['chart.describeSetup', 'cot.positioning', 'history.afterEvent', 'rs.compare',
  'stock.analystActions', 'stock.auctionCalendar', 'stock.companyDeals', 'stock.companyRecord',
  'stock.confluenceBoard', 'stock.consensusRating', 'stock.dailyBars', 'stock.darkPoolLevels', 'stock.daysLikeToday',
  'stock.dilutionWatch', 'stock.dividendsCalendar', 'stock.earningsReactions', 'stock.earningsSeason',
  'stock.economyBoard', 'stock.estimatesBreadth', 'stock.estimatesHistory', 'stock.eventsTimeline',
  'stock.expectedMove', 'stock.factorExposure', 'stock.failsToDeliver', 'stock.flowRecord', 'stock.gammaLevels',
  'stock.groupDrill', 'stock.groupOwnership', 'stock.groupRank', 'stock.insiderBuying', 'stock.ipoCalendar',
  'stock.ipoUnlock', 'stock.ivHistory', 'stock.ivRankLeaders', 'stock.liquidityBoard', 'stock.marketHistory',
  'stock.marketRegime', 'stock.oiChange', 'stock.oilReport', 'stock.ownershipReport', 'stock.positionTypes',
  'stock.quote', 'stock.realCurve', 'stock.revenueSplit', 'stock.riskProfile', 'stock.seasonality',
  'stock.seasonalityBoard', 'stock.sectorEarnings', 'stock.sessionHighsLows', 'stock.setupHistory', 'stock.setups',
  'stock.shortInterest', 'stock.shortList', 'stock.splitsDividends', 'stock.themeRotation', 'stock.themes',
  'stock.tideHistory', 'stock.topFlowPicks', 'stock.treasuryYields', 'stock.uct20List', 'stock.uctRating',
  'stock.volumeFootprint', 'stock.yearlyHighsLows']
