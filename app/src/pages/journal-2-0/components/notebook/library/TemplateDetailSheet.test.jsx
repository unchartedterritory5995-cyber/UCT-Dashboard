// Task 11.16: a Template library item's detail, with the member's own data.
//
// A fake server answers `GET /template-gallery/{id}` (the outline) and `POST /{id}/preview-mine` in Task 11.9's shape
// (`{slots, cards: [{slot, title, payload | sentence, sample}], tools: [{slot, kind, name, items | trackerKind, bind,
// forDayLabel}], questions, credit}`) and records every request. The built view is stood in for (its own suites cover
// it): this file proves WHICH payload reaches it, and that the "Sample data" label follows the server's `sample`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TemplateDetailSheet, { DATA_HEADING, USE_TEMPLATE_LABEL } from './TemplateDetailSheet'
import { openAdoptSheet } from './openAdoptSheet'
import { bindWords } from '../../../lib/templateSlots'
import { SAMPLE_RIBBON } from '../widgetBuilder/ExampleCard'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('./openAdoptSheet', () => ({ openAdoptSheet: vi.fn(() => () => {}) }))
vi.mock('../widgets/BuiltWidgetEmbed', () => ({
  default: ({ attrs }) => <div data-built-view={attrs?.params?.view || ''} data-built-title={attrs?.params?.title || ''} />,
}))

const ITEM = { id: 'g-open', title: 'Pre-market prep', author: 'UCT', itemType: 'style', group: 'before_open' }
const OUTLINE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The plan' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'What would make today a good day?' }] },
  ],
}
const CREDIT = "Based on UCT's Pre-market prep"
const PREVIEW = {
  slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: false, suggested: null, value: null }],
  cards: [
    { slot: 'built_a', title: 'Win rate by setup', payload: { view: 'bar', title: 'Win rate by setup' }, sample: true },
    { slot: 'built_b', title: 'Setup study', sentence: 'Pick a setup to see this widget.', sample: false },
    { slot: 'built_c', title: 'R by hour', payload: { view: 'line', title: 'R by hour' }, sample: false },
  ],
  tools: [
    // The fields a routine must never show: a tick, a day state, a value, a day stamp.
    { slot: 'routine_a', kind: 'routine', name: 'Pre-market routine', bind: 'next-trading-day',
      items: [{ text: 'Check futures' }, 'Mark levels'], ticks: { i1: true }, state: 'done', value: 7, day: '2026-10-24' },
    { slot: 'tracker_a', kind: 'tracker', name: 'Focus', trackerKind: 'scale', bind: 'note-day', value: 9 },
  ],
  questions: [],
  credit: CREDIT,
}

let calls
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
function installServer({ preview = PREVIEW, previewStatus = 200 } = {}) {
  calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    calls.push({ path: u.pathname, method, body: init.body ? JSON.parse(init.body) : null })
    if (u.pathname.endsWith('/preview-mine') && method === 'POST') return json(previewStatus, preview)
    if (u.pathname === `/api/j2/template-gallery/${ITEM.id}` && method === 'GET') {
      return json(200, { template: { ...ITEM, bodyJson: OUTLINE } })
    }
    return json(404, {})
  })
}

beforeEach(() => { installServer(); openAdoptSheet.mockClear() })
afterEach(cleanup)

async function open(props = {}) {
  const onClose = vi.fn()
  const navigate = vi.fn()
  render(<TemplateDetailSheet item={ITEM} onClose={onClose} navigate={navigate} {...props} />)
  await screen.findByText('Win rate by setup')
  return { onClose, navigate }
}
const previewCalls = () => calls.filter((c) => c.path.endsWith('/preview-mine'))

describe('the template detail', () => {
  it('detail_calls_preview_mine_once_and_labels_sample', async () => {
    await open()
    await waitFor(() => expect(document.querySelectorAll('[data-built-view]').length).toBe(2))
    expect(previewCalls()).toEqual([{ path: '/api/j2/template-gallery/g-open/preview-mine', method: 'POST', body: {} }])
    // The outline first, through the picker's own renderer.
    expect(screen.getByRole('heading', { name: 'The plan' })).toBeInTheDocument()
    expect(screen.getByText('What would make today a good day?')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: DATA_HEADING })).toBeInTheDocument()
    // Each card's payload reaches the built view; "Sample data" sits on the sample card ONLY.
    const a = document.querySelector('[data-preview-card="built_a"]')
    const c = document.querySelector('[data-preview-card="built_c"]')
    expect(a.querySelector('[data-built-view]').getAttribute('data-built-view')).toBe('bar')
    expect(c.querySelector('[data-built-view]').getAttribute('data-built-view')).toBe('line')
    expect(within(a).getByText(SAMPLE_RIBBON)).toBeInTheDocument()
    expect(within(c).queryByText(SAMPLE_RIBBON)).toBeNull()
    // A card the server could not run is its sentence, as given, and is never drawn.
    const b = document.querySelector('[data-preview-card="built_b"]')
    expect(within(b).getByText('Pick a setup to see this widget.')).toBeInTheDocument()
    expect(b.querySelector('[data-built-view]')).toBeNull()
    // The credit is the server's line, as it came.
    expect(document.querySelector('[data-credit]').textContent).toBe(CREDIT)
    // Nothing else is asked: one outline read, one preview, no write.
    expect(calls.filter((c2) => c2.method !== 'GET' && !c2.path.endsWith('/preview-mine'))).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it('routine_slot_preview_has_no_day_state', async () => {
    await open()
    const routine = document.querySelector('[data-preview-tool="routine_a"]')
    expect(within(routine).getByText('Pre-market routine')).toBeInTheDocument()
    expect(within(routine).getByText('Check futures')).toBeInTheDocument()
    expect(within(routine).getByText('Mark levels')).toBeInTheDocument()
    expect(within(routine).getByText(bindWords('next-trading-day'))).toBeInTheDocument()
    expect(routine.textContent).not.toMatch(/done|2026-10-24|\b7\b/)
    expect(routine.querySelector('input[type="checkbox"]')).toBeNull()
    const tracker = document.querySelector('[data-preview-tool="tracker_a"]')
    expect(within(tracker).getByText('Focus')).toBeInTheDocument()
    expect(within(tracker).getByText(bindWords('note-day'))).toBeInTheDocument()
    expect(tracker.textContent).not.toMatch(/\b9\b/)
    // No routine or tracker read: the preview's answer is the only source.
    expect(calls.some((c) => /routine|tracker|tick/i.test(c.path))).toBe(false)
  })

  it('use_opens_adopt_sheet (the template kind, with no title or author: the credit is the server\'s)', async () => {
    const { onClose, navigate } = await open()
    await userEvent.setup().click(screen.getByRole('button', { name: USE_TEMPLATE_LABEL }))
    await waitFor(() => expect(openAdoptSheet).toHaveBeenCalledTimes(1))
    expect(openAdoptSheet.mock.calls[0][0]).toEqual({ galleryId: 'g-open', kind: 'template', navigate })
    expect(onClose).toHaveBeenCalledTimes(1)
    // Opening the adoption sheet is not a write from here.
    expect(calls.filter((c) => c.method === 'POST' && !c.path.endsWith('/preview-mine'))).toEqual([])
  })

  it('a rate refusal is the server\'s own sentence', async () => {
    const RATE = 'Too many previews in an hour. Try again later.'
    installServer({ previewStatus: 429, preview: { detail: { code: 'rate', message: RATE } } })
    render(<TemplateDetailSheet item={ITEM} onClose={() => {}} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(RATE)
    expect(previewCalls()).toHaveLength(1)
    expect(document.querySelector('[data-built-view]')).toBeNull()
  })
})
