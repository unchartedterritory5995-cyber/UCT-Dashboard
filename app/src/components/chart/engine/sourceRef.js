import { SOURCE_BAR_FIELDS } from './defSchema'
import { bindingKey } from './pool'

/**
 * WHAT A CALCULATION READS — the numeric series, and nothing about where it draws.
 *
 * ⭐⭐ THE WHOLE PHASE IN ONE SENTENCE: an indicator used to read BARS, and now it
 * reads a NUMERIC SERIES that may have come from bars, from another indicator's
 * output, or later from a formula. The consumer does not care which. That is why
 * this module knows nothing about panes, scales or styles — a source is an input
 * to CALCULATION, and `displayTarget.js` is a separate question with a separate
 * answer (`MA(RSI)` defaults into RSI's pane; it is not welded there).
 *
 * ⛔⛔ A SOURCE IS A STRING, AND THAT IS A DELIBERATE CHOICE OVER AN OBJECT.
 * `defSchema` already validates `type: 'source'` as a non-empty string; the
 * instance validator already accepts input values by type; `inputsSignature`
 * already hashes them with `String(v)`; persistence already round-trips them.
 * An object would have needed a new branch in every one of those, and bought
 * nothing — an instance id and a plot key are two strings either way. Keeping the
 * scalar shape is why this phase adds a dependency system without touching the
 * input pipeline.
 *
 * ⛔ AND IT NEVER NAMES A POSITION. Not a pane index, not a legend label, not an
 * array slot, not a display name — those all change while meaning the same thing,
 * or stay the same while meaning something else. Two RSIs on one chart are
 * `RSI (14)` and `RSI (7)` to a reader and `legacy:rsi` / `inst:rsi:2` to this.
 *
 * THE TWO FORMS:
 *
 *     'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume'
 *         a bar field — `defSchema.SOURCE_BAR_FIELDS`, unchanged
 *
 *     '@<instanceId>::<plotKey>'
 *         another INSTANCE's output
 *
 * ⭐ THE SECOND FORM IS `'@' + bindingKey(instanceId, plotKey)` ON PURPOSE. The
 * binder already keys every computed column by exactly `instanceId::plotKey`, so
 * resolving a source is one Map lookup rather than a translation layer — and the
 * two identities cannot drift apart, because they are the same string.
 *
 * ⚠️ THE DEFINITION-LEVEL DEFAULT STAYS `'defId.plotKey'`, which is what
 * `validateSourceReferents` has always checked. An AUTHOR says "an RSI", a USER
 * picks "THAT RSI" — a definition cannot name an instance that does not exist
 * yet. The two vocabularies do not overlap: `@` opens one and never the other.
 */

const MARK = '@'
const SEP = '::'

// ─── THE THIRD FAMILY: A CANONICAL BAR-SHAPED SYMBOL ────────────────────────
//
// ⭐⭐ `sym:QQQ:close` — AND IT IS DELIBERATELY NOT AN `@` FORM. `@` already
// carries two meanings that are told apart only by the presence of `::`: a
// SOURCE (`@inst:rsi:2::signal`) and a PANE TARGET (`@rsi`, `displayTarget.js`).
// Hanging a third meaning on that one-character distinction makes a thin rule
// thinner, and the failure would be silent — a malformed pane target parsing as
// a source, or the reverse. A distinct prefix cannot collide with either, and
// cannot collide with a bar field because no bar field contains `:`.
//
// ⛔⛔ AND IT NAMES A CANONICAL GLOBAL SOURCE, WHICH IS A DIFFERENT LIFECYCLE
// FROM AN INSTANCE. `@inst:rsi:2::signal` names something a member OWNS and can
// DELETE, which is why `severReferencesTo` exists: a re-added RSI mints the same
// deterministic id and would silently reconnect. `sym:QQQ:close` names an
// instrument. Nobody deletes QQQ. Removing the last consumer does not retire it,
// and adding it again later MUST resolve normally — it is the same instrument it
// always was. So a symbol source is never severed and never gets a gravestone;
// when the bar layer cannot serve it that is an AVAILABILITY fact (see
// `sourceAvailability`), not a deletion. Blurring the two would either strand a
// symbol a member can legitimately re-add, or resurrect an instance reference
// that was deliberately broken.
const SYM_MARK = 'sym:'

/**
 * The fields a symbol source may name.
 *
 * ⚠️ A SUBSET OF `SOURCE_BAR_FIELDS`, ON PURPOSE. `hl2`/`hlc3`/`ohlc4` are
 * derived from a bar's shape, and a breadth pseudo-symbol's shape is synthetic —
 * `breadth_symbols.py` stores ONE value per metric per day and renders
 * close-to-close candles, so its open is yesterday's close and its high/low are
 * derived from the pair rather than observed. Offering a derived field over a
 * derived bar would be arithmetic on a shape that was never measured.
 *
 * ⛔ Phase 1 is SCALAR, and these are the two fields that mean something for
 * every family a canonical symbol can come from.
 */
export const SYMBOL_SOURCE_FIELDS = Object.freeze(['close', 'volume'])

/** `sym:<SYMBOL>:<field>` — the durable identity of a canonical symbol source.
 *
 *  ⭐ SYMBOL + FIELD AND NOTHING ELSE. Not the timeframe (that is the CHART's,
 *  and the same source at 5m and 1D is the same request by the member), not the
 *  pane, not the style, not the label. Those either belong to the chart or are
 *  derived at render — and a label baked into identity is an identity that
 *  changes when a vendor renames something. */
export function symbolSource(symbol, field) {
  const sym = canonicalSymbol(symbol)
  if (!sym) return null
  if (typeof field !== 'string' || !SYMBOL_SOURCE_FIELDS.includes(field)) return null
  return `${SYM_MARK}${sym}${':'}${field}`
}

/**
 * The one spelling of a symbol, so two spellings cannot be two sources.
 *
 * ⚠️ UPPERCASE AND TRIMMED, AND THAT IS ALL. It does NOT resolve aliases:
 * `delisted_registry._provider_alias` maps a dead bare symbol to its primary and
 * is explicitly built to never redirect a LIVE ticker, so aliasing belongs at the
 * bar layer where that registry lives. Rewriting the member's requested
 * instrument here would change what they asked for, and they would never see it.
 */
export function canonicalSymbol(symbol) {
  if (typeof symbol !== 'string') return null
  const s = symbol.trim().toUpperCase()
  // ⛔ A symbol carrying the delimiter could not round-trip through the source
  // string, so it is not a symbol this form can name. Refused, never mangled.
  if (!s || s.includes(':')) return null
  return s
}

export { SOURCE_BAR_FIELDS }

/** Human words for the bar fields, for any surface that offers them. */
export const BAR_FIELD_LABELS = Object.freeze({
  close: 'Close', open: 'Open', high: 'High', low: 'Low',
  hl2: 'HL2', hlc3: 'HLC3', ohlc4: 'OHLC4', volume: 'Volume',
})

/**
 * `QQQ · Close` — what a member reads for a symbol source.
 *
 * ⭐ DERIVED, NEVER STORED. The label is not part of identity (see
 * `symbolSource`), so a vendor renaming an instrument cannot change what the
 * chart is pointing at. Discovery metadata may later give `UCTA50` a friendlier
 * name; that belongs to the catalogue, not to this string.
 */
export function symbolSourceLabel(parsed) {
  if (!parsed || parsed.kind !== 'symbol') return ''
  const field = BAR_FIELD_LABELS[parsed.field] || parsed.field
  return `${parsed.symbol} · ${field}`
}

/** The source string naming one output of one instance. */
export function instanceSource(instanceId, plotKey) {
  if (typeof instanceId !== 'string' || !instanceId) return null
  if (typeof plotKey !== 'string' || !plotKey) return null
  return MARK + bindingKey(instanceId, plotKey)
}

/**
 * Read a stored source value.
 *
 * @returns {{kind:'bar', field:string}
 *        | {kind:'instance', instanceId:string, plotKey:string}
 *        | {kind:'symbol', symbol:string, field:string}
 *        | null}
 *
 * ⚠️ `null` MEANS "I CANNOT READ THIS", and every caller treats that as
 * unresolved rather than as a default. Falling back to Close would make a typo,
 * a truncated write or a future form silently compute the wrong series and draw
 * it as if it were right — the one failure mode a source system must not have.
 */
export function parseSource(value) {
  if (typeof value !== 'string' || !value) return null
  if (value[0] !== MARK) {
    // ⭐ TRIED BEFORE THE BAR FIELD, and it cannot shadow one: no member of
    // `SOURCE_BAR_FIELDS` starts with `sym:`. An unknown field or an empty
    // symbol returns null here rather than falling through to the bar lookup —
    // `sym:QQQ:nonsense` is a malformed symbol source, not a missing bar field,
    // and answering "unresolved" for both is the same correct answer anyway.
    if (value.startsWith(SYM_MARK)) {
      const body = value.slice(SYM_MARK.length)
      const at = body.indexOf(':')
      if (at <= 0) return null
      const symbol = canonicalSymbol(body.slice(0, at))
      const field = body.slice(at + 1)
      if (!symbol || !SYMBOL_SOURCE_FIELDS.includes(field)) return null
      return { kind: 'symbol', symbol, field }
    }
    return SOURCE_BAR_FIELDS.includes(value) ? { kind: 'bar', field: value } : null
  }
  const body = value.slice(1)
  const at = body.lastIndexOf(SEP)
  if (at <= 0) return null
  const instanceId = body.slice(0, at)
  const plotKey = body.slice(at + SEP.length)
  if (!instanceId || !plotKey) return null
  return { kind: 'instance', instanceId, plotKey }
}

/**
 * Every canonical symbol this chart's instances need, deduped.
 *
 * ⭐⭐ THE SIBLING OF `ast_interpret.symbols_named`, AND DELIBERATELY THE SAME
 * SHAPE OF ANSWER. The Screener's scan evaluator already walks a tree for the
 * tickers it names, loads each ONCE outside the per-symbol loop, and states why:
 * "re-reading SPY for each of them would multiply the benchmark read by the
 * universe size for an answer that is identical every time." A chart has the same
 * problem one scale down — `QQQ`, `MA(QQQ)` and `QQQ/SPY` name QQQ three times
 * and mean it once.
 *
 * ⛔ IT ASKS THE SOURCE, NOT THE CONSUMER. A hidden instance, an instance feeding
 * another indicator, and a directly plotted one are indistinguishable here — all
 * three have a source input, and a source that is needed for a COLUMN is needed
 * whether or not anything draws it. Filtering by visibility would starve exactly
 * the dependency chains this phase exists to support.
 *
 * ⛔ AND NO FAMILY BRANCH. It never asks whether a symbol is breadth, an ETF or
 * an index; `parseSource` said `kind: 'symbol'` and that is the whole test.
 *
 * @returns {string[]} canonical symbols, sorted — a stable array for a stable key
 */
export function symbolsNeeded(instances, defOf) {
  const list = Array.isArray(instances) ? instances : []
  const out = new Set()
  for (const inst of list) {
    if (!inst) continue
    const def = defOf ? defOf(inst.defId) : null
    for (const [, value] of sourceInputsOf(def, inst)) {
      const parsed = parseSource(value)
      if (parsed && parsed.kind === 'symbol') out.add(parsed.symbol)
    }
  }
  // ⚠️ SORTED so the same set of symbols is the same array every time. A caller
  // keying a fetch or a memo on this must not see a new order because an
  // instance moved.
  return [...out].sort()
}

/** The instance id a source depends on, or null for market data. */
/**
 * A reference to an instance that has been DELETED — remembered, unreadable.
 *
 * ⭐⭐ OWNER DECISION, LOCKED: DELETION BREAKS THE DEPENDENCY. A `legacy:<defId>`
 * id is DETERMINISTIC per definition, so deleting RSI and adding it again mints
 * the very same id and every reference to it silently reconnected — measured
 * live, and reported as the nuance that prompted the ruling. "The same definition
 * appeared again" is not the same logical instance, and stable identity has to
 * mean instance identity or it means nothing.
 *
 * ⛔ SO THE REFERENCE IS SEVERED AT THE DELETE, NOT RE-RESOLVED AT THE READ, and
 * that is the smallest correct place: no id scheme changes, no persistence
 * migration, no tombstone bookkeeping in four readers. The severed string is
 * DELIBERATELY one `parseSource` refuses, so every consumer that already handles
 * "Source unavailable" — the Moving Average, a condition binding, the settings
 * selector — handles this with no new branch.
 *
 * ⚠️ AND IT KEEPS THE OLD TEXT. A member looking at the row can see WHICH series
 * went away; the alternative, blanking it, loses the only clue. Nothing parses it
 * back — it is a gravestone, not a reference.
 */
const SEVERED = '!'
export function severedSource(value) {
  return typeof value === 'string' && value ? SEVERED + value : value
}

/** Is this a reference that was severed by a delete? */
export function isSeveredSource(value) {
  return typeof value === 'string' && value.startsWith(SEVERED)
}

/**
 * Sever every reference to `instanceId` — in indicator `source` inputs and in
 * condition bindings alike.
 *
 * ⭐ ONE FUNCTION FOR BOTH, because there is ONE reference language. A future
 * consumer of `'@id::plot'` joins it by being in the settings blob, not by being
 * remembered here.
 */
export function severReferencesTo(cs, instanceId, defOf) {
  if (!cs || typeof instanceId !== 'string' || !instanceId) return cs
  let touched = false

  const instances = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  const nextInstances = instances.map((inst) => {
    if (!inst || inst.instanceId === instanceId) return inst
    const def = defOf ? defOf(inst.defId) : null
    let inputs = null
    for (const [key, value] of sourceInputsOf(def, inst)) {
      if (sourceDependsOn(value) !== instanceId) continue
      inputs = inputs || { ...(inst.inputs || {}) }
      inputs[key] = severedSource(value)
      touched = true
    }
    return inputs ? { ...inst, inputs } : inst
  })

  const conditions = Array.isArray(cs.conditions) ? cs.conditions : []
  const nextConditions = conditions.map((cond) => {
    if (!cond || !cond.bindings || typeof cond.bindings !== 'object') return cond
    let bindings = null
    for (const [key, value] of Object.entries(cond.bindings)) {
      if (sourceDependsOn(value) !== instanceId) continue
      bindings = bindings || { ...cond.bindings }
      bindings[key] = severedSource(value)
      touched = true
    }
    return bindings ? { ...cond, bindings } : cond
  })

  // ⭐ AND THE HEADER'S FORMULAS, BY THE SAME LOOP. A third consumer of one
  // reference language joins this function by being in the settings blob, not by
  // being remembered here — which is why adding it was four lines.
  const info = (cs.header && Array.isArray(cs.header.infoFormulas)) ? cs.header.infoFormulas : null
  let nextInfo = info
  if (info) {
    nextInfo = info.map((f) => {
      if (!f || !f.bindings || typeof f.bindings !== 'object') return f
      let bindings = null
      for (const [key, value] of Object.entries(f.bindings)) {
        if (sourceDependsOn(value) !== instanceId) continue
        bindings = bindings || { ...f.bindings }
        bindings[key] = severedSource(value)
        touched = true
      }
      return bindings ? { ...f, bindings } : f
    })
  }

  if (!touched) return cs
  return {
    ...cs,
    indicatorInstances: nextInstances,
    conditions: nextConditions,
    ...(nextInfo ? { header: { ...cs.header, infoFormulas: nextInfo } } : {}),
  }
}

export function sourceDependsOn(value) {
  const parsed = parseSource(value)
  return parsed && parsed.kind === 'instance' ? parsed.instanceId : null
}

/**
 * Every source input a definition declares, as `[inputKey, storedValue]`.
 *
 * ⚠️ READS THE DEFINITION FOR THE KEYS AND THE INSTANCE FOR THE VALUES, because
 * an instance stores only what the user changed: an untouched MA has no `source`
 * in `inst.inputs` at all and must still resolve to the definition's default.
 */
export function sourceInputsOf(def, instance) {
  const out = []
  for (const input of (def && Array.isArray(def.inputs) ? def.inputs : [])) {
    if (!input || input.type !== 'source' || typeof input.key !== 'string') continue
    const stored = instance && instance.inputs ? instance.inputs[input.key] : undefined
    out.push([input.key, stored === undefined ? input.default : stored])
  }
  return out
}

/** A numeric series from the bars, for a bar-field source. */
export function barFieldSeries(bars, field) {
  const n = Array.isArray(bars) ? bars.length : 0
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const b = bars[i]
    if (!b) { out[i] = NaN; continue }
    switch (field) {
      case 'open': out[i] = b.o; break
      case 'high': out[i] = b.h; break
      case 'low': out[i] = b.l; break
      case 'close': out[i] = b.c; break
      case 'volume': out[i] = b.v; break
      case 'hl2': out[i] = (b.h + b.l) / 2; break
      case 'hlc3': out[i] = (b.h + b.l + b.c) / 3; break
      case 'ohlc4': out[i] = (b.o + b.h + b.l + b.c) / 4; break
      default: out[i] = NaN
    }
  }
  return out
}

/**
 * Order instances so every source is computed before its consumers.
 *
 * ⭐ THE SMALLEST THING THAT IS ACTUALLY CORRECT — Kahn's algorithm over the
 * edges that exist, and nothing else. No graph objects, no scheduler, no node
 * editor. `A depends on B` works, `C depends on A` works because the same sort
 * handles depth for free, and the day something needs more than a topological
 * order it can grow here.
 *
 * ⛔⛔ AND IT DOES NOT RELY ON ARRAY ORDER, which is what the compute loop did
 * before. That was correct only by accident: instances are stored in the order
 * they were ADDED, so an MA added before its RSI would have computed against a
 * column that did not exist yet and silently drawn nothing.
 *
 * ⚠️ A CYCLE IS REPORTED, NEVER SORTED AROUND. Anything still holding an
 * unsatisfied edge when the queue drains is in one (or downstream of one), and
 * those ids come back in `cyclic` so the caller can refuse to compute them
 * rather than spin. `A → B → A` and a self-edge are the same case to this.
 *
 * @returns {{ordered: object[], cyclic: Set<string>}}
 */
export function orderByDependency(instances, defOf) {
  const list = Array.isArray(instances) ? instances.filter(Boolean) : []
  const byId = new Map()
  for (const inst of list) {
    if (typeof inst.instanceId === 'string' && inst.instanceId) byId.set(inst.instanceId, inst)
  }

  /** id → the ids it needs computed first (only edges we can actually satisfy). */
  const needs = new Map()
  /** id → the ids waiting on it. */
  const feeds = new Map()
  for (const inst of list) {
    const id = inst.instanceId
    if (!id) continue
    const deps = new Set()
    for (const [, value] of sourceInputsOf(defOf ? defOf(inst.defId) : null, inst)) {
      const dep = sourceDependsOn(value)
      // An edge to an instance that is not on the chart is NOT a dependency —
      // it is a MISSING SOURCE, which is the consumer's problem to render, not
      // the sort's problem to wait for. Waiting would deadlock the whole pass.
      if (dep && byId.has(dep)) deps.add(dep)
    }
    needs.set(id, deps)
    for (const d of deps) {
      if (!feeds.has(d)) feeds.set(d, new Set())
      feeds.get(d).add(id)
    }
  }

  const ordered = []
  const queue = []
  const remaining = new Map()
  for (const inst of list) {
    const id = inst.instanceId
    if (!id) { ordered.push(inst); continue }   // unaddressable: nothing can depend on it
    const n = needs.get(id).size
    remaining.set(id, n)
    if (n === 0) queue.push(id)
  }

  while (queue.length) {
    const id = queue.shift()
    ordered.push(byId.get(id))
    for (const next of (feeds.get(id) || [])) {
      const left = remaining.get(next) - 1
      remaining.set(next, left)
      if (left === 0) queue.push(next)
    }
  }

  const cyclic = new Set()
  for (const [id, left] of remaining) if (left > 0) cyclic.add(id)
  return { ordered, cyclic }
}

/**
 * Would pointing `instanceId` at `value` create a cycle?
 *
 * ⭐ ASKED AT THE SETTER, so an impossible assignment is REFUSED rather than
 * stored and then coped with forever. Self-reference is the one-step case and
 * needs no separate check — `A → A` is a cycle.
 */
export function wouldCycle(instances, defOf, instanceId, value) {
  const dep = sourceDependsOn(value)
  if (!dep) return false
  if (dep === instanceId) return true

  const byId = new Map()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (inst && typeof inst.instanceId === 'string') byId.set(inst.instanceId, inst)
  }
  // Walk UP from the proposed source: if we reach the consumer, the edge closes
  // a loop. Bounded by the instance count, so a pre-existing cycle in the stored
  // state cannot hang this.
  const seen = new Set()
  let frontier = [dep]
  while (frontier.length) {
    const next = []
    for (const id of frontier) {
      if (id === instanceId) return true
      if (seen.has(id)) continue
      seen.add(id)
      const inst = byId.get(id)
      if (!inst) continue
      for (const [, v] of sourceInputsOf(defOf ? defOf(inst.defId) : null, inst)) {
        const up = sourceDependsOn(v)
        if (up) next.push(up)
      }
    }
    frontier = next
  }
  return false
}

/**
 * The choices a Source control should offer, grouped, in reading order.
 *
 * ⭐ A SOURCE'S OPTIONS ARE A PROPERTY OF THE CHART, NOT OF THE DEFINITION —
 * which is why they are built here from the live instances rather than declared
 * as an `enum`. "Price data" is always available; "Indicators" is whatever else
 * is on this chart right now.
 *
 * ⛔ EVERY LABEL DISAMBIGUATES, because two RSIs are the normal case. The group
 * label carries the indicator's own legend parameters (`RSI (14)` / `RSI (7)`)
 * and the row carries the OUTPUT (`RSI`, `Signal`, `Histogram`), so no two rows
 * read the same while meaning different series — and the VALUE is the instance
 * id either way, so a rename could never re-target one.
 *
 * ⛔ AND THE CONSUMER IS NEVER OFFERED ITSELF. `MA` cannot average itself, and
 * an option that can only produce an error is not a choice.
 *
 * ⚠️ ONLY OUTPUTS THE LEGEND READS. A definition's guide plots (`hlines`) are
 * reference lines, not series a reader would average — the same
 * `plot.legend.hide !== true` filter the chips and the last-value tag apply.
 *
 * @param {object} cs            chart settings
 * @param {(id:string)=>object} defOf
 * @param {string} selfInstanceId the instance the control belongs to
 * @returns {{label: string, options: {value: string, label: string}[]}[]}
 */
export function sourceOptions(cs, defOf, selfInstanceId, currentValue = null) {
  const groups = [{
    label: 'Price data',
    options: SOURCE_BAR_FIELDS.map((f) => ({ value: f, label: BAR_FIELD_LABELS[f] || f })),
  }]

  // ⛔⛔ A VALUE MUST BE REPRESENTABLE IN THE CONTROL THAT EDITS IT.
  // Phase 1 lets an input hold `sym:QQQ:close`, and this list is what a `<select>`
  // renders: a stored value with no matching option shows BLANK, and the next
  // change event then writes whichever option the browser fell back to — silently
  // rewriting the member's instrument. There is no symbol CATALOGUE here on
  // purpose (that is a later phase), so the current value is offered as itself,
  // which is the smallest thing that is correct.
  const cur = parseSource(currentValue)
  if (cur && cur.kind === 'symbol') {
    groups.push({
      label: 'Symbol',
      options: [{ value: currentValue, label: symbolSourceLabel(cur) }],
    })
  }

  const instances = Array.isArray(cs && cs.indicatorInstances) ? cs.indicatorInstances : []
  const indicators = []
  for (const inst of instances) {
    if (!inst || typeof inst !== 'object') continue
    if (typeof inst.instanceId !== 'string' || !inst.instanceId) continue
    if (inst.instanceId === selfInstanceId) continue
    if (inst.deleted === true) continue
    const def = defOf ? defOf(inst.defId) : null
    if (!def) continue

    const outputs = []
    for (const plot of (Array.isArray(def.plots) ? def.plots : [])) {
      if (!plot || typeof plot.key !== 'string') continue
      if (plot.style === 'hlines') continue
      if (plot.legend && plot.legend.hide === true) continue
      outputs.push({
        value: instanceSource(inst.instanceId, plot.key),
        label: plot.label || plot.key,
      })
    }
    if (!outputs.length) continue
    indicators.push({ label: instanceLabel(def, inst), options: outputs })
  }
  // One flat "Indicators" heading would make two RSIs indistinguishable, so each
  // instance is its own group and the group IS the disambiguation.
  return groups.concat(indicators)
}

/**
 * The member-facing stem of a definition whose identity IS its source.
 *
 * `sym:QQQ:close` → `QQQ`. `sym:UCTA50:close` → `UCTA50`. An instance source
 * (`@inst:rsi:1::rsi`) has no name of its own here — the host's label is the
 * caller's to resolve, and guessing one would be a second naming rule — so this
 * answers `null` and the ordinary stem applies.
 *
 * ⚠️ THE SYMBOL ONLY, NOT `symbolSourceLabel`'s `QQQ · Close`. That form names a
 * SOURCE in a picker, where the field matters because `close` and `volume` are
 * different choices. This names a SERIES in a legend, where the field is noise:
 * a pane reading `QQQ · Close 715.44` says "close" twice.
 */
/**
 * The name a `labelFrom: 'source'` instance gives ITSELF, from its source alone.
 *
 * ⭐⭐ EXPORTED SO A CALLER CAN ASK "IS THIS NAME WORTH STORING?". A catalogue
 * that stamps `display.name = 'QQQ'` on a series whose source already derives
 * `QQQ` has not recorded a CHOICE — it has frozen a copy of the answer, and the
 * copy stops being true the moment the member re-points the source. That is the
 * defect measured in a browser at Phase 3 (the legend read `QQQ 218.29` over
 * NVDA's price). `discoveryCatalog` compares against this before stamping.
 *
 * ⛔ IT IS NOT A SECOND NAMING SYSTEM. `instanceLabel` is still the one answer
 * every surface reads; this is the same derivation, exposed so the WRITE side can
 * tell a derived name from a chosen one.
 */
export function derivedSourceName(def, instance) {
  return sourceStem(def, instance)
}

function sourceStem(def, instance) {
  const sources = sourceInputsOf(def, instance)
  if (!sources.length) return null
  const parsed = parseSource(sources[0][1])
  return parsed && parsed.kind === 'symbol' ? parsed.symbol : null
}

/**
 * `RSI (14)` — the definition's short name plus the inputs its legend prints.
 *
 * ⭐ THE SAME `legendParams` THE CHIP USES, so the source list and the readout
 * name an indicator identically. A second naming rule is a second thing to keep
 * in step, and this one is already correct for every definition.
 */
export function instanceLabel(def, instance) {
  // ⭐⭐ THE ONE DEFINITION WHOSE NAME IS NOT ITS OWN (P2.1). `dataSeries` plots
  // whatever it is pointed at, so calling every instance "Series" would give a
  // member three panes with one name; the thing they picked was `QQQ`. The stem
  // comes from the SOURCE and the definition stays generic.
  //
  // ⛔⛔ DERIVED, NOT STORED, AND IDENTITY IS UNTOUCHED. The instance still
  // carries `inputs.source = 'sym:QQQ:close'`; the friendly name is recomputed
  // from it every time. Encoding a label INTO the source string would make two
  // symbols differing only in display name two different sources.
  //
  // ⚠️ THE LONG NAME ("Invesco QQQ Trust") IS NOT HERE, DELIBERATELY. Only the
  // catalogue knows it — the chart never learns it — so it would have to be
  // STORED. The instance shape already tolerates that (`validateInstance` returns
  // the instance unchanged and whitelists no fields, proven in
  // `discoveryCatalog.test.js`), so `instance.display` is available to P2.2 with
  // no migration. It is not written today because nothing reads it, and a
  // persisted field with no consumer is a guess later code has to keep true.
  if (def && def.meta && def.meta.labelFrom === 'source') {
    // ⭐ THE CATALOGUE'S NAME FIRST (P2.2), the derived one as the fallback. An
    // instance added through Add-to-Chart carries `display.name`; one created by
    // any other door, or before P2.2, still names itself from its source.
    const stored = instance && instance.display && instance.display.name
    if (typeof stored === 'string' && stored) return stored
    const fromSource = sourceStem(def, instance)
    if (fromSource) return fromSource
  }
  const stem = (def && (def.meta?.shortName || def.meta?.name)) || (def && def.id) || '?'
  const params = (def && def.meta && Array.isArray(def.meta.legendParams)) ? def.meta.legendParams : []
  if (!params.length) return stem
  const vals = []
  for (const key of params) {
    const declared = (def.inputs || []).find((i) => i && i.key === key)
    const stored = instance && instance.inputs ? instance.inputs[key] : undefined
    const v = stored === undefined ? (declared ? declared.default : undefined) : stored
    if (v !== undefined) vals.push(v)
  }
  return vals.length ? `${stem} (${vals.join(', ')})` : stem
}

/**
 * The fixed domain a series should be read against, following the source chain.
 *
 * ⭐⭐ THIS IS WHY `MA(RSI)` READS 0-100 WITHOUT THE RENDERER KNOWING WHAT AN RSI
 * IS. The MA definition declares no scale of its own — an average of *what*? —
 * so the answer has to come from what it is averaging, and only a transform that
 * PRESERVES its input's range may take it.
 *
 * ⛔⛔ `domainBehavior: 'inherit'` IS AN ANALYTICAL CLAIM THE DEFINITION MAKES,
 * not a default. A moving average of a 0-100 series is itself 0-100, so MA claims
 * it. A DIFFERENCE of two RSIs is -100..100 and a RATIO is unbounded — neither
 * may inherit, and neither will, because saying nothing means `'dynamic'`. Making
 * inheritance automatic would have been correct for exactly the one transform
 * this phase ships and wrong for the next one.
 *
 * THE ORDER:
 *   1. the definition's OWN declared scale — an RSI is 0-100 whatever it reads
 *   2. `domainBehavior: 'inherit'` → the SOURCE's domain, recursively
 *   3. dynamic
 *
 * ⚠️ A BAR FIELD IS DYNAMIC, INCLUDING VOLUME. Price and volume have no bounded
 * range, so `MA(Close)` and `MA(Volume)` autoscale exactly as they always did.
 *
 * ⚠️ DEPTH-BOUNDED. Cycles are refused at the setter and skipped by the compute
 * order, but this walks stored state that a hand-edited blob could have made
 * circular, and a resolver that can hang is a blank chart.
 */
export function resolveScaleDomain(instance, defOf, instances, depth = 0) {
  if (!instance || depth > 8) return null
  const def = defOf ? defOf(instance.defId) : null
  if (!def) return null

  const declared = def.placement && def.placement.scale
  if (declared && Number.isFinite(declared.min) && Number.isFinite(declared.max)) return declared
  if (def.domainBehavior !== 'inherit') return null

  const list = Array.isArray(instances) ? instances : []
  for (const [, value] of sourceInputsOf(def, instance)) {
    const parsed = parseSource(value)
    if (!parsed || parsed.kind !== 'instance') return null
    const src = list.find((i) => i && i.instanceId === parsed.instanceId)
    if (!src) return null
    return resolveScaleDomain(src, defOf, list, depth + 1)
  }
  return null
}

/** A placement target naming the pane another DEFINITION owns. */
export const PANE_OF = '@'
export const paneOfTarget = (defId) => (typeof defId === 'string' && defId ? PANE_OF + defId : null)
export const parsePaneOfTarget = (target) =>
  (typeof target === 'string' && target[0] === PANE_OF && target.length > 1 ? target.slice(1) : null)

/**
 * Where a DERIVED indicator draws when nobody has said otherwise.
 *
 * ⭐⭐ THE PRODUCT RULE: an indicator computed FROM something defaults to where
 * that something already is. `MA(Close)` belongs on the candles, `MA(Volume)` in
 * the volume pane, `MA(RSI)` in RSI's pane — which is what a trader means when
 * they add it, and what makes them feel like one feature rather than three.
 *
 * ⛔ A DEFAULT, NEVER A WELD. This is consulted only when the instance has no
 * explicit `placement.target` of its own, so moving `MA(RSI)` to its own pane
 * later is an ordinary placement write that outranks this — SOURCE and DISPLAY
 * TARGET stay separable, which is the whole distinction Part 12 asks for.
 *
 * ⭐ AND IT FOLLOWS ITS SOURCE ONTO VOLUME. If RSI is overlaid on the volume
 * pane, `MA(RSI)` resolves to `'volume'` too rather than to RSI's (now absent)
 * own pane — so the pair moves as a pair instead of detaching.
 *
 * @param {Function} targetOfInstance resolves ANOTHER instance's effective target
 * @returns {string|null} a target, or null when this definition derives nothing
 */
export function derivedTargetFor(instance, def, instances, defOf, targetOfInstance) {
  const sources = sourceInputsOf(def, instance)
  if (!sources.length) return null

  const [, value] = sources[0]
  const parsed = parseSource(value)
  if (!parsed) return null

  // Market data: volume has a pane of its own, everything else is the candles'.
  if (parsed.kind === 'bar') return parsed.field === 'volume' ? 'volume' : 'price'

  const list = Array.isArray(instances) ? instances : []
  const src = list.find((i) => i && i.instanceId === parsed.instanceId)
  if (!src) return null                       // missing source — see the consumer

  const srcTarget = targetOfInstance ? targetOfInstance(src) : null
  // Wherever the source ACTUALLY ended up. `price` and `volume` are shared panes
  // that already have a name; anything else means the source has a pane of its
  // own, and the follower wants THAT pane — named by the definition that owns it,
  // because that is how `computePaneLayout` keys panes.
  if (srcTarget === 'volume' || srcTarget === 'price') return srcTarget
  const owner = parsePaneOfTarget(srcTarget)
  // ⭐⭐ THE HOST IS THE SOURCE **INSTANCE**, NOT ITS DEFINITION (P2.0c). This
  // read `src.defId`, because that was how `computePaneLayout` keyed panes — and
  // it made two follower groups collide: `MA(RSI A)` and `MA(RSI B)` both
  // resolved to `@rsi`, so both landed in whichever single RSI pane existed. A
  // follower wants THE PANE ITS OWN SOURCE IS IN, which is an instance-level
  // fact; naming the definition was only ever an approximation that held while
  // one definition could have only one pane.
  return paneOfTarget(owner || src.instanceId)
}
