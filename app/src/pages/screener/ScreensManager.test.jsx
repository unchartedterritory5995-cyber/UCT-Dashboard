import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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
// ⭐ THE STORE'S OWN DELETE DOOR (W4a.6), spied rather than reimplemented. The
// manager must reach the SAME module `BuilderSheet` deletes through — a second
// door onto one object is how two callers end up disagreeing about what exists.
const deleteDefinition = vi.fn()
vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => userDefinitionsState,
  deleteUserDefinition: (...a) => deleteDefinition(...a),
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
  create.mockClear(); update.mockClear()
  // ⛔ X26 (W9c.1): `remove` is now AWAITED and its `{ok, error}` checked —
  // the same reset+default shape `deleteDefinition` already gets, so every
  // test starts from a clean, successful default rather than an unresolved
  // implicit-undefined mock.
  remove.mockReset()
  remove.mockResolvedValue({ ok: true })
  deleteDefinition.mockReset()
  deleteDefinition.mockResolvedValue({ ok: true })
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

test('rename fans out to useSavedScreens', () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Rename My RSI' }))
  const input = screen.getByDisplayValue('My RSI')
  fireEvent.change(input, { target: { value: 'Renamed' } })
  fireEvent.keyDown(screen.getByDisplayValue('Renamed'), { key: 'Enter' })
  expect(update).toHaveBeenCalledWith(9, { name: 'Renamed' })
  // ⛔ Delete is covered by its OWN suite below (X26 / W9c.1) — it is no
  // longer a one-click fan-out, so it does not belong in this test's name.
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

// ─── 🔴 DELETE — THE FIRST IRREVERSIBLE THING A MEMBER CAN DO HERE (W4a.6) ───
//
// Every other action on this surface is undoable by repeating it: publish /
// unpublish, arm / clear a run, open / close a row. Delete is not, and the trash
// sits two pixels from the pencil that EDITS. So the three claims below are the
// product, not decoration:
//
//   1. it ASKS FIRST, and the question NAMES the scan (never "this item");
//   2. a refusal is the STORE'S OWN SENTENCE, rendered once, with nothing this
//      component composed over it;
//   3. the row leaves when the STORE says it is gone — never optimistically,
//      because a row that vanishes and comes back is a lie told twice.
//
// ⛔ AND A DELETED SCAN'S ANSWERS GO WITH IT. Task 4 wired an on-demand run into
// this file and Task 5 wired the detail pane; either one left standing over a
// def_id the store has just destroyed is a member reading results for something
// that no longer exists.

const armDelete = () => fireEvent.click(screen.getByRole('button', { name: 'Delete Breakout base' }))
const confirmDelete = () => fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Breakout base' }))
const rowButton = () => screen.queryByRole('button', { name: 'Breakout base' })

test('Delete ASKS FIRST — arming sends nothing, and the question NAMES the scan', () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(screen.queryByTestId('delete-ask-u_breakout')).toBeNull()   // control: not armed
  armDelete()
  // ⛔ ASKING IS NOT DELETING.
  expect(deleteDefinition).not.toHaveBeenCalled()
  // ⛔ AND IT IS NAMED. "Delete this item?" over a menu of near-identical rows
  // is how a member destroys the wrong formula.
  expect(screen.getByTestId('delete-ask-u_breakout'))
    .toHaveTextContent('Delete “Breakout base”?')
  expect(rowButton()).toBeInTheDocument()
})

test('Keep disarms and sends nothing', async () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDelete()
  fireEvent.click(screen.getByRole('button', { name: 'Keep Breakout base' }))
  await waitFor(() => expect(screen.queryByTestId('delete-ask-u_breakout')).toBeNull())
  expect(deleteDefinition).not.toHaveBeenCalled()
  expect(rowButton()).toBeInTheDocument()
})

test("Confirm sends exactly ONE delete, through the store's own door, naming that def_id", async () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDelete()
  confirmDelete()
  await waitFor(() => expect(deleteDefinition).toHaveBeenCalledTimes(1))
  expect(deleteDefinition).toHaveBeenCalledWith('u_breakout')
})

test('⛔ the row does NOT vanish optimistically — the STORE decides what exists', async () => {
  const { unmount } = render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDelete()
  confirmDelete()
  await waitFor(() => expect(deleteDefinition).toHaveBeenCalledTimes(1))
  // The mocked store has not answered differently yet, so the row is still
  // listed — and it MUST be. A local removal list here would hide the row on a
  // delete that later turned out to have failed, and then put it back.
  expect(rowButton()).toBeInTheDocument()

  // ⭐ …BUT THE PROMPT IS GONE, AND THE TRASH IS BACK. Found by the fix-round-1
  // sweep as a SURVIVOR (R6): nothing asserted the successful delete disarms its
  // OWN confirm, and every other case was blind to it because the prompt lives
  // inside a row those cases had already stopped looking at. Leaving the confirm
  // armed over a row that IS deleted invites a second DELETE into the window
  // before the store answers — and `soft_delete` reports an already-tombstoned
  // row as nothing-to-do, so the store answers that second one "Not found" and
  // the member is shown a refusal for a delete that worked.
  expect(screen.queryByTestId('delete-ask-u_breakout')).toBeNull()
  expect(screen.getByRole('button', { name: 'Delete Breakout base' })).toBeInTheDocument()

  // …and it leaves the moment the store's own answer does.
  unmount()
  userDefinitionsState.rows = []
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(screen.getByText('No scannable formulas yet')).toBeInTheDocument()
})

test("⭐ a REFUSED delete says the STORE'S OWN WORDS — verbatim, once — and the row stays", async () => {
  deleteDefinition.mockResolvedValue({ ok: false, error: 'Not found' })
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDelete()
  confirmDelete()

  const alerts = await screen.findAllByTestId('screens-manager-error--delete')
  // ⛔ ONE PLACE. Two captions over one refusal is the second-voice defect this
  // file's own header already forbids for the run caption.
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toHaveAttribute('role', 'alert')
  // ⛔ VERBATIM. Not framed, not paraphrased, not prefixed — the exact string the
  // store handed back. A sentence composed here is a second vocabulary for one
  // decision, and the two rot apart the first time the router rewords a gate.
  expect(alerts[0].textContent.trim()).toBe('Not found')
  // ⛔ AND THE MEMBER IS NOT LEFT BELIEVING IT WORKED.
  expect(rowButton()).toBeInTheDocument()
})

test('a second attempt replaces the previous refusal rather than stacking one under it', async () => {
  deleteDefinition.mockResolvedValue({ ok: false, error: 'Not found' })
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDelete()
  confirmDelete()
  await screen.findAllByTestId('screens-manager-error--delete')
  confirmDelete()
  await waitFor(() => expect(deleteDefinition).toHaveBeenCalledTimes(2))
  expect(screen.getAllByTestId('screens-manager-error--delete')).toHaveLength(1)
})

test('while a delete is in flight the confirm cannot be fired twice', async () => {
  let release
  deleteDefinition.mockImplementation(() => new Promise((r) => { release = () => r({ ok: true }) }))
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDelete()
  confirmDelete()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm delete Breakout base' })).toBeDisabled())
  // …and the ask says which state it is in, still naming the scan.
  expect(screen.getByTestId('delete-ask-u_breakout'))
    .toHaveTextContent('Deleting “Breakout base”…')
  confirmDelete()                              // a second tap, on a disabled button
  expect(deleteDefinition).toHaveBeenCalledTimes(1)
  await act(async () => { release() })
})

// ─── ⛔ A DELETED SCAN'S ANSWERS GO WITH IT ──────────────────────────────────

test("⛔ a deleted scan's OPEN DETAIL and its on-screen RUN are retracted", async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 202, json: async () => DONE_JOB })))
  try {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    open()
    await runNow()
    expect(screen.getByTestId('scan-detail-u_breakout')).toBeInTheDocument()
    expect(screen.getByTestId('run-now-done')).toBeInTheDocument()

    armDelete()
    confirmDelete()
    await waitFor(() => expect(screen.queryByTestId('scan-detail-u_breakout')).toBeNull())

    // ⭐ AND THE PAYLOAD IS GONE, NOT MERELY HIDDEN. The store has not answered
    // yet, so the row is still listed; re-opening it must show the NIGHTLY mount.
    // Clearing only `detailId` leaves the run held, and this row's next opening
    // would caption an on-demand answer for a scan that no longer exists.
    ScanResultsSpy.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Breakout base' }))
    expect(ScanResultsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: null }),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('⛔ …and a REFUSED delete retracts NOTHING — nothing was destroyed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 202, json: async () => DONE_JOB })))
  try {
    deleteDefinition.mockResolvedValue({ ok: false, error: 'Not found' })
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    open()
    await runNow()

    armDelete()
    confirmDelete()
    await screen.findAllByTestId('screens-manager-error--delete')

    // The control for the case above: the retraction is keyed on the delete
    // having SUCCEEDED, not on the member having asked for one.
    expect(screen.getByTestId('scan-detail-u_breakout')).toBeInTheDocument()
    expect(screen.getByTestId('run-now-done')).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})

test("⛔ and it is the DELETED scan that is retracted, never a neighbour's", async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete Other scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Other scan' }))
    await waitFor(() => expect(deleteDefinition).toHaveBeenCalledWith('u_other'))

    // Deleting a DIFFERENT scan must not close the one the member is reading.
    expect(screen.getByTestId('scan-detail-u_breakout')).toBeInTheDocument()
    expect(screen.getByTestId('run-now-done')).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})

test("⛔ a delete that SUCCEEDS does not disarm a DIFFERENT row's pending confirm", async () => {
  // ⚰️ REVIEW ROUND 1's FOLD-IN. The success path's `setPendingDelete(null)` was
  // unguarded while the two lines under it were already keyed on `defId`, so
  // arming B while A's request was still out and letting A land wiped B's
  // confirm. It fails safe — a stray disarm never deletes anything — but a rule
  // that holds on two of three lines is not a rule, and the member who armed B
  // watches their prompt vanish for no reason they can see.
  const OTHER = {
    def_id: 'u_other', ast_hash: 'sha256:ccc',
    definition: { compute: { kind: 'ast', fn: 'sha256:ccc', ast: { op: '<' } }, meta: { name: 'Other scan' } },
  }
  userDefinitionsState.rows = [SCANNABLE_ROW, OTHER]
  let release
  deleteDefinition.mockImplementation(() => new Promise((r) => { release = () => r({ ok: true }) }))

  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDelete()                                            // A: armed, then in flight
  confirmDelete()
  await waitFor(() => expect(deleteDefinition).toHaveBeenCalledTimes(1))

  fireEvent.click(screen.getByRole('button', { name: 'Delete Other scan' }))   // B: armed
  expect(screen.getByTestId('delete-ask-u_other')).toBeInTheDocument()

  await act(async () => { release() })                   // A lands

  // B is still asking. Nothing was sent for it.
  expect(screen.getByTestId('delete-ask-u_other')).toBeInTheDocument()
  expect(deleteDefinition).toHaveBeenCalledTimes(1)
})

// ─── 🔴 DELETE — MY SCREENS, THE SAME IDIOM (X26 / W9c.1) ──────────────────
//
// This list used to delete on ONE CLICK: `onClick={() => remove(s.id)}` — no
// confirmation, no name, no error surface (the `savedError` alert above is
// the LIST's own read-refusal; nothing surfaced a DELETE refusal). It now
// carries the identical three claims the My-scans suite above already
// proves, applied to this list:
//
//   1. it ASKS FIRST, and the question NAMES the screen;
//   2. a refusal is `useSavedScreens.remove`'s OWN sentence, rendered once;
//   3. the row leaves only when the store says it is gone, and a SUCCESSFUL
//      delete disarms ONLY the row it was for — never a different row's
//      pending confirm, and never the OTHER list's.
//
// Own state (`pendingDeleteScreen` et al.), own testids
// (`delete-ask-screen-{id}` / `screens-manager-error--delete-screen`) — so a
// screens-lane assertion can never be satisfied by the scans lane, or vice
// versa, the same suffixing discipline the two read-refusal tests above use.

const armDeleteScreen = () => fireEvent.click(screen.getByRole('button', { name: 'Delete My RSI' }))
const confirmDeleteScreen = () => fireEvent.click(screen.getByRole('button', { name: 'Confirm delete My RSI' }))
const screenRowButton = () => screen.queryByRole('button', { name: 'My RSI' })

test('Delete on My screens ASKS FIRST — arming sends nothing, and the question NAMES the screen', () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(screen.queryByTestId('delete-ask-screen-9')).toBeNull()   // control: not armed
  armDeleteScreen()
  // ⛔ ASKING IS NOT DELETING.
  expect(remove).not.toHaveBeenCalled()
  // ⛔ AND IT IS NAMED. "Delete this item?" over a list of screens a member
  // told apart only by name is how the wrong one gets destroyed.
  expect(screen.getByTestId('delete-ask-screen-9')).toHaveTextContent('Delete “My RSI”?')
  expect(screenRowButton()).toBeInTheDocument()
})

test('Keep (My screens) disarms and sends nothing', async () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDeleteScreen()
  fireEvent.click(screen.getByRole('button', { name: 'Keep My RSI' }))
  await waitFor(() => expect(screen.queryByTestId('delete-ask-screen-9')).toBeNull())
  expect(remove).not.toHaveBeenCalled()
  expect(screenRowButton()).toBeInTheDocument()
})

test("Confirm (My screens) sends exactly ONE delete, through useSavedScreens' own door, naming that id", async () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDeleteScreen()
  confirmDeleteScreen()
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  expect(remove).toHaveBeenCalledWith(9)
})

test('⛔ the My-screens row does NOT vanish optimistically — the STORE decides what exists', async () => {
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDeleteScreen()
  confirmDeleteScreen()
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  // The mocked store has not answered differently yet (it never re-seeds
  // `savedScreensState.saved` on its own), so the row is still listed — and
  // it MUST be. A local removal list here would hide the row on a delete that
  // later turned out to have failed, then put it back.
  expect(screenRowButton()).toBeInTheDocument()

  // …but the prompt IS gone, and the trash is back — the same care the scans
  // suite's R6 finding demanded: a confirm left armed over a row that IS
  // deleted invites a second DELETE into the window before the store's own
  // re-read lands, and `screener_saved_delete` now answers an already-gone
  // row 404 "not found" — so a stray second tap would show the member a
  // refusal for a delete that already worked.
  expect(screen.queryByTestId('delete-ask-screen-9')).toBeNull()
  expect(screen.getByRole('button', { name: 'Delete My RSI' })).toBeInTheDocument()
})

test("⭐ a REFUSED delete (My screens) says useSavedScreens' OWN WORDS — verbatim, once — and the row stays", async () => {
  remove.mockResolvedValue({ ok: false, error: 'not found' })
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDeleteScreen()
  confirmDeleteScreen()

  const alerts = await screen.findAllByTestId('screens-manager-error--delete-screen')
  // ⛔ ONE PLACE, and never the scans lane's own error testid.
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toHaveAttribute('role', 'alert')
  expect(screen.queryByTestId('screens-manager-error--delete')).toBeNull()
  // ⛔ VERBATIM. Not framed, not paraphrased — the exact string the hook
  // handed back (which is itself the exact string the router's 404 `detail`
  // carries — see api/routers/screener.py::screener_saved_delete).
  expect(alerts[0].textContent.trim()).toBe('not found')
  expect(screenRowButton()).toBeInTheDocument()
  // ⛔ AND ARMED, NOT MERELY PRESENT — a refusal must leave the confirm live
  // and retryable, not send the member back to a bare trash icon they have
  // to re-tap through arming again. `confirmDeleteScreen` never touches
  // `pendingDeleteScreen` on the failure branch, and this is what proves it.
  expect(screen.getByTestId('delete-ask-screen-9')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm delete My RSI' })).toBeEnabled()
})

test('a second attempt (My screens) replaces the previous refusal rather than stacking one under it', async () => {
  remove.mockResolvedValue({ ok: false, error: 'not found' })
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDeleteScreen()
  confirmDeleteScreen()
  await screen.findAllByTestId('screens-manager-error--delete-screen')
  confirmDeleteScreen()
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
  expect(screen.getAllByTestId('screens-manager-error--delete-screen')).toHaveLength(1)
})

test('while a My-screens delete is in flight the confirm cannot be fired twice', async () => {
  let release
  remove.mockImplementation(() => new Promise((r) => { release = () => r({ ok: true }) }))
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDeleteScreen()
  confirmDeleteScreen()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm delete My RSI' })).toBeDisabled())
  // …and the ask says which state it is in, still naming the screen.
  expect(screen.getByTestId('delete-ask-screen-9')).toHaveTextContent('Deleting “My RSI”…')
  confirmDeleteScreen()                          // a second tap, on a disabled button
  expect(remove).toHaveBeenCalledTimes(1)
  await act(async () => { release() })
})

test("⛔ a My-screens delete that SUCCEEDS does not disarm a DIFFERENT screen's pending confirm", async () => {
  // ⚰️ The exact review-round-1 shape confirmDelete's own comment warns
  // about, reproduced here rather than assumed inherited: arming a SECOND
  // screen's confirm while a FIRST screen's delete is still in flight, then
  // letting the first land, must not wipe the second's prompt.
  savedScreensState.saved = [
    { id: 9, name: 'My RSI', spec: {}, is_public: false, share_token: null },
    { id: 10, name: 'Second Screen', spec: {}, is_public: false, share_token: null },
  ]
  let release
  remove.mockImplementation(() => new Promise((r) => { release = () => r({ ok: true }) }))
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  armDeleteScreen()                                       // #9: armed, then in flight
  confirmDeleteScreen()
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))

  fireEvent.click(screen.getByRole('button', { name: 'Delete Second Screen' }))   // #10: armed
  expect(screen.getByTestId('delete-ask-screen-10')).toBeInTheDocument()

  await act(async () => { release() })                    // #9 lands

  // #10 is still asking. Nothing was sent for it.
  expect(screen.getByTestId('delete-ask-screen-10')).toBeInTheDocument()
  expect(remove).toHaveBeenCalledTimes(1)
})

test('⛔ …and a REFUSED My-screens delete retracts NOTHING — the share panel stays open', async () => {
  // The control for confirmDeleteScreen's success-only retraction of
  // `shareId`: a refusal must not close a panel the member still has open.
  remove.mockResolvedValue({ ok: false, error: 'not found' })
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Share My RSI' }))
  expect(screen.getByTestId('share-panel-9')).toBeInTheDocument()

  armDeleteScreen()
  confirmDeleteScreen()
  await screen.findAllByTestId('screens-manager-error--delete-screen')

  expect(screen.getByTestId('share-panel-9')).toBeInTheDocument()
})

test('⛔ arming a delete on My screens leaves a pending confirm on My scans untouched, and vice versa', async () => {
  // The two LISTS' delete state is separate by construction (own useState
  // triple each) — this is the measured proof, not merely the design intent.
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Delete Breakout base' }))   // scans: armed
  expect(screen.getByTestId('delete-ask-u_breakout')).toBeInTheDocument()

  armDeleteScreen()                    // screens: armed
  confirmDeleteScreen()                // screens: confirmed and lands (remove resolves ok:true)
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))

  // The scans lane's confirm is untouched — different state, different door.
  expect(screen.getByTestId('delete-ask-u_breakout')).toBeInTheDocument()
  expect(deleteDefinition).not.toHaveBeenCalled()
})
