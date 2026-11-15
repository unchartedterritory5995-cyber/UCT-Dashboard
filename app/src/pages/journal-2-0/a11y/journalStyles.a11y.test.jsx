// app/src/pages/journal-2-0/a11y/journalStyles.a11y.test.jsx
//
// Notebook P1 lane C: the Journal styles manager through the axe harness, in the three states a member
// sees: the list, the editor open on a style (blocks, outline picker, property defaults, live preview),
// and the Research Type offer. Each recipe proves its state rendered before axe runs. The Settings card
// has its own recipe. (The New-note kind picker is lane D's and registers its own surface.)
import { describe, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import StylesManager from '../components/notebook/styles/StylesManager'
import JournalStylesCard from '../components/JournalStylesCard'

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: () => {}, loading: false }),
}))

const CHART = { block: 'chart', enabled: true, settings: { tf: 'D' } }
const base = { outlineTemplateId: null, hasOutline: true, properties: {}, sourceGalleryId: null, sourceVersion: null, createdAt: null, updatedAt: null, deletedAt: null }
const LIST = {
  kinds: [
    { id: 'trade_plan', name: 'Trade plan', icon: 'chart', builtin: true, sortOrder: 0 },
    { id: 'thesis', name: 'Thesis', icon: 'book', builtin: true, sortOrder: 1 },
    { id: 'k_own', name: 'Setups I trade', icon: 'flag', builtin: false, sortOrder: 9 },
  ],
  blockKinds: ['chart'],
  styles: [
    { ...base, id: 'builtin:trade_plan', name: 'Trade plan', kindId: 'trade_plan', builtin: true, isDefault: false, version: 1, blocks: [CHART] },
    { ...base, id: 's_member', name: 'My plan', kindId: 'trade_plan', builtin: false, isDefault: true, version: 3, blocks: [CHART, { block: 'future_widget', enabled: true, settings: {} }] },
    { ...base, id: 'builtin:thesis', name: 'Thesis', kindId: 'thesis', builtin: true, isDefault: true, version: 1, blocks: [CHART] },
  ],
}
const FULL = { style: { ...LIST.styles[1], outlineBodyJson: null } }
const PREVIEW = {
  bodyJson: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The plan' }] },
    { type: 'widgetEmbed', attrs: { widgetId: 'chart', params: { symbol: 'NVDA', tf: 'D' } } },
  ] },
  properties: {}, skipped: [], ticker: 'NVDA', tickerSource: 'latest-note',
}
const OFFER = { offer: { total: 7, rows: [] } }
const ROUTES = (offer = { offer: null }) => [
  [/\/preview$/, PREVIEW],
  [/^\/api\/j2\/journal-styles\/[^/]+$/, FULL],
  [/^\/api\/j2\/journal-styles$/, LIST],
  [/mapping-offer$/, offer],
]

describe('journal styles surfaces (P1, lane C)', () => {
  beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_journal_styles_enabled: true }) })

  axeSurface('styles-manager', async () => {
    installFetch(ROUTES())
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    await screen.findByRole('heading', { name: 'Manage templates' })
    await screen.findByRole('heading', { name: 'Trade plan', level: 3 })
    screen.getByRole('button', { name: 'Delete My plan' })
  })

  axeSurface('styles-manager-editor', async () => {
    installFetch(ROUTES())
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    await screen.findByRole('list', { name: 'Blocks in this template' })
    screen.getByRole('button', { name: 'Move Chart of the note’s ticker down' })
    await screen.findByText('Shown with NVDA, from your notes.', {}, { timeout: 3000 })
  })

  axeSurface('styles-manager-offer', async () => {
    installFetch(ROUTES(OFFER))
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    await screen.findByText('You have 7 notes with a Research Type. Set their Note type to match?')
    screen.getByRole('button', { name: 'Set note types' })
  })

  axeSurface('styles-manager-kind-confirm', async () => {
    installFetch(ROUTES())
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete note type Setups I trade' }))
    await screen.findByText('Delete the note type Setups I trade? Templates you deleted that used it are removed permanently.')
    screen.getByRole('button', { name: 'Yes, delete note type Setups I trade' })
  })

  axeSurface('styles-manager-discard', async () => {
    installFetch(ROUTES())
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Half done' } })
    await screen.findByText('Shown with NVDA, from your notes.', {}, { timeout: 3000 })      // let the preview land inside the test
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await screen.findByText('Discard your unsaved changes to this template?')
  })

  // Follow-up C (one room for templates): the manager with wave 11 on, in each view (a real tablist), and with its
  // Plain templates group populated and empty.
  describe('with wave 11 on (the views)', () => {
    const ARCHIVED = { ...base, id: 's_old', name: 'Old plan', kindId: 'trade_plan', builtin: false, isDefault: false, version: 2,
      blocks: [], usedIn: 2, credit: null, fromLibrary: false, archivedAt: '2025-01-10T17:00:00Z', updatedAt: '2025-01-09T17:00:00Z' }
    const DELETED = { ...ARCHIVED, id: 's_gone', name: 'Gone plan', usedIn: 0, deletedAt: '2025-01-20T17:00:00Z' }
    const PLAIN = [{ id: 't1', name: 'Morning plan', title: 'Plan', createdAt: '2' }, { id: 't2', name: 'Weekly wrap', title: '', createdAt: '1' }]
    const viewRoutes = (plain = PLAIN) => [
      [/\/used-in$/, { notes: [] }],
      [/^\/api\/j2\/journal-styles$/, (url) => {
        const view = new URL(url, 'http://x').searchParams.get('view')
        if (view === 'archived') return { kinds: LIST.kinds, styles: [ARCHIVED] }
        if (view === 'deleted') return { kinds: LIST.kinds, styles: [DELETED] }
        if (view === 'live') return { kinds: LIST.kinds, styles: [{ ...LIST.styles[1], usedIn: 3 }] }
        return LIST
      }],
      [/^\/api\/j2\/note-templates$/, { templates: plain }],
      ...ROUTES(),
    ]
    beforeEach(() => {
      __resetNotebookFlags()
      latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_widgets_w11_enabled: true })
    })

    axeSurface('styles-manager-active-views', async () => {
      installFetch(viewRoutes())
      render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
      await screen.findByRole('tablist', { name: 'Show' })
      await screen.findByRole('button', { name: 'Archive My plan' })
      await screen.findByRole('button', { name: 'Used in 3 notes: list the notes made with My plan' })
    })

    axeSurface('styles-manager-archived', async () => {
      installFetch(viewRoutes())
      render(<Providers><StylesManager open onClose={() => {}} show="archived" showKey={1} /></Providers>)
      await screen.findByRole('heading', { name: '1 archived' })
      screen.getByRole('button', { name: 'Restore Old plan' })
    })

    axeSurface('styles-manager-deleted', async () => {
      installFetch(viewRoutes())
      render(<Providers><StylesManager open onClose={() => {}} show="deleted" showKey={1} /></Providers>)
      await screen.findByRole('heading', { name: '1 recently deleted' })
      await screen.findByText(/Kept until/)
    })

    axeSurface('styles-manager-plain', async () => {
      installFetch(viewRoutes())
      render(<Providers><StylesManager open onClose={() => {}} onUsePlain={() => {}} show="plain" showKey={1} /></Providers>)
      await screen.findByRole('heading', { name: 'Plain templates' })
      await screen.findByRole('combobox', { name: 'Daily notes start from' })
      screen.getByRole('button', { name: 'Rename Morning plan' })
    })

    axeSurface('styles-manager-plain-empty', async () => {
      installFetch(viewRoutes([]))
      render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
      await screen.findByText("No plain templates yet. Open a note's More menu and choose Save as template.")
    })
  })

  axeSurface('settings-journal-styles', async () => {
    installFetch([])
    render(<Providers><JournalStylesCard /></Providers>)
    await screen.findByRole('link', { name: 'Manage templates' })
  })
})
