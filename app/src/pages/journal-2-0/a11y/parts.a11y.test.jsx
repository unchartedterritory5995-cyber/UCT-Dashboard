// app/src/pages/journal-2-0/a11y/parts.a11y.test.jsx
//
// A1: the pieces that live INSIDE a note or a list — the custom node views (an
// Ask answer with a citation, a saved excerpt, a captured fact, a note link, an
// archived widget), every journal embed renderer, the note card in each of its
// states, and the editor's side sections (properties with a relation, the
// thesis section with its review, backlinks, the session-video hero and rails,
// the hero image, the document-text status). Real components over the fixture
// network.
import { describe, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers, P, NOTES, noteDetail } from './fixtures'
import { axeSurface } from './surface'
import NoteEditorPage from '../components/notebook/NoteEditorPage'
import NoteCard from '../components/notebook/NoteCard'
import NoteVideoHero from '../components/notebook/NoteVideoHero'
import { NoteRailLeft, NoteRailRight } from '../components/notebook/NoteVideoRails'
import HeroImagePicker from '../components/notebook/HeroImagePicker'
import DocumentTextStatus from '../components/notebook/DocumentTextStatus'
import FrozenList from '../components/notebook/FrozenList'
import AiSearchEmbed from '../components/notebook/AiSearchEmbed'
import AlertsEmbed from '../components/notebook/AlertsEmbed'
import BreadthEmbed from '../components/notebook/BreadthEmbed'
import CalendarEmbed from '../components/notebook/CalendarEmbed'
import ChartEmbed from '../components/notebook/ChartEmbed'
import FundamentalsEmbed from '../components/notebook/FundamentalsEmbed'
import IndexesEmbed from '../components/notebook/IndexesEmbed'
import MarketContextEmbed from '../components/notebook/MarketContextEmbed'
import NewsEmbed from '../components/notebook/NewsEmbed'
import ScannerEmbed from '../components/notebook/ScannerEmbed'
import ThemesEmbed from '../components/notebook/ThemesEmbed'
import WatchlistEmbed from '../components/notebook/WatchlistEmbed'
import { buildWidgetEmbedAttrs } from '../lib/widgetEmbedCore'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const CAPTURED = '2026-09-19T15:00:00.000Z'

const NODES_BODY = {
  type: 'doc',
  content: [
    P('Setup, with a link to '),
    { type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'noteLink', attrs: { noteId: 'n2' } }, { type: 'text', text: ' for sizing.' }] },
    {
      type: 'askInsert', attrs: { insertedAt: CAPTURED, scope: 'note', question: 'What happened to margins?' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Margins fell ' }, { type: 'askCitation', attrs: { n: 1 } }, { type: 'text', text: ' in Q3.' }] }],
    },
    { type: 'documentExcerpt', attrs: { excerptId: 'ex1' } },
    { type: 'financialFact', attrs: { factId: 'f1' } },
    {
      type: 'widgetEmbed',
      attrs: {
        ...buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: 1758200000 }, {
          capturedAt: CAPTURED, fallback: { url: '/api/j2/notes/n1/embeds/e1.png', w: 800, h: 400 },
        }),
        frozen: true,
      },
    },
  ],
}

const NODE_ROUTES = [
  [/^\/api\/j2\/notes\/n1\/excerpts$/, { excerpts: [{
    id: 'ex1', noteId: 'n1', documentId: 'd2', pageNumber: 4, documentName: 'NVDA 10-Q', sourceKind: 'attachment',
    attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/q.pdf', capturedText: 'Management expects margins to normalise.',
    annotation: 'Too optimistic.', createdAt: CAPTURED,
  }] }],
  [/^\/api\/j2\/notes\/n1\/facts$/, { facts: [{
    id: 'f1', ticker: 'NVDA', factType: 'price', factLabel: 'Price', value: 142.83, unit: 'usd_per_share',
    temporalMode: 'snapshot', observedAt: CAPTURED, caption: null,
  }] }],
  [/^\/api\/j2\/notes\/link-targets$/, { targets: { n2: { title: 'Weekly plan', status: 'active' } } }],
  [/^\/api\/j2\/notes\/n1\/thesis-summary$/, { evidence: [], changelog: [{ id: 'c1', at: CAPTURED, field: 'builtin:thesis_status', from: 'watching', to: 'active' }] }],
  [/^\/api\/j2\/notes\/n1\/reviews$/, { reviews: [], attention: { due: true, reason: 'review_date' } }],
]

describe('custom node views inside a note', () => {
  beforeEach(() => {
    installFetch([
      ...NODE_ROUTES,
      [/^\/api\/j2\/notes\/n1$/, { note: noteDetail({ tags: ['semis', 'thesis'], bodyJson: NODES_BODY }) }],
    ])
    latchWave8Flags(true)
  })

  axeSurface('editor-nodes', async () => {
    render(<Providers route="/journal/notebook?note=n1"><NoteEditorPage noteId="n1" onBack={() => {}} showBack={false} /></Providers>)
    await screen.findByPlaceholderText('Title')
    await waitFor(() => { if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted') })
    await screen.findAllByText('Weekly plan')                // the note link resolved its title
    await waitFor(() => expect(document.querySelector('[data-document-excerpt]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-widget-embed-view]')).not.toBeNull())
    await settle(120)
  })
})

const embed = (widgetId, params) => ({ ...buildWidgetEmbedAttrs(widgetId, params, { capturedAt: CAPTURED }) })
const ROWS = [{ sym: 'NVDA', price: 142.8, chgPct: 3.2, note: 'leader' }, { sym: 'AMD', price: 160.1, chgPct: -1.1 }]

const EMBEDS = [
  ['embed-ai-search', AiSearchEmbed, embed('aisearch', { thread: [{ role: 'user', text: 'What is leading?' }, { role: 'assistant', text: 'Semis are leading.' }] })],
  ['embed-alerts', AlertsEmbed, embed('alerts', { alerts: [{ id: 'a1', sym: 'NVDA', direction: 'above', target_price: 150, levelAtCapture: 150, priceAtCapture: 142 }] })],
  ['embed-breadth', BreadthEmbed, embed('breadth', { row: { date: '2026-09-18', breadth_score: 62 }, series: {} })],
  ['embed-calendar', CalendarEmbed, embed('calendar', { date: '2026-09-18' })],
  ['embed-chart', ChartEmbed, embed('chart', { symbol: 'NVDA', tf: 'D', to: 1758200000 })],
  ['embed-fundamentals', FundamentalsEmbed, embed('fundamentals', { symbol: 'NVDA', data: null })],
  ['embed-indexes', IndexesEmbed, embed('indexes', { rows: [{ sym: 'SPY', price: 560, chgPct: 0.4 }] })],
  ['embed-market-context', MarketContextEmbed, embed('marketcontext', { readings: {} })],
  ['embed-news', NewsEmbed, embed('news', { symbol: 'NVDA', events: [] })],
  ['embed-scanner', ScannerEmbed, embed('scanner', { scanName: 'Pullback MA', rows: ROWS })],
  ['embed-themes', ThemesEmbed, embed('themes', { period: '1w', rows: [{ label: 'Semis', chgPct: 4.1 }] })],
  ['embed-watchlist', WatchlistEmbed, embed('watchlist', { watchName: 'Leaders', rows: ROWS })],
]

describe('journal embed renderers', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true) })

  for (const [id, Component, attrs] of EMBEDS) {
    axeSurface(id, async () => {
      const { container } = render(<Providers><Component attrs={attrs} height={320} /></Providers>)
      await waitFor(() => expect(container.firstChild).not.toBeNull())
      await settle(60)
    })
  }

  axeSurface('frozen-list', async () => {
    render(<Providers><FrozenList title="Leaders" subtitle="2 symbols" asOf="as of Sep 19, 2026" rows={ROWS} /></Providers>)
    await screen.findByText('NVDA')
  })
})

describe('note card states', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true) })

  axeSurface('note-card-states', async () => {
    render(
      <Providers>
        <div>
          <NoteCard note={NOTES[0]} onOpen={() => {}} selectable selected onToggleSelect={() => {}} />
          <NoteCard note={{ ...NOTES[1], isLocked: true }} onOpen={() => {}} blocked />
          <NoteCard note={NOTES[2]} onOpen={() => {}} onRestore={() => {}} />
          <NoteCard note={{ ...NOTES[2], id: 'n4', title: 'Archived idea' }} onOpen={() => {}} onUnarchive={() => {}} />
        </div>
      </Providers>,
    )
    await screen.findByText('Archived idea')
  })
})

describe('editor side sections', () => {
  beforeEach(() => { installFetch(NODE_ROUTES); latchWave8Flags(true) })

  axeSurface('video-hero', async () => {
    render(<Providers><NoteVideoHero youtubeId="dQw4w9WgXcQ" watchUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" /></Providers>)
    await screen.findByText(/Watch on YouTube/)
  })

  axeSurface('video-rails', async () => {
    const insights = {
      loading: false, posterUrl: '/api/desk/poster/1.png',
      chapters: [{ t: 0, title: 'The open' }, { t: 420, title: 'Setups on watch' }],
      setups: [{ setup: 'Pullback MA', ticker: 'NVDA' }],
      summary: ['Semis led.', 'Sized the starter.'],
      tickerMoments: [{ ticker: 'NVDA', t: 430, note: 'reclaimed the 21' }],
    }
    render(<Providers><div><NoteRailLeft insights={insights} /><NoteRailRight insights={insights} /></div></Providers>)
    await screen.findByText('Setups on watch')
    const toggle = screen.queryByRole('button', { expanded: false })
    if (toggle) fireEvent.click(toggle)
    await settle()
  })

  axeSurface('hero-image', async () => {
    render(<Providers><HeroImagePicker noteId="n1" value="/api/j2/notes/n1/images/hero.jpg" onChange={() => {}} /></Providers>)
    await waitFor(() => expect(document.querySelector('img')).not.toBeNull())
  })

  axeSurface('document-text-status', async () => {
    render(
      <Providers>
        <DocumentTextStatus documents={[
          { id: 'd1', name: 'Scan.pdf', status: 'no_text', pageCount: 3, pagesTotal: 3, pagesWithText: 0, pagesFromOcr: 0, ocrUnavailable: true, sourceKind: 'attachment' },
          { id: 'd2', name: 'Deck.pdf', status: 'processing', pageCount: 12, pagesTotal: 12, pagesWithText: 4, pagesFromOcr: 0, ocrUnavailable: false, sourceKind: 'attachment' },
        ]} />
      </Providers>,
    )
    await settle()
    expect(document.body.textContent.length).toBeGreaterThan(0)
  })

  axeSurface('editor-thesis', async () => {
    installFetch([
      ...NODE_ROUTES,
      [/^\/api\/j2\/notes\/n1$/, { note: noteDetail({ tags: ['thesis'] }) }],
    ])
    render(<Providers route="/journal/notebook?note=n1"><NoteEditorPage noteId="n1" onBack={() => {}} showBack={false} /></Providers>)
    await screen.findByPlaceholderText('Title')
    // The three footer sections are collapsed by default: open each, so the
    // rows (the part a member reads) are what axe checks.
    for (const name of [/Linked from \(1\)/, /Related from \(1\)/, /Unlinked mentions \(1\)/]) {
      fireEvent.click(await screen.findByRole('button', { name }))
    }
    await screen.findByText('see the NVDA thesis for sizing')
    // The relation property (RelationPropertyValue) with its note picker open
    // and showing results (NoteSearchPicker).
    fireEvent.click(await screen.findByRole('button', { name: 'Link a note' }))
    fireEvent.change(screen.getByRole('textbox', { name: /find a note/i }), { target: { value: 'we' } })
    await screen.findByRole('button', { name: 'AMD thesis' })
    // open "Add property" so the property editor controls render too
    const add = screen.queryByRole('button', { name: /add property/i })
    if (add) fireEvent.click(add)
    await settle(80)
  })
})

void vi
