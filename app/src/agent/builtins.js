// The capability modules UCT Agent loads. A new Agent-operable feature adds ONE
// line here (its own register function) — nothing in the orchestrator, planner,
// runtime, prompt or server changes. See agent/README.md.
import { registerChartCapabilities } from './capabilities/chart'
import { registerWorkspaceCapabilities } from './capabilities/workspace'
import { registerLayoutCapabilities } from './capabilities/layout'
import { registerLayoutBarCapabilities } from './capabilities/layoutBar'
import { registerWatchlistCapabilities } from './capabilities/watchlist'
import { registerListViewCapabilities } from './capabilities/listView'
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
import { registerDrawingBoardCapabilities } from './capabilities/drawingBoards'
import { registerIndicatorCapabilities } from './capabilities/indicators'
import { registerIndicatorEditCapabilities } from './capabilities/indicatorEdits'
import { registerIndicatorAuthoringCapabilities } from './capabilities/indicatorAuthoring'
import { registerChartSetupCapabilities } from './capabilities/chartSetup'
import { registerCompareGroupCapability } from './capabilities/compareGroup'
import { registerChartMenuCapabilities } from './capabilities/chartMenu'
import { registerChartFeatureCapabilities } from './capabilities/chartFeatures'
import { registerDrawingExtras } from './capabilities/drawingExtras'
import { registerIndicatorControlCapabilities } from './capabilities/indicatorControls'
import { registerIndicatorTemplateCapabilities } from './capabilities/indicatorTemplates'
import { registerDefinitionCapabilities } from './capabilities/definitions'
// the chart's UCT Intelligence INDICATOR (its library row + panel layers) — not indicator authoring
import { registerUctIntelligenceCapabilities } from './capabilities/uctIntelligence'
import { registerBreadthCapabilities } from './capabilities/breadth'
import { registerBreadthHistoryCapability } from './capabilities/breadthHistory'
import { registerGuideCapabilities } from './capabilities/guide'
import { registerMarketDataCapabilities } from './capabilities/marketDataQuote'
import { registerMarketFactsCapabilities } from './capabilities/marketDataFacts'
import { registerKnowledgeCapabilities } from './capabilities/knowledge'
import { registerResearchCapability } from './capabilities/research'
import { registerHistoryCapability } from './capabilities/history'
import { registerChartDescribeCapability } from './capabilities/chartDescribe'
import { registerMultiChartCapabilities } from './capabilities/multiChart'
// ⭐ W2-C1 (multi-page host): the pages' own capabilities — offered only on their surface (AgentProvider)
import { registerScreenerPageCapabilities } from './capabilities/screenerPage'
import { registerBreadthPageCapabilities } from './capabilities/breadthPage'
import { registerCalendarCapabilities } from './capabilities/calendar'
import { registerJournalCapabilities } from './capabilities/journal'
import { registerCoachCapabilities } from './capabilities/coach'
// C3-205..207 (pl-exec6): Tools → Custom-Period Sort — run a sort, dock its panel
import { registerPeriodSortCapabilities } from './capabilities/periodSort'
// Tools → Compare Symbols: open the panel on its Rotation (RRG-style) or Overlay tab, switch between them
import { registerComparePanelCapabilities } from './capabilities/comparePanel'

let done = false
export function registerBuiltins() {
  if (done) return
  done = true
  registerChartCapabilities()
  registerWorkspaceCapabilities()
  registerLayoutCapabilities()
  registerLayoutBarCapabilities()
  registerWatchlistCapabilities()
  registerListViewCapabilities()
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
  registerDrawingBoardCapabilities()
  registerIndicatorCapabilities()
  registerIndicatorEditCapabilities()
  registerIndicatorAuthoringCapabilities()
  registerChartSetupCapabilities()
  registerCompareGroupCapability()          // C1-035 / C1-037 / C1-040: the Compare panel's group controls
  registerChartMenuCapabilities()           // C1-178 / C1-061: the chart's right-click Ask AI and watermark Reset
  registerChartFeatureCapabilities()        // Add to Chart's host features: the Company Info panel + the Earnings Strip
  registerDrawingExtras()                   // C1-144 / C1-160 / C1-165: Position Calculator, Save as default, tool favourites
  registerIndicatorControlCapabilities()
  registerIndicatorTemplateCapabilities()
  registerDefinitionCapabilities()
  registerUctIntelligenceCapabilities()     // uctIntelligence.set: add / remove the UCT Intelligence indicator, its layers on / off
  registerAboutCapabilities()
  registerGuideCapabilities()
  registerScreenerPageCapabilities()
  registerBreadthPageCapabilities()
  registerCalendarCapabilities()
  registerJournalCapabilities()
  registerPeriodSortCapabilities()
  registerComparePanelCapabilities()        // compare.openView: the Compare panel's Rotation / Overlay view (a view, not saved)
  registerMultiChartCapabilities()   // pl-grid: the Multi Chart grid itself (C3-042..061)
}

// SERVER-GATED capabilities: registered only once /api/agent/config has answered, and only when the server
// activates what they read (each register function is idempotent and registers nothing otherwise), so the
// model's manifest and every flags-off answer stay exactly as they are while the gateway is dark.
export function registerServerGatedBuiltins() {
  registerMarketDataCapabilities()
  registerMarketFactsCapabilities()      // W1-C C-02: stock.themes while the server serves `themes`
  registerKnowledgeCapabilities()        // KN-1: playbook.* while the server serves the knowledge kinds
  registerResearchCapability()           // W2-B1 RS-1: research.ask while the server serves `research.company`
  registerHistoryCapability()            // W2-B2: history.afterEvent while the server serves `history.eventStudy`
  registerChartDescribeCapability()      // W2-B3: chart.describeSetup while the server serves `bars.daily`
  registerCoachCapabilities()            // Wave 3 (W3-1..4): coach.* / journal.* while the server serves `coach` (UCT_AGENT_COACH)
}
