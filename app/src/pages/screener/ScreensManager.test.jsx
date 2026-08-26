import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

// ScreensManager.test.jsx — the mount rail's "hook is mocked here" record for
// `ScreensManager`, the current owner of the screens menu + share panel
// (screenSharing.mount.test.jsx points at THIS file; the deleted
// SaveScreenBar's test held that role before the Wave-4 supersession). Both
// data sources are mocked at the component level: `useSavedScreens` (screen
// specs) and `useUserDefinitions` (formula definitions, filtered through the
// REAL `scannableScreens`).

const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()

const savedScreensState = {
  saved: [{ id: 9, name: 'My RSI', spec: { view: 'technical' }, is_public: false, share_token: null }],
  starters: [{ id: 's1', name: 'Oversold', spec: { view: 'overview' } }],
  error: null,
}
vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({ ...savedScreensState, create, update, remove }),
}))

const SCANNABLE_ROW = {
  def_id: 'u_breakout', ast_hash: 'sha256:aaa',
  definition: { compute: { kind: 'ast', fn: 'sha256:aaa', ast: { op: '>' } }, meta: { name: 'Breakout base' } },
}
// `refresh` is the store's own revalidation, called by the authoring door's
// `onSaved` (W4a.5). Stubbed here so the manager can destructure it; the door
// itself is `ScreensManager.door.test.jsx`'s subject.
const refreshDefs = vi.fn()
const userDefinitionsState = { rows: [SCANNABLE_ROW], error: null, refresh: refreshDefs }
vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => userDefinitionsState,
}))

// The definition detail (Task 6). Mocked at the manager-test level per the
// brief — the REAL wire (`ScanResults` actually rendering `CoverageLine` off
// a live fetch) is `Screener.scanmount.test.jsx`'s job, re-targeted here in
// Task 7. This spy exists only to assert the PROPS the manager hands it.
const ScanResultsSpy = vi.fn()
vi.mock('../../components/screener/ScanResults', () => ({
  default: (props) => { ScanResultsSpy(props); return <div data-testid="scan-results-mock" /> },
}))

// ⭐ `RunNowButton` is NOT mocked — it is the thing under test on this wire, and
// a spy in its place would keep every case below green while the run-now door
// went nowhere (the defect class `reachable.test.js` exists for). Only its DATA
// source is stubbed: `useScreenerMeta` is an SWR hook and the member's lists are
// server-minted, so the fixture here is one `filters[key='list']` entry.
const META = vi.hoisted(() => ({ meta: null, isLoading: false }))
vi.mock('./hooks/useScreenerMeta', () => ({
  default: () => META, META_KEY: '/api/screener/meta',
}))

import ScreensManager from './ScreensManager'
import { defaultSession } from '../../components/screener/scanSession'

beforeEach(() => {
  create.mockClear(); update.mockClear(); remove.mockClear()
  ScanResultsSpy.mockClear()
  META.meta = { filters: [] }
  savedScreensState.saved = [{ id: 9, name: 'My RSI', spec: { view: 'technical' }, is_public: false, share_token: null }]
  savedScreensState.starters = [{ id: 's1', name: 'Oversold', spec: { view: 'overview' } }]
  savedScreensState.error = null
  userDefinitionsState.rows = [SCANNABLE_ROW]
  userDefinitionsState.error = null
})

const open = () => fireEvent.click(screen.getByText('Screens ▾'))

test('applies a starter spec on click', () => {
  const onApply = vi.fn()
  render(<ScreensManager currentSpec={{}} onApply={onApply} onUseScan={vi.fn()} />)
  open()
  fireEvent.click(screen.getByText('Oversold'))
  expect(onApply).toHaveBeenCalledWith({ view: 'overview' })
})

test('saves the current spec under a typed name', () => {
  render(<ScreensManager currentSpec={{ filters: [] }} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  fireEvent.change(screen.getByPlaceholderText('Name this screen…'), { target: { value: 'Breakouts' } })
  fireEvent.click(screen.getByText('Save current'))
  expect(create).toHaveBeenCalledWith('Breakouts', { filters: [] })
})

test('both sections are type-badged — SCREEN and SCAN', () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(screen.getByText('SCREEN')).toBeInTheDocument()
  expect(screen.getByText('SCAN')).toBeInTheDocument()
})

test('publishing a private screen sends is_public true', async () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Share My RSI' }))
  fireEvent.click(screen.getByRole('button', { name: /publish a share link/i }))
  expect(update).toHaveBeenCalledWith(9, { is_public: true })
})

test('unpublishing a public screen sends is_public false, and the link is shown', () => {
  savedScreensState.saved = [{ id: 9, name: 'My RSI', spec: {}, is_public: true, share_token: 'tok123' }]
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Share My RSI' }))
  expect(screen.getByTestId('share-panel-9')).toBeInTheDocument()
  expect(screen.getByLabelText('Share link for My RSI')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /unpublish/i }))
  expect(update).toHaveBeenCalledWith(9, { is_public: false })
})

test('rename and delete fan out to useSavedScreens', () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Rename My RSI' }))
  const input = screen.getByDisplayValue('My RSI')
  fireEvent.change(input, { target: { value: 'Renamed' } })
  fireEvent.keyDown(screen.getByDisplayValue('Renamed'), { key: 'Enter' })
  expect(update).toHaveBeenCalledWith(9, { name: 'Renamed' })

  fireEvent.click(screen.getByRole('button', { name: 'Delete My RSI' }))
  expect(remove).toHaveBeenCalledWith(9)
})

test('use-as-filter calls onUseScan with (hash, name)', () => {
  const onUseScan = vi.fn()
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={onUseScan} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Use Breakout base as filter' }))
  expect(onUseScan).toHaveBeenCalledWith('sha256:aaa', 'Breakout base')
})

test('a non-scannable definition never shows a Use-as-filter row', () => {
  userDefinitionsState.rows = [{
    def_id: 'u_indicator', ast_hash: 'sha256:bbb',
    definition: { compute: { kind: 'ast', fn: 'sha256:bbb', ast: null }, meta: { name: 'Just an indicator' } },
  }]
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(screen.queryByText('Just an indicator')).not.toBeInTheDocument()
  expect(screen.getByText('No scannable formulas yet')).toBeInTheDocument()
})

test('a refused saved-screens read renders the error testid, never "None saved yet"', () => {
  savedScreensState.saved = []
  savedScreensState.error = new Error('saved-screens 402')
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  // Suffixed per section so a screens-lane failure can never satisfy an
  // assertion aimed at the scans lane (and vice versa).
  expect(screen.getByTestId('screens-manager-error--screens')).toBeInTheDocument()
  expect(screen.queryByTestId('screens-manager-error--scans')).not.toBeInTheDocument()
  expect(screen.queryByText('None saved yet')).not.toBeInTheDocument()
})

test('a refused definitions read renders the error testid for the scans section', () => {
  userDefinitionsState.rows = []
  userDefinitionsState.error = new Error('user-definitions 402')
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(screen.getByTestId('screens-manager-error--scans')).toBeInTheDocument()
  expect(screen.queryByTestId('screens-manager-error--screens')).not.toBeInTheDocument()
  expect(screen.queryByText('No scannable formulas yet')).not.toBeInTheDocument()
})

test('clicking a scan row name mounts ScanResults with definition/asOf/tf', () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(ScanResultsSpy).not.toHaveBeenCalled()
  expect(screen.queryByTestId('scan-results-mock')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Breakout base' }))

  expect(screen.getByTestId('scan-results-mock')).toBeInTheDocument()
  expect(ScanResultsSpy).toHaveBeenCalledWith({
    definition: SCANNABLE_ROW.definition,
    asOf: defaultSession(),
    tf: 'D',
    // W4a: nothing has been run yet, so the mount reads the NIGHTLY receipt.
    payload: null,
  })
})

test('the session date input changes the asOf prop ScanResults receives', () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Breakout base' }))
  ScanResultsSpy.mockClear()

  fireEvent.change(screen.getByLabelText('Session'), { target: { value: '2026-01-02' } })

  expect(ScanResultsSpy).toHaveBeenCalledWith({
    definition: SCANNABLE_ROW.definition,
    asOf: '2026-01-02',
    tf: 'D',
    payload: null,
  })
})

// ─── 🔴 THE RUN-NOW WIRE (W4a.4) ────────────────────────────────────────────
//
// ⛔ THIS IS THE CASE THAT GOES RED WHEN THE WIRE IS CUT while both halves stay
// correct. `RunNowButton.test.jsx` asserts what the component SENDS and HANDS
// BACK; it stays green for the whole time `onResult` goes nowhere. Only a test
// that renders the manager and drives a real run can see the join.

const DONE_JOB = {
  job: 'r_7f3a9c21', state: 'done', tier: 'on-demand', def_id: 'u_breakout',
  tf: 'D', as_of: 20260821, submitted_at: 1, finished_at: 3,
  universe: { source: 'symbols', label: null, requested: 2, resolved: 2 },
  def_hash: 'sha256:aaa', rev: 1, freshness: 'fresh', cadence: null,
  mode: 'on-demand', persisted: false,
  hits: [{ symbol: 'NVDA', value: 1, bar_time: 20260821 }],
  coverage: {
    evaluated: 2, answered: 1, dropped: 1, not_computable: 0, withheld: 0,
    withheld_reason: null, dropped_symbols: [], dropped_listed: 1, truncated: false,
  },
}

const EXPECTED_PAYLOAD = {
  def_hash: 'sha256:aaa', tf: 'D', as_of: 20260821, status: 'evaluated',
  coverage: DONE_JOB.coverage, tickers: ['NVDA'], truncated: false, tier: 'on-demand',
}

/** Drive a real run through the real button: open the row, paste a symbol, Run. */
async function runNow(symbols = 'NVDA AMD') {
  fireEvent.click(screen.getByRole('button', { name: 'Breakout base' }))
  fireEvent.click(screen.getByRole('button', { name: 'Run Breakout base now' }))
  fireEvent.change(screen.getByLabelText('Symbols to run'), { target: { value: symbols } })
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
  await screen.findByTestId('run-now-done')
}

test("a finished run's payload reaches the ScanResults mount the manager already had", async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 202, json: async () => DONE_JOB })))
  try {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    open()
    await runNow()

    expect(ScanResultsSpy).toHaveBeenLastCalledWith({
      definition: SCANNABLE_ROW.definition,
      asOf: defaultSession(),
      tf: 'D',
      payload: EXPECTED_PAYLOAD,
    })
    // ⛔ ONE MOUNT. A second `ScanResults` for the on-demand answer would give
    // `CoverageLine` a second door and put two receipts on screen for one scan.
    expect(screen.getAllByTestId('scan-results-mock')).toHaveLength(1)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('⛔ changing the SESSION drops the run — that answer was for a different day', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 202, json: async () => DONE_JOB })))
  try {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    open()
    await runNow()
    ScanResultsSpy.mockClear()

    fireEvent.change(screen.getByLabelText('Session'), { target: { value: '2026-01-02' } })

    // Keeping it would caption Friday's hits with Monday's session — the exact
    // falsehood `ScanResults` clears its open chart to avoid.
    expect(ScanResultsSpy).toHaveBeenLastCalledWith({
      definition: SCANNABLE_ROW.definition, asOf: '2026-01-02', tf: 'D', payload: null,
    })
  } finally {
    vi.unstubAllGlobals()
  }
})

test('⛔ and a run belongs to the SCAN it was run for, never the next row opened', async () => {
  const OTHER = {
    def_id: 'u_other', ast_hash: 'sha256:ccc',
    definition: { compute: { kind: 'ast', fn: 'sha256:ccc', ast: { op: '<' } }, meta: { name: 'Other scan' } },
  }
  userDefinitionsState.rows = [SCANNABLE_ROW, OTHER]
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 202, json: async () => DONE_JOB })))
  try {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    open()
    await runNow()
    ScanResultsSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Other scan' }))

    expect(ScanResultsSpy).toHaveBeenLastCalledWith({
      definition: OTHER.definition, asOf: defaultSession(), tf: 'D', payload: null,
    })
  } finally {
    vi.unstubAllGlobals()
  }
})

test('the run-now door is only inside an OPEN scan detail', () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(screen.queryByRole('button', { name: 'Run Breakout base now' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Breakout base' }))
  expect(screen.getByRole('button', { name: 'Run Breakout base now' })).toBeInTheDocument()
})

// ─── 🔴 THE WAY BACK (W4a.5) ────────────────────────────────────────────────
//
// An on-demand run REPLACES the nightly answer under the same mount. Until the
// restore existed the only ways back were changing the session or closing the
// row — each of which throws away something else the member chose. The control
// is rendered by `RunNowButton` (beside the caption it retracts) and wired from
// here (where the run is held), so it is a JOIN: only a test that drives both
// halves can see it, exactly like the payload case above.

test('"Back to the nightly results" drops the held run and the nightly answer returns', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 202, json: async () => DONE_JOB })))
  try {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    open()
    await runNow()
    expect(ScanResultsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: EXPECTED_PAYLOAD }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to the nightly results' }))

    expect(ScanResultsSpy).toHaveBeenLastCalledWith({
      definition: SCANNABLE_ROW.definition, asOf: defaultSession(), tf: 'D', payload: null,
    })
    // ⛔ AND THE CAPTION GOES WITH IT. A "Showing on-demand results" line left
    // standing over the nightly answer is the identity lie the caption exists
    // to prevent, arriving from the other side.
    expect(screen.queryByTestId('run-now-done')).toBeNull()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('the restore is offered only ONCE a run is showing', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 202, json: async () => DONE_JOB })))
  try {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Breakout base' }))
    expect(screen.queryByRole('button', { name: 'Back to the nightly results' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Run Breakout base now' }))
    fireEvent.change(screen.getByLabelText('Symbols to run'), { target: { value: 'NVDA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await screen.findByTestId('run-now-done')
    expect(screen.getByRole('button', { name: 'Back to the nightly results' })).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})
