// P3a Task 9 — the community STYLE library inside the lazy gallery, end to end in the client:
// the switch, the type and trading-style chips, a style card's Adopt (with "Notify me") and its
// refusal, Helpful, an author's page with Follow and Back, the Following view, and Preview through
// the journal styles preview door.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
//
// CONTRACT: everything the fake server answers is the REAL server's (`__fixtures__/contract`, written by
// tools/notebook_contract_fixtures.py and held current by tests/test_notebook_contract_fixtures.py): the
// outline list, the Styles + Swing list, the style item in full (its `payload`), the composed preview of
// that payload, adopt and its 409, Helpful, the author's page, follow, and the feed (full and empty).
// The fake keeps state (whom the member follows, which answer adopt gives) and routes; it types no
// shape of its own.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import TemplateGallery from './TemplateGallery'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { GALLERY_SORTS } from '../../lib/templateGallery'
import { ITEM_TYPES, LIBRARY_SORTS, TRADING_STYLES } from '../../lib/styleLibrary'
import { contract, contractBody } from '../../__fixtures__/contract'

const OUTLINES = contractBody('template-gallery.list').templates
const STYLES_SWING = contract('template-gallery.list.styles')
const STYLE = STYLES_SWING.body.templates[0]
const STYLE_ITEM = contractBody('template-gallery.styles.item').template
const PREVIEW = contract('template-gallery.styles.preview')
const AUTHOR_PAGE = contractBody('template-gallery.authors.page')
const FEED = contractBody('template-gallery.feed').templates
const ADOPTED = contractBody('template-gallery.adopt')
const answer = (name) => { const c = contract(name); return { ok: c._contract.status < 400, status: c._contract.status, json: async () => c.body } }
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
/** The paragraph text the server composed, read from the fixture (never typed here). */
const composedText = (doc) => (doc?.content || []).filter((n) => n.type === 'paragraph' || n.type === 'heading')
  .map((n) => (n.content || []).map((t) => t.text || '').join('')).find(Boolean)

let server
let calls
beforeEach(() => {
  server = { library: true, following: false, feedEmpty: false, adoptAnswer: 'template-gallery.adopt', styleMine: false }
  calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ path: u.pathname, search: u.search, method, body })
    const styles = STYLES_SWING.body.templates.map((t) => ({ ...t, mine: server.styleMine }))
    if (u.pathname === '/api/j2/note-templates') return json({ templates: [{ id: 't1', name: 'Swing plan', title: 'Swing plan', createdAt: '1' }] })
    if (u.pathname === '/api/j2/template-gallery' && method === 'GET') {
      const type = u.searchParams.get('type') || ''
      const ts = u.searchParams.get('trading_style') || ''
      const section = u.searchParams.get('section') || 'all'
      let list = !server.library ? OUTLINES
        : type === 'style' ? styles : type === 'outline' ? OUTLINES : [...OUTLINES, ...styles]
      if (ts) list = list.filter((t) => t.tradingStyle === ts)
      if (section === 'picks') list = list.filter((t) => t.featured)
      return json({ templates: list, viewer: { admin: false } })
    }
    if (u.pathname === '/api/j2/journal-styles/preview' && method === 'POST') return answer('template-gallery.styles.preview')
    if (u.pathname === '/api/j2/template-gallery/feed') return answer(server.feedEmpty ? 'template-gallery.feed.empty' : 'template-gallery.feed')
    let m = u.pathname.match(/^\/api\/j2\/template-gallery\/authors\/([\w-]+)\/follow$/)
    if (m) {
      server.following = method === 'POST'
      return answer(method === 'POST' ? 'template-gallery.authors.follow' : 'template-gallery.authors.unfollow')
    }
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/authors\/([\w-]+)$/)
    if (m) {
      if (m[1] !== AUTHOR_PAGE.author.handle) return answer('template-gallery.authors.not-found')
      const page = contractBody('template-gallery.authors.page')
      return json({ ...page, author: { ...page.author, following: server.following } })
    }
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/adopt$/)
    if (m) return answer(server.adoptAnswer)
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/helpful$/)
    if (m) return answer(method === 'POST' ? 'template-gallery.helpful' : 'template-gallery.unhelpful')
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)$/)
    if (m && method === 'GET') return m[1] === STYLE.id ? answer('template-gallery.styles.item') : answer('template-gallery.item.not-found')
    return answer('template-gallery.item.not-found')
  })
})

afterEach(() => { __resetNotebookFlags() })

const flags = ({ library = true } = {}) => {
  server.library = library
  latchNotebookFlags({ notebook_template_gallery_enabled: true, notebook_style_library_enabled: library })
}
const sentTo = (path, method) => calls.filter((c) => c.path === path && c.method === method)
const listCalls = () => calls.filter((c) => c.path === '/api/j2/template-gallery' && c.method === 'GET')

function wrap(node) {
  return (
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{node}</SWRConfig>
    </MemoryRouter>
  )
}

async function openGallery() {
  const user = userEvent.setup()
  render(wrap(<TemplatePicker onPick={vi.fn()} onPickMember={vi.fn()} />))
  await user.click(await screen.findByRole('button', { name: /Browse the community gallery/ }))
  await screen.findByRole('heading', { name: 'Community gallery' })
  return user
}

async function openStyles() {
  const user = await openGallery()
  const types = await screen.findByRole('group', { name: 'Filter by type' })
  await user.click(within(types).getByRole('button', { name: 'Styles' }))
  await screen.findByRole('heading', { name: STYLE.title })
  return user
}

const styleCard = () => screen.getByRole('heading', { name: STYLE.title }).closest('[data-library-style]')

describe('the recorded library holds what these rails read (non-vacuity)', () => {
  it('a listed swing style with a handle, its payload, a composed preview, an adopt credit and a 409', () => {
    expect(STYLES_SWING._contract.path).toContain('type=style&trading_style=swing')
    expect(STYLE).toMatchObject({ itemType: 'style', tradingStyle: 'swing', mine: false })
    expect(typeof STYLE.authorHandle).toBe('string')
    expect(STYLE_ITEM.id).toBe(STYLE.id)
    expect(Object.keys(STYLE_ITEM.payload).sort()).toEqual(['blocks', 'kindId', 'outlineBodyJson', 'properties'])
    expect(composedText(PREVIEW.body.bodyJson)).toBeTruthy()
    expect(ADOPTED.credit).toMatch(/^Based on /)
    expect(contract('template-gallery.adopt.styles-off')._contract.status).toBe(409)
    expect(FEED.map((t) => t.id)).toContain(STYLE.id)
    expect(contractBody('template-gallery.feed.empty').templates).toEqual([])
    expect(AUTHOR_PAGE.author.handle).toBe(STYLE.authorHandle)
  })
})

describe('the switch', () => {
  it('off: the gallery renders exactly as before — no Styles chip, no trading-style row, no Following', async () => {
    flags({ library: false })
    await openGallery()
    await screen.findByRole('region', { name: 'UCT picks' })
    expect(screen.queryByRole('group', { name: 'Filter by type' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Styles' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Filter by trading style' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Following' })).not.toBeInTheDocument()
    expect([...screen.getByLabelText('Sort').options].map((o) => o.textContent)).toEqual(GALLERY_SORTS.map((s) => s.label))
    expect(listCalls().length).toBeGreaterThan(0)
    expect(listCalls().every((c) => !c.search.includes('type=') && !c.search.includes('trading_style='))).toBe(true)
    expect(calls.some((c) => c.path.endsWith('/feed'))).toBe(false)
  })

  it('on: the type chips, the library sorts and a Following view chip are offered', async () => {
    flags()
    await openGallery()
    const types = await screen.findByRole('group', { name: 'Filter by type' })
    expect(within(types).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', ...ITEM_TYPES.map((t) => t.label)])
    const ts = screen.getByRole('group', { name: 'Filter by trading style' })
    expect(within(ts).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', ...TRADING_STYLES.map((t) => t.label)])
    expect([...screen.getByLabelText('Sort').options].map((o) => o.textContent)).toEqual(LIBRARY_SORTS.map((s) => s.label))
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument()
  })
})

describe('the Styles chip and trading style', () => {
  it('lists style items with their trading-style label, and a trading-style chip filters the request', async () => {
    flags()
    const user = await openStyles()
    expect(listCalls().some((c) => c.search.includes('type=style'))).toBe(true)
    expect(within(styleCard()).getByText(new RegExp(`· ${TRADING_STYLES.find((t) => t.key === STYLE.tradingStyle).label}`))).toBeInTheDocument()
    expect(within(styleCard()).getByText(`Adopted by ${STYLE.usedBy}`, { exact: false })).toBeInTheDocument()
    const ts = screen.getByRole('group', { name: 'Filter by trading style' })
    await user.click(within(ts).getByRole('button', { name: 'Swing' }))
    await waitFor(() => expect(listCalls().some((c) => c.search.includes('type=style&trading_style=swing'))).toBe(true))
    // Outlines hides the trading-style row (an outline has no trading style)
    await user.click(within(screen.getByRole('group', { name: 'Filter by type' })).getByRole('button', { name: 'Outlines' }))
    expect(screen.queryByRole('group', { name: 'Filter by trading style' })).not.toBeInTheDocument()
    await waitFor(() => expect(listCalls().at(-1).search).not.toContain('trading_style='))
  })

  it('initialType opens the gallery on Styles', async () => {
    flags()
    render(wrap(<TemplateGallery onBack={vi.fn()} initialType="style" />))
    await screen.findByRole('heading', { name: STYLE.title })
    const types = screen.getByRole('group', { name: 'Filter by type' })
    expect(within(types).getByRole('button', { name: 'Styles' })).toHaveAttribute('aria-pressed', 'true')
    expect(listCalls()[0].search).toContain('type=style')
  })
})

describe('adopt', () => {
  it('with "Notify me" ticked posts notify: true and says what was added, with the credit', async () => {
    flags()
    const user = await openStyles()
    await user.click(within(styleCard()).getByRole('button', { name: `Adopt ${STYLE.title}` }))
    const confirm = screen.getByRole('group', { name: `Adopt ${STYLE.title}?` })
    const box = within(confirm).getByRole('checkbox', { name: 'Notify me when the author updates' })
    expect(box).not.toBeChecked()                                              // default off
    await user.click(box)
    await user.click(within(confirm).getByRole('button', { name: 'Adopt' }))
    const sent = sentTo(`/api/j2/template-gallery/${STYLE.id}/adopt`, 'POST')
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ notify: true })
    expect(Object.keys(sent[0].body)).toEqual(Object.keys(contract('template-gallery.adopt')._contract.requestBody))
    // `Added "<title>" to your styles. <credit>.` — the name and credit are the server's
    expect(await screen.findByText(`Added "${ADOPTED.style.name}" to your styles. ${ADOPTED.credit}.`)).toBeInTheDocument()
  })

  it('without ticking it posts notify: false', async () => {
    flags()
    const user = await openStyles()
    await user.click(within(styleCard()).getByRole('button', { name: `Adopt ${STYLE.title}` }))
    await user.click(within(screen.getByRole('group', { name: `Adopt ${STYLE.title}?` })).getByRole('button', { name: 'Adopt' }))
    await screen.findByText(/to your styles\./)
    expect(sentTo(`/api/j2/template-gallery/${STYLE.id}/adopt`, 'POST')[0].body).toEqual({ notify: false })
  })

  it('a 409 refusal shows the server’s fixed sentence, and nothing says "Added"', async () => {
    flags()
    server.adoptAnswer = 'template-gallery.adopt.styles-off'
    const user = await openStyles()
    await user.click(within(styleCard()).getByRole('button', { name: `Adopt ${STYLE.title}` }))
    await user.click(within(screen.getByRole('group', { name: `Adopt ${STYLE.title}?` })).getByRole('button', { name: 'Adopt' }))
    const sentence = contractBody('template-gallery.adopt.styles-off').detail
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    expect(screen.queryByText(/Added "/)).not.toBeInTheDocument()
  })

  it('a missing item is our own fixed sentence, never the server’s bare "Not found"', async () => {
    flags()
    server.adoptAnswer = 'template-gallery.adopt.not-found'
    const user = await openStyles()
    await user.click(within(styleCard()).getByRole('button', { name: `Adopt ${STYLE.title}` }))
    await user.click(within(screen.getByRole('group', { name: `Adopt ${STYLE.title}?` })).getByRole('button', { name: 'Adopt' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(`Couldn't add "${STYLE.title}" to your styles. Nothing was changed.`)
    expect(screen.getByRole('alert')).not.toHaveTextContent(contractBody('template-gallery.adopt.not-found').detail)
  })
})

describe('Helpful', () => {
  it('flips aria-pressed and the count text after the response', async () => {
    flags()
    const user = await openStyles()
    const card = styleCard()
    const btn = within(card).getByRole('button', { name: `Helpful: ${STYLE.title}` })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(within(card).getByText(`${STYLE.helpfulCount} found this helpful`)).toBeInTheDocument()
    await user.click(btn)
    const on = contractBody('template-gallery.helpful')
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', String(on.helpful)))
    expect(within(card).getByText(`${on.count} found this helpful`)).toBeInTheDocument()
    expect(sentTo(`/api/j2/template-gallery/${STYLE.id}/helpful`, 'POST')).toHaveLength(1)
    await user.click(btn)
    const off = contractBody('template-gallery.unhelpful')
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', String(off.helpful)))
    expect(within(card).getByText(`${off.count} found this helpful`)).toBeInTheDocument()
    expect(sentTo(`/api/j2/template-gallery/${STYLE.id}/helpful`, 'DELETE')).toHaveLength(1)
  })

  it('is absent on your own item (as are Adopt and Report); Preview stays', async () => {
    flags()
    server.styleMine = true
    await openStyles()
    const card = styleCard()
    expect(within(card).queryByRole('button', { name: /^Helpful/ })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Adopt/ })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Report/ })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: `Preview ${STYLE.title}` })).toBeInTheDocument()
  })
})

describe('an author’s page', () => {
  it('opens from the author name; Follow flips to Following; Back returns to the list with the filters kept', async () => {
    flags()
    const user = await openStyles()
    await user.click(within(screen.getByRole('group', { name: 'Filter by trading style' })).getByRole('button', { name: 'Swing' }))
    await waitFor(() => expect(listCalls().some((c) => c.search.includes('type=style&trading_style=swing'))).toBe(true))
    await user.click(within(styleCard()).getByRole('button', { name: `See styles by ${STYLE.author}` }))
    const heading = await screen.findByRole('heading', { name: AUTHOR_PAGE.author.label })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText(`${AUTHOR_PAGE.author.itemCount} published`)).toBeInTheDocument()
    const items = screen.getByRole('list', { name: `Published by ${AUTHOR_PAGE.author.label}` })
    for (const t of AUTHOR_PAGE.items) expect(within(items).getByRole('heading', { name: t.title })).toBeInTheDocument()
    expect(sentTo(`/api/j2/template-gallery/authors/${AUTHOR_PAGE.author.handle}`, 'GET').length).toBeGreaterThan(0)
    const follow = screen.getByRole('button', { name: `Follow ${AUTHOR_PAGE.author.label}` })
    expect(follow).toHaveAttribute('aria-pressed', 'false')
    await user.click(follow)
    const now = await screen.findByRole('button', { name: `Following ${AUTHOR_PAGE.author.label}` })
    expect(now).toHaveAttribute('aria-pressed', 'true')
    expect(now).toHaveTextContent('Following')
    expect(sentTo(`/api/j2/template-gallery/authors/${AUTHOR_PAGE.author.handle}/follow`, 'POST')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Back to the library' }))
    await screen.findByRole('heading', { name: STYLE.title })
    expect(within(screen.getByRole('group', { name: 'Filter by type' })).getByRole('button', { name: 'Styles' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('group', { name: 'Filter by trading style' })).getByRole('button', { name: 'Swing' })).toHaveAttribute('aria-pressed', 'true')
    expect(listCalls().at(-1).search).toContain('type=style&trading_style=swing')
    await waitFor(() => expect(within(styleCard()).getByRole('button', { name: `See styles by ${STYLE.author}` })).toHaveFocus())
    // R-P3-2: nothing the client sent named a user id or an email
    expect(JSON.stringify(calls)).not.toMatch(/@|user_?id/i)
  })

  it('offers no Follow on your own page', async () => {
    flags()
    const own = contractBody('template-gallery.authors.page')
    global.fetch.mockImplementation(async (url) => {
      const u = new URL(String(url), 'http://x')
      calls.push({ path: u.pathname, search: u.search, method: 'GET', body: null })
      if (u.pathname.startsWith('/api/j2/template-gallery/authors/')) return json({ ...own, author: { ...own.author, mine: true } })
      if (u.pathname === '/api/j2/template-gallery') {
        const picks = u.searchParams.get('section') === 'picks'
        return json({ templates: STYLES_SWING.body.templates.filter((t) => !picks || t.featured), viewer: { admin: false } })
      }
      return answer('template-gallery.item.not-found')
    })
    const user = userEvent.setup()
    render(wrap(<TemplateGallery onBack={vi.fn()} initialType="style" />))
    await screen.findByRole('heading', { name: STYLE.title })
    await user.click(screen.getByRole('button', { name: `See styles by ${STYLE.author}` }))
    await screen.findByRole('heading', { name: own.author.label })
    expect(screen.queryByRole('button', { name: `Follow ${own.author.label}` })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Following ${own.author.label}` })).not.toBeInTheDocument()
    expect(screen.getByText(`${own.author.itemCount} published`)).toBeInTheDocument()   // the page did render
  })
})

describe('the Following view', () => {
  it('lists what the authors you follow listed', async () => {
    flags()
    const user = await openGallery()
    await user.click(screen.getByRole('button', { name: 'Following' }))
    expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true')
    for (const t of FEED) expect(await screen.findByRole('heading', { name: t.title })).toBeInTheDocument()
    expect(sentTo('/api/j2/template-gallery/feed', 'GET').length).toBeGreaterThan(0)
  })

  it('says how to fill it when it is empty', async () => {
    flags()
    server.feedEmpty = true
    const user = await openGallery()
    await user.click(screen.getByRole('button', { name: 'Following' }))
    expect(await screen.findByText('Follow an author to see their new styles here.')).toBeInTheDocument()
  })
})

describe('Preview', () => {
  it('composes the item’s payload through the journal styles preview door and renders it', async () => {
    flags()
    const user = await openStyles()
    await user.click(within(styleCard()).getByRole('button', { name: `Preview ${STYLE.title}` }))
    const sheet = await screen.findByRole('dialog', { name: STYLE.title })
    expect(await within(sheet).findByText(composedText(PREVIEW.body.bodyJson))).toBeInTheDocument()
    expect(within(sheet).getByText(/Rendered with your own data\./)).toBeInTheDocument()
    expect(within(sheet).getByText(/Your own property defaults are not shared\./)).toBeInTheDocument()
    expect(sentTo(`/api/j2/template-gallery/${STYLE.id}`, 'GET')).toHaveLength(1)
    const door = sentTo('/api/j2/journal-styles/preview', 'POST')
    expect(door).toHaveLength(1)
    const p = STYLE_ITEM.payload
    expect(door[0].body).toEqual({ style: { kindId: p.kindId, outlineBodyJson: p.outlineBodyJson, blocks: p.blocks, properties: p.properties } })
    expect(door[0].body).toEqual(PREVIEW._contract.requestBody)                // the recorded request, byte for byte
    // a preview is for looking: no "Use this template" on a style
    expect(within(sheet).queryByRole('button', { name: 'Use this template' })).not.toBeInTheDocument()
  })
})

describe('accessible names', () => {
  it('every new control is named, with the adopt confirm open', async () => {
    flags()
    const user = await openStyles()
    await user.click(within(styleCard()).getByRole('button', { name: `Adopt ${STYLE.title}` }))
    for (const name of ['Filter by type', 'Filter by trading style', `Adopt ${STYLE.title}?`]) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument()
    }
    const gallery = document.querySelector('[data-template-community-gallery]')
    for (const el of within(gallery).getAllByRole('button')) expect(el).toHaveAccessibleName()
    for (const el of within(gallery).getAllByRole('checkbox')) expect(el).toHaveAccessibleName()
    for (const el of within(gallery).getAllByRole('combobox')) expect(el).toHaveAccessibleName()
    // and on an author's page
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(within(styleCard()).getByRole('button', { name: `See styles by ${STYLE.author}` }))
    await screen.findByRole('heading', { name: AUTHOR_PAGE.author.label })
    for (const el of within(gallery).getAllByRole('button')) expect(el).toHaveAccessibleName()
  })
})
