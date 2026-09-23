// app/src/components/chart/discoveryCatalog.js
//
// ─── THE DISCOVERY FACADE (P2.1) ────────────────────────────────────────────
//
// ⭐⭐ ONE SHAPE OVER FOUR CANONICAL CATALOGUES, AND IT OWNS NONE OF THEM.
//
//   nativeRegistry ─┐
//   user formulas  ─┤
//   breadth registry┤──▶  discoveryCatalog  ──▶  normalized result  ──▶  creation
//   ticker search  ─┘        (projection)                                descriptor
//
// ⛔ IT IS A PROJECTION FOR DISCOVERY, NOT A MERGE. Nothing here stores a
// definition, a symbol, a name or a category of its own. Every field is read
// from the system that already owns it, on every call:
//
//   • technical  ← `indicatorCatalog.catalogRows()`      (shipped definitions)
//   • formula    ← `indicatorCatalog.userCatalogRows()`  (the member's own)
//   • breadth    ← `/api/breadth-symbols`' rows          (`api/services/breadth_symbols.py`)
//   • security   ← `/api/ticker-search`' rows            (`api/routers/ticker_search.py`)
//
// Add a definition, rename a breadth measure, or change how search ranks, and
// this module reports the change without being edited. That is the test of
// whether a facade is a projection or a second copy.
//
// ⛔ AND IT FETCHES NOTHING. The two remote halves take rows the caller already
// has — `SymbolSearch` owns the debounce, the AbortController, the chip filter
// and the ranking, and `useBreadthSymbols` owns the once-per-module breadth
// fetch. A second fetcher here would be a second cache, a second abort policy
// and a second answer to "what did the server say"; the adapters are pure so the
// whole facade is testable without a network at all.
//
// ⛔⛔ AND DISCOVERY IS NOT CHARTABILITY. A result can EXIST and still refuse to
// be created — that is the whole point of `capability`. See its block below.

import { catalogRows, userCatalogRows, BUILT_IN_ROWS } from './indicatorCatalog'
import { isOverlayRemoved } from './chartDefaults'
import { symbolSource, canonicalSymbol, derivedSourceName, paneOfTarget } from './engine/sourceRef'
import { addInstance, setInstanceInput, findInstance, setInstanceDisplayTarget } from './engine/instanceControls'
import { cachedBars, SOURCE_STATUS } from './engine/secondaryBars'
import { fundamentalSource } from './engine/fundamentalGrammar'

// ─── the vocabulary ─────────────────────────────────────────────────────────

/**
 * WHERE A RESULT CAME FROM. Discovery metadata, and nothing else.
 *
 * ⛔⛔ NOTHING AT RUNTIME MAY BRANCH ON THIS. A breadth measure and a security
 * differ in what the member is told they are picking and in the string after
 * `sym:` — after creation they are the same object drawn by the same code, which
 * is the entire architectural claim of this phase. `api/routers/bars.py` is the
 * one layer that knows what a symbol IS, and it stays the one layer.
 *
 * The rail that keeps this honest is `discoveryCatalog.test.js`'s
 * *"creation is kind-blind"*: it builds a breadth result and a security result
 * and asserts the two instances differ ONLY in the source string.
 */
export const RESULT_KINDS = Object.freeze(['technical', 'formula', 'breadth', 'security'])

/**
 * Whether this result can become a chart series AT ALL.
 *
 * ⭐ TWO STATES, DELIBERATELY. `NOT_ENTITLED` and `REQUIRES_BUILDER` are real
 * future members and are NOT written here: an enum value with no producer and no
 * consumer is a decision nobody has made yet wearing the clothes of one.
 *
 * ⛔ AND `unsupported` IS ONLY EVER SAID FROM EVIDENCE. This module never guesses
 * that a symbol is unservable — it reports what the SERVER already said, through
 * two channels that exist today:
 *
 *   1. `/api/ticker-search`'s `delisted: true` row.
 *   2. `secondaryBars`' cached `SOURCE_STATUS` for that symbol — `UNSUPPORTED`
 *      (the route answered an empty list WITH a `note`, which is how a cash index
 *      says "I cannot serve this": `api/routers/bars.py:760`) or `NO_DATA`.
 *
 * ⚠️ SO `chartable` MEANS "NOTHING KNOWN AGAINST IT", NOT "PROVEN". A symbol
 * nobody has fetched yet is `chartable` — the honest answer, because the only way
 * to know better is to ask, and discovery must not fire a bars request per row of
 * a search dropdown. What this DOES guarantee is the direction that matters:
 * `createDirectSeries` refuses a result already known to be unservable, so the
 * member never adds a pane that can only ever be empty. A symbol that turns out
 * to be unservable AFTER the fact draws nothing and says so through the same
 * status — it does not fall back to the chart's own bars, ever.
 */
export const CAPABILITY = Object.freeze({
  CHARTABLE: 'chartable',
  UNSUPPORTED: 'unsupported',
})

/**
 * HOW A RESULT BECOMES AN INSTANCE — the creation descriptor.
 *
 * Two routes, and the split is not by family but by whether the thing the member
 * picked IS a definition:
 *
 *   • `definition` — a technical indicator or a member formula. It already has a
 *     definition id; adding it is `addInstance(cs, defId)`, the door the library
 *     dialog has used since chart-UX-walls Task 6.
 *   • `dataSeries` — a symbol (security or breadth). There is no definition for
 *     "QQQ"; there is a definition for "plot this source", and the symbol is its
 *     INPUT. `addInstance(cs, 'dataSeries')` then `setInstanceInput(source)`.
 *
 * ⛔ NO THIRD ROUTE, AND NO PER-FAMILY ROUTE. `UCTA50` and `QQQ` produce the same
 * descriptor with a different `source` string; if breadth ever needed its own
 * route that would be the signal that the generic series had stopped being
 * generic (the owner's §27: *"If UCTA50 needs a separate creation path from QQQ:
 * STOP and redesign."*).
 */
export const CREATE_VIA = Object.freeze({
  DEFINITION: 'definition',
  DATA_SERIES: 'dataSeries',
  // ⭐ SEVERAL CANONICAL SERIES ADDED AS ONE THING, into one pane. It is not a new
  // KIND of series — every component is an ordinary `DATA_SERIES` — it is a
  // statement that the member asked for all of them together.
  PRODUCT: 'product',
})

/** The definition id every symbol result creates through. One place. */
export const DIRECT_SERIES_DEF_ID = 'dataSeries'

// ─── the shape ──────────────────────────────────────────────────────────────

/**
 * A normalized discovery result.
 *
 * ⭐ IT STARTS FROM `indicatorCatalog.rowFor()` AND WIDENS BY FOUR FIELDS. The
 * audit's instruction was to derive the schema from working consumers rather
 * than invent it, and `rowFor` is already the row the library dialog, the
 * right-click menu, the generated settings rows and the keyboard help all read.
 * What a technical row could not express, and what a cross-family row needs:
 *
 *   `kind`        — which catalogue answered (discovery only; see RESULT_KINDS)
 *   `capability`  — can this become a series at all (see CAPABILITY)
 *   `capabilityReason` — the server's own words, when it gave any
 *   `create`      — the creation descriptor (see CREATE_VIA)
 *
 * …and `key`, which is `${kind}:${id}` — because `id` is only unique WITHIN a
 * catalogue. The definition `rsi` and a hypothetical ticker `RSI` are different
 * results, and a list that keyed on `id` would silently show one of them.
 *
 * ⛔ NOTHING ELSE WAS ADDED. No `icon`, no `sortWeight`, no `favourite`, no
 * `recent` — every one of those is a field with no consumer today, and a field
 * with no consumer is a guess that later code has to keep true.
 *
 * ⚠️ PRESENTATION AND PLACEMENT ARE ABSENT ON PURPOSE (owner §17, §18). The
 * `dataSeries` definition already declares `style: 'line'` and
 * `placement.target: 'pane'`, so a result that re-stated them would be a second
 * place for the default to live and a second place for it to drift. The breadth
 * registry carries `metric` and `group` and NO presentation hint — there is no
 * honest metadata saying "New Highs is a histogram" — so Line stands for
 * everything and a richer default waits for real metadata rather than a guess
 * hard-coded by family.
 *
 * @typedef {object} DiscoveryResult
 * @property {string} key
 * @property {string} id
 * @property {'technical'|'formula'|'breadth'|'security'} kind
 * @property {string} name
 * @property {string} shortName
 * @property {string} lead   what a COMPACT LIST leads with
 * @property {string} sub    the quiet qualifier after it, or ''
 * @property {string} category
 * @property {string} description
 * @property {string[]} tags
 * @property {'chartable'|'unsupported'} capability
 * @property {string|null} capabilityReason
 * @property {{via: string, defId?: string, source?: string}} create
 */

const str = (v, fallback = '') => (typeof v === 'string' && v ? v : fallback)

/**
 * ⭐⭐ A RESULT STATES HOW IT WANTS TO BE READ, so no view has to branch on `kind`.
 *
 * A compact list — the source picker's eight rows — has exactly one strong line and
 * one quiet one, and WHICH HALF IS WHICH DIFFERS BY WHAT THE THING IS. For a
 * security "QQQ" is the thing and "Invesco QQQ Trust" is the gloss. For a breadth
 * measure the thing is "% of Stocks Above 50-Day MA" and "NASDAQ" is the gloss —
 * `NASDAQ:A50` is an ADDRESS, and a list that leads with it is the ticker soup the
 * library exists to replace.
 *
 * ⛔ SO THE DEFAULT IS TODAY'S BEHAVIOUR EXACTLY — `shortName` leads, the long name
 * follows when it says something new — and only the breadth adapter overrides it.
 * `SourceField` renders `lead` / `sub` and learns nothing about breadth.
 */
function result({ id, kind, name, shortName, lead, sub, category, description, tags, capability, capabilityReason, create, metricShort, universeLabel }) {
  const _lead = str(lead, str(shortName, id))
  return {
    key: `${kind}:${id}`,
    id,
    kind,
    name,
    shortName,
    lead: _lead,
    sub: typeof sub === 'string' ? sub : (name && name !== _lead ? name : ''),
    category,
    description,
    tags: Array.isArray(tags) ? tags : [],
    capability: capability || CAPABILITY.CHARTABLE,
    capabilityReason: capabilityReason || null,
    create,
    // ⭐ THE TWO FIELDS `semanticNamesFor` NEEDS, and they are declared HERE
    // because this factory has a FIXED field list — an extra key handed to it
    // from `breadthResults` was silently dropped, which is exactly how a
    // half-applied naming fix looks: the full name arrived without its universe.
    // Absent on every non-breadth result, which is what makes them optional.
    ...(metricShort ? { metricShort } : {}),
    ...(universeLabel ? { universeLabel } : {}),
  }
}

// ─── capability, read from evidence ─────────────────────────────────────────

/**
 * What is ALREADY KNOWN about whether `symbol` can be served, without asking.
 *
 * ⚠️ READS THE CACHE, NEVER FETCHES. `cachedBars` is the synchronous,
 * side-effect-free door `secondaryBars` exposes for exactly this: a probe that
 * fetched would turn a dropdown of forty rows into forty bars requests.
 *
 * @returns {{capability: string, capabilityReason: string|null}}
 */
export function knownCapabilityOf(symbol, tf, bars) {
  const sym = canonicalSymbol(symbol)
  if (!sym) return { capability: CAPABILITY.UNSUPPORTED, capabilityReason: 'not a symbol' }
  let entry = null
  try { entry = cachedBars(sym, tf, bars) } catch { entry = null }
  if (!entry) return { capability: CAPABILITY.CHARTABLE, capabilityReason: null }
  // ⭐ A DENIAL IS A REASON A MEMBER CAN ACT ON, so it gets its own sentence
  // rather than "no history available for this symbol" — which would be a lie
  // about the SYMBOL when the truth is about the PLAN. Same shape as the note
  // above: say the true thing, in words the member can do something with.
  if (entry.status === SOURCE_STATUS.DENIED) {
    return {
      capability: CAPABILITY.UNSUPPORTED,
      capabilityReason: entry.httpStatus === 401
        ? 'sign in to chart this symbol'
        : 'chart data requires a paid plan',
    }
  }
  if (entry.status === SOURCE_STATUS.UNSUPPORTED || entry.status === SOURCE_STATUS.NO_DATA) {
    return {
      capability: CAPABILITY.UNSUPPORTED,
      // ⭐ THE ROUTE'S OWN WORDS WHERE IT GAVE ANY. "index history not served by
      // /api/bars-history" tells a member something; "unsupported" tells them
      // nothing. A `NO_DATA` answer carries no note, and saying so is honest.
      capabilityReason: str(entry.note, 'no history available for this symbol'),
    }
  }
  return { capability: CAPABILITY.CHARTABLE, capabilityReason: null }
}

// ─── the four adapters ──────────────────────────────────────────────────────

/**
 * SHIPPED TECHNICAL INDICATORS — straight off `catalogRows()`.
 *
 * ⛔ IT DOES NOT RE-DERIVE A SINGLE FIELD. `rowFor` already resolved the name,
 * the short name, the category, the description and the tags from `meta`, and
 * three registry rails compare its output against `listDefinitions()` id for id.
 * Re-reading `def.meta` here would be a second projection those rails cannot see.
 *
 * ⚠️ `dataSeries` IS FILTERED OUT, and it is the one id this module names. It is
 * a SUBSTRATE, not a catalogue entry: the member-facing thing is `QQQ`, and a
 * row called "Data Series" offering to plot `close` in its own pane is an add
 * surface for something nobody asked for. Its results come from the breadth and
 * security adapters instead, each carrying the source that makes it meaningful.
 */
export function technicalResults(registry) {
  const out = []
  for (const row of catalogRows(registry)) {
    if (row.id === DIRECT_SERIES_DEF_ID) continue
    out.push(result({
      id: row.id,
      kind: 'technical',
      name: row.name,
      shortName: row.shortName,
      category: row.category,
      description: row.description,
      tags: row.tags,
      // A shipped definition is registered, validated and runnable by
      // construction — `nativeRegistry` throws at import otherwise.
      capability: CAPABILITY.CHARTABLE,
      create: { via: CREATE_VIA.DEFINITION, defId: row.id },
    }))
  }
  return out
}

/**
 * THE MEMBER'S OWN FORMULAS — straight off `userCatalogRows()`.
 *
 * ⛔ NOT A SECOND FORMULA SOURCE (owner §20). `userCatalogRows` reads
 * `listUserDefinitions()`, which is populated by `installUserDefinitions` and is
 * already the list the library dialog unions in. A formula that refused to
 * install has no definition and therefore no result here — `userRefusalRows` is
 * how the dialog explains that, and duplicating it would be a second place for a
 * refusal to be worded.
 *
 * ⚠️ SESSION STATE. This list is empty until SWR answers and the definitions are
 * installed, so a memo over it must depend on `catalogGeneration()` — the exact
 * bug the dialog's own comment documents.
 */
export function formulaResults(registry) {
  return userCatalogRows(registry).map((row) => result({
    id: row.id,
    kind: 'formula',
    name: row.name,
    shortName: row.shortName,
    category: row.category,
    description: row.description,
    tags: row.tags,
    capability: CAPABILITY.CHARTABLE,
    create: { via: CREATE_VIA.DEFINITION, defId: row.id },
  }))
}

/**
 * BREADTH MEASURES — adapted from `/api/breadth-symbols`' rows.
 *
 * The payload is `{symbols: [{symbol, metric, name, group, group_label}], groups}`
 * (`api/routers/breadth_monitor.py:450`). The registry behind it calls itself the
 * single source of truth and it stays that; this reads it.
 *
 * ⛔ THE CATEGORY IS THE SERVER'S `group_label`, NOT A TABLE HERE. The four
 * groups and their labels live in `breadth_symbols.LIST_META`; a copy in this
 * file would be a fifth place to rename a group from.
 *
 * ⚠️ TWO SHAPES, ONE ADAPTER. `/api/breadth-symbols` answers `symbol`/`group`
 * while `/api/ticker-search` injects breadth rows as `ticker`/`group_label` — a
 * mismatch `SymbolSearch.jsx:112-116` already absorbs. Reading both spellings
 * here is what lets a breadth row reach this function from EITHER endpoint
 * without the caller having to normalise first.
 */
export function breadthResults(rows, { tf, bars } = {}) {
  const out = []
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row) continue
    // ⛔⛔ A PRODUCT IS ADAPTED BEFORE THE SYMBOL PATH, because it HAS no bars of
    // its own and every question below this point assumes it does.
    // `knownCapabilityOf` would ask the bars cache about `AAII:SURVEY`, find
    // nothing — correctly, there is no such series — and mark the row
    // UNSUPPORTED, which `createFromResult` refuses. The member would see the one
    // row we went to the trouble of building and be unable to add it.
    if (row.kind === 'product') {
      const prod = productResult(row, { tf, bars })
      if (prod) out.push(prod)
      continue
    }
    const sym = canonicalSymbol(row.symbol || row.ticker)
    if (!sym) continue
    const name = str(row.name, sym)
    // ⭐⭐ THE UNIVERSE IS THE SHORT NAME WHEN THERE IS ONE, and that single line is
    // what makes a multi-series pane readable. `shortName` becomes the instance's
    // `display.name` (see `createFromResult`), so four A50 series in one pane read
    //
    //     % of Stocks Above 50-Day MA
    //     UCT  63.2   US  54.9   NASDAQ  51.8   NYSE  57.4
    //
    // instead of four cryptic addresses. The metric is stated once by the pane; the
    // universe is what actually differs between the rows.
    //
    // ⚠️ AND IT IS ABSENT-SAFE. A row from today's `/api/breadth-symbols` carries no
    // `universe_label`, so a shipped UCT symbol keeps the symbol as its short name
    // exactly as before — this is additive, not a change of the existing behaviour.
    // ⚠️ THE BADGE IS FOR THE NAMESPACED ROWS ONLY. A legacy UCT row's symbol IS
    // its recognisable name — `UCTA50` is what a member types, what the axis shows
    // and what they have been reading for a year — so replacing it with "UCT" would
    // be a regression dressed as consistency. A namespaced row has no such history
    // and its universe is the thing that distinguishes it from its siblings.
    const universeLabel = row.legacy ? '' : str(row.universe_label || row.universeLabel, '')
    const pres = presentationFor(row)
    out.push(result({
      id: sym,
      kind: 'breadth',
      name,
      shortName: universeLabel || sym,
      // ⭐ METRIC FIRST, UNIVERSE SECOND — in the LIST as well as in the pane. The
      // pane legend wants `shortName` (the universe is what differs between four
      // A50 rows); a search list wants the opposite, because the member is choosing
      // the METRIC and the universe only qualifies it.
      lead: name,
      sub: universeLabel || sym,
      // ⭐⭐ THE METRIC'S OWN ABBREVIATION, CARRIED. `breadth_metrics` ships one
      // per metric (`Net H-L`, `A50`, `Up 4%`) and nothing was reading it, so the
      // only compact identity available downstream was the UNIVERSE — which is
      // how a Net-New-Highs/Lows series came to be called `US` in three places.
      // ⛔ A UNIVERSE IS NOT AN INDICATOR NAME; see `semanticNamesFor`.
      metricShort: str(row.short_name || row.shortName, ''),
      universeLabel,
      category: str(row.group_label || row.groupLabel || row.group, 'Breadth'),
      description: name,
      tags: ['breadth'],
      ...knownCapabilityOf(sym, tf, bars),
      // ⛔ PRESENTATION COMES FROM THE CATALOGUE, NEVER FROM THE TICKER. The
      // registry says Net New High-Low is a SIGNED COUNT drawn as a HISTOGRAM; the
      // renderer never learns that `US:NETHL` is special. This is the metadata half
      // of Phase 4's generic sign-colouring capability.
      //
      // ⚠️ THE KEY IS ABSENT WHEN THERE IS NOTHING TO SAY, rather than present and
      // null. A row with no presentation metadata — every one of the 44 shipped UCT
      // symbols — produces the IDENTICAL `create` object it always did, so nothing
      // that compares the descriptor has to learn a new field.
      create: pres
        ? { via: CREATE_VIA.DATA_SERIES, source: symbolSource(sym, 'close'), presentation: pres }
        : { via: CREATE_VIA.DATA_SERIES, source: symbolSource(sym, 'close') },
    }))
  }
  return out
}

/**
 * A PRODUCT catalogue row → one addable discovery result.
 *
 * ⭐⭐ ITS CAPABILITY IS ITS COMPONENTS'. A product cannot be asked whether IT has
 * bars, so the honest question is whether anything it would create can be drawn —
 * and the answer is the best answer among its components. One unavailable
 * component degrades the product; all of them unavailable refuses it, which is the
 * same rule a single series follows.
 *
 * ⚠️ THE MEMBER-FACING NAME IS THE PRODUCT'S, AND NO INTERNAL WORD APPEARS. Not
 * `dataSeries`, not a provider key, not `AAII:BULLS` — the row reads
 * "AAII Sentiment Survey" and its components are addresses the UI never prints.
 */
export function productResult(row, { tf, bars } = {}) {
  if (!row) return null
  // ⚠️ THREE SPELLINGS, BECAUSE A PRODUCT ROW ARRIVES FROM TWO ENDPOINTS. The
  // catalogue sends `id`/`symbol`; `/api/ticker-search` sends `ticker`. Same row,
  // two shapes, and the adapter is the place that already reconciles them.
  const id = str(row.id || row.symbol || row.ticker, '')
  // ⭐ THE NAMED ROWS WHEN THE SERVER SENT THEM, the bare ids otherwise. A client
  // reading an older catalogue still gets a working product; it just labels the
  // components from their sources.
  const named = Array.isArray(row.component_rows || row.componentRows)
    ? (row.component_rows || row.componentRows).filter((c) => c && c.id) : []
  const components = named.length
    ? named
    : (Array.isArray(row.components) ? row.components.filter(Boolean).map((c) => ({ id: c })) : [])
  if (!id || !components.length) return null
  const name = str(row.name || row.display, id)
  // ⭐ ASK THE BARS CACHE ABOUT THE THINGS THAT ACTUALLY HAVE BARS.
  const caps = components.map((c) => knownCapabilityOf(canonicalSymbol(c.id), tf, bars))
  const best = caps.find((c) => c && c.capability !== CAPABILITY.UNSUPPORTED) || caps[0] || {}
  const pres = presentationFor(row)
  return result({
    id,
    kind: 'breadth',
    name,
    shortName: str(row.short_name || row.shortName, name),
    lead: name,
    sub: str(row.family_label || row.familyLabel, ''),
    metricShort: str(row.short_name || row.shortName, ''),
    universeLabel: '',
    category: str(row.family_label || row.familyLabel, 'Market Indicators'),
    description: str(row.description, name),
    tags: ['market-indicator', 'product'],
    ...best,
    create: {
      via: CREATE_VIA.PRODUCT,
      components: components.map((c) => ({
        source: symbolSource(canonicalSymbol(c.id), 'close'),
        // ⛔ THE MEMBER-FACING NAME, NOT THE ID. Absent, `createDirectSeries`
        // derives the label from the source and the pane legend prints the
        // canonical address — an internal word in the one place it must never be.
        name: str(c.display, '') || null,
        compact: str(c.short, '') || null,
        presentation: pres || null,
      })),
    },
  })
}

/**
 * A catalogue row's `presentation` / `domain` → the instance presentation to stamp,
 * or `null` when the defaults are right.
 *
 * ⭐ ONE MAPPING, FROM DATA. `presentation: 'histogram'` asks for a histogram;
 * `domain: 'signed'` additionally asks for sign colouring, because a series that
 * crosses zero is exactly the one whose bars mean something above and below it.
 * Anything else returns null and inherits the `dataSeries` default (a line), so the
 * 44 shipped UCT symbols are untouched — none of them carries either field today.
 *
 * ⛔ NO TICKER, NO METRIC KEY, NO FAMILY BRANCH. `if (sym === 'US:NETHL')` in a
 * renderer is the thing this exists to prevent.
 */
export function presentationFor(row) {
  if (!row) return null
  const style = row.presentation === 'histogram' ? 'histogram' : null
  const signed = row.domain === 'signed'
  if (!style && !signed) return null
  const out = {}
  if (style) out.plotStyle = style
  if (signed && style) out.signColors = true
  return Object.keys(out).length ? out : null
}

/**
 * SECURITIES — adapted from `/api/ticker-search`' rows.
 *
 * Row shape from `api/routers/ticker_search.py:136`:
 * `{ticker, name, type, exchange, entity_id, breadth?, group_label?, delisted?, delisted_date?}`.
 *
 * ⛔⛔ A `breadth: true` ROW IS RE-ROUTED, NOT DUPLICATED. The search endpoint
 * INJECTS breadth rows into its own results (`ticker_search.py:123-200`), so a
 * caller that adapted everything as a security would produce `UCTA50` twice —
 * once from each adapter — with two different categories. The `kind` a result
 * carries has to be the truth about what it IS, not about which endpoint it
 * arrived on.
 *
 * ⛔ AND A DELISTED ROW IS DISCOVERABLE BUT NOT CHARTABLE. The server says
 * `delisted: true` with a `delisted_date`; that is real evidence, and it is the
 * second of the two channels `CAPABILITY` admits. The result still EXISTS —
 * hiding it would leave a member typing a symbol they remember and being told
 * nothing at all.
 *
 * ⚠️ THE TYPED SENTINEL IS SKIPPED. `SymbolSearch` appends `{ticker, name: null,
 * _typed: true}` so Enter never waits on the network; that is an input echo, not
 * a discovery, and adapting it would put a result in the list for every
 * keystroke.
 */
export function securityResults(rows, { tf, bars } = {}) {
  const out = []
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || row._typed === true) continue
    if (row.breadth === true || row.type === 'breadth') {
      out.push(...breadthResults([row], { tf, bars }))
      continue
    }
    // ⛔⛔ A PRODUCT ROW IS RE-ROUTED, exactly as a breadth row is, and for the same
    // reason: the search endpoint INJECTS it, so a caller that adapted everything
    // here as a security would render `AAII:SURVEY` as a ticker headline and try to
    // create a `dataSeries` over a symbol that has no bars. The `kind` a row carries
    // is the truth about what it IS, not about which endpoint it arrived on.
    if (row.kind === 'product') {
      out.push(...breadthResults([row], { tf, bars }))
      continue
    }
    const sym = canonicalSymbol(row.ticker || row.symbol)
    if (!sym) continue
    const delisted = row.delisted === true || row.type === 'delisted'
    const known = knownCapabilityOf(sym, tf, bars)
    out.push(result({
      id: sym,
      kind: 'security',
      name: str(row.name, sym),
      shortName: sym,
      // The server's own classification — `stock` / `etf` / `index` / `delisted`.
      category: str(row.type, 'security'),
      description: str(row.name, ''),
      tags: [str(row.type, 'security'), str(row.exchange, '')].filter(Boolean),
      capability: delisted ? CAPABILITY.UNSUPPORTED : known.capability,
      capabilityReason: delisted
        ? `delisted${row.delisted_date ? ` ${row.delisted_date}` : ''}`
        : known.capabilityReason,
      create: { via: CREATE_VIA.DATA_SERIES, source: symbolSource(sym, 'close') },
    }))
  }
  return out
}

/**
 * THE TWO NAMES A DISCOVERY RESULT CARRIES ONTO ITS INSTANCE.
 *
 * ⚰️⚰️ BECAUSE COLLAPSING A BREADTH SERIES TO ITS UNIVERSE WAS THE BUG. The
 * instance stored ONE name — `res.shortName` — and for a namespaced breadth row
 * that field IS the universe (`US`), on purpose: four A50 series in one pane read
 * `UCT 63.2  US 54.9  NASDAQ 51.8  NYSE 57.4` under a heading that states the
 * metric once. Correct for a shared pane; wrong everywhere else, and `US:NETHL`
 * alone in its own pane was named `US` in the Indicators list, the pane legend
 * AND the editor. A member cannot tell what `US` measures.
 *
 * ⭐ SO AN INSTANCE CARRIES BOTH, AND EACH SURFACE PICKS. `full` is what a row
 * with space says (`Net New 52-Week Highs-Lows`); `compact` is what a pane legend
 * says (`US: Net H-L`) — universe AND metric, because the universe alone is an
 * address and the metric alone loses which market it is about.
 *
 * ⛔ NO TICKER BRANCH. The catalogue's own metadata answers this for every
 * universe — US, NASDAQ, NYSE, UCT — and for a security both names are the
 * ticker, which is exactly what makes the `worthStoring` provenance rule below
 * keep storing nothing for QQQ.
 *
 * @returns {{full: string, compact: string}}
 */
export function semanticNamesFor(res) {
  if (!res) return { full: '', compact: '' }
  const id = str(res.id, '')
  // ⭐ A FUNDAMENTAL NAMES ITSELF BY ITS METRIC ("Net Margin"); its chip
  // (`shortName`, e.g. "Quarterly") is a list cue, never the series' name.
  if (res.kind === 'fundamental') {
    const n = str(res.name, '') || id
    return { full: n, compact: n }
  }
  if (res.kind !== 'breadth') {
    // A security names itself: `QQQ` is the thing, and `res.name` is the gloss.
    const t = str(res.shortName, '') || id
    return { full: t, compact: t }
  }
  const metricFull = str(res.name, '') || id
  const metricShort = str(res.metricShort, '') || metricFull
  const universe = str(res.universeLabel, '')
  return {
    full: universe ? `${metricFull} · ${universe}` : metricFull,
    // ⚠️ A LEGACY UCT ROW KEEPS ITS SYMBOL AS THE COMPACT NAME, and that is the
    // earlier ruling this change deliberately preserves: `UCTA50` is what a
    // member types, what the axis shows and what they have been reading for a
    // year, so a pane strip must not rename it to `A50`. It gains the METRIC in
    // the list and the editor — where there is room — and loses nothing.
    compact: universe ? `${universe}: ${metricShort}` : (id || metricShort),
  }
}

// ─── creation ───────────────────────────────────────────────────────────────

/**
 * A DISCOVERY RESULT BECOMES AN INSTANCE.
 *
 * ⛔⛔ IT ADDS NO WRITER (owner §12). Both routes are compositions of doors that
 * already exist and are already ledgered in `controlDoorCensus`: `addInstance`
 * for the mint, `setInstanceInput` for the source. A third writer here would be a
 * fourth answer to "how does an indicator get onto a chart", and the census
 * exists because the first three were already one too many.
 *
 * ⛔ AND IT REFUSES BY IDENTITY, which is this codebase's refusal convention
 * (`instanceControls`): a rejected create returns the SAME settings object, so
 * `next !== cs` is the caller's test and nothing is persisted for a no-op. The
 * three refusals are: no result, a result whose capability says unsupported, and
 * a descriptor the `CREATE_VIA` vocabulary does not name. All three fail CLOSED —
 * an unknown route creates nothing rather than falling through to a default.
 *
 * ⚠️ NON-ATOMICITY IS ACCEPTABLE HERE, AND THAT IS A MEASURED CLAIM RATHER THAN
 * A SHRUG. `addInstance` then `setInstanceInput` are two pure transforms over an
 * immutable blob: the intermediate settings object is a local that NOTHING
 * renders and NOTHING persists — only the final object is returned, and only the
 * caller persists. There is no frame in which a `dataSeries` instance exists with
 * its default `close` source. That is why §12's "if atomic creation is necessary"
 * does not apply, and why no new API was invented for it.
 */
export function createFromResult(cs, res, registry) {
  if (!cs || typeof cs !== 'object') return cs
  if (!res || !res.create) return cs
  if (res.capability === CAPABILITY.UNSUPPORTED) return cs

  if (res.create.via === CREATE_VIA.DEFINITION) {
    return typeof res.create.defId === 'string' && res.create.defId
      ? addInstance(cs, res.create.defId, registry)
      : cs
  }
  if (res.create.via === CREATE_VIA.PRODUCT) {
    // ⚠️ THE PRODUCT'S OWN NAME IS NOT STAMPED ON ITS COMPONENTS. Each series is
    // named by `semanticNamesFor` from its OWN catalogue row, so the pane legend
    // reads `Bullish / Bearish / Neutral` rather than the product name three times.
    return createProductSeries(cs, res.create.components, registry)
  }
  if (res.create.via === CREATE_VIA.DATA_SERIES) {
    // ⭐ THE DISPLAY NAME TRAVELS WITH THE ADD (P2.2). See `createDirectSeries`.
    const names = semanticNamesFor(res)
    return createDirectSeries(cs, res.create.source, registry, {
      name: names.full,
      compact: names.compact,
      presentation: res.create.presentation || null,
    })
  }
  return cs
}

/**
 * The `dataSeries` half, reachable on its own so a caller that already has a
 * source string does not have to build a result around it.
 *
 * ⚠️ THE MINTED ID IS READ BACK OFF THE LIST, NOT PREDICTED. `newInstanceId`
 * counts tombstones, so the next id after deleting `inst:dataSeries:2` is `:3`
 * and not `:2` — a caller that guessed would address a corpse.
 */
export function createDirectSeries(cs, source, registry, display) {
  if (!cs || typeof cs !== 'object') return cs
  if (typeof source !== 'string' || !source) return cs
  const added = addInstance(cs, DIRECT_SERIES_DEF_ID, registry)
  if (added === cs) return cs
  // ⛔⛔ THE NEW INSTANCE IS FOUND BY SET DIFFERENCE, NOT BY POSITION. This read
  // `list[list.length - 1]` and was MEASURED WRONG: after a delete the list ends
  // with the TOMBSTONE, so the "minted" instance was a corpse, `setInstanceInput`
  // refused it by identity, and re-adding a symbol after removing one silently
  // created nothing. Predicting the id is already ruled out (`newInstanceId`
  // counts tombstones); predicting the slot is the same mistake wearing a
  // different hat.
  const minted = lastCreatedInstance(cs, added)
  if (!minted || !minted.instanceId) return cs
  const next = setInstanceInput(added, minted.instanceId, 'source', source, registry)
  // A refused input write leaves a `dataSeries` instance pointed at `close` —
  // a line the member did not ask for. Fail closed instead.
  if (next === added) return cs
  // ⛔⛔ A NAME IS STORED ONLY WHEN IT SAYS SOMETHING THE SOURCE CANNOT.
  //
  // ⚰️ MEASURED IN A BROWSER 2026-09-14: stamping the catalogue's short name
  // unconditionally wrote `display.name = 'QQQ'` on a series whose source already
  // derives `QQQ` — an AUTOMATIC name wearing the shape of a chosen one. Re-point
  // that series at NVDA and the data followed while the label did not: the legend
  // read `QQQ 218.29`, and 218.29 is NVDA's price.
  //
  // ⭐ SO THE RULE IS PROVENANCE, NOT PRECEDENCE. `instanceLabel` still prefers a
  // stored name over a derived one — that is what makes a real choice like
  // "Invesco QQQ Trust" stick. What changed is that a name IDENTICAL to the
  // derived one is not a choice, so it is not recorded, and the label stays a
  // function of the current source.
  // ⛔ THE INJECTED REGISTRY, like every other definition lookup in this module —
  // a member's own definitions live in the one passed in, not in a module global.
  const defOf = (registry && typeof registry.getDefinition === 'function')
    ? registry.getDefinition(minted.defId) : null
  const derived = derivedSourceName(defOf, findInstance(next, minted.instanceId))
  // ⚠️ THE PROVENANCE RULE NOW ASKS ABOUT BOTH NAMES. A security's full AND
  // compact names are its ticker, which equals the derived stem, so QQQ still
  // stores nothing and still follows a re-pointed source. A breadth metric's
  // names are neither its symbol nor each other, so both are recorded.
  const worthStoring = !!(display && display.name && display.name !== derived)
    || !!(display && display.compact && display.compact !== derived)
  // ⚠️ PRESENTATION IS STAMPED EVEN WHEN THE NAME IS NOT. The name rule is about
  // PROVENANCE — a name identical to the derived one is not a choice, so it is not
  // recorded — and that reasoning says nothing about how the series draws. Gating
  // both on one flag would have silently dropped a signed histogram's style
  // whenever its label happened to match its source, which is a defect whose only
  // symptom is a line where a histogram belonged.
  const wantsPresentation = !!(display && display.presentation)
  if (!worthStoring && !wantsPresentation) return next
  return withDisplay(next, minted.instanceId, {
    name: worthStoring ? display.name : null,
    compact: worthStoring ? (display.compact || null) : null,
    presentation: display.presentation || null,
  })
}

/**
 * Stamp `instance.display` — the presentation metadata the catalogue knows and
 * the chart never learns on its own.
 *
 * ⭐⭐ IDENTITY AND DISPLAY ARE SEPARATE FIELDS, AND THAT IS THE WHOLE RULE. The
 * source stays `sym:QQQ:close`; the name lives beside it. Encoding a label INTO
 * the source string would make two display names two different sources and break
 * every binding on a rename.
 *
 * ⛔ ONLY `name` IS WRITTEN, AND ONLY BECAUSE TWO SURFACES READ IT — the legend
 * chip (`readout.chipLabel`) and the source picker (`sourceRef.instanceLabel`).
 * The LONG name ("Invesco QQQ Trust") is NOT stored: the library dialog shows it
 * live from the catalogue, no chart surface has a slot for it, and a persisted
 * field with no consumer is a guess later code has to keep true. P2.1's rail
 * proved this shape round-trips, so adding it later costs no migration.
 *
 * ⚠️ IT IS A FALLBACK, NOT A WELD. `chipLabel` and `instanceLabel` prefer
 * `display.name` and derive from the source when it is absent — so an instance
 * created before P2.2, or by any other door, still names itself correctly.
 */
function withDisplay(cs, instanceId, display) {
  const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  return {
    ...cs,
    indicatorInstances: list.map((i) => {
      if (!i || i.instanceId !== instanceId) return i
      const next = { ...i }
      // ⭐ TWO NAMES, ONE FIELD. `compact` is additive and optional: an instance
      // written before this — or by any other door — has only `name`, and every
      // reader falls back to it. No migration, no top-level key.
      if (display.name) {
        next.display = display.compact && display.compact !== display.name
          ? { name: display.name, compact: display.compact }
          : { name: display.name }
      }
      // ⚠️ A SEPARATE FIELD FROM `display`, because it is read by a different layer:
      // `display.name` is a LABEL (`readout.chipLabel`), `presentation` is how the
      // series DRAWS (`presentation.presentedPlot`). Folding the two together would
      // make a rename a restyle.
      if (display.presentation) next.presentation = { ...display.presentation }
      return next
    }),
  }
}

/** The instance a `createFromResult` just minted, for a caller that needs to
 *  address it (a settings dialog, a label write, a test). `null` when the create
 *  was refused. */
/**
 * ADD A PRODUCT — several canonical series that a member adds, and reads, as one.
 *
 * ⭐⭐ IT BUILDS NOTHING NEW. Every component is an ORDINARY `dataSeries` created
 * through the ORDINARY door, and the only extra act is pointing components 2..N at
 * the pane the first one hosts. That is exactly what a member could do by hand with
 * three adds and two "Display in" changes — which is the property that makes the
 * pane, the pane-owned legend, the micro-rails, per-output styling, show/hide,
 * scale sharing, formula addressability and saved-chart reconstruction all work
 * with no code that knows a product exists. A bespoke multi-series renderer would
 * have had to reimplement every one of them.
 *
 * ⛔ THE HOST IS THE FIRST COMPONENT THAT ACTUALLY LANDED, NOT `components[0]`.
 * `createDirectSeries` fails closed (a refused input write creates nothing), so
 * assuming the first one exists would point the other two at an instance that is
 * not there — and `setInstanceDisplayTarget` would refuse, leaving three separate
 * panes with no error anywhere. Reading the host back is the same
 * "never predict a minted id" rule `createDirectSeries` already states.
 *
 * ⚠️ A PARTIAL PRODUCT IS BETTER THAN NONE, and it is not silent: a component that
 * cannot be created is skipped and the rest still land in one pane. The alternative
 * — abandoning the whole add because one series is unavailable — turns a degraded
 * chart into no chart.
 */
/**
 * The colours a multi-output product's series wear, in order.
 *
 * ⭐⭐ DECLARED PER OUTPUT, WHICH IS WHAT THIS CODEBASE ALREADY DOES FOR EVERY
 * MULTI-OUTPUT INDICATOR. MACD ships `macdColor: '#2196F3'` and `signalColor:
 * '#FF9800'` in `nativeRegistry`; there is no auto-cycling palette anywhere in the
 * engine, so inventing one would be the second mechanism. This is the same idea
 * applied to a product, drawn from the same family of hues the shipped definitions
 * already use.
 *
 * ⛔ AND IT IS BY POSITION, NOT BY MEANING. Nothing here knows that the first
 * component of one particular product is "bullish" — colouring it green would be a
 * ticker-specific visual hack wearing a palette's clothes, and it would be wrong the
 * moment a product's outputs are not sentiment.
 *
 * ⚠️ IT IS A DEFAULT, NOT A LOCK. Each component is an ordinary instance with an
 * ordinary `color` input, so a member recolours one exactly as they would any other
 * series, and their choice persists.
 */
export const PRODUCT_SERIES_COLORS = Object.freeze([
  '#2196F3',   // the blue MACD's own line uses
  '#FF9800',   // the amber its signal uses
  '#9C27B0',
  '#26C6DA',
  '#8BC34A',
  '#EC407A',
])

/**
 * The rows a discovery list shows for the CURRENT query — browse and query UNIONED.
 *
 * ⚰️⚰️ THE PRODUCTION DEFECT THIS EXISTS TO PREVENT, stated once so both discovery
 * surfaces can share the rule. `ChartSettingsIndicators` computed this inline as
 * `query ? symbolRows : browsed` — so the instant a member TYPED, every browsed row
 * was discarded and the list became whatever `/api/ticker-search` returned. Browse
 * is the only path carrying the Market Indicators catalogue, so searching "AAII"
 * made that catalogue irrelevant and the AAII Sentiment Survey's existence depended
 * on one remote reply whose market-indicator injection is wrapped in
 * `except Exception: pass` server-side.
 *
 * ⭐ THE ASYMMETRY IS WHY IT READ AS A DATA BUG. The AAII Bull-Bear Spread kept
 * appearing because it ALSO arrives from `useBreadthSymbols`, which needs no network
 * at all. One AAII row present and the other absent looks like "the Survey is
 * missing"; it was really "the Survey had one door and that door was remote".
 *
 * ⛔ THE REMOTE ANSWER LEADS. It is ranked by a server that knows more than a
 * substring test; the caller's dedupe keeps the first of any key, so a row present in
 * both sources reads exactly as it did before this existed.
 *
 * @param {string} query          the member's text, '' while browsing
 * @param {Array} queryRows       rows from the remote answer
 * @param {Array} browsedRows     rows from the local catalogues
 * @param {Function} matchesFn    `(row, query) => boolean` — the caller's own matcher
 */
export function liveDiscoveryRows(query, queryRows, browsedRows, matchesFn) {
  const browsed = Array.isArray(browsedRows) ? browsedRows : []
  if (!query) return browsed
  const remote = Array.isArray(queryRows) ? queryRows : []
  const match = typeof matchesFn === 'function' ? matchesFn : () => false
  return [...remote, ...browsed.filter((r) => match(r, query))]
}

export function createProductSeries(cs, components, registry) {
  if (!cs || typeof cs !== 'object') return cs
  if (!Array.isArray(components) || !components.length) return cs

  let next = cs
  let hostId = null
  let placed = 0
  for (const comp of components) {
    if (!comp || typeof comp.source !== 'string' || !comp.source) continue
    const before = next
    next = createDirectSeries(next, comp.source, registry, {
      name: comp.name || null,
      compact: comp.compact || null,
      presentation: comp.presentation || null,
    })
    if (next === before) continue                    // refused — skip, do not abort
    const minted = lastCreatedInstance(before, next)
    if (!minted || !minted.instanceId) continue
    // ⭐ DISTINGUISHABLE BY DEFAULT. Three outputs sharing one pane in one colour is
    // a legend a member has to read to tell the lines apart — measured in a browser
    // before this line existed. Written through `setInstanceInput`, the canonical
    // writer, so it is an ordinary instance colour the member can change.
    // ⚠️ INDEXED BY PLACED POSITION, so a skipped component does not leave a gap.
    const hex = comp.color || PRODUCT_SERIES_COLORS[placed % PRODUCT_SERIES_COLORS.length]
    if (hex) {
      const painted = setInstanceInput(next, minted.instanceId, 'color', hex, registry)
      if (painted !== next) next = painted
    }
    placed += 1
    if (hostId === null) {
      // ⭐ THE FIRST LANDED COMPONENT OWNS THE PANE and keeps its own default
      // placement. Writing a target for it would be writing `@<self>`, which
      // `setInstanceDisplayTarget` refuses by identity — correctly.
      hostId = minted.instanceId
      continue
    }
    const moved = setInstanceDisplayTarget(next, minted.instanceId,
                                           paneOfTarget(hostId), registry)
    // ⚠️ A REFUSED MOVE LEAVES THE SERIES IN ITS OWN PANE rather than dropping it.
    // The member sees the data and can move it; they never silently lose a series
    // because a placement write was rejected.
    if (moved !== next) next = moved
  }
  return next
}

export function lastCreatedInstance(before, after) {
  if (!after || after === before) return null
  const b = new Set((Array.isArray(before?.indicatorInstances) ? before.indicatorInstances : [])
    .map((i) => i && i.instanceId))
  const list = Array.isArray(after.indicatorInstances) ? after.indicatorInstances : []
  for (let i = list.length - 1; i >= 0; i--) {
    const inst = list[i]
    if (inst && inst.instanceId && !b.has(inst.instanceId)) return findInstance(after, inst.instanceId)
  }
  return null
}

// ─── the library's rows (P2.2) ──────────────────────────────────────────────

/**
 * THE ONE LIST THE ADD-TO-CHART DIALOG READS.
 *
 * ⭐⭐ THE UNION MOVED HERE, AND THAT IS THE POINT OF P2.2. It used to live in
 * `IndicatorLibraryDialog` — `[...BUILT_IN_ROWS, ...catalogRows(), ...userCatalogRows()]`
 * — which was right while three local catalogues were the whole world. With
 * securities and breadth in the picture the dialog would have had to know about
 * five sources, two of them remote, and "the dialog decides what discovery means"
 * is exactly the shape this facade exists to prevent.
 *
 * ⛔ IT RETURNS THE DIALOG'S OWN ROW SHAPE, NOT `DiscoveryResult`. The library row
 * carries five fields a normalized result has no business inventing —
 * `userDefined`, `carvedOut`, `singleton`, `sessionOnly`, `measuredRepaint` /
 * `repaintingPlots` / `tier` — and every one of them is already resolved by
 * `indicatorCatalog.rowFor`. Spreading the catalogue row and DECORATING it is
 * what keeps this a projection: a badge added to `rowFor` appears here without an
 * edit, and none of those fields is re-derived.
 *
 * ⚠️ `BUILT_IN_ROWS` ARE NEITHER DEFINITIONS NOR SYMBOLS. The legacy price moving
 * averages and the volume pane have no definition to instantiate, so they carry
 * `create: null` and the dialog keeps routing them at `toggledRow` — the same
 * branch it always did. Listing them here rather than beside the union is what
 * makes this ONE list instead of one-and-a-bit.
 */
/**
 * Definitions that are REGISTERED but not BROWSABLE.
 *
 * ⛔⛔ NAMED, FROZEN, AND RAILED — never an inline `if`. Three per-definition
 * sweeps assert that every shipped definition reaches the library, because a
 * definition that silently stops being listed is an indicator nobody can find and
 * no pixel gate can see it. An exclusion therefore has to be a written claim that
 * those sweeps subtract, and a case of its own asserting the set is exactly this.
 *
 * `dataSeries` is the only member: it plots whatever it is pointed at, so a row
 * reading "Data Series" that offers to plot `close` in its own pane means nothing
 * to anybody. Its member-facing rows are `QQQ` and `UCTA50`, which carry the
 * source that gives it meaning.
 */
/**
 * Rows that exist and work, but are not OFFERED in browse.
 *
 * ⭐⭐ `'ma'` JOINED THIS ON 2026-09-15, AND NOTHING WAS DELETED. The legacy
 * price moving average (`cs.overlays`, a POSITIONAL ARRAY with its own writers
 * and its own compute) and the engine's `movingAverage` (an INSTANCE, source-
 * capable, in the dependency and display-target architecture) are two different
 * persistence mechanisms. Offering both read identically in a list — "Moving
 * Average" and "Moving Average (Source)" — and the easier one to find was the
 * one with NO source control, which is exactly the member's report: *"I added a
 * Moving Average but I cannot see where to put it on QQQ."*
 *
 * ⛔ SO THE CREATION DOOR CLOSES AND NOTHING ELSE CHANGES. Existing overlays
 * still render, still get their own rows in Chart Data's ACTIVE list (which comes
 * from `listAllIndicators`, not from this catalogue), still carry their ✕ and
 * their settings. No saved chart is rewritten, no id moves, and a member who
 * wants a price MA gets one from the same door as every other indicator — it
 * simply arrives source-capable.
 *
 * ⚠️ THE ONE THING IT COSTS is reviving a REMOVED overlay from the library,
 * which was a documented recovery path. Adding a Moving Average now creates an
 * engine instance instead of resurrecting the old row's settings.
 */
export const LIBRARY_HIDDEN_IDS = Object.freeze([DIRECT_SERIES_DEF_ID, 'ma'])

/**
 * The ids to hide from browse FOR THIS CHART.
 *
 * ⚰⚰ TWO MEMBER REPORTS PULL IN OPPOSITE DIRECTIONS, AND THIS IS THE SEAM THAT
 * SATISFIES BOTH.
 *
 *   · *"I removed my moving average and searching for it finds nothing."* — fixed
 *     by giving `cs.overlays` a catalogue row, so adding REVIVES the tombstone
 *     with the colour and period the member chose.
 *   · *"I added a Moving Average but I cannot see where to put it on QQQ."* — two
 *     rows read "Moving Average" in browse and the easier one to find was the
 *     legacy one, which has no source at all.
 *
 * Hiding the legacy row outright answers the second by re-breaking the first. So
 * it is hidden only when there is NOTHING TO REVIVE: a chart with a tombstoned
 * overlay still offers it, because there the row means "give me my EMA 9 back"
 * rather than "here is a second Moving Average".
 *
 * ⛔ THE CONDITION IS STATE, NOT A FLAG. No preference, no migration, nothing
 * persisted — it reads the same `removed` tombstone the revive path itself reads,
 * so the offer exists exactly when the action behind it would do something.
 */
export function hiddenLibraryIds(settings) {
  const overlays = Array.isArray(settings?.overlays) ? settings.overlays : []
  const canRevive = overlays.some(isOverlayRemoved)
  return canRevive
    ? LIBRARY_HIDDEN_IDS.filter((id) => id !== 'ma')
    : LIBRARY_HIDDEN_IDS
}

/**
 * ⭐⭐ THE REVIVE ROW SAYS WHAT IT RESTORES, NOT WHAT IT IS (2026-09-16).
 *
 * `hiddenLibraryIds` reveals the legacy `ma` row when — and only when — there is a
 * tombstoned overlay to bring back. That answered the member who removed their
 * EMA 9 and could not find it again; it also meant that on exactly those charts
 * BROWSE SHOWED TWO ROWS READING "Moving Average", which is the owner's §34
 * ("Normal Add Indicator browsing should show ONE: Moving Average") and their §2
 * ("it looks like UCT has two completely different kinds of Moving Average").
 *
 * ⛔ THE CONFLICT IS ONLY IN THE WORDS. The two rows do different things — one
 * CREATES a source-capable moving average, the other RESTORES the `EMA 9` the
 * member already configured, with their colour and their period — so the answer is
 * not to hide one, it is to stop them being called the same thing. A row labelled
 * *Restore EMA 9* is unambiguous next to *Moving Average*, and it is also a better
 * offer than the one it replaces: it names the thing coming back.
 *
 * ⛔ AND IT RENAMES A COPY. `BUILT_IN_ROWS` is frozen and shared; the id, the
 * tags, `builtIn: 'overlay'` and therefore the `toggledRow` revive path are all
 * untouched, so this is presentation over an unchanged writer. §33's requirement —
 * *"Do NOT break removed-overlay revival"* — is met by not touching it.
 *
 * ⚠️ THE FIRST TOMBSTONE IS THE ONE NAMED, because it is the one `toggledRow`
 * revives (`list.findIndex(isOverlayRemoved)`). Naming a different one would be a
 * label that lies about what the click does.
 *
 * @param {object} row       a `BUILT_IN_ROWS` row
 * @param {object} settings  the chart settings blob
 * @returns {object} the row, renamed when it is the revealed revive row
 */
export function libraryRowFor(row, settings) {
  if (!row || row.id !== 'ma' || row.builtIn !== 'overlay') return row
  const overlays = Array.isArray(settings?.overlays) ? settings.overlays : []
  const dead = overlays.find(isOverlayRemoved)
  if (!dead) return row
  // The same grammar `indicatorRegistry.listIndicators` gives a live overlay row
  // — `EMA 9`, `SMA 200` — so the offer and the row it restores read alike.
  const what = `${dead.type || 'SMA'} ${dead.period ?? ''}`.trim()
  const name = what ? `Restore ${what}` : 'Restore removed moving average'
  return {
    ...row,
    name,
    shortName: 'Restore',
    description: what
      ? `Bring back the ${what} you removed from this chart, with the colour and period you set.`
      : 'Bring back the moving average you removed from this chart, with its settings.',
    // ⭐⭐ IT IS AN ADD ROW, NEVER AN "Active" ONE — and that is a statement about
    // the VERB, not a lie about the state. `isRowOn` for the legacy MA row means
    // "at least one moving average is live", which is true on the very chart where
    // one is tombstoned; the row then rendered *Active* with a `＋ Add another`
    // beside it, so the only way to get the removed EMA 9 back was a control
    // labelled "Add another Moving Average". One restore, one click, named for what
    // it restores.
    //
    // ⛔ `singleton` IS WHAT REMOVES THE SECOND CONTROL, and it is honest here for
    // the reason it is honest on Volume: there is exactly ONE tombstone this row
    // revives (`toggledRow` takes `findIndex(isOverlayRemoved)`). Restore it and
    // the row disappears, because `hiddenLibraryIds` stops revealing it.
    restores: true,
    singleton: true,
  }
}

export function libraryRows(registry) {
  const out = []
  for (const row of BUILT_IN_ROWS) {
    if (LIBRARY_HIDDEN_IDS.includes(row.id)) continue   // no settings here — the strict list
    out.push({ ...row, key: `builtin:${row.id}`, kind: 'builtin',
      capability: CAPABILITY.CHARTABLE, capabilityReason: null, create: null })
  }
  for (const row of catalogRows(registry)) {
    if (LIBRARY_HIDDEN_IDS.includes(row.id)) continue
    out.push({ ...row, key: `technical:${row.id}`, kind: 'technical',
      capability: CAPABILITY.CHARTABLE, capabilityReason: null,
      // A carved-out row has no definition to instantiate either.
      create: row.carvedOut ? null : { via: CREATE_VIA.DEFINITION, defId: row.id } })
  }
  for (const row of userCatalogRows(registry)) {
    out.push({ ...row, key: `formula:${row.id}`, kind: 'formula',
      capability: CAPABILITY.CHARTABLE, capabilityReason: null,
      create: { via: CREATE_VIA.DEFINITION, defId: row.id } })
  }
  return out
}

/** The two categories P2.2 adds. Named once so the dialog's hoist and the tests
 *  cannot drift from the adapters. */
// ═══ THE LIBRARY'S CATEGORY STRIP ═══════════════════════════════════
//
// ⭐⭐ A PRESENTATION TAXONOMY OVER CANONICAL FACTS, AND NOTHING ELSE. Every tab
// below answers from a field some canonical source already wrote:
//
//   Popular       a curated list of DEFINITION IDS, intersected with the registry
//   Technical     `kind: 'technical'` — `technicalResults`, which already drops
//                 `dataSeries` and legacy `ma` (`LIBRARY_HIDDEN_IDS`)
//   Fundamentals  ⛔ NOTHING. See `FUNDAMENTALS_STATUS` — this is a data fact, not
//                 a UI decision, and the tab says so rather than inventing rows
//   Breadth       `kind: 'breadth'` — the published breadth catalogue, untouched
//   Symbols       `kind: 'security'` whose server type is neither etf nor index
//   Indexes       `kind: 'security'`, server type `index`
//   ETFs          `kind: 'security'`, server type `etf`
//   Formulas      `kind: 'formula'` — the member's own installed definitions
//
// ⛔⛔ NO SECOND CLASSIFICATION IS INVENTED. `securityResults` already carries
// *"the server's own classification — `stock` / `etf` / `index` / `delisted`"* in
// `category`, which is the same vocabulary `symbolSearchModel.CHIPS` sends to
// `/api/ticker-search` as its `type` filter. This file re-reads it; it does not
// re-derive it, and it hard-codes no ticker into a class.
//
// ⛔ AND NO PERSISTENCE. The selected tab is component state for the life of one
// Add surface. A stored "last category" would be a new preference key on the
// settings blob for a filter the member re-chooses in one click.

/**
 * The strip, in reading order. `key` is internal; `label` is what is printed.
 *
 * ⚰️⚰️ IT HAD EIGHT TABS AND IT HAS FIVE. `Popular`, `ETFs` and `Formulas` are
 * off the strip — owner, 2026-09-17 — and the immediate reason is arithmetic:
 * eight tabs need 509px and the strip has 386, so three of them were always
 * behind a scroll. Five fit, which is what makes the navigation legible.
 *
 * ⛔ AND IT IS A NAVIGATION DECISION, NOT A DELETION. Nothing underneath moved:
 * `tabOf` still classifies a formula and an ETF, `resultsForTab` still answers for
 * both keys, and `glyphFamilyOf` still draws them. What changed is which keys this
 * ONE surface offers as a browse door — the categories that are gone are the ones
 * with another way in:
 *   · Popular    was a curated shortcut INTO Technical; Technical is the default
 *                 now, so the shortcut pointed at where you already are.
 *   · ETFs       an ETF is a security and arrives through Symbols and through
 *                 search, with the server's own classification intact.
 *   · Formulas   `＋ New Formula` in the header is the door to formulas, and it
 *                 is a CREATE door rather than a browse one.
 *
 * ⚠️ `POPULAR_DEF_IDS` AND ITS LEDGER ROW STAY. The curation is still a real
 * fact about which definitions matter most, `resultsForTab` still honours the
 * `popular` key, and deleting the list to match a strip would throw away the
 * judgment rather than the tab.
 */
export const LIBRARY_TABS = Object.freeze([
  Object.freeze({ key: 'technical', label: 'Technical' }),
  Object.freeze({ key: 'fundamentals', label: 'Fundamentals' }),
  Object.freeze({ key: 'breadth', label: 'Breadth' }),
  Object.freeze({ key: 'symbols', label: 'Symbols' }),
  Object.freeze({ key: 'indexes', label: 'Indexes' }),
])

/**
 * POPULAR — curated, by DEFINITION ID.
 *
 * ⛔⛔ IDS, NOT ROWS, AND THAT IS THE WHOLE SAFETY OF IT. This list says which
 * shipped definitions are common; the NAME, the description and the create door
 * still come from the registry, so "Moving Average" here is the same single
 * member-facing Moving Average that every other surface offers — there is no
 * second entry and no second implementation. An id that is not registered simply
 * does not appear, so removing a definition cannot leave a dead row here.
 *
 * ⚠️ LEGACY `ma` IS NOT ON IT and could not be used if it were:
 * `LIBRARY_HIDDEN_IDS` drops it before this is consulted.
 */
export const POPULAR_DEF_IDS = Object.freeze([
  'movingAverage', 'rsi', 'macd', 'bb', 'volume', 'stoch', 'atr', 'vwap', 'ichimoku',
])

/**
 * ⭐ FUNDAMENTALS: POINT-IN-TIME, FROM THE CATALOGUE THE SERVER PUBLISHES.
 *
 * The Fundamentals tab lists what `/api/fundamentals/pit/catalog` says is
 * historically available AND point-in-time safe (`fundamentalResults`). Every
 * row creates an ordinary `dataSeries` over a `fund:` source; each value on the
 * chart takes effect when its SEC filing became public -- never earlier, and
 * never today's snapshot painted backward.
 *
 * ⛔ WHEN THE CATALOGUE IS UNAVAILABLE (feature dark, not entitled, offline) the
 * tab says so plainly and offers nothing. It never falls back to Screener
 * snapshots, which have no history behind them.
 */
export const FUNDAMENTALS_STATUS = Object.freeze({
  available: false,
  lede: 'Historical fundamentals are not available right now.',
  why: 'Fundamentals here are point-in-time: each value is charted from the moment its '
    + 'SEC filing became public, never earlier, and never today’s value drawn backward. '
    + 'They will appear in this tab when that history is available to your chart.',
})

/**
 * CATALOGUE ROWS -> discovery results (the Fundamentals tab).
 *
 * ⭐ NO NEW CREATE DOOR. A row creates an ordinary `dataSeries` whose source is
 * `fund:<metric>` -- the metric OF THE CHARTED SYMBOL, so it follows the chart
 * like Volume does. Quarterly metrics default to a STEP line (the value really
 * does change only when a filing lands); daily price-derived ones and Beta to a
 * line. The member owns the style afterwards.
 *
 * ⛔ ONLY WHAT THE SERVER MARKED READY ARRIVES HERE; blocked and deferred metrics
 * are never shown as though they worked.
 */
export function fundamentalResults(metrics) {
  const out = []
  for (const m of Array.isArray(metrics) ? metrics : []) {
    if (!m || !m.id || !m.name || (m.status && m.status !== 'READY')) continue
    const source = fundamentalSource(m.id)
    if (!source) continue
    // ⭐ THE METHODOLOGY IS ON THE ROW, NOT ONLY IN A TOOLTIP (owner decision:
    // Beta reads "1Y daily · Benchmark: SPY"). The cadence word is dropped when
    // the subtitle already says it, so no row reads "Daily · 1Y daily".
    const cadence = m.cadence === 'quarterly' ? 'Quarterly' : 'Daily'
    const sub = typeof m.subtitle === 'string' ? m.subtitle.trim() : ''
    const chip = !sub ? cadence
      : sub.toLowerCase().includes(cadence.toLowerCase()) ? sub : `${cadence} · ${sub}`
    out.push(result({
      id: m.id,
      kind: 'fundamental',
      name: m.name,
      shortName: chip,
      lead: m.name,
      sub: m.subtitle || '',
      category: m.category || 'Fundamentals',
      description: [m.subtitle, m.methodology, m.limitations].filter(Boolean).join(' — '),
      tags: ['fundamental', ...(Array.isArray(m.aliases) ? m.aliases : [])],
      create: {
        via: CREATE_VIA.DATA_SERIES,
        source,
        ...(m.presentation === 'step' ? { presentation: { plotStyle: 'step' } } : {}),
      },
    }))
  }
  return out
}

/**
 * Which tab does one result belong to? Canonical fields only.
 *
 * ⚠️ `popular` IS NOT ANSWERED HERE, because it is not exclusive — Moving
 * Average is both Popular and Technical. Membership of Popular is a separate
 * test (`POPULAR_DEF_IDS`), so a result has ONE home tab and may also be curated.
 */
export function tabOf(res) {
  if (!res) return null
  if (res.userDefined === true || res.kind === 'formula') return 'formulas'
  if (res.kind === 'breadth') return 'breadth'
  if (res.kind === 'fundamental') return 'fundamentals'
  if (res.kind === 'security') {
    const t = String(res.category || '').toLowerCase()
    if (t === 'etf') return 'etfs'
    if (t === 'index') return 'indexes'
    return 'symbols'
  }
  // ⚰️⚰️ THE LAST BRANCH IS A DEFAULT, NOT `kind === 'technical'`, AND THE
  // DIFFERENCE EMPTIED THE LIBRARY ONCE. `kind` is stamped by `libraryRows`, and
  // the Indicators tab does NOT go through it — it assembles `BUILT_IN_ROWS`,
  // `catalogRows` and `userCatalogRows` directly, so a catalogue row arrives here
  // with an `id`, a `category` and no `kind` at all. Testing for `'technical'`
  // therefore filed every shipped definition under `null` and `Technical` showed
  // nothing. Measured: a sweep asserting every registered definition is
  // browsable saw five options, all of them rows in the LEFT list.
  // ⭐ SO THE QUESTION IS ASKED THE OTHER WAY ROUND: a row that is not a formula,
  // not breadth and not a security IS a technical one — which is true of both
  // shapes and stays true for a shape neither has yet.
  return 'technical'
}

// ═══ THE INDICATOR GLYPH ══════════════════════════════════════════
//
// ⛔⛔ PRESENTATION, NEVER PERSISTENCE. Nothing writes a glyph onto an instance,
// a definition or the settings blob: this is a pure function of facts the
// catalogue already holds, resolved at render time. A chart saved before this
// existed and one saved after are byte-identical, and deleting this file would
// cost a picture and nothing else.
//
// ⛔ AND IT READS CANONICAL METADATA, NOT THE DISPLAY STRING. Matching on a
// NAME would break the day a definition is renamed, would give two members
// different marks for the same study in different locales, and would make the
// glyph a function of prose. `kind` and the registry's own `category` are the
// facts; the only per-id entry is the one below, and it says why.

/** ⚠️ OWN-PROPERTY ONLY. A bare `map[key]` would answer `constructor` and
 *  `toString` for a definition id that happens to spell one — a prototype value
 *  where a family key belongs. */
const ownKey = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k)

/** family key → the `UIcon` name that draws it. */
export const GLYPH_FAMILIES = Object.freeze({
  trend: 'ind-trend',
  oscillator: 'ind-oscillator',
  momentum: 'ind-momentum',
  band: 'ind-band',
  volume: 'ind-volume',
  breadth: 'ind-breadth',
  fundamental: 'ind-fundamental',
  security: 'ind-security',
  formula: 'ind-formula',
  series: 'ind-series',
})

/**
 * ⭐ THE REGISTRY'S OWN `category` IS THE FAMILY, and that is the whole mapping.
 * `nativeRegistry` files every definition under Trend / Momentum / Volatility /
 * Volume / Data — which is already a statement about what the study DRAWS, made
 * by the person who wrote it. Reading it means a definition added tomorrow gets a
 * correct mark with no edit here.
 */
const CATEGORY_FAMILY = Object.freeze({
  trend: 'trend',
  momentum: 'oscillator',
  volatility: 'band',
  volume: 'volume',
  data: 'security',
})

/**
 * ⚠️ THE ONE PER-ID EXCEPTION, AND IT IS DELIBERATE. MACD is filed under
 * `Momentum` with RSI and Stochastic, which is correct as a CLASSIFICATION and
 * wrong as a picture: RSI draws a wave between two bounds and MACD draws a
 * histogram about zero. A member scanning the library reads the mark, so the mark
 * has to be what the study looks like.
 *
 * ⛔ ONE ENTRY, NOT A TABLE. Every other definition is answered by its category,
 * and this stays a single exception rather than becoming a second taxonomy — a
 * per-id map of twenty ids would be the enumeration site `enumerationSites.test.js`
 * exists to catch, and it would go stale the first time a definition was renamed.
 */
const FAMILY_BY_ID = Object.freeze({ macd: 'momentum' })

/**
 * Which family does this result belong to?
 *
 * @param {object} res a `DiscoveryResult` or a catalogue row
 * @returns {string} a key of `GLYPH_FAMILIES` — always one, never null
 */
export function glyphFamilyOf(res) {
  if (!res) return 'series'
  if (ownKey(FAMILY_BY_ID, res.id)) return FAMILY_BY_ID[res.id]
  const tab = tabOf(res)
  if (tab === 'breadth') return 'breadth'
  if (tab === 'fundamentals') return 'fundamental'
  if (tab === 'formulas') return 'formula'
  if (tab === 'symbols' || tab === 'indexes' || tab === 'etfs') return 'security'
  const cat = String(res.category || '').toLowerCase()
  // ⛔ THE FALLBACK IS NEUTRAL, NOT A GUESS. A definition whose category this
  // file has never heard of gets a mark that says only "this draws a series",
  // which is true of everything and wrong about nothing.
  return ownKey(CATEGORY_FAMILY, cat) ? CATEGORY_FAMILY[cat] : 'series'
}

/** The `UIcon` name for one result. */
export function glyphNameOf(res) {
  return GLYPH_FAMILIES[glyphFamilyOf(res)] || GLYPH_FAMILIES.series
}

/** Is this result one of the curated few? */
export function isPopular(res) {
  return !!res && tabOf(res) === 'technical' && POPULAR_DEF_IDS.includes(res.id)
}

/**
 * The results a tab shows, given everything discovery has produced.
 *
 * ⛔ IT FILTERS; IT NEVER FETCHES AND NEVER RANKS. The order it is handed is the
 * order the canonical sources chose — the registry's, the breadth library's and
 * the server's — and re-sorting here would be this file deciding it knows better
 * than the search that produced them.
 */
export function resultsForTab(results, tab) {
  const list = Array.isArray(results) ? results : []
  if (!tab) return list
  if (tab === 'popular') {
    // Curated ORDER, not registry order: the list above is a reading order.
    const byId = new Map(list.filter(isPopular).map((r) => [r.id, r]))
    return POPULAR_DEF_IDS.map((id) => byId.get(id)).filter(Boolean)
  }
  return list.filter((r) => tabOf(r) === tab)
}

export const SYMBOL_CATEGORY = 'Symbols'
export const BREADTH_CATEGORY = 'Breadth'

/**
 * A normalized SYMBOL result → a library row.
 *
 * ⭐ THE SYMBOL IS THE HEADLINE AND THE LONG NAME IS THE SUBTITLE, which is the
 * inversion a technical row does not want: "Relative Strength Index" is the thing
 * and "RSI" is the abbreviation, while for a security "QQQ" is the thing and
 * "Invesco QQQ Trust" is the gloss. Same markup, fields assigned to read right —
 * no second row component, no modal redesign.
 *
 *   QQQ                     ← name (headline)   ETF      ← shortName (chip)
 *   Invesco QQQ Trust       ← description (subtitle)
 *
 * ⚠️ THE SUBTITLE IS OMITTED WHEN THERE IS NO LONG NAME (owner §12) rather than
 * repeated from the headline: a row reading "QQQ / QQQ" is noise.
 */
export function symbolLibraryRow(res) {
  if (!res) return null
  const isBreadth = res.kind === 'breadth'
  const long = (res.name && res.name !== res.id) ? res.name : ''
  return {
    id: res.id,
    key: res.key,
    kind: res.kind,
    // ⭐ AND THE SAME INVERSION HERE. A security's headline is its ticker; a breadth
    // measure's headline is its METRIC, with the universe and the address beneath.
    // `NASDAQ:A50` as the headline and the metric as the subtitle is precisely the
    // reading order this phase exists to reverse.
    name: isBreadth ? (res.name || res.id) : res.id,
    // The server's own classification, upper-cased for the chip; breadth says so.
    shortName: isBreadth ? 'Breadth' : String(res.category || 'symbol').toUpperCase(),
    category: isBreadth ? BREADTH_CATEGORY : SYMBOL_CATEGORY,
    // The universe qualifies, and the address stays available without dominating.
    description: isBreadth ? [res.shortName, res.id].filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).join(' · ') : long,
    longName: long,
    tags: res.tags,
    capability: res.capability,
    capabilityReason: res.capabilityReason,
    create: res.create,
    // Flags the shared row markup reads. A symbol is none of these things, and
    // saying so explicitly beats relying on `undefined` being falsy.
    userDefined: false, carvedOut: false, singleton: false, builtIn: null,
    sessionOnly: false, tier: null, measuredRepaint: null, repaintingPlots: [],
  }
}

/**
 * MARKET INDICATOR ROWS → discovery results, through the shapers that already exist.
 *
 * ⭐⭐ NO NEW TAB, NO NEW RESULT KIND, NO NEW CREATE DOOR. The Indicators panel's
 * five-tab strip is an accepted model with a fixed shell width — eight tabs needed
 * 509px against 386, which is why three were removed — so a sixth would re-open a
 * navigation decision the owner already made. A market indicator is instead filed by
 * WHAT IT IS, using the taxonomy `tabOf` already applies:
 *
 *   volatility (a published Cboe index)  → `kind: 'security'`, `category: 'index'`
 *                                          → the **Indexes** tab, where an index belongs
 *   everything else (McClellan, breadth- → `kind: 'breadth'`
 *   derived, survey)                       → the **Breadth** tab, the market-internals door
 *
 * ⛔ AND THE FAMILY LABEL IS CARRIED AS THE CATEGORY, so "McClellan" and
 * "Sentiment & Positioning" appear as the group heading a member reads even though
 * both live under one tab. That is the owner's family model expressed as DATA rather
 * than as a second UI.
 *
 * ⚠️ DORMANT ROWS NEVER ARRIVE HERE. `/api/market-indicators` returns them in a
 * separate `dormant` array that the hook does not index, so NYMO cannot be shaped
 * into a result and cannot be clicked.
 */
export function marketIndicatorResults(rows, { tf, bars } = {}) {
  const vol = []
  const internals = []
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || !row.symbol) continue
    // ⚰️ MEASURED IN A BROWSER: the product reached `breadthResults` with its
    // `kind`, `components` and `component_rows` STRIPPED by the projection below,
    // so the product branch never fired and the row fell through as an ordinary
    // symbol — the panel printed `AAII:SURVEY` as the headline with the real name
    // demoted to the subtitle. An internal id in the one place a member reads, and
    // unaddable besides, because a product has no bars of its own.
    //
    // ⛔ SO A PRODUCT PASSES THROUGH WHOLE. The projection under it exists to
    // reshape a SERIES row into the breadth row shape; a product is already the
    // right shape and reshaping it can only lose fields.
    if (row.kind === 'product') {
      internals.push(row)
      continue
    }
    if (row.source_type === 'volatility') {
      vol.push({ ticker: row.symbol, name: row.display, type: 'index', exchange: 'CBOE' })
      continue
    }
    internals.push({
      symbol: row.symbol,
      name: row.display,
      short_name: row.short,
      // ⚠️ `legacy: true` SUPPRESSES THE UNIVERSE BADGE, and that is right for every
      // row here: `US · McClellan Oscillator` already states its universe in the name
      // the naming rules produced, so a second "US" chip beside it is noise. A breadth
      // library row differs — its name is the metric alone.
      legacy: true,
      group_label: row.family_label,
      presentation: row.presentation,
      domain: row.domain,
    })
  }
  return [...breadthResults(internals, { tf, bars }),
          ...securityResults(vol, { tf, bars })]
}
