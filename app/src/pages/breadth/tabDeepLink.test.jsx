/**
 * `?tab=charts` (and any other resolved tab key) used to be silently ignored on
 * load — reloading a link to Data Charts always reset to Monitor. This is a
 * one-shot initial read, separate from the Views tab's own shareable-URL
 * contract (spec §5, `useBreadthUrlState.js`): it must never fight that
 * contract's `view`/`compare` → Views inference, and it must never open a tab
 * the visitor cannot actually reach (an admin-only `?tab=analogues` link
 * opened by a non-admin).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../CotData', () => ({ default: () => <div data-testid="cot-data" /> }))
vi.mock('../BreadthCharts', () => ({ default: () => <div data-testid="v1-charts" /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
                       isShared: false, toggleShare: () => {}, flaggedName: 'Flagged',
                       renameFlagged: () => {} }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  breadth_score: 70 - (i % 10), uct_exposure: 60, pct_above_50sma: 55,
  up_4pct_today: 200, down_4pct_today: 100, vix: 16,
}))
vi.mock('swr', () => ({
  default: () => ({ data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))

const isAdminRef = vi.hoisted(() => ({ current: false }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: isAdminRef.current ? 'admin' : 'user' } }),
}))

import Breadth from '../Breadth'

const mount = (path) => render(<MemoryRouter initialEntries={[path]}><Breadth /></MemoryRouter>)
const tab = (label) => screen.getByRole('button', { name: label })

describe('?tab= opens the requested Breadth sub-tab on load', () => {
  it('a bare /breadth still opens the Monitor (control — the read is additive, not a takeover)', () => {
    isAdminRef.current = false
    mount('/breadth')
    expect(tab('Monitor').className).toMatch(/tabActive/)
  })

  it('?tab=charts opens Data Charts on the very first render', () => {
    isAdminRef.current = false
    mount('/breadth?tab=charts')
    expect(tab('Data Charts').className).toMatch(/tabActive/)
    expect(screen.getByTestId('v1-charts')).toBeInTheDocument()
  })

  it('?tab=cot opens COT Data', () => {
    isAdminRef.current = false
    mount('/breadth?tab=cot')
    expect(tab('COT Data').className).toMatch(/tabActive/)
    expect(screen.getByTestId('cot-data')).toBeInTheDocument()
  })

  it('an unrecognised ?tab= value falls through to the ordinary default, not a crash', () => {
    isAdminRef.current = false
    mount('/breadth?tab=not_a_real_tab')
    expect(tab('Monitor').className).toMatch(/tabActive/)
  })

  it('⛔ an admin-only ?tab=analogues opened by a NON-admin falls through, never opens', () => {
    isAdminRef.current = false
    mount('/breadth?tab=analogues')
    expect(screen.queryByRole('button', { name: 'Analogues' })).toBeNull()
    expect(tab('Monitor').className).toMatch(/tabActive/)
  })

  it('⭐ CONTROL — the same link opened by an admin DOES reach Analogues', () => {
    isAdminRef.current = true
    mount('/breadth?tab=analogues')
    expect(tab('Analogues').className).toMatch(/tabActive/)
  })

  it("⛔ ?tab= never overrides the Views URL contract's own inference — the two must not fight", () => {
    // ?view=clock already opens Views on its own (spec §5); an explicit
    // ?tab=heatmap alongside it must agree, not race it.
    isAdminRef.current = false
    mount('/breadth?tab=heatmap&view=clock')
    expect(tab('Views').className).toMatch(/tabActive/)
  })
})
