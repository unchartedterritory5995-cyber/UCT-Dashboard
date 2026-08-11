// app/src/components/research/askAiSuggestions.js
//
// Starter questions for the modal's Ask AI panel.
//
// Pure on purpose: the panel renders whatever this returns, so the CONTENT
// decision is testable without React, a network stub, or the widget's whole
// streaming machine behind it.
//
// Before the print and after it are different questions. "How did the print
// go?" is noise on a company that reports tonight, and "what does the options
// market expect?" is a stale question once the number is out — so the set is
// chosen off the same `lifecycle` the banner already computed rather than a
// second derivation of "has this company reported yet".

/** Lifecycles where the number is already out (earningsLifecycle.js's strict
 *  precedence order: POST · CALL_LIVE · PRINTED all mean actuals are present —
 *  CALL_LIVE is PRINTED with the call underway, not a pre-print state). */
const REPORTED = new Set(['PRINTED', 'POST', 'CALL_LIVE'])

const PRE_TEMPLATES = [
  (sym) => `What's the setup into ${sym}'s print?`,
  (sym) => `What does the options market expect for ${sym}?`,
  (sym) => `How has ${sym} traded after past earnings?`,
  (sym) => `What's the catalyst on ${sym} right now?`,
]

const POST_TEMPLATES = [
  (sym) => `How did ${sym}'s print go?`,
  (sym) => `Why is ${sym} moving after earnings?`,
  (sym) => `What did management guide to on the ${sym} call?`,
  (sym) => `Is ${sym} extended or setting up here?`,
]

/**
 * Starter questions for `sym`, chosen off the earnings lifecycle.
 *
 * Returns `[]` for a falsy symbol rather than emitting "What's the setup into
 * 's print?" — the panel mounts against the SETTLED symbol, which is empty for
 * one debounce tick while a member arrow-steps.
 */
export function suggestionsFor({ sym, lifecycle } = {}) {
  const s = String(sym || '').trim()
  if (!s) return []
  const templates = REPORTED.has(lifecycle) ? POST_TEMPLATES : PRE_TEMPLATES
  return templates.map((t) => t(s))
}

export default suggestionsFor
