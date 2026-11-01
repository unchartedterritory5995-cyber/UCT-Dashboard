import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, waitFor, within } from '../../test-utils'
import PatternReview from './PatternReview'
import { registerShortcuts } from '../command/shortcutRegistry'
import KeyboardHelpOverlay from '../../components/chart/KeyboardHelpOverlay'
import ChartContextMenu from '../../components/chart/ChartContextMenu'
import StudyReview, { REVIEW_URL, TRUST_URL, EXPORT_URL, reviewKey, checksOf, provenanceOf, supportLineOf, forwardSummaryOf, chartFrameOf } from './StudyReview'

// The chart stand-in prints the props the review card is responsible for as
// TEXT: the REVEALED ticker, the frame around the cutoff, and the cutoff marker.
vi.mock('../../components/StockChart', () => ({
  default: ({ sym, entryDate, exitDate, markers, priceLines, barsOverride, barsOverridePending, studyMode, annotations, annotationsVisible, settingsOverride, highlightBarTime, highlightColor }) => (
    <div data-testid="stock-chart">
      <span>chart:{sym}</span>
      <span>bars:{Array.isArray(barsOverride) ? barsOverride.length : (barsOverridePending ? 'pending' : 'none')}</span>
      <span>first:{Array.isArray(barsOverride) && barsOverride[0] ? String(barsOverride[0].t) : '-'}</span>
      <span>last:{Array.isArray(barsOverride) && barsOverride.length ? String(barsOverride[barsOverride.length - 1].t) : '-'}</span>
      <span>study:{studyMode ? '1' : '0'}</span>
      <span>frame:{entryDate || '-'}..{exitDate || '-'}</span>
      <span>markers:{(markers || []).map((m) => m.text).join('|')}</span>
      <span>lines:{(priceLines || []).length}</span>
      <span>annotations:{annotations ? annotations.map((a) => `${a.type}@${a.points[0].time}${a.points[0].price != null ? '=' + a.points[0].price : ''}`).join('|') : '-'}</span>
      <span>annotationsVisible:{annotationsVisible ? '1' : '0'}</span>
      <span>highlight:{Array.isArray(highlightBarTime) ? highlightBarTime.join('|') : '-'}{highlightColor ? '@' + highlightColor : ''}</span>
      <span>instances:{(settingsOverride?.indicatorInstances || []).map((i) => i.instanceId).join('|') || '-'}</span>
    </div>
  ),
}))
vi.mock('../../utils/chartCapture', () => ({ captureChartPng: () => 'data:image/png;base64,QQ==' }))

let DRAFTS
let TRUST
let COUNTS
let SKILLS
let KEYS
let FEEDBACK_COUNTS = { open: {}, open_total: 0, total: 0 }
let FEEDBACK_ROWS = []
let HUB_DATA
const HUB_MUTATE = vi.fn()

vi.mock('swr', () => ({
  default: (key) => {
    KEYS.push(key)
    if (key && key.startsWith('/api/study/admin/review')) {
      return { data: { drafts: DRAFTS, counts: COUNTS, skills: SKILLS, trust: TRUST, feedback: FEEDBACK_COUNTS }, error: undefined, mutate: vi.fn() }
    }
    if (key && key.startsWith('/api/study/admin/feedback')) {
      return { data: { feedback: FEEDBACK_ROWS, counts: FEEDBACK_COUNTS }, error: undefined, mutate: vi.fn() }
    }
    if (key && key.startsWith('/api/study/admin/hub')) return { data: HUB_DATA, error: undefined, mutate: HUB_MUTATE }
    if (key && key.includes('/patterns/admin/review')) return { data: { verdicts: [] }, mutate: vi.fn() }
    if (key && /^\/api\/study\/admin\/items\/[^/]+\/bars$/.test(key)) {
      return { data: STORED_BARS, error: undefined, mutate: vi.fn() }
    }
    return { data: undefined, mutate: vi.fn() }
  },
}))

// What the admin bars route returns for a chart item: the member's visible
// window plus the forward strip, symbol = the item id (never the ticker).
const DEFAULT_STORED_BARS = {
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
let STORED_BARS = DEFAULT_STORED_BARS

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
  STORED_BARS = DEFAULT_STORED_BARS
  TRUST = {
    spot: { item_type: 'spot', clean_count: 3, state: 'manual', ask_to_switch: false, ask_at: 20 },
    recall: { item_type: 'recall', clean_count: 20, state: 'manual', ask_to_switch: true, ask_at: 20 },
  }
  COUNTS = { fast: { spot: 2 }, manual: { recall: 1 } }
  SKILLS = { 'setup.vcp': 2, 'vocab.method': 1 }
  FEEDBACK_COUNTS = { open: { si_a: 2 }, open_total: 3, total: 4 }
  FEEDBACK_ROWS = [
    { id: 7, item_id: 'si_a', sym: 'NVDA', asof: '2025-06-02', subject: 'VCP', kind: 'unclear_lesson',
      text: 'the where part lost me', role: 'member', channel: 'site', verdict: null, answer_json: 'no', correct: false,
      at: '2026-10-21T03:00:00+00:00', handled_at: null, ref: 'a', q: 'VCP?' },
    { id: 8, item_id: 'si_zz', sym: 'CAVA', asof: '2025-12-10', subject: 'Hanging Man', kind: 'bad_chart',
      text: 'bars too small', role: 'owner', channel: 'discord', verdict: 'reject', answer_json: null, correct: null,
      at: '2026-10-21T03:05:00+00:00', handled_at: null, ref: 'zz', q: 'Which candle?' },
  ]
  HUB_MUTATE.mockClear()
  HUB_DATA = {
    sections: [{ skill_id: 'vocab.candle', approved: 604, draft: 172, rejected: 222, retired: 0, total: 998 }],
    tree: [{ id: 'method', title: 'The UCT Method', counts: { approved: 6, draft: 690, rejected: 0, retired: 0, total: 696 },
      tracks: [{ id: 'REG', title: 'Regime', counts: { approved: 0, draft: 64, rejected: 0, retired: 0, total: 64 },
        units: [{ id: 'REG.02', title: 'The exposure dial', skills: ['regime.dial'], counts: { approved: 0, draft: 7, rejected: 0, retired: 0, total: 7 } },
          { id: 'REG.09', title: 'An empty unit', skills: [], counts: { approved: 0, draft: 0, rejected: 0, retired: 0, total: 0 } }] }] }],
    unplaced: [{ skill_id: 'vocab.candle', approved: 604, draft: 172, rejected: 222, retired: 0, total: 998 }],
    lessons: [
      { key: 'hammer', label: 'Hammer', axis: 'shape', bars: 1, parts_from: 'approved', charts: { approved: 14 }, text: {},
        parts: { shape: 'A small body near the top.', story: 'Sellers pushed, buyers took it back.', where: 'After a fall.',
          confirm: 'A higher close next.', cancel: 'A close under the low.', desk: 'Mark the low.' },
        verdict: { id: 3, verdict: 'approve', text: null, at: '2026-10-21T04:00:00+00:00' }, notes_open: 1, example_id: 'si_h' },
      { key: 'deliberation', label: 'Deliberation', axis: 'relation', bars: 3, parts_from: 'draft', charts: {}, text: { draft: 3 },
        parts: { shape: 'Three white bodies, the last small.' }, verdict: null, notes_open: 0, example_id: null },
    ],
    feedback: { open: {}, open_screens: {}, open_total: 0, total: 0 },
  }
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
    // Stored ints (20250529) reach the chart as the dates it reads ('2025-05-29'),
    // visible first, forward last: the shape the member's drill hands it.
    expect(chart).toHaveTextContent('first:2025-05-29')
    expect(chart).toHaveTextContent('last:2025-06-04')
    expect(chart).toHaveTextContent('study:1')
    expect(KEYS).toContain('/api/study/admin/items/si_a/bars')
    expect(chart).toHaveTextContent('frame:2024-11-27..2025-07-07')
    expect(chart).toHaveTextContent('markers:member sees to here')
    expect(chart).toHaveTextContent('lines:3')
    expect(screen.getByText(/Member sees bars through 2025-06-02/)).toBeInTheDocument()
  })

  it('draws no annotation layer for a non-HVE chart item', () => {
    renderWithProviders(<StudyReview />)
    const chart = screen.getByTestId('stock-chart')
    expect(chart).toHaveTextContent('annotations:-')
    expect(chart).toHaveTextContent('annotationsVisible:0')
  })

  it('draws the gap top and gap-day low rays from the gap day for a Gap Support item', () => {
    // the stored bars are 2025-05-29, 05-30, 06-02 (cutoff) + forward; the gap day is the 05-30 bar
    // (low 100), the gap top is stored at 98.5; both rays start on the gap bar
    DRAFTS = [{ ...SPOT_A, id: 'si_gap', sym: 'TTD', skill_id: 'setup.family3.gap_support',
                reveal_json: { ...SPOT_A.reveal_json, facts: { ...SPOT_A.reveal_json.facts, gap_asof: '2025-05-30', gap_top: 98.5 } } }, SPOT_C, RECALL_B]
    renderWithProviders(<StudyReview />)
    const chart = screen.getByTestId('stock-chart')
    expect(chart).toHaveTextContent('annotations:hray@2025-05-30=98.5|hray@2025-05-30=100')
    expect(chart).toHaveTextContent('annotationsVisible:1')
  })

  it('carries the E4H (4-EMA of highs) as an engine instance for a Slingshot item only (owner ruling 2026-10-25)', () => {
    DRAFTS = [{ ...SPOT_A, id: 'si_sling', sym: 'VRT', skill_id: 'setup.family4.slingshot' }, SPOT_C, RECALL_B]
    renderWithProviders(<StudyReview />)
    const chart = screen.getByTestId('stock-chart')
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('VRT')
    expect(chart).toHaveTextContent('instances:study:slingshot-e4h')
  })

  it('carries no E4H instance for a non-Slingshot chart item', () => {
    renderWithProviders(<StudyReview />)
    expect(screen.getByTestId('stock-chart')).not.toHaveTextContent('study:slingshot-e4h')
  })

  it('draws the HVC ray and the AVWAP off the cutoff bar for a High Volume Edge item (owner ruling 2026-10-25)', () => {
    // The cutoff bar is the stored 2025-06-02 bar (close 102.5); the ray sits on
    // that close and the AVWAP is anchored on that same bar, so the reviewer sees
    // exactly the layer the member gets on reveal, over the same stored bars.
    DRAFTS = [{ ...SPOT_A, id: 'si_hve', sym: 'NAVN', skill_id: 'setup.family3.hve' }, SPOT_C, RECALL_B]
    renderWithProviders(<StudyReview />)
    const chart = screen.getByTestId('stock-chart')
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('NAVN')
    expect(chart).toHaveTextContent('annotations:hray@2025-06-02=102.5|avwap@2025-06-02')
    expect(chart).toHaveTextContent('annotationsVisible:1')
  })

  it('paints the first three hourly bars of the ruled session white and points the arrow at the open (owner 2026-10-31)', () => {
    STORED_BARS = { id: 'sb_h', tf: '60', bars: [1793104200, 1793107800, 1793111400, 1793115000, 1793118600].map((t, i) => ({ t, o: 10, h: 11, l: 9, c: 10.5, v: 1 + i })), forward: [] }
    DRAFTS = [{ ...SPOT_A, id: 'si_hourly', sym: 'WING', asof: '2026-10-27', skill_id: 'setup.intraday.go_signal',
      prompt_json: { ...SPOT_A.prompt_json, chart: { window_bars: 112, tf: '60' } },
      reveal_json: { facts: { flag_start_t: 1793104200, first_hour_t: 1793107800, flag_low: 9.5, flag_high: 10.8 } } }, SPOT_C, RECALL_B]
    renderWithProviders(<StudyReview />)
    const chart = screen.getByTestId('stock-chart')
    expect(chart).toHaveTextContent('highlight:1793107800|1793111400|1793115000@#ffffff')
    expect(chart).toHaveTextContent('markers:the open: first 3 hours in white')
    expect(screen.getByTestId('study-closeup')).toHaveTextContent('Open close-up')
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

  it('Escape leaves the fix editor and the reject panel', () => {
    renderWithProviders(<StudyReview />)
    fireEvent.keyDown(document.body, { key: 'f' })
    expect(screen.getByTestId('fix-editor')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('fix-editor')).not.toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'r' })
    expect(screen.getByTestId('reject-panel')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('reject-panel')).not.toBeInTheDocument()
  })

  it('upper-case letters (Caps Lock) act like lower-case ones', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.keyDown(document.body, { key: 'N' })
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('TSLA')
    fireEvent.keyDown(document.body, { key: 'P' })
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('NVDA')
    fireEvent.keyDown(document.body, { key: 'F' })
    expect(screen.getByTestId('fix-editor')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'R' })
    expect(screen.getByTestId('reject-panel')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'A' })
    await waitFor(() => expect(postCalls(REVIEW_URL)).toHaveLength(1))
    expect(postCalls(REVIEW_URL)[0].body).toEqual({ action: 'approve' })
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

  it('the skill filter lists every skill with its draft count and narrows the fetch', () => {
    renderWithProviders(<StudyReview />)
    const sel = screen.getByLabelText('Skill')
    expect(within(sel).getByRole('option', { name: 'vocab.method (1)' })).toBeInTheDocument()
    expect(within(sel).getByRole('option', { name: 'setup.vcp (2)' })).toBeInTheDocument()
    fireEvent.change(sel, { target: { value: 'vocab.method' } })
    // a skill is served whole (up to the route's 500), so a segment imported behind 374
    // older drafts of the same type still reaches the reviewer
    expect(KEYS).toContain('/api/study/admin/review?skill=vocab.method&limit=500')
    expect(reviewKey('', 'recall', 150, 'vocab.chart')).toBe('/api/study/admin/review?type=recall&skill=vocab.chart&limit=150')
  })

  it('the example gallery shows every chart of one subject with a grade row, and a grade posts the grade action', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByRole('button', { name: 'Example gallery' }))
    expect(KEYS).toContain('/api/study/admin/review?status=any&light=1&limit=5000')
    const cards = screen.getAllByTestId('gallery-card')
    expect(cards.length).toBe(2)                       // SPOT_A + SPOT_C share the subject (vcp); the recall item has no chart
    expect(within(cards[0]).getByText('chart:NVDA')).toBeInTheDocument()
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Good' }))
    await waitFor(() => expect(postCalls(REVIEW_URL + '/si_a')).toHaveLength(1))
    expect(postCalls(REVIEW_URL + '/si_a')[0].body).toEqual({ action: 'grade', after: 'good' })
    fireEvent.click(within(cards[1]).getByRole('button', { name: 'Bad' }))
    await waitFor(() => expect(postCalls(REVIEW_URL + '/si_c')).toHaveLength(1))
    expect(postCalls(REVIEW_URL + '/si_c')[0].body).toEqual({ action: 'reject', reason: 'bad chart' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to the queue' }))
    expect(screen.queryAllByTestId('gallery-card')).toHaveLength(0)
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

  it('provenanceOf shows the firm support lines over the AI-brief quote', () => {
    const prov = provenanceOf({
      reveal_json: {
        quote: 'computed from breadth, distribution days and index MA structure',
        support: [
          'C:/Users/pgosz/projects/morning-wire/morning_wire_engine.py calculate_exposure: "0-150, IS the recommended exposure %"',
          'arithmetic: 5 positions x 1% = 5% heat',
        ],
      },
    })
    expect(prov).toEqual({
      kind: 'support',
      lines: [
        { source: 'morning-wire/morning_wire_engine.py calculate_exposure', text: '"0-150, IS the recommended exposure %"' },
        { source: '', text: 'arithmetic: 5 positions x 1% = 5% heat' },
      ],
    })
    expect(supportLineOf('docs/study/sizing_rule.md §2: "stop first"')).toEqual({ source: 'docs/study/sizing_rule.md §2', text: '"stop first"' })
    expect(provenanceOf({ reveal_json: { quote: 'q', support: [] } })).toEqual({ kind: 'quote', text: 'q' })
  })

  it('forwardSummaryOf prints the fair-scoring accept list and the window', () => {
    const s = forwardSummaryOf({ answer_json: { answer: 'take', accept: ['watch'] }, reveal_json: { facts: { window: 10 } } })
    expect(s).toBe('window 10 sessions · accepts watch (fair-scoring)')
    expect(forwardSummaryOf({ reveal_json: { window_bars: 60, fires: true } })).toBe('60 bars shown · fires: yes')
  })
})

// ── the feedback panel (owner 2026-10-21) ─────────────────────────────────────
describe('StudyReview feedback panel', () => {
  it('the toggle counts the open feedback, the queue row carries its notes, and the panel lists every row', () => {
    renderWithProviders(<StudyReview />)
    const toggle = screen.getByTestId('feedback-toggle')
    expect(toggle).toHaveTextContent('Feedback (3)')
    expect(screen.getByTestId('row-feedback')).toHaveTextContent('2 notes')
    fireEvent.click(toggle)
    expect(KEYS.some((k) => k === '/api/study/admin/feedback?unhandled=1&limit=500')).toBe(true)
    const rows = screen.getAllByTestId('feedback-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('NVDA')
    expect(rows[0]).toHaveTextContent('lesson unclear')
    expect(rows[0]).toHaveTextContent('the where part lost me')
    expect(rows[0]).toHaveTextContent('member · the site')
    expect(rows[0]).toHaveTextContent('answered no (not quite)')
    expect(rows[1]).toHaveTextContent('Hanging Man')
    expect(rows[1]).toHaveTextContent('reject')
    expect(rows[1]).toHaveTextContent('owner · Discord')
    // the card is hidden while the panel is up; Open is offered only for an item in the queue
    expect(screen.getByTestId('study-ticker').closest('[hidden]')).not.toBeNull()
    expect(within(rows[0]).getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
  })

  it('Handled posts the id and drops the row; Open returns to the queue on that item', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByTestId('feedback-toggle'))
    const rows = screen.getAllByTestId('feedback-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Handled' }))
    await waitFor(() => {
      const call = globalThis.fetch.mock.calls.find(([url]) => String(url) === '/api/study/admin/feedback/handle')
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ ids: [7] })
    })
    fireEvent.click(within(screen.getAllByTestId('feedback-row')[0]).getByRole('button', { name: 'Open' }))
    expect(screen.getByTestId('study-ticker').closest('[hidden]')).toBeNull()
    expect(screen.getByTestId('feedback-toggle')).toHaveTextContent('Feedback (3)')
  })
})

// ── the review hub + screen notes (owner 2026-10-21) ──────────────────────────
describe('StudyReview hub', () => {
  it('the hub lays the counts on the course map and lists every lesson with its verdict', () => {
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByTestId('hub-toggle'))
    expect(screen.getByTestId('hub-toggle')).toHaveTextContent('Back to the queue')
    expect(screen.getByTestId('study-ticker').closest('[hidden]')).not.toBeNull()
    const sections = screen.getByTestId('hub-sections')
    expect(sections).toHaveTextContent('The UCT Method')
    expect(sections).toHaveTextContent('690 waiting')
    expect(sections).toHaveTextContent('The exposure dial')
    expect(sections).toHaveTextContent('nothing yet')
    expect(sections).toHaveTextContent('Not on the course map')
    expect(sections).toHaveTextContent('604 live · 172 waiting · 222 rejected')
    const lessons = screen.getAllByTestId('hub-lesson')
    expect(lessons.map((l) => l.dataset.key)).toEqual(['hammer', 'deliberation'])
    expect(lessons[0]).toHaveTextContent('14 live examples')
    expect(lessons[0]).toHaveTextContent('Approved')
    expect(lessons[1]).toHaveTextContent('Not reviewed')
    expect(screen.getByTestId('hub-lessons')).toHaveTextContent('1 of 2 reviewed')
  })

  it('opening a lesson reads its six parts; Needs fix needs words and posts a lesson note', async () => {
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByTestId('hub-toggle'))
    const hammer = screen.getAllByTestId('hub-lesson')[0]
    fireEvent.click(within(hammer).getByRole('button', { name: /Hammer/ }))
    expect(hammer).toHaveTextContent('The shape')
    expect(hammer).toHaveTextContent('Sellers pushed, buyers took it back.')
    expect(hammer).toHaveTextContent('At the desk')
    fireEvent.click(within(hammer).getByRole('radio', { name: 'Needs fix' }))
    expect(within(hammer).getByTestId('lesson-door-send')).toBeDisabled()
    fireEvent.change(within(hammer).getByLabelText('Your note'), { target: { value: 'say where the low is' } })
    fireEvent.click(within(hammer).getByTestId('lesson-door-send'))
    await waitFor(() => expect(postCalls('/api/study/admin/screen-feedback')).toHaveLength(1))
    expect(postCalls('/api/study/admin/screen-feedback')[0].body).toEqual({
      screen: 'lessons', kind: 'learning', verdict: 'fix', text: 'say where the low is',
      context: { lesson_key: 'hammer', label: 'Hammer' },
    })
    await waitFor(() => expect(HUB_MUTATE).toHaveBeenCalled())
  })

  it('a lesson read from a draft says so; the filter keeps the unreviewed ones', () => {
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByTestId('hub-toggle'))
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'todo' } })
    const only = screen.getAllByTestId('hub-lesson')
    expect(only.map((l) => l.dataset.key)).toEqual(['deliberation'])
    fireEvent.click(within(only[0]).getByRole('button', { name: /Deliberation/ }))
    expect(only[0]).toHaveTextContent('Read from a draft item')
  })

  it('the card keys do nothing while a panel covers the card', async () => {
    renderWithProviders(<StudyReview />)
    for (const toggle of ['hub-toggle', 'feedback-toggle']) {
      fireEvent.click(screen.getByTestId(toggle))
      fireEvent.keyDown(document.body, { key: 'a' })
      fireEvent.keyDown(document.body, { key: 'f' })
      fireEvent.click(screen.getByTestId(toggle))                 // back to the queue
    }
    expect(postCalls(REVIEW_URL)).toHaveLength(0)
    expect(screen.queryByTestId('fix-editor')).not.toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'a' })                 // the card is back: A works again
    await waitFor(() => expect(postCalls(REVIEW_URL)).toHaveLength(1))
  })

  it('the review screen has its own screen door, naming the view it was left on', async () => {
    renderWithProviders(<StudyReview />)
    expect(screen.getByTestId('screen-feedback').dataset.screen).toBe('review')
    fireEvent.click(screen.getByTestId('hub-toggle'))
    expect(screen.getByTestId('screen-feedback').dataset.screen).toBe('lessons')
    fireEvent.click(screen.getByTestId('hub-toggle'))
    fireEvent.click(screen.getByTestId('screen-feedback-open'))
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
    fireEvent.click(screen.getByTestId('screen-feedback-send'))
    await waitFor(() => expect(postCalls('/api/study/admin/screen-feedback')).toHaveLength(1))
    expect(postCalls('/api/study/admin/screen-feedback')[0].body).toMatchObject({
      screen: 'review', kind: 'layout', context: { item_id: 'si_a' } })
  })

  it('the feedback list marks a screen note with its screen and what it showed, and offers no Open', () => {
    FEEDBACK_ROWS = [{ id: 9, item_id: '', screen: 'reveal', context: { item_id: 'si_a', question: 3 }, kind: 'layout',
      text: 'door under Continue', role: 'owner', channel: 'site', verdict: null, answer_json: null, correct: null,
      at: '2026-10-21T05:00:00+00:00', handled_at: null, ref: null }]
    renderWithProviders(<StudyReview />)
    fireEvent.click(screen.getByTestId('feedback-toggle'))
    const row = screen.getByTestId('feedback-row')
    expect(row.dataset.screen).toBe('reveal')
    expect(row).toHaveTextContent('Screen · Answer reveal')
    expect(row).toHaveTextContent('door under Continue')
    expect(row).toHaveTextContent('on item_id si_a · question 3')
    expect(row).not.toHaveTextContent('ref ')
    expect(within(row).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('feedback-scope'), { target: { value: 'screens' } })
    expect(KEYS).toContain('/api/study/admin/feedback?unhandled=1&limit=500&screen=any')
    fireEvent.change(screen.getByTestId('feedback-scope'), { target: { value: 'items' } })
    expect(KEYS).toContain('/api/study/admin/feedback?unhandled=1&limit=500&screen=none')
  })
})

// Review M4: one key press is answered by the topmost surface only. A stand-in modal layer (what
// the command palette or a ticker popup is: role="dialog" aria-modal) opened over the surface, and
// a live video binding, are the two things that used to answer the same press as well.
const openModalLayer = () => {
  const el = document.createElement('div')
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  document.body.appendChild(el)
  return () => el.remove()
}

describe('the card answers its keys only as the topmost surface', () => {
  it('with a modal layer (palette, ticker popup) over the card, its keys do nothing; Shift+F belongs to the layer', () => {
    renderWithProviders(<StudyReview />)
    const close = openModalLayer()
    fireEvent.keyDown(document.body, { key: 'n' })
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('NVDA')
    fireEvent.keyDown(document.body, { key: 'F', shiftKey: true })
    expect(screen.queryByTestId('fix-editor')).not.toBeInTheDocument()
    close()
    fireEvent.keyDown(document.body, { key: 'n' })
    expect(screen.getByTestId('study-ticker')).toHaveTextContent('TSLA')
  })

  it('F and Escape on the card do not also reach the video player keys', () => {
    const fullscreen = vi.fn()
    const escape = vi.fn()
    const off = registerShortcuts({ 'video.fullscreen': fullscreen, 'video.escape': escape })
    try {
      renderWithProviders(<StudyReview />)
      fireEvent.keyDown(document.body, { key: 'f' })
      expect(screen.getByTestId('fix-editor')).toBeInTheDocument()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.queryByTestId('fix-editor')).not.toBeInTheDocument()
      expect(fullscreen).not.toHaveBeenCalled()
      expect(escape).not.toHaveBeenCalled()
      fireEvent.keyDown(document.body, { key: 'Escape' })   // card in view mode: not its key
      expect(escape).toHaveBeenCalledTimes(1)
    } finally { off() }
  })
})

// Review R1: in fix mode, `?` on the card's chart opens the chart's Keyboard Shortcuts overlay, a
// backdrop modal. Escape then closes only the overlay; the card stays in fix mode.
describe('Escape over the card goes to the top modal', () => {
  it('with the chart keyboard help open in fix mode, Escape closes the help and keeps fix mode', () => {
    const onClose = vi.fn()
    renderWithProviders(<><StudyReview /><KeyboardHelpOverlay open onClose={onClose} /></>)
    fireEvent.click(screen.getByRole('button', { name: /Fix/ }))
    expect(screen.getByTestId('fix-editor')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('fix-editor')).toBeInTheDocument()
  })
})

// Review R2: the chart's click-dismiss popups (its right-click menu, the earnings popover, the IPO
// tag) close on Escape. They are not modal, so they carry data-escape-layer, which lib/topLayer.js
// counts as a layer: Escape in fix mode with the menu open closes the menu, not the mode.
describe('Escape over the card goes to an open chart popup', () => {
  it('with the chart right-click menu open in fix mode, Escape closes the menu and keeps fix mode', () => {
    const onClose = vi.fn()
    const sections = [{ id: 's', items: [{ id: 'i', label: 'Reset view', onSelect: () => {} }] }]
    renderWithProviders(<><StudyReview /><ChartContextMenu open x={10} y={10} sections={sections} onClose={onClose} /></>)
    fireEvent.click(screen.getByRole('button', { name: /Fix/ }))
    expect(screen.getByTestId('fix-editor')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('fix-editor')).toBeInTheDocument()
  })
})

describe('chartFrameOf', () => {
  it('frames a daily item by its window_bars as sessions', () => {
    const f = chartFrameOf({ asof: '2024-03-19', prompt_json: { chart: { window_bars: 120, tf: 'D' } }, reveal_json: {} })
    expect(f.entryDate).toBe('2023-09-14')   // 180 + 7 days back
    expect(f.forward).toBe(20)
  })
  it('frames an HOURLY item by sessions, not hourly bars (112 bars = 16 sessions, forward 5)', () => {
    const f = chartFrameOf({
      asof: '2026-10-16', bars_embed: { tf: '60' },
      prompt_json: { chart: { window_bars: 112, tf: '60' } }, reveal_json: { window_bars: 112, facts: {} },
    })
    expect(f.entryDate).toBe('2026-09-15')   // ceil(16*1.5)+7 = 31 days back, not 175
    expect(f.forward).toBe(5)
    expect(f.exitDate).toBe('2026-10-29')
  })
  it('close-up frames only the sessions around the ruled open of an hourly item (owner 2026-10-31)', () => {
    const item = { asof: '2026-10-16', bars_embed: { tf: '60' }, prompt_json: { chart: { window_bars: 112, tf: '60' } }, reveal_json: {} }
    const f = chartFrameOf(item, { closeUp: true })
    expect(f.entryDate).toBe('2026-10-10')
    expect(f.exitDate).toBe('2026-10-20')
    expect(f.closeUp).toBe(true)
    // a daily item has no close-up: the flag is ignored
    const d = chartFrameOf({ asof: '2026-10-16', prompt_json: { chart: { window_bars: 120, tf: 'D' } }, reveal_json: {} }, { closeUp: true })
    expect(d.closeUp).toBeUndefined()
    expect(d.entryDate).toBe('2026-04-12')
  })
  it('reads the available forward sessions when an hourly item records fewer than five', () => {
    const f = chartFrameOf({
      asof: '2026-10-27', bars_embed: { tf: '60' },
      prompt_json: { chart: { window_bars: 112, tf: '60' } }, reveal_json: { facts: { fwd_sessions_available: 3 } },
    })
    expect(f.forward).toBe(3)
  })
})
