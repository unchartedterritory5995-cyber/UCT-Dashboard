// Support loop — THE WIRE-CUT CASE. The notice and the report button are driven
// through `BuilderSheet` (the Import tab), so cutting `<ImportGapNotice>` out of
// `PineBox`, or the `sym`/`tf` hand-off from the sheet, reds here while every
// component test stays green. `docs/pine/support-loop/PHASE-A.md`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from '../builder/BuilderSheet'
import { AuthContext } from '../../../context/AuthContext'
import { _resetForTests } from './supportApi'

const H = { requests: [] }

beforeEach(() => {
  cleanup(); _resetForTests(); H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
    if (String(url).endsWith('/api/indicator-support/config')) {
      return { ok: true, status: 200, json: async () => ({ reports_enabled: true }) }
    }
    if (String(url).endsWith('/reports/mine')) return { ok: true, status: 200, json: async () => ({ reports: [] }) }
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ id: 'b'.repeat(32), status: 'new' }) }
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('the Builder’s Pine import shows the notice and carries the chart it was opened over', () => {
  it('notice → button → dialog, with the sheet’s symbol and timeframe', async () => {
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} sym="NVDA" tf="60" />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
    const area = screen.getByTestId('pine-box').querySelector('textarea')
    fireEvent.change(area, { target: { value: '//@version=5\nindicator("x")\nplot(ta.sma(close))\nplot(close)\n' } })
    const notice = await screen.findByTestId('import-gap-notice')
    expect(notice.textContent).toMatch(/ta\.sma/)
    fireEvent.click(await screen.findByTestId('import-report-mismatch'))
    const ctx = await screen.findByTestId('report-mismatch-context')
    expect(ctx.textContent).toMatch(/Symbol NVDA · timeframe 60/)
    await waitFor(() => expect(H.requests.some((r) => r.url.endsWith('/api/indicator-support/gaps'))).toBe(true))
  })
})
