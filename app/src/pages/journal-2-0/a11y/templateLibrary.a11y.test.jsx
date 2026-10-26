// app/src/pages/journal-2-0/a11y/templateLibrary.a11y.test.jsx
//
// Notebook widgets wave 11 (Task 11.18 fix round 1, c4): the template library's surfaces through 8A's axe harness,
// in a state a member meets. Each recipe asserts what painted before axe runs, so an empty screen cannot pass as a
// clean one. `fetch` is a fake of Task 11.12's routes (the shapes the surfaces' own tests code against):
//   * my-tools-templates          -- My tools > Templates: the member's own templates, with a library credit;
//   * template-library-section    -- the Template library section: group headings and cards with their facts;
//   * template-detail-sheet       -- a template's detail: its outline and the preview with the member's data;
//   * template-adopt-sheet        -- "Make it yours": the choices, the preview cards and the routine;
//   * template-slot-picker        -- one choice's picker, its values loaded;
//   * template-share-preview      -- the share preview for a widget: what travels, the fields, the kept number;
//   * helpful-prompt-line         -- the 3rd-day "Was <title> helpful?" line.
import { describe, beforeEach, afterEach, vi, expect } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { axeSurface } from './surface'
import MyToolsSheet from '../components/notebook/myTools/MyToolsSheet'
import TemplateLibrarySection, { SECTION_TITLE } from '../components/notebook/library/TemplateLibrarySection'
import TemplateDetailSheet, { DATA_HEADING } from '../components/notebook/library/TemplateDetailSheet'
import AdoptSheet, { TITLE as ADOPT_TITLE } from '../components/notebook/library/AdoptSheet'
import SlotPicker from '../components/notebook/library/SlotPicker'
import SharePreviewSheet from '../components/notebook/library/SharePreviewSheet'
import HelpfulPromptLine from '../components/notebook/library/HelpfulPromptLine'
import { BUILTIN_NOTE_KINDS } from '../lib/noteKinds'

vi.mock('../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 11 }))
vi.mock('../lib/styleLibraryFlag', async (orig) => ({ ...(await orig()), styleLibraryEnabled: () => true }))
vi.mock('../components/notebook/library/openAdoptSheet', () => ({ openAdoptSheet: vi.fn(() => () => {}) }))
vi.mock('../components/notebook/library/openSharePreview.js', () => ({ openSharePreview: vi.fn(() => () => {}) }))
vi.mock('../components/notebook/widgets/BuiltWidgetEmbed', () => ({
  default: ({ attrs }) => <div data-built-view={attrs?.params?.view || ''}>{attrs?.params?.title || 'Widget'}</div>,
}))

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const G = '/api/j2/template-gallery'

const OUTLINE = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The plan' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'What would make today a good day?' }] },
] }
const PREVIEW = {
  slots: [
    { id: 'p1', type: 'setup', label: 'Setup', any: false, suggested: { value: 'Breakout', label: 'Breakout' }, value: 'Breakout' },
    { id: 'p2', type: 'account', label: 'Account', any: true, suggested: null, value: { any: true } },
  ],
  cards: [
    { slot: 'built_a', title: 'Win rate by setup', payload: { view: 'bar', title: 'Win rate by setup' }, sample: true },
    { slot: 'built_b', title: 'Setup study', sentence: 'Pick a setup to see this widget.', sample: false },
  ],
  tools: [{ slot: 'routine_a', kind: 'routine', name: 'Pre-market routine', bind: 'next-trading-day',
    items: [{ text: 'Check futures' }, { text: 'Mark levels' }] }],
  questions: [],
  credit: "Based on UCT's Pre-market prep",
}
const row = (o) => ({ title: 'Untitled', description: '', category: 'journal', author: 'UCT', firm: false, featured: true,
  itemType: 'style', usedBy: 0, helpfulCount: 0, updatedAt: '2026-10-03T14:00:00', contains: [], inYourTemplates: false, ...o })
const LIBRARY = [
  row({ id: 'g-recap', title: 'Daily recap', group: 'after_close', description: 'closing the trading day',
    contains: ['P&L by setup', 'Win rate', 'Daily review'], usedBy: 12, helpfulCount: 3 }),
  row({ id: 'g-open', title: 'Pre-market prep', group: 'before_open', description: 'the hour before the bell',
    contains: ['Gap scan'], inYourTemplates: true }),
]
const own = (x) => ({ builtin: false, isDefault: false, version: 1, blocks: [], properties: {}, credit: null,
  fromLibrary: false, sourceGalleryId: null, ...x })
const STYLES = [
  { id: 'builtin:trade_plan', name: 'Trade plan (starter)', kindId: 'trade_plan', builtin: true, isDefault: true, usedIn: 9 },
  own({ id: 's1', name: 'Morning prep', kindId: 'daily_prep', usedIn: 3, updatedAt: '2025-03-04T17:00:00Z' }),
  own({ id: 's2', name: 'Swing review', kindId: 'daily_prep', usedIn: 1, updatedAt: '2025-02-10T17:00:00Z',
    credit: "Based on Sam's Swing review", fromLibrary: true, sourceGalleryId: 'g9' }),
]
const SHARE_ANSWER = {
  travels: {
    name: 'My R curve', description: 'R by setup',
    plan: { v: 3, source: 'trades', view: { type: 'bar', auto: false }, formulas: [{ id: 'f1', name: 'Risk multiple', expr: '[#p2] * 2', format: 'number' }] },
    slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: true }, { id: 'p2', type: 'number', label: 'Hold days', any: false }],
  },
  slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: true }, { id: 'p2', type: 'number', label: 'Hold days', any: false }],
  kept: [],
  notShared: ['Your setups are left out; people pick their own.'],
  prefill: { name: 'My R curve', description: 'R by setup', formulas: [{ id: 'f1', name: 'Risk multiple' }],
    numbers: [{ path: 'filters/0/values/0', value: 2.5, label: 'Hold days' }] },
}

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const u = new URL(String(url), 'http://x')
    const p = u.pathname
    if (p === `${G}/library` && method === 'GET') return json(200, { templates: LIBRARY })
    if (p.endsWith('/preview-mine') && method === 'POST') return json(200, PREVIEW)
    if (p === `${G}/share/preview` && method === 'POST') return json(200, SHARE_ANSWER)
    if (p === `${G}/notes/n1/helpful-prompt` && method === 'GET') {
      return json(200, { show: true, itemId: 'g-open', title: 'Pre-market prep', line: 'Was Pre-market prep helpful?' })
    }
    if (p === '/api/j2/widget-definitions/vocabulary') {
      const field = u.searchParams.get('field')
      return json(200, { field, values: field === 'setup' ? ['Breakout', 'Pullback', 'Flag'] : [] })
    }
    if (p === '/api/j2/routines') return json(200, { routines: [] })
    if (p === '/api/j2/trackers') return json(200, { trackers: [] })
    if (p === '/api/j2/journal-styles' && method === 'GET') {
      const kinds = BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true }))
      return json(200, { kinds, styles: u.searchParams.get('view') === 'live' ? STYLES : [] })
    }
    const one = p.match(/^\/api\/j2\/template-gallery\/([^/]+)$/)
    if (one && method === 'GET') return json(200, { template: { id: one[1], title: 'Pre-market prep', bodyJson: OUTLINE } })
    return json(404, { detail: 'Not found' })
  }))
}

describe('a11y: the template library (wave 11)', () => {
  beforeEach(() => { installFetch() })
  afterEach(() => { vi.unstubAllGlobals() })

  axeSurface('my-tools-templates', async () => {
    render(<MyToolsSheet onClose={() => {}} uid="u1" tab="templates" />)
    await screen.findByRole('heading', { name: /templates?$/ })
    await waitFor(() => expect(screen.getAllByTestId('my-tools-template-row').length).toBeGreaterThan(1))
    expect(screen.getByText("Based on Sam's Swing review")).toBeTruthy()
    await settle()
  })

  axeSurface('template-library-section', async () => {
    render(<TemplateLibrarySection />)
    await screen.findByRole('heading', { name: SECTION_TITLE })
    await waitFor(() => expect(document.querySelectorAll('[data-library-card]').length).toBe(LIBRARY.length))
    expect(screen.getByRole('heading', { level: 5, name: 'Daily recap' })).toBeTruthy()
    expect(document.querySelector('[data-library-card="g-recap"] [data-library-facts]')).toBeTruthy()
    await settle()
  })

  axeSurface('template-detail-sheet', async () => {
    render(<TemplateDetailSheet item={{ id: 'g-open', title: 'Pre-market prep', author: 'UCT', itemType: 'style', group: 'before_open' }}
      onClose={() => {}} navigate={() => {}} />)
    await screen.findByText('Win rate by setup')
    expect(screen.getByRole('heading', { name: DATA_HEADING })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'The plan' })).toBeTruthy()
    expect(screen.getByText('Pick a setup to see this widget.')).toBeTruthy()
    await settle()
  })

  axeSurface('template-adopt-sheet', async () => {
    render(<AdoptSheet galleryId="g-open" kind="template" onClose={() => {}} onDone={() => {}} navigate={() => {}} />)
    expect(await screen.findByRole('dialog', { name: ADOPT_TITLE })).toBeTruthy()
    await waitFor(() => expect(document.querySelector('[data-slot="p1"]')).not.toBeNull())
    expect(document.querySelector('[data-slot="p1"]').textContent).toContain('Breakout')
    expect(screen.getByText('Check futures')).toBeTruthy()
    await settle()
  })

  axeSurface('template-slot-picker', async () => {
    render(<SlotPicker slot={{ id: 'p1', type: 'setup', label: 'Setup', any: false }} answer="Breakout" onPick={() => {}} onCancel={() => {}} />)
    expect(await screen.findByText('Pullback')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    await settle()
  })

  axeSurface('template-share-preview', async () => {
    render(<SharePreviewSheet kind="widget" id="w1" onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByDisplayValue('Risk multiple')).toBeTruthy()
    expect(screen.getByText('Your setups are left out; people pick their own.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send for review' })).toBeTruthy()
    await settle()
  })

  axeSurface('helpful-prompt-line', async () => {
    render(<HelpfulPromptLine noteId="n1" onDone={() => {}} />)
    expect(await screen.findByRole('group', { name: 'Was Pre-market prep helpful?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    expect(document.querySelector('[data-helpful-prompt-status]')).toHaveAttribute('role', 'status')
    await settle()
  })
})
