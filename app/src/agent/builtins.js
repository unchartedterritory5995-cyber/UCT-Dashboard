// The capability modules UCT Agent loads. A new Agent-operable feature adds ONE
// line here (its own register function) — nothing in the orchestrator, planner,
// runtime, prompt or server changes. See agent/README.md.
import { registerChartCapabilities } from './capabilities/chart'

let done = false
export function registerBuiltins() {
  if (done) return
  done = true
  registerChartCapabilities()
}
