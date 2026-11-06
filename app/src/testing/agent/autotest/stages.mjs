// UCT Agent AUTOTEST: the staged REAL-MODEL budget. Same table as tools/agent_autotest_gate.py STAGES; a test pins them.
// A stage is requests + a dollar ceiling, and each needs the owner's authorization file to name it.
import { sample } from './requests.mjs'

export const STAGES = { canary: 0.50, sample: 2.00, broad: 3.00, heldout: 1.50 }
const CANARY_FAMILIES = new Set(['symbol', 'timeframe', 'indicator-add', 'drawing-level', 'watchlists', 'howto'])

/** Which requests a stage runs. Fixed, so the owner approves a known list. */
export function stageList(stage, pub, held = []) {
  const already = (s) => new Set(stageList(s, pub, held).map(r => r.id))
  switch (stage) {
    case 'canary': return sample(pub.filter(r => CANARY_FAMILIES.has(r.family)), 2).slice(0, 12)
    case 'sample': { const c = already('canary'); return sample(pub, 3).filter(r => !c.has(r.id)).slice(0, 90) }
    case 'broad': { const c = already('canary'), s = already('sample'); return pub.filter(r => !c.has(r.id) && !s.has(r.id)) }
    case 'heldout': return held
    default: return []
  }
}
