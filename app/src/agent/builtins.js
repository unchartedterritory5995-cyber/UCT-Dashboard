// The capability modules UCT Agent loads. A new Agent-operable feature adds ONE
// line here (its own register function) — nothing in the orchestrator, planner,
// runtime, prompt or server changes. See agent/README.md.
import { registerChartCapabilities } from './capabilities/chart'
import { registerWorkspaceCapabilities } from './capabilities/workspace'
import { registerLayoutCapabilities } from './capabilities/layout'
import { registerWatchlistCapabilities } from './capabilities/watchlist'
import { registerScreenerCapabilities } from './capabilities/screener'
import { registerAlertCapabilities } from './capabilities/alert'
import { registerStockCapabilities } from './capabilities/stock'
import { registerSettingsCapabilities } from './capabilities/settings'
import { registerAppCapabilities } from './capabilities/app'

let done = false
export function registerBuiltins() {
  if (done) return
  done = true
  registerChartCapabilities()
  registerWorkspaceCapabilities()
  registerLayoutCapabilities()
  registerWatchlistCapabilities()
  registerScreenerCapabilities()
  registerAlertCapabilities()
  registerStockCapabilities()
  registerSettingsCapabilities()
  registerAppCapabilities()
}
