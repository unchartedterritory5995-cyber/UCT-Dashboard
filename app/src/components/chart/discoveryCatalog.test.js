// app/src/components/chart/discoveryCatalog.test.js
//
// ─── P2.1 · A CATALOGUE RESULT BECOMES A VISUAL INSTANCE ────────────────────
//
// The phase proves ONE sentence: a discovery result can become an ordinary
// declarative instance, and `QQQ` and `UCTA50` differ only in discovery metadata
// and in the string after `sym:`.
//
// ⛔ THE CASES BELOW ARE ORGANISED BY THE CLAIM THEY DEFEND, not by the function
// they call, because the failure this phase is exposed to is a SECOND SYSTEM
// appearing — a breadth renderer, a security lane, a per-family creation path.
// Every one of those would pass a function-shaped test suite.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import {
  CAPABILITY, CREATE_VIA, RESULT_KINDS, DIRECT_SERIES_DEF_ID,
  technicalResults, formulaResults, breadthResults, securityResults,
  knownCapabilityOf, createFromResult, createDirectSeries, lastCreatedInstance,
} from './discoveryCatalog'
import { clearSecondaryBars, primeSecondaryBars } from './engine/secondaryBars'
import { removeInstance, setInstanceHidden, setInstanceDisplayTarget, setInstanceInput } from './engine/instanceControls'
import { parseSource, instanceLabel } from './engine/sourceRef'
import { engineChips } from './engine/readout'

const TF = 'D'
const BARS = 300

const base = () => mergeChartSettings({})
const live = (cs) => (cs.indicatorInstances || []).filter((i) => i && i.deleted !== true)
const ofDef = (cs, defId) => live(cs).filter((i) => i.defId === defId)

/** The `/api/breadth-symbols` row shape, verbatim from `breadth_monitor.py:450`. */
const BREADTH_ROW = {
  symbol: 'UCTA50', metric: 'pct_above_50sma',
  name: '% of Stocks Above 50-Day MA', group: 'ma', group_label: 'Moving averages',
}
/** The `/api/ticker-search` row shape, verbatim from `ticker_search.py:136`. */
const QQQ_ROW = { ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', exchange: 'NASDAQ', entity_id: 1 }
const SPY_ROW = { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'etf', exchange: 'NYSE', entity_id: 2 }

beforeEach(() => { clearSecondaryBars() })

// ─── §24 · local catalogue discovery ────────────────────────────────────────

describe('§24 · local discovery — the shipped catalogues, projected', () => {
  it('⭐ RSI arrives as a technical result with a creation descriptor', () => {
    const rsi = technicalResults(registry).find((r) => r.id === 'rsi')
    expect(rsi, 'RSI is not discoverable at all').toBeTruthy()
    expect(rsi.kind).toBe('technical')
    expect(rsi.key).toBe('technical:rsi')
    // ⛔ THE FIELDS ARE THE REGISTRY'S, NOT THIS FILE'S. Comparing against the
    // definition's own `meta` is what makes this a projection test rather than a
    // transcription of strings somebody typed twice.
    const def = registry.getDefinition('rsi')
    expect(rsi.name).toBe(def.meta.name)
    expect(rsi.shortName).toBe(def.meta.shortName)
    expect(rsi.category).toBe(def.meta.category)
    expect(rsi.description).toBe(def.meta.description)
    expect(rsi.capability).toBe(CAPABILITY.CHARTABLE)
    expect(rsi.create).toEqual({ via: CREATE_VIA.DEFINITION, defId: 'rsi' })
  })

  it('⭐ every shipped definition is discoverable — except the substrate', () => {
    const ids = technicalResults(registry).map((r) => r.id).sort()
    const shipped = registry.listDefinitions().map((d) => d.id)
      .filter((id) => id !== DIRECT_SERIES_DEF_ID).sort()
    // ⛔ AN EQUALITY. A definition that stops being discoverable is an indicator
    // nobody can find, and no pixel gate can see that.
    expect(ids, 'the facade and the shipped catalogue disagree').toEqual(
      [...new Set([...shipped, ...registry.CARVED_OUT_INDICATOR_KEYS])].sort(),
    )
  })

  it('⛔⛔ the SUBSTRATE is not a browsable row', () => {
    // `dataSeries` plots whatever it is pointed at. As a catalogue entry it would
    // read "Data Series", offer to plot `close` in its own pane, and mean nothing
    // to anyone — the member-facing thing is QQQ. It reaches a chart only through
    // a breadth or security result, which carries the source that gives it meaning.
    expect(technicalResults(registry).map((r) => r.id))
      .not.toContain(DIRECT_SERIES_DEF_ID)
    // …and the control: it really IS registered, so the filter above is filtering
    // something rather than describing a definition that does not exist.
    expect(registry.getDefinition(DIRECT_SERIES_DEF_ID), 'the substrate is not registered').toBeTruthy()
  })

  it('⭐ a member formula is discoverable as its own kind, through the existing door', () => {
    // ⛔ NOT A SECOND FORMULA SOURCE. The fake registry answers
    // `listUserDefinitions`, which is exactly what `userCatalogRows` reads — so
    // this proves the adapter consumes the real door rather than a copy.
    const fake = {
      listDefinitions: () => [],
      listUserDefinitions: () => [{
        id: 'myFormula', version: 1,
        meta: { name: 'My Squeeze', shortName: 'SQZ', description: 'mine', tags: ['x'] },
        placement: { target: 'pane' }, inputs: [], plots: [],
      }],
      registryGeneration: () => 1,
    }
    const rows = formulaResults(fake)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('formula')
    expect(rows[0].name).toBe('My Squeeze')
    expect(rows[0].create).toEqual({ via: CREATE_VIA.DEFINITION, defId: 'myFormula' })
    // The category is the PROVENANCE one `indicatorCatalog` assigns, not `meta`'s.
    expect(rows[0].category).toBe('My formulas')
  })

  it('⭐ a breadth measure arrives with the server\'s own name, group and source', () => {
    const [row] = breadthResults([BREADTH_ROW], { tf: TF, bars: BARS })
    expect(row.kind).toBe('breadth')
    expect(row.id).toBe('UCTA50')
    expect(row.shortName).toBe('UCTA50')
    expect(row.name).toBe('% of Stocks Above 50-Day MA')
    expect(row.category, 'the group label is the server\'s, not a table here')
      .toBe('Moving averages')
    expect(row.capability).toBe(CAPABILITY.CHARTABLE)
    expect(row.create).toEqual({ via: CREATE_VIA.DATA_SERIES, source: 'sym:UCTA50:close' })
  })

  it('⛔ every kind it can emit is in the declared vocabulary', () => {
    const all = [
      ...technicalResults(registry),
      ...breadthResults([BREADTH_ROW]),
      ...securityResults([QQQ_ROW]),
    ]
    expect(all.length).toBeGreaterThan(10)
    for (const r of all) expect(RESULT_KINDS, `${r.key} has an off-vocabulary kind`).toContain(r.kind)
  })
})

// ─── §25 · remote catalogue discovery + capability ──────────────────────────

describe('§25, §22, §23 · remote discovery, and what cannot be charted', () => {
  it('⭐ QQQ is discoverable and chartable', () => {
    const [row] = securityResults([QQQ_ROW], { tf: TF, bars: BARS })
    expect(row.kind).toBe('security')
    expect(row.id).toBe('QQQ')
    expect(row.name).toBe('Invesco QQQ Trust')
    expect(row.category).toBe('etf')
    expect(row.capability).toBe(CAPABILITY.CHARTABLE)
    expect(row.create.source).toBe('sym:QQQ:close')
  })

  it('⛔⛔ a symbol the route SAID it cannot serve is discoverable and UNSUPPORTED', () => {
    // ⚠️ THIS IS THE `^IXIC` DOCTRINE, EXPRESSED AS THE RULE RATHER THAN THE
    // SYMBOL. `api/routers/bars.py:760` answers a cash index with an empty bar
    // list AND a `note`, and `secondaryBars._read` turns exactly that pairing into
    // `UNSUPPORTED`. Priming the cache with that payload is the same thing
    // happening — no second fake symbol database, no hard-coded ticker list.
    primeSecondaryBars('^IXIC', TF, BARS, {
      ticker: '^IXIC', tf: 'D', bars: [], sealed: false,
      note: 'index history not served by /api/bars-history',
    })
    const [row] = securityResults(
      [{ ticker: '^IXIC', name: 'Nasdaq Composite', type: 'index', exchange: 'NASDAQ' }],
      { tf: TF, bars: BARS },
    )
    expect(row, 'the result must still EXIST — hiding it tells the member nothing').toBeTruthy()
    expect(row.capability).toBe(CAPABILITY.UNSUPPORTED)
    expect(row.capabilityReason, 'the route\'s own words are the reason')
      .toBe('index history not served by /api/bars-history')
  })

  it('⛔⛔ …and it cannot create — no fabricated data, no silent failure', () => {
    primeSecondaryBars('^IXIC', TF, BARS, {
      ticker: '^IXIC', tf: 'D', bars: [], note: 'index history not served by /api/bars-history',
    })
    const [row] = securityResults([{ ticker: '^IXIC', name: 'Nasdaq Composite', type: 'index' }],
      { tf: TF, bars: BARS })
    const cs = base()
    const next = createFromResult(cs, row, registry)
    // ⛔ REFUSED BY IDENTITY, this codebase's refusal convention: nothing is
    // persisted for a no-op, and `next !== cs` is the caller's test.
    expect(next, 'an unservable symbol created an instance').toBe(cs)
    expect(ofDef(next, DIRECT_SERIES_DEF_ID)).toHaveLength(0)
  })

  it('⛔ AND IT IS NEVER PROXIED. `^IXIC` does not become QQQ, or anything else', () => {
    primeSecondaryBars('^IXIC', TF, BARS, { bars: [], note: 'index history not served' })
    const [row] = securityResults([{ ticker: '^IXIC', name: 'Nasdaq Composite', type: 'index' }],
      { tf: TF, bars: BARS })
    expect(row.id).toBe('^IXIC')
    expect(row.create.source).toBe('sym:^IXIC:close')
    // The descriptor names the symbol the member asked for, even though it cannot
    // be created. A substituted source would be the one failure this doctrine is
    // about: a chart confidently answering about the wrong instrument.
    expect(JSON.stringify(row)).not.toContain('QQQ')
  })

  it('⛔ a DELISTED row is discoverable and unsupported, on the server\'s evidence', () => {
    const [row] = securityResults(
      [{ ticker: 'TWTR', name: 'Twitter Inc', type: 'delisted', delisted: true, delisted_date: '2022-10-28' }],
      { tf: TF, bars: BARS },
    )
    expect(row.capability).toBe(CAPABILITY.UNSUPPORTED)
    expect(row.capabilityReason).toBe('delisted 2022-10-28')
    // …and it refuses to create, by identity.
    const cs = base()
    expect(createFromResult(cs, row, registry), 'a delisted symbol created an instance').toBe(cs)
  })

  it('⛔ the TYPED SENTINEL is an input echo, not a discovery', () => {
    // `SymbolSearch` appends `{ticker, name: null, _typed: true}` so Enter never
    // waits on the network. Adapting it would put a result in the list for every
    // keystroke.
    expect(securityResults([{ ticker: 'QQ', name: null, _typed: true }])).toEqual([])
  })

  it('⛔⛔ a breadth row arriving through TICKER SEARCH is not a second QQQ-shaped row', () => {
    // The search endpoint INJECTS breadth rows into its own results
    // (`ticker_search.py:123-200`). A caller adapting everything as a security
    // would emit UCTA50 twice, from two adapters, with two different categories.
    const injected = { ticker: 'UCTA50', name: '% of Stocks Above 50-Day MA', type: 'breadth',
      exchange: 'UCT', breadth: true, group_label: 'Moving averages' }
    const rows = securityResults([QQQ_ROW, injected], { tf: TF, bars: BARS })
    expect(rows.map((r) => r.kind)).toEqual(['security', 'breadth'])
    expect(rows[1].category).toBe('Moving averages')
    expect(rows[1].create.source).toBe('sym:UCTA50:close')
  })

  it('⭐ capability is read from the CACHE and never fetches', () => {
    // An un-probed symbol is chartable: the only way to know better is to ask, and
    // a dropdown of forty rows must not become forty bars requests.
    expect(knownCapabilityOf('NVDA', TF, BARS).capability).toBe(CAPABILITY.CHARTABLE)
    primeSecondaryBars('NVDA', TF, BARS, { bars: [] })          // answered, empty, no note
    expect(knownCapabilityOf('NVDA', TF, BARS).capability).toBe(CAPABILITY.UNSUPPORTED)
    expect(knownCapabilityOf('NVDA', TF, BARS).capabilityReason)
      .toBe('no history available for this symbol')
  })
})

// ─── §26, §27 · the two creation proofs, structurally identical ─────────────

describe('§26, §27 · QQQ and UCTA50 create through ONE path', () => {
  const created = (row) => {
    const cs = base()
    const next = createFromResult(cs, row, registry)
    expect(next, 'creation was refused').not.toBe(cs)
    return { next, inst: lastCreatedInstance(cs, next) }
  }

  it('⭐⭐ a QQQ result becomes a dataSeries instance pointed at sym:QQQ:close', () => {
    const [row] = securityResults([QQQ_ROW], { tf: TF, bars: BARS })
    const { next, inst } = created(row)
    expect(inst.defId).toBe(DIRECT_SERIES_DEF_ID)
    expect(inst.inputs.source).toBe('sym:QQQ:close')
    expect(parseSource(inst.inputs.source)).toEqual({ kind: 'symbol', symbol: 'QQQ', field: 'close' })
    // …and its home is the DEFINITION's declared one, seeded by nothing here.
    expect(registry.getDefinition(DIRECT_SERIES_DEF_ID).placement.target).toBe('pane')
    expect(ofDef(next, DIRECT_SERIES_DEF_ID)).toHaveLength(1)
  })

  it('⭐⭐ a UCTA50 result takes the IDENTICAL path — only the source differs', () => {
    const [row] = breadthResults([BREADTH_ROW], { tf: TF, bars: BARS })
    const { inst } = created(row)
    expect(inst.defId).toBe(DIRECT_SERIES_DEF_ID)
    expect(inst.inputs.source).toBe('sym:UCTA50:close')
  })

  it('⛔⛔ CREATION IS KIND-BLIND — the two instances differ in ONE string', () => {
    // ⚰️ THE CASE THIS PHASE EXISTS FOR. If a `BreadthSeries` or a `SecuritySeries`
    // ever appears, or a per-family branch creeps into creation, this goes red —
    // and it goes red on the DIFFERENCE, which is the only shape that can catch a
    // second system before it has grown a second renderer.
    const [sec] = securityResults([QQQ_ROW], { tf: TF, bars: BARS })
    const [brd] = breadthResults([BREADTH_ROW], { tf: TF, bars: BARS })
    const a = created(sec).inst
    const b = created(brd).inst
    expect(a.defId).toBe(b.defId)
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    expect(Object.keys(a.inputs).sort()).toEqual(Object.keys(b.inputs).sort())
    const diff = Object.keys(a.inputs).filter((k) => a.inputs[k] !== b.inputs[k])
    expect(diff, 'a breadth instance and a security instance differ by more than their source')
      .toEqual(['source'])
    // …and the ONE difference really is the symbol, not the field or the grammar.
    expect(parseSource(a.inputs.source).field).toBe(parseSource(b.inputs.source).field)
    expect(parseSource(a.inputs.source).symbol).not.toBe(parseSource(b.inputs.source).symbol)
  })

  it('⭐ a TECHNICAL result still creates through the proven definition path', () => {
    // §19 — Add must keep using `addInstance`, with no separate technical
    // semantics. The proof is that the instance is an ORDINARY rsi instance.
    const rsi = technicalResults(registry).find((r) => r.id === 'rsi')
    const { inst } = created(rsi)
    expect(inst.defId).toBe('rsi')
    expect(inst.inputs.period).toBe(registry.getDefinition('rsi').inputs.find((i) => i.key === 'period').default)
  })

  it('⛔ an unknown creation route creates NOTHING — fail closed', () => {
    const cs = base()
    expect(createFromResult(cs, { capability: CAPABILITY.CHARTABLE, create: { via: 'teleport' } }, registry)).toBe(cs)
    expect(createFromResult(cs, { capability: CAPABILITY.CHARTABLE, create: { via: CREATE_VIA.DEFINITION } }, registry)).toBe(cs)
    expect(createFromResult(cs, null, registry)).toBe(cs)
    expect(createDirectSeries(cs, '', registry)).toBe(cs)
  })

  it('⛔ NO TRANSIENT DEFAULT SOURCE — the intermediate blob never escapes', () => {
    // `addInstance` then `setInstanceInput` are two pure transforms over an
    // immutable blob; only the final object is returned. A `dataSeries` instance
    // pointed at `close` must not exist in anything a caller can observe.
    const cs = base()
    const next = createDirectSeries(cs, 'sym:QQQ:close', registry)
    expect(ofDef(next, DIRECT_SERIES_DEF_ID).map((i) => i.inputs.source)).toEqual(['sym:QQQ:close'])
    expect(ofDef(cs, DIRECT_SERIES_DEF_ID), 'the original blob was mutated').toHaveLength(0)
  })
})

// ─── §28, §29 · many series, and duplicates ─────────────────────────────────

describe('§28, §29 · three instruments and two of one', () => {
  const addSym = (cs, row) => createFromResult(cs, securityResults([row], { tf: TF, bars: BARS })[0], registry)

  it('⭐⭐ QQQ + SPY + UCTA50 are three independent instances of ONE definition', () => {
    let cs = base()
    cs = addSym(cs, QQQ_ROW)
    cs = addSym(cs, SPY_ROW)
    cs = createFromResult(cs, breadthResults([BREADTH_ROW], { tf: TF, bars: BARS })[0], registry)

    const made = ofDef(cs, DIRECT_SERIES_DEF_ID)
    expect(made).toHaveLength(3)
    expect(made.map((i) => i.inputs.source))
      .toEqual(['sym:QQQ:close', 'sym:SPY:close', 'sym:UCTA50:close'])
    // ⭐ THREE DISTINCT INSTANCE IDS, which is what makes three panes possible —
    // see the pane case below and `instance-hosted-pane-identity`.
    expect(new Set(made.map((i) => i.instanceId)).size).toBe(3)
    // …and ONE definition underneath all three.
    expect(new Set(made.map((i) => i.defId))).toEqual(new Set([DIRECT_SERIES_DEF_ID]))
  })

  it('⭐⭐ QQQ TWICE is allowed — two instances, one canonical source', () => {
    let cs = base()
    cs = addSym(cs, QQQ_ROW)
    cs = addSym(cs, QQQ_ROW)
    const made = ofDef(cs, DIRECT_SERIES_DEF_ID)
    expect(made, 'the duplicate add was collapsed').toHaveLength(2)
    expect(made[0].instanceId).not.toBe(made[1].instanceId)
    // ⭐ THE SAME CANONICAL SOURCE UNDERNEATH. One string, so one fetch — the
    // dedup is `secondaryBars`' per-URL cache and needs nothing from here.
    expect(made[0].inputs.source).toBe(made[1].inputs.source)
  })

  it('⭐ …and the two copies carry INDEPENDENT visual state', () => {
    let cs = base()
    cs = addSym(cs, QQQ_ROW)
    cs = addSym(cs, QQQ_ROW)
    const [a, b] = ofDef(cs, DIRECT_SERIES_DEF_ID)
    cs = setInstanceHidden(cs, a.instanceId, true, registry)
    cs = setInstanceDisplayTarget(cs, b.instanceId, 'price', registry)
    const [a2, b2] = ofDef(cs, DIRECT_SERIES_DEF_ID)
    expect(a2.hidden).toBe(true)
    expect(b2.hidden).toBe(false)
    expect(b2.placement.target).toBe('price')
    expect(a2.placement?.target ?? 'pane').toBe('pane')
  })
})

// ─── §30 · source ownership ─────────────────────────────────────────────────

describe('§30 · a visual consumer does NOT own its symbol', () => {
  it('⛔⛔ deleting the direct QQQ leaves MA(QQQ) working, with no gravestone', () => {
    // ⭐ THE TWO LIFECYCLES, KEPT APART. An INSTANCE can be deleted and anything
    // reading its output is SEVERED — that is what stops a silent reconnection to
    // a different indicator that happens to reuse the id. A canonical SYMBOL has
    // no such lifecycle: it cannot be deleted, removing the last consumer does not
    // retire it, and a second consumer is unaffected by the first one going.
    let cs = base()
    cs = createDirectSeries(cs, 'sym:QQQ:close', registry)
    const direct = ofDef(cs, DIRECT_SERIES_DEF_ID)[0]

    // …and an MA over the same canonical symbol, added independently.
    cs = createDirectSeries(cs, 'sym:QQQ:close', registry)   // a second consumer, any shape
    const second = ofDef(cs, DIRECT_SERIES_DEF_ID)[1]

    cs = removeInstance(cs, direct.instanceId, registry)

    const survivor = (cs.indicatorInstances || []).find((i) => i.instanceId === second.instanceId)
    expect(survivor, 'the surviving consumer was removed too').toBeTruthy()
    expect(survivor.deleted).not.toBe(true)
    // ⛔ THE SOURCE IS UNTOUCHED — no `!` gravestone, no rewrite.
    expect(survivor.inputs.source, 'the surviving consumer\'s source was severed')
      .toBe('sym:QQQ:close')
    expect(survivor.inputs.source.startsWith('!')).toBe(false)
    expect(parseSource(survivor.inputs.source).kind).toBe('symbol')
  })

  it('⭐ …and re-adding QQQ afterwards resolves normally', () => {
    let cs = base()
    cs = createDirectSeries(cs, 'sym:QQQ:close', registry)
    const only = ofDef(cs, DIRECT_SERIES_DEF_ID)[0]
    cs = removeInstance(cs, only.instanceId, registry)
    expect(ofDef(cs, DIRECT_SERIES_DEF_ID)).toHaveLength(0)

    // Removing the LAST consumer does not retire the symbol: a fresh instance
    // points at the same string and parses to the same canonical source.
    cs = createDirectSeries(cs, 'sym:QQQ:close', registry)
    const again = ofDef(cs, DIRECT_SERIES_DEF_ID)[0]
    expect(again.inputs.source).toBe('sym:QQQ:close')
    // ⚠️ A FRESH ID, NOT THE CORPSE'S — `newInstanceId` counts tombstones.
    expect(again.instanceId).not.toBe(only.instanceId)
  })
})

// ─── §31 · management through the existing writers ──────────────────────────

describe('§31 · the existing management writers already handle it', () => {
  const withQQQ = () => {
    const cs = createDirectSeries(base(), 'sym:QQQ:close', registry)
    return { cs, id: ofDef(cs, DIRECT_SERIES_DEF_ID)[0].instanceId }
  }

  it('⭐ hide / show, source, display target and delete all work unchanged', () => {
    let { cs, id } = withQQQ()

    cs = setInstanceHidden(cs, id, true, registry)
    expect((cs.indicatorInstances.find((i) => i.instanceId === id)).hidden).toBe(true)

    cs = setInstanceInput(cs, id, 'source', 'sym:SPY:close', registry)
    expect(cs.indicatorInstances.find((i) => i.instanceId === id).inputs.source).toBe('sym:SPY:close')

    cs = setInstanceDisplayTarget(cs, id, 'price', registry)
    expect(cs.indicatorInstances.find((i) => i.instanceId === id).placement.target).toBe('price')

    cs = removeInstance(cs, id, registry)
    expect(ofDef(cs, DIRECT_SERIES_DEF_ID)).toHaveLength(0)
  })

  it('⭐ it declares the inputs a generated settings row needs, and no more', () => {
    // ⛔ NOT A SECOND SETTINGS UI (§31). `ChartSettingsIndicators` builds its rows
    // from `def.inputs`, so a definition whose inputs are declarable is manageable
    // by construction. Asserting the SHAPE is what proves that without rendering.
    const def = registry.getDefinition(DIRECT_SERIES_DEF_ID)
    expect(def.inputs.map((i) => `${i.key}:${i.type}`)).toEqual(['source:source', 'color:color'])
    expect(def.plots).toHaveLength(1)
    expect(def.plots[0].style).toBe('line')
  })
})

// ─── §32, §33, §34 · what the member is shown ───────────────────────────────

describe('§32, §33 · a direct series is not called "Series"', () => {
  const labelOf = (source) => {
    const cs = createDirectSeries(base(), source, registry)
    const inst = ofDef(cs, DIRECT_SERIES_DEF_ID)[0]
    return instanceLabel(registry.getDefinition(DIRECT_SERIES_DEF_ID), inst)
  }

  it('⭐⭐ QQQ reads QQQ, and UCTA50 reads UCTA50', () => {
    expect(labelOf('sym:QQQ:close')).toBe('QQQ')
    expect(labelOf('sym:UCTA50:close')).toBe('UCTA50')
  })

  it('⛔ the DEFINITION stays generic — the label never mutates it', () => {
    const before = JSON.stringify(registry.getDefinition(DIRECT_SERIES_DEF_ID))
    labelOf('sym:QQQ:close')
    labelOf('sym:SPY:close')
    expect(JSON.stringify(registry.getDefinition(DIRECT_SERIES_DEF_ID)),
      'naming an instance edited the shared definition').toBe(before)
    // …and the definition's own name is still the generic one.
    expect(registry.getDefinition(DIRECT_SERIES_DEF_ID).meta.shortName).toBe('Series')
  })

  it('⛔⛔ IDENTITY IS UNTOUCHED — the label is never encoded into the source', () => {
    const cs = createDirectSeries(base(), 'sym:UCTA50:close', registry)
    const inst = ofDef(cs, DIRECT_SERIES_DEF_ID)[0]
    expect(inst.inputs.source).toBe('sym:UCTA50:close')
    expect(instanceLabel(registry.getDefinition(DIRECT_SERIES_DEF_ID), inst)).toBe('UCTA50')
    // A label baked into the source would make two display names two sources.
    expect(inst.inputs.source).not.toContain('%')
    expect(parseSource(inst.inputs.source).symbol).toBe('UCTA50')
  })

  it('⭐ an ordinary definition is unaffected — RSI still reads RSI (14)', () => {
    const rsiDef = registry.getDefinition('rsi')
    expect(instanceLabel(rsiDef, { defId: 'rsi', inputs: { period: 14 } })).toBe('RSI (14)')
    expect(instanceLabel(rsiDef, { defId: 'rsi', inputs: { period: 7 } })).toBe('RSI (7)')
    // …and `movingAverage`, which also takes a source but names itself.
    //
    // ⭐⭐ UPDATED 2026-09-16 — IT NAMES ITSELF `SMA 5`, NOT `MA (5)`. The
    // definition now declares `meta.nameFrom` (`engine/semanticName.js`), so its
    // stem is the member's own `maType` choice read back from the enum's option
    // LABEL. The assertion this replaces was asserting that `movingAverage` took
    // the GENERIC path — which was true and is exactly what the owner reported as
    // "two different kinds of Moving Average", because `cs.overlays`' rows have
    // always read `EMA 9` / `SMA 200`.
    expect(instanceLabel(registry.getDefinition('movingAverage'),
      { defId: 'movingAverage', inputs: { source: 'sym:QQQ:close', period: 5 } }))
      .toBe('SMA 5')
    expect(instanceLabel(registry.getDefinition('movingAverage'),
      { defId: 'movingAverage', inputs: { maType: 'ema', period: 9 } }))
      .toBe('EMA 9')
  })

  it('⛔ no member-facing surface calls a QQQ series "Series"', () => {
    // §15, and the reason `meta.shortName` and the PLOT label are different
    // fields. The picker groups by instance and then names the output: `RSI (14)
    // → RSI`, and this one used to read `QQQ → Series` — the internal word, in
    // the one place a member chooses what an indicator reads.
    const def = registry.getDefinition(DIRECT_SERIES_DEF_ID)
    expect(def.plots.map((p) => p.label)).toEqual(['Value'])
    // ⚠️ …while the generic STEM is untouched, because a series over an instance
    // source genuinely has no instrument to be named after — the case below.
    expect(def.meta.shortName).toBe('Series')
  })

  it('⭐ a dataSeries over an INSTANCE source falls back to the generic stem', () => {
    // `@inst:rsi:1::rsi` has no name of its own here; guessing the host's label
    // would be a second naming rule. The ordinary stem applies.
    expect(labelOf('@inst:rsi:1::rsi')).toBe('Series')
  })

  it('⭐ P2.2 — a stored display name ROUND-TRIPS and is what the label reads', () => {
    // ⚰️ THIS CASE SAID THE OPPOSITE AT P2.1, and the change is the phase. Then,
    // nothing consumed `instance.display`, so the rail proved only that the shape
    // tolerated it — `validateInstance` returns the instance unchanged and
    // whitelists no fields, so adding one would cost no migration. P2.2 made it
    // live: `Add to Chart` stamps the catalogue's name and both naming surfaces
    // prefer it. The round-trip claim is unchanged and the label claim inverted.
    const cs = createDirectSeries(base(), 'sym:QQQ:close', registry)
    const id = ofDef(cs, DIRECT_SERIES_DEF_ID)[0].instanceId
    const withDisplay = {
      ...cs,
      indicatorInstances: cs.indicatorInstances.map((i) => (
        i.instanceId === id ? { ...i, display: { name: 'Invesco QQQ Trust' } } : i
      )),
    }
    const round = mergeChartSettings(JSON.stringify(withDisplay))
    const back = (round.indicatorInstances || []).find((i) => i.instanceId === id)
    expect(back, 'the instance did not survive the round trip').toBeTruthy()
    expect(back.display, 'an extra display field was stripped — P2.2 would need a migration')
      .toEqual({ name: 'Invesco QQQ Trust' })
    // …and it changed nothing else: the source and the derived label are intact.
    expect(back.inputs.source).toBe('sym:QQQ:close')
    // ⭐ AND THE STORED NAME IS WHAT THE LABEL READS NOW — identity untouched.
    expect(instanceLabel(registry.getDefinition(DIRECT_SERIES_DEF_ID), back))
      .toBe('Invesco QQQ Trust')
    // ⛔ THE FALLBACK SURVIVES: an instance with no `display` still names itself
    // from its source, so nothing created by another door loses its name.
    const bare = { ...back }
    delete bare.display
    expect(instanceLabel(registry.getDefinition(DIRECT_SERIES_DEF_ID), bare)).toBe('QQQ')
  })
})

// ─── §32 · BOTH naming surfaces, because there are two ─────────────────────

describe('§32 · the LEGEND names the symbol too, not just the source picker', () => {
  const chipFor = (source) => {
    const cs = createDirectSeries(base(), source, registry)
    const inst = ofDef(cs, DIRECT_SERIES_DEF_ID)[0]
    const chips = engineChips(
      [{ defId: DIRECT_SERIES_DEF_ID, plotKey: 'value', instanceId: inst.instanceId,
        series: {}, lastValue: 714.88 }],
      new Map(), registry, [inst],
    )
    return chips[0]
  }

  it('⭐⭐ a QQQ series prints QQQ in the legend, not "Series"', () => {
    // ⚰️ MEASURED IN A BROWSER FIRST: fixing `sourceRef.instanceLabel` alone left
    // the pane legend reading "Series 714.88" over a QQQ line, because the chip
    // strip and the source picker are two different naming functions. Both read
    // `meta.labelFrom`, which is why they agree.
    expect(chipFor('sym:QQQ:close').label).toBe('QQQ')
    expect(chipFor('sym:UCTA50:close').label).toBe('UCTA50')
  })

  it('⛔ three symbols would have printed ONE name — that is what this prevents', () => {
    const labels = ['sym:QQQ:close', 'sym:SPY:close', 'sym:UCTA50:close'].map((s) => chipFor(s).label)
    expect(new Set(labels).size, 'three panes printed the same chip').toBe(3)
    expect(labels).toEqual(['QQQ', 'SPY', 'UCTA50'])
  })

  it('⭐ and the two naming surfaces AGREE, by reading one declaration', () => {
    const cs = createDirectSeries(base(), 'sym:SPY:close', registry)
    const inst = ofDef(cs, DIRECT_SERIES_DEF_ID)[0]
    const def = registry.getDefinition(DIRECT_SERIES_DEF_ID)
    expect(instanceLabel(def, inst)).toBe(chipFor('sym:SPY:close').label)
  })

  it('⛔⛔ the SOURCE ADDRESS never leaks into a chip as a discriminator', () => {
    // ⚰️ MEASURED IN A BROWSER. With QQQ, SPY, UCTA50 and a SECOND QQQ on screen
    // the labels collide (two QQQs), so the sibling suffixer correctly runs — and
    // the only input that differs across the group is `source`, so every chip read
    // `QQQ (source sym:QQQ:close)`, `SPY (source sym:SPY:close)` … printing the
    // ADDRESS beside the name derived from it, on rows that were never ambiguous.
    let cs = base()
    for (const src of ['sym:QQQ:close', 'sym:SPY:close', 'sym:UCTA50:close', 'sym:QQQ:close']) {
      cs = createDirectSeries(cs, src, registry)
    }
    const insts = ofDef(cs, DIRECT_SERIES_DEF_ID)
    expect(insts).toHaveLength(4)
    const chips = engineChips(
      insts.map((i) => ({
        defId: DIRECT_SERIES_DEF_ID, plotKey: 'value', instanceId: i.instanceId,
        series: {}, lastValue: 1,
      })),
      new Map(), registry, insts,
    )
    for (const c of chips) {
      expect(c.label, 'the raw source string reached a legend chip').not.toContain('sym:')
      expect(c.label, 'the input KEY reached a legend chip').not.toContain('source')
    }
    // ⭐ AND THE FALLBACK IS THE ORDINAL — thin, but true.
    //
    // ⚰️ THIS LINE USED TO READ `['QQQ #1', 'SPY #2', 'UCTA50 #3', 'QQQ #4']`, and
    // said so as "the approved shape for the duplicate-label polish item rather
    // than a redesign of it". That item was RULED ON 2026-09-12: an ordinal
    // belongs to the collision, not to the definition. Only the two QQQs are
    // ambiguous, so only they are numbered — `SPY #2` implied a `SPY #1` that was
    // never on the chart.
    //
    // ⛔ THE RAIL ITSELF IS UNCHANGED. What this case exists to prevent is the
    // SOURCE ADDRESS reaching a chip, and those two assertions above are
    // untouched and still the point; this line is the shape of the fallback, and
    // the fallback's shape is what the ruling moved.
    expect(chips.map((c) => c.label)).toEqual(['QQQ #1', 'SPY', 'UCTA50', 'QQQ #2'])
  })

  it('⭐ …and with NO duplicate the labels are left completely alone', () => {
    let cs = base()
    for (const src of ['sym:QQQ:close', 'sym:SPY:close', 'sym:UCTA50:close']) {
      cs = createDirectSeries(cs, src, registry)
    }
    const insts = ofDef(cs, DIRECT_SERIES_DEF_ID)
    const chips = engineChips(
      insts.map((i) => ({
        defId: DIRECT_SERIES_DEF_ID, plotKey: 'value', instanceId: i.instanceId,
        series: {}, lastValue: 1,
      })),
      new Map(), registry, insts,
    )
    expect(chips.map((c) => c.label)).toEqual(['QQQ', 'SPY', 'UCTA50'])
  })

  it('⭐ an ordinary definition\'s chip is untouched', () => {
    const chips = engineChips(
      [{ defId: 'rsi', plotKey: 'rsi', instanceId: 'legacy:rsi', series: {}, lastValue: 57.2 }],
      new Map(), registry, [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 } }],
    )
    expect(chips[0].label).toBe('RSI(14)')
  })
})
