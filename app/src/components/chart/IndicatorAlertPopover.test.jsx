import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

// ─── THE ALERT DROPDOWN STOPPED ENUMERATING (B4 Task 9) ─────────────────────
//
// `IndicatorAlertPopover.jsx` hand-wrote INDICATORS, OSCILLATOR_CONDITIONS,
// CONDITIONS, THRESHOLD_CONDITIONS and INDICATOR_LABELS. All five were a TWIN of
// `api/services/indicator_alert_evaluator.INDICATOR_FUNCS`, and the twin had
// already drifted apart from reality: nothing validates `indicator` on the
// create path, so a `vwap` alert can be stored and can never fire.
//
// ⛔ THE LOADING AND ERROR CASES ARE THE WHOLE SAFETY ARGUMENT, not polish. A
// fallback to the old hardcoded eight would restore the twin AND hide it — a
// fallback is only ever seen when the fetch fails, which is exactly when nobody
// is looking. Both directions are asserted below, and a source probe backs them
// up, because the ABSENCE of a literal is not behaviourally observable.

const H = vi.hoisted(() => ({
  catalog: { catalog: [], isLoading: false, error: null },
  alerts: [],
  created: [],
  valueCalls: [],
  currentValue: null,
}))

vi.mock('../../hooks/useIndicatorAlerts', () => ({
  useIndicatorAlerts: () => ({ alerts: H.alerts, isLoading: false, refresh: () => {} }),
  useIndicatorAlertCatalog: () => H.catalog,
  createIndicatorAlert: (payload) => { H.created.push(payload); return Promise.resolve({ id: 1 }) },
  deleteIndicatorAlert: () => {},
  toggleIndicatorAlert: () => {},
  // ⭐ SPEC §8's threshold prefill. `H.currentValue` defaults to null, which is
  // "no answer for this symbol yet" — the state every existing case here ran
  // in, so none of them changes meaning. The prefill's own cases set it.
  fetchCurrentValue: (args) => { H.valueCalls.push(args); return Promise.resolve(H.currentValue) },
}))

import IndicatorAlertPopover from './IndicatorAlertPopover'

const RSI_ONLY = [{
  indicator: 'rsi',
  label: 'RSI',
  conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
  default_threshold: 70,
}]

const mockCatalog = (rows) => { H.catalog = { catalog: rows, isLoading: false, error: null } }
const mockCatalogLoading = () => { H.catalog = { catalog: [], isLoading: true, error: null } }
const mockCatalogError = () => { H.catalog = { catalog: [], isLoading: false, error: new Error('catalog 500') } }

const optionValues = (name) => [...screen.getByLabelText(name).options].map(o => o.value)

beforeEach(() => {
  H.catalog = { catalog: [], isLoading: false, error: null }
  H.alerts = []
  H.created.length = 0
  H.valueCalls.length = 0
  H.currentValue = null
})
afterEach(cleanup)

describe('IndicatorAlertPopover — the dropdown is served, not written down', () => {
  it('offers exactly what the served catalog carries — no hardcoded list', () => {
    mockCatalog(RSI_ONLY)
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(optionValues('Indicator')).toEqual(['rsi'])
    expect(optionValues('Condition')).toEqual(['above'])
  })

  it('offers a NINTH indicator the moment the server serves one — nothing here caps it at eight', () => {
    mockCatalog([
      ...RSI_ONLY,
      { indicator: 'brand_new', label: 'Brand New', conditions: [{ value: 'cross_zero', label: 'Crosses zero', needs_threshold: false }], default_threshold: null },
    ])
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(optionValues('Indicator')).toEqual(['rsi', 'brand_new'])
  })

  it('while the catalog is loading it offers NOTHING, rather than a stale eight', () => {
    mockCatalogLoading()
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(optionValues('Indicator')).toEqual([])
    expect(screen.getByLabelText('Indicator')).toBeDisabled()
    expect(screen.getByRole('button', { name: /add alert/i })).toBeDisabled()
  })

  it('and if the catalog cannot be fetched it says so instead of offering an alert that cannot fire', () => {
    mockCatalogError()
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.getByText(/alert types are unavailable/i)).toBeTruthy()
    expect(optionValues('Indicator')).toEqual([])
    expect(screen.getByRole('button', { name: /add alert/i })).toBeDisabled()
  })

  it('the threshold field appears exactly when the served condition says it should', () => {
    mockCatalog([{
      indicator: 'rsi',
      label: 'RSI',
      conditions: [
        { value: 'above', label: 'Above threshold', needs_threshold: true },
        { value: 'cross_zero', label: 'Crosses zero line', needs_threshold: false },
      ],
      default_threshold: 70,
    }])
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.getByLabelText('Threshold')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'cross_zero' } })
    expect(screen.queryByLabelText('Threshold')).toBeNull()
  })

  it('the default threshold comes from the SERVED entry, not from an if-ladder in this file', () => {
    // ⚠️ 55 AND -33, DELIBERATELY NOT THE REAL DEFAULTS. The retired ladder read
    // `if (indicator === 'rsi') setThreshold('70')` and would answer these two
    // cases CORRECTLY if the fixture used 70 and -20 — a ladder restored beside
    // the served value would be an equivalent mutant against its own numbers.
    mockCatalog([
      { indicator: 'rsi', label: 'RSI', conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }], default_threshold: 55 },
      { indicator: 'williams_r', label: 'Williams %R', conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }], default_threshold: -33 },
      // The retired ladder had no branch for this one and would have left the
      // previous indicator's number sitting in the box.
      { indicator: 'price_vs_ma', label: 'Price vs MA', conditions: [{ value: 'above', label: 'Price above MA', needs_threshold: true }], default_threshold: null },
    ])
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.getByLabelText('Threshold').value).toBe('55')
    fireEvent.change(screen.getByLabelText('Indicator'), { target: { value: 'williams_r' } })
    expect(screen.getByLabelText('Threshold').value).toBe('-33')
    fireEvent.change(screen.getByLabelText('Indicator'), { target: { value: 'price_vs_ma' } })
    expect(screen.getByLabelText('Threshold').value).toBe('')
    expect(screen.getByRole('button', { name: /add alert/i })).toBeDisabled()
  })

  it('submits the SERVED ids — the payload is not translated through a local map', async () => {
    mockCatalog([
      ...RSI_ONLY,
      { indicator: 'williams_r', label: 'Williams %R', conditions: [{ value: 'cross_below', label: 'Crosses below', needs_threshold: true }], default_threshold: -20 },
    ])
    render(<IndicatorAlertPopover sym="aapl" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Indicator'), { target: { value: 'williams_r' } })
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0]).toEqual({
      sym: 'AAPL', indicator: 'williams_r', condition: 'cross_below', tf: 'D', threshold: -20,
    })
  })

  it('⭐ a stored alert the evaluator cannot evaluate is REPORTED, not rendered as a live one', () => {
    // The exact `vwap` row from the module header: creatable through the API,
    // never firing, and until now indistinguishable from a working alert.
    mockCatalog(RSI_ONLY)
    H.alerts = [
      { id: 1, sym: 'AAPL', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: 1, trigger_count: 0 },
      { id: 2, sym: 'AAPL', indicator: 'vwap', condition: 'above', threshold: 1, tf: 'D', active: 1, trigger_count: 0 },
    ]
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.getAllByText(/cannot fire/i)).toHaveLength(1)
    // …and it is the vwap row, named by the raw id the server stored, because
    // there is no label for something the catalog does not carry.
    expect(screen.getByText(/^vwap above/)).toBeTruthy()
  })

  it('…and reports NOTHING while the catalog is still loading — every row would look dead', () => {
    mockCatalogLoading()
    H.alerts = [
      { id: 2, sym: 'AAPL', indicator: 'vwap', condition: 'above', threshold: 1, tf: 'D', active: 1, trigger_count: 0 },
    ]
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.queryAllByText(/cannot fire/i)).toHaveLength(0)
  })
})

// ─── PICKING A PLOT (B5) ────────────────────────────────────────────────────
//
// "Alert me on Ichimoku" names five different series. The served entry now
// carries `plots`, each with its own address, conditions and default threshold,
// and the popover has to submit the ADDRESS — `entry.indicator` is a group name
// with no value function behind it for adx / donchian / ichimoku, so storing it
// would create an alert that can never fire: this task's own defect, re-opened
// inside the fix.

const LEVEL = [
  { value: 'above', label: 'Above threshold', needs_threshold: true },
  { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
]

/** A grouped indicator whose id is NOT one of its addresses — the shape that
 *  makes "submit entry.indicator" a storable, never-firing alert. */
const ADX_GROUPED = {
  indicator: 'adx',
  label: 'ADX / DMI',
  conditions: LEVEL,
  default_threshold: 25,
  plots: [
    { value: 'adx.adx', label: 'ADX', conditions: LEVEL, default_threshold: 25 },
    { value: 'adx.plusDI', label: '+DI', conditions: LEVEL, default_threshold: null },
    {
      value: 'adx.minusDI',
      label: '−DI',
      conditions: [{ value: 'cross_zero', label: 'Crosses zero line', needs_threshold: false }],
      default_threshold: null,
    },
  ],
}

describe('IndicatorAlertPopover — naming a PLOT, not just an indicator', () => {
  it('offers the served plots, and only when there is a choice to make', () => {
    mockCatalog([...RSI_ONLY, ADX_GROUPED])
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    // RSI is single-plot: a one-option "Plot" dropdown would be pure noise.
    expect(screen.queryByLabelText('Plot')).toBeNull()

    fireEvent.change(screen.getByLabelText('Indicator'), { target: { value: 'adx' } })
    expect(optionValues('Plot')).toEqual(['adx.adx', 'adx.plusDI', 'adx.minusDI'])
  })

  it('⭐ submits the PLOT ADDRESS, never the group id that cannot be evaluated', async () => {
    mockCatalog([...RSI_ONLY, ADX_GROUPED])
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Indicator'), { target: { value: 'adx' } })
    fireEvent.change(screen.getByLabelText('Plot'), { target: { value: 'adx.plusDI' } })
    fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0]).toEqual({
      sym: 'AAPL', indicator: 'adx.plusDI', condition: 'above', tf: 'D', threshold: 30,
    })
    // …and NOT the group id, which the evaluator has no value function for.
    expect(H.created[0].indicator).not.toBe('adx')
  })

  it('a grouped indicator opens on its FIRST plot, and switching indicator re-seeds it', async () => {
    mockCatalog([...RSI_ONLY, ADX_GROUPED])
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Indicator'), { target: { value: 'adx' } })
    expect(screen.getByLabelText('Plot').value).toBe('adx.adx')
    // Move off plots[0], then leave and come back: the stale plot must not
    // survive, or the form would submit an address from another indicator.
    fireEvent.change(screen.getByLabelText('Plot'), { target: { value: 'adx.minusDI' } })
    fireEvent.change(screen.getByLabelText('Indicator'), { target: { value: 'rsi' } })
    expect(screen.queryByLabelText('Plot')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0].indicator).toBe('rsi')
  })

  it('conditions and the default threshold come from the SELECTED PLOT, not the entry', () => {
    mockCatalog([ADX_GROUPED])
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    // plots[0] declares 25 — deliberately also the entry-level default, so this
    // half alone cannot tell the two apart…
    expect(screen.getByLabelText('Threshold').value).toBe('25')
    expect(optionValues('Condition')).toEqual(['above', 'cross_below'])

    // …which is what the next plot is for: a DIFFERENT default and a DIFFERENT
    // condition list. Reading the entry would leave both stale.
    fireEvent.change(screen.getByLabelText('Plot'), { target: { value: 'adx.plusDI' } })
    expect(screen.getByLabelText('Threshold').value).toBe('')

    fireEvent.change(screen.getByLabelText('Plot'), { target: { value: 'adx.minusDI' } })
    expect(optionValues('Condition')).toEqual(['cross_zero'])
    // cross_zero takes no threshold, so the field goes away entirely.
    expect(screen.queryByLabelText('Threshold')).toBeNull()
  })

  it('⭐ a stored PLOT-ADDRESS alert is labelled from its plot and is NOT flagged dead', () => {
    // The regression that a naive lookup makes: keying the "can this fire?"
    // check on `entry.indicator` reports every grouped alert as un-evaluatable,
    // because `adx.plusDI` is not `adx`.
    mockCatalog([...RSI_ONLY, ADX_GROUPED])
    H.alerts = [
      { id: 1, sym: 'AAPL', indicator: 'adx.plusDI', condition: 'above', threshold: 30, tf: 'D', active: 1, trigger_count: 0 },
      { id: 2, sym: 'AAPL', indicator: 'sar', condition: 'above', threshold: 1, tf: 'D', active: 1, trigger_count: 0 },
    ]
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.getByText(/^\+DI Above threshold/)).toBeTruthy()
    // Exactly one row is dead — `sar`, which is deliberately not offered.
    expect(screen.getAllByText(/cannot fire/i)).toHaveLength(1)
    expect(screen.getByText(/^sar above/)).toBeTruthy()
  })
})

// ─── THE SOURCE PROBE ───────────────────────────────────────────────────────
//
// Absence is not behaviourally observable: a hardcoded fallback list would sit
// dormant behind the error branch and every case above would still pass. So the
// literals are asserted GONE from the shipped source.
//
// ⚠️ AND THE PROBE PROVES ITSELF FIRST. A regex that matches nothing reports a
// clean file exactly as loudly as one that matches nothing because it is broken.
// `POSITIVE_CONTROL` carries each retired literal verbatim; every pattern must
// find it there EXACTLY ONCE before the zero-match claim is allowed to mean
// anything.

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`IndicatorAlertPopover probe: could not find the repo root from ${process.cwd()}`)
})()

/** The five literals this task retired, as CODE SHAPES. Never a bare name — the
 *  component header EXPLAINS that INDICATORS and CONDITIONS are gone, and a bare
 *  `includes('CONDITIONS')` would find the explanation and report a regression. */
const RETIRED_LITERALS = [
  { name: 'INDICATORS', re: /const\s+INDICATORS\s*=\s*\[/g },
  { name: 'OSCILLATOR_CONDITIONS', re: /const\s+OSCILLATOR_CONDITIONS\s*=\s*\[/g },
  { name: 'CONDITIONS', re: /const\s+CONDITIONS\s*=\s*\{/g },
  { name: 'THRESHOLD_CONDITIONS', re: /const\s+THRESHOLD_CONDITIONS\s*=\s*new\s+Set\(/g },
  { name: 'INDICATOR_LABELS', re: /const\s+INDICATOR_LABELS\s*=\s*/g },
]

const POSITIVE_CONTROL = [
  'const INDICATORS = [',
  'const OSCILLATOR_CONDITIONS = [',
  'const CONDITIONS = {',
  "const THRESHOLD_CONDITIONS = new Set(['above'])",
  'const INDICATOR_LABELS = Object.fromEntries(',
].join('\n')

const countIn = (src, re) => (src.match(new RegExp(re.source, 'g')) || []).length

describe('the five literals the alert popover used to hand-write are GONE', () => {
  it('the probe finds each one when it IS there — a zero-match claim from a broken regex is worthless', () => {
    expect(
      Object.fromEntries(RETIRED_LITERALS.map(r => [r.name, countIn(POSITIVE_CONTROL, r.re)])),
      'a retired-literal pattern no longer matches the literal it names. Fix the pattern; ' +
      'a probe that cannot see the thing it forbids reports every file as clean.',
    ).toEqual({
      INDICATORS: 1, OSCILLATOR_CONDITIONS: 1, CONDITIONS: 1,
      THRESHOLD_CONDITIONS: 1, INDICATOR_LABELS: 1,
    })
  })

  it('and none of them is in the shipped popover', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'app/src/components/chart/IndicatorAlertPopover.jsx'), 'utf8',
    )
    const back = RETIRED_LITERALS.filter(r => countIn(src, r.re) > 0).map(r => r.name)
    expect(back,
      'a hand-written indicator/condition list is back in IndicatorAlertPopover.jsx. It would be ' +
      'a TWIN of indicator_alert_evaluator.INDICATOR_FUNCS — which is what let a `vwap` alert be ' +
      'created that can never fire. The catalog is served: GET /api/indicator-alerts/catalog.',
    ).toEqual([])
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// PHASE C TASK 10 — SPEC §8: THE INSTANCE, ON THE SURFACE.
// ═══════════════════════════════════════════════════════════════════════════

const RSI_WITH_INPUTS = [{
  indicator: 'rsi',
  label: 'RSI',
  conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
  default_threshold: 70,
  plots: [{
    value: 'rsi',
    label: 'RSI',
    instance_label: 'RSI(14)',
    inputs: { period: 14 },
    conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
    default_threshold: 70,
  }],
}]

const VWAP_NO_DEFAULT = [{
  indicator: 'vwap',
  label: 'VWAP',
  conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
  default_threshold: null,
  plots: [{
    value: 'vwap',
    label: 'VWAP',
    instance_label: 'VWAP',
    inputs: {},
    conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
    default_threshold: null,
  }],
}]

describe('spec §8 — an alert names its INSTANCE', () => {
  it('⭐ submits the instance, so RSI(7) and RSI(14) are two different alerts', async () => {
    H.catalog = { catalog: RSI_WITH_INPUTS, isLoading: false, error: null }
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)

    // The knob is rendered FROM THE SERVED PLOT, seeded with its default.
    const period = await screen.findByLabelText('period input')
    expect(period.value).toBe('14')

    fireEvent.change(period, { target: { value: '7' } })
    fireEvent.click(screen.getByText('Add Alert'))
    await waitFor(() => expect(H.created).toHaveLength(1))

    // ⛔ THE PAYLOAD CARRIES THE PARAMS. Before this shipped the popover sent
    // none at all, so every alert a user could create was on the DEFAULT
    // instance and the spec's two sentences were literally unrepresentable.
    expect(H.created[0].params).toEqual({ period: 7 })
    expect(H.created[0].indicator).toBe('rsi')
  })

  it('renders no knob for an address that declares none', async () => {
    H.catalog = { catalog: VWAP_NO_DEFAULT, isLoading: false, error: null }
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    await screen.findByLabelText('Condition')
    expect(screen.queryByLabelText('period input')).toBeNull()
    fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('Add Alert'))
    await waitFor(() => expect(H.created).toHaveLength(1))
    // …and no empty `params` object is invented for it.
    expect(H.created[0].params).toBeUndefined()
  })

  it('⭐ prefills the threshold from the CURRENT VALUE where no default is declared', async () => {
    H.currentValue = 187.4321
    H.catalog = { catalog: VWAP_NO_DEFAULT, isLoading: false, error: null }
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)

    const box = await screen.findByLabelText('Threshold')
    await waitFor(() => expect(box.value).toBe('187.4321'))
    // …and it asked the server for THIS plot on THIS symbol, not for something else.
    expect(H.valueCalls.at(-1)).toMatchObject({ sym: 'AAPL', indicator: 'vwap' })
  })

  it('⛔ does NOT overwrite a declared default — RSI stays 70, not "RSI right now"', async () => {
    H.currentValue = 43.2
    H.catalog = { catalog: RSI_WITH_INPUTS, isLoading: false, error: null }
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)

    const box = await screen.findByLabelText('Threshold')
    expect(box.value).toBe('70')
    // The declared defaults are CONVENTIONAL LEVELS (RSI 70, ADX 25). Replacing
    // one with the live reading removes the meaning from the box — so the
    // prefill must not even ask.
    await waitFor(() => expect(box.value).toBe('70'))
    expect(H.valueCalls).toEqual([])
  })

  it('names the instance in the alert ROW, from the server', async () => {
    H.catalog = { catalog: RSI_WITH_INPUTS, isLoading: false, error: null }
    H.alerts = [{
      id: 1, sym: 'AAPL', indicator: 'rsi', condition: 'above', threshold: 70,
      tf: 'D', active: true, trigger_count: 0, created_at: 1,
      instance_label: 'RSI(7)',
    }]
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    // ⭐ SPEC §8 VERBATIM: "RSI(7) crossed 70" vs "RSI(14)". The label is
    // computed server-side from the row's own `params_json`, so the name a user
    // reads and the number that fired come from the same field.
    expect(await screen.findByText(/RSI\(7\)/)).toBeTruthy()
  })

  it('says so when the chart instance the alert was armed from is GONE', async () => {
    H.catalog = { catalog: RSI_WITH_INPUTS, isLoading: false, error: null }
    H.alerts = [{
      id: 1, sym: 'AAPL', indicator: 'rsi', condition: 'above', threshold: 70,
      tf: 'D', active: true, trigger_count: 0, created_at: 1,
      instance_label: 'RSI(7)', instance_missing: true,
    }]
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(await screen.findByText(/was removed/)).toBeTruthy()
    // ⛔ AND IT IS NOT REPORTED AS DEAD. It keeps evaluating from the inputs it
    // recorded; conflating "the binding is stale" with "this can never fire" is
    // the opposite error and would tell a user to delete a working alert.
    expect(screen.queryByText(/no longer evaluated/)).toBeNull()
  })

  it('⛔ CONTROL: a bound alert shows neither message', async () => {
    H.catalog = { catalog: RSI_WITH_INPUTS, isLoading: false, error: null }
    H.alerts = [{
      id: 1, sym: 'AAPL', indicator: 'rsi', condition: 'above', threshold: 70,
      tf: 'D', active: true, trigger_count: 0, created_at: 1,
      instance_label: 'RSI(14)', instance_missing: false,
    }]
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    await screen.findByText(/RSI\(14\)/)
    expect(screen.queryByText(/was removed/)).toBeNull()
    expect(screen.queryByText(/no longer evaluated/)).toBeNull()
  })
})
