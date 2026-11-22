// CAPABILITY REGRESSION (Mission 2) — the canonical registry, as production builds it.
//
// Two configurations, both read from the REAL register functions (builtins.js), never from a hand list:
//   • PROD_KINDS — production's data kinds (web, 2026-11-03; pinned by agentProdKinds.test.js): what an admin's
//     Agent registers today. The corpus and the golden workflows run under this one.
//   • ALL_KINDS  — every server-gated kind switched on: the WHOLE catalog, dark capabilities included. The
//     inventory and the "a new capability needs a regression entry" rail read this one, so a capability that
//     ships dark is caught the day it ships, not the day its flag flips.
import { vi } from 'vitest'
import { registerBuiltins, registerServerGatedBuiltins } from '../../../builtins'
import { allCapabilityNames } from '../../../capabilities'
import { loadAgentConfig, _resetAgentConfig } from '../../../agentClient'

// ⚠ keep equal to agentProdKinds.test.js PROD_KINDS (inventory.test.js pins the two by reading that file's text)
export const PROD_KINDS = ['instrument.resolve', 'quote', 'quotes', 'bars.daily', 'fundamentals', 'earnings', 'news.company', 'themes',
  'screen.run', 'screen.count', 'screen.saved']
export const ALL_KINDS = [...PROD_KINDS, 'history.eventStudy', 'research.company', 'knowledge.search', 'setup.playbook', 'setup.record',
  'index.quote', 'commodity.quote', 'crypto.quote', 'cot.positioning', 'rs.leadership', 'catalysts.board',
  // terminal data wave 1 (#1584, dark): the Agent half of the UPDG / HILO / SCTR / LEAD / LVL terminal panels
  'analyst.actions', 'highsLows.session', 'sectors.performance', 'leaders.longRun', 'levels.darkpool',
  // terminal data wave 2 (dark): the Agent half of the H52 / TROT / CONFL / EXMV / TSRC terminal panels
  'highsLows.yearly', 'themes.rotation', 'confluence.board', 'earnings.expectedMove', 'earnings.callSearch',
  // terminal data wave 3 (dark): the Agent half of the LVL panel's options levels, the TOPF panel, the Flow Record page and the EMOV panel
  'levels.gamma', 'flow.topPicks', 'flow.record', 'earnings.reactions',
  // terminal data wave 4 (dark): the Agent half of the ERNS / CEOS / GRP terminal panels
  'earnings.season', 'earnings.callThemes', 'group.drill',
  // terminal data wave 5 (dark): the Agent half of the SHINT / SHRTS terminal panels (FINRA short interest)
  'short.interest', 'short.list',
  // terminal data wave 6 (dark): the Agent half of the SEAS / SEASB / TIDEH / OIC / RATES terminal panels
  'seasonality.stock', 'seasonality.board', 'options.tideHistory', 'options.oiChange', 'rates.treasury',
  // terminal data wave 7 (dark): the Agent half of the REGM / TECH / EVTS / IVH / DILU terminal panels and the UCT 20 page
  'market.regime', 'stock.setups', 'stock.eventsTimeline', 'uct20.list', 'options.ivHistory', 'dilution.watch',
  // terminal data wave 8 (dark): the Agent half of the CACT / IPO / DVD terminal panels
  'stock.corporateActions', 'calendar.ipos', 'calendar.dividends',
  // terminal data wave 9 (dark): the Agent half of the AUCT panel, the real-yield block of RATES and the FED panel
  'rates.auctions', 'rates.realYields', 'fed.watch']

/** PKG2: the data kinds an entry runs under. `"kinds": "ALL"` marks a DARK entry (its kind is not in production's list yet:
 *  history.eventStudy, the asset quotes), run only by corpus.dark.test.jsx with every gated kind on; every other entry
 *  runs under PROD_KINDS. */
export const kindsFor = (entry) => (entry?.kinds === 'ALL' ? ALL_KINDS : PROD_KINDS)
export const isDark = (entry) => entry?.kinds === 'ALL'

/** The /api/agent/config answer for a kinds list (coach on only for the whole catalog). */
export const configFor = (kinds) => ({ stream: false, nl1: false, data: true, scan: kinds.includes('screen.run'), data_kinds: kinds, news: true,
  planner: 'v1', coach: kinds === ALL_KINDS })

/** Registers the built-ins and the server-gated capabilities a server serving `kinds` would activate. */
export async function registerCatalog(kinds = PROD_KINDS) {
  registerBuiltins()
  const ungated = new Set(allCapabilityNames())
  _resetAgentConfig()
  const saved = globalThis.fetch
  globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('/api/agent/config') ? configFor(kinds) : {}),
    { status: String(url).endsWith('/api/agent/config') ? 200 : 404, headers: { 'content-type': 'application/json' } }))
  await loadAgentConfig()
  registerServerGatedBuiltins()
  globalThis.fetch = saved
  const all = allCapabilityNames()
  return { all: [...all].sort(), ungated: [...ungated].sort(), gated: all.filter(n => !ungated.has(n)).sort() }
}
