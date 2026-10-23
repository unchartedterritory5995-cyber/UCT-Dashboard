import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils'
import RarePreview from './RarePreview'
import { drawingToAnnotations, releaseLine, ymd } from './rarePreviewDrawing'

// The chart stand-in prints what the reviewer would see: the ticker, the framing and the buy-point label the
// annotations carry, and whether they are editable (they must not be: the owner judges, never redraws).
vi.mock('../../components/StockChart', () => ({
  default: ({ sym, focusDate, focusStartDate, annotations, annotationsEditable }) => (
    <div data-testid="stock-chart">
      <span>chart:{sym}</span>
      <span>frame:{focusStartDate || '-'}..{focusDate || '-'}</span>
      <span>labels:{(annotations || []).filter((a) => a.type === 'text').map((a) => a.text).join('|')}</span>
      <span>{annotationsEditable ? 'editable' : 'read-only'}</span>
    </div>
  ),
}))

const DRAW = {
  start_t: 20250102, end_t: 20250401, pivot_from_t: 20250102, buy_point: 100.4, low: 80.1, pivot: 100.4,
  path: true, marks: [{ t: 20250102, price: 100.3, kind: 'lip' }, { t: 20250215, price: 80.1, kind: 'low' },
    { t: 20250401, price: 99.9, kind: 'right_high' }],
}
let DATA
let swrError

vi.mock('swr', () => ({
  default: (key) => {
    if (key && key.startsWith('/api/patterns/admin/rare-preview/instances')) {
      return { data: swrError ? undefined : DATA, error: swrError, mutate: vi.fn() }
    }
    return { data: undefined, mutate: vi.fn() }
  },
}))

const REL = (a, r, met = false) => ({ approved: a, rejected: r, decided: a + r, approve_rate: a + r ? a / (a + r) : null,
  rule_met: met, released: false, rule: { min_approvals: 12, min_approve_rate: 0.8 } })

beforeEach(() => {
  swrError = undefined
  DATA = {
    patterns: [{ id: 'draw:cup-no-handle', name: 'Cup without handle' }, { id: 'draw:htf', name: 'High tight flag' }],
    release: { 'draw:cup-no-handle': REL(3, 1), 'draw:htf': REL(0, 0) },
    scan: { running: false },
    instances: [
      { instance_id: 'draw:cup-no-handle|AAAA|20250102', pattern_id: 'draw:cup-no-handle', ticker: 'AAAA',
        start_t: 20250102, first_asof_t: 20250328, last_asof_t: 20250401, buy_point: 100.4, seen_count: 3,
        label: 'Cup w/o handle · Buy point 100.40', drawing: DRAW, verdict: null },
      { instance_id: 'draw:htf|BBBB|20250105', pattern_id: 'draw:htf', ticker: 'BBBB', start_t: 20250105,
        first_asof_t: 20250401, last_asof_t: 20250401, buy_point: 20.3, seen_count: 1, label: null,
        drawing: { ...DRAW, buy_point: 20.3, low: 17.6, pivot: 20.3, path: true }, verdict: null },
    ],
  }
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }))
})

describe('Rare-pattern preview page', () => {
  it('shows the first instance on its chart with the buy point, read-only, framed on the base', () => {
    renderWithProviders(<RarePreview />)
    const chart = screen.getByTestId('stock-chart')
    expect(chart).toHaveTextContent('chart:AAAA')
    expect(chart).toHaveTextContent('frame:2025-01-02..2025-04-01')
    expect(chart).toHaveTextContent('labels:Buy point 100.40')
    expect(chart).toHaveTextContent('read-only')
    expect(screen.getByText(/Buy point 100\.40 \(the ceiling bar's high \+ \$0\.10\)/)).toBeInTheDocument()
  })

  it('shows the release rule per pattern as the server counts it', () => {
    renderWithProviders(<RarePreview />)
    const rel = screen.getByTestId('rare-release')
    expect(rel).toHaveTextContent('Cup without handle: 3/12 approved · 1 rejected · 75% (needs 12 approvals at 80%) · not met')
    expect(rel).toHaveTextContent('High tight flag: 0/12 approved · 0 rejected · —')
  })

  it('Approve posts the verdict with the note and moves to the next undecided instance', async () => {
    renderWithProviders(<RarePreview />)
    fireEvent.change(screen.getByLabelText('Verdict note'), { target: { value: ' clean U ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved AAAA Cup without handle: approved.'))
    const [url, init] = globalThis.fetch.mock.calls.at(-1)
    expect(url).toBe('/api/patterns/admin/rare-preview/instances/draw%3Acup-no-handle%7CAAAA%7C20250102/verdict')
    expect(JSON.parse(init.body)).toEqual({ verdict: 'approve', note: 'clean U' })
    expect(screen.getByTestId('rare-ticker')).toHaveTextContent('BBBB')
  })

  it('Reject records a reject and a failed save says nothing was recorded', async () => {
    renderWithProviders(<RarePreview />)
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Save failed (500). Nothing was recorded.'))
    expect(JSON.parse(globalThis.fetch.mock.calls.at(-1)[1].body).verdict).toBe('reject')
  })

  it('says the preview is off when the API answers 404', () => {
    swrError = Object.assign(new Error('HTTP 404'), { status: 404 })
    renderWithProviders(<RarePreview />)
    expect(screen.getByText(/rare-pattern preview is off/)).toBeInTheDocument()
  })
})

describe('rarePreviewDrawing', () => {
  it('turns a drawing into a buy-point line, its label, the low and the dotted path', () => {
    const a = drawingToAnnotations(DRAW)
    expect(a.find((x) => x.id === 'rp-buy').points).toEqual([{ time: '2025-01-02', price: 100.4 },
      { time: '2025-04-01', price: 100.4 }])
    expect(a.find((x) => x.type === 'text').text).toBe('Buy point 100.40')
    expect(a.find((x) => x.id === 'rp-low').lineStyle).toBe('dashed')
    expect(a.filter((x) => x.id.startsWith('rp-path'))).toHaveLength(2)
    expect(drawingToAnnotations({ ...DRAW, path: false }).some((x) => x.id.startsWith('rp-path'))).toBe(false)
  })

  it('draws nothing for a malformed drawing', () => {
    expect(drawingToAnnotations(null)).toEqual([])
    expect(drawingToAnnotations({ ...DRAW, buy_point: 'x' })).toEqual([])
    expect(drawingToAnnotations({ ...DRAW, end_t: 2025 })).toEqual([])
    expect(ymd(20250401)).toBe('2025-04-01')
    expect(ymd('bad')).toBe(null)
  })

  it('reports a met rule without claiming a release', () => {
    expect(releaseLine({ ...REL(12, 3, true) })).toMatch(/rule met — release is a separate commit$/)
  })
})
