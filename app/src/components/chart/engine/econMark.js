// The `econ:` source mark and its ONE parser, dependency-free and byte-lean ON PURPOSE:
// sourceRef/gapRuns/fundamentalFormat sit in the app's ENTRY chunk, which the Notebook
// first-open byte budget measures (docs/notebook/perf-budgets.json). The rest of the
// economic grammar (economicGrammar.js) loads only with the chart code.
// `econ:<SYMBOL>`: no second colon, no whitespace, a registry-shaped symbol ([A-Za-z]\w{1,31});
// any case in, UPPERCASE out. Malformed is null, never a fall-through to a bar field.
export const ECON_MARK = 'econ:'
const RE = /^econ:([A-Za-z]\w{1,31})$/
export function parseEconomicSource(value) {
  const m = typeof value === 'string' && RE.exec(value)
  return m ? { kind: 'economic', symbol: m[1].toUpperCase() } : null
}
