import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, waitFor, within } from '../../test-utils'
import PatternReview from './PatternReview'
import StudyReview, { REVIEW_URL, TRUST_URL, EXPORT_URL, reviewKey, checksOf, provenanceOf, forwardSummaryOf } from './StudyReview'

// The chart stand-in prints the props the review card is responsible for as
// TEXT: the REVEALED ticker, the frame around the cutoff, and the cutoff marker.
vi.mock('../../components/StockChart', () => ({
  default: ({ sym, entryDate, exitDate, markers, priceLines, barsOverride, barsOverridePending, studyMode }) => (
    <div data-testid="stock-chart">
      <span>chart:{sym}</span>
      <span>bars:{Array.isArray(barsOverride) ? barsOverride.length : (barsOverridePending ? 'pending' : 'none')}</span>
      <span>study:{studyMode ? '1' : '0'}</span>
      <span>frame:{entryDate || '-'}..{exitDate || '-'}</span>
      <span>markers:{(markers || []).map((m) => m.text).join('|')}</span>
      <span>lines:{(priceLines || []).length}</span>
    </div>
  ),
}))
vi.mock('../../utils/chartCapture', () => ({ captureChartPng: () => 'data:image/png;base64,QQ==' }))

let DRAFTS
let TRUST
let COUNTS
let KEYS

vi.mock('swr', () => ({
  default: (key) => {
    KEYS.push(key)
    if (key && key.startsWith('/api/study/admin/review')) {
      return { data: { drafts: DRAFTS, counts: COUNTS, trust: TRUST }, error: undefined, mutate: vi.fn() }
    }
    if (key && key.includes('/patterns/admin/review')) return { data: { verdicts: [] }, mutate: vi.fn() }
    if (key && /^\/api\/study\/admin\/items\/[^/]+\/bars$/.test(key)) {
      return { data: STORED_BARS, error: undefined, mutate: vi.fn() }
    }
    return { data: undefined, mutate: vi.fn() }
  },
}))

// What the admin bars route returns for a chart item: the member's visible
// window plus the forward strip, symbol = the item id (never the ticker).
const STORED_BARS = {
  symbol: 'si_a', tf: 'D',
  bars: [
    { t: 20250529, o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
    { t: 20250530, o: 100.5, h: 102, l: 100, c: 101.5, v: 1100 },
    { t: 20250602, o: 101.5, h: 103, l: 101, c: 102.5, v: 1200 },
  ],
  forward: [
    { t: 20250603, o: 102.5, h: 104, l: 102, c: 103.5, v: 1300 },
    { t: 20250604, o: 103.5, h: 105, l: 103, c: 104.5, v: 1400 },
  ],
}

const SPOT_A = {
  id: 'si_a', version: 1, type: 'spot', skill_id: 'setup.vcp', difficulty: 2,
  sym: 'NVDA', asof: '2025-06-02', bars_ref: 'sb_1', review_lane: 'fast',
  source_kind: 'detector', source_ref: 'pattern_detections#123', adjustment_basis: 'split-adjusted',
  prompt_json: { q: 'Which setup is this?', choices: ['Bull flag', 'VCP', 'Flat base', 'Wedge'], chart: { window_bars: 120, tf: 'D' } },
  answer_json: { answer: 'VCP' },
  reveal_json: { detector: 'vcp', detection_id: 'det-9', facts: { geometry: { depth_pct: 12.3, length_bars: 40 }, levels: { entry: 100, stop: 95, target: 115 }, outcome: 'target_hit', window: 20 } },
  lesson_text: 'Three contractions, each tighter than the last.',
  lesson_origin: 'template',
  import_flags: [],
}
const SPOT_C = { ...SPOT_A, id: 'si_c', sym: 'TSLA', asof: '2025-07-01', reveal_json: { ...SPOT_A.reveal_json, detection_id: 'det-10' } }
const RECALL_B = {
  id: 'si_b', version: 2, type: 'recall', skill_id: 'vocab.method', difficulty: 1,
  sym: null, asof: null, bars_ref: null, review_lane: 'manual',
  source_kind: 'glossary', source_ref: 'brief.json#glossary#THE LOOP',
  prompt_json: { q: 'At the desk, what does THE LOOP mean?', choices: ['The six-station cycle', 'The four entry types'] },
  answer_json: { answer: 'The six-station cycle' },
  reveal_json: { quote: 'The six-station cycle', source: 'brief.json#glossary', term: 'THE LOOP' },
  lesson_text: null,
  import_flags: ['voice (lesson_text): em-dash'],
}

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

function postCalls(prefix) {
  return globalThis.fetch.mock.calls
    .filter(([url, init]) => init?.method === 'POST' && String(url).startsWith(prefix))
    .map(([url, init]) => ({ url, body: JSON.parse(init.body) }))
}

beforeEach(() => {
  KEYS = []
  DRAFTS = [SPOT_A, SPOT_C, RECALL_B]
  TRUST = {
    spot: { item_type: 'spot', clean_count: 3, state: 'manual', ask_to_switch: false, ask_at: 20 },
    recall: { item_type: 'recall', clean_count: 20, state: 'manual', ask_to_switch: true, ask_at: 20 },
  }
  COUNTS = { fast: { spot: 2 }, manual: { recall: 1 } }
  globalThis.fetch = vi.fn((url) => {
    if (String(url).startsWith(TRUST_URL)) return jsonResponse({ item_type: 'recall', state: 'sampled', clean_count: 20, sample_rate: 0.1 })
    return jsonResponse({ item: {}, trust: { item_type: 'spot', clean_count: 4, state: 'manual', ask_to_switch: false } })
  })
})

describe('StudyReview card', () => {
  it('is mounted by PatternReview as the study mode', () => {
    renderWithProviders(<PatternReview />)
    fireEvent.click(screen.getByRole('tab', { name: 'Study items' }))
    expect(screen.getByText(/Every fix and reject is kept as a correction/)).toBeInTheDocument()
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('NVDA')
  })

  it('shows the revealed ticker and dates, the chart framed around the cutoff with the forward strip marked', () => {
    renderWithProviders(<StudyReview />)
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('NVDA')
    expect(screen.getByTestId('study-dates')).toHaveTextContent('2025-06-02')
    expect(screen.getByTestId('study-dates')).toHaveTextContent('forward 20 sessions')
    const chart = screen.getByTestId('stock-chart')
    expect(chart).toHaveTextContent('chart:NVDA')
    // The STORED snapshot drives the chart (3 visible + 2 forward), in study
    // mode, from the admin bars route; never a live fetch by ticker.
    expect(chart).toHaveTextContent('bars:5')
    expect(chart).toHaveTextContent('study:1')
    expect(KEYS).toContain('/api/study/admin/items/si_a/bars')
    expect(chart).toHaveTextContent('frame:2024-11-27..2025-07-07')
    expect(chart).toHaveTextContent('markers:member sees to here')
    expect(chart).toHaveTextContent('lines:3')
    expect(screen.getByText(/Member sees bars through 2025-06-02/)).toBeInTheDocument()
  })

  it('highlights the key among the choices', () => {
    renderWithProviders(<StudyReview />)
    const list = screen.getByRole('list', { name: 'Choices' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    const keyed = rows.filter((r) => r.getAttribute('data-key') === '1')
    expect(keyed).toHaveLength(1)
    expect(keyed[0]).toHaveTextContent('VCP')
    expect(keyed[0]).toHaveTextContent('key')
  })

  it('prints the provenance (geometry numbers or the verbatim quote), the forward strip and the lesson', () => {
    renderWithProviders(<StudyReview />)
    expect(screen.getByTestId('study-provenance')).toHaveTextContent('vcp measured depth pct 12.3, length bars 40')
    expect(screen.getByTestId('study-forward')).toHaveTextContent('outcome target hit · window 20 sessions · entry 100 · stop 95 · target 115')
    expect(screen.getByTestId('study-lesson')).toHaveTextContent('Three contractions, each tighter than the last.')
    expect(screen.getByText('detector · pattern_detections#123 · split-adjusted')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /recall · manual/ }))
    expect(screen.getByTestId('study-provenance')).toHaveTextContent('Source says')
    expect(screen.getByTestId('study-provenance')).toHaveTextContent('The six-station cycle')
    expect(screen.queryByTestId('stock-chart')).not.toBeInTheDocument()
  })

  it('shows the automatic checks as pass/fail chips from import_flags', () => {
    renderWithProviders(<StudyReview />)
    expect(screen.getByTestId('check-numbers')).toHaveTextContent('pass')
    expect(screen.getByTestId('check-duplicate')).toHaveTextContent('pass')
    expect(screen.getByTestId('check-voice')).toHaveTextContent('pass')
    fireEvent.click(screen.getByRole('button', { name: /recall · manual/ }))
    expect(screen.getByTestId('check-voice')).toHaveTextContent('fail')
    expect(screen.getByTestId('check-numbers')).toHaveTextContent('pass')
  })

  it('prints the raw ids in the mono footer', () => {
    renderWithProviders(<StudyReview />)
    const f = screen.getByTestId('study-ids')
    expect(f).toHaveTextContent('item si_a')
    expect(f).toHaveTextContent('source_ref pattern_detections#123')
    expect(f).toHaveTextContent('detection det-9')
    expect(f).toHaveTextContent('bars sb_1')
  })

  it('A approves (keyboard) with the right body and advances to the next unreviewed item', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.keyDown(document.body, { key: 'a' })
    await waitFor(() => expect(postCalls(REVIEW_URL)).toHaveLength(1))
    expect(postCalls(REVIEW_URL)[0]).toEqual({ url: `${REVIEW_URL}/si_a`, body: { action: 'approve' } })
    await waitFor(() => expect(screen.getByTestId('study-ticker')).toHaveTextContent('TSLA'))
    expect(screen.getByText('NVDA: approved.')).toBeInTheDocument()
    expect(screen.getByText('approved')).toBeInTheDocument()
    expect(screen.getByTestId('study-progress')).toHaveTextContent('1 of 3 reviewed')
  })

  it('the Approve button posts the same body', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(postCalls(REVIEW_URL)).toHaveLength(1))
    expect(postCalls(REVIEW_URL)[0].body).toEqual({ action: 'approve' })
  })

  it('F opens the inline editor; Save fix posts the edited lesson as ONE field and advances', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.keyDown(document.body, { key: 'f' })
    const editor = screen.getByTestId('fix-editor')
    expect(within(editor).getByLabelText('Question')).toHaveValue('Which setup is this?')
    expect(within(editor).getByLabelText('Answer')).toHaveValue('VCP')
    fireEvent.change(within(editor).getByLabelText('Lesson'), { target: { value: 'Three contractions, then the pivot.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save fix' }))
    await waitFor(() => expect(postCalls(REVIEW_URL)).toHaveLength(1))
    expect(postCalls(REVIEW_URL)[0]).toEqual({
      url: `${REVIEW_URL}/si_a`,
      body: { action: 'fix', field: 'lesson_text', after: 'Three contractions, then the pivot.', reason: 'fix' },
    })
    await waitFor(() => expect(screen.getByTestId('study-ticker')).toHaveTextContent('TSLA'))
    expect(screen.getByText('fixed')).toBeInTheDocument()
  })

  it('a fix touching the answer and the lesson posts one call per changed field, in order', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByRole('button', { name: /Fix/ }))
    const editor = screen.getByTestId('fix-editor')
    fireEvent.change(within(editor).getByLabelText('Answer'), { target: { value: 'Flat base' } })
    fireEvent.change(within(editor).getByLabelText('Lesson'), { target: { value: 'A flat base, not a VCP.' } })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await waitFor(() => expect(postCalls(REVIEW_URL)).toHaveLength(2))
    expect(postCalls(REVIEW_URL).map((c) => c.body)).toEqual([
      { action: 'fix', field: 'answer_json', after: { answer: 'Flat base' }, reason: 'fix' },
      { action: 'fix', field: 'lesson_text', after: 'A flat base, not a VCP.', reason: 'fix' },
    ])
  })

  it('R requires a reason chip; Enter then posts the reject with that reason and advances', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.keyDown(document.body, { key: 'r' })
    expect(screen.getByTestId('reject-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm reject' })).toBeDisabled()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(screen.getByText('Pick a reason chip first.')).toBeInTheDocument()
    expect(postCalls(REVIEW_URL)).toHaveLength(0)
    fireEvent.click(screen.getByRole('radio', { name: 'bad chart' }))
    fireEvent.change(screen.getByLabelText('Reject note'), { target: { value: 'split not adjusted' } })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await waitFor(() => expect(postCalls(REVIEW_URL)).toHaveLength(1))
    expect(postCalls(REVIEW_URL)[0]).toEqual({
      url: `${REVIEW_URL}/si_a`,
      body: { action: 'reject', reason: 'bad chart: split not adjusted' },
    })
    await waitFor(() => expect(screen.getByTestId('study-ticker')).toHaveTextContent('TSLA'))
    expect(screen.getByText('rejected')).toBeInTheDocument()
  })

  it('N and P move through the queue', () => {
    renderWithProviders(<StudyReview />)
    fireEvent.keyDown(document.body, { key: 'n' })
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('TSLA')
    fireEvent.keyDown(document.body, { key: 'p' })
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('NVDA')
  })

  it('shows the trust banner at the ask threshold and Yes posts the switch to sampled', async () => {
    renderWithProviders(<StudyReview />)
    expect(screen.queryByTestId('trust-banner')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /recall · manual/ }))
    const banner = screen.getByTestId('trust-banner')
    expect(banner).toHaveTextContent('You have approved 20 clean recall items in a row. Switch recall to auto-approve with a 10% sample?')
    fireEvent.click(within(banner).getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(postCalls(TRUST_URL)).toHaveLength(1))
    expect(postCalls(TRUST_URL)[0]).toEqual({ url: `${TRUST_URL}/recall`, body: { state: 'sampled', sample_rate: 0.1 } })
    await waitFor(() => expect(screen.queryByTestId('trust-banner')).not.toBeInTheDocument())
    const strip = screen.getByTestId('trust-strip')
    expect(strip).toHaveTextContent('recall')
    expect(strip).toHaveTextContent('sampled')
    expect(strip).toHaveTextContent('spot')
    expect(strip).toHaveTextContent('3 clean')
  })

  it('"Not yet" dismisses the banner without a post', () => {
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByRole('button', { name: /recall · manual/ }))
    fireEvent.click(within(screen.getByTestId('trust-banner')).getByRole('button', { name: 'Not yet' }))
    expect(screen.queryByTestId('trust-banner')).not.toBeInTheDocument()
    expect(postCalls(TRUST_URL)).toHaveLength(0)
  })

  it('lane and type filters change the fetch key', () => {
    renderWithProviders(<StudyReview />)
    expect(KEYS).toContain('/api/study/admin/review?limit=150')
    fireEvent.change(screen.getByLabelText('Lane'), { target: { value: 'fast' } })
    expect(KEYS).toContain('/api/study/admin/review?lane=fast&limit=150')
    fireEvent.change(screen.getByLabelText('Item type'), { target: { value: 'spot' } })
    expect(KEYS).toContain('/api/study/admin/review?lane=fast&type=spot&limit=150')
    expect(reviewKey('second_look', 'tap')).toBe('/api/study/admin/review?lane=second_look&type=tap&limit=150')
  })

  it('shows lane and type counts and the corrections export link', () => {
    renderWithProviders(<StudyReview />)
    const lane = screen.getByLabelText('Lane')
    expect(within(lane).getByRole('option', { name: 'All lanes (3)' })).toBeInTheDocument()
    expect(within(lane).getByRole('option', { name: 'fast (2)' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Item type')).getByRole('option', { name: 'recall (1)' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Export corrections/ })
    expect(link).toHaveAttribute('href', EXPORT_URL)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('keys A/F/R are ignored while typing', () => {
    renderWithProviders(<StudyReview />)
    fireEvent.keyDown(screen.getByLabelText('Lane'), { key: 'a' })
    expect(postCalls(REVIEW_URL)).toHaveLength(0)
    expect(screen.queryByTestId('fix-editor')).not.toBeInTheDocument()
  })
})

describe('StudyReview helpers', () => {
  it('checksOf reads the importer flags whether a list or a JSON string', () => {
    const fromList = checksOf({ import_flags: ['ungrounded number (12.5)', 'near-duplicate of si_x (0.91)'] })
    expect(fromList.map((c) => [c.id, c.pass])).toEqual([['numbers', false], ['duplicate', false], ['voice', true]])
    const fromString = checksOf({ import_flags: JSON.stringify(['voice (question): banned phrase']) })
    expect(fromString.map((c) => [c.id, c.pass])).toEqual([['numbers', true], ['duplicate', true], ['voice', false]])
    expect(checksOf({ import_flags: null }).every((c) => c.pass)).toBe(true)
  })

  it('provenanceOf prefers the verbatim quote, then geometry, then the rule', () => {
    expect(provenanceOf({ reveal_json: { quote: 'word for word' } })).toEqual({ kind: 'quote', text: 'word for word' })
    expect(provenanceOf({ reveal_json: { rule: 'Position % = risk % / stop %' } })).toEqual({ kind: 'rule', text: 'Position % = risk % / stop %' })
    expect(provenanceOf({ reveal_json: {} })).toBeNull()
  })

  it('forwardSummaryOf prints the fair-scoring accept list and the window', () => {
    const s = forwardSummaryOf({ answer_json: { answer: 'take', accept: ['watch'] }, reveal_json: { facts: { window: 10 } } })
    expect(s).toBe('window 10 sessions · accepts watch (fair-scoring)')
    expect(forwardSummaryOf({ reveal_json: { window_bars: 60, fires: true } })).toBe('60 bars shown · fires: yes')
  })
})
