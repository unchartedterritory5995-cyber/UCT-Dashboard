// app/src/components/chart/engine/ast/strategyRepaint.js
//
// ─── W9-T1 RULE 11: REPAINT-CLASS INPUTS REFUSE BROKER MODE BY NAME ─────────────
//
// A strategy's trades must be the same on every run. These constructs read something a later
// run can see differently, so a script holding one is refused in broker mode,
// `runtime:strategy-repaint`, naming the construct, until its own wave rules. Plots still draw:
// this is asked only of the broker retry (`pineRuntimeFrontend.js::buildRuntimeIr`), never of
// the indicator lane. Read off the SAME token stream the repaint classifier reads
// (`runtime/runtimeRepaint.js::lexRepaint`: comments and strings dropped), one lexer.
//
// ⛔ OVER-REFUSES BY DESIGN: the design asks that `barstate.*` refuse when it REACHES an order;
// this refuses wherever it appears in a broker-mode script (a taint walk is a later refinement).
// Over-refusal is a sentence; a wrong trade is a wrong number on a chart a member trades from.
import { lexRepaint } from '../runtime/runtimeRepaint.js'

export const STRATEGY_REPAINT_GUARD = 'runtime:strategy-repaint'

const BARSTATE = new Set(['barstate.isrealtime', 'barstate.islast', 'barstate.islastconfirmedhistory',
  'barstate.isconfirmed'])
const SECURITY = new Set(['request.security', 'security', 'request.security_lower_tf'])

/** The first repaint-class construct in `source`, as a short name, or null. */
export function strategyRepaintConstruct(source) {
  let toks
  try { toks = lexRepaint(source) } catch { return 'an unreadable source' }
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]
    if (t.k !== 'id') continue
    if (t.v === 'varip') return 'varip'
    if (t.v === 'timenow') return 'timenow'
    if (BARSTATE.has(t.v)) return t.v
    if (SECURITY.has(t.v) && toks[i + 1] && toks[i + 1].k === 'p' && toks[i + 1].v === '(') {
      // lookahead_on, or any higher-timeframe value (unconfirmed on the forming bar): both refuse
      return t.v.endsWith('lower_tf') ? t.v : `${t.v} (a higher-timeframe or lookahead value)`
    }
  }
  return null
}
