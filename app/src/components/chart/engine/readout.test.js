import { describe, it, expect } from 'vitest'
import { engineChips, chipsFrom, legendChips } from './readout'
import * as engineRegistry from './nativeRegistry'
// ⛔ DERIVED FROM THE SHIPPED ARTIFACT, NEVER HAND-TYPED — and shared with
// `__tests__/legendFromDefinitions.test.jsx`, which gates the same nine chips
// through the DOM. See that module's header for why a second copy would have
// been the twin this phase retires.
import { shippedLegendChips } from './__tests__/legendProbe'

/** A binding as `binder.bindings()` returns it, with a stand-in series object. */
const binding = (defId, plotKey, instanceId = `legacy:${defId}`) => ({
  key: `${instanceId}::${plotKey}`, instanceId, defId, plotKey, series: { __id: `${defId}/${plotKey}` },
})

const seriesData = (pairs) => new Map(pairs.map(([b, v]) => [b.series, { value: v }]))

describe('engineChips — the legend an engine-drawn indicator must still produce', () => {
  const RSI_INST = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' } }

  it('reproduces the LEGACY RSI chip byte for byte', () => {
    // The shipped legend at `d2733adc` — `RSI(${period}) ${value.toFixed(1)}` in
    // the indicator's colour. A migrated RSI that reads "RSI 54.32" is a
    // regression the pixel gate cannot see.
    const b = binding('rsi', 'rsi')
    const chips = engineChips([b], seriesData([[b, 54.321]]), engineRegistry, [RSI_INST])
    expect(chips).toHaveLength(1)
    expect(chips[0].text).toBe('RSI(14) 54.3')
    expect(chips[0].color).toBe('#7b68ee')
    expect(chips[0].defId).toBe('rsi')
    expect(chips[0].plotKey).toBe('rsi')
  })

  it('takes the colour from the INSTANCE, not the definition default', () => {
    const b = binding('rsi', 'rsi')
    const chips = engineChips([b], seriesData([[b, 50]]), engineRegistry,
      [{ ...RSI_INST, inputs: { period: 7, color: '#ff0000' } }])
    expect(chips[0].text).toBe('RSI(7) 50.0')
    expect(chips[0].color).toBe('#ff0000')
  })

  it('falls back to the DEFINITION default when the instance sets nothing', () => {
    // "unset means current default" — the same rule the migrator preserves. An
    // instance whose inputs are `{}` must still read `RSI(14)` in `#7b68ee`,
    // because that is what the chart draws.
    const b = binding('rsi', 'rsi')
    const chips = engineChips([b], seriesData([[b, 61.25]]), engineRegistry,
      [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: {} }])
    expect(chips[0].text).toBe('RSI(14) 61.3')
    expect(chips[0].color).toBe('#7b68ee')
  })

  it('reproduces MACD\'s two chips and DROPS the histogram, as legacy does', () => {
    const inst = { instanceId: 'legacy:macd', defId: 'macd', inputs: {} }
    const bm = binding('macd', 'macd'); const bs = binding('macd', 'signal'); const bh = binding('macd', 'histogram')
    const chips = engineChips([bm, bs, bh], seriesData([[bm, 0.12345], [bs, 0.09876], [bh, 0.02469]]),
      engineRegistry, [inst])
    expect(chips.map(c => c.text)).toEqual(['MACD 0.1235', 'SIG 0.0988'])
    expect(chips.map(c => c.plotKey)).toEqual(['macd', 'signal'])
  })

  it('emits ONE chip for a price overlay — the BASIS, and never the edges', () => {
    // 🔴 THIS READ *"emits NO chip for a price overlay the legacy legend never
    // showed"*, and the comment under it read *"BB and VWAP have no legend chip
    // today. A migration that ADDS one is just as much a regression as one that
    // removes it."* It was an accurate description of the shipped chart and a
    // wrong description of what the chart owed a user: BB and VWAP drew lines
    // with NO LABEL AT ANY TIME, hovering or not. Task 2 (`43efeff6`) gave both a
    // chip, so this case is INVERTED — the exact text asserted, not loosened to
    // "at least one chip".
    //
    // ⛔ AND THE LENGTH IS HALF THE ASSERTION, WHICH IS WHY IT IS `toEqual` ON
    // THE WHOLE ARRAY. All three BB bands are hovered WITH a value here, so a
    // `legend` block landing on `upper` or `lower` makes this THREE chips and
    // fails — the same thing the old `toEqual([])` caught, still caught.
    const bbInst = { instanceId: 'legacy:bb', defId: 'bb', inputs: {} }
    const bs = ['upper', 'middle', 'lower'].map(k => binding('bb', k))
    const bbChips = engineChips(bs, seriesData(bs.map(b => [b, 100])), engineRegistry, [bbInst])
    expect(bbChips.map(c => c.text), 'the BASIS chip, and only the basis')
      .toEqual(['BB(20, 2) 100.00'])
    expect(bbChips.map(c => c.plotKey)).toEqual(['middle'])

    const vwapInst = { instanceId: 'legacy:vwap', defId: 'vwap', inputs: {} }
    const bv = binding('vwap', 'vwap')
    // NO brackets, and that is a reading of the inputs rather than an omission:
    // VWAP declares colour, opacity, line style and line width, and not one of
    // them changes WHAT IS MEASURED — so it carries no `legendParams`.
    expect(engineChips([bv], seriesData([[bv, 100]]), engineRegistry, [vwapInst]).map(c => c.text))
      .toEqual(['VWAP 100.00'])
  })

  it('emits NO chip for a PLOT that declares no legend at all', () => {
    // ⚠️ THE SUBJECT HAS MOVED TWICE, AND EACH MOVE IS THE CONTROL FIRING. It
    // used to use `atr`, whose chip was hand-written in `legChips` while its
    // definition declared nothing; B4 Task 10 gave `atr` a real `legend` block
    // and this case went RED, so it was re-pointed at `mfi` — "one of the
    // definitions that genuinely has no chip anywhere".
    //
    // 🔴 TASK 2 (`43efeff6`) RETIRED THAT WHOLE CATEGORY: every definition that
    // binds a data plot now declares at least one chip, so there is no
    // chip-less DEFINITION left to point at — that is the totality rail in
    // `__tests__/legendFromDefinitions.test.jsx`, and this case cannot outlive
    // it in its old form. What the case was ever really about survives one level
    // down: a PLOT with no `legend` block emits nothing.
    //
    // ⭐ RE-POINTED AT `adx`, WHICH CARRIES BOTH HALVES IN ONE INSTANCE. `adx`
    // declares a chip; `plusDI` and `minusDI` deliberately declare none, because
    // the ADX line is the one a trader reads a number off and three numbers for
    // one indicator is the readout regression the band edges are hidden for. So
    // the assertion is non-vacuous BY CONSTRUCTION — a `chipsFrom` that had
    // simply stopped emitting would fail on the same line it passes the absence.
    const inst = { instanceId: 'legacy:adx', defId: 'adx', inputs: {} }
    const primary = binding('adx', 'adx')
    const plus = binding('adx', 'plusDI')
    const minus = binding('adx', 'minusDI')
    const chips = engineChips([primary, plus, minus],
      seriesData([[primary, 27.5], [plus, 30.25], [minus, 12.75]]), engineRegistry, [inst])
    expect(chips.map(c => c.text), 'the directional lines gained a chip').toEqual(['ADX(14) 27.5'])
    expect(chips.map(c => c.plotKey)).toEqual(['adx'])
  })

  it('…and ATR, which DID gain one, now emits it — the other half of that move', () => {
    // The non-vacuity control for the case above: if `chipsFrom` had simply
    // stopped emitting chips, an absence assertion would pass for the wrong
    // reason. (Since Task 2 the `adx` case above carries its own control too.)
    const inst = { instanceId: 'legacy:atr', defId: 'atr', inputs: {} }
    const b = binding('atr', 'atr')
    const chips = engineChips([b], seriesData([[b, 2.7]]), engineRegistry, [inst])
    expect(chips.map(c => c.text)).toEqual(['ATR(14) 2.7000'])
  })

  it('a bar the series has no value on produces no chip, never NaN', () => {
    // …when the binding carries no `lastValue` either. The developing-bar
    // fallback is the case below; this is the "nothing computed at all" case.
    const b = binding('rsi', 'rsi')
    expect(engineChips([b], new Map(), engineRegistry, [RSI_INST])).toEqual([])
    expect(engineChips([b], seriesData([[b, undefined]]), engineRegistry, [RSI_INST])).toEqual([])
    expect(engineChips([b], seriesData([[b, NaN]]), engineRegistry, [RSI_INST])).toEqual([])
  })

  it('falls back to the binding\'s LAST value on a developing bar, as legacy does', () => {
    // `StockChart.jsx:7829` — `d?.value ?? indicatorData.rsi.at(-1)?.value`. The
    // bars push feed's writer B appends a developing candle with `series.update()`
    // and no `updateChart` pass, so on an intraday chart the newest bar exists on
    // the candles and NOT on the indicator until the next SWR refresh. Legacy
    // printed the last computed value; an engine chip that printed nothing there
    // is a live-tape-only regression the pixel gate cannot see.
    const b = { ...binding('rsi', 'rsi'), lastValue: 71.24 }
    const chips = engineChips([b], new Map(), engineRegistry, [RSI_INST])
    expect(chips).toHaveLength(1)
    expect(chips[0].text).toBe('RSI(14) 71.2')
    expect(chips[0].value).toBeCloseTo(71.24, 6)
  })

  it('the hovered bar WINS over the fallback whenever it has a value', () => {
    const b = { ...binding('rsi', 'rsi'), lastValue: 71.24 }
    expect(engineChips([b], seriesData([[b, 54.321]]), engineRegistry, [RSI_INST])[0].text)
      .toBe('RSI(14) 54.3')
  })

  it('a column that ENDS on whitespace has no fallback — no chip, not NaN', () => {
    // `.at(-1)?.value` on an LWC whitespace point is `undefined`, and `?? null`
    // makes legacy drop the chip. `lastValue: undefined` is that same answer.
    const b = { ...binding('rsi', 'rsi'), lastValue: undefined }
    expect(engineChips([b], new Map(), engineRegistry, [RSI_INST])).toEqual([])
  })

  it('never throws on the shapes a caller can actually hand it', () => {
    // It runs inside `processCrosshair`, on the rAF flush. A throw there takes
    // the whole legend down mid-hover, so every argument is optional-shaped.
    expect(engineChips(null, null, null, null)).toEqual([])
    expect(engineChips([binding('rsi', 'rsi')], undefined, engineRegistry, undefined)).toEqual([])
    expect(engineChips([null, undefined, {}], new Map(), engineRegistry, [])).toEqual([])
  })

  it('a SECOND instance of one definition gets its OWN label and colour', () => {
    // ⛔ THE DEFECT `inputsFor` EXISTS TO PREVENT. Resolving inputs per
    // DEFINITION — `cs.indicators[defId]`, which is what the shipped legend did
    // and what the LEGACY lane still correctly does — collapses two RSI lines at
    // different periods into two chips printing the same number. The engine lane
    // resolves per INSTANCE, and this is the only shape that can tell them apart.
    const a = binding('rsi', 'rsi', 'engine:rsi-a')
    const b = binding('rsi', 'rsi', 'engine:rsi-b')
    const chips = engineChips([a, b], seriesData([[a, 54.321], [b, 61.25]]), engineRegistry, [
      { instanceId: 'engine:rsi-a', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' } },
      { instanceId: 'engine:rsi-b', defId: 'rsi', inputs: { period: 7, color: '#ff0000' } },
    ])
    expect(chips.map(c => c.text)).toEqual(['RSI(14) 54.3', 'RSI(7) 61.3'])
    expect(chips.map(c => c.color)).toEqual(['#7b68ee', '#ff0000'])
  })
})

describe('chipsFrom — the ONE formatting pipeline, fed by either lane', () => {
  /** A LEGACY-lane entry: no instance, a thunk for the developing-bar fallback. */
  const entry = (defId, plotKey, lastValue) => ({
    defId, plotKey, series: { __id: `${defId}/${plotKey}` }, lastValue,
  })
  /** The legacy lane's `inputsFor`: the settings section, per DEFINITION. */
  const fromLegacySection = (cs) => (defId) => cs[defId]

  it('formats a legacy-lane chip from the definition, with no instance anywhere', () => {
    const e = entry('stoch', 'k')
    const chips = chipsFrom([e], seriesData([[e, 82.47]]), engineRegistry,
      fromLegacySection({ stoch: { kColor: '#FF6B6B', dColor: '#4ECDC4' } }))
    expect(chips.map(c => c.text)).toEqual(['%K 82.5'])
    expect(chips[0].color).toBe('#FF6B6B')
    expect(chips[0].instanceId).toBe(null)
  })

  it('a plot with no legend block emits nothing — the cloud and every guide', () => {
    // Ichimoku declares chips on `tenkan` and `kijun` ONLY. `spanA`, `spanB` and
    // `chikou` are drawn and must stay chip-less, exactly as they ship — and so
    // must every `hlines` guide, which has no series at all.
    const es = ['spanA', 'spanB', 'chikou'].map(k => entry('ichimoku', k))
    expect(chipsFrom(es, seriesData(es.map(e => [e, 100])), engineRegistry, () => ({}))).toEqual([])

    // …and the guides, from every definition that declares one. A loop that saw
    // nothing would pass vacuously, so the count is asserted.
    const guides = []
    for (const def of engineRegistry.listDefinitions()) {
      for (const p of def.plots) if (p.style === 'hlines') guides.push(entry(def.id, p.key))
    }
    expect(guides.length, 'no hlines guide in the registry — this half is vacuous').toBeGreaterThan(5)
    expect(chipsFrom(guides, seriesData(guides.map(e => [e, 50])), engineRegistry, () => ({}))).toEqual([])
  })

  it('the fallback accepts a THUNK, which is how the legacy lane stays live', () => {
    // The legacy entry is registered when the series is created; the last
    // computed value moves under it on every SWR refresh. A captured NUMBER
    // would freeze at whatever it was when the indicator was switched on.
    let last = 2.5
    const e = entry('atr', 'atr', () => last)
    expect(chipsFrom([e], new Map(), engineRegistry, () => ({}))[0].text).toBe('ATR(14) 2.5000')
    last = 3.75
    expect(chipsFrom([e], new Map(), engineRegistry, () => ({}))[0].text).toBe('ATR(14) 3.7500')
    // …and the hovered bar still WINS over it.
    expect(chipsFrom([e], seriesData([[e, 1.125]]), engineRegistry, () => ({}))[0].text)
      .toBe('ATR(14) 1.1250')
  })

  it('a thunk that THROWS is "no fallback", never a legend that disappears', () => {
    // It runs on the rAF flush. A throw here used to be impossible because the
    // fallback was a plain property read; a thunk makes it possible, so it is
    // caught — and the chip is dropped exactly as an undefined fallback is.
    const e = entry('atr', 'atr', () => { throw new Error('indicatorData moved') })
    expect(chipsFrom([e], new Map(), engineRegistry, () => ({}))).toEqual([])
    // …and the same throwing entry does not stop the chip BESIDE it rendering.
    const ok = entry('sar', 'sar', () => 12.5)
    expect(chipsFrom([e, ok], new Map(), engineRegistry, () => ({})).map(c => c.text))
      .toEqual(['SAR 12.5000'])
  })

  it('never throws on the shapes a caller can actually hand it', () => {
    expect(chipsFrom(null, null, null, null)).toEqual([])
    expect(chipsFrom([entry('rsi', 'rsi')], undefined, engineRegistry, undefined)).toEqual([])
    expect(chipsFrom([null, undefined, {}], new Map(), engineRegistry, () => ({}))).toEqual([])
  })
})

describe('the chip declarations cannot silently lose — or gain — a chip', () => {
  /**
   * ⛔ AN EXPLICIT LIST, AND IT IS THE TRADE TASK 14 NAMED AND TASK 13 TOOK.
   *
   * Task 14 wrote: *"`avwap` declares `legend: { hide: true }` rather than a
   * chip, and that is a trade I made rather than a preference… A tenth chip
   * forces that list to grow, and a list that has learnt to grow no longer
   * catches the next migration that DROPS one."* `rsLine` is that tenth chip: it
   * takes its OWN PANE, and a pane whose crosshair prints nothing is an
   * indicator you cannot read a value off — a strictly worse product than a
   * frozen count.
   *
   * The list-that-grows objection is answered by EXCLUDING it by name rather
   * than loosening the comparison. The nine remain an equality against the
   * shipped artifact; a tenth that is not written down here is still a failure,
   * and a DROP among the nine still fails. What is given up is only the claim
   * "no definition anywhere declares a chip the 2026 legend did not", which was
   * never the thing being protected.
   *
   * ⭐⭐ TASK 2 (`43efeff6`) ADDED THE OTHER TEN, THROUGH THIS SAME DOOR AND FOR
   * THE REASON IT WAS BUILT. `bb`, `vwap`, `mfi`, `cci`, `williamsR`, `adx`,
   * `obv`, `donchian`, `avwap` and `atrBands` declared NO chip at all — a line
   * with no label at any time, hovering or not — and the block in
   * `nativeRegistry.js` that hid `avwap`'s chip said so out loud: it hid it *so
   * that this list would not have to grow*. That trade inverted the moment it
   * applied to ten definitions rather than one. The record was protecting users
   * from a chip that silently DISAPPEARS; what it was holding in place was ten
   * indicators that never had one.
   *
   * ⛔ THIS IS A DECLARED DIFFERENCE, NOT A TOLERANCE, AND THE THREE ASSERTIONS
   * BELOW ARE WHAT MAKE THAT TRUE:
   *   1. `declaredThatShipped()` is still an EQUALITY against the parsed shipped
   *      artifact — a chip DROPPED from any of the nine still fails, and a chip
   *      ADDED anywhere without a line here still fails.
   *   2. every name here must be a chip that IS declared, so removing `legend`
   *      from (say) `bb::middle` fails on *"names bb::middle, which declares no
   *      chip"* — the positive control for all eleven exclusions.
   *   3. every name here must NOT be in the shipped legend, so this list can
   *      never be used to excuse a regression among the nine.
   * The TEXT and PRECISION of these ten are asserted per-id in
   * `__tests__/legendFromDefinitions.test.jsx`'s decided table; this list is the
   * membership half only.
   */
  const NOT_IN_THE_SHIPPED_LEGEND = [
    'rsLine::rsLine',
    // ── the ten Task 2 gave a chip to, in the order the registry declares them ──
    'bb::middle', 'vwap::vwap', 'mfi::mfi', 'cci::cci', 'williamsR::williams_r',
    'adx::adx', 'obv::obv', 'donchian::middle', 'avwap::avwap', 'atrBands::middle',
  ]

  /** Every plot in the registry that declares a VISIBLE chip. */
  const declared = () => {
    const out = []
    for (const def of engineRegistry.listDefinitions()) {
      for (const plot of def.plots) {
        if (plot.style === 'hlines') continue
        if (!plot.legend || plot.legend.hide === true) continue
        out.push(`${def.id}::${plot.key}`)
      }
    }
    return out.sort()
  }

  /** …minus the chips that postdate the shipped legend. */
  const declaredThatShipped = () => declared().filter(k => !NOT_IN_THE_SHIPPED_LEGEND.includes(k))

  it('the NINE chips the shipped legend rendered are exactly the nine that shipped', () => {
    // ⭐ THE RAIL THAT REPLACED THE SLOT BRIDGE, and it is derived from the
    // SHIPPED SOURCE, not hand-typed. `LEGACY_SLOTS` used to police this: nine
    // hand-written `'<defId>::<plotKey>' → '<crosshairData field>'` rows, and
    // `readout.test.js` checked each side named something real. Task 10 deleted
    // both the bridge and the fields it named, so the question changed with the
    // answer: not "does every declared chip have a slot" but "are the declared
    // chips EXACTLY the nine the legend used to print".
    //
    // ⚠️ AND IT MUST NOT BE A HAND-COPY. An earlier version of the rail below it
    // compared `LEGACY_SLOTS` against a hand-written `RENDERED_FIELDS` Set —
    // one hand-written map policed by a second hand-written list, which cannot
    // fail: deleting the ATR row from the legend left all 956 chart tests green.
    // `shippedLegendChips()` parses the real pre-B4 `legChips` array out of
    // `git show`, so the expectation IS the artifact.
    const shipped = shippedLegendChips()
    expect(Object.keys(shipped).sort(), 'the declared chips and the SHIPPED nine disagree')
      .toEqual(declaredThatShipped())
    expect(declaredThatShipped().length, 'the shipped legend printed nine indicator chips').toBe(9)
    // …and every excluded key is a chip that REALLY IS DECLARED, so the list
    // cannot quietly hold a typo or a chip somebody deleted.
    for (const key of NOT_IN_THE_SHIPPED_LEGEND) {
      expect(declared(), `NOT_IN_THE_SHIPPED_LEGEND names ${key}, which declares no chip`).toContain(key)
      expect(shipped[key], `${key} IS in the shipped legend — it cannot be excluded`).toBeUndefined()
    }
  })

  it('every declared chip formats exactly as its shipped row did', () => {
    // Per chip: the LABEL and the PRECISION, both read off the pre-B4 source.
    const shipped = shippedLegendChips()
    const V = 12.3456789
    const got = {}
    const want = {}
    for (const [key, row] of Object.entries(shipped)) {
      const [defId, plotKey] = key.split('::')
      const e = { defId, plotKey, series: { __id: key } }
      const chips = chipsFrom([e], seriesData([[e, V]]), engineRegistry, () => ({}))
      got[key] = chips.length === 1 ? chips[0].text : `<${chips.length} chips>`
      want[key] = `${row.label} ${V.toFixed(row.decimals)}`
    }
    expect(got, 'a chip no longer prints what the shipped legend printed').toEqual(want)
  })

  it('and the colour a chip wears is the one its shipped row wore', () => {
    const shipped = shippedLegendChips()
    const got = {}
    const want = {}
    for (const [key, row] of Object.entries(shipped)) {
      const [defId, plotKey] = key.split('::')
      const e = { defId, plotKey, series: { __id: key } }
      // No inputs at all ⇒ the DEFINITION's declared default, which is what the
      // shipped row's `|| '#xxxxxx'` fallback printed for an untouched blob.
      got[key] = chipsFrom([e], seriesData([[e, 1]]), engineRegistry, () => ({}))[0].color
      want[key] = row.color
    }
    expect(got, 'a chip changed colour — the definition default and the shipped fallback disagree')
      .toEqual(want)
  })

  it('`stoch` declares no legendParams and `atr` does — asserted, not assumed', () => {
    // `legend.label` short-circuits `legendParams` in `chipLabel`, so a
    // `legendParams` on `stoch` would be INERT and could sit there being wrong.
    // ATR's is load-bearing: without it the chip reads `ATR` instead of `ATR(14)`.
    expect(engineRegistry.getDefinition('stoch').meta.legendParams).toBeUndefined()
    expect(engineRegistry.getDefinition('atr').meta.legendParams).toEqual(['period'])
    expect(engineRegistry.getDefinition('sar').meta.legendParams).toBeUndefined()
    expect(engineRegistry.getDefinition('ichimoku').meta.legendParams).toBeUndefined()
  })
})

// ─── TASK 3 — `legendChips`: A CHIP FOR EVERY LIVE INSTANCE ─────────────────
//
// ⛔ `engineChips` WALKS BINDINGS AND THAT IS WHY IT CANNOT BE THE LEGEND'S
// SOURCE. `pool.planBindings` drops a hidden instance so the binder can release
// the series and give the pane back — right for the RENDERER, wrong for the
// READOUT: the chip is the only surface an un-hide can be reached from, so a
// hidden instance with no chip makes "Hide" a one-way door.
describe('legendChips — a chip for every LIVE instance, hidden ones included', () => {
  const INSTANCES = [
    { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: true },
  ]
  const fakeSeries = { __id: 'rsi/rsi' }
  const BINDINGS = [
    { defId: 'rsi', plotKey: 'rsi', instanceId: 'legacy:rsi', series: fakeSeries, lastValue: 54.321 },
  ]

  it('a BOUND instance prints its value off-cursor, from lastValue', () => {
    const chips = legendChips(BINDINGS, null, engineRegistry, INSTANCES)
    const bound = chips.find(c => c.instanceId === 'legacy:rsi')
    expect(bound.hidden).toBe(false)
    expect(bound.value).toBeCloseTo(54.321, 5)
    expect(bound.text).toBe('RSI(14) 54.3')
  })

  it('⭐ a HIDDEN instance still gets a chip — a chip you cannot see is one you cannot un-hide from', () => {
    const chips = legendChips(BINDINGS, null, engineRegistry, INSTANCES)
    const hidden = chips.find(c => c.instanceId === 'inst:rsi:1')
    expect(hidden, 'the hidden instance vanished from the strip').toBeTruthy()
    expect(hidden.hidden).toBe(true)
    expect(hidden.value).toBe(null)
    expect(hidden.text).toBe('RSI(7)')
    expect(hidden.color, 'a hidden chip must still wear its line colour').toBeTruthy()
  })

  it('…and a hidden instance WITH a binding still prints no value — the guard is not `planBindings`\'s accident', () => {
    // ⛔ THE CONTRACT IS TESTED, NOT INHERITED. `legendChips` checks `hidden`
    // BEFORE it looks a binding up, so the promise *"a hidden chip carries no
    // value"* survives a planner that one day parks a hidden series instead of
    // releasing it. Reading the binding first would make this case print
    // `RSI(7) 54.3` — a live number for a line that is not on the chart.
    const stillBound = [...BINDINGS,
      { defId: 'rsi', plotKey: 'rsi', instanceId: 'inst:rsi:1', series: { __id: 'rsi/hidden' }, lastValue: 99.9 }]
    const chips = legendChips(stillBound, null, engineRegistry, INSTANCES)
    const hidden = chips.find(c => c.instanceId === 'inst:rsi:1')
    expect(hidden.value, 'a HIDDEN instance printed a live value').toBe(null)
    expect(hidden.text).toBe('RSI(7)')
    // …and the control: the same call still values the VISIBLE one, so this is
    // not passing because the whole lookup broke.
    expect(chips.find(c => c.instanceId === 'legacy:rsi').text).toBe('RSI(14) 54.3')
  })

  it('the crosshair value WINS over lastValue when seriesData carries the point', () => {
    // ⚠️ 71.14, NOT 71.05. `(71.05).toFixed(1)` is `'71.0'` — 71.05 has no exact
    // binary form and lands a hair BELOW the midpoint — so a `71.05 → '71.1'`
    // expectation fails on arithmetic while looking like a lane failure. The
    // claim here is about WHICH SOURCE won, so the value is chosen not to argue.
    const map = new Map([[fakeSeries, { value: 71.14 }]])
    const chips = legendChips(BINDINGS, map, engineRegistry, INSTANCES)
    const bound = chips.find(c => c.instanceId === 'legacy:rsi')
    expect(bound.text).toBe('RSI(14) 71.1')
    expect(bound.text, 'the chip fell back to lastValue with a point on the cursor')
      .not.toBe('RSI(14) 54.3')
  })

  it('a TOMBSTONE contributes nothing', () => {
    const chips = legendChips(BINDINGS, null, engineRegistry,
      [...INSTANCES, { instanceId: 'inst:rsi:2', deleted: true }])
    expect(chips.filter(c => c.instanceId === 'inst:rsi:2')).toEqual([])
  })

  it('⛔ the VALUED half is `chipsFrom`\'s output, not a second formatter', () => {
    // ONE FORMATTING PIPELINE (spec §6). Every valued chip `legendChips` returns
    // is byte-identical to the one `engineChips` — i.e. `chipsFrom` — produced for
    // the same binding, `hidden` aside. A re-implemented `toFixed` here would be
    // the second precision table Task 5 refused to add for the Style tab.
    const viaEngine = engineChips(BINDINGS, null, engineRegistry, INSTANCES)
    expect(viaEngine, 'the comparison below would be vacuous').toHaveLength(1)
    const withoutHidden = (c) => { const copy = { ...c }; delete copy.hidden; return copy }
    const viaLegend = legendChips(BINDINGS, null, engineRegistry, INSTANCES)
      .filter(c => c.value !== null)
    expect(viaLegend.map(withoutHidden)).toEqual(viaEngine)
    // …and `hidden` really is the ONLY field added, so "byte-identical aside from
    // hidden" is not hiding a second difference.
    expect(viaLegend.every(c => 'hidden' in c)).toBe(true)
  })

  it('chips come out in INSTANCE order × PLOT order, hidden ones in place', () => {
    // The order the strip prints, and the reason a hidden chip does not sink to
    // the end: it is rendered where its instance sits in the stack, which is
    // where the user will look for the thing they hid.
    const chips = legendChips(BINDINGS, null, engineRegistry, [
      { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: true },
      ...INSTANCES,
    ])
    expect(chips.map(c => `${c.instanceId}::${c.plotKey}`)).toEqual([
      'inst:macd:1::macd', 'inst:macd:1::signal', 'legacy:rsi::rsi', 'inst:rsi:1::rsi',
    ])
  })

  it('is total over the registry: every definition yields at least one chip per instance', () => {
    // The Task 2 totality, held from the READOUT side. A definition that binds a
    // data plot but declares no chip would appear here as an instance that
    // contributes nothing — the exact "unlabelled coloured line" wall.
    const instances = engineRegistry.listDefinitions()
      .map((d, i) => ({ instanceId: `inst:${d.id}:${i}`, defId: d.id, inputs: {}, hidden: false }))
    const chips = legendChips([], null, engineRegistry, instances)
    const silent = instances
      .filter(inst => !chips.some(c => c.instanceId === inst.instanceId))
      .map(inst => inst.defId)
    expect(silent, 'a definition contributes NO chip — that indicator is an unlabelled line')
      .toEqual([])
    // …and the control: the rail is not simply passing on an empty answer.
    expect(chips.length).toBeGreaterThanOrEqual(instances.length)
  })

  it('shrugs off junk the way `chipsFrom` does', () => {
    expect(legendChips(null, null, null, null)).toEqual([])
    expect(legendChips([], null, engineRegistry, [null, undefined, {}, { instanceId: 5 }])).toEqual([])
    expect(legendChips([], null, engineRegistry,
      [{ instanceId: 'x', defId: 'nope-not-a-definition', inputs: {} }])).toEqual([])
  })
})
