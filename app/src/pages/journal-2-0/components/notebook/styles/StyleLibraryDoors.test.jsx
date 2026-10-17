// P3a Task 10 — the doors into the community style library, sharing a style, and reviewing an author's
// update, through the REAL clients (lib/styleLibrary.js, lib/journalStyles.js) with only the network faked.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
//
// CONTRACT: every server answer is a recorded fixture (`__fixtures__/contract`, written by
// tools/notebook_contract_fixtures.py and held current by tests/test_notebook_contract_fixtures.py): the journal
// styles list, a style read, the share (and its 400), the Updates list, the plan, the apply (and its 409), and the
// library list the door opens. A variation (the adopted copy as a list row, a plan whose outline the author changed,
// a share that left two defaults behind) is a spread + override of a fixture object, never a retyped shape.
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { AuthContext } from '../../../../../context/AuthContext'
import { contract, contractBody } from '../../../__fixtures__/contract'
import { blockLabel } from '../../../lib/journalBlocks'
import { GALLERY_CATEGORIES } from '../../../lib/templateGallery'
import { TRADING_STYLES } from '../../../lib/styleLibrary'
import { __resetOfferApplied } from './offerApplied'

vi.mock('../../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), setPrefMerged: vi.fn(), loading: false }),
}))
vi.mock('../../../lib/offline/settleNoteWrite', () => ({
  settleNoteWrite: vi.fn(async () => {}),
  settleNoteWrites: vi.fn(async () => {}),
}))

import StylesManager from './StylesManager'
import KindSection from './KindSection'
import { SENT_SENTENCE, SHARE_NOTE, OUTLINE_GONE_SENTENCE, sharedSentence } from './ShareStyleForm'
import { STALE_SENTENCE, TAKE_OUTLINE_LABEL, OUTLINE_STAYS, NOTHING_REMOVED, addsBlocksLine } from './LibraryUpdateSheet'

// ── the server's answers ──
const FIXTURE_LIST = contractBody('journal-styles.list')
const MEMBER = FIXTURE_LIST.styles.find((s) => !s.builtin)
const UPDATES = contractBody('template-gallery.updates')
const UPDATE = UPDATES.updates[0]
const APPLIED = contractBody('template-gallery.updates.apply').style
// The adopted copy as the journal styles list shows it BEFORE the update: the applied style at the version the
// Updates row says it is behind at, without the block the update adds.
const COPY = { ...APPLIED, version: UPDATE.fromVersion, sourceVersion: UPDATE.fromVersion, blocks: [] }
const LIST = { ...FIXTURE_LIST, styles: [...FIXTURE_LIST.styles, COPY] }
const PLAN = contractBody('template-gallery.updates.plan').plan
// A plan whose outline the author changed: the recorded plan, with the applied style's outline as the new one.
const PLAN_OUTLINE = { ...PLAN, outlineChanged: true, newOutline: APPLIED.outlineBodyJson }
const outlineText = (doc) => doc.content[0].content[0].text
const PUBLISHED = contractBody('template-gallery.styles.publish')
const STALE = contract('template-gallery.updates.apply.stale')
const BAD_TS = contract('template-gallery.styles.publish.bad-trading-style')

const re = (p) => new RegExp(`^${p}$`)
const PLAN_URL = re(`/api/j2/template-gallery/updates/${COPY.id}`)

let calls
let routes
function installFetch() {
  calls = []
  globalThis.fetch = vi.fn((input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : input.url
    const [path, search = ''] = url.split('?')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, search, body })
    const hit = routes.find(([m, r]) => m === method && r.test(path))
    let out = hit ? hit[2] : [404, { detail: 'Not found' }]
    if (typeof out === 'function') out = out(body, search)
    const [status, payload] = Array.isArray(out) && typeof out[0] === 'number' ? out : [200, out]
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(payload) })
  })
}
const called = (method, r) => calls.filter((c) => c.method === method && r.test(c.path))

let planAnswer
let applyAnswer
let publishAnswer
beforeEach(() => {
  __resetNotebookFlags()
  __resetOfferApplied()
  Element.prototype.scrollIntoView = vi.fn()
  lastLocation = null
  planAnswer = { plan: PLAN }
  applyAnswer = contractBody('template-gallery.updates.apply')
  publishAnswer = PUBLISHED
  routes = [
    ['GET', /^\/api\/j2\/journal-styles$/, () => LIST],
    ['GET', re(`/api/j2/journal-styles/${MEMBER.id}`), { style: { ...MEMBER, outlineBodyJson: null } }],
    ['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, { offer: null }],
    ['GET', /^\/api\/j2\/property-defs$/, { propertyDefs: [] }],
    ['GET', /^\/api\/j2\/note-templates$/, { templates: [] }],
    ['GET', /^\/api\/j2\/template-gallery\/updates$/, UPDATES],
    ['GET', PLAN_URL, () => planAnswer],
    ['POST', PLAN_URL, () => applyAnswer],
    ['POST', /^\/api\/j2\/template-gallery\/styles$/, () => publishAnswer],
    ['GET', /^\/api\/j2\/template-gallery$/, (b, search) => (search.includes('type=style')
      ? contractBody('template-gallery.list.styles') : contractBody('template-gallery.list'))],
  ]
  installFetch()
})
afterEach(() => { __resetNotebookFlags() })

const flags = ({ library = true } = {}) => latchNotebookFlags({
  notebook_journal_styles_enabled: true,
  notebook_template_gallery_enabled: true,
  notebook_style_library_enabled: library,
})

let lastLocation = null
function LocationProbe() {
  const location = useLocation()
  useEffect(() => { lastLocation = location }, [location])
  return null
}
const tree = (node, entry = '/journal/notebook') => (
  <AuthContext.Provider value={{ user: { id: 'u1' } }}>
    <MemoryRouter initialEntries={[entry]}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        {node}
        <LocationProbe />
      </SWRConfig>
    </MemoryRouter>
  </AuthContext.Provider>
)
const openManager = (entry) => render(tree(<StylesManager open onClose={vi.fn()} />, entry))
const memberRow = async () => (await screen.findByText(MEMBER.name, { selector: 'span' })).closest('li')

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('the Updates row is this list\'s copy, the plan adds a block, and the 409 carries the server sentence', () => {
    expect(UPDATE.styleId).toBe(COPY.id)
    expect(PLAN.addBlocks.length).toBeGreaterThan(0)
    expect(STALE._contract.status).toBe(409)
    expect(typeof STALE.body.detail).toBe('string')
    expect(MEMBER.builtin).toBe(false)
  })
  it('the stale fallback sentence is the server\'s recorded one, word for word', () => {
    expect(STALE_SENTENCE).toBe(STALE.body.detail)
  })
})

describe('with the library switch off, none of the doors render', () => {
  it('KindSection has no "Browse community styles" and the manager has no Share, Community or Updates', async () => {
    flags({ library: false })
    render(tree(<KindSection onCreate={vi.fn()} />))
    await screen.findByRole('group', { name: 'Start from a kind of note' })
    expect(screen.queryByRole('button', { name: /community styles/i })).toBeNull()

    openManager()
    const row = await memberRow()
    expect(within(row).getByRole('button', { name: `Edit ${MEMBER.name}` })).toBeInTheDocument()   // control: the row rendered
    expect(screen.queryByRole('button', { name: /Share .* to community/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Community$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Updates/ })).toBeNull()
    expect(called('GET', /\/template-gallery\/updates$/)).toEqual([])                                // nothing is asked
  })
})

describe('the doors open the community library at Styles', () => {
  it('KindSection\'s "Browse community styles" opens the library with Styles chosen', async () => {
    flags()
    render(tree(<KindSection onCreate={vi.fn()} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Browse community styles' }))
    const dialog = await screen.findByRole('dialog', { name: 'Community styles' })
    const types = await within(dialog).findByRole('group', { name: 'Filter by type' })
    expect(within(types).getByRole('button', { name: 'Styles' })).toHaveAttribute('aria-pressed', 'true')
    const style = contractBody('template-gallery.list.styles').templates[0]
    // (this fake answers the "UCT picks" read and the full list alike, so the card can appear in both)
    expect((await within(dialog).findAllByRole('heading', { name: style.title })).length).toBeGreaterThan(0)
    expect(calls.some((c) => c.path === '/api/j2/template-gallery' && c.search.includes('type=style'))).toBe(true)
    // its way back says where it goes, and closes the library
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close the library' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Community styles' })).toBeNull())
  })

  it('the manager\'s Community button opens the same library', async () => {
    flags()
    openManager()
    fireEvent.click(await screen.findByRole('button', { name: 'Community' }))
    const dialog = await screen.findByRole('dialog', { name: 'Community styles' })
    const types = await within(dialog).findByRole('group', { name: 'Filter by type' })
    expect(within(types).getByRole('button', { name: 'Styles' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Share to community', () => {
  const share = async () => {
    flags()
    openManager()
    fireEvent.click(within(await memberRow()).getByRole('button', { name: `Share ${MEMBER.name} to community` }))
    return screen.findByRole('dialog', { name: `Share ${MEMBER.name} to community` })
  }
  const fill = (dialog) => {
    fireEvent.change(within(dialog).getByLabelText(/What it's for/), { target: { value: 'How I plan a breakout.' } })
    fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: GALLERY_CATEGORIES[1].key } })
    fireEvent.change(within(dialog).getByLabelText(/Trading style/), { target: { value: TRADING_STYLES[0].key } })
  }

  it('prefills the title, says what is shared, and posts exactly {styleId, title, description, category, tradingStyle}', async () => {
    const dialog = await share()
    expect(within(dialog).getByLabelText('Title in the library')).toHaveValue(MEMBER.name)
    expect(within(dialog).getByText(SHARE_NOTE)).toBeInTheDocument()
    expect(SHARE_NOTE).toBe('An admin reviews it before it is listed. Your own property defaults are not shared.')
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(called('POST', /\/template-gallery\/styles$/)).toHaveLength(1))
    expect(called('POST', /\/template-gallery\/styles$/)[0].body).toEqual({
      styleId: MEMBER.id, title: MEMBER.name, description: 'How I plan a breakout.',
      category: GALLERY_CATEGORIES[1].key, tradingStyle: TRADING_STYLES[0].key,
    })
    expect(await screen.findByText(SENT_SENTENCE)).toBeInTheDocument()
    expect(SENT_SENTENCE).toBe('Sent for review. It is listed once an admin approves it.')
    expect(screen.queryByText(/property defaults (was|were) left out/)).toBeNull()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `Share ${MEMBER.name} to community` })).toBeNull())
  })

  it('says how many of the member\'s own defaults were left out when the server says 2', async () => {
    publishAnswer = { ...PUBLISHED, droppedProperties: 2 }
    const dialog = await share()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText(`${SENT_SENTENCE} 2 of your own property defaults were left out.`)).toBeInTheDocument()
    expect(sharedSentence(1)).toBe(`${SENT_SENTENCE} 1 of your own property defaults was left out.`)
  })

  it('a refusal shows the server\'s own sentence and keeps the form', async () => {
    publishAnswer = [BAD_TS._contract.status, BAD_TS.body]
    const dialog = await share()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(BAD_TS.body.detail)
    expect(screen.queryByText(SENT_SENTENCE)).toBeNull()
  })

  it('P3a-T4-m6: says before sharing that an outline from a deleted template will not travel (and only then)', async () => {
    const gone = { ...MEMBER, outlineTemplateId: 'tpl_deleted' }
    routes.unshift(['GET', /^\/api\/j2\/journal-styles$/, () => ({ ...LIST, styles: LIST.styles.map((s) => (s.id === MEMBER.id ? gone : s)) })])
    routes.unshift(['GET', re(`/api/j2/journal-styles/${MEMBER.id}`), { style: { ...gone, outlineBodyJson: null } }])
    const dialog = await share()
    expect(await within(dialog).findByText(OUTLINE_GONE_SENTENCE)).toBeInTheDocument()
  })

  it('...and says nothing of the kind when that template still exists', async () => {
    const kept = { ...MEMBER, outlineTemplateId: 'tpl_kept' }
    routes.unshift(['GET', /^\/api\/j2\/note-templates$/, { templates: [{ id: 'tpl_kept', name: 'Plan', title: 'Plan', createdAt: '1' }] }])
    routes.unshift(['GET', /^\/api\/j2\/journal-styles$/, () => ({ ...LIST, styles: LIST.styles.map((s) => (s.id === MEMBER.id ? kept : s)) })])
    routes.unshift(['GET', re(`/api/j2/journal-styles/${MEMBER.id}`), { style: { ...kept, outlineBodyJson: null } }])
    const dialog = await share()
    await waitFor(() => expect(called('GET', /\/note-templates$/).length).toBeGreaterThan(0))
    await waitFor(() => expect(called('GET', re(`/api/j2/journal-styles/${MEMBER.id}`)).length).toBeGreaterThan(0))
    expect(within(dialog).queryByText(OUTLINE_GONE_SENTENCE)).toBeNull()
  })
})

describe('reviewing an author\'s update', () => {
  const openSheet = async () => {
    flags()
    openManager()
    fireEvent.click(await screen.findByRole('button', { name: `Updates (${UPDATES.updates.length})` }))
    fireEvent.click(await screen.findByRole('button', { name: `Review the update to ${UPDATE.styleName}` }))
    return screen.findByRole('dialog', { name: `Update ${COPY.name}` })
  }

  it('lists the added blocks by their label, the defaults count and the promise, and updates without the outline', async () => {
    const dialog = await openSheet()
    expect(await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))).toBeInTheDocument()
    expect(addsBlocksLine(PLAN.addBlocks)).toBe(`Adds blocks: ${PLAN.addBlocks.map(blockLabel).join(', ')}`)
    expect(within(dialog).getByText(`Adds property defaults: ${PLAN.addProperties.length}`)).toBeInTheDocument()
    expect(within(dialog).getByText(NOTHING_REMOVED)).toBeInTheDocument()
    // the recorded plan did not change the outline: no outline choice is offered
    expect(within(dialog).queryByRole('checkbox', { name: TAKE_OUTLINE_LABEL })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    await waitFor(() => expect(called('POST', PLAN_URL)).toHaveLength(1))
    expect(called('POST', PLAN_URL)[0].body).toEqual({ takeOutline: false, baseUpdatedAt: COPY.updatedAt })
    expect(await screen.findByText(`Updated ${APPLIED.name} to the author's version ${APPLIED.sourceVersion}.`)).toBeInTheDocument()
  })

  it('"Use the author\'s new outline" starts UNticked beside a read-only preview, and Update sends takeOutline: false', async () => {
    planAnswer = { plan: PLAN_OUTLINE }
    const dialog = await openSheet()
    const box = await within(dialog).findByRole('checkbox', { name: TAKE_OUTLINE_LABEL })
    expect(box).not.toBeChecked()
    expect(within(dialog).getByText(OUTLINE_STAYS)).toBeInTheDocument()
    const preview = within(dialog).getByRole('region', { name: "The author's new outline" })
    expect(within(preview).getByText(outlineText(PLAN_OUTLINE.newOutline))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    await waitFor(() => expect(called('POST', PLAN_URL)).toHaveLength(1))
    expect(called('POST', PLAN_URL)[0].body).toEqual({ takeOutline: false, baseUpdatedAt: COPY.updatedAt })
  })

  it('ticking it sends takeOutline: true', async () => {
    planAnswer = { plan: PLAN_OUTLINE }
    const dialog = await openSheet()
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: TAKE_OUTLINE_LABEL }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    await waitFor(() => expect(called('POST', PLAN_URL)).toHaveLength(1))
    expect(called('POST', PLAN_URL)[0].body).toEqual({ takeOutline: true, baseUpdatedAt: COPY.updatedAt })
  })

  it('a 409 shows the server\'s stale sentence, and Look again reads the copy and the plan afresh', async () => {
    applyAnswer = [STALE._contract.status, STALE.body]
    const dialog = await openSheet()
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    const plansBefore = called('GET', PLAN_URL).length
    const listsBefore = called('GET', /^\/api\/j2\/journal-styles$/).length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(STALE.body.detail)
    expect(within(dialog).queryByRole('button', { name: 'Update my copy' })).toBeNull()       // no second blind try
    applyAnswer = contractBody('template-gallery.updates.apply')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look again' }))
    await waitFor(() => expect(called('GET', PLAN_URL).length).toBe(plansBefore + 1))
    expect(called('GET', /^\/api\/j2\/journal-styles$/).length).toBeGreaterThan(listsBefore)
    expect(await within(dialog).findByRole('button', { name: 'Update my copy' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('Not now closes the sheet and writes nothing', async () => {
    const dialog = await openSheet()
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `Update ${COPY.name}` })).toBeNull())
    expect(called('POST', PLAN_URL)).toEqual([])
  })
})

describe('the bell notice\'s deep link', () => {
  it('?styles=1&libraryUpdate=<id> opens the update sheet for that copy, then leaves the URL clean', async () => {
    flags()
    openManager(`/journal/notebook?styles=1&libraryUpdate=${COPY.id}`)
    const dialog = await screen.findByRole('dialog', { name: `Update ${COPY.name}` })
    expect(await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))).toBeInTheDocument()
    await waitFor(() => expect(new URLSearchParams(lastLocation.search).get('libraryUpdate')).toBeNull())
    expect(new URLSearchParams(lastLocation.search).get('styles')).toBe('1')     // only its own param is taken
  })

  it('a style id that is not this member\'s opens nothing and shows nothing broken', async () => {
    flags()
    openManager('/journal/notebook?styles=1&libraryUpdate=s_not_mine')
    await memberRow()
    await waitFor(() => expect(called('GET', /\/template-gallery\/updates$/).length).toBeGreaterThan(0))
    await waitFor(() => expect(new URLSearchParams(lastLocation.search).get('libraryUpdate')).toBeNull())
    expect(screen.queryByRole('dialog', { name: /^Update / })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(called('GET', /\/template-gallery\/updates\/s_not_mine$/)).toEqual([])
  })
})
