// app/src/components/research/askAiSuggestions.js
//
// Starter questions for the modal's Ask AI panel.
//
// Pure on purpose: the panel renders whatever this returns, so the CONTENT
// decision is testable without React, a network stub, or the widget's whole
// streaming machine behind it.
//
// ── WHY THESE EXACT WORDS ─────────────────────────────────────────────────────
// The wording is not decoration. `/api/ai-search` attaches regime, quote,
// catalyst, tape and pattern context to any question that names a ticker — but
// its OPTIONS-FLOW, ANALYST, FUNDAMENTALS and INSIDER packs are INTENT-GATED:
// each is attached only when the question text trips that pack's regex. A
// generically-worded starter gets a web summary; a correctly-worded one gets
// answered out of our own data.
//
// The first set of starters shipped without tripping a single gate, so each of
// these deliberately opens a DIFFERENT lane. The gate each one is aiming at is
// named beside it. ⛔ Do NOT restate the trigger words here — the regexes live
// in `api/routers/ai_search.py` and copying them creates a second authority that
// drifts. `tests/test_ask_ai_presets_trigger_context.py` reads THIS file and
// asserts each starter still trips its intended gate against the real regex; it
// is what tells you a reword silently cost a data pack.
//
// ⛔ EVERY starter MUST name the symbol. The backend derives which ticker to
// load context for by extracting tickers FROM THE QUERY TEXT — a starter that
// says "into the print" with no symbol gets no per-ticker context at all, not
// even the ungated packs. `suggestionsFor` returning [] for a blank symbol is
// the same rule at the other end.
//
// Before the print and after it are different questions: "how did the print go"
// is noise on a company that reports tonight, and "what does the street expect"
// is stale once the number is out. The set is chosen off the same `lifecycle`
// the banner already computed rather than a second derivation of "has this
// company reported yet".

/** Lifecycles where the number is already out (earningsLifecycle.js's strict
 *  precedence order: POST · CALL_LIVE · PRINTED all mean actuals are present —
 *  CALL_LIVE is PRINTED with the call underway, not a pre-print state). */
const REPORTED = new Set(['PRINTED', 'POST', 'CALL_LIVE'])

const PRE_TEMPLATES = [
  // ungated — patterns + tape + quote + regime attach on any ticker question
  (sym) => `Is ${sym} setting up or extended here?`,
  // → options-flow pack
  (sym) => `What's the options flow saying on ${sym} into the print?`,
  // → analyst pack (estimates, targets, ratings)
  (sym) => `What are analysts' price targets and estimates for ${sym}?`,
  // → fundamentals pack. ⚠️ "valuation" and "revenue growth" are what trip the
  // gate — bare "margins" does NOT (measured: the gate misses "Did NVDA's
  // margins hold up?" entirely). Reword around those two terms, not away from
  // them; the Python contract test is what will tell you if you did.
  (sym) => `How do ${sym}'s valuation and revenue growth look going in?`,
  // ungated — history lives on the web, not in our stores
  (sym) => `How has ${sym} traded after past earnings?`,
  // → insider pack
  (sym) => `Any insider buying at ${sym} lately?`,
]

const POST_TEMPLATES = [
  (sym) => `How did ${sym}'s print go?`,
  // ungated, but trips the why-moved intent → news + catalyst
  (sym) => `Why is ${sym} moving after earnings?`,
  (sym) => `What did management guide to on the ${sym} call?`,
  // → analyst pack — the post-print revision wave is the whole question here
  (sym) => `Any analyst upgrades or downgrades on ${sym} since the print?`,
  // → options-flow pack
  (sym) => `What's the options flow doing on ${sym} since the print?`,
  // → fundamentals pack. Same trap as the pre-print one: "revenue growth" is
  // the term carrying this, not "margins".
  (sym) => `Did ${sym}'s revenue growth and margins hold up in the print?`,
]

/**
 * Starter questions for `sym`, chosen off the earnings lifecycle.
 *
 * Returns `[]` for a falsy symbol rather than emitting "Is 's setup..." — the
 * panel mounts against the SETTLED symbol, which is empty for one debounce tick
 * while a member arrow-steps.
 */
export function suggestionsFor({ sym, lifecycle } = {}) {
  const s = String(sym || '').trim()
  if (!s) return []
  const templates = REPORTED.has(lifecycle) ? POST_TEMPLATES : PRE_TEMPLATES
  return templates.map((t) => t(s))
}

export default suggestionsFor
