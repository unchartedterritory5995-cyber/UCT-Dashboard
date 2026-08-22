import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

// ScreensManager.test.jsx — the mount rail's "hook is mocked here" record
// (screenSharing.mount.test.jsx points at THIS file now, not
// SaveScreenBar.test.jsx). Both data sources are mocked at the component
// level: `useSavedScreens` (screen specs) and `useUserDefinitions` (formula
// definitions, filtered through the REAL `scannableScreens`).

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
const userDefinitionsState = { rows: [SCANNABLE_ROW], error: null }
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

import ScreensManager from './ScreensManager'
import { defaultSession } from '../../components/screener/scanSession'

beforeEach(() => {
  create.mockClear(); update.mockClear(); remove.mockClear()
  ScanResultsSpy.mockClear()
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
  expect(screen.getByTestId('screens-manager-error')).toBeInTheDocument()
  expect(screen.queryByText('None saved yet')).not.toBeInTheDocument()
})

test('a refused definitions read renders the error testid for the scans section', () => {
  userDefinitionsState.rows = []
  userDefinitionsState.error = new Error('user-definitions 402')
  render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
  open()
  expect(screen.getByTestId('screens-manager-error')).toBeInTheDocument()
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
  })
})
