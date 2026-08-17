import { legendAlways } from './legendProbe'
// app/src/components/chart/engine/__tests__/perPlotRepaintBadge.test.jsx
//
// ─── 🔴 THE PER-PLOT REPAINT BADGE — THE RENDER SURFACE, AND ITS SEPARATION ──
//
// The owner's ruling (`docs/decisions/2026-08-06-machine-repaint-linter.md` §4)
// is PER PLOT: `ichimoku` is clean on `tenkan`, `kijun`, `spanA` and `spanB` and
// is not clean on `chikou`. §4.1 then measured why it had never been applied —
// **nothing in shipped source read a per-plot verdict** — and named the three
// available moves, two of which lie:
//
//   * badge the PLOT into the old schema → schema-legal, rendered by nothing. A
//     badge no trader ever sees is not a badge.
//   * badge the DEFINITION → visible, and it slanders four honest columns. That
//     trades a false "safe" for a false "unsafe", which is no better.
//   * build the SURFACE → this file's subject.
//
// ⛔ SO THE GATE IS THE SEPARATION, NOT THE VERDICT. A case that only checked
// `chikou` would pass on a change that marks all five columns — which is exactly
// the second refused move, shipped by accident. Every case here asserts the
// negative half beside the positive one, and both halves are DERIVED from the
// shipped definition rather than typed, so a plot added to `ichimoku` tomorrow is
// judged by this file instead of being invisible to it.
//
// ⛔ AND THE OTHER DIRECTION, WHICH IS THE ONE A HAPPY-PATH SUITE ALWAYS MISSES:
// a definition the linter finds nothing wrong with must render NOTHING. Sixteen
// of the seventeen shipped definitions are in that case. Without that assertion
// "the badge renders" is satisfiable by a surface that badges everything, which
// is the uniform column record §1 measured and record §4 refused in the owner's
// own words — *"a badge that every indicator wears carries no information."*
//
// ⚠️ AND SILENCE MEANS "NO OPINION", NEVER "CLEAN". Spec §11 forbids static
// analysis of hand-written computes, so the linter cannot read sixteen of the
// seventeen; their plots carry no notice because nothing measured them. This file
// asserts the ABSENCE of a notice, and never asserts a clean one, because a
// surface that painted an undecidable plot green would write *"the linter
// agreed"* over silence — the sentence obligation 8 exists to make impossible.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bars200 from '../../../../pages/parityBars/ramp200.json'

// `__tests__` → engine → chart → components → src → app → the repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..')

const H = vi.hoisted(() => ({
  crosshairHandlers: [],
  addSeriesCalls: [],
  reset() { H.crosshairHandlers.length = 0; H.addSeriesCalls.length = 0 },
}))

// The chart double is `userDefinitionDraws.test.jsx`'s, plus the crosshair
// subscription this file needs (a chip only exists while the crosshair is over a
// bar). A no-op stub cannot express either.
vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor) => {
    const s = {
      __ctor: ctor,
      setData: () => {}, update: () => {}, applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
      dataByIndex: () => null,
    }
    return s
  }
  const timeScaleBase = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, setVisibleRange: () => {},
    scrollToPosition: () => {}, scrollPosition: () => 0, timeToCoordinate: () => 0,
    coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  }
  const timeScale = new Proxy(timeScaleBase, {
    get: (t, p) => {
      if (p in t) return t[p]
      if (typeof p === 'symbol' || p === 'then') return undefined
      return () => undefined
    },
  })
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const s = makeSeries(ctor)
      H.addSeriesCalls.push({ ctor, options, paneIndex, series: s })
      return s
    },
    addCustomSeries: () => makeSeries('custom'),
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: (fn) => { H.crosshairHandlers.push(fn) },
    unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  const value = { user: { id: 7 }, plan: 'premium', isPaid: true, loading: false }
  return { AuthContext: createContext(value), useAuth: () => value, useIsPaid: () => true }
})

const { default: StockChart } = await import('../../../StockChart')
const { default: IndicatorChip } = await import('../../legend/IndicatorChip')
const registry = await import('../nativeRegistry')
const { repaintNotices, plotRepaintNotice, definitionRollUp } = await import('../repaintVerdict')
const { validateDefinition, SCHEMA_VERSION } = await import('../defSchema')
const { parseFormula, astHash } = await import('../ast/parse')

const BARS = bars200.bars

// --------------------------------------------------------------------------- //
// PART A — the verdict, per plot, over the SHIPPED catalogue
// --------------------------------------------------------------------------- //

const ichimoku = () => registry.getDefinition('ichimoku')

describe('the per-plot verdict separates ONE column from its siblings', () => {
  it('⭐ ichimoku\'s chikou carries the repainting verdict — and its other four plots carry none', () => {
    const def = ichimoku()
    const keys = def.plots.map(p => p.key)

    // ⛔ THE FLOOR. Every clause below is a claim about a five-plot definition; a
    // definition whose plot walk came back empty would satisfy "no sibling is
    // marked" by having no siblings at all.
    expect(keys, 'the shipped ichimoku definition no longer declares the five columns this ' +
      'ruling is about, so the separation below is a claim about a definition that moved',
    ).toEqual(['tenkan', 'kijun', 'spanA', 'spanB', 'chikou'])

    const notices = repaintNotices(def)
    expect(notices.map(n => n.plotKey),
      'the per-plot verdict has stopped naming exactly one column of ichimoku. Marking MORE than ' +
      'chikou slanders columns that read [i-n, i] and is the definition-level badge the owner ' +
      'refused, arriving one level down; marking NONE is the shipped `non-repainting` lie.',
    ).toEqual(['chikou'])
    expect(notices[0].mode).toBe('preview-repaints')
    expect(notices[0].forward).toBe(26)
    expect(notices[0].label).toBe('Chikou')
    // The sentence a member reads must NAME the bar after which the value settles
    // — that is the only thing `preview-repaints` says that `repaints` does not
    // (record §3.2), and a badge that dropped it would be the blunter claim.
    expect(notices[0].sentence).toMatch(/\b26\b/)

    // …and the same answer through the per-chip door, derived over every plot the
    // definition declares rather than over a list typed here.
    expect(Object.fromEntries(keys.map(k => [k, !!plotRepaintNotice(def, k)])),
      'a chip-level mark reached a column the linter did not decide against',
    ).toEqual({ tenkan: false, kijun: false, spanA: false, spanB: false, chikou: true })

    expect(definitionRollUp(def)).toBe('preview-repaints')
  })

  it('⭐ and every OTHER definition in the catalogue renders no badge at all', () => {
    const defs = registry.listDefinitions()
    expect(defs.length, 'the catalogue is empty, so "nothing else is marked" is a claim about nothing',
    ).toBeGreaterThan(10)

    const marked = defs.filter(d => repaintNotices(d).length).map(d => d.id)
    expect(marked,
      'a definition other than ichimoku now renders a repaint notice. Either a real finding landed ' +
      '(record it in the decision record\'s measurement block, which is what makes a finding loud) ' +
      'or the surface has started badging things nobody measured — and a badge every indicator ' +
      'wears carries no information, which is the owner\'s own reason for the per-plot ruling.',
    ).toEqual(['ichimoku'])

    // ⛔ ABSENCE IS "NO OPINION", NOT "CLEAN", AND THE ROLL-UP SAYS SO. Sixteen
    // hand-written computes roll up to `null`, never to `non-repainting`: the
    // linter could not read them, and a surface that turned that silence into a
    // clean badge would write "the linter agreed" over it.
    expect([...new Set(defs.filter(d => d.id !== 'ichimoku').map(d => definitionRollUp(d)))],
      'a definition the linter cannot read is rolling up to a VERDICT. Spec §11 forbids static ' +
      'analysis of hand-written computes; anything but null here is an answer nobody earned.',
    ).toEqual([null])
  })

  it('the 26 is not typed twice — the window IS the Kijun period, and the golden fixture agrees', () => {
    const def = ichimoku()
    const chikou = def.plots.find(p => p.key === 'chikou')
    const kijun = def.inputs.find(i => i.key === 'kijunPeriod')

    // `indicators.computeIchimoku` does `const displacement = kijunPeriod`, so
    // these are one number. Read off the SHIPPED definition, both of them.
    expect(kijun, 'ichimoku no longer declares a kijunPeriod input, so the window below is anchored ' +
      'to nothing').toBeTruthy()
    expect(chikou.forward,
      'chikou\'s forward window and the Kijun period have drifted apart. They are the SAME number — ' +
      'the compute displaces by `kijunPeriod` — so one of the two is now describing maths the other ' +
      'is not doing.',
    ).toBe(kijun.default)

    // ⛔ AND THE DECLARATION IS TIED TO AN ARTEFACT, NOT TO ITSELF. The committed
    // golden fixture carries the compute's OWN output; its trailing null run is
    // the displacement, measured rather than declared. This is the rail that
    // makes the number above a fact instead of two copies of a guess — the same
    // one `ast/lint.test.js` uses for the linter's input and
    // `tests/test_indicator_golden.py`'s `TRAILING_PAD` comment names in as many
    // words: *"change the back-shift and this goes red with the two numbers in
    // hand."*
    const dir = path.join(REPO_ROOT, 'tests', 'fixtures', 'indicators')
    const pads = {}
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const expected = doc && doc.expected
      if (!expected || typeof expected !== 'object' || Array.isArray(expected)) continue
      for (const [col, values] of Object.entries(expected)) {
        if (!Array.isArray(values) || !values.length) continue
        let trailing = 0
        for (let i = values.length - 1; i >= 0 && values[i] === null; i--) trailing++
        if (trailing && trailing !== values.length) pads[`${doc.kind}.${col}`] = trailing
      }
    }
    expect(Object.keys(pads).sort(),
      'the trailing-pad measurement over the committed golden fixtures found nothing (or found ' +
      'something new). Empty means the comparison below is between a declaration and silence.',
    ).toEqual(['ichimoku.chikou'])
    expect(pads['ichimoku.chikou'],
      'the plot DECLARES a forward window the compute\'s own committed output does not show. The ' +
      'artefact wins: one of them is describing maths nobody is running.',
    ).toBe(chikou.forward)
  })
})

// --------------------------------------------------------------------------- //
// PART B — the badge is the LINTER's, and a hand-set one is refused
// --------------------------------------------------------------------------- //

/** A minimal valid definition, with `over` merged into its single plot. */
function defWithPlot(over) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'probe',
    version: 1,
    compute: { kind: 'native', fn: 'probe', rev: 1 },
    meta: { name: 'Probe' },
    placement: { target: 'pane' },
    inputs: [],
    plots: [{ key: 'value', label: 'Probe', style: 'line', color: '#fff', width: 1, ...over }],
  }
}

describe('a plot may declare its WINDOW and may never declare its BADGE', () => {
  it('control: the same definition without the field registers cleanly', () => {
    expect(validateDefinition(defWithPlot({})).ok,
      'the fixture itself is invalid, so every refusal below is a refusal of the wrong thing',
    ).toBe(true)
    expect(validateDefinition(defWithPlot({ forward: 26 })).ok,
      'a plot can no longer declare its forward window at all, which is the field the whole ' +
      'per-plot surface reads',
    ).toBe(true)
    expect(validateDefinition(defWithPlot({ forward: 0 })).ok).toBe(true)
    expect(validateDefinition(defWithPlot({ forward: 'unbounded' })).ok).toBe(true)
  })

  it('⛔ a hand-set per-plot badge is REFUSED — in BOTH directions', () => {
    // Task 15 measured this field as **accepted and ignored**: preserved by the
    // unknown-KEY policy, read by nothing, checkable by nothing. A badge an
    // author types is the "audited metadata" record §1 measured to have audited
    // nothing — so the field a plot may write is the one the LINTER reads.
    for (const claim of ['non-repainting', 'preview-repaints', 'repaints']) {
      const res = validateDefinition(defWithPlot({ repaint: claim }))
      expect(res.ok, `a plot declaring repaint=${claim} was accepted`).toBe(false)
      expect(res.errors.join('\n')).toMatch(/plots\[0\]\.repaint/)
    }
    // ⚠️ UNDER-CLAIMING IS AS FALSE AS OVER-CLAIMING, which is why the loop above
    // covers the pessimistic token too. A definition that volunteers `repaints`
    // about maths that does not is still a claim nobody measured.
  })

  it('an unreadable window is refused rather than guessed, and OMITTED still means "undecided"', () => {
    for (const bad of ['soon', -1, 1.5, true, null]) {
      expect(validateDefinition(defWithPlot({ forward: bad })).ok,
        `plots[].forward=${JSON.stringify(bad)} was accepted`).toBe(false)
    }
    // ⛔ AND `0` IS NOT THE SAME AS OMITTED. `0` says "measured, reads nothing
    // ahead"; omitted says nothing at all. Collapsing them would brand every
    // undeclared plot in the catalogue clean on the strength of its silence.
    const declaredZero = defWithPlot({ forward: 0 })
    const silent = defWithPlot({})
    expect(repaintNotices(validateDefinition(declaredZero).def)).toEqual([])
    expect(repaintNotices(validateDefinition(silent).def)).toEqual([])
    expect(definitionRollUp(validateDefinition(declaredZero).def)).toBe('non-repainting')
    expect(definitionRollUp(validateDefinition(silent).def),
      'a plot that declared nothing is rolling up to a verdict — silence became an answer',
    ).toBe(null)
  })
})

describe('the ast lane\'s badge is still the tree\'s, and nothing may declare around it', () => {
  const astDoc = ({ repaint = 'non-repainting', plotOver = {} } = {}) => {
    const source = 'sma(close, 20)'
    const parsed = parseFormula(source)
    if (!parsed.ok) throw new Error(`fixture formula does not parse: ${parsed.error}`)
    return {
      schemaVersion: SCHEMA_VERSION,
      id: 'u_aabbccdd1122',
      version: 1,
      compute: { kind: 'ast', fn: astHash(parsed.ast), rev: 1, ast: parsed.ast, source },
      // ⚠️ `freshness` IS REQUIRED ON THIS LANE (Phase E Task 1, GATE 6). This
      // fixture is `sma(close, 20)`, so the MEASURED value is `live`.
      meta: {
        name: 'SMA 20', shortName: 'SMA 20', category: 'Custom', tier: 'premium',
        repaint, freshness: 'live',
      },
      placement: { target: 'pane', pane: { height: 0.15 } },
      inputs: [{ key: 'color', type: 'color', label: 'Color', default: '#c9a84c' }],
      plots: [{ key: 'value', label: 'SMA 20', style: 'line', color: '$color', width: 1, role: 'primary', ...plotOver }],
    }
  }

  it('control: the honest declaration installs', () => {
    const { defs, errors } = registry.validateUserDefinitions([astDoc()])
    expect(errors, 'the fixture is refused for some other reason, so the refusals below prove nothing',
    ).toEqual([])
    expect(defs.length).toBe(1)
  })

  it('⛔ a definition badge that disagrees with the linter is still refused — both directions', () => {
    for (const wrong of ['preview-repaints', 'repaints']) {
      const { defs, errors } = registry.validateUserDefinitions([astDoc({ repaint: wrong })])
      expect(defs.length, `an ast definition claiming ${wrong} over sma(close,20) installed`).toBe(0)
      expect(errors.join('\n')).toMatch(/MEASURES/)
    }
  })

  it('⛔ and an ast plot may not declare a forward window — the tree already knows it', () => {
    const { defs, errors } = registry.validateUserDefinitions([astDoc({ plotOver: { forward: 26 } })])
    expect(defs.length,
      'an ast definition installed while declaring its own forward window. The tree is readable on ' +
      'this lane, so a hand-typed window beside it is a second source for one number — and moving ' +
      'it would move the badge without touching a line of maths, which is a hand-set badge taking ' +
      'the long way round.',
    ).toBe(0)
    expect(errors.join('\n')).toMatch(/plots\[\]\.forward/)
  })
})

// --------------------------------------------------------------------------- //
// PART C — the SURFACE
// --------------------------------------------------------------------------- //

describe('the chip renders a mark for its OWN plot and for no other', () => {
  afterEach(cleanup)

  const CHIP = {
    instanceId: 'inst:ichimoku:0', defId: 'ichimoku', plotKey: 'chikou',
    label: 'Chikou', text: 'Chikou 12.34', color: '#abc', hidden: false,
  }
  const marks = (c) => [...c.querySelectorAll('[data-repaint]')].map(el => el.getAttribute('data-repaint'))

  it('no notice ⇒ no mark, and the chip\'s text is unchanged to the character', () => {
    const { container } = render(<IndicatorChip chip={CHIP} />)
    expect(marks(container)).toEqual([])
    expect(container.textContent).toBe('Chikou 12.34')
  })

  it('a notice ⇒ one mark, carrying the mode and the sentence, and STILL no text', () => {
    const notice = plotRepaintNotice(ichimoku(), 'chikou')
    const { container } = render(<IndicatorChip chip={CHIP} repaint={notice} />)
    expect(marks(container)).toEqual(['preview-repaints'])
    // ⛔ ONE ELEMENT, ONE TEXT NODE — the invariant the control strip already
    // lives under. A mark that carried a glyph would put a second chip in every
    // `querySelectorAll('span')` text read in the suite.
    expect(container.textContent,
      'the repaint mark added TEXT to the chip. `stockChartWiring.test.jsx` counts chips by text ' +
      'predicate; a character here is a chip counted twice.',
    ).toBe('Chikou 12.34')
    const mark = container.querySelector('[data-repaint]')
    expect(mark.getAttribute('aria-label')).toContain('preview repaints')
    expect(mark.getAttribute('title')).toMatch(/\b26\b/)
  })
})

describe('the chart\'s About page names the repainting COLUMN — including one with no chip', () => {
  beforeEach(() => { H.reset(); vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))) })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  const instance = (defId) => ({
    instanceId: `inst:${defId}:0`, defId, defVersion: 1, inputs: {},
    placement: { target: defId === 'ichimoku' ? 'price' : 'pane' }, hidden: false,
  })

  /** Mount, hover a bar so the crosshair legend renders its chips, right-click
   *  the first chip and open its About page. Returns the popover text.
   *
   *  ⚠️ DELIVERED TO EVERY SUBSCRIBER, REPEATEDLY. StockChart registers two
   *  crosshair handlers and the legend coalesces through rAF; `legendProbe.js`
   *  records both lessons and this is the same discipline in miniature. */
  async function aboutTextFor(defId) {
    const view = render(
      <StockChart sym="PARITY" tf="D" barsOverride={BARS} liveUpdates={false} height={420}
        settingsOverride={legendAlways({ indicatorInstances: [instance(defId)] })} />)
    expect(H.crosshairHandlers.length, 'nothing subscribed to crosshairMove — this case is vacuous',
    ).toBeGreaterThan(0)

    // ⛔ THE CANDLE SERIES MUST BE IN `seriesData` OR NO LEGEND RENDERS AT ALL —
    // the OHLC row is what `crosshairData` is built from, and the chips are its
    // siblings. Resolved from the recorded `addSeries` calls rather than by
    // index, so a change in series order is visible instead of silent.
    const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
    expect(candle, 'the chart never created a candle series, so the legend has nothing to render',
    ).toBeTruthy()
    const param = {
      time: BARS.at(-1).t,
      point: { x: 100, y: 100 },
      logical: BARS.length - 1,
      seriesData: new Map([[candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }]]),
    }
    let chip = null
    for (let i = 0; i < 40 && !chip; i++) {
      // Sequential on purpose: each read must observe the DOM the previous
      // dispatch settled into.
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        for (const fn of [...H.crosshairHandlers]) fn(param)
        await new Promise(r => setTimeout(r, 20))
      })
      chip = view.baseElement.querySelector('[data-instance-id]')
    }
    expect(chip, `no legend chip ever rendered for ${defId}, so the menu below opens on nothing`,
    ).toBeTruthy()

    await act(async () => { fireEvent.contextMenu(chip) })
    const about = [...view.baseElement.querySelectorAll('button')]
      .find(b => /^About /.test(b.textContent || ''))
    expect(about, 'the chip menu has no About row — the surface this case reads is gone').toBeTruthy()
    await act(async () => { fireEvent.click(about) })

    return { view }
  }

  it('⭐ ichimoku\'s About page names CHIKOU — the one plot that declares no chip of its own', async () => {
    // ⛔ THIS IS WHY THE ABOUT PAGE IS THE SURFACE AND THE CHIP ALONE IS NOT.
    // Measured off the shipped definition: `chikou` declares no `plots[].legend`
    // block, so `legendChips` emits nothing for it and it has NO CHIP TO MARK. A
    // chip-only badge would have been invisible for the exact column the owner's
    // ruling is about.
    const def = ichimoku()
    const chipless = def.plots.filter(p => !p.legend).map(p => p.key)
    expect(chipless, 'chikou now declares a legend chip, which changes what this case is proving',
    ).toContain('chikou')

    const { view } = await aboutTextFor('ichimoku')
    const rows = [...view.baseElement.querySelectorAll('[data-repaint-plot]')]
    expect(rows.map(r => r.getAttribute('data-repaint-plot')),
      'the About page no longer names exactly ichimoku.chikou. More rows means the surface is ' +
      'badging clean columns; none means the ruling is invisible again.',
    ).toEqual(['ichimoku.chikou'])
    expect(rows[0].getAttribute('data-repaint')).toBe('preview-repaints')
    expect(rows[0].textContent).toMatch(/Chikou/)
    expect(rows[0].textContent).toMatch(/\b26\b/)

    // ⛔ AND THE OLD, UNAUDITED SENTENCE IS GONE. The page used to print
    // `meta.repaint` as prose on every definition — on ichimoku that read
    // "non repainting", which is a claim the machine linter contradicts.
    expect(view.baseElement.textContent,
      'the About page still prints the definition-level `non-repainting` default beside a per-plot ' +
      'finding that contradicts it — the page now says both things at once',
    ).not.toMatch(/non repainting/)
  }, 30000)

  it('⭐ and RSI\'s About page shows no repaint row at all — the other direction', async () => {
    const { view } = await aboutTextFor('rsi')
    // The page rendered — so the absence below is an absence in a page that exists.
    expect(view.baseElement.textContent).toMatch(/Relative Strength Index/)
    expect([...view.baseElement.querySelectorAll('[data-repaint-plot]')],
      'a definition the linter has no opinion about is wearing a badge. A badge every indicator ' +
      'wears carries no information (record §4), and painting an undecidable plot is worse than ' +
      'that — it writes "the linter agreed" over silence.',
    ).toEqual([])
    expect(view.baseElement.querySelectorAll('[data-repaint]').length).toBe(0)
  }, 30000)
})
