// Notebook P1 lane C: the Styles manager, through the REAL client (lib/journalStyles.js) with only the
// network faked, keyed by method and URL. Every server answer is a GENERATED contract fixture
// (__fixtures__/contract, written by the server lane and kept current by tests/test_notebook_contract_fixtures.py),
// so this file is pinned to the real shapes. A variation (a deleted kind that purged 2 styles, a note held back)
// is a spread + override of the fixture object, never a retyped shape. No fixture exists, so they stay inline,
// for: GET /property-defs, GET /note-templates, an empty mapping offer ({ offer: null }), the 5xx / network
// failures (transport, not a server answer) and RICH_OUTLINE (a TipTap doc the style editor must refuse to flatten).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { AuthContext } from '../../../../../context/AuthContext'
import { contract, contractBody } from '../../../__fixtures__/contract'
import { __resetOfferApplied } from './offerApplied'
import { friendlyError } from './styleErrors'

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

// ── the server's answers, from the contract fixtures ──
const FIXTURE_LIST = contractBody('journal-styles.list')
const OWN_KIND = contractBody('note-kinds.create').kind
const OTHER_OWN_KIND = { ...OWN_KIND, id: 'k_two', name: 'Gap plays', sortOrder: OWN_KIND.sortOrder + 1 }
const KIND_NAME = OWN_KIND.name
const MEMBER_FIXTURE = FIXTURE_LIST.styles.find((x) => !x.builtin && x.kindId === 'trade_plan')
// The fixture's list has no member default yet (the built-in Trade plan is the default). Most of these tests
// are about a member's own default style, so move the default to the member's style: an override of the fixture.
const LIST = {
  ...FIXTURE_LIST,
  kinds: [...FIXTURE_LIST.kinds, OWN_KIND],
  styles: FIXTURE_LIST.styles.map((x) => {
    if (x.id === 'builtin:trade_plan') return { ...x, isDefault: false }
    if (x.id === MEMBER_FIXTURE.id) return { ...x, isDefault: true }
    return x
  }),
}
const BUILTIN_TRADE = LIST.styles.find((x) => x.id === 'builtin:trade_plan')
const MEMBER = LIST.styles.find((x) => x.id === MEMBER_FIXTURE.id)
const NAME = MEMBER.name
const CHART = BUILTIN_TRADE.blocks[0]
const FUTURE = contractBody('journal-styles.update.unknown-block').style.blocks[0]      // a block from a newer version
// GET /journal-styles/{id} adds the outline to the list's row; a "member with a plain outline" is the real shape
const PLAIN_OUTLINE = contractBody('journal-styles.get').style.outlineBodyJson
const FULL_MEMBER = { style: { ...MEMBER, outlineBodyJson: PLAIN_OUTLINE } }
const withMember = (o) => ({ style: { ...FULL_MEMBER.style, ...o } })
const UNKNOWN_BLOCK = withMember({ blocks: [FUTURE] })
const BUILTIN_GET = { style: { ...BUILTIN_TRADE, outlineBodyJson: contractBody('journal-styles.get.builtin').style.outlineBodyJson } }
const DELETED = contractBody('journal-styles.delete')
const RESTORED = contractBody('journal-styles.restore')
const DEFAULTED = contractBody('journal-styles.default')
const CREATED = contractBody('journal-styles.create.from-note').style
const UPDATED = contractBody('journal-styles.update').style
const REFUSED = contract('journal-styles.create.bad-kind')                                // a 400 with the server's own sentence
const RICH_OUTLINE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Setup' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'bold' }] }] }] }] },
  ],
}
const PREVIEW = contractBody('journal-styles.preview')
const KIND_DELETED = contractBody('note-kinds.delete')
const kindDeleted = (n) => ({ ...KIND_DELETED, purgedDeletedStyles: n })
const IN_USE = contract('note-kinds.delete.in-use')
const OFFER = contractBody('note-kinds.mapping-offer')
const APPLIED = contractBody('note-kinds.mapping-offer.apply')
const APPLIED_RE = new RegExp(`Set the kind on ${APPLIED.count} note`)
const offerOf = (over) => ({ offer: { ...OFFER.offer, ...over } })
const re = (path) => new RegExp(`^${path}$`)
const MEMBER_URL = re(`/api/j2/journal-styles/${MEMBER.id}`)
const OWN_KIND_URL = re(`/api/j2/note-kinds/${OWN_KIND.id}`)
const MEMBER_END = new RegExp(`${MEMBER.id}$`)
const RESTORE_END = new RegExp(`${MEMBER.id}/restore$`)
const OWN_KIND_END = new RegExp(`note-kinds/${OWN_KIND.id}$`)
const OFFLINE = "You're offline. Changes to styles need a connection."
const SERVER_SIDE = 'Something went wrong on our side. Try again.'
const NETWORK = Symbol('network failure')
const CODE_BUG = Symbol('a bug in our own code')
const NO_BODY = [500]                                // a 5xx whose body is not JSON

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
    if (out === NETWORK) return Promise.reject(new TypeError('Failed to fetch'))
    if (out === CODE_BUG) return Promise.reject(new TypeError('Cannot read properties of undefined'))
    const [status, payload] = Array.isArray(out) && typeof out[0] === 'number' ? out : [200, out]
    return Promise.resolve({
      ok: status >= 200 && status < 300, status,
      json: () => (payload === undefined ? Promise.reject(new SyntaxError('not json')) : Promise.resolve(payload)),
    })
  })
}
const called = (method, re) => calls.filter((c) => c.method === method && re.test(c.path))
const put = () => called('PUT', MEMBER_END)[0].body

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
  prefsNow = {}
  setPref.mockClear()
  __resetOfferApplied()
  try { sessionStorage.clear() } catch { /* private mode */ }
  Element.prototype.scrollIntoView = vi.fn()
  routes = [
    ['GET', /^\/api\/j2\/journal-styles$/, LIST],
    ['GET', MEMBER_URL, FULL_MEMBER],
    ['GET', /^\/api\/j2\/journal-styles\/builtin%3Atrade_plan$/, BUILTIN_GET],
    ['DELETE', MEMBER_URL, DELETED],
    ['POST', re(`/api/j2/journal-styles/${MEMBER.id}/restore`), RESTORED],
    ['POST', re(`/api/j2/journal-styles/${MEMBER.id}/default`), DEFAULTED],
    ['POST', /^\/api\/j2\/journal-styles\/builtin%3Atrade_plan\/default$/, DEFAULTED],
    ['POST', /^\/api\/j2\/journal-styles\/preview$/, PREVIEW],
    ['POST', /^\/api\/j2\/journal-styles$/, (b) => ({ style: { ...CREATED, name: b.name, blocks: b.blocks } })],
    ['PUT', MEMBER_URL, (b) => ({ style: { ...UPDATED, ...b } })],
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

const tree = ({ userId = 'u1', ...props } = {}) => (
  <AuthContext.Provider value={{ user: { id: userId } }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <StylesManager open onClose={vi.fn()} {...props} />
    </SWRConfig>
  </AuthContext.Provider>
)
const open = (props) => render(tree(props))
const edit = async (name = NAME) => {
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${name}` }))
  return screen.findByRole('form', { name: `Edit style ${name}` })
}
const alertText = async () => (await screen.findByRole('alert')).textContent

describe('the Styles manager', () => {
  it('lists styles under their kind with the Default badge and the version', async () => {
    open()
    await screen.findByRole('heading', { name: 'Journal styles' })
    const trade = (await screen.findByRole('heading', { name: 'Trade plan', level: 3 })).closest('section')
    const row = within(trade).getByText(NAME).closest('li')
    expect(within(row).getByText('Default')).toBeInTheDocument()
    expect(within(row).getByText(`v${MEMBER.version}`)).toBeInTheDocument()
    // the built-in offers "Duplicate to edit", never Edit or Delete
    const builtin = within(trade).getByText('Trade plan', { selector: 'span' }).closest('li')
    expect(within(builtin).getByRole('button', { name: 'Duplicate Trade plan to edit' })).toBeInTheDocument()
    expect(within(builtin).queryByRole('button', { name: /^Delete/ })).toBeNull()
    expect(within(builtin).queryByRole('button', { name: /^Edit/ })).toBeNull()
    // the default row needs no "Set as default"
    expect(within(row).queryByRole('button', { name: /as default/ })).toBeNull()
    expect(within(builtin).getByRole('button', { name: 'Set Trade plan as default' })).toBeInTheDocument()
  })

  // NVDA row 28 (2026-10-14, production, NVDA 2026.2): with focus on the Sheet panel itself, NVDA spoke
  // "Journal styles" with no "dialog". It announces the role when focus ENTERS a dialog through a
  // descendant -- the Keyboard Shortcuts dialog (focuses Close) and ConfirmModal (focuses Cancel) both
  // read "... dialog" in the 10/09 runs. So opening puts focus on the title heading, inside the dialog.
  it('opening puts focus on the "Journal styles" heading inside the dialog, so a screen reader names the dialog', async () => {
    open()
    const heading = await screen.findByRole('heading', { name: 'Journal styles', level: 2 })
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r())) })   // past the Sheet's own focus frame
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(heading.closest('[role="dialog"]')).toBe(screen.getByRole('dialog', { name: 'Journal styles' }))
    expect(heading.getAttribute('tabindex')).toBe('-1')                                    // focusable by script, not a Tab stop
  })

  it('Delete then Undo restores the style: the row is gone, then it is back, and focus follows', async () => {
    let deleted = false
    routes.unshift(
      ['GET', /^\/api\/j2\/journal-styles$/, () => ({ ...LIST, styles: LIST.styles.filter((s) => !(deleted && s.id === MEMBER.id)) })],
      ['DELETE', MEMBER_URL, () => { deleted = true; return DELETED }],
      ['POST', re(`/api/j2/journal-styles/${MEMBER.id}/restore`), () => { deleted = false; return RESTORED }],
    )
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${NAME}` }))
    await screen.findByText('Style deleted.')
    await waitFor(() => expect(screen.queryByText(NAME)).toBeNull())
    expect(called('DELETE', MEMBER_END)).toHaveLength(1)
    // focus lands on Undo, the control the row's own button handed over to
    const undo = screen.getByRole('button', { name: 'Undo' })
    await waitFor(() => expect(document.activeElement).toBe(undo))
    fireEvent.click(undo)
    await waitFor(() => expect(called('POST', RESTORE_END)).toHaveLength(1))
    await screen.findByText('Style restored.')
    // the row is back, with its Default badge, and focus is on it (not on <body>)
    const row = (await screen.findByText(NAME)).closest('li')
    expect(within(row).getByText('Default')).toBeInTheDocument()
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true))
    expect(screen.queryByText('Style deleted.')).toBeNull()
  })

  it('the Undo line ends at the next action', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${NAME}` }))
    await screen.findByText('Style deleted.')
    fireEvent.click(await screen.findByRole('button', { name: 'Set Trade plan as default' }))
    await waitFor(() => expect(screen.queryByText('Style deleted.')).toBeNull())
  })

  it('reorders blocks with Move up/Move down and keeps an unknown block', async () => {
    routes.unshift(['GET', MEMBER_URL, UNKNOWN_BLOCK])
    installFetch()
    open()
    await edit()
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
    fireEvent.click(screen.getByRole('button', { name: 'Move Chart of the note’s ticker down' }))
    expect(order()).toEqual(['future', 'chart'])

    // Save sends the order and keeps the unknown block verbatim
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    expect(put().blocks.map((b) => b.block)).toEqual([FUTURE.block, 'chart'])
    expect(put().blocks[0].settings).toEqual(FUTURE.settings)
  })

  describe('keyboard focus stays on the moved row', () => {
    const rows = async () => {
      routes.unshift(['GET', MEMBER_URL, UNKNOWN_BLOCK])
      installFetch()
      open()
      await edit()
      await screen.findByRole('list', { name: 'Blocks in this style' })
      fireEvent.change(screen.getByLabelText('Add a block'), { target: { value: 'chart' } })          // [future, chart]
    }
    const chartUp = () => screen.getByRole('button', { name: 'Move Chart of the note’s ticker up' })
    const chartDown = () => screen.getByRole('button', { name: 'Move Chart of the note’s ticker down' })

    it('a row that reaches the TOP hands focus to its Move down button (its Move up just went disabled)', async () => {
      await rows()
      fireEvent.click(chartUp())
      expect(chartUp()).toBeDisabled()
      expect(document.activeElement).toBe(chartDown())
    })

    it('a row that reaches the BOTTOM hands focus to its Move up button', async () => {
      await rows()
      fireEvent.click(chartUp())                       // [chart, future]
      fireEvent.click(chartDown())                     // [future, chart]
      expect(chartDown()).toBeDisabled()
      expect(document.activeElement).toBe(chartUp())
    })

    it('moving the first row down: focus is not lost when React relocates the row', async () => {
      await rows()
      fireEvent.click(screen.getByRole('button', { name: 'Move A block from a newer version down' }))   // [chart, future]
      const futureUp = screen.getByRole('button', { name: 'Move A block from a newer version up' })
      expect(screen.getByRole('button', { name: 'Move A block from a newer version down' })).toBeDisabled()
      expect(document.activeElement).toBe(futureUp)
    })

    it('a middle row keeps focus on the very button that was pressed', async () => {
      routes.unshift(['GET', MEMBER_URL,
        withMember({ blocks: [{ ...FUTURE, block: 'future_a' }, { ...FUTURE, block: 'future_b' }] })])
      installFetch()
      open()
      await edit()
      await screen.findByRole('list', { name: 'Blocks in this style' })
      fireEvent.change(screen.getByLabelText('Add a block'), { target: { value: 'chart' } })          // [a, b, chart]
      fireEvent.click(chartUp())                                                                       // [a, chart, b]
      expect(chartUp()).not.toBeDisabled()
      expect(document.activeElement).toBe(chartUp())
    })
  })

  it('the drag handle reorders the same list, and starts a drag Firefox accepts', async () => {
    routes.unshift(['GET', MEMBER_URL, withMember({ blocks: [{ ...FUTURE, block: 'a_new' }, CHART] })])
    installFetch()
    open()
    await edit()
    const list = await screen.findByRole('list', { name: 'Blocks in this style' })
    const rows = within(list).getAllByRole('listitem')
    const handle = rows[0].querySelector('[draggable="true"]')
    expect(handle).not.toBeNull()
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(handle, { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', expect.any(String))      // Firefox starts no drag without data
    fireEvent.dragOver(rows[1])
    fireEvent.drop(rows[1])
    expect(within(list).getAllByRole('listitem')[0].textContent).toContain('Chart of the note’s ticker')
  })

  it('shows the live preview with the member’s own ticker, after the debounce', async () => {
    open()
    await edit()
    await screen.findByText(`Shown with ${PREVIEW.ticker}, from your notes.`, {}, { timeout: 3000 })
    const sent = called('POST', /preview$/).at(-1).body
    expect(sent.style.kindId).toBe('trade_plan')
    expect(sent.style.blocks[0].block).toBe('chart')
    // the chart widget is a named line in the preview, not a silent gap
    expect(screen.getByText(`Chart of ${PREVIEW.ticker}, Daily`)).toBeInTheDocument()
  })

  it('says how to see the chart block when the member has no ticker yet', async () => {
    routes.unshift(['POST', /^\/api\/j2\/journal-styles\/preview$/, { ...PREVIEW, ticker: null, tickerSource: null }])
    installFetch()
    open()
    await edit()
    await screen.findByText('Add a ticker to a note to see the chart block.', {}, { timeout: 3000 })
  })

  it('makes a new style: the draft is saved with the chosen kind', async () => {
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

  it('property defaults: a select per user-set select property, Leave empty first, never Kind of note', async () => {
    open()
    await edit()
    const sel = await screen.findByLabelText('Thesis Status')
    expect(within(sel).getAllByRole('option')[0]).toHaveTextContent('Leave empty')
    expect(screen.queryByLabelText('Ticker')).toBeNull()
    fireEvent.change(sel, { target: { value: 'watching' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    // the member's other captured default (the real style carries one) is kept, the chosen one is added
    expect(put().properties).toEqual({ ...MEMBER.properties, 'builtin:thesis_status': 'watching' })
  })

  it('a captured default of 0 or false survives a save', async () => {
    const props = { 'builtin:thesis_status': 'watching', 'builtin:count': 0, 'builtin:flag': false }
    routes.unshift(['GET', MEMBER_URL, withMember({ properties: props })])
    installFetch()
    open()
    await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    expect(put().properties).toEqual(props)
  })

  it('Duplicate to edit makes a member copy of a built-in and opens it', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Trade plan to edit' }))
    await waitFor(() => expect(called('POST', /journal-styles$/)).toHaveLength(1))
    expect(called('POST', /journal-styles$/)[0].body).toMatchObject({ name: 'Trade plan copy', kindId: 'trade_plan' })
    await screen.findByRole('form', { name: 'Edit style Trade plan copy' })
  })

  it('a duplicate of a long name is cut so "copy" still fits the 80 character limit', async () => {
    const long = 'x'.repeat(78)
    routes.unshift(['GET', /^\/api\/j2\/journal-styles$/, { ...LIST, styles: LIST.styles.map((s) => (s.id === MEMBER.id ? { ...s, name: long } : s)) }],
      ['GET', MEMBER_URL, withMember({ name: long })])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Duplicate ${long}` }))
    await waitFor(() => expect(called('POST', /journal-styles$/)).toHaveLength(1))
    const sent = called('POST', /journal-styles$/)[0].body.name
    expect(sent.length).toBeLessThanOrEqual(80)
    expect(sent.endsWith(' copy')).toBe(true)
  })

  it('Set as default calls the server', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Set Trade plan as default' }))
    await waitFor(() => expect(called('POST', /builtin%3Atrade_plan\/default$/)).toHaveLength(1))
  })
})

describe('the outline is never rewritten behind the member’s back (data loss)', () => {
  const rich = () => {
    routes.unshift(['GET', MEMBER_URL, withMember({ outlineBodyJson: RICH_OUTLINE })])
    installFetch()
  }
  const noOutlineKeys = (b) => {
    expect(b).not.toHaveProperty('outlineBodyJson')
    expect(b).not.toHaveProperty('outlineTemplateId')
  }

  it('a rich outline is shown read-only with a plain sentence, not in the text box', async () => {
    rich(); open(); await edit()
    expect(await screen.findByText("This outline has formatting the editor here can't keep. Edit it in a note and save the note's setup again.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Outline text')).toBeNull()
  })

  it('renaming a style with a rich outline sends NO outline', async () => {
    rich(); open(); await edit()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    expect(put().name).toBe('Renamed')
    noOutlineKeys(put())
  })

  it('switching a block off on a rich outline sends NO outline', async () => {
    rich(); open(); await edit()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Use Chart of the note’s ticker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    expect(put().blocks[0].enabled).toBe(false)
    noOutlineKeys(put())
  })

  it('the live preview still composes the style’s real outline', async () => {
    rich(); open(); await edit()
    await waitFor(() => expect(called('POST', /preview$/).length).toBeGreaterThan(0), { timeout: 3000 })
    expect(called('POST', /preview$/).at(-1).body.style.outlineBodyJson).toEqual(RICH_OUTLINE)
  })

  it('choosing "No outline" on a rich outline is a deliberate change and clears it', async () => {
    rich(); open(); await edit()
    fireEvent.click(await screen.findByRole('radio', { name: 'No outline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    expect(put()).toMatchObject({ outlineBodyJson: null, outlineTemplateId: null })
  })

  it('a plain outline is editable as text, and renaming it alone still sends no outline', async () => {
    routes.unshift(['GET', MEMBER_URL, withMember({ outlineBodyJson: PLAIN_OUTLINE })])
    installFetch()
    open(); await edit()
    const box = await screen.findByLabelText('Outline text')
    expect(box.value).toBe('## Setup\n{{block:chart}}\nEntry:')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    noOutlineKeys(put())
  })

  it('editing a plain outline sends it as a doc', async () => {
    routes.unshift(['GET', MEMBER_URL, withMember({ outlineBodyJson: PLAIN_OUTLINE })])
    installFetch()
    open(); await edit()
    fireEvent.change(await screen.findByLabelText('Outline text'), { target: { value: '## Setup\nWhy now?\n## Risk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    expect(put().outlineBodyJson.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'heading'])
  })

  it('the outline picker: a textarea outline is saved as a doc; a built-in outline can be copied in', async () => {
    open(); await edit()
    fireEvent.click(await screen.findByRole('radio', { name: 'Write it here' }))
    fireEvent.change(screen.getByLabelText('Start from a built-in outline'), { target: { value: 'daily-prep' } })
    expect(screen.getByLabelText('Outline text').value).toMatch(/^## /m)
    fireEvent.change(screen.getByLabelText('Outline text'), { target: { value: '## Setup\n{{block:chart}}\n## ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    const doc = put().outlineBodyJson
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph'])          // the bare "## " line is dropped
    expect(doc.content[1].content[0].text).toBe('{{block:chart}}')
  })

  it('"One of my templates" with none chosen blocks Save with a sentence', async () => {
    open(); await edit()
    fireEvent.click(await screen.findByRole('radio', { name: 'One of my templates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    expect(await alertText()).toBe('Choose one of your templates, or pick another outline option.')
    expect(called('PUT', MEMBER_END)).toHaveLength(0)
  })

  it('a linked template that was deleted says so, and saving something else still works', async () => {
    routes.unshift(['GET', MEMBER_URL, withMember({ outlineTemplateId: 't_gone' })])
    installFetch()
    open(); await edit()
    expect(await screen.findByText('That template no longer exists.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await waitFor(() => expect(called('PUT', MEMBER_END)).toHaveLength(1))
    noOutlineKeys(put())                                   // the dead id is not sent back to the server
  })
})

describe('where the member is looking (phone and keyboard)', () => {
  it('opening the editor moves focus to its heading and scrolls it into view', async () => {
    open()
    await edit()
    const heading = screen.getByRole('heading', { name: 'Edit style', level: 3 })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('New style and Duplicate to edit do the same', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /New style/ }))
    const heading = await screen.findByRole('heading', { name: 'New style', level: 3 })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('after Save, focus returns to the button that opened the editor and the sentence is announced', async () => {
    open()
    await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await screen.findByText(`Saved ${NAME}.`)
    const opener = screen.getByRole('button', { name: `Edit ${NAME}` })
    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(screen.getByText(`Saved ${NAME}.`).closest('[role="status"]')).not.toBeNull()
  })

  it('after Cancel, focus returns to the opener too', async () => {
    open()
    await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: `Edit ${NAME}` })))
  })

  it('closing with unsaved changes asks in the page first; Keep editing keeps them', async () => {
    const onClose = vi.fn()
    open({ onClose })
    await edit()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Discard your unsaved changes to this style?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByText('Discard your unsaved changes to this style?')).toBeNull()
    expect(screen.getByLabelText('Name').value).toBe('Half done')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closing an editor with nothing changed just closes', async () => {
    const onClose = vi.fn()
    open({ onClose })
    await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Discard your unsaved changes to this style?')).toBeNull()
  })
})

describe('when the connection or the server fails', () => {
  it('a network failure on an action says the member is offline, not "Failed to fetch"', async () => {
    routes.unshift(['DELETE', MEMBER_URL, NETWORK])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${NAME}` }))
    expect(await alertText()).toBe(OFFLINE)
  })

  it('a server error with no JSON body says something went wrong, not "500"', async () => {
    routes.unshift(['DELETE', MEMBER_URL, NO_BODY])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${NAME}` }))
    expect(await alertText()).toBe(SERVER_SIDE)
  })

  it('a browser that reports itself offline always gets the offline sentence', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    try {
      routes.unshift(['DELETE', MEMBER_URL, NO_BODY])
      installFetch()
      open()
      fireEvent.click(await screen.findByRole('button', { name: `Delete ${NAME}` }))
      expect(await alertText()).toBe(OFFLINE)
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    }
  })

  it('a refusal the server worded is shown word for word', async () => {
    routes.unshift(['PUT', MEMBER_URL, [REFUSED._contract.status, REFUSED.body]])
    installFetch()
    open(); await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    expect(await alertText()).toBe(REFUSED.body.detail)
  })

  it('the live preview says offline / server trouble in the same words', async () => {
    routes.unshift(['POST', /^\/api\/j2\/journal-styles\/preview$/, NETWORK])
    installFetch()
    open(); await edit()
    expect(await screen.findByText(OFFLINE, {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('a first load that fails offline says so, with Try again', async () => {
    routes.unshift(['GET', /^\/api\/j2\/journal-styles$/, NETWORK])
    installFetch()
    open()
    expect(await alertText()).toContain(OFFLINE)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('kinds of note', () => {
  it('adds a kind with a name and an icon from the registry; names stop at the server’s 40', async () => {
    routes.unshift(['POST', /^\/api\/j2\/note-kinds$/, (b) => ({ kind: { ...OWN_KIND, name: b.name, icon: b.icon } })])
    installFetch()
    open()
    const name = await screen.findByLabelText('New kind name')
    expect(name).toHaveAttribute('maxlength', '40')
    fireEvent.change(name, { target: { value: 'Earnings plays' } })
    fireEvent.change(screen.getByLabelText('Icon'), { target: { value: 'bolt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add kind' }))
    await waitFor(() => expect(called('POST', /note-kinds$/)).toHaveLength(1))
    expect(called('POST', /note-kinds$/)[0].body).toEqual({ name: 'Earnings plays', icon: 'bolt' })
    await screen.findByText('Kind added.')
  })

  it('renames an own kind', async () => {
    routes.unshift(['PUT', OWN_KIND_URL, (b) => ({ kind: { ...contractBody('note-kinds.update').kind, ...b } })])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Rename ${KIND_NAME}` }))
    const input = screen.getByLabelText(`New name for ${KIND_NAME}`)
    expect(input).toHaveAttribute('maxlength', '40')
    fireEvent.change(input, { target: { value: 'My setups' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(called('PUT', OWN_KIND_END)).toHaveLength(1))
    expect(called('PUT', OWN_KIND_END)[0].body).toEqual({ name: 'My setups' })
  })

  it('deleting a kind asks first, in the page, and says what goes with it; Keep changes nothing', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    routes.unshift(['DELETE', OWN_KIND_URL, kindDeleted(0)])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete kind ${KIND_NAME}` }))
    expect(await screen.findByText(`Delete the kind ${KIND_NAME}? Styles you deleted that used it are removed permanently.`)).toBeInTheDocument()
    expect(called('DELETE', /note-kinds/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: `Keep kind ${KIND_NAME}` }))
    expect(called('DELETE', /note-kinds/)).toHaveLength(0)
    expect(screen.queryByText(/Styles you deleted that used it/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `Delete kind ${KIND_NAME}` }))
    fireEvent.click(await screen.findByRole('button', { name: `Yes, delete kind ${KIND_NAME}` }))
    await waitFor(() => expect(called('DELETE', OWN_KIND_END)).toHaveLength(1))
    expect(confirmSpy).not.toHaveBeenCalled()                    // never window.confirm
    confirmSpy.mockRestore()
  })

  it('a kind still in use shows the server’s sentence, word for word', async () => {
    const sentence = IN_USE.body.detail
    routes.unshift(['DELETE', OWN_KIND_URL, [IN_USE._contract.status, IN_USE.body]])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete kind ${KIND_NAME}` }))
    fireEvent.click(await screen.findByRole('button', { name: `Yes, delete kind ${KIND_NAME}` }))
    expect(await alertText()).toBe(sentence)
  })

  it('a deleted kind says how many deleted styles went with it', async () => {
    routes.unshift(['DELETE', OWN_KIND_URL, kindDeleted(2)])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete kind ${KIND_NAME}` }))
    fireEvent.click(await screen.findByRole('button', { name: `Yes, delete kind ${KIND_NAME}` }))
    await screen.findByText(/Kind deleted\. 2 styles you had deleted for it were removed for good\./)
  })

  it('the server’s own answer (one deleted style went with the kind) is worded in the singular', async () => {
    routes.unshift(['DELETE', OWN_KIND_URL, KIND_DELETED])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete kind ${KIND_NAME}` }))
    fireEvent.click(await screen.findByRole('button', { name: `Yes, delete kind ${KIND_NAME}` }))
    await screen.findByText(`Kind deleted. ${KIND_DELETED.purgedDeletedStyles} style you had deleted for it was removed for good.`)
  })

  it('built-in kinds have no Rename or Delete', async () => {
    open()
    await screen.findByRole('heading', { name: 'Your kinds of note' })
    expect(screen.queryByRole('button', { name: 'Rename Trade plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete kind Trade plan' })).toBeNull()
  })
})

describe('the Research Type mapping offer', () => {
  const applied = (over = {}) => ({ ...APPLIED, ...over })
  const withOffer = (post, offer = OFFER) => {
    routes.unshift(
      ['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, offer],
      ['POST', /^\/api\/j2\/note-kinds\/mapping-offer$/, post],
    )
    installFetch()
  }

  it('applies and passes the blocked note ids; locked notes are counted aloud', async () => {
    withOffer(applied())
    open({ blockedNoteIds: ['n-blocked'] })
    await screen.findByText(`You have ${OFFER.offer.total} notes with a Research Type. Set their Kind of note to match?`)
    fireEvent.click(screen.getByRole('button', { name: 'Set kinds' }))
    await waitFor(() => expect(called('POST', /mapping-offer$/)).toHaveLength(1))
    expect(called('POST', /mapping-offer$/)[0].body).toEqual({ excludeNoteIds: ['n-blocked'] })
    await screen.findByText(`Set the kind on ${APPLIED.count} note. ${APPLIED.skipped.length} locked note was left as it was.`)
  })

  it('notes held back for unsent offline work are named too (3 asked, 1 set, 1 locked, 1 held back)', async () => {
    withOffer(applied(), offerOf({ total: OFFER.offer.total + 1 }))        // one more counted than the server answered for
    open({ blockedNoteIds: ['n-blocked'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Set kinds' }))
    await screen.findByText(/1 note with unsent changes was left for later\./)
  })

  it('the offer is not asked again after it was applied, even though the server still counts the skipped notes', async () => {
    withOffer(applied())
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Set kinds' }))
    await screen.findByText(APPLIED_RE)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByText(/with a Research Type\. Set their Kind/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set kinds' })).toBeNull()
  })

  it('Not now writes the preference', async () => {
    routes.unshift(['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, OFFER])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
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

describe('round 3: the applied offer outlives the Notebook route', () => {
  const setup = () => {
    routes.unshift(
      ['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, OFFER],
      ['POST', /^\/api\/j2\/note-kinds\/mapping-offer$/, APPLIED],
    )
    installFetch()
  }
  const noOffer = async () => {
    await screen.findByRole('heading', { name: 'Trade plan', level: 3 })
    await waitFor(() => expect(called('GET', /mapping-offer$/).length).toBeGreaterThan(0))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByRole('button', { name: 'Set kinds' })).toBeNull()
  }

  it('apply, leave (unmount), arrive again through Settings: the offer is not asked again', async () => {
    setup()
    const first = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Set kinds' }))
    await screen.findByText(APPLIED_RE)
    first.unmount()
    open()
    await noOffer()
  })

  it('storage that throws still hides it for the rest of the session (in this module)', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      setup()
      const first = open()
      fireEvent.click(await screen.findByRole('button', { name: 'Set kinds' }))
      await screen.findByText(APPLIED_RE)
      first.unmount()
      open()
      await noOffer()
    } finally { get.mockRestore(); set.mockRestore() }
  })

  it('it is kept per member: another member is still offered theirs', async () => {
    setup()
    const first = open({ userId: 'u1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Set kinds' }))
    await screen.findByText(APPLIED_RE)
    first.unmount()
    open({ userId: 'u2' })
    expect(await screen.findByRole('button', { name: 'Set kinds' })).toBeInTheDocument()
  })
})

describe('round 3: unsaved editor changes', () => {
  const PROMPT = 'Discard your unsaved changes to this style?'

  it('Cancel clears a discard prompt that was waiting', async () => {
    open()
    await edit()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await screen.findByText(PROMPT)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(PROMPT)).toBeNull())
  })

  it('Save clears it too', async () => {
    open()
    await edit()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await screen.findByText(PROMPT)
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await screen.findByText('Saved Half done.')
    expect(screen.queryByText(PROMPT)).toBeNull()
  })

  it('opening another style over a dirty editor asks first; nothing is created until the answer', async () => {
    open()
    await edit()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Trade plan to edit' }))
    await screen.findByText(PROMPT)
    expect(called('POST', /journal-styles$/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Name').value).toBe('Half done')
    expect(called('POST', /journal-styles$/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Trade plan to edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await screen.findByRole('form', { name: 'Edit style Trade plan copy' })
    expect(called('POST', /journal-styles$/)).toHaveLength(1)
  })

  it('New style over a dirty editor asks too; Discard goes where the member asked', async () => {
    open()
    await edit()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half done' } })
    fireEvent.click(screen.getByRole('button', { name: /New style/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await screen.findByRole('form', { name: 'New style' })
    expect(screen.getByLabelText('Name').value).toBe('')
  })

  it('with nothing changed, opening another style just opens it', async () => {
    open()
    await edit()
    fireEvent.click(screen.getByRole('button', { name: /New style/ }))
    await screen.findByRole('form', { name: 'New style' })
    expect(screen.queryByText(PROMPT)).toBeNull()
  })
})

describe('round 3: "offline" only for a real network failure', () => {
  it('a TypeError from our own code is not called offline: server-side words, and it is logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    routes.unshift(['DELETE', MEMBER_URL, CODE_BUG])
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${NAME}` }))
    expect(await alertText()).toBe(SERVER_SIDE)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('Chrome, Safari and Firefox wordings of a network failure are offline', () => {
    for (const msg of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
      expect(friendlyError(new TypeError(msg))).toBe(OFFLINE)
    }
  })
})

describe('round 3: the kind-delete confirm keeps focus', () => {
  const TWO = { ...LIST, kinds: [...LIST.kinds, OTHER_OWN_KIND] }
  const kindRoutes = (list) => {
    routes.unshift(['GET', /^\/api\/j2\/journal-styles$/, list], ['DELETE', OWN_KIND_URL, kindDeleted(0)])
    installFetch()
  }

  it('opening the confirm focuses its first button; Keep returns focus to that kind’s Delete', async () => {
    kindRoutes(TWO)
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete kind ${KIND_NAME}` }))
    const yes = await screen.findByRole('button', { name: `Yes, delete kind ${KIND_NAME}` })
    await waitFor(() => expect(document.activeElement).toBe(yes))
    fireEvent.click(screen.getByRole('button', { name: `Keep kind ${KIND_NAME}` }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: `Delete kind ${KIND_NAME}` })))
  })

  it('after a delete, focus goes to the next kind row (its first button)', async () => {
    let gone = false
    routes.unshift(
      ['GET', /^\/api\/j2\/journal-styles$/, () => (gone ? { ...TWO, kinds: TWO.kinds.filter((k) => k.id !== OWN_KIND.id) } : TWO)],
      ['DELETE', OWN_KIND_URL, () => { gone = true; return kindDeleted(0) }],
    )
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete kind ${KIND_NAME}` }))
    fireEvent.click(await screen.findByRole('button', { name: `Yes, delete kind ${KIND_NAME}` }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: `Rename ${OTHER_OWN_KIND.name}` })))
  })

  it('deleting the last own kind sends focus to the add-kind field', async () => {
    let gone = false
    routes.unshift(
      ['GET', /^\/api\/j2\/journal-styles$/, () => (gone ? { ...LIST, kinds: LIST.kinds.filter((k) => k.id !== OWN_KIND.id) } : LIST)],
      ['DELETE', OWN_KIND_URL, () => { gone = true; return kindDeleted(0) }],
    )
    installFetch()
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Delete kind ${KIND_NAME}` }))
    fireEvent.click(await screen.findByRole('button', { name: `Yes, delete kind ${KIND_NAME}` }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('New kind name')))
  })
})

describe('round 3: the status bar leaves no gap when it has nothing to say', () => {
  it('is marked empty until there is something to say, then is not', async () => {
    open()
    await screen.findByRole('heading', { name: 'Trade plan', level: 3 })
    const bar = screen.getByRole('status').parentElement
    expect(bar).toHaveAttribute('data-empty')
    fireEvent.click(screen.getByRole('button', { name: `Delete ${NAME}` }))
    await screen.findByText('Style deleted.')
    expect(bar).not.toHaveAttribute('data-empty')
  })
})

describe('round 4: Discard really discards, even when the same editor is reopened', () => {
  const PROMPT = 'Discard your unsaved changes to this style?'

  it('Edit A over a dirty A: Discard shows the stored values, nothing is dirty, Close asks nothing', async () => {
    const onClose = vi.fn()
    open({ onClose })
    await edit()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Typed over it' } })
    fireEvent.click(screen.getByRole('button', { name: `Edit ${NAME}` }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.getByLabelText('Name').value).toBe(NAME))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(PROMPT)).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('New style over a dirty New style: Discard gives a blank form again', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /New style/ }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Half a draft' } })
    fireEvent.click(screen.getByRole('button', { name: /New style/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.getByLabelText('Name').value).toBe(''))
  })
})

describe('round 4: deleting the open style', () => {
  it('clears a discard prompt that was waiting on it', async () => {
    open()
    await edit()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await screen.findByText('Discard your unsaved changes to this style?')
    fireEvent.click(screen.getByRole('button', { name: `Delete ${NAME}` }))
    await screen.findByText('Style deleted.')
    expect(screen.queryByText('Discard your unsaved changes to this style?')).toBeNull()
    expect(screen.queryByRole('form', { name: /Edit style/ })).toBeNull()
  })
})

describe('round 4: a bug of ours is logged once, not on every render', () => {
  it('a first-load code bug: one console.error across re-renders', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    routes.unshift(['GET', /^\/api\/j2\/journal-styles$/, CODE_BUG])
    installFetch()
    const view = open()
    expect(await alertText()).toContain(SERVER_SIDE)
    for (let i = 0; i < 3; i += 1) view.rerender(tree())
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(spy.mock.calls.filter(([m]) => String(m).includes('journal styles'))).toHaveLength(1)
    spy.mockRestore()
  })

  it('friendlyError itself is pure: it never logs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    friendlyError(new TypeError('x is undefined'))
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
