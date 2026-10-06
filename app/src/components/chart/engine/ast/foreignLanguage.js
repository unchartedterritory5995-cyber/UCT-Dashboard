// app/src/components/chart/engine/ast/foreignLanguage.js
//
// ─── ⭐⭐ RECOGNISING WHAT WE CANNOT READ, BY NAME ───────────────────────────
//
// ⛔⛔ THE FIRST MOMENT OF CONTACT WAS CONFIDENTLY WRONG. Measured: MQL5,
// EasyLanguage and NinjaScript all detect as `pcf`, because TC2000's markers are
// loose by nature — uppercase identifiers and comparisons — and every C-like
// program has those. A Python snippet detects as `thinkscript` and is refused with
// "thinkorswim has no character like this one", a sentence that is FALSE about what
// the member actually pasted. They arrive with MQL and are told TC2000 cannot parse
// it. That is the one thing this engine exists not to do — a confident answer to a
// question nobody asked — and it happens before a member has seen anything work.
//
// ⭐ SO THIS ANSWERS THE QUESTION THE DETECTOR CANNOT: not "which of our three is
// this" but "is this something else entirely, and WHAT". A refusal that names
// MetaTrader is actionable — the member knows we understood them and knows what to
// do next. "TC2000 has no character like this one" is not.
//
// ⛔ IT NEVER OVERRIDES A DIALECT WE DO READ. This runs only when the three doors
// have already declined, so a Pine script containing the word `class` is still
// Pine. Recognising a foreign language and translating one are different jobs, and
// this only does the first.
//
// ⚠️ AND IT IS DELIBERATELY CONSERVATIVE. Two independent markers are required, so
// a bare native formula (`close > 10`) can never be mistaken for a program. An
// unrecognised language returns `null` and the member gets the ordinary refusal —
// silence beats a wrong name.

/** Languages we do not read, and the evidence that identifies each.
 *
 *  ⭐ TWO MARKERS, NOT ONE, AND THE PAIRS ARE CHOSEN TO BE UNSHARED. `Buy` alone
 *  appears in thinkScript; `Buy` beside `Inputs:` is EasyLanguage and nothing else.
 *  A single-marker match is how the detector this replaces went wrong. */
const LANGUAGES = Object.freeze([
  {
    name: 'MetaTrader (MQL4/MQL5)',
    home: 'MetaTrader',
    markers: [/\bOnInit\s*\(/, /\bOnCalculate\s*\(/, /\bOnTick\s*\(/, /\biMA\s*\(/,
      /\biRSI\s*\(/, /\bMODE_(SMA|EMA)\b/, /\bPRICE_CLOSE\b/, /#property\s/],
  },
  {
    name: 'EasyLanguage (TradeStation / MultiCharts)',
    home: 'TradeStation',
    markers: [/^\s*Inputs?\s*:/im, /^\s*Vars?\s*:/im, /\bBuy\s+Next\s+Bar\b/i,
      /\bSell\s+Short\b/i, /\bPlot1\s*\(/i, /\bBarsSinceEntry\b/i],
  },
  {
    name: 'NinjaScript (NinjaTrader)',
    home: 'NinjaTrader',
    markers: [/\bOnBarUpdate\s*\(/, /\bprotected\s+override\s+void\b/, /\bCurrentBar\b/,
      /\bValue\s*\[\s*0\s*\]/, /\bAddPlot\s*\(/],
  },
  {
    name: 'Python',
    home: 'a Python notebook',
    markers: [/^\s*import\s+\w+/m, /^\s*from\s+\w+\s+import\b/m, /^\s*def\s+\w+\s*\(.*\)\s*:/m,
      /\bpd\.|\bnp\.|\bpandas\b|\bnumpy\b/, /\.rolling\s*\(/, /^\s*class\s+\w+.*:/m],
  },
  {
    name: 'MetaStock',
    home: 'MetaStock',
    markers: [/\bMov\s*\(\s*C\s*,/i, /\bExtFml\s*\(/i, /\bFml\s*\(\s*"/i],
  },
  {
    name: 'AmiBroker (AFL)',
    home: 'AmiBroker',
    markers: [/\b_SECTION_BEGIN\s*\(/, /\bPlotShapes\s*\(/, /\bParamToggle\s*\(/,
      /\bBuy\s*=\s*Cross\s*\(/i],
  },
])

/** How many of a language's markers this source shows. */
function score(source, lang) {
  let n = 0
  for (const re of lang.markers) if (re.test(source)) n += 1
  return n
}

/**
 * The foreign language this source appears to be, or `null`.
 *
 * ⛔ TWO INDEPENDENT MARKERS ARE REQUIRED. One is a coincidence — `import` appears
 * in a Pine comment, `Buy` in a thinkScript label. Requiring two is what keeps a
 * bare formula from ever being called a program, and what makes a name we DO give
 * worth trusting.
 *
 * @returns {{name: string, home: string, matched: number} | null}
 */
export function foreignLanguage(source) {
  if (typeof source !== 'string' || source.trim() === '') return null
  let best = null
  for (const lang of LANGUAGES) {
    const matched = score(source, lang)
    if (matched < 2) continue
    if (!best || matched > best.matched) best = { name: lang.name, home: lang.home, matched }
  }
  return best
}

/** The sentence a member reads. ⭐ It names what we DID recognise, says plainly
 *  that we cannot read it, and points at the two doors that do not need a
 *  translator — because a refusal whose only content is "no" is a wall. */
export function foreignRefusal(found) {
  if (!found) return null
  return `this looks like ${found.name}, and this engine reads Pine, thinkScript and `
    + 'TC2000 formulas. It has no translator for '
    + `${found.home}. Two doors do not need one: describe the indicator in plain `
    + 'English and the concierge will build it, or paste a SCREENSHOT of it and the '
    + 'engine will read the picture.'
}

/** The roster, for anything that needs to say which languages are recognised. */
export const FOREIGN_LANGUAGES = Object.freeze(LANGUAGES.map((l) => l.name))
