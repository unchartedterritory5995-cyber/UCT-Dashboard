// ── UCT Agent COACH guard — the browser MIRROR of api/services/uct_agent/coach/guard.py (W3-2) ────────────────
//
// The same four checks, the same codes, the same regexes (no lookbehind: src/noRegexLookbehind.test.js): both sides
// run the one fixture, app/src/agent/__fixtures__/coachGuardCases.json, so they cannot drift. The server is the
// authority on every model reply; this mirror runs over the browser's OWN deterministic coach answers (concept text,
// the observation line, the journal review) and over a proposed note's text before it is planned, and is what the
// vitest rails use. `enforce` never edits a violating text — it replaces it with FIXED.

export const FOOTER = 'Educational, not advice.'
export const FIXED = `I can explain the concept and what to check on your chart, but I can't make that claim. ${FOOTER}`
export const CODES = ['unsupported', 'order', 'figure', 'uncertainty']

const NEGATED = /\b(?:no|not|never|isn't|isnt|aren't|arent|without|cannot be|can't be|cant be|nothing is|there is no|there's no|there are no|doesn't|does not|don't|do not)\s+(?:a\s+|any\s+)?guarantee[sd]?\b/gi

const MOVE = '(?:go|move|head|trade|rally|rip|run|climb|rise|fall|drop|tank|crash|break ?out|bounce|recover|double|triple|soar|plunge|squeeze|explode|moon|continue|hold|keep going|take off|hit|reach)'
export const UNSUPPORTED = [
  ['guarantee', /\bguarantee[sd]?\b/i],
  ['will-move', new RegExp(`\\bwill\\s+(?:definitely\\s+|certainly\\s+|surely\\s+|almost certainly\\s+|probably\\s+)?${MOVE}\\b`, 'i')],
  ['going-to', new RegExp(`\\b(?:is|are|it's|its|this is|that's)\\s+going to\\s+${MOVE}\\b`, 'i')],
  ['cant-lose', /\bcan(?:'t|not|t)\s+(?:lose|fail|miss|go wrong)\b/i],
  ['sure-thing', /\b(?:sure (?:thing|bet|win|winner|shot)|for sure|dead cert|no[- ]brainer|slam dunk|lock)\b/i],
  ['certain', /\b(?:is|are|it's|its|this is|that's)\s+(?:a\s+)?(?:certain|definite|definitely|certainly|sure)\s+(?:to|thing|bet|win|winner)\b/i],
  ['buy-sell-now', /\b(?:buy|sell|short)\s+(?:it\s+|this\s+|them\s+|here\s+)?(?:now|today|immediately|right now|asap)\b/i],
  ['price-target', /\b(?:price target|target price|my target|a target of|targets? (?:is|are|at)?\s*\$?\d|should (?:hit|reach|get to|be at|trade at)\s+\$?\d|(?:upside|downside) to \$?\d)/i],
  ['always-works', /\b(?:always works?|never fails?|works every time|never loses?|always wins?|can only go (?:up|down|higher|lower)|has to (?:go|rally|bounce|drop|rise|fall)|bound to (?:go|rally|bounce|drop|rise|fall)|100 ?% (?:certain|sure|win|success|safe)|risk[- ]free|no (?:risk|downside|doubt)|zero risk|definitely (?:will|going)|without (?:a )?doubt|cannot fail|can't fail)\b/i],
]

export const ORDER = [
  ['trade-now', /\b(?:buy|sell|short|cover|go long|go short|get long|get short|enter|exit|load up|size up|double down|add to (?:your |the )?position)\b[^.!?\n]{0,40}?\b(?:now|today|here|immediately|right now|at the open|at open|before the close|into the close|tomorrow|premarket|pre-market)\b/i],
  ['shares', /\b(?:buy|sell|short|purchase|pick up|grab|dump|unload)\s+(?:\d[\d,]*\s+|some\s+|more\s+|a few\s+)?shares\b/i],
  ['place-order', /\b(?:place|put in|enter|submit|set|execute)\s+(?:an?\s+|the\s+|your\s+)?(?:buy|sell|limit|market|stop|stop-loss|bracket)?\s*(?:order|trade)\b/i],
  ['you-should', /\b(?:you should|you need to|you must|you have to|i would|i'd|i'd say|go ahead and|my advice is to|time to)\s+(?:buy|sell|short|cover|go long|go short|get in|get out|take the trade|take this trade|add|enter|exit|bail|dump)\b/i],
  ['take-trade', /\b(?:take|make) (?:the|this|that) trade\b|\bpull the trigger\b|\bget in (?:now|here|today)\b|\bget out (?:now|here|today)\b/i],
]

export const OUTCOME = /\b(?:will|likely|unlikely|probab\w*|odds|chances?|expect\w*|outcomes?|follow[- ]?through|work(?:s|ed)? out|play(?:s|ed)? out|next (?:move|session|week|day|leg)|going to|succeed\w*|fail\w*|targets?|upside|downside|forecast\w*|predict\w*|rally|rallies|bounce\w*|break ?outs?|breakdowns?|continu\w*|resolv\w*|should (?:hold|work|go|rally|bounce))\b/i
export const HEDGE = /\b(?:may|might|could|often|sometimes|tends? to|tend|not guaranteed|no guarantee|no guarantees|isn't guaranteed|uncertain\w*|not certain|no certainty|no way to know|cannot know|can't know|nobody knows|unknown|doesn't always|does not always|not always|don't always|do not always|depends|historically|in the past|hypothesis|one input|not a forecast|not a prediction|not a promise|not predictions|educational|can fail|could fail|might fail|may fail|can reverse|could reverse|can break|could break|can still|could still|may still|no pattern|cannot be known|can't be known|possibility|possible|possibly|perhaps|not a signal|not a rule|not rules|describes|description|estimate\w*)\b/i

// a figure: 20, 20.5, 1,000, $10, 15%, 2R; a letter or digit BEFORE it is not a figure ("v2"). Prefix captured, no lookbehind.
const FIGURE = /(^|[^A-Za-z0-9])[-+]?\$?(\d[\d,]*(?:\.\d+)?)%?/g

/** Every number in the text, canonical ('1,000' → '1000', '20.50' → '20.5'). */
export function figures(text) {
  const out = new Set()
  const s = String(text || '')
  FIGURE.lastIndex = 0
  let m
  while ((m = FIGURE.exec(s))) {
    const v = Number(m[2].replace(/,/g, ''))
    if (Number.isFinite(v)) out.add(Number.isInteger(v) ? String(v) : String(v))
    if (m[0].length === 0) FIGURE.lastIndex++
  }
  return out
}
const inputText = (inputs) => (inputs == null ? '' : typeof inputs === 'string' ? inputs : inputs.filter(Boolean).map(String).join('\n'))

export const unsupported = (text) => { const t = String(text || '').replace(NEGATED, ' '); return UNSUPPORTED.filter(([, rx]) => rx.test(t)).map(([n]) => n) }
export const orderLanguage = (text) => { const t = String(text || ''); return ORDER.filter(([, rx]) => rx.test(t)).map(([n]) => n) }
export function untraceableFigures(text, inputs) {
  const allowed = figures(inputText(inputs))
  return [...figures(text)].filter(f => !allowed.has(f)).sort()
}
export const aboutOutcomes = (text) => OUTCOME.test(String(text || ''))
export const hasHedge = (text) => HEDGE.test(String(text || ''))

/** The violation codes of a text (empty = clean), in CODES order. */
export function check(text, inputs = null) {
  const codes = []
  if (unsupported(text).length) codes.push('unsupported')
  if (orderLanguage(text).length) codes.push('order')
  if (untraceableFigures(text, inputs).length) codes.push('figure')
  if (aboutOutcomes(text) && !hasHedge(text)) codes.push('uncertainty')
  return codes
}

export function ensureFooter(text) {
  const t = String(text || '').trimEnd()
  if (t.toLowerCase().includes('educational')) return t
  return t ? `${t}\n\n${FOOTER}` : FOOTER
}

/** { text, violations }: the text with the footer, or FIXED when it violates (never an edited text). */
export function enforce(text, inputs = null) {
  const violations = check(text, inputs)
  return violations.length ? { text: FIXED, violations } : { text: ensureFooter(text), violations: [] }
}
