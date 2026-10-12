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
    await screen.findByRole('heading', { name: 'Journal styles' })
    await screen.findByRole('heading', { name: 'Trade plan', level: 3 })
    screen.getByRole('button', { name: 'Delete My plan' })
  })

  axeSurface('styles-manager-editor', async () => {
    installFetch(ROUTES())
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    await screen.findByRole('list', { name: 'Blocks in this style' })
    screen.getByRole('button', { name: 'Move Chart of the note’s ticker down' })
    await screen.findByText('Shown with NVDA, from your notes.', {}, { timeout: 3000 })
  })

  axeSurface('styles-manager-offer', async () => {
    installFetch(ROUTES(OFFER))
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    await screen.findByText('You have 7 notes with a Research Type. Set their Kind of note to match?')
    screen.getByRole('button', { name: 'Set kinds' })
  })

  axeSurface('settings-journal-styles', async () => {
    installFetch([])
    render(<Providers><JournalStylesCard /></Providers>)
    await screen.findByRole('link', { name: 'Open journal styles' })
  })
})
