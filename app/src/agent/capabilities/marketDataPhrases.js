// UCT Agent market data — the shared, PURE INTENT parser behind the price and daily-bars fast paths (owner: agent-md).
// Contract: MD-1 §4.7.1. The rows it is held to: docs/agent/program/contracts/MD-1-phrasings.md.
//
// It decides only WHAT is being asked — a current quote, a last close, an N-session change, a 52-week range, or none —
// and which words are CANDIDATES for a security, recorded exactly as the member typed them. It never decides what a
// word refers to: that is the server's `instrument.resolve`, from UCT's canonical symbol index (§4.7.2). So nothing
// here is a list of tickers, companies, commodities or coins; the lists below are intent GRAMMAR only.
//
// Not claimed (null → the model, as today): a time it cannot resolve without a clock, a different request (why, news,
// options, alerts …), `&`, more than MAX_TICKERS candidates, two candidates without "and" / "," (unless all are `$`),
// or a sentence with no candidate. Pure and fail-closed: no I/O, no clock.

export const MAX_TICKERS = 5

// Intent grammar. A word here is never a candidate when typed lowercase. ALWAYS_GRAMMAR words are never candidates
// in any case ("NVDA PRICE", "TSLA AH"); the rest become candidates when typed UPPERCASE in a mixed-case sentence,
// because the member then wrote a symbol ("what's IT trading at", "what's NOW at").
const ALWAYS_GRAMMAR = new Set(('price prices pricing quote quotes trading traded premarket pre market mkt afterhours ah '
  + 'postmarket post overnight close closed closing change changes performance day days week weeks wk wks session '
  + 'sessions range today todays currently current latest what whats where wheres how hows the of me please pls '
  + 'is are was and vs versus').split(/\s+/))
const GRAMMAR = new Set([...ALWAYS_GRAMMAR, ...('a an get got give show tell trade at doing did d w past last high low '
  + 'year years yearly month months twelve can you i my it its up down on in to with by from much does do hi hey ok '
  + 'okay just quick stock stocks share shares check look lookup also both move moved moving sitting right now for '
  + 'pm hours hour after rn').split(/\s+/)])                     // rn = "right now" (agent-qa set 3, A10)

// CG-15 / CG-22 (corpus #769 / #774): everyday words the member typed in LOWER case are never a ticker — "move the 200 line
// up to 210" is a drawing, "trade places with the left and right charts" a swap. A sentence that leans on one of them is
// not a price question at all, so the reader steps aside (the request goes on to its own capability or the model). A
// ticker is still read when typed $-prefixed or in capitals ("$LINE", "LINE").
const NOT_A_TICKER = new Set(('line lines places place left charts chart level levels drawing drawings top bottom middle side sides '
  // "sort by price" / "hide the price column" is a list widget's column, never a quote for SORT or HIDE
  + 'sort sorted sorting rank ranked ranking hide column columns list lists scan scans scanner first lowest highest biggest smallest ascending descending '
  + 'board widget widgets panel panels screen screens layout layouts window windows grid label labels colour color colors colours '
  + 'average averages one ones each every other those these them that this thing things alert alerts tab tabs pane panes '
  + 'indicator indicators study studies box boxes ray rays fib trendline trendlines arrow arrows note notes '
  // CG-23 (corpus #774): a chart's look — "make the up candles blue and the down candles orange"
  + 'candle candles bar bars wick wicks body bodies background theme blue orange red green yellow purple pink white black '
  + 'gray grey brown teal cyan magenta make set turn paint colour color recolor recolour add remove draw hide '
  + 'thick thin dashed dotted solid bold').split(/\s+/))

const QUOTE_FRAME = /\b(?:price|prices|pricing|quote|quotes|how much is|trading at|trade at|premarket|pre-market|after ?hours|overnight)\b/

// intent words only (never a symbol): the parser's own fixed typo list (MD-1-phrasings §1.6)
const TYPOS = { wats: "what's", whats: "what's", wat: 'what', tradin: 'trading', tradeing: 'trading', pirce: 'price',
  prcie: 'price', pric: 'price', qoute: 'quote', quoet: 'quote', premarkt: 'premarket', premaket: 'premarket',
  prmarket: 'premarket', afterhour: 'afterhours', overnite: 'overnight', clsoe: 'close', cloes: 'close' }

// a different request: not a price read
const VETO = [/\bwhy\b/, /\bnews\b/, /\bmarket\s*cap\b/, /\bp\/?e\b/, /\bpe ratio\b/, /\bearnings?\b/, /\bcalls?\b/,
  /\bputs?\b/, /\boptions?\b/, /\bflow\b/, /\bdark\s*pool/, /\balerts?\b/, /\btell me when\b/, /\bnotify\b/,
  /\bhits?\b/, /\bcross(es)?\b/, /\bwatchlist\b/, /\bchart\b/, /\bdividend/, /\bbuy\b/, /\bsell\b/, /\bshould i\b/,
  /\btarget\b/, /\bforecast\b/, /\bpredict/, /\bfutures?\b/, /\bvolume\b/, /\beuros?\b|\bpounds?\b|\byen\b|\bin [a-z]+ (dollars|currency)\b/,
  /\b\d+\s*(m|min|mins|minutes?|h|hr|hrs|hourly)\b/, /\btime\s*frame\b/, /\bindicators?\b/, /\b(rsi|macd|ema|sma|vwap|bollinger)\b/,
  /\b\d{1,2}(:\d\d)?\s*(am|pm)\b/, /\bzoom\b/, /\bdraw/, /\bswitch\b/, /\bopen\b.*\bchart/,
  // CG-15 (corpus #769): "trade places with the left and right charts" is a board swap, never a quote for PLACES / LEFT / CHARTS
  /\bcharts\b/, /\b(?:trade|switch|swap|change|exchange) places\b/, /\bswap\b/, /\bwidgets?\b/, /\bpanels?\b/]

// a time the parser cannot resolve without a clock: never "now", never "the last session" (§4.7.1)
const TIME_VETO = [/\bhistor(y|ical|ic)\b/, /\bago\b/, /\bsince\b/, /\bbefore\b/, /\buntil\b/, /\byesterday('?s)?\b/,
  /\btomorrow\b/, /\btonight\b/, /\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?s?\b/,
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/,
  /\b\d{1,2}\/\d{1,2}\b/, /\b\d{4}-\d{2}(-\d{2})?\b/, /\b(19|20)\d\d\b/, /\b(this|last|next) (week|month|quarter|year|session)\b/,
  /\ball[\s-]?time\b/, /\bytd\b/, /\byear[\s-]to[\s-]date\b/, /\bmtd\b/, /\bqtd\b/, /\bwtd\b/, /\bttm\b/, /\bntm\b/, /\bopen(ing)? (price|print)\b/,
  /\bon (the )?\d/, /\bintraday\b/, /\btoday'?s (high|low|open|range)\b/, /\b(high|low) today\b/]

const TOKEN = /^\$?[A-Za-z][A-Za-z0-9]{0,9}([.-][A-Za-z]{1,2})?$/
const SESSION_RE = /\b(pre[\s-]?(market|mkt)|premarket|after[\s-]?hours|afterhours|post[\s-]?market|overnight)\b/

function normalise(text) {
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').trim()
  return s.split(/\s+/).map(w => TYPOS[w.toLowerCase()] || w).join(' ')
}

/** How a candidate was typed: `cashtag` ($nvda), `upper` (NVDA), or `lower` (nvda, Nvda). */
export function formOf(text, sentenceIsAllCaps = false) {
  if (String(text).startsWith('$')) return 'cashtag'
  const bare = String(text)
  if (!sentenceIsAllCaps && bare.length > 1 && bare === bare.toUpperCase() && /[A-Z]/.test(bare)) return 'upper'
  return 'lower'
}

/**
 * The candidate words of `s`, in order, each { text, form } — or null when a word is neither grammar nor a possible
 * symbol (a shape the parser does not claim).
 */
export function candidatesOf(s) {
  const letters = s.replace(/[^A-Za-z]/g, '')
  const allCaps = letters.length > 0 && letters === letters.toUpperCase()
  const out = []
  for (let w of s.split(/[\s,/]+/).filter(Boolean)) {
    w = w.replace(/^[("']+|[)"':;]+$/g, '').replace(/'s$/i, '').replace(/'$/, '')
    if (!w) continue
    if (/^\d+([.-]\d+)?$/.test(w) || /^\d+[-]?(day|d|week|wk|w|session)s?$/i.test(w) || /^52[-]?(w|wk|week)s?$/i.test(w)) continue
    const lower = w.toLowerCase().replace(/'/g, '')
    if (/^(what|where|how|it|that)'(s|re)$/i.test(w)) continue
    const form = formOf(w, allCaps)
    if (ALWAYS_GRAMMAR.has(lower)) continue
    if (GRAMMAR.has(lower) && form === 'lower') continue
    if (!TOKEN.test(w)) return null
    if (!out.some(c => c.text.toUpperCase().replace(/^\$/, '') === w.toUpperCase().replace(/^\$/, ''))) {
      out.push({ text: form === 'lower' ? w.toLowerCase() : w, form })
    }
  }
  return out
}

/**
 * One member sentence → an intent with its candidate words, or null.
 *   { intent: 'quote', candidates, sessionWord }
 *   { intent: 'bars.lastClose' | 'bars.change' | 'bars.range52w', candidates (exactly one), n? }
 */
export function parsePriceSentence(text) {
  const s = normalise(text)
  if (!s || s.length > 160) return null
  const low = s.toLowerCase()
  if (/&/.test(s)) return null
  if (VETO.some(re => re.test(low)) || TIME_VETO.some(re => re.test(low))) return null
  // CG-15/22/23: an everyday word typed in lower case is DROPPED as a candidate (never a ticker) — the rest still read
  // ("price of nvda and set" prices NVDA); a sentence left with none is not a price question at all
  const all = candidatesOf(s)
  const candidates = all ? all.filter(c => !(c.form === 'lower' && NOT_A_TICKER.has(c.text))) : null
  if (!candidates || !candidates.length || candidates.length > MAX_TICKERS) return null
  // a sentence that leaned on an everyday word ("add a horizontal level at 200", "close the Swing tab") is not a price
  // question unless it SAYS so — a clear quote frame or a $ ticker keeps the rest ("price of nvda and set" → NVDA)
  if (all.length !== candidates.length && !QUOTE_FRAME.test(low) && !candidates.some(c => c.form === 'cashtag')) return null
  const allCash = candidates.every(c => c.form === 'cashtag')
  if (candidates.length > 1 && !allCash && !/(\band\b|,)/i.test(s)) return null
  // a list ("X and Y", "X, Y") must have a candidate in EVERY item: "nvda and on price" names two things, one of which
  // the grammar swallowed, so pricing NVDA alone would answer half the question (agent-qa set 3, C12)
  if (/(\band\b|,)/i.test(s) && s.split(/,|\band\b/i).some(seg => seg.trim() && !(candidatesOf(seg) || []).length)) return null

  if (/\b52[\s-]?(weeks?|wks?|w)\b|\byear(ly)?[\s-](high|low|range)\b|\b(12|twelve)[\s-]month (high|low|range)\b/.test(low)) {
    return candidates.length === 1 ? { intent: 'bars.range52w', candidates } : null
  }
  const nd = low.match(/\b(\d{1,3})[\s-]?(day|d|session)s?\b/) || low.match(/\bpast (\d{1,2}) (day|session)s\b/)
  const nw = low.match(/\b(\d{1,2})[\s-]?(week|wk)s?\b/)
  if (nd || nw) {
    const n = nd ? Number(nd[1]) : Number(nw[1]) * 5
    return candidates.length === 1 && n >= 1 && n <= 499 && /\b(change|changes|performance|move|moved|past|last|up|down)\b/.test(low)
      ? { intent: 'bars.change', candidates, n } : null
  }
  if (/\b(month|months|year|years|quarter)\b/.test(low)) return null
  if (/\b(close|closed|closing)\b/.test(low)) {
    return candidates.length === 1 && !SESSION_RE.test(low) && !/\btoday\b/.test(low)
      ? { intent: 'bars.lastClose', candidates } : null
  }
  const PRICE_CTX = /\b(price|prices|pricing|quote|quotes|trading|trade|traded|at|doing|up|down)\b/
  const onlyCashtags = allCash && s.split(/[\s,]+/).filter(Boolean).every(w => /^\$/.test(w) || /^and$/i.test(w))
  if (!PRICE_CTX.test(low) && !SESSION_RE.test(low) && !onlyCashtags) return null
  if (/\b(high|low|range)\b/.test(low) && !candidates.some(c => /^(HIGH|LOW)$/.test(c.text))) return null
  if (!strictTickerAllows(low, candidates)) return null          // STUDY switch below; OFF in production
  const m = low.match(SESSION_RE)
  return { intent: 'quote', candidates, sessionWord: m ? m[0] : null }
}

// ── STUDY: a stricter contextual ticker rule (agent-qa; owner-approved for investigation and testing ONLY) ──────────
// Proposed rule: a word typed in LOWER case is a ticker candidate only after a clear price frame ("price of", "quote",
// "how much is", "trading at", premarket, after hours) or when $-prefixed; UPPERCASE words the member typed still
// count. It gates the QUOTE reading only (last close / N-session change / 52-week range are untouched). When a lowercase
// candidate fails the rule the reader steps aside (null → the model), as the list rule above does: pricing the other
// candidates alone would answer half the question. Measured in qa/strictTickerRuleStudy.test.js.
//   'off'   today's behaviour — the PRODUCTION DEFAULT; nothing in the product sets this switch
//   'frame' a clear price frame anywhere in the sentence ("nvda price" passes)
//   'after' the lowercase word must come AFTER the frame — the rule read literally ("price of nvda" passes, "nvda price" does not)
export const STRICT_TICKER_MODES = Object.freeze(['off', 'frame', 'after'])
let strictTickerMode = 'off'
export function strictTickerRule() { return strictTickerMode }
/** Test/study hook. Returns the previous mode so a caller can restore it. */
export function setStrictTickerRule(mode) {
  if (!STRICT_TICKER_MODES.includes(mode)) throw new Error(`unknown strict ticker mode: ${mode}`)
  const prev = strictTickerMode
  strictTickerMode = mode
  return prev
}
const STRICT_FRAME = /\b(?:price|prices|pricing|quote|quotes|how much is|trading at|trade at|pre[\s-]?market|premarket|pre[\s-]?mkt|after[\s-]?hours|afterhours)\b/g

function strictTickerAllows(low, candidates) {
  if (strictTickerMode === 'off') return true
  const lowers = candidates.filter(c => c.form === 'lower')
  if (!lowers.length) return true
  const frames = [...low.matchAll(STRICT_FRAME)]
  if (!frames.length) return false
  if (strictTickerMode === 'frame') return true
  const after = low.slice(frames[0].index + frames[0][0].length)
  return lowers.every(c => new RegExp(`(^|[^a-z0-9$])${c.text.replace(/[.-]/g, '\\$&')}($|[^a-z0-9])`).test(after))
}
