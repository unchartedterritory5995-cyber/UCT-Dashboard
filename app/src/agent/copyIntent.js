// ── D18 item 3 (owner, 2026-11-14): REUSE A DISPLAYED CHART BY DEFAULT — a copy only on explicit, structurally-read intent ──
//
// A request names a set of symbols to chart. A symbol a chart on the board already shows (on the timeframe asked, or with no
// timeframe asked) is THAT chart; a new chart is created only when the words attach COPY INTENT to that symbol or to the chart
// noun it heads. Read structurally — what is attached to the symbol's own noun phrase — never a list of whole phrases:
//
//   copy intent (per symbol)                       not copy intent
//   ordinal ≥ 2      "a second NVDA", "2nd nvda chart" "the second chart" (a position, no symbol bound)
//   cardinal > shown "two NVDA charts" (1 shown → 1)   a count equal to the set ("4 charts: SPY QQQ NVDA AMD")
//   additive quant.  "another NVDA", "one more SPY",  "new charts for AAPL, MSFT and NVDA" (an adjective on a SET)
//                    "a new NVDA chart" (bound to ONE symbol)
//   iterative adv.   "SPY again", "NVDA twice"         "open / add / show / put / bring up NVDA"
//   copy verb/noun   "duplicate the NVDA chart", "a copy of SPY"   a quantifier on another noun ("another indicator")
//
// SET-LEVEL "N more charts" (D18 item 2): with no symbol, N new charts (unchanged); with symbols some of which are displayed
// ("add 2 more charts for NVDA and AAPL", NVDA shown) it is NOT copy intent — it is ASKED (use your NVDA chart / open a second
// NVDA), nothing written before the pick (setMoreSymbols).
// Pure: words in, counts out.

const ORD = { second: 2, third: 3, fourth: 4, fifth: 5, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 }
const CARD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const CHART_NOUN = /^(?:charts?|panels?|views?|ones?)$/i
const CLAUSE = /^(?:,|;|\.|then|but|while|so)$/i
const VERBS = /^(?:add|open|show|put|bring|pull|load|set|make|create|give|throw|include|chart|display|keep|leave|replace|swap|change|switch|remove|close)$/i
const tok = (words) => (String(words || '').match(/\$?[A-Za-z0-9][A-Za-z0-9.]*|[,;.]|\+|&/g) || []).map(t => t.replace(/^\$/, ''))
const num = (t) => (/^\d+$/.test(t) ? Number(t) : CARD[t.toLowerCase()] ?? null)

const isSym = (t, syms) => syms.includes(String(t).toUpperCase())

// the words that may stand in a symbol's own noun phrase BEFORE it: determiners, numbers, ordinals, quantifiers, timeframe and
// chart-style adjectives. Walking back from the symbol stops at any other word — so "another indicator on NVDA" binds nothing
const SPAN = /^(?:a|an|the|my|our|one|two|three|four|five|six|seven|eight|nine|\d+|second|third|fourth|fifth|2nd|3rd|4th|5th|another|more|extra|daily|weekly|monthly|hourly|intraday|1h|4h|candle|candlestick|line|bar|new)$/i
const COPY_HEAD = /^(?:duplicate|copy|clone)$/i
/** The modifiers bound to the token at `i` (walking back over SPAN words; a copy verb ends the span and is included). */
function boundBefore(ts, i) {
  const out = []
  for (let j = i - 1; j >= 0; j--) {
    const t = ts[j].toLowerCase()
    if (COPY_HEAD.test(t)) { out.unshift(t); break }
    if (!SPAN.test(t)) break
    out.unshift(t)
  }
  return out
}
const countIn = (mods) => {
  let n = 0
  for (let k = 0; k < mods.length; k++) {
    const m = mods[k]
    if (ORD[m] >= 2) n = Math.max(n, ORD[m] - 1)                                   // "a second NVDA" → 1
    if (m === 'another' || m === 'extra' || m === 'new' || COPY_HEAD.test(m)) n = Math.max(n, 1)  // "another NVDA", "a new NVDA chart", "duplicate the NVDA chart"
    if (m === 'more') n = Math.max(n, num(mods[k - 1] || '') ?? 1)                // "one more SPY", "2 more NVDA charts"
  }
  return n
}

/**
 * { SYM: copies } for each symbol in `symbols` the words attach copy intent to (absent = 0). `shown` = { SYM: n displayed } for the
 * cardinal rule ("two NVDA charts" with one shown → 1 copy).
 */
export function readCopyIntent(words, symbols, shown = {}) {
  const ts = tok(words)
  const syms = (symbols || []).map(s0 => String(s0).toUpperCase())
  const out = {}
  ts.forEach((t, i) => {
    if (!isSym(t, syms)) return
    const S = t.toUpperCase()
    const nS = shown[S] || 0
    // (1) the symbol's own phrase: "a second NVDA", "another nvda chart", "one more SPY", "duplicate the NVDA chart"
    const mods = boundBefore(ts, i)
    let n = countIn(mods)
    // a cardinal bound to "SYM chart(s)" greater than shown: "two NVDA charts" (1 shown → 1)
    const card = num(mods[mods.length - 1] || '')
    if (card && CHART_NOUN.test(ts[i + 1] || '') && card > nS) n = Math.max(n, card - nS)
    // (2) "<mods> chart(s) of / for SYM": the chart noun's own modifiers ("a second chart of NVDA", "a copy of SPY")
    const prep = (ts[i - 1] || '').toLowerCase()
    if ((prep === 'of' || prep === 'for') && i >= 2) {
      const head = ts[i - 2].toLowerCase()
      if (COPY_HEAD.test(head)) n = Math.max(n, 1)
      else if (CHART_NOUN.test(head) && !/s$/i.test(head)) n = Math.max(n, countIn(boundBefore(ts, i - 2)))
    }
    // (3) an iterative adverb right after the symbol (or its chart noun): "SPY again", "NVDA twice", "a NVDA chart again"
    const next = ts.slice(i + 1, i + 3).map(x => x.toLowerCase())
    const adv = CHART_NOUN.test(next[0] || '') ? next[1] : next[0]
    if (adv === 'again') n = Math.max(n, 1)
    if (adv === 'twice') n = Math.max(n, 2 - Math.min(1, nS))
    if (n) out[S] = Math.max(out[S] || 0, n)
  })
  return out
}

/** D18 item 2: a SET-level "N more charts for A, B…" — the symbols bound to that phrase, or null. ("add 4 more charts": []) */
export function setMoreSymbols(words, symbols) {
  const ts = tok(words)
  const syms = (symbols || []).map(s => String(s).toUpperCase())
  for (let i = 0; i < ts.length; i++) {
    // "N more charts for …", and "N new charts for …" (a count of NEW charts for a set: the same question)
    const w = ts[i].toLowerCase()
    if (!(w === 'more' || (w === 'new' && num(ts[i - 1] || '') != null)) || !CHART_NOUN.test(ts[i + 1] || '')) continue
    // more + chart noun → its objects: "for / of / with" + symbols, up to the clause end
    const got = []
    // (a comma inside the ticker list — "for SPY, QQQ, NVDA and TSLA" — does not end it)
    const listGoesOn = (j) => ts[j] === ',' && (isSym(ts[j + 1] || '', syms) || /^(?:and|&|\+)$/i.test(ts[j + 1] || ''))
    for (let j = i + 2; j < ts.length && (!CLAUSE.test(ts[j]) || listGoesOn(j)) && !VERBS.test(ts[j]); j++) if (isSym(ts[j], syms)) got.push(ts[j].toUpperCase())
    return got
  }
  return null
}
