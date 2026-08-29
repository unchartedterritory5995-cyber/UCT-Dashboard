// app/src/components/chart/engine/ast/vocabulary.js
//
// ─── EVERYTHING A MEMBER MAY WRITE, DERIVED FROM THE MANIFEST ───────────────
//
// ⛔⛔ THE GAP THIS CLOSES. The engine declares its entire language as data, and
// until now there was NO SURFACE ANYWHERE that showed a member any of it. A
// reachability census on 2026-08-28 found 22 frontend modules that READ the
// manifest and not one reference page, help panel or cheat sheet. The only place
// a member ever saw an entry's English was the editor's completion popup — which
// requires already typing a prefix of the name you are trying to DISCOVER. So
// "what does `hvc_52w` mean?" was unanswerable from inside the product, and
// "build your own indicator" asks a member to build with a vocabulary they
// cannot see.
//
// ⭐ NOTHING HERE IS WRITTEN. Every sentence, signature, reach and reason below
// already exists as a declaration; this module only assembles them. That is the
// whole design constraint: a 64th function must appear in the product with no
// edit to any page, and a reference that could drift from the engine would be
// worse than none, because a member builds on it.
//
// ⛔ TWO AUTHORITIES, ONE PER KIND — AND THAT IS NOT A CONTRADICTION.
// `closedTable.json` owns the `sentence` of every function, scalar, clock entry
// and bar field. `sentence.js::OPERATOR_SENTENCE` owns the operators', because an
// operator's English is a PHRASE TEMPLATE with argument slots (`{0} plus {1}`)
// rather than a static line, and that file's header argues why it lives there.
// Each is the ONE authority for its own kind; reading both is not a second
// authority over one value, and COPYING either here would be.

import { TABLE, VENDOR_NOTE, parseFormula } from './parse'
import { OPERATOR_SENTENCE } from './sentence'

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** A manifest key that is PROSE ABOUT the section rather than a name in it.
 *
 *  ⛔ THE ROSTERS SAY THIS THEMSELVES: `_functions_excluded._` reads "EVERY KEY
 *  WITHOUT A LEADING UNDERSCORE IS A NAME A FORMULA MAY NOT SPELL, and a key WITH
 *  one is a note". So the rule is read off the data rather than invented here,
 *  and a section that adds a second note needs no edit. */
const isNote = (key) => key.startsWith('_')

/** Text → its words, split on everything that is not a letter or digit.
 *
 *  ⛔⛔ THE SPLIT IS THE WHOLE SEARCH, AND A SUBSTRING MATCH WAS MEASURABLY NOT
 *  GOOD ENOUGH. `hvc_52w`'s own sentence reads *"the 52-week high-volume-close
 *  flag"*, so a member typing "high volume" — the exact phrase they would use —
 *  matched NOTHING under a substring test, because the text hyphenates it.
 *  Splitting both sides on non-alphanumerics turns `hvc_52w` and
 *  `high-volume-close` into ordinary words and the query lands.
 *
 *  ⚠️ AND HERE IS PRECISELY WHAT IT STILL WILL NOT DO, stated rather than
 *  discovered: it matches word PREFIXES, not word FORMS and not synonyms.
 *  "high volume" finds it; "highest volume" does not, because nothing stems
 *  "highest" to "high". Faking that with a hand-written synonym list is the
 *  list-that-rots shape — and a search that quietly returns nothing is
 *  indistinguishable from "you typed it wrong", which is why the surface must say
 *  what it searched over. */
const tokenise = (text) => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** The call signature a member can copy, built from `args` + `argRoles`.
 *
 *  ⭐ THE ROLES ARE WHY THIS IS WORTH DERIVING RATHER THAN PRINTING `f(a, b)`.
 *  `atr` takes four arguments and the manifest knows three of them are `high`,
 *  `low` and `close` — so a member reads `atr(high, low, close, period)` and can
 *  paste it, instead of reading `atr(series, series, series, int)` and guessing
 *  the order. Getting that order wrong is the `pine:role-order` refusal, so the
 *  signature is answering a question the engine already refuses people over. */
export function signatureOf(name, spec) {
  const args = Array.isArray(spec.args) ? spec.args : []
  const roles = Array.isArray(spec.argRoles) ? spec.argRoles : []
  const parts = args.map((kind, i) => {
    const role = roles[i]
    if (role && role !== 'source' && role !== 'left' && role !== 'right') return role
    if (kind === 'int') return role || 'period'
    return role === 'source' ? 'series' : (role || kind)
  })
  return `${name}(${parts.join(', ')})`
}

/** How far back an entry reaches, in words a member can act on.
 *
 *  ⛔ IT NAMES THE ARGUMENT, NOT A NUMBER, because that is what the declaration
 *  says: `lookback: "arg1"` means "as many bars as your second argument", and
 *  printing a number would be inventing one. `"2*arg1"` and `"session"` are the
 *  other two shapes and each says something different to somebody choosing a
 *  history window. */
export function reachOf(spec) {
  const lb = spec.lookback
  if (lb === 0 || lb === '0') return 'no history — this bar only'
  if (lb === 'session') return 'back to the start of the session'
  if (typeof lb === 'number') return `${lb} bar${lb === 1 ? '' : 's'} of history`
  const m = /^(?:(\d+)\s*\*\s*)?arg(\d+)$/.exec(String(lb || ''))
  if (m) {
    const mult = m[1] ? `${m[1]} x ` : ''
    const pos = Number(m[2]) + 1
    return `${mult}whatever argument ${pos} says`
  }
  return String(lb ?? 'unstated')
}

/** The extra declarations worth telling a member about, each already argued in
 *  the manifest's own prose sections. Absent keys produce no row — an entry that
 *  declares nothing special says nothing special. */
export function traitsOf(spec) {
  const out = []
  if (spec.yields === 'bool') out.push({ key: 'yields', text: 'answers 1 or 0 — usable as a scan on its own' })
  if (spec.yields === 'passthrough') out.push({ key: 'yields', text: 'answers whatever its branches answer' })
  if (spec.reads === 'bars') out.push({ key: 'reads', text: 'reads the bars themselves, not a column you name' })
  if (spec.forward) out.push({ key: 'forward', text: 'reaches FORWARD — its value settles only after later bars arrive, so it is badged as repainting until then' })
  if (spec.recurrence) out.push({ key: 'recurrence', text: 'carries its own previous value forward, bar to bar' })
  if (spec.domain) out.push({ key: 'domain', text: 'its other periods must fit inside the one its history is measured by' })
  if (spec.cadence) out.push({ key: 'cadence', text: `updated ${spec.cadence}` })
  if (spec[VENDOR_NOTE]) out.push({ key: VENDOR_NOTE, text: spec[VENDOR_NOTE] })
  return out
}

/** One member-facing entry. `search` is the haystack a member's own words hit. */
function entry({ name, kind, signature, sentence, spec }) {
  return {
    name,
    kind,
    signature: signature || name,
    sentence: sentence || '',
    traits: spec ? traitsOf(spec) : [],
    // ⭐ SEARCH BY INTENT, AND IT COSTS NOTHING TO BUILD. A member hunting for
    // `hvc_52w` does not know the name — they know "high volume". Every entry
    // already carries an English sentence written for exactly that reader, so the
    // sentences ARE the index.
    search: tokenise(`${name} ${sentence || ''}`),
  }
}

/** The formula a member should write INSTEAD, when the exclusion names one.
 *
 *  ⭐⭐ SEVEN OF THE FOURTEEN REFUSED FUNCTIONS ALREADY CARRY THEIR OWN
 *  SUBSTITUTE, written in the manifest as *"ALREADY EXPRESSIBLE: `(high + low) /
 *  2`"*. Surfacing it turns "we do not have `hl2`" into "write `(high + low) /
 *  2`" — a member who came looking for a name leaves with something they can
 *  paste, which is the entire difference between a refusal and an answer.
 *
 *  ⛔⛔ AND IT IS VERIFIED, NOT SCRAPED, BECAUSE SCRAPING GETS IT WRONG. Two
 *  traps, both real and both in this data:
 *    • `stochD`'s reason says "… over `dPeriod` and … `sma(stoch(…), 3)`", so
 *      taking the FIRST backticked span after the phrase yields `dPeriod` — an
 *      argument name, offered to a member as a formula.
 *    • `obv`'s reason contains "⛔ IT IS NOT `obvN(20)`", so a reader that
 *      scraped backticks WITHOUT the phrase gate would hand back the exact
 *      expression the manifest is warning against.
 *  So: the phrase gates it, and every candidate is then PARSED by the shipped
 *  parser. Anything that is not a formula this engine accepts is not shown. A
 *  substitute that cannot be pasted is worse than none. */
export function substituteFor(reason, parse = parseFormula) {
  const at = String(reason || '').indexOf('ALREADY EXPRESSIBLE')
  if (at < 0) return null
  const tail = String(reason).slice(at)
  const candidates = [...tail.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  for (const c of candidates) {
    // ⛔ THE PARSER IS THE JUDGE. `dPeriod` parses as a bare identifier, which
    // is a legal formula, so parsing alone is not enough — a substitute must
    // also DO something, and a lone name does not. Requiring a call or an
    // operator is what separates the expression from the argument it mentions.
    if (!/[()+\-*/]/.test(c)) continue
    let ok = false
    try { ok = !!parse(c).ok } catch { ok = false }
    if (ok) return c
  }
  return null
}

/** A name this engine deliberately does NOT have, and the reason.
 *
 *  ⭐⭐ THE EXCLUSIONS ARE PRODUCT, NOT OMISSIONS, AND THIS IS THE HALF RIVALS DO
 *  NOT SHIP. A member searching "obv" must learn that unbounded on-balance volume
 *  is deliberately absent, WHY (its level is a fact about where the fetch
 *  started, not about the market), and what to use instead. Every one of these
 *  reasons is already written in the manifest; leaving them unrendered is how a
 *  member concludes the engine is missing something rather than that it decided
 *  something. */
function exclusion(name, reason, kind) {
  return {
    name,
    kind,
    excluded: true,
    reason,
    instead: substituteFor(reason),
    search: tokenise(`${name} ${reason}`),
  }
}

/**
 * The whole member-facing vocabulary, grouped the way somebody LOOKS for it.
 *
 * ⛔ TAKES ITS SOURCES AS ARGUMENTS so the derivation can be RAILED. `TABLE` is
 * frozen at import, so a test that only sees the constant cannot plant a 64th
 * function and prove the roster grows — and a derivation nobody can plant
 * against is a hand-list that happens to be right today (`parse.js::barReadersOf`
 * records the mutation sweep that proved exactly that).
 */
export function buildVocabulary(table = TABLE, operatorSentences = OPERATOR_SENTENCE) {
  const groups = []

  const push = (id, title, blurb, items) => {
    if (items.length) groups.push({ id, title, blurb, items })
  }

  // ⛔ A BAR FIELD'S ENGLISH IS `doc`, NOT `sentence`, AND ASSUMING OTHERWISE
  // SHIPPED FIVE BLANK ROWS. Every other section declares `sentence`; `series`
  // declares `{field, doc}` because a bar field is a COLUMN NAME rather than a
  // computed phrase. The reader takes either, and `vocabulary.test.js` fails any
  // section whose entries render no English at all — which is the rail that would
  // have caught this without a human reading five empty cells.
  push('bars', 'Price and volume', 'The five numbers every bar carries.',
    Object.entries(table.series || {}).map(([name, spec]) => entry({
      name, kind: 'series', sentence: spec.sentence || spec.doc, spec,
    })))

  push('functions', 'Functions', 'Everything this engine can compute over a series.',
    Object.entries(table.functions || {}).map(([name, spec]) => entry({
      name, kind: 'function', signature: signatureOf(name, spec),
      sentence: spec.sentence, spec,
    })))

  push('scalars', 'Facts about the company', 'One number per symbol, from the nightly snapshot.',
    Object.entries(table.scalars || {}).map(([name, spec]) => entry({
      name, kind: 'scalar', sentence: spec.sentence, spec,
    })))

  push('clock', 'The calendar', 'What this bar knows about when it is.',
    Object.entries(table.clock || {}).map(([name, spec]) => entry({
      name, kind: 'clock', sentence: spec.sentence, spec,
    })))

  push('operators', 'Operators', 'How the pieces join together.',
    Object.entries(operatorSentences || {}).map(([name, phrase]) => entry({
      name, kind: 'operator', signature: name,
      // ⛔ THE PHRASE IS RENDERED WITH ITS SLOTS NAMED, not left as `{0}`. A
      // member reading "{0} plus {1}" learns nothing; "a plus b" is the sentence.
      sentence: String(phrase).replace(/\{0\}/g, 'a').replace(/\{1\}/g, 'b').replace(/\{2\}/g, 'c'),
      spec: (table.operators || {})[name],
    })))

  // ⚠️ THE BENCHMARKS ARE NOT VOCABULARY, and the group says so. They are the
  // only tickers a scan may name inside `sym(…)` — STRING ARGUMENTS, not names a
  // formula spells — so listing them beside the functions would tell a member they
  // can write `SPY` in a formula. They are here because "which symbols may I
  // compare against?" is a question the member has and nothing answers.
  // ⛔ EACH ENTRY IS `{name: …}`, NOT A STRING. Rendering the object would print
  // `[object Object]` into fifteen rows.
  push('benchmarks', 'Symbols you can compare against',
    'Not names you write — the tickers a scan may name inside sym( ).',
    Object.entries(table._benchmarks_scannable || {}).filter(([k]) => !isNote(k))
      .map(([name, spec]) => entry({
        name, kind: 'benchmark',
        sentence: (spec && typeof spec === 'object' && spec.name)
          ? String(spec.name) : String(spec || ''),
      })))

  const excluded = [
    ...Object.entries(table._functions_excluded || {})
      .filter(([k]) => !isNote(k))
      .map(([name, reason]) => exclusion(name, String(reason), 'function')),
    ...Object.entries(table._scalars_excluded || {})
      .filter(([k]) => !isNote(k))
      .map(([name, reason]) => exclusion(name, String(reason), 'scalar')),
  ]

  return { groups, excluded }
}

/** Everything matching a member's words, across both what we HAVE and what we
 *  deliberately do not.
 *
 *  ⛔ THE EXCLUDED ROSTER IS SEARCHED TOO, and that is the point rather than a
 *  courtesy: a search for a name we do not have must answer "we decided not to,
 *  here is why, here is what to use" instead of returning nothing. Nothing is
 *  indistinguishable from "you typed it wrong". */
export function searchVocabulary(query, vocab) {
  const v = vocab || buildVocabulary()
  const terms = tokenise(query)
  // ⛔ AN EMPTY QUERY SHOWS EVERYTHING, AND EVERYTHING INCLUDES WHAT WE
  // DELIBERATELY LACK. This returned `excluded: []` and the landing view showed
  // 222 names with no sign that 103 more had been decided against — so the one
  // half of this reference no rival ships was visible only to a member who
  // already knew to search for it. Found by the page's own rail, which asserted
  // the un-searched count line mentions them.
  if (!terms.length) return { groups: v.groups, excluded: v.excluded, query: '' }
  // ⛔ EVERY TERM MUST LAND, as a PREFIX of some word. AND rather than OR,
  // because "high volume" meaning "anything mentioning high, or volume" returns
  // most of the table and is the same as returning nothing. Prefix rather than
  // equality so "vol" finds `volume` — a member typing three letters is
  // narrowing, not spelling.
  const hit = (it) => terms.every((t) => it.search.some((w) => w.startsWith(t)))
  return {
    query: terms.join(' '),
    groups: v.groups
      .map((g) => ({ ...g, items: g.items.filter(hit) }))
      .filter((g) => g.items.length),
    excluded: v.excluded.filter(hit),
  }
}
