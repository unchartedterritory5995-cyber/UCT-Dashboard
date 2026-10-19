// P4b Task 7 — shared PAGE LAYOUTS in the community library, end to end in the client: the Page layouts chip and its
// gate (capabilities.layoutSharing, P4b-R-T3-2), a layout card, Preview, the adopt confirm with what changes, Undo,
// a refused adopt, a failed preference write and Try again, the readFailed refusal, a layout that cannot be used
// (payload null, P4b-T6b-R1), and the controls' names and tab order.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
//
// CONTRACT: the fake server answers with the REAL server's recorded fixtures (`__fixtures__/contract`): the layouts
// list, the layout item in full, adopt and its 409, Helpful. It keeps state (the switch, which answer adopt gives,
// what the preference write answers) and routes. Where a case needs a value the recordings do not hold (the switch
// off, a Today layout, a null payload) it spreads the recorded object and names the one field it changes.
// The preferences hook is the REAL one (usePreferences.js) over the faked fetch, because "only {ok: true} is a write"
// is the hook's contract, not a fake's.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import TemplateGallery from './TemplateGallery'
import { CHANGE_FAILED, STANDING_LINE } from './AdoptLayoutSheet'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { ITEM_TYPES, LAYOUT_UNSUPPORTED_SENTENCE } from '../../lib/styleLibrary'
import { DEFAULT_LAYOUT, LAYOUT_PREF, LOAD_FAILED, PANELS, normalizeLayout } from '../../lib/pageLayouts'
import { contract, contractBody } from '../../__fixtures__/contract'

const LIST = contract('template-gallery.list.layouts')
const ROW = LIST.body.templates[0]
const ITEM = contractBody('template-gallery.layouts.item').template
const ADOPT = contract('template-gallery.layouts.adopt')
const MOVED = contract('template-gallery.layouts.adopt.version-moved')
const OUTLINES = contractBody('template-gallery.list').templates.filter((t) => t.itemType !== 'page_layout')
// A Today layout: the recorded Today share, as a listed row a member sees, with a payload for two of the phases.
const TODAY_ROW = { ...contractBody('template-gallery.layouts.publish.today').template, mine: false, status: undefined,
  id: 'today-layout-1', title: 'Calm open' }
const TODAY_PAYLOAD = { page: 'today', lists: { market: [{ id: 'regime', shown: true }, { id: 'todayNote', shown: true }],
  premarket: [{ id: 'checklistToday', shown: true }] } }

const answer = (name) => { const c = contract(name); return { ok: c._contract.status < 400, status: c._contract.status, headers: { get: () => null }, json: async () => c.body } }
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body })

// The member's own saved layout: Today's market phase changed, and a panel a newer build wrote at the head of trade.
const MINE = normalizeLayout({
  ...JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
  today: { ...DEFAULT_LAYOUT.today, market: [{ id: 'regime', shown: true }, ...DEFAULT_LAYOUT.today.market.filter((e) => e.id !== 'regime')] },
  trade: [{ id: 'futurePanel', shown: true }, ...DEFAULT_LAYOUT.trade],
})

let server
let calls
beforeEach(() => {
  server = { sharing: true, adoptAnswer: 'template-gallery.layouts.adopt', prefStatus: [200], prefsRead: 200,
    itemPayload: undefined, rows: [ROW] }
  calls = []
  __resetRevisionStateForTests()
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ path: u.pathname, search: u.search, method, body })
    if (u.pathname === '/api/auth/preferences' && method === 'GET') {
      return server.prefsRead === 200 ? json({ [LAYOUT_PREF]: JSON.stringify(MINE) }) : json({ detail: 'Bad gateway' }, server.prefsRead)
    }
    if (u.pathname === '/api/auth/preferences' && method === 'POST') {
      const status = server.prefStatus.length > 1 ? server.prefStatus.shift() : server.prefStatus[0]
      return json(status < 400 ? { version: 1 } : { detail: 'That page layout could not be saved. Reset it and try again.' }, status)
    }
    if (u.pathname === '/api/j2/telemetry') return json({ ok: true })
    if (u.pathname === '/api/j2/template-gallery' && method === 'GET') {
      const type = u.searchParams.get('type') || ''
      const section = u.searchParams.get('section') || 'all'
      if (type === 'page_layout' && !server.sharing) return json({ detail: 'Unknown item type.' }, 400)
      let list = type === 'page_layout' ? server.rows : type === 'outline' ? OUTLINES : [...OUTLINES, ...server.rows]
      if (section === 'picks') list = list.filter((t) => t.featured)
      return json({ templates: list, viewer: { admin: false }, capabilities: { layoutSharing: server.sharing } })
    }
    let m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/adopt-layout$/)
    if (m) return answer(server.adoptAnswer)
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/helpful$/)
    if (m) return answer('template-gallery.layouts.helpful')
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)$/)
    if (m && method === 'GET') {
      if (m[1] === TODAY_ROW.id) return json({ template: { ...TODAY_ROW, version: 1, payload: TODAY_PAYLOAD } })
      if (m[1] !== ITEM.id) return answer('template-gallery.item.not-found')
      return json({ template: server.itemPayload === undefined ? ITEM : { ...ITEM, payload: server.itemPayload } })
    }
    return answer('template-gallery.item.not-found')
  })
  latchNotebookFlags({ notebook_template_gallery_enabled: true, notebook_style_library_enabled: true })
})
afterEach(() => { __resetNotebookFlags() })

const listCalls = () => calls.filter((c) => c.path === '/api/j2/template-gallery' && c.method === 'GET')
const adoptPosts = () => calls.filter((c) => c.path.endsWith('/adopt-layout') && c.method === 'POST')
const prefPosts = () => calls.filter((c) => c.path === '/api/auth/preferences' && c.method === 'POST')
const sentEvents = (event) => calls.filter((c) => c.path === '/api/j2/telemetry' && c.method === 'POST' && c.body?.event === event)
  .map((c) => c.body.props)

function renderGallery(props = {}) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TemplateGallery onBack={vi.fn()} {...props} />
      </SWRConfig>
    </MemoryRouter>,
  )
  return user
}

const layoutCard = (title = ROW.title) => screen.getByRole('heading', { name: title }).closest('[data-library-layout]')

async function openLayouts() {
  const user = renderGallery()
  const types = await screen.findByRole('group', { name: 'Filter by type' })
  await user.click(await within(types).findByRole('button', { name: 'Page layouts' }))
  await screen.findByRole('heading', { name: ROW.title })
  return user
}

async function openConfirm() {
  const user = await openLayouts()
  await user.click(within(layoutCard()).getByRole('button', { name: `Use this layout: ${ROW.title}` }))
  const dialog = await screen.findByRole('dialog', { name: 'Use this layout for the trade page?' })
  return { user, dialog }
}

describe('the recorded layout library holds what these rails read (non-vacuity)', () => {
  it('a listed trade layout with a handle, its payload, an adopt credit and a 409', () => {
    expect(LIST._contract.path).toContain('type=page_layout')
    expect(LIST.body.capabilities.layoutSharing).toBe(true)
    expect(ROW).toMatchObject({ itemType: 'page_layout', layoutPage: 'trade', mine: false })
    expect(ITEM.id).toBe(ROW.id)
    expect(ITEM.payload.lists.trade.length).toBeGreaterThan(0)
    expect(ADOPT.body.layout).toEqual(ITEM.payload)                      // the preview is what adopt applies (T6-R1)
    expect(ADOPT.body.credit).toMatch(/^Based on /)
    expect(MOVED._contract.status).toBe(409)
    expect(ITEM_TYPES.map((t) => t.key)).toContain('page_layout')
  })

  it('the unsupported sentence is the server’s own (LAYOUT_UNSUPPORTED_SENTENCE in template_gallery.py)', () => {
    const src = readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'template_gallery.py'), 'utf8')
    const m = src.match(/^LAYOUT_UNSUPPORTED_SENTENCE = "([^"]+)"$/m)
    expect(m).not.toBeNull()
    expect(LAYOUT_UNSUPPORTED_SENTENCE).toBe(m[1])
  })
})

describe('1. the Page layouts chip is gated on capabilities.layoutSharing (P4b-R-T3-2)', () => {
  it('false: no Page layouts chip, and a page_layout row in a stale cache renders nothing', async () => {
    server.sharing = false
    renderGallery()
    const types = await screen.findByRole('group', { name: 'Filter by type' })
    // the untyped list still carried the layout row: it must not render, as a layout card or as an outline card
    await screen.findByRole('heading', { name: OUTLINES[0].title })
    expect(listCalls().some((c) => c.search === '')).toBe(true)
    expect(within(types).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['All', ...ITEM_TYPES.filter((t) => t.key !== 'page_layout').map((t) => t.label)])
    expect(within(types).queryByRole('button', { name: 'Page layouts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: ROW.title })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Use template ${ROW.title}` })).not.toBeInTheDocument()
  })

  it('true: the chip shows and filters the URL', async () => {
    await openLayouts()
    await waitFor(() => expect(listCalls().some((c) => c.search.includes('type=page_layout'))).toBe(true))
    const types = screen.getByRole('group', { name: 'Filter by type' })
    expect(within(types).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', ...ITEM_TYPES.map((t) => t.label)])
    expect(within(types).getByRole('button', { name: 'Page layouts' })).toHaveAttribute('aria-pressed', 'true')
    // the trading-style row shows for page layouts too
    expect(screen.getByRole('group', { name: 'Filter by trading style' })).toBeInTheDocument()
  })

  it('initialType page_layout is accepted at mount, and resets to All when sharing is off (X11)', async () => {
    renderGallery({ initialType: 'page_layout' })
    await screen.findByRole('heading', { name: ROW.title })
    expect(listCalls()[0].search).toContain('type=page_layout')
    expect(within(screen.getByRole('group', { name: 'Filter by type' })).getByRole('button', { name: 'Page layouts' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('a stale tab opened at Page layouts with sharing off falls back to All, never a dead 400 screen', async () => {
    server.sharing = false
    renderGallery({ initialType: 'page_layout' })
    await screen.findByRole('heading', { name: OUTLINES[0].title })
    const types = screen.getByRole('group', { name: 'Filter by type' })
    expect(within(types).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(types).queryByRole('button', { name: 'Page layouts' })).not.toBeInTheDocument()
    expect(listCalls()[0].search).toContain('type=page_layout')               // control: it did start there
    expect(screen.queryByText("Couldn't load the community gallery.")).not.toBeInTheDocument()
  })

  it('choosing the chip sends library_viewed {type: page_layout, view: browse}', async () => {
    await openLayouts()
    await waitFor(() => expect(sentEvents('library_viewed')).toEqual([
      { type: 'all', view: 'browse' }, { type: 'page_layout', view: 'browse' }]))
  })
})

describe('2. a layout card', () => {
  it('shows the title, the Trade page badge, Used by N, and no Helpful toggle on your own', async () => {
    server.rows = [{ ...ROW, usedBy: 3 }]
    await openLayouts()
    const card = layoutCard()
    expect(within(card).getByText('Trade page')).toBeInTheDocument()
    expect(within(card).getByText('Used by 3', { exact: false })).toBeInTheDocument()
    expect(within(card).getByText(`${ROW.helpfulCount} found this helpful`)).toBeInTheDocument()
    expect(within(card).getByText(new RegExp('· Swing'))).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: `Helpful: ${ROW.title}` })).toHaveAttribute('aria-pressed', 'false')
    expect(within(card).getByRole('button', { name: `See what ${ROW.author} shared` })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: `Use template ${ROW.title}` })).not.toBeInTheDocument()  // X8
  })

  it('on your own item: no Helpful, no Report', async () => {
    server.rows = [{ ...ROW, mine: true }]
    await openLayouts()
    expect(within(layoutCard()).queryByRole('button', { name: `Helpful: ${ROW.title}` })).not.toBeInTheDocument()
    expect(within(layoutCard()).queryByRole('button', { name: `Report ${ROW.title}` })).not.toBeInTheDocument()
  })
})

describe('3. Preview', () => {
  it('reads the item in full and shows Shared and Yours now by label', async () => {
    const user = await openLayouts()
    await user.click(within(layoutCard()).getByRole('button', { name: `Preview ${ROW.title}` }))
    const dialog = await screen.findByRole('dialog', { name: `Preview: ${ROW.title}` })
    await waitFor(() => expect(calls.some((c) => c.path === `/api/j2/template-gallery/${ITEM.id}` && c.method === 'GET')).toBe(true))
    const shared = await within(dialog).findByRole('list', { name: 'Shared, trade page' })
    const yours = within(dialog).getByRole('list', { name: 'Yours now, trade page' })
    const label = (id) => PANELS.trade.find((p) => p.id === id).label
    expect(within(shared).getAllByRole('listitem').slice(0, 3).map((li) => li.textContent))
      .toEqual([`${label('story')}Shown`, `${label('chart')}Hidden`, `${label('outcome')}Shown`])
    expect(within(yours).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(PANELS.trade.map((p) => `${p.label}Shown`))
    expect(within(dialog).queryByRole('group', { name: 'Phase' })).not.toBeInTheDocument()     // no phases on the trade page
  })

  it('for Today: a phase tab row, and a phase the layout has no list for says so', async () => {
    server.rows = [TODAY_ROW]
    const user = renderGallery({ initialType: 'page_layout' })
    const card = (await screen.findByRole('heading', { name: TODAY_ROW.title })).closest('[data-library-layout]')
    await user.click(within(card).getByRole('button', { name: `Preview ${TODAY_ROW.title}` }))
    const dialog = await screen.findByRole('dialog', { name: `Preview: ${TODAY_ROW.title}` })
    const tabs = await within(dialog).findByRole('group', { name: 'Phase' })
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Premarket', 'Market', 'After close'])
    expect(within(tabs).getByRole('button', { name: 'Market' })).toHaveAttribute('aria-pressed', 'true')
    const shared = within(dialog).getByRole('list', { name: 'Shared, Market' })
    expect(within(shared).getAllByRole('listitem').slice(0, 2).map((li) => li.textContent))
      .toEqual(['Market regimeShown', "Today's noteShown"])
    await user.click(within(tabs).getByRole('button', { name: 'After close' }))
    expect(within(tabs).getByRole('button', { name: 'After close' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByText("This layout doesn't change After close.")).toBeInTheDocument()
    expect(within(dialog).queryByRole('list', { name: /Shared/ })).not.toBeInTheDocument()
  })

  it('a layout whose payload is null says it cannot be used yet, offers no Use, and never reads its lists (T6b-R1)', async () => {
    server.itemPayload = null
    const user = await openLayouts()
    await user.click(within(layoutCard()).getByRole('button', { name: `Preview ${ROW.title}` }))
    const dialog = await screen.findByRole('dialog', { name: `Preview: ${ROW.title}` })
    expect(await within(dialog).findByText(LAYOUT_UNSUPPORTED_SENTENCE)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Use this layout' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument()
    // the card's own Use reads the item, finds no payload, and opens nothing
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1))
    await user.click(within(layoutCard()).getByRole('button', { name: `Use this layout: ${ROW.title}` }))
    expect(await screen.findByText(LAYOUT_UNSUPPORTED_SENTENCE)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Use this layout for the trade page?' })).not.toBeInTheDocument()
    expect(adoptPosts()).toHaveLength(0)
    expect(prefPosts()).toHaveLength(0)
  })
})

describe('4. adopt replaces only the shared phases, and Undo restores them', () => {
  it('confirm shows what changes; Use posts {version}, writes trade only, and Undo puts the old list back exactly', async () => {
    const { user, dialog } = await openConfirm()
    expect(within(dialog).getByText('Your current trade page layout is replaced for the parts listed below. Nothing else changes.')).toBeInTheDocument()
    expect(within(dialog).getByText(STANDING_LINE)).toBeInTheDocument()
    const rows = within(within(dialog).getByRole('list', { name: 'What changes' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      `The trade page: now ${PANELS.trade.map((p) => p.label).join(', ')} · after The story, Outcome`])
    await user.click(within(dialog).getByRole('button', { name: 'Use this layout' }))
    const toast = `The trade page now uses "${ROW.title}". ${ADOPT.body.credit}.`
    expect(await screen.findByText(toast)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Use this layout for the trade page?' })).not.toBeInTheDocument()

    expect(adoptPosts()).toHaveLength(1)
    expect(adoptPosts()[0].path).toBe(`/api/j2/template-gallery/${ITEM.id}/adopt-layout`)
    expect(JSON.stringify(adoptPosts()[0].body)).toBe(JSON.stringify({ version: ITEM.version }))
    expect(prefPosts()).toHaveLength(1)
    expect(prefPosts()[0].body.key).toBe('journal_page_layout')
    const written = JSON.parse(prefPosts()[0].body.value)
    expect(JSON.stringify(written.today)).toBe(JSON.stringify(MINE.today))                  // byte-equal
    expect(written.trade.slice(0, 3)).toEqual(ADOPT.body.layout.lists.trade)
    expect(written.trade.map((e) => e.id)).toContain('futurePanel')
    expect(written.trade.find((e) => e.id === 'review')).toEqual({ id: 'review', shown: false })

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Your previous trade page layout is back.')).toBeInTheDocument()
    expect(prefPosts()).toHaveLength(2)
    const restored = JSON.parse(prefPosts()[1].body.value)
    expect(restored.trade).toEqual(MINE.trade)                                                // futurePanel back at the head
    expect(JSON.stringify(restored.today)).toBe(JSON.stringify(MINE.today))
    expect(adoptPosts()).toHaveLength(1)                                                      // Undo never re-adopts
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('an Undo the server refuses says so and points at Customize', async () => {
    server.prefStatus = [200, 400]
    const { user, dialog } = await openConfirm()
    await user.click(within(dialog).getByRole('button', { name: 'Use this layout' }))
    await screen.findByText(`The trade page now uses "${ROW.title}". ${ADOPT.body.credit}.`)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText("Couldn't put your previous layout back. Open Customize to change it.")).toBeInTheDocument()
  })
})

describe('5. a refused adopt', () => {
  it('a 409 renders the server’s moved sentence, and no preference is written', async () => {
    server.adoptAnswer = 'template-gallery.layouts.adopt.version-moved'
    const { user, dialog } = await openConfirm()
    await user.click(within(dialog).getByRole('button', { name: 'Use this layout' }))
    expect(await within(dialog).findByText(MOVED.body.detail)).toBeInTheDocument()
    expect(adoptPosts()).toHaveLength(1)
    expect(prefPosts()).toHaveLength(0)
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

describe('6. a failed preference write', () => {
  it('{ok: false} says nothing was changed, and Try again posts the preference only', async () => {
    server.prefStatus = [400, 200]
    const { user, dialog } = await openConfirm()
    await user.click(within(dialog).getByRole('button', { name: 'Use this layout' }))
    expect(await within(dialog).findByText(CHANGE_FAILED)).toBeInTheDocument()
    expect(CHANGE_FAILED).toBe("Couldn't change your layout. Nothing was changed.")
    expect(prefPosts()).toHaveLength(1)
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(`The trade page now uses "${ROW.title}". ${ADOPT.body.credit}.`)).toBeInTheDocument()
    expect(prefPosts()).toHaveLength(2)
    expect(adoptPosts()).toHaveLength(1)                                                      // no second adopt POST
  })
})

describe('7. adopt is refused while the member’s layout could not be read', () => {
  it('Use this layout is disabled and the load-failed sentence renders', async () => {
    server.prefsRead = 502
    const { user, dialog } = await openConfirm()
    expect(await within(dialog).findByText(LOAD_FAILED)).toBeInTheDocument()
    const use = within(dialog).getByRole('button', { name: 'Use this layout' })
    expect(use).toBeDisabled()
    await user.click(use)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(adoptPosts()).toHaveLength(0)
    expect(prefPosts()).toHaveLength(0)
  })
})

describe('8. names and tab order', () => {
  it('every new control has an accessible name; the preview tabs run the phase tabs, then the actions', async () => {
    server.rows = [TODAY_ROW]
    const user = renderGallery({ initialType: 'page_layout' })
    const card = (await screen.findByRole('heading', { name: TODAY_ROW.title })).closest('[data-library-layout]')
    for (const b of within(card).getAllByRole('button')) expect(b).toHaveAccessibleName()
    expect(within(card).getByText('Today')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: `Preview ${TODAY_ROW.title}` }))
    const dialog = await screen.findByRole('dialog', { name: `Preview: ${TODAY_ROW.title}` })
    const tabs = await within(dialog).findByRole('group', { name: 'Phase' })
    for (const b of within(dialog).getAllByRole('button')) expect(b).toHaveAccessibleName()
    const tabButtons = within(tabs).getAllByRole('button')
    const lists = within(dialog).getAllByRole('list')
    const use = within(dialog).getByRole('button', { name: 'Use this layout' })
    // DOM (= tab) order: the tabs, then the lists, then the actions
    const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(tabButtons.at(-1), lists[0])).toBe(true)
    expect(before(lists.at(-1), use)).toBe(true)
    // and the keyboard walks it that way: from the first tab, Tab reaches the next tabs, then Use, then Close
    tabButtons[0].focus()
    await user.tab()
    expect(tabButtons[1]).toHaveFocus()
    await user.tab()
    expect(tabButtons[2]).toHaveFocus()
    await user.tab()
    expect(use).toHaveFocus()
    // and the confirm's controls are named too
    await user.click(use)
    const confirm = await screen.findByRole('dialog', { name: 'Use this layout for Today?' })
    for (const b of within(confirm).getAllByRole('button')) expect(b).toHaveAccessibleName()
    const rows = within(within(confirm).getByRole('list', { name: 'What changes' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      'Premarket: now Coach notes, This week, Goal progress, Quick actions · after Checklist for today',
      "Market: now Market regime, Coach notes, This week, Goal progress, Quick actions · after Market regime, Today's note",
    ])
  })
})
