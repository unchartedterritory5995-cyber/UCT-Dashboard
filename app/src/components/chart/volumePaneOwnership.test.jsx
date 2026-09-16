// app/src/components/chart/volumePaneOwnership.test.jsx
//
// ─── DISPLAY DESTINATION → LEGEND OWNERSHIP ─────────────────────────────────
//
// ⭐⭐ THE OWNER'S §13, WHICH IS ONE SENTENCE AND GOVERNS EVERY READOUT ON THE
// CHART: *"EVERY PLOTTED SERIES BELONGS TO A DISPLAY PANE. ITS LEGEND / READOUT
// BELONGS TO THAT SAME PANE."* Not its source type, not its definition, not
// whether it is legacy or engine, not a pane INDEX — and, as of this change, not
// a special case for Volume either.
//
// ⚰️ WHAT WAS MEASURED, AND WHY VOLUME WAS THE ONE THAT SHOWED IT. With Volume in
// a pane of its own, `Vol 9.1M` was printed TWICE — at the bottom of the price
// pane's study stack and again in the volume pane's own strip six pixels below
// it. Owner: *"The current screenshot showing Price legend: EMA… EMA… Vol 9.1M
// while Volume is visibly in its own pane is conceptually wrong."*
//
// ⛔ AND THE THINGS THAT WERE PRINTED WITHOUT BEING ASKED FOR. The volume pane
// also carried `$ Vol $6.48B` and `Avg 50D 34.6M` on every chart in the product.
// §16: *"I do NOT want Dollar Volume and Average 50-Day Volume automatically
// bundled into the Volume pane… If the member wants Dollar Volume, they add it."*
// The two are NOT the same kind of thing, and the difference is the whole of §51:
//
//   · `$ Vol` had NO setting anywhere — inline arithmetic, printed unasked. It is
//     a DEFINITION now, and it is gone from the automatic readout entirely.
//   · `Avg 50D` IS a setting (`cs.volume.maPeriod`) that draws a real LINE. Only
//     its DEFAULT moved (50 → 0). A member who configured one keeps it.
//
// ⚠️ THE SOURCE-LEVEL HALF OF THE PRICE-STACK RULE LIVES IN `legendV2.test.jsx`,
// because no suite in this repo mounts `StockChart` with `verticalLegend` (see
// that file's header for why, and the pane harness for the pixels).

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'
import { volumeOwnsPane } from './engine/volumePresentation'
import { resolveDisplayTarget } from './engine/displayTarget'
import { addInstance, setInstanceInput, setInstanceDisplayTarget } from './engine/instanceControls'
import * as registry from './engine/nativeRegistry'
import { lastCreatedInstance } from './discoveryCatalog'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STOCK_CHART = readFileSync(path.resolve(HERE, '../StockChart.jsx'), 'utf8')

afterEach(() => cleanup())

const addMA = (cs, source) => {
  const added = addInstance(cs, 'movingAverage', registry)
  const id = lastCreatedInstance(cs, added).instanceId
  return { cs: setInstanceInput(added, id, 'source', source, registry), id }
}

describe('⛔⛔ VOLUME DOES NOT AUTOMATICALLY BUNDLE ANYTHING (owner §16)', () => {
  it('⭐⭐ no volume moving average by default — the 50 was nobody’s choice', () => {
    // ⚰️ `CHART_DEFAULTS.volume.maPeriod` WAS 50. That drew a line, and printed a
    // reading for it, on every chart in the product without anybody picking it.
    expect(CHART_DEFAULTS.volume.maPeriod).toBe(0)
    expect(mergeChartSettings(JSON.stringify({})).volume.maPeriod).toBe(0)
  })

  it('⭐⭐ …AND A MEMBER’S OWN PERIOD IS UNTOUCHED — §51, the other half', () => {
    // Every chart saved through the settings modal carries this key, because
    // `onChange` persists the whole merged object. Those members keep their line,
    // their period and their colour; only a blob that never said anything changes
    // meaning. Removing the default is not the same as erasing a configuration.
    const mine = mergeChartSettings(JSON.stringify({ volume: { maPeriod: 50, maColor: '#abcdef' } }))
    expect(mine.volume.maPeriod).toBe(50)
    expect(mine.volume.maColor).toBe('#abcdef')
  })

  it('⛔⛔ `$ Vol` HAS NO AUTOMATIC PRODUCER LEFT — the field itself is deleted', () => {
    // ⚰️ IT WAS `volume × close`, COMPUTED ON EVERY CROSSHAIR FRAME into
    // `crosshairData.dollarVol` and printed by three surfaces (the volume strip,
    // the phone legend, the branded screenshot). It had no setting anywhere, so
    // there was nothing for a member to turn off.
    //
    // ⛔ ASSERTED AT THE SOURCE, because a render test can only prove that one
    // chart does not show it. The claim is that the arithmetic is GONE — nothing
    // computes it, so nothing can start printing it again by accident.
    expect(STOCK_CHART, 'the inline dollar-volume arithmetic is back')
      .not.toMatch(/dollarVol:\s*\(Number\.isFinite/)
    expect(STOCK_CHART.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''),
      'something still reads crosshairData.dollarVol')
      .not.toMatch(/crosshairData\.dollarVol/)
  })

  it('⭐ AND IT IS AN INDICATOR A MEMBER CAN ADD — the capability did not go away', () => {
    // §18: *"Dollar Volume should be independently addable."* It is a definition
    // like any other now, which is what gives it a colour, a pane, a legend row,
    // a ✕ and everything else this project is about.
    const def = registry.getDefinition('dollarVolume')
    expect(def, 'Dollar Volume is not addable at all').toBeTruthy()
    expect(def.meta.name).toBe('Dollar Volume')
    // ⛔ ITS OWN PANE BY DEFAULT, AND THAT IS ARITHMETIC RATHER THAN TASTE:
    // `volume × close` is ~$6.5B against 9.1M shares. Declared into the volume
    // pane it would share volume's ladder and flatten the bars it sits over.
    expect(def.placement.target).toBe('pane')
    const cs = addInstance(mergeChartSettings(JSON.stringify({})), 'dollarVolume', registry)
    const inst = lastCreatedInstance(mergeChartSettings(JSON.stringify({})), cs)
    expect(inst, 'Dollar Volume could not be instantiated').toBeTruthy()
    expect(resolveDisplayTarget(inst, cs)).toBe('pane')
  })
})

describe('⭐⭐ MA(Volume) IS THE SAME MOVING AVERAGE, AND IT LANDS IN VOLUME’S PANE', () => {
  it('§17 — source Volume resolves into the volume pane, with no new architecture', () => {
    // The owner's §17 in full: *"Do NOT invent separate 'Average Volume'
    // architecture if the canonical Moving Average engine already correctly
    // handles it."* It does — `displayTarget`'s derived rule follows the SOURCE.
    const { cs, id } = addMA(mergeChartSettings(JSON.stringify({})), 'volume')
    const inst = cs.indicatorInstances.find((i) => i.instanceId === id)
    expect(resolveDisplayTarget(inst, cs)).toBe('volume')
  })

  it('⛔ AND THAT PROMOTES VOLUME TO A REAL PANE — there is nothing else to draw into', () => {
    const { cs } = addMA(mergeChartSettings(JSON.stringify({})), 'volume')
    expect(volumeOwnsPane({ cs, instances: cs.indicatorInstances, shown: true })).toBe(true)
  })

  it('⭐ …and an explicit move still wins, because a default is never a weld', () => {
    const { cs, id } = addMA(mergeChartSettings(JSON.stringify({})), 'volume')
    const moved = setInstanceDisplayTarget(cs, id, 'price', registry)
    const inst = moved.indicatorInstances.find((i) => i.instanceId === id)
    expect(resolveDisplayTarget(inst, moved), 'the derived default outranked the member').toBe('price')
  })
})

describe('⛔⛔ THE LEGEND ASKS THE SAME QUESTION THE RENDERER DOES', () => {
  // ⚰️ THE CLASS OF DEFECT THIS EXISTS FOR IS ALREADY WRITTEN DOWN ONCE, in
  // `chartDataMap`'s header: two readers of one rule, one of them missing an
  // input, and a panel confidently describing a chart that is not on screen.
  // `volInSeparatePane` is the PRICE-SCALE question and misses the rule that an
  // overlay forces a pane; the legend must not use it.
  const body = STOCK_CHART.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  it('⭐ the legend’s volume-pane predicate is `volumeOwnsPane`, with every input', () => {
    const m = /const volumeOwnsItsPane = volumeOwnsPane\(\{([\s\S]*?)\}\)/.exec(body)
    expect(m, 'the legend no longer asks `volumeOwnsPane` — marker moved').toBeTruthy()
    for (const input of ['cs', 'instances', 'shown', 'blankVolume', 'volumeSeparatePane']) {
      expect(m[1], `the legend asks a NARROWER question than the renderer: no ${input}`)
        .toContain(input)
    }
  })

  it('⭐⭐ a VOLUME-targeted chip reports the volume pane, not Price', () => {
    // `parsePaneOfTarget` only understands `@host`, so a volume target used to
    // fall through to `null` — which every caller reads as "drawn on Price". An
    // SMA of Volume drew in the volume pane and printed its number at the top of
    // the chart.
    expect(body, 'chipPaneHost no longer answers for the volume pane')
      .toContain("if (target === 'volume') return volumeOwnsItsPaneRef.current ? VOLUME_PANE : null")
  })

  it('⛔ AND A BANDED VOLUME STILL ANSWERS PRICE — the same rule, other answer', () => {
    // A band is drawn INSIDE the candles' pane, so a guest overlaid on it really
    // is a price-pane plot. The ternary above is what makes that true rather than
    // hopeful, and this is the case that would notice it becoming unconditional.
    const cs = mergeChartSettings(JSON.stringify({ volume: { separatePane: false } }))
    expect(volumeOwnsPane({ cs, instances: [], shown: true }),
      'a bare chart claims a volume pane it does not have').toBe(false)
  })
})

describe('⭐ THE VOLUME PANE’S ROWS ARE DERIVED, NOT ENUMERATED', () => {
  const body = STOCK_CHART.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const rows = (() => {
    const start = body.indexOf('const volPaneRows = useMemo(')
    expect(start, '`volPaneRows` is gone — the volume pane has no legend').toBeGreaterThan(-1)
    return body.slice(start, body.indexOf('}, [crosshairData,', start))
  })()

  it('⭐⭐ its guests come from `chipPaneHost`, the one pane authority', () => {
    // A membership rule computed here would be a second opinion about where a
    // series draws — which is the whole thing `chartDataMap`'s header forbids.
    expect(rows).toContain('chipPaneHost(c)')
    expect(rows).toContain('host !== VOLUME_PANE')
  })

  it('⭐ Volume wears a micro-rail in its own colour (§21)', () => {
    // §21: *"A MICRO-RAIL MEANS: THIS READOUT CORRESPONDS TO A PLOTTED SERIES.
    // Therefore Volume SHOULD receive a micro-rail in its own pane."*
    expect(rows).toContain('opaqueColor(cs.volume?.upColor)')
  })

  it('⛔ AND THE RAIL IS EMITTED IN THE HORIZONTAL STRIP ONLY WHEN THERE IS A COLOUR', () => {
    // The vertical stack reserves the rail's width unpainted so every label starts
    // at one x. A horizontal strip has no column to hold, so an unpainted rule
    // there would open a hole before every `O`, `H`, `L` and `C`.
    const row = readFileSync(path.resolve(HERE, 'legend/LegendRow.jsx'), 'utf8')
    expect(row).toMatch(/color \? <i className=\{styles\.railFlat\}/)
    const css = readFileSync(path.resolve(HERE, 'legend/LegendRow.module.css'), 'utf8')
    expect(css, 'the flat rail has no geometry').toMatch(/\.rail,\s*\n\s*\.railFlat\s*\{/)
  })

  it('⛔⛔ THE PERIOD IS READ FROM `cs`, NOT FROM THE CROSSHAIR PAYLOAD', () => {
    // ⚰️ MEASURED IN THE PANE HARNESS 2026-09-16: setting Volume MA period to 50
    // drew the line and printed NO row. `crosshairData.volMaPeriod` is stamped by
    // the crosshair handler from its own closure over `volMaPeriodEff`, and that
    // handler subscribes once — so a period changed mid-session reached the
    // RENDERER (which reads a ref) and never the PAYLOAD.
    //
    // ⛔ IT WAS INVISIBLE UNTIL THE DEFAULT MOVED TO 0, because the period was
    // never zero at subscribe time. This is the shape of defect a default hides:
    // the bug was always there and the default was standing in front of it.
    expect(rows).toContain('const volMaPeriod = Number(cs.volume?.maPeriod) || crosshairData.volMaPeriod || 0')
    expect(rows, 'the label is stamped from the stale payload again')
      .not.toMatch(/label: `SMA \$\{crosshairData\.volMaPeriod\}`/)
  })

  it('⛔⛔ the legacy volume MA reads `SMA <period>` — one Moving Average, one grammar', () => {
    // §17. A member who adds `Moving Average · SMA · 50 · Source: Volume` gets a
    // row reading `SMA 50`; the legacy one printing `Avg 50D` beside it is exactly
    // how one feature comes to read as two.
    expect(rows).toContain('label: `SMA ${volMaPeriod}`')
    expect(rows, 'the retired `Avg ND` phrasing is back').not.toMatch(/Avg \$\{/)
  })
})
