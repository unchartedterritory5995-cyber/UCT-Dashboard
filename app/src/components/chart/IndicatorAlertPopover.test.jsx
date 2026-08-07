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
  // What `createIndicatorAlert` answers. It is `{ok, id} | {ok, error}` now, not
  // `null | {id}` — see the hook's own docstring. A test that wants the refusal
  // path sets this; everything else runs on the accepted answer.
  createResult: { ok: true, id: 1 },
}))

vi.mock('../../hooks/useIndicatorAlerts', () => ({
  useIndicatorAlerts: () => ({ alerts: H.alerts, isLoading: false, refresh: () => {} }),
  useIndicatorAlertCatalog: () => H.catalog,
  createIndicatorAlert: (payload) => { H.created.push(payload); return Promise.resolve(H.createResult) },
  deleteIndicatorAlert: () => {},
  toggleIndicatorAlert: () => {},
  // ⭐ SPEC §8's threshold prefill. `H.currentValue` defaults to null, which is
  // "no answer for this symbol yet" — the state every existing case here ran
  // in, so none of them changes meaning. The prefill's own cases set it.
  fetchCurrentValue: (args) => { H.valueCalls.push(args); return Promise.resolve(H.currentValue) },
}))

import IndicatorAlertPopover from './IndicatorAlertPopover'
import { NATIVE_TFS, tfLabel } from './timeframes'

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
  H.createResult = { ok: true, id: 1 }
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

// ─── SPEC §8: THE ALERT NAMES THE INSTANCE (Phase C Task 15) ────────────────
//
// Task 10 shipped the `instance_id` column, the API field, the label and the
// deletion guard and reported that they had NO PRODUCER: the only surface that
// could supply a chart instance is this popover, and it is mounted from
// `StockChart.jsx` -> `ChartToolbar.jsx`. Task 12 re-measured the hand-back and
// found the naive bridge (`address === defId`) lies for two of fourteen groups.
// This is the producer, and these are the cases that stop it lying again.
describe('IndicatorAlertPopover — which chart INSTANCE the alert names', () => {
  const inst = (instanceId, defId, inputs) => ({ instanceId, defId, inputs })

  it('sends NO instance_id when the chart passes nothing — every legacy row is this row', async () => {
    mockCatalog(RSI_ONLY)
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0]).not.toHaveProperty('instance_id')
    // ⛔ …AND THAT ABSENCE IS CHECKED THROUGH REAL JSON. `JSON.stringify` DROPS
    // an `undefined` value, so a payload carrying `instance_id: undefined` would
    // satisfy a naive `toBeUndefined()` while being indistinguishable on the
    // wire from one that omits the key. This branch has shipped exactly that
    // fixture once, so the round-trip is the assertion.
    expect(Object.keys(JSON.parse(JSON.stringify(H.created[0])))).not.toContain('instance_id')
  })

  it('⭐ adopts the ONE instance this chart draws, with no picker to answer', async () => {
    mockCatalog(RSI_ONLY)
    render(
      <IndicatorAlertPopover
        sym="AAPL"
        onClose={() => {}}
        chartInstances={[inst('rsi-1', 'rsi', { period: 14 })]}
      />,
    )
    // One instance is not a choice, so no control is rendered for it.
    expect(screen.queryByLabelText('Instance')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0].instance_id).toBe('rsi-1')
  })

  it('⭐ TWO instances is a QUESTION, not a guess — spec §8s two RSIs', async () => {
    mockCatalog(RSI_ONLY)
    render(
      <IndicatorAlertPopover
        sym="AAPL"
        onClose={() => {}}
        chartInstances={[inst('rsi-7', 'rsi', { period: 7 }), inst('rsi-14', 'rsi', { period: 14 })]}
      />,
    )
    expect(optionValues('Instance')).toEqual(['rsi-7', 'rsi-14'])
    fireEvent.change(screen.getByLabelText('Instance'), { target: { value: 'rsi-14' } })
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0].instance_id).toBe('rsi-14')
  })

  it('⛔ an address that names NO definition carries no instance, even when the chart is full', async () => {
    // `price_vs_ma` is a spread this lane synthesises; there is no such chart
    // indicator, so there is nothing honest to name. The chart deliberately
    // DOES draw something, so the empty answer is about the address.
    mockCatalog([{
      indicator: 'price_vs_ma',
      label: 'Price vs MA',
      conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
      default_threshold: 0,
    }])
    render(
      <IndicatorAlertPopover
        sym="AAPL"
        onClose={() => {}}
        chartInstances={[inst('rsi-1', 'rsi', { period: 14 })]}
      />,
    )
    expect(screen.queryByLabelText('Instance')).toBeNull()
    fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0].indicator).toBe('price_vs_ma')
    expect(Object.keys(JSON.parse(JSON.stringify(H.created[0])))).not.toContain('instance_id')
  })

  it('⛔ switching to an indicator this chart does not draw CLEARS the id it had', async () => {
    mockCatalog([...RSI_ONLY, ADX_GROUPED])
    render(
      <IndicatorAlertPopover
        sym="AAPL"
        onClose={() => {}}
        chartInstances={[inst('rsi-1', 'rsi', { period: 14 })]}
      />,
    )
    fireEvent.change(screen.getByLabelText('Indicator'), { target: { value: 'adx' } })
    fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0].indicator).toBe('adx.adx')
    // …a stale `rsi-1` here would attach an ADX alert to an RSI instance, and
    // deleting that RSI would then report the ADX alert as orphaned.
    expect(Object.keys(JSON.parse(JSON.stringify(H.created[0])))).not.toContain('instance_id')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TASK 8 — "ADD ALERT" STOPPED FAILING SILENTLY.
// ═══════════════════════════════════════════════════════════════════════════
//
// MEASURED BEFORE THE FIX (2026-08-06, the shipped createIndicatorAlert driven
// by a real 400 inside the shipped popover):
//
//   createIndicatorAlert(400 with detail) -> null
//   the message survives in the return value?  false
//   role="alert" nodes after clicking Add Alert: 0
//   full popover text: "…Add AlertActive alerts for SPY (0)No alerts on this
//                       symbol yet."     ← no reason, anywhere
//
// The create path had THREE refusals to say (`_PRICE_ALIASES`,
// `value_function(address) is None`, `ias.refusal_for`) and the user saw the
// button flicker. The message quoted below is `refusal_for('vwap','above','D')`
// VERBATIM — and `D` is a timeframe the popover already offered, so this was a
// refusal a user could provoke on the shipped build and never read.

/** The REAL refusal, quoted from `indicator_alert_service.refusal_for`
 *  (measured 2026-08-06). It is deliberately a sentence NO client code could
 *  invent: if the component ever paraphrases instead of quoting, the exact
 *  equality below stops holding. */
const SERVER_REFUSAL =
  'VWAP is only defined on an intraday timeframe. A D bar is stored under a ' +
  'calendar date where this series needs a clock instant, so its whole column is ' +
  'withheld and no number is ever produced. Arm it on one of 1, 15, 30, 5, 60.'

describe('Task 8 — a refused Add Alert says WHY', () => {
  it('⭐ shows the server\'s refusal, word for word', async () => {
    mockCatalog(RSI_ONLY)
    H.createResult = { ok: false, error: SERVER_REFUSAL }
    render(<IndicatorAlertPopover sym="SPY" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))

    const box = await screen.findByRole('alert')
    // ⛔ EQUALITY, NOT `toContain`. A client-side paraphrase beside the server's
    // sentence would be a SECOND source of truth for one refusal, and the two
    // rot apart the first time the backend rewords. What the server said is
    // what the user reads.
    expect(box.textContent).toBe(SERVER_REFUSAL)
  })

  it('⛔ CONTROL: an ACCEPTED alert shows no refusal at all', async () => {
    mockCatalog(RSI_ONLY)
    render(<IndicatorAlertPopover sym="SPY" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    // A banner that is always there says nothing. This is the case that makes
    // the one above mean something.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a SUCCESS clears the refusal the previous attempt left on screen', async () => {
    mockCatalog(RSI_ONLY)
    H.createResult = { ok: false, error: SERVER_REFUSAL }
    render(<IndicatorAlertPopover sym="SPY" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await screen.findByRole('alert')

    // …the user fixes it and tries again.
    H.createResult = { ok: true, id: 7 }
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(2))
    // A stale refusal sitting over a succeeded alert is the same lie the
    // silence was, pointing the other way.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

// ─── THE HOOK: WHAT THE SERVER SAID, AND WHO SAID IT ────────────────────────
//
// The component only renders `res.error`; WHICH sentence that is, is decided in
// `useIndicatorAlerts.createIndicatorAlert`. These cases drive the REAL exported
// function (`vi.importActual` — the module is mocked for everything above) with
// a stubbed `fetch`, because a mock of the thing under test proves nothing.

/** The real, unmocked module — everything above runs against the vi.mock. */
const realHook = () => vi.importActual('../../hooks/useIndicatorAlerts')

describe('createIndicatorAlert — the response reaches the caller', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const stubFetch = (impl) => { vi.stubGlobal('fetch', vi.fn(impl)) }

  it('⭐ a 400 hands back the server\'s detail, not null', async () => {
    stubFetch(async () => ({ ok: false, status: 400, json: async () => ({ detail: SERVER_REFUSAL }) }))
    const { createIndicatorAlert } = await realHook()
    // ⛔ THIS IS THE SWALLOW. It used to `return null` here and the sentence
    // above — one of three the create path writes — reached nobody.
    expect(await createIndicatorAlert({ sym: 'SPY' }))
      .toEqual({ ok: false, error: SERVER_REFUSAL })
  })

  /** The sentence an answer carries, or a sentinel for one that carries none.
   *
   *  ⚠️ DELIBERATELY TOLERANT OF A SHAPELESS ANSWER, so that the case below
   *  asserts ONE thing: that the two failures do not read alike. Whether every
   *  branch returns a shaped object at all is a different claim owned by its own
   *  cases ("never null, on any branch" and "a 400 hands back the server's
   *  detail") — and measured: without this, restoring the swallow ALSO tripped
   *  this case, so the disjointness assertion had no failure of its own. */
  const messageOf = (res) => (res && typeof res.error === 'string' ? res.error : '(no message)')

  it('⭐ a NETWORK failure says something DIFFERENT from a refusal', async () => {
    const { createIndicatorAlert } = await realHook()

    stubFetch(async () => { throw new TypeError('Failed to fetch') })
    const network = await createIndicatorAlert({ sym: 'SPY' })
    expect(network.ok).toBe(false)
    expect(network.error).toMatch(/could not reach/i)

    // ⛔ THE TWO MUST NOT READ ALIKE. "try again in a moment" and "this alert
    // can never fire" are opposite instructions; one string for both sends the
    // user to the wrong fix — retrying forever on an alert that is structurally
    // mute, or abandoning one that would have worked on the next attempt.
    stubFetch(async () => ({ ok: false, status: 400, json: async () => ({ detail: SERVER_REFUSAL }) }))
    const spoken = await createIndicatorAlert({ sym: 'SPY' })
    expect(messageOf(network)).not.toBe(messageOf(spoken))

    // …and against the OTHER refusal, the one this module writes ITSELF when the
    // server refuses with an unreadable body. That is the pair a single generic
    // "could not create this alert" would collapse — the detail-bearing case
    // above cannot catch it, because the server's own words are never at risk.
    stubFetch(async () => ({ ok: false, status: 503, json: async () => { throw new SyntaxError('not JSON') } }))
    const mute = await createIndicatorAlert({ sym: 'SPY' })
    expect(messageOf(network)).not.toBe(messageOf(mute))
  })

  it('a refusal with no readable body still says the server refused it', async () => {
    stubFetch(async () => ({ ok: false, status: 503, json: async () => { throw new SyntaxError('not JSON') } }))
    const { createIndicatorAlert } = await realHook()
    const res = await createIndicatorAlert({ sym: 'SPY' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/503/)
  })

  it('⛔ a 422 whose `detail` is FastAPI\'s validation LIST never renders as [object Object]', async () => {
    // Pydantic answers a malformed body with `detail: [{loc, msg, type}, …]`.
    // Interpolating that into the banner shows the user "[object Object]",
    // which is worse than the silence it replaced.
    stubFetch(async () => ({
      ok: false, status: 422,
      json: async () => ({ detail: [{ loc: ['body', 'tf'], msg: 'field required' }] }),
    }))
    const { createIndicatorAlert } = await realHook()
    const res = await createIndicatorAlert({ sym: 'SPY' })
    expect(res.ok).toBe(false)
    expect(res.error).not.toContain('object Object')
    expect(res.error).toMatch(/422/)
  })

  it('⛔ CONTROL: an accepted alert answers ok with its id', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ id: 42 }) }))
    const { createIndicatorAlert } = await realHook()
    expect(await createIndicatorAlert({ sym: 'SPY' })).toEqual({ ok: true, id: 42 })
  })

  it('⛔ never null, on any branch — the caller reads `.ok` unconditionally', async () => {
    const branches = [
      async () => ({ ok: true, status: 200, json: async () => ({ id: 1 }) }),
      async () => ({ ok: false, status: 400, json: async () => ({ detail: 'nope' }) }),
      async () => ({ ok: false, status: 503, json: async () => { throw new Error('html') } }),
      async () => { throw new TypeError('Failed to fetch') },
    ]
    const { createIndicatorAlert } = await realHook()
    for (const impl of branches) {
      stubFetch(impl)
      const res = await createIndicatorAlert({ sym: 'SPY' })
      expect(res, 'a branch returned null — the popover would crash on res.ok').toBeTruthy()
      expect(typeof res.ok).toBe('boolean')
    }
  })
})

// ─── EVERY TIMEFRAME THE CHART OFFERS ───────────────────────────────────────
//
// MEASURED BEFORE THE FIX: the popover offered ["5","15","30","60","D"] while
// the chart offered ["1","5","15","30","60","D","W","M"] — so a user on a
// weekly chart could not set an alert on what they were looking at, and a
// 1-minute chart likewise.
//
// ⛔ THE LIST IS DERIVED FROM `timeframes.NATIVE_TFS`, IN BOTH THE COMPONENT AND
// THIS TEST. Typing ['1','5',…] here would let the two drift apart again, which
// IS the defect.

describe('Task 8 — the alert dropdown offers every timeframe the chart does', () => {
  it('⭐ offers exactly NATIVE_TFS, in the chart\'s own order', () => {
    mockCatalog(RSI_ONLY)
    render(<IndicatorAlertPopover sym="SPY" onClose={() => {}} />)
    expect(optionValues('Timeframe')).toEqual(NATIVE_TFS)
  })

  it('and labels them through the chart\'s own `tfLabel`, not a second table', () => {
    mockCatalog(RSI_ONLY)
    render(<IndicatorAlertPopover sym="SPY" onClose={() => {}} />)
    const labels = [...screen.getByLabelText('Timeframe').options].map(o => o.textContent)
    expect(labels).toEqual(NATIVE_TFS.map(tfLabel))
    // …and that is genuinely a mapping, not identity: '60' reads '1h', 'D' reads '1D'.
    expect(labels).not.toEqual(NATIVE_TFS)
  })

  it('the default timeframe is one the dropdown actually offers', () => {
    mockCatalog(RSI_ONLY)
    render(<IndicatorAlertPopover sym="SPY" onClose={() => {}} />)
    const tf = screen.getByLabelText('Timeframe')
    expect(NATIVE_TFS).toContain(tf.value)
  })
})

// ─── …AND THE BACKEND KNOWS ALL EIGHT ───────────────────────────────────────
//
// Offering a timeframe the server refuses would turn defect 2 back into defect
// 1 with extra steps. The evaluator's per-timeframe table is
// `_TF_SECONDS` in `api/routers/indicator_alerts.py` — the ONLY enumeration of
// timeframes on the alert path — and this asserts the two vocabularies are the
// SAME SET rather than trusting a comment.
//
// (End-to-end, 2026-08-06: the create path's three gates were run over all 31
// catalog addresses × all 8 codes. Refusals: ZERO on 1/5/15/30/60, and exactly
// `vwap` on D, W and M — the intraday-only rule, which `D` already carried
// before this task widened anything. No timeframe is refused as a timeframe.)

const TF_SECONDS_KEYS = (src) => {
  const block = src.match(/_TF_SECONDS\s*=\s*\{([\s\S]*?)\}/)
  return block ? [...block[1].matchAll(/"([^"]+)"\s*:/g)].map(m => m[1]) : null
}

describe('the alert timeframe vocabulary is ONE vocabulary', () => {
  it('the parser finds the keys when they ARE there — a null claim from a broken regex is worthless', () => {
    const CONTROL = '_TF_SECONDS = {"1": 60, "5": 300,\n               "D": 86_400}\n_CYCLE_SECONDS = 60'
    expect(TF_SECONDS_KEYS(CONTROL)).toEqual(['1', '5', 'D'])
    expect(TF_SECONDS_KEYS('nothing here')).toBeNull()
  })

  it('⭐ every code the popover now offers is a code the alert router knows', () => {
    const src = fs.readFileSync(path.join(ROOT, 'api/routers/indicator_alerts.py'), 'utf8')
    const keys = TF_SECONDS_KEYS(src)
    expect(keys, '_TF_SECONDS could not be read from api/routers/indicator_alerts.py').toBeTruthy()
    expect(new Set(keys), 'the chart\'s timeframes and the alert router\'s are no longer the same set — ' +
      'offering one the server does not know is how "Add Alert" starts failing silently again')
      .toEqual(new Set(NATIVE_TFS))
  })
})
