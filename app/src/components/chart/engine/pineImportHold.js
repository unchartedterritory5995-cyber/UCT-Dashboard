// app/src/components/chart/engine/pineImportHold.js
//
// ⭐⭐ COND-TA (coordinator rulings 2026-11-15) — THE PINE-IMPORT HOLD's predicates, the chart's
// half (the server's twin: `api/services/user_definitions.py::pine_import_stale`,
// `conditional_history_candidate`). The number and the sentence are declared in
// `scriptEngineVersion.js` (the server reads them there); these ask the shared bar-constant rule.
import { PINE_IMPORT_FIX_ENGINE } from './scriptEngineVersion'
import { barConstantTree } from './ast/barConstant'

/** ⭐ NARROWED (coordinator ruling after the #1326 review, 2026-11-15): only a STRUCTURAL
 *  CANDIDATE is held — a document whose saved trees could be one of the shapes the old screener
 *  lane misread: a CALL under an arm of a `?:` (an `if` block and an `if` expression print as
 *  one) or of `iff(c, a, b)`, or an OFFSET under a `?:` arm (a block local's `x[1]`, #1326).
 *  Prod (read-only, 2026-11-15): 3 current Pine Apply saves, 1 such candidate. Every other Pine
 *  import is served as before. Walks the canonical trees (`compute.ast`, `compute.trees`),
 *  never the script. */
export function conditionalHistoryCandidate(def) {
  const compute = def && typeof def === 'object' && def.compute && typeof def.compute === 'object' ? def.compute : null
  if (!compute) return false
  const roots = [compute.ast, ...(compute.trees && typeof compute.trees === 'object' ? Object.values(compute.trees) : [])]
  const seen = new Set()
  // `armOffsets`: an offset counts under a `?:` arm only (the ruling's shape), a call under any arm
  const walk = (n, inArm, inTernaryArm, d) => {
    if (!n || typeof n !== 'object' || d > 256) return d > 256   // fail closed on a tree too deep to read (the server's bound)
    if (Array.isArray(n)) return n.some((x) => walk(x, inArm, inTernaryArm, d + 1))
    if (seen.has(n) && !inArm) return false
    seen.add(n)
    if (inArm && n.type === 'call') return true
    if (inTernaryArm && n.type === 'offset') return true
    const args = Array.isArray(n.args) ? n.args : null
    const ternary = n.type === 'op' && n.name === '?:' && args && args.length === 3
    const iff = n.type === 'call' && String(n.name || '').toLowerCase() === 'iff' && args && args.length === 3
    if (ternary || iff) {
      const arm = (a) => (a && typeof a === 'object' && a.value !== undefined && !a.type ? a.value : a)
      if (walk(arm(args[0]), inArm, inTernaryArm, d + 1)) return true
      // ⭐ COND-TA — a test the same on every bar of a binding (`barConstantTree`: literals, the
      // chart's timeframe flags, pointwise calls over them) runs one arm on every bar or none:
      // its arms are not conditional history (RS Rating's `not timeframe.isweekly`).
      const constant = barConstantTree(arm(args[0]))
      const inA = constant ? inArm : true
      const inT = constant ? inTernaryArm : (inTernaryArm || ternary)
      return walk(arm(args[1]), inA, inT, d + 1) || walk(arm(args[2]), inA, inT, d + 1)
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'tok' || k === 'endTok' || !v || typeof v !== 'object') continue
      if (walk(v, inArm, inTernaryArm, d + 1)) return true
    }
    return false
  }
  return roots.some((r) => walk(r, false, false, 0))
}

/** Is this stored row a Pine import with no script, applied before `PINE_IMPORT_FIX_ENGINE`,
 *  whose trees are a structural candidate (`conditionalHistoryCandidate`)? `row` is a store row
 *  (`definition`, and `pine_source` / `has_pine_source` when it holds its script). Reads
 *  provenance and the saved trees only — never the script. */
export function pineImportHeld(row, fixEngine = PINE_IMPORT_FIX_ENGINE) {
  const def = row && typeof row === 'object' ? row.definition : null
  const meta = def && typeof def === 'object' && def.meta && typeof def.meta === 'object' ? def.meta : null
  const imp = meta && meta.importedFrom && typeof meta.importedFrom === 'object' ? meta.importedFrom : null
  if (!imp || String(imp.dialect || '').toLowerCase() !== 'pine') return false
  if ((typeof row.pine_source === 'string' && row.pine_source.trim()) || row.has_pine_source === true) return false
  if (Number.isInteger(imp.engine) && Number.isInteger(fixEngine) && imp.engine >= fixEngine) return false
  // ⛔ A Pine v1 import (the door stamp `meta.pineVersion` present and `null` = no pragma, or 1):
  // a v1 `?:` arm is EAGER (witnessed: cci-coded-obv / trade-archer OBV, 666 / 666 eager) and v1
  // has no `if`, so its every-bar formula is TradingView's. An import with no door stamp at all
  // is of unknown version and stays a candidate.
  if (Object.prototype.hasOwnProperty.call(meta, 'pineVersion') && (meta.pineVersion === null || Number(meta.pineVersion) <= 1)) return false
  return conditionalHistoryCandidate(def)
}
