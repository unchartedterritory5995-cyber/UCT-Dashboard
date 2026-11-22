// `/screener?scan=<def_id>` THROUGH THE REAL MANAGER, UNDER A REAL ROUTER (review of #1566).
//
// The hint opens the member's own scan, and afterwards the ROUTER's location holds no `scan`:
// cleaning the address bar alone would leave the router to put it back on its next navigation.
import { SWRConfig } from 'swr'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({ saved: [], starters: [], error: null, create: vi.fn(), update: vi.fn(), remove: vi.fn() }),
}))
const META = vi.hoisted(() => ({ meta: { filters: [] }, isLoading: false }))
vi.mock('./hooks/useScreenerMeta', () => ({ default: () => META, META_KEY: '/api/screener/meta' }))

const MINE = 'u_0123456789ab'
const NUMERIC = 'u_aaaaaaaaaaaa'
const row = (def_id, scannable, name) => ({
  def_id, version: 2, rev: 1, ast_hash: `sha256:${def_id}`, scannable,
  scan_refusal: scannable ? null : { gate: 'gate:yields', reason: 'it answers a number' },
  definition: { compute: { kind: 'ast', fn: `sha256:${def_id}`, ast: { type: 'op' }, source: 'close > open' }, meta: { name } },
})
const defsState = { rows: null, error: null, isLoading: false, refresh: vi.fn() }
vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => defsState,
  deleteUserDefinition: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../../components/chart/builder/BuilderSheet', () => ({ default: () => <div data-testid="builder-sheet-mock" /> }))
vi.mock('../../components/screener/ScanResults', () => ({ default: () => <div data-testid="scan-results-mock" /> }))

import ScreensManager from './ScreensManager'

function Probe() {
  const l = useLocation()
  return <output data-testid="router-search">{l.search}</output>
}
const mountAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ScreensManager currentSpec={{}} onApply={vi.fn()} onUseScan={vi.fn()} />
      <Probe />
    </SWRConfig>
  </MemoryRouter>,
)
const routerSearch = () => screen.getByTestId('router-search').textContent

beforeEach(() => {
  defsState.rows = [row(MINE, true, 'Breakout base'), row(NUMERIC, false, 'A number')]
  window.history.replaceState(null, '', `/screener?tab=scan&scan=${MINE}`)
})

describe('the scan hint, through the real manager', () => {
  it('opens the member’s own scan, and the ROUTER’s location no longer holds the hint', async () => {
    mountAt(`/screener?tab=scan&scan=${MINE}`)
    expect(await screen.findByTestId(`scan-detail-${MINE}`, {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(routerSearch()).toBe('?tab=scan'))
  })

  it('⛔ someone else’s id opens nothing, says nothing, and still leaves the address', async () => {
    window.history.replaceState(null, '', '/screener?scan=u_ffffffffffff')
    mountAt('/screener?scan=u_ffffffffffff')
    await waitFor(() => expect(routerSearch()).toBe(''))
    expect(screen.queryByRole('button', { name: 'New scan' })).toBeNull()        // the menu never opened
    expect(document.querySelector('[data-testid^="scan-detail-"]')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the member’s own indicator that cannot scan: the menu opens on the list, with no detail', async () => {
    window.history.replaceState(null, '', `/screener?scan=${NUMERIC}`)
    mountAt(`/screener?scan=${NUMERIC}`)
    expect(await screen.findByRole('button', { name: 'New scan' }, { timeout: 5000 })).toBeInTheDocument()
    expect(document.querySelector('[data-testid^="scan-detail-"]')).toBeNull()
    await waitFor(() => expect(routerSearch()).toBe(''))
  })

  it('CONTROL: with no hint nothing opens and the address is left alone', async () => {
    window.history.replaceState(null, '', '/screener?tab=scan')
    mountAt('/screener?tab=scan')
    await waitFor(() => expect(routerSearch()).toBe('?tab=scan'))
    expect(screen.queryByRole('button', { name: 'New scan' })).toBeNull()
  })

  it('with no router around it, the address bar itself is cleaned', async () => {
    window.history.replaceState(null, '', `/screener?tab=scan&scan=${MINE}`)
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ScreensManager currentSpec={{}} onApply={vi.fn()} onUseScan={vi.fn()} />
      </SWRConfig>,
    )
    expect(await screen.findByTestId(`scan-detail-${MINE}`, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=scan')
  })
})
