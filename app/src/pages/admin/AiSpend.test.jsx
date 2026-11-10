import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AiSpend, { featureName, Budgets } from './AiSpend'

const SUMMARY = {
  days: 7, since: '2026-11-04', today: '2026-11-10', ledger_first_day: '2026-11-10',
  totals: { calls: 3, cost: 12.5, input: 1000, cache_read: 3000, cache_write: 0, output: 500, web_searches: 2,
    failed: 0, cache_ratio: 0.75, avg_per_day: 12.5, days_with_data: 1 },
  today_totals: { calls: 3, cost: 12.5, input: 1000, cache_read: 3000, cache_write: 0, output: 500, web_searches: 2, failed: 0, cache_ratio: 0.75 },
  by_door: [
    { door: 'api/services/desk_session_insights.py', calls: 2, cost: 10, share: 0.8, cache_ratio: 0, cost_per_call: 5,
      output: 400, models: ['claude-sonnet-5'], kind: 'background', surface: 'desk insights' },
    { door: 'api/services/zz_new.py', calls: 1, cost: 2.5, share: 0.2, cache_ratio: 0.9, cost_per_call: 2.5,
      output: 100, models: ['claude-opus-5-5'], kind: 'unlisted', surface: '' },
  ],
  by_model: [{ model: 'claude-sonnet-5', cost: 10, share: 0.8, calls: 2, cache_ratio: 0 }],
  by_kind: [{ kind: 'sync', cost: 12.5, calls: 3 }],
  by_service: [{ service: 'web', cost: 12.5, calls: 3 }],
  by_day: [{ day: '2026-11-10', total: 12.5, calls: 3, doors: { 'api/services/desk_session_insights.py': 10, 'api/services/zz_new.py': 2.5 } }],
  top_doors: ['api/services/desk_session_insights.py', 'api/services/zz_new.py'],
  unlisted_doors: ['api/services/zz_new.py'], silent_doors: ['api/services/groups.py'],
  ledger: { recorded: 3, dropped: 0, write_errors: 0, service: 'web' },
}
const DETAIL = {
  door: 'api/services/desk_session_insights.py', surface: 'desk insights', budget: 'none',
  totals: { calls: 2, cost: 10, cache_ratio: 0, failed: 0 },
  by_func: [{ func: '_extract_ticker_moments', calls: 2, cost: 10, input: 90000, cache_read: 0, output: 400 }],
  by_model: [{ model: 'claude-sonnet-5', calls: 2, cost: 10 }], by_day: [], by_hour_utc: [], recent: [],
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('AiSpend', () => {
  it('ranks features by spend, flags unregistered ones, and drills into one', async () => {
    const fetchMock = vi.fn((url) => Promise.resolve({
      ok: true, json: () => Promise.resolve(String(url).includes('/door?') ? DETAIL : SUMMARY),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AiSpend />)

    await waitFor(() => expect(screen.getAllByText('desk_session_insights').length).toBeGreaterThan(0))
    expect(screen.getByText(/Not in the AI-door register/)).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    const firstDataRow = rows.find((r) => r.textContent.includes('$10.00'))
    expect(firstDataRow.textContent).toContain('80%')

    fireEvent.click(firstDataRow)
    await waitFor(() => expect(screen.getByText('_extract_ticker_moments')).toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('door=api%2Fservices%2Fdesk_session_insights.py'))).toBe(true)
  })

  it('names a feature from its module path', () => {
    expect(featureName('api/services/journal_two/coach_chat.py')).toBe('journal_two/coach_chat')
    expect(featureName('api/routers/ai_search.py')).toBe('ai_search')
    expect(featureName('')).toBe('unattributed')
  })

  it('shows each budget against today and saves a mode change and a new budget', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<Budgets onChanged={onChanged} doorOptions={['api/services/tsdr_lessons.py']} rows={[
      { door: 'api/services/tsdr_lessons.py', daily_usd: 10, mode: 'block', note: 'backfill', spent: 10.5,
        projected: 14, pct: 1.05, level: 'over', blocking: true },
      { door: '*', daily_usd: 60, mode: 'alert', note: '', spent: 20, projected: 55, pct: 0.33, level: 'ok', blocking: false },
    ]} />)
    expect(screen.getByText('blocking')).toBeInTheDocument()
    expect(screen.getAllByText('Whole site')).toHaveLength(2) // the row and the add-form option

    fireEvent.change(screen.getByLabelText('mode for Whole site'), { target: { value: 'block' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/llm-usage/budgets')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toMatchObject({ door: '*', daily_usd: 60, mode: 'block' })

    fireEvent.change(screen.getByLabelText('daily budget in dollars'), { target: { value: '0' } })
    fireEvent.submit(screen.getByText('Set budget').closest('form')) // past the native min= check, to our own guard
    expect(await screen.findByText(/more than \$0/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1) // a $0 budget is never sent
  })
})
