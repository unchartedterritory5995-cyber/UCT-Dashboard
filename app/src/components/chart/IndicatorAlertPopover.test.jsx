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
}))

vi.mock('../../hooks/useIndicatorAlerts', () => ({
  useIndicatorAlerts: () => ({ alerts: H.alerts, isLoading: false, refresh: () => {} }),
  useIndicatorAlertCatalog: () => H.catalog,
  createIndicatorAlert: (payload) => { H.created.push(payload); return Promise.resolve({ id: 1 }) },
  deleteIndicatorAlert: () => {},
  toggleIndicatorAlert: () => {},
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
