// UCT Agent market data — the shared, PURE phrase parser behind the price and daily-bars fast paths (owner: agent-md).
// The list it is held to is docs/agent/program/contracts/MD-1-phrasings.md; agentDataPhrases.test.js runs every row.
//
// The rules (MD-1-phrasings §1):
//   • pure and fail-closed: no I/O, no clock; `null` means "not mine, or not sure" and the sentence goes on to the
//     normal path. It never guesses.
//   • an ambiguous ticker (CAN, ALL, NOW, LOW, IT, …) counts only with a `$` prefix or written in UPPERCASE.
//   • more than one ticker needs a list separator (and / , / &); more than MAX_TICKERS is a list, not a price ask.
//   • a fixed typo list only — no fuzzy matching.

export const MAX_TICKERS = 5

// English words that are also listed symbols: a ticker only when `$`-prefixed or written in UPPERCASE.
export const AMBIGUOUS = new Set(['CAN', 'ALL', 'NOW', 'LOW', 'IT', 'ON', 'A', 'ARE', 'SO', 'BE', 'GO', 'DO', 'FOR',
  'ONE', 'REAL', 'OPEN', 'HAS', 'KEY', 'FAST', 'CAR', 'PLAY', 'SEE', 'TRUE', 'WELL', 'LOVE', 'AT', 'BIG', 'NEW', 'OUT',
  'ANY', 'HE', 'AM', 'PM', 'AH', 'UP', 'TWO', 'MAN', 'RUN', 'EAT', 'FUN', 'HOT', 'JOB', 'LIFE', 'MOVE', 'NICE', 'PEAK',
  'SAFE', 'SHOP', 'SNOW', 'STAY', 'TECH', 'VERY', 'WISH', 'YOU', 'EVER', 'WEEK', 'DAY', 'CASH', 'GAIN', 'BEST', 'HIGH'])

// ordinary words that are never tickers in a price question (lowercase forms)
const STOP = new Set(('what whats where wheres how hows is are was the a an of for me get got give show tell please '
  + 'price prices pricing quote quotes trading trade traded at doing today todays premarket pre market mkt pm after '
  + 'hours hour afterhours ah postmarket post overnight and or vs versus close closed closing did yesterday yesterdays '
  + 'day days daily week weeks past last change changes performance high low year years w wk d can you i my it up '
  + 'down now right on in to with by from much many does do so be has have hi hey ok okay pls thx thanks just quick '
  + 'currently current latest stock stocks share shares ticker tickers check look lookup also both all session sessions '
  + 'move moved moving go going this that').split(/\s+/))

const TYPOS = { wats: "what's", whats: "what's", wat: 'what', tradin: 'trading', tradeing: 'trading', pirce: 'price',
  prcie: 'price', pric: 'price', qoute: 'quote', quoet: 'quote', premarkt: 'premarket', premaket: 'premarket',
  prmarket: 'premarket', afterhour: 'afterhours', overnite: 'overnight', clsoe: 'close', 'cloes': 'close' }

// a sentence about one of these is not a price read (MD-1-phrasings §1.7)
const VETO = [/\bwhy\b/, /\bnews\b/, /\bmarket\s*cap\b/, /\bp\/?e\b/, /\bpe ratio\b/, /\bearnings?\b/, /\bcalls?\b/,
  /\bputs?\b/, /\boptions?\b/, /\bflow\b/, /\bdark\s*pool/, /\balerts?\b/, /\btell me when\b/, /\bnotify\b/,
  /\bhits?\b/, /\bcross(es)?\b/, /\bthis (week|month|year)\b/, /\bwatchlist\b/, /\bchart\b/, /\bdividend/,
  /\bbuy\b/, /\bsell\b/, /\bshould i\b/, /\btarget\b/, /\bforecast\b/, /\bpredict/,
  // chart commands that share a price word ("show nvda at 5 minutes", "add rsi at 14"): never a quote
  /\b\d+\s*(m|min|mins|minutes?|h|hr|hrs|hourly)\b/, /\btime\s*frame\b/, /\bindicators?\b/, /\b(rsi|macd|ema|sma|vwap|bollinger)\b/,
  /\b\d{1,2}(:\d\d)?\s*(am|pm)\b/, /\bzoom\b/, /\bdraw/, /\bswitch\b/, /\bopen\b.*\bchart/]

const PRICE_CTX = /\b(price|prices|pricing|quote|quotes|trading|trade at|traded at|at|doing|worth|up|down)\b|\b(pre[\s-]?(market|mkt)|premarket|after[\s-]?hours|afterhours|ah|post[\s-]?market|overnight)\b/
const SESSION_WORD = /\b(pre[\s-]?(market|mkt)|premarket|after[\s-]?hours|afterhours|post[\s-]?market|overnight)\b/

const TOKEN = /^\$?[A-Za-z][A-Za-z0-9]{0,5}([.-][A-Za-z])?$/

function normalise(text) {
  let s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').trim()
  s = s.split(/\s+/).map(w => (TYPOS[w.toLowerCase()] ? TYPOS[w.toLowerCase()] : w)).join(' ')
  return s
}

/** The tickers named in `s`, in order, or null when the sentence is ambiguous about them. */
export function tickersOf(s) {
  const raw = s.split(/[\s,&/]+/).filter(Boolean)
  const out = []
  for (let w of raw) {
    w = w.replace(/^[("']+|[)"':;]+$/g, '').replace(/'s$/i, '')
    if (!w || !TOKEN.test(w)) continue
    const cash = w.startsWith('$')
    const bare = cash ? w.slice(1) : w
    const up = bare.toUpperCase()
    if (cash) { if (!out.includes(up)) out.push(up); continue }
    if (AMBIGUOUS.has(up)) {
      if (bare === up && bare.length > 1 && !out.includes(up)) out.push(up)   // UPPERCASE: the member means the symbol
      continue
    }
    if (STOP.has(bare.toLowerCase())) continue
    if (/^\d/.test(bare)) continue
    if (bare.length > 5 && !/[.-]/.test(bare)) continue
    if (!out.includes(up)) out.push(up)
  }
  return out
}

/**
 * Parse one member sentence into a price/bars intent, or null.
 *   { intent: 'quote', symbols, sessionWord }                    price / quote / session words
 *   { intent: 'bars.lastClose' | 'bars.change' | 'bars.range52w', symbol, n? }
 */
export function parsePriceSentence(text) {
  const s = normalise(text)
  if (!s || s.length > 160) return null
  const low = s.toLowerCase()
  if (VETO.some(re => re.test(low))) return null
  const syms = tickersOf(s)
  if (!syms.length || syms.length > MAX_TICKERS) return null
  if (syms.length > 1 && !/(\band\b|,|&)/i.test(s)) return null

  // daily bars: completed sessions only (claimed by marketDataBars.js)
  if (/\b52[\s-]?(weeks?|wks?|w)\b|\byear(ly)?[\s-](high|low|range)\b|\b(12|twelve)[\s-]month (high|low|range)\b/.test(low)) {
    return syms.length === 1 ? { intent: 'bars.range52w', symbol: syms[0] } : null
  }
  const nd = low.match(/\b(\d{1,3})[\s-]?(day|d|session)s?\b/) || low.match(/\bpast (\d{1,2}) (day|session)s\b/)
  const nw = low.match(/\b(\d{1,2})[\s-]?(week|wk)s?\b/)
  if (nd || nw) {
    const n = nd ? Number(nd[1]) : Number(nw[1]) * 5
    return syms.length === 1 && n >= 1 && n <= 499 ? { intent: 'bars.change', symbol: syms[0], n } : null
  }
  if (/\b(close|closed|closing)\b/.test(low)) {
    return syms.length === 1 && !SESSION_WORD.test(low) ? { intent: 'bars.lastClose', symbol: syms[0] } : null
  }

  // a quote: a price word, a session word, or a bare cashtag
  const bareCashtags = /^(\$[A-Za-z][A-Za-z0-9.-]{0,9}[\s,&]*)+(and\s+\$[A-Za-z][A-Za-z0-9.-]{0,9}\s*)*$/.test(s)
  if (!PRICE_CTX.test(low) && !bareCashtags) return null
  if (/\btoday\b/.test(low) && !/\b(price|quote|trading|doing|at|up|down)\b/.test(low)) return null
  const m = low.match(SESSION_WORD)
  return { intent: 'quote', symbols: syms, sessionWord: m ? m[0] : null }
}
