/**
 * Rails for what V2 shipped WITHOUT (2026-09-19): the presets members had on V1, a range
 * control that shows which range is on, and the member's saved view.
 *
 * ⛔ Each assertion reads what a member would see or what the app would send — a pressed
 * button, a request's keys, a POSTed preference — never component state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../context/AuthContext'
import BreadthChartsV2 from './BreadthChartsV2'
import { CHART_PRESETS } from '../chartMetrics'

vi.mock('echarts-for-react', () => ({
  default: ({ option }) => <div data-testid="echart" data-option={JSON.stringify(option)} />,
}))

const mockUseBreadthSeries = vi.fn()
vi.mock('./useBreadthSeries', () => ({
  default: (...args) => mockUseBreadthSeries(...args),
  MAX_KEYS: 8,
}))

function fixture(keys) {
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16']
  return {
    dates,
    series: Object.fromEntries(keys.map(k => [k, [1, 2, 3]])),
    keys, missing: [], dropped: [], reconstructed: [], tooWide: false, maxSessions: 4700,
    isLoading: false, error: null,
  }
}

let posted
function stubPrefs(saved) {
  posted = []
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    if (u.includes('/api/auth/preferences')) {
      if (opts?.method === 'POST') {
        posted.push(JSON.parse(opts.body))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(saved ?? {}) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
}

function mount() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ user: { id: 'u' }, plan: 'pro', loading: false,
        breadthDcV22Enabled: true, breadthDcV23Enabled: true }}>
        <BreadthChartsV2 />
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

const lastKeys = () => mockUseBreadthSeries.mock.calls.at(-1)[0]
const lastFrom = () => mockUseBreadthSeries.mock.calls.at(-1)[1]

beforeEach(() => {
  mockUseBreadthSeries.mockReset()
  mockUseBreadthSeries.mockImplementation(keys => fixture(keys))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the presets V1 members had are on V2 too', () => {
  it('applying a preset requests exactly its metrics', async () => {
    stubPrefs()
    mount()
    const preset = CHART_PRESETS.find(p => !p.group && p.metrics.length >= 2)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${preset.label}`) }))
    await waitFor(() => expect(lastKeys().filter(k => k !== 'universe_count').sort())
      .toEqual([...preset.metrics].sort()))
  })
})

describe('the range control says which range is on', () => {
  it('90D is pressed by default, and pressing 1Y moves both the button and the request', async () => {
    stubPrefs()
    mount()
    expect(screen.getByTestId('v2-days-90d')).toHaveAttribute('aria-pressed', 'true')
    const before = lastFrom()
    fireEvent.click(screen.getByTestId('v2-days-1y'))
    expect(screen.getByTestId('v2-days-1y')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('v2-days-90d')).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(lastFrom() < before).toBe(true))
  })

  it('Custom opens two date fields that drive the request', async () => {
    stubPrefs()
    mount()
    fireEvent.click(screen.getByTestId('v2-days-custom'))
    const fromField = screen.getByLabelText('From')
    fireEvent.change(fromField, { target: { value: '2025-01-02' } })
    await waitFor(() => expect(lastFrom()).toBe('2025-01-02'))
  })
})

describe('the member\'s saved view', () => {
  it('opens the selection saved under the key V1 uses', async () => {
    stubPrefs({ breadth_charts_state: JSON.stringify({ selected: ['vix', 'pct_above_200sma'], ftd: true }) })
    mount()
    await waitFor(() => expect(lastKeys()).toEqual(expect.arrayContaining(['vix', 'pct_above_200sma'])))
    expect(lastKeys()).not.toContain('breadth_score')
  })

  it('saves a change the member made, and keeps V1\'s own fields in the same document', async () => {
    stubPrefs({ breadth_charts_state: JSON.stringify({ selected: ['vix'], ftd: true }) })
    mount()
    await waitFor(() => expect(lastKeys()).toContain('vix'))
    fireEvent.click(screen.getByTestId('v2-days-1y'))
    await waitFor(() => expect(posted.length).toBeGreaterThan(0), { timeout: 2000 })
    const doc = JSON.parse(posted.at(-1).value)
    expect(doc.range).toBe('1y')
    expect(doc.selected).toEqual(['vix'])
    expect(doc.ftd).toBe(true)
  })

  it('⭐ CONTROL — a page load that changes nothing writes nothing', async () => {
    stubPrefs({ breadth_charts_state: JSON.stringify({ selected: ['vix'] }) })
    mount()
    await waitFor(() => expect(lastKeys()).toContain('vix'))
    await new Promise(r => setTimeout(r, 800))
    expect(posted).toEqual([])
  })
})
