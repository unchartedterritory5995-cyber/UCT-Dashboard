// app/src/components/chart/engine/runtime/__tests__/brokerArmed.js
//
// ─── ⭐⭐ W9 ARMED: IS THE STRATEGY BROKER ARMED IN A PRODUCTION BUILD? ──────────────────────────────────────────────
//
// Owner decision 2026-11-26, verbatim: "we are only admins and have no users so everything can always be live fully".
// That is the owner's act of arming the strategy broker (W9 ruling D6: "The act of arming remains the owner's"), every
// W2 stage at once (PINE_RUNTIME_STAGE was already `all`).
//
// A MEASUREMENT HELPER under `__tests__` (nothing in the bundle imports it; it reads files with `node:fs`). The gate is
// a BUILD constant (`strategyBrokerGate.js`: `import.meta.env.<FLAG> === '<literal>'`); a production build bakes
// `Dockerfile.web`'s ARG default for that flag when Railway's variable is UNSET (`tests/test_strategy_serve_arming.py`
// holds the build semantics). So "armed" is read off those two files, never a constant of its own. The Python census
// reads the same two (`tools/pine_coverage/coverage_map.py::strategy_broker_armed`).
//
// ⛔ THE RE-DISARM PATH is the same line: an ARG default other than the literal (`=0`, or none) answers false here, bakes
// the gate OFF in the build, and turns the scorecard back to "not served" (railed both ways in `strategiesAreRuled.test.js`).
import fs from 'node:fs'
import path from 'node:path'

/** Does `dockerText` (Dockerfile.web) bake the gate ON when Railway's variable is unset? Only an `ARG <flag>=<literal>`
 *  line whose default equals the literal the gate (`gateSource`) compares to. Anything else is OFF (fails closed). */
export function brokerArmedInDockerfile(dockerText, gateSource) {
  const g = String(gateSource || '').match(/import\.meta\.env\.(VITE_[A-Z0-9_]+)\s*===\s*'([^']*)'/)
  if (!g) return false
  const m = String(dockerText || '').match(new RegExp(`^ARG[ \\t]+${g[1]}(?:=(\\S*))?[ \\t\\r]*$`, 'm'))
  return !!m && m[1] === g[2]
}

const GATE_REL = 'app/src/components/chart/engine/strategyBrokerGate.js'

/** The two texts, read off the repository at `repoRoot` ('' for a file that cannot be read: OFF). */
export function brokerArmingTextsOf(repoRoot) {
  const read = (rel) => { try { return fs.readFileSync(path.join(repoRoot, rel), 'utf8') } catch { return '' } }
  return { dockerText: read('Dockerfile.web'), gateSource: read(GATE_REL) }
}

/** Is the strategy broker armed in a production build of the repository at `repoRoot`? */
export function productionBrokerArmedOf(repoRoot) {
  const { dockerText, gateSource } = brokerArmingTextsOf(repoRoot)
  return brokerArmedInDockerfile(dockerText, gateSource)
}
