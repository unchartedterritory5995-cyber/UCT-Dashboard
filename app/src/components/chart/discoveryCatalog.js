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
import { symbolSource, canonicalSymbol, derivedSourceName } from './engine/sourceRef'
import { addInstance, setInstanceInput, findInstance } from './engine/instanceControls'
import { cachedBars, SOURCE_STATUS } from './engine/secondaryBars'

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
 * @property {string} category
 * @property {string} description
 * @property {string[]} tags
 * @property {'chartable'|'unsupported'} capability
 * @property {string|null} capabilityReason
 * @property {{via: string, defId?: string, source?: string}} create
 */

const str = (v, fallback = '') => (typeof v === 'string' && v ? v : fallback)

function result({ id, kind, name, shortName, category, description, tags, capability, capabilityReason, create }) {
  return {
    key: `${kind}:${id}`,
    id,
    kind,
    name,
    shortName,
    category,
    description,
    tags: Array.isArray(tags) ? tags : [],
    capability: capability || CAPABILITY.CHARTABLE,
    capabilityReason: capabilityReason || null,
    create,
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
    const sym = canonicalSymbol(row.symbol || row.ticker)
    if (!sym) continue
    const name = str(row.name, sym)
    out.push(result({
      id: sym,
      kind: 'breadth',
      name,
      // ⭐ THE SYMBOL IS THE SHORT NAME. `UCTA50` is what the member typed, what
      // the axis shows and what the source string says; "% of Stocks Above
      // 50-Day MA" is the sentence that explains it.
      shortName: sym,
      category: str(row.group_label || row.groupLabel || row.group, 'Breadth'),
      description: name,
      tags: ['breadth'],
      ...knownCapabilityOf(sym, tf, bars),
      create: { via: CREATE_VIA.DATA_SERIES, source: symbolSource(sym, 'close') },
    }))
  }
  return out
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
  if (res.create.via === CREATE_VIA.DATA_SERIES) {
    // ⭐ THE DISPLAY NAME TRAVELS WITH THE ADD (P2.2). See `createDirectSeries`.
    return createDirectSeries(cs, res.create.source, registry, { name: res.shortName || res.id })
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
  const worthStoring = display && display.name && display.name !== derived
  return worthStoring ? withDisplay(next, minted.instanceId, display) : next
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
    indicatorInstances: list.map((i) => (
      i && i.instanceId === instanceId ? { ...i, display: { name: display.name } } : i
    )),
  }
}

/** The instance a `createFromResult` just minted, for a caller that needs to
 *  address it (a settings dialog, a label write, a test). `null` when the create
 *  was refused. */
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
export const LIBRARY_HIDDEN_IDS = Object.freeze([DIRECT_SERIES_DEF_ID])

export function libraryRows(registry) {
  const out = []
  for (const row of BUILT_IN_ROWS) {
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
    name: res.id,
    // The server's own classification, upper-cased for the chip; breadth says so.
    shortName: isBreadth ? 'Breadth' : String(res.category || 'symbol').toUpperCase(),
    category: isBreadth ? BREADTH_CATEGORY : SYMBOL_CATEGORY,
    description: long,
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
