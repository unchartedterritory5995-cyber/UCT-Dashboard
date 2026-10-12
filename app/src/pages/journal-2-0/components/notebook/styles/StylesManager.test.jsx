// Notebook P1 lane C: the Styles manager, through the REAL client (lib/journalStyles.js) with only the
// network faked, keyed by method and URL. Fixtures are inline: the server's contract fixtures are generated
// by the router lane (Task 8) and are not in this tree; their shapes follow the plan's Task 8 table.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'

const setPref = vi.fn()
let prefsNow = {}
vi.mock('../../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: prefsNow, setPref, setPrefMerged: vi.fn(), loading: false }),
}))
// The client lands what the mapping offer moved with settleNoteWrites; that layer has its own rails.
vi.mock('../../../lib/offline/settleNoteWrite', () => ({
  settleNoteWrite: vi.fn(async () => {}),
  settleNoteWrites: vi.fn(async () => {}),
}))

import StylesManager from './StylesManager'

const CHART = { block: 'chart', enabled: true, settings: { tf: 'D' } }
const KINDS = [
  { id: 'trade_plan', name: 'Trade plan', icon: 'chart', builtin: true, sortOrder: 0 },
  { id: 'thesis', name: 'Thesis', icon: 'book', builtin: true, sortOrder: 1 },
  { id: 'k_own', name: 'Setups I trade', icon: 'flag', builtin: false, sortOrder: 9 },
]
const style = (o) => ({
  outlineTemplateId: null, hasOutline: true, properties: {}, sourceGalleryId: null, sourceVersion: null,
  createdAt: null, updatedAt: null, deletedAt: null, ...o,
})
const LIST = {
  kinds: KINDS,
  blockKinds: ['chart'],
  styles: [
    style({ id: 'builtin:trade_plan', name: 'Trade plan', kindId: 'trade_plan', builtin: true, isDefault: false, version: 1, blocks: [CHART] }),
    style({ id: 's_member', name: 'My plan', kindId: 'trade_plan', builtin: false, isDefault: true, version: 3, blocks: [CHART] }),
    style({ id: 'builtin:thesis', name: 'Thesis', kindId: 'thesis', builtin: true, isDefault: true, version: 1, blocks: [CHART] }),
  ],
}
const FULL_MEMBER = { style: { ...LIST.styles[1], outlineBodyJson: null } }
const UNKNOWN_BLOCK = { style: { ...LIST.styles[1], blocks: [{ block: 'future_widget', enabled: true, settings: { z: 1 } }], outlineBodyJson: null } }
const PREVIEW = {
  bodyJson: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The plan' }] },
    { type: 'widgetEmbed', attrs: { widgetId: 'chart', params: { symbol: 'NVDA', tf: 'D' } } },
  ] },
  properties: {}, skipped: [], ticker: 'NVDA', tickerSource: 'latest-note',
}

let calls
let routes
function installFetch(extra = []) {
  calls = []
  const table = [...extra, ...routes]
  globalThis.fetch = vi.fn((input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : input.url
    const path = url.split('?')[0]
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const hit = table.find(([m, re]) => m === method && re.test(path))
    let out = hit ? hit[2] : [404, { detail: 'Not found' }]
    if (typeof out === 'function') out = out(body)
    const [status, payload] = Array.isArray(out) && typeof out[0] === 'number' ? out : [200, out]
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(payload) })
  })
}
const called = (method, re) => calls.filter((c) => c.method === method && re.test(c.path))

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
  prefsNow = {}
  setPref.mockClear()
  routes = [
    ['GET', /^\/api\/j2\/journal-styles$/, LIST],
    ['GET', /^\/api\/j2\/journal-styles\/s_member$/, FULL_MEMBER],
    ['GET', /^\/api\/j2\/journal-styles\/builtin%3Atrade_plan$/, { style: { ...LIST.styles[0], outlineBodyJson: { type: 'doc', content: [] } } }],
    ['DELETE', /^\/api\/j2\/journal-styles\/s_member$/, { ok: true, style: { ...LIST.styles[1], deletedAt: 'x' } }],
    ['POST', /^\/api\/j2\/journal-styles\/s_member\/restore$/, FULL_MEMBER],
    ['POST', /^\/api\/j2\/journal-styles\/s_member\/default$/, FULL_MEMBER],
    ['POST', /^\/api\/j2\/journal-styles\/preview$/, PREVIEW],
    ['POST', /^\/api\/j2\/journal-styles$/, (b) => ({ style: { ...LIST.styles[1], id: 's_new', name: b.name, blocks: b.blocks } })],
    ['PUT', /^\/api\/j2\/journal-styles\/s_member$/, (b) => ({ style: { ...LIST.styles[1], ...b } })],
    ['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, { offer: null }],
    ['GET', /^\/api\/j2\/property-defs$/, { propertyDefs: [
      { id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set', options: [{ id: 'watching', label: 'Watching' }] },
      { id: 'builtin:note_kind', name: 'Kind of note', type: 'select', source: 'user_set', options: [{ id: 'trade_plan', label: 'Trade plan' }] },
      { id: 'builtin:ticker', name: 'Ticker', type: 'text', source: 'financial_derived' },
    ] }],
    ['GET', /^\/api\/j2\/note-templates$/, { templates: [] }],
  ]
  installFetch()
})
afterEach(() => { __resetNotebookFlags() })

const open = (props = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <StylesManager open onClose={vi.fn()} {...props} />
  </SWRConfig>,
)

describe('the Styles manager', () => {
  it('lists styles under their kind with the Default badge and the version', async () => {
    open()
    await screen.findByRole('heading', { name: 'Journal styles' })
    const trade = (await screen.findByRole('heading', { name: 'Trade plan', level: 3 })).closest('section')
    const row = within(trade).getByText('My plan').closest('li')
    expect(within(row).getByText('Default')).toBeInTheDocument()
    expect(within(row).getByText('v3')).toBeInTheDocument()
    // the built-in offers "Duplicate to edit", never Edit or Delete
    const builtin = within(trade).getByText('Trade plan', { selector: 'span' }).closest('li')
    expect(within(builtin).getByRole('button', { name: 'Duplicate Trade plan to edit' })).toBeInTheDocument()
    expect(within(builtin).queryByRole('button', { name: /^Delete/ })).toBeNull()
    expect(within(builtin).queryByRole('button', { name: /^Edit/ })).toBeNull()
    // the default row needs no "Set as default"
    expect(within(row).queryByRole('button', { name: /as default/ })).toBeNull()
    expect(within(builtin).getByRole('button', { name: 'Set Trade plan as default' })).toBeInTheDocument()
  })

  it('Delete then Undo restores the style', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete My plan' }))
    await screen.findByText('Style deleted.')
    expect(called('DELETE', /s_member$/)).toHaveLength(1)
    // the list re-reads: the server now answers without the style
    routes.unshift(['GET', /^\/api\/j2\/journal-styles$/, { ...LIST, styles: LIST.styles.filter((s) => s.id !== 's_member') }])
    installFetch()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(called('POST', /s_member\/restore$/)).toHaveLength(1))
    await screen.findByText('Style restored.')
    expect(screen.queryByText('Style deleted.')).toBeNull()
  })

  it('the Undo line ends at the next action', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete My plan' }))
    await screen.findByText('Style deleted.')
    fireEvent.click(await screen.findByRole('button', { name: 'Set Trade plan as default' }))
    await waitFor(() => expect(screen.queryByText('Style deleted.')).toBeNull())
  })

  it('reorders blocks with Move up/Move down and keeps an unknown block', async () => {
    routes.unshift(['GET', /^\/api\/j2\/journal-styles\/s_member$/, UNKNOWN_BLOCK])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    const list = await screen.findByRole('list', { name: 'Blocks in this style' })
    // the newer-version block is shown, kept, and cannot be toggled
    const future = within(list).getByText('A block from a newer version').closest('li')
    expect(within(future).getByRole('checkbox', { name: 'Use A block from a newer version' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Add a block'), { target: { value: 'chart' } })
    const order = () => within(list).getAllByRole('listitem').map((li) => (li.textContent.includes('newer version') ? 'future' : 'chart'))
    expect(order()).toEqual(['future', 'chart'])
    // the first row can't move up, the last can't move down
    expect(screen.getByRole('button', { name: 'Move A block from a newer version up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Chart of the note’s ticker down' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Move Chart of the note’s ticker up' }))
    expect(order()).toEqual(['chart', 'future'])
    // keyboard focus stays on the control that moved the block
    expect(screen.getByRole('button', { name: 'Move Chart of the note’s ticker up' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move Chart of the note’s ticker down' }))
    expect(order()).toEqual(['future', 'chart'])

    // Save sends the order and keeps the unknown block verbatim
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', /s_member$/)).toHaveLength(1))
    const sent = called('PUT', /s_member$/)[0].body
    expect(sent.blocks.map((b) => b.block)).toEqual(['future_widget', 'chart'])
    expect(sent.blocks[0].settings).toEqual({ z: 1 })
  })

  it('the drag handle reorders the same list', async () => {
    routes.unshift(['GET', /^\/api\/j2\/journal-styles\/s_member$/, { style: { ...FULL_MEMBER.style, blocks: [{ block: 'a_new', enabled: true, settings: {} }, CHART] } }])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    const list = await screen.findByRole('list', { name: 'Blocks in this style' })
    const rows = within(list).getAllByRole('listitem')
    const handle = rows[0].querySelector('[draggable="true"]')
    expect(handle).not.toBeNull()
    fireEvent.dragStart(handle)
    fireEvent.dragOver(rows[1])
    fireEvent.drop(rows[1])
    expect(within(list).getAllByRole('listitem')[0].textContent).toContain('Chart of the note’s ticker')
  })

  it('shows the live preview with the member’s own ticker, after the debounce', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    await screen.findByText('Shown with NVDA, from your notes.', {}, { timeout: 3000 })
    const sent = called('POST', /preview$/).at(-1).body
    expect(sent.style.kindId).toBe('trade_plan')
    expect(sent.style.blocks[0].block).toBe('chart')
    // the chart widget is a named line in the preview, not a silent gap
    expect(screen.getByText('Chart of NVDA, Daily')).toBeInTheDocument()
  })

  it('says how to see the chart block when the member has no ticker yet', async () => {
    routes.unshift(['POST', /^\/api\/j2\/journal-styles\/preview$/, { ...PREVIEW, ticker: null, tickerSource: null }])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    await screen.findByText('Add a ticker to a note to see the chart block.', {}, { timeout: 3000 })
  })

  it('makes a new style: the draft is previewed and saved with the chosen kind', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /New style/ }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Swing plan' } })
    fireEvent.change(screen.getByLabelText('Kind of note'), { target: { value: 'thesis' } })
    fireEvent.change(screen.getByLabelText('Add a block'), { target: { value: 'chart' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('POST', /journal-styles$/)).toHaveLength(1))
    const sent = called('POST', /journal-styles$/)[0].body
    expect(sent).toMatchObject({ name: 'Swing plan', kindId: 'thesis', outlineTemplateId: null, outlineBodyJson: null })
    expect(sent.blocks).toEqual([{ block: 'chart', enabled: true, settings: { tf: 'D' } }])
    await screen.findByText('Saved Swing plan.')
  })

  it('an empty name is refused in words, and nothing is sent', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /New style/ }))
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the style a name.')
    expect(called('POST', /journal-styles$/)).toHaveLength(0)
  })

  it('the outline picker: a textarea outline is saved as a doc; a built-in outline can be copied in', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('radio', { name: 'Write it here' }))
    fireEvent.change(screen.getByLabelText('Start from a built-in outline'), { target: { value: 'daily-prep' } })
    expect(screen.getByLabelText('Outline text').value).toMatch(/^## /m)
    fireEvent.change(screen.getByLabelText('Outline text'), { target: { value: '## Setup\n{{block:chart}}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', /s_member$/)).toHaveLength(1))
    const doc = called('PUT', /s_member$/)[0].body.outlineBodyJson
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph'])
    expect(doc.content[1].content[0].text).toBe('{{block:chart}}')
  })

  it('property defaults: a select per user-set select property, Leave empty first, never Kind of note', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit My plan' }))
    const sel = await screen.findByLabelText('Thesis Status')
    expect(within(sel).getAllByRole('option')[0]).toHaveTextContent('Leave empty')
    expect(screen.queryByLabelText('Ticker')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Kind of note' })).toBe(screen.getByLabelText('Kind of note')) // the editor's kind select only
    fireEvent.change(sel, { target: { value: 'watching' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', /s_member$/)).toHaveLength(1))
    expect(called('PUT', /s_member$/)[0].body.properties).toEqual({ 'builtin:thesis_status': 'watching' })
  })

  it('Duplicate to edit makes a member copy of a built-in and opens it', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Trade plan to edit' }))
    await waitFor(() => expect(called('POST', /journal-styles$/)).toHaveLength(1))
    expect(called('POST', /journal-styles$/)[0].body).toMatchObject({ name: 'Trade plan copy', kindId: 'trade_plan' })
    await screen.findByRole('form', { name: 'Edit style Trade plan copy' })
  })

  it('Set as default calls the server and says so', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Set Trade plan as default' }))
    await waitFor(() => expect(called('POST', /builtin%3Atrade_plan\/default$/)).toHaveLength(1))
  })
})

describe('kinds of note', () => {
  it('adds a kind with a name and an icon from the registry', async () => {
    routes.unshift(['POST', /^\/api\/j2\/note-kinds$/, (b) => ({ kind: { id: 'k2', name: b.name, icon: b.icon, builtin: false } })])
    installFetch()
    open()
    fireEvent.change(await screen.findByLabelText('New kind name'), { target: { value: 'Earnings plays' } })
    fireEvent.change(screen.getByLabelText('Icon'), { target: { value: 'bolt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add kind' }))
    await waitFor(() => expect(called('POST', /note-kinds$/)).toHaveLength(1))
    expect(called('POST', /note-kinds$/)[0].body).toEqual({ name: 'Earnings plays', icon: 'bolt' })
    await screen.findByText('Kind added.')
  })

  it('renames an own kind', async () => {
    routes.unshift(['PUT', /^\/api\/j2\/note-kinds\/k_own$/, (b) => ({ kind: { ...KINDS[2], ...b } })])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Setups I trade' }))
    fireEvent.change(screen.getByLabelText('New name for Setups I trade'), { target: { value: 'My setups' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(called('PUT', /note-kinds\/k_own$/)).toHaveLength(1))
    expect(called('PUT', /note-kinds\/k_own$/)[0].body).toEqual({ name: 'My setups' })
  })

  it('a kind still in use shows the server’s sentence, word for word', async () => {
    const sentence = 'This kind is used by 3 notes (1 in Trash) and 1 style. Restore or empty the ones in Trash, and move the rest to another kind first.'
    routes.unshift(['DELETE', /^\/api\/j2\/note-kinds\/k_own$/, [409, { detail: sentence }]])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete kind Setups I trade' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
  })

  it('a deleted kind says how many deleted styles went with it', async () => {
    routes.unshift(['DELETE', /^\/api\/j2\/note-kinds\/k_own$/, { ok: true, purgedDeletedStyles: 2 }])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete kind Setups I trade' }))
    await screen.findByText(/Kind deleted\. 2 styles you had deleted for it were removed for good\./)
  })

  it('built-in kinds have no Rename or Delete', async () => {
    open()
    await screen.findByRole('heading', { name: 'Your kinds of note' })
    expect(screen.queryByRole('button', { name: 'Rename Trade plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete kind Trade plan' })).toBeNull()
  })
})

describe('the Research Type mapping offer', () => {
  const OFFER = { offer: { total: 7, rows: [{ researchType: 'swing', researchTypeLabel: 'Swing', count: 7, kindId: 'trade_plan', kindName: 'Trade plan', createsKind: false }] } }

  it('applies and passes the blocked note ids; skipped (locked) notes are counted aloud', async () => {
    routes.unshift(
      ['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, OFFER],
      ['POST', /^\/api\/j2\/note-kinds\/mapping-offer$/, { notes: [{ id: 'n1', updatedAt: 'u1' }], count: 1, skipped: [{ id: 'n9', reason: 'locked' }, { id: 'n8', reason: 'locked' }] }],
    )
    installFetch()
    open({ blockedNoteIds: ['n-blocked'] })
    await screen.findByText('You have 7 notes with a Research Type. Set their Kind of note to match?')
    fireEvent.click(screen.getByRole('button', { name: 'Set kinds' }))
    await waitFor(() => expect(called('POST', /mapping-offer$/)).toHaveLength(1))
    expect(called('POST', /mapping-offer$/)[0].body).toEqual({ excludeNoteIds: ['n-blocked'] })
    await screen.findByText(/Set the kind on 1 note\. 2 locked notes were left as they are\./)
  })

  it('Not now writes the preference and the offer stays dismissed', async () => {
    routes.unshift(['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, OFFER])
    installFetch()
    open()
    await screen.findByRole('button', { name: 'Not now' })
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(setPref).toHaveBeenCalledWith('notebook_kind_mapping', 'dismissed')
  })

  it('a dismissed offer is not shown', async () => {
    routes.unshift(['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, OFFER])
    installFetch()
    prefsNow = { notebook_kind_mapping: 'dismissed' }
    open()
    await screen.findByRole('heading', { name: 'Trade plan', level: 3 })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByText(/with a Research Type/)).toBeNull()
  })
})

describe('the switch', () => {
  it('renders nothing and asks for nothing while journal styles are off', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_journal_styles_enabled: false })
    open()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Journal styles')).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
