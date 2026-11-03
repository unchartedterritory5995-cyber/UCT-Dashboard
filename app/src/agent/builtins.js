// The capability modules UCT Agent loads. A new Agent-operable feature adds ONE
// line here (its own register function) — nothing in the orchestrator, planner,
// runtime, prompt or server changes. See agent/README.md.
import { registerChartCapabilities } from './capabilities/chart'
import { registerWorkspaceCapabilities } from './capabilities/workspace'
import { registerLayoutCapabilities } from './capabilities/layout'
import { registerWatchlistCapabilities } from './capabilities/watchlist'
import { registerScreenerCapabilities } from './capabilities/screener'
import { registerSessionMeasures } from './capabilities/sessionMeasures'
import { registerAlertCapabilities } from './capabilities/alert'
import { registerIndicatorAlertCapabilities } from './capabilities/indicatorAlerts'
import { registerStockCapabilities } from './capabilities/stock'
import { registerSettingsCapabilities } from './capabilities/settings'
import { registerAppCapabilities } from './capabilities/app'
import { registerNewsCapabilities } from './capabilities/news'
import { registerDigestCapabilities } from './capabilities/digest'
import { registerSavedScreenCapabilities } from './capabilities/savedScreens'
import { registerAboutCapabilities } from './capabilities/about'
import { registerBoardCapabilities } from './capabilities/board'
import { registerDrawingCapabilities } from './capabilities/drawings'
import { registerIndicatorCapabilities } from './capabilities/indicators'
import { registerIndicatorEditCapabilities } from './capabilities/indicatorEdits'
import { registerIndicatorAuthoringCapabilities } from './capabilities/indicatorAuthoring'
import { registerChartSetupCapabilities } from './capabilities/chartSetup'
import { registerIndicatorControlCapabilities } from './capabilities/indicatorControls'
import { registerDefinitionCapabilities } from './capabilities/definitions'
import { registerBreadthCapabilities } from './capabilities/breadth'
import { registerBreadthHistoryCapability } from './capabilities/breadthHistory'
import { registerGuideCapabilities } from './capabilities/guide'
import { registerMarketDataCapabilities } from './capabilities/marketDataQuote'
import { registerMarketFactsCapabilities } from './capabilities/marketDataFacts'
import { registerResearchCapability } from './capabilities/research'
import { registerHistoryCapability } from './capabilities/history'
import { registerChartDescribeCapability } from './capabilities/chartDescribe'

let done = false
export function registerBuiltins() {
  if (done) return
  done = true
  registerChartCapabilities()
  registerWorkspaceCapabilities()
  registerLayoutCapabilities()
  registerWatchlistCapabilities()
  registerScreenerCapabilities()
  registerSessionMeasures()
  registerAlertCapabilities()
  registerIndicatorAlertCapabilities()
  registerStockCapabilities()
  registerBreadthCapabilities()
  registerBreadthHistoryCapability()
  registerSettingsCapabilities()
  registerAppCapabilities()
  registerNewsCapabilities()
  registerDigestCapabilities()
  registerSavedScreenCapabilities()
  registerBoardCapabilities()
  registerDrawingCapabilities()
  registerIndicatorCapabilities()
  registerIndicatorEditCapabilities()
  registerIndicatorAuthoringCapabilities()
  registerChartSetupCapabilities()
  registerIndicatorControlCapabilities()
  registerDefinitionCapabilities()
  registerAboutCapabilities()
  registerGuideCapabilities()
}

// SERVER-GATED capabilities: registered only once /api/agent/config has answered, and only when the server
// activates what they read (each register function is idempotent and registers nothing otherwise), so the
// model's manifest and every flags-off answer stay exactly as they are while the gateway is dark.
export function registerServerGatedBuiltins() {
  registerMarketDataCapabilities()
  registerMarketFactsCapabilities()      // W1-C C-02: stock.themes while the server serves `themes`
  registerResearchCapability()           // W2-B1 RS-1: research.ask while the server serves `research.company`
  registerHistoryCapability()            // W2-B2: history.afterEvent while the server serves `history.eventStudy`
  registerChartDescribeCapability()      // W2-B3: chart.describeSetup while the server serves `bars.daily`
}
