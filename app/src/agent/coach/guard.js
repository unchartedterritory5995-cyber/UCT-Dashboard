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

// W3 review: every check reads NORMALISED text — NFKC, curly quotes to straight, zero-width characters dropped and a
// small set of Cyrillic / Greek look-alikes mapped to Latin (the server's guard.normalize, same table)
const CONFUSABLES = {
  '\u2018': "'", '\u2019': "'", '\u02bc': "'", '\u00b4': "'", '\u0060': "'", '\u201c': '"', '\u201d': '"',
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x',
  '\u0456': 'i', '\u0458': 'j', '\u0455': 's', '\u0501': 'd', '\u04bb': 'h', '\u04cf': 'l', '\u043a': 'k',
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041a': 'K', '\u041c': 'M', '\u041d': 'H', '\u041e': 'O',
  '\u0420': 'P', '\u0421': 'C', '\u0422': 'T', '\u0425': 'X', '\u0406': 'I',
  '\u03bf': 'o', '\u03b1': 'a', '\u03b5': 'e', '\u03b9': 'i', '\u03bd': 'v', '\u03c1': 'p', '\u03c4': 't', '\u03ba': 'k',
  '\u039f': 'O', '\u0391': 'A', '\u0395': 'E', '\u0399': 'I', '\u039a': 'K', '\u03a1': 'P', '\u03a4': 'T',
  '\u200b': '', '\u200c': '', '\u200d': '', '\u2060': '', '\ufeff': '', '\u00ad': '',
}
// an alternation, not a character class: the table holds joiner characters (eslint no-misleading-character-class)
const CONFUSABLE_RX = new RegExp(Object.keys(CONFUSABLES).join('|'), 'g')
// review: accents folded (NFKD, combining marks dropped, then NFKC — NBSP becomes a space), Arabic-Indic and extended
// Arabic-Indic digits read as ASCII digits, a (non-breaking) hyphen INSIDE a word dropped — the server's normalize, same steps
const ARABIC_DIGIT = /[٠-٩۰-۹]/g
const arabicDigit = (ch) => String(ch.charCodeAt(0) - (ch.charCodeAt(0) >= 0x06F0 ? 0x06F0 : 0x0660))
export const normalize = (text) => String(text || '').normalize('NFKD').replace(/\p{Mn}/gu, '').normalize('NFKC')
  .replace(CONFUSABLE_RX, ch => CONFUSABLES[ch]).replace(ARABIC_DIGIT, arabicDigit).replace(/([A-Za-z])[‐‑]([A-Za-z])/g, '$1$2')
// the mandated footer is NOT a hedge: removed before the uncertainty check (W3 review C2)
const FOOTER_RX = /educational,?\s*not\s+(?:financial\s+|investment\s+)?advice\.?/gi

const MOVE = '(?:go|move|head|trade|rally|rip|run|climb|rise|fall|drop|tank|crash|break ?out|bounce|recover|double|triple|soar|plunge|squeeze|explode|moon|continue|hold|keep going|take off|hit|reach)'
export const UNSUPPORTED = [
  ['guarantee', /\bguarantee[sd]?\b/i],
  ['will-move', new RegExp(`(?:\\bwill|[a-z]'ll)\\s+(?:definitely\\s+|certainly\\s+|surely\\s+|almost certainly\\s+|probably\\s+)?${MOVE}\\b`, 'i')],
  // review B2: a promised result, a certainty stated as a negation, hype-predictive verbs
  ['will-profit', /(?:\bwill|[a-z]'ll)\s+(?:definitely\s+|certainly\s+|surely\s+|probably\s+)?(?:make (?:you )?(?:money|a profit|profits|gains?|bank)|profit|win|earn|pay off|be profitable|be a winner|be a big winner)\b/i],
  ['no-chance', /\b(?:zero|no|nil|little|almost no|essentially no|practically no)\s+(?:chance|way|risk|possibility)\s+(?:that\s+)?(?:this|it|that|the stock|the setup|the trade)\s+(?:\w+\s+)?(?:fails?|loses?|drops?|goes down|go down|breaks? down|doesn't work|won't work|reverses?)\b/i],
  ['hype', /\b(?:poised|primed|set|ready|due|destined|about)\s+to\s+(?:soar|explode|rip|rocket|moon|skyrocket|surge|rally|break ?out|take off|run|pop|fly|squeeze)\b|\bto the moon\b|\bcan't[- ]miss\b/i],
  ['going-to', new RegExp(`\\b(?:is|are|it's|its|this is|that's)\\s+(?:going to|gonna)\\s+${MOVE}\\b`, 'i')],
  ['cant-lose', /\bcan(?:'t|not|t)\s+(?:lose|fail|miss|go wrong|go down|go lower)\b/i],
  ['wont-lose', /\b(?:won't|wont|will not)\s+(?:lose|fail|miss|go wrong|go down|go lower|drop|fall|break down)\b/i],
  ['confident', /\b(?:i'm|i am|im|we're|we are|i feel)\s+(?:very\s+|pretty\s+|quite\s+|fairly\s+|really\s+|highly\s+|so\s+)?(?:confident|certain|convinced)\b/i],
  ['headed-to', /\b(?:heads?|headed|heading|going|goes|gets?|run(?:s|ning)?|climb(?:s|ing)?|rall(?:y|ies|ying)|ride (?:it|this|them|that))\s+(?:up\s+|back\s+|higher\s+|lower\s+|all the way\s+)?(?:to|toward|towards|for)\s+\$?\d/i],
  ['ride-it', /\bride (?:it|this|them|that)\s+(?:up|higher|to|all the way)\b/i],
  ['odds-favor', /\b(?:odds|chances|probabilit(?:y|ies))\s+(?:strongly\s+|heavily\s+|clearly\s+|really\s+)?(?:favou?r|are (?:good|high|great|strong|in (?:your|our|the bulls'?|the bears'?) favou?r))\b/i],
  ['sure-thing', /\b(?:sure (?:thing|bet|win|winner|shot)|for sure|dead cert|no[- ]brainer|slam dunk|lock)\b/i],
  ['certain', /\b(?:is|are|it's|its|this is|that's)\s+(?:a\s+)?(?:certain|definite|definitely|certainly|sure)\s+(?:to|thing|bet|win|winner)\b/i],
  ['buy-sell-now', /\b(?:buy|sell|short)\s+(?:it\s+|this\s+|them\s+|here\s+)?(?:now|today|immediately|right now|asap)\b/i],
  ['price-target', /\b(?:price target|target price|my target|a target of|targets? (?:is|are|at)?\s*\$?\d|should (?:hit|reach|get to|be at|trade at)\s+\$?\d|(?:upside|downside) to \$?\d)/i],
  ['always-works', /\b(?:always works?|never fails?|works every time|never loses?|always wins?|can only go (?:up|down|higher|lower)|has to (?:go|rally|bounce|drop|rise|fall)|bound to (?:go|rally|bounce|drop|rise|fall)|100 ?% (?:certain|sure|win|success|safe)|risk[- ]free|no (?:risk|downside|doubt)|zero risk|definitely (?:will|going)|without (?:a )?doubt|cannot fail|can't fail)\b/i],
]

export const ORDER = [
  ['trade-now', /\b(?:buy(?:ing)?|sell(?:ing)?|short(?:ing)?|cover(?:ing)?|go long|go short|get long|get short|enter|exit|load(?:ing)? up|size up|double down|trim(?:ming)?|take profits?|scale (?:in|out)|grab(?:bing)? (?:a |some )?(?:position|shares|stake)|open(?:ing)? a position|add to (?:your |the )?position)\b[^.!?\n]{0,40}?\b(?:now|today|here|immediately|right now|at the open|at open|before the close|into the close|tomorrow|premarket|pre-market)\b/i],
  ['shares', /\b(?:buy|sell|short|purchase|pick up|grab|dump|unload)\s+(?:\d[\d,]*\s+|some\s+|more\s+|a few\s+)?shares\b/i],
  ['place-order', /\b(?:place|put in|enter|submit|set|execute)\s+(?:an?\s+|the\s+|your\s+)?(?:buy|sell|limit|market|stop|stop-loss|bracket)?\s*(?:order|trade)\b/i],
  ['you-should', /\b(?:you should|you need to|you must|you have to|i would|i'd|i'd say|go ahead and|my advice is to|time to|consider|i'd be|i would be|i'm|i am)\s+(?:(?:buy|sell|short)(?:ing)?|cover|go long|go short|get in|get out|take the trade|take this trade|add|enter|exit|bail|dump)\b/i],
  // review B2: advice by recommendation, "you might want to", opening / building a position, "worth trading"
  ['recommend', /\b(?:recommend|suggest|advise|urge)\s+(?:that you\s+|you\s+)?(?:(?:buy|sell|short)(?:ing)?|picking up|adding|taking (?:a|the) (?:trade|position)|entering|getting (?:in|long|short)|going (?:long|short)|accumulat\w+|initiat\w+|opening a|starting a|a (?:starter|full|small|long|short) position|a position)\b/i],
  ['want-to', /\byou (?:might|may|could|should|would|will) (?:want|wish|like) to\s+(?:buy|sell|short|accumulate|add|enter|exit|initiate|start|open|pick up|grab|load|trim|get (?:in|long|short)|go (?:long|short))\b/i],
  ['position', /\b(?:initiat\w*|open(?:ing)?|start(?:ing)?|establish\w*|build(?:ing)?|take|taking)\s+(?:a |an |your )?(?:new |starter |small |full |initial )?(?:long |short )position\b/i],
  ['worth-trading', /\b(?:worth|good (?:time|spot|place|entry|idea)|great (?:time|spot|entry)|ideal (?:time|spot|entry))\s+(?:(?:trading|buying|selling|shorting|owning)\b|to (?:buy|sell|short|trade|initiate|enter|get in|start|own)\b)/i],
  ['load-up', /\bload(?:ing)? up\b|\btrim(?:ming)?\s+(?:half|some|a third|a quarter|\d)/i],
  ['take-trade', /\b(?:take|make) (?:the|this|that) trade\b|\bpull the trigger\b|\bget in (?:now|here|today)\b|\bget out (?:now|here|today)\b/i],
]

// ── pre-activation (held-out eval, 2026-11-03): advice / promise / hype BY CLASS — the server's CLASS_PATTERNS, the
// IDENTICAL pattern strings (tests/test_uct_agent_coach_guard.py compares them). GENERATED from guard.py; edit there.
export const CLASS_PATTERNS = [
  ["order", "advisory-stance", "\\b(?:i'?d|i would|i'm|i am|i will|i'll|personally|if i were you|in your (?:shoes|position)|my (?:move|play|pick|call|advice|suggestion|recommendation)|you (?:should|ought to|need to|must)(?: really)?|you'd (?:want|be wise|be smart|do well)|it (?:might|would|could|may) be (?:smart|wise|worth it|a good idea|prudent)|(?:might|could|would|it) make[s]? sense|go ahead and|time to|don't miss|you'd be (?:crazy|foolish|silly|mad) not to|many traders would|now'?s (?:a |the )?(?:good|great|perfect|ideal) (?:time|moment|spot))\\b[^.!?\\n]{0,40}?\\b(?:buy(?:ing|er|ers|s)?|sell(?:ing|er|s)?|short(?:ing)?|add(?:ing)? (?:to|some|more|exposure)|adding|accumulat\\w*|trim(?:ming)?|lighten(?:ing)?(?: up)?|take (?:profits?|gains|some off)|taking (?:profits?|gains)|get(?:ting)? (?:in|out|long|short|positioned)|positioned|own(?:ing)? (?:some|it|this|them|shares)|own some|exit(?:ing)?|enter(?:ing)?|load(?:ing)? (?:up|the boat)|pick(?:ing)? (?:some |it |them |a few )?up|grab(?:bing)?|scoop(?:ing)?|dump(?:ing)?|ditch(?:ing)?|cut(?:ting)? (?:it|this|the|your|losses|loser)|bail(?:ing)?(?: out)?|jump(?:ing)? in|pile (?:in|into)|go(?:ing)? (?:long|short|all in)|exposure|(?:a |an )?(?:small |starter |full |initial )?position|be in this|(?:this|the|that) entry)\\b"],
  ["order", "endorsed-trade", "\\b(?:buy(?:ing|er|ers|s)?|sell(?:ing|er|s)?|short(?:ing)?|add(?:ing)? (?:to|some|more|exposure)|adding|accumulat\\w*|trim(?:ming)?|lighten(?:ing)?(?: up)?|take (?:profits?|gains|some off)|taking (?:profits?|gains)|get(?:ting)? (?:in|out|long|short|positioned)|positioned|own(?:ing)? (?:some|it|this|them|shares)|own some|exit(?:ing)?|enter(?:ing)?|load(?:ing)? (?:up|the boat)|pick(?:ing)? (?:some |it |them |a few )?up|grab(?:bing)?|scoop(?:ing)?|dump(?:ing)?|ditch(?:ing)?|cut(?:ting)? (?:it|this|the|your|losses|loser)|bail(?:ing)?(?: out)?|jump(?:ing)? in|pile (?:in|into)|go(?:ing)? (?:long|short|all in)|exposure|(?:a |an )?(?:small |starter |full |initial )?position|be in this|(?:this|the|that) entry)\\b[^.!?\\n]{0,30}?\\b(?:(?:could|might|would|may|should|does|do|will) )?(?:makes? sense|be (?:smart|wise|the move|the play|a good idea)|is (?:smart|wise|the move|the play|a good idea))\\b"],
  ["order", "imperative", "(?:^|[.!?]\\s+|\\n)(?:buy|sell|short|grab|scoop|ditch|dump|bail|load|cut|add|trim|pile|go long|go short|get long|get short|get in|get out|back up the truck|take profits)\\b"],
  ["order", "trade-timing", "\\b(?:buy(?:ing|er|ers|s)?|sell(?:ing|er|s)?|short(?:ing)?|add(?:ing)? (?:to|some|more|exposure)|adding|accumulat\\w*|trim(?:ming)?|lighten(?:ing)?(?: up)?|take (?:profits?|gains|some off)|taking (?:profits?|gains)|get(?:ting)? (?:in|out|long|short|positioned)|positioned|own(?:ing)? (?:some|it|this|them|shares)|own some|exit(?:ing)?|enter(?:ing)?|load(?:ing)? (?:up|the boat)|pick(?:ing)? (?:some |it |them |a few )?up|grab(?:bing)?|scoop(?:ing)?|dump(?:ing)?|ditch(?:ing)?|cut(?:ting)? (?:it|this|the|your|losses|loser)|bail(?:ing)?(?: out)?|jump(?:ing)? in|pile (?:in|into)|go(?:ing)? (?:long|short|all in)|exposure|(?:a |an )?(?:small |starter |full |initial )?position|be in this|(?:this|the|that) entry)\\b[^.!?\\n]{0,30}?\\b(?:at (?:this|these|current) (?:level|levels|price|prices)|on (?:any |the )?(?:dip|dips|pullback|weakness)|while it'?s (?:cheap|low|down)|before (?:the open|the move|it runs|everyone|earnings)|this week|right away)\\b"],
  ["unsupported", "prediction", "(?:\\b(?:should|will|is going to|are going to|gonna|is set to|is about to|is ready to|is due to|is headed|are headed|is heading|are heading|heads?|headed|heading)|[a-z]'ll)\\s+(?:\\w+\\s+){0,2}?(?:outperform\\w*|much higher|much lower|a lot higher|way higher|new highs|explode|take off|soar|skyrocket|keep (?:going|climbing|running|rising|working))\\b|(?:\\bwill|[a-z]'ll) be (?:much |a lot |way )?(?:higher|lower)\\b|\\bthe (?:bottom|top) is in\\b"],
  ["unsupported", "certainty", "\\bnothing (?:can|will|is going to) stop\\b|\\brest assured\\b|\\bthere(?:'s| is) no (?:question|doubt)\\b|\\bwon't regret\\b|\\bno[- ]lose\\b|\\bcan(?:'t|not)[- ]lose\\b|\\bhigh[- ]probability (?:winner|trade|setup|win)\\b|\\bodds (?:look|are|seem) (?:excellent|great|very good|overwhelming)\\b"],
  ["unsupported", "hype-noun", "\\b(?:screaming buy|easy money|free money|rocket ?ship|printing money|money printer|stock of the (?:year|decade|century)|monster in the making|load the boat|back up the truck|to the moon|moonshot|home run|sure winner|lay-?up trade|can't[- ]miss)\\b"],
]
for (const [code, name, pat] of CLASS_PATTERNS) (code === 'order' ? ORDER : UNSUPPORTED).push([name, new RegExp(pat, 'i')])

export const OUTCOME = /\b(?:will|likely|unlikely|probab\w*|odds|chances?|expect\w*|outcomes?|follow[- ]?through|work(?:s|ed)? out|play(?:s|ed)? out|next (?:move|session|week|day|leg)|going to|gonna|succeed\w*|fail\w*|targets?|upside|downside|forecast\w*|predict\w*|rally|rallies|bounce\w*|break ?outs?|breakdowns?|continu\w*|resolv\w*|should (?:hold|work|go|rally|bounce))\b/i
export const HEDGE = /\b(?:may|might|could|often|sometimes|tends? to|tend|not guaranteed|no guarantee|no guarantees|isn't guaranteed|uncertain\w*|not certain|no certainty|no way to know|cannot know|can't know|nobody knows|unknown|doesn't always|does not always|not always|don't always|do not always|depends|historically|in the past|hypothesis|one input|not a forecast|not a prediction|not a promise|not predictions|can fail|could fail|might fail|may fail|can reverse|could reverse|can break|could break|can still|could still|may still|no pattern|cannot be known|can't be known|possibility|possible|possibly|perhaps|not a signal|not a rule|not rules|estimate\w*)\b/i

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

// a NEGATED universal ("neither approach works every time") is a hedge, not a claim (the server's _NEGATED_UNIVERSAL)
const NEGATED_UNIVERSAL = /\b(?:no|neither|not|nothing|none|never)\b[^.!?\n]{0,30}?\b(?:works? every time|always works?|always wins?)\b/gi
// a DESCRIPTION of what other people do is not advice: a trade-timing match in a sentence that starts with a third-person
// subject is skipped (the server's _DESCRIPTIVE / _described)
const DESCRIPTIVE = /^\s*(?:some|many|most|other|few|these|those)?\s*(?:traders|investors|people|buyers|sellers|institutions|funds|others|bulls|bears)\b/i
function described(rx, t) {
  const g = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : `${rx.flags}g`)
  const starts = [...t.matchAll(g)].map(m => m.index)
  if (!starts.length) return false
  return starts.every((start) => {
    const s = Math.max(t.lastIndexOf('.', start - 1), t.lastIndexOf('!', start - 1), t.lastIndexOf('?', start - 1), t.lastIndexOf('\n', start - 1)) + 1
    return DESCRIPTIVE.test(t.slice(s, start + 1))
  })
}
export const unsupported = (text) => { const t = normalize(text).replace(NEGATED, ' ').replace(NEGATED_UNIVERSAL, ' '); return UNSUPPORTED.filter(([, rx]) => rx.test(t)).map(([n]) => n) }
export const orderLanguage = (text) => { const t = normalize(text); return ORDER.filter(([n, rx]) => rx.test(t) && !(n === 'trade-timing' && described(rx, t))).map(([n]) => n) }
export function untraceableFigures(text, inputs) {
  const allowed = figures(inputText(inputs))
  return [...figures(text)].filter(f => !allowed.has(f)).sort()
}
export const aboutOutcomes = (text) => OUTCOME.test(normalize(text))
/** A real hedge — the mandated footer is stripped first, so it never stands in for one (W3 review C2). */
export const hasHedge = (text) => { const t = normalize(text).replace(FOOTER_RX, ' '); NEGATED_UNIVERSAL.lastIndex = 0; return HEDGE.test(t) || NEGATED_UNIVERSAL.test(t) }

/** The violation codes of a text (empty = clean), in CODES order. */
export function check(text, inputs = null) {
  const codes = []
  if (unsupported(text).length) codes.push('unsupported')
  if (orderLanguage(text).length) codes.push('order')
  if (untraceableFigures(normalize(text), inputs).length) codes.push('figure')
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
