// P3a Task 10 — the doors into the community style library, sharing a style, and reviewing an author's
// update, through the REAL clients (lib/styleLibrary.js, lib/journalStyles.js) with only the network faked.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
//
// CONTRACT: every server answer is a recorded fixture (`__fixtures__/contract`, written by
// tools/notebook_contract_fixtures.py and held current by tests/test_notebook_contract_fixtures.py): the journal
// styles list, a style read, the share (and its 400), the Updates list (and its empty answer), the plan (and its
// 404), the apply (and its two 409s), and the library list the door opens. A variation (the adopted copy as a list
// row, a plan whose outline the author changed, a share that left two defaults behind) is a spread + override of
// a fixture object, never a retyped shape.
// ⛔ Fix round 1, M-2: the copy carries its OWN `updatedAt`, distinct from every other fixture timestamp, so a
//    sheet that sent the wrong base (the plan's, the gallery item's, a re-read one) cannot pass.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { AuthContext } from '../../../../../context/AuthContext'
import { contract, contractBody } from '../../../__fixtures__/contract'
import { blockLabel } from '../../../lib/journalBlocks'
import { GALLERY_CATEGORIES } from '../../../lib/templateGallery'
import { LIBRARY_UPDATES_KEY, TRADING_STYLES } from '../../../lib/styleLibrary'
import { STYLES_URL } from '../../../lib/journalStyles'
import { __resetOfferApplied } from './offerApplied'
import { libraryError, OFFLINE_SENTENCE } from './styleErrors'

vi.mock('../../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), setPrefMerged: vi.fn(), loading: false }),
}))
vi.mock('../../../lib/offline/settleNoteWrite', () => ({
  settleNoteWrite: vi.fn(async () => {}),
  settleNoteWrites: vi.fn(async () => {}),
}))

import StylesManager from './StylesManager'
import KindSection from './KindSection'
import { SENT_SENTENCE, REVISION_SENT_SENTENCE, SHARE_NOTE, OUTLINE_GONE_SENTENCE, sharedSentence } from './ShareStyleForm'
import {
  STALE_SENTENCE, TAKE_OUTLINE_LABEL, OUTLINE_STAYS, NOTHING_REMOVED, UP_TO_DATE_SENTENCE, NO_COPY_SENTENCE,
  addsBlocksLine,
} from './LibraryUpdateSheet'

// ── the server's answers ──
const FIXTURE_LIST = contractBody('journal-styles.list')
const MEMBER = FIXTURE_LIST.styles.find((s) => !s.builtin)
const BUILTIN = FIXTURE_LIST.styles.find((s) => s.builtin)
const UPDATES = contractBody('template-gallery.updates')
const NONE = contractBody('template-gallery.updates.none')
const UPDATE = UPDATES.updates[0]
const APPLIED = contractBody('template-gallery.updates.apply').style
// The adopted copy as the journal styles list shows it BEFORE the update: the applied style at the version the
// Updates row says it is behind at, without the block the update adds, and with its own revision stamp.
const COPY_STAMP = '2026-10-06T09:00:00+00:00'
const NEWER_STAMP = '2026-10-07T11:15:00+00:00'
const COPY = { ...APPLIED, version: UPDATE.fromVersion, sourceVersion: UPDATE.fromVersion, blocks: [], updatedAt: COPY_STAMP }
const listWith = (copy) => ({ ...FIXTURE_LIST, styles: [...FIXTURE_LIST.styles, ...(copy ? [copy] : [])] })
const LIST = listWith(COPY)
const PLAN = contractBody('template-gallery.updates.plan').plan
const PLAN_404 = contract('template-gallery.updates.plan.not-found')
// A plan whose outline the author changed: the recorded plan, with the applied style's outline as the new one.
const PLAN_OUTLINE = { ...PLAN, outlineChanged: true, newOutline: APPLIED.outlineBodyJson }
const outlineText = (doc) => doc.content[0].content[0].text
const PUBLISHED = contractBody('template-gallery.styles.publish')
const STALE = contract('template-gallery.updates.apply.stale')
const MOVED = contract('template-gallery.updates.apply.version-moved')
const BAD_TS = contract('template-gallery.styles.publish.bad-trading-style')
const sentBody = (body) => ({ takeOutline: false, baseUpdatedAt: COPY_STAMP, toVersion: PLAN.toVersion, ...body })

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
    return Promise.resolve(out).then((answer) => {              // a route may answer later (a held promise)
      const [status, payload] = Array.isArray(answer) && typeof answer[0] === 'number' ? answer : [200, answer]
      return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(payload) }
    })
  })
}
const called = (method, r) => calls.filter((c) => c.method === method && r.test(c.path))

let listAnswer
let updatesAnswer
let planAnswer
let applyAnswer
let publishAnswer
beforeEach(() => {
  __resetNotebookFlags()
  __resetOfferApplied()
  Element.prototype.scrollIntoView = vi.fn()
  lastLocation = null
  swrCfg = null
  listAnswer = LIST
  updatesAnswer = UPDATES
  planAnswer = { plan: PLAN }
  applyAnswer = contractBody('template-gallery.updates.apply')
  publishAnswer = PUBLISHED
  routes = [
    ['GET', /^\/api\/j2\/journal-styles$/, () => listAnswer],
    ['GET', re(`/api/j2/journal-styles/${MEMBER.id}`), { style: { ...MEMBER, outlineBodyJson: null } }],
    ['GET', /^\/api\/j2\/note-kinds\/mapping-offer$/, { offer: null }],
    ['GET', /^\/api\/j2\/property-defs$/, { propertyDefs: [] }],
    ['GET', /^\/api\/j2\/note-templates$/, { templates: [] }],
    ['GET', /^\/api\/j2\/template-gallery\/updates$/, () => updatesAnswer],
    ['GET', PLAN_URL, () => planAnswer],
    // like the server: once the copy is updated it is no longer behind, so the Updates list empties
    ['POST', PLAN_URL, () => { if (!Array.isArray(applyAnswer)) updatesAnswer = NONE; return applyAnswer }],
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
let swrCfg = null
function SwrProbe() {
  const cfg = useSWRConfig()
  useEffect(() => { swrCfg = cfg }, [cfg])
  return null
}
const tree = (node, entry = '/journal/notebook', cache = null) => (
  <AuthContext.Provider value={{ user: { id: 'u1' } }}>
    <MemoryRouter initialEntries={[entry]}>
      <SWRConfig value={{ provider: () => cache || new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        {node}
        <LocationProbe />
        <SwrProbe />
      </SWRConfig>
    </MemoryRouter>
  </AuthContext.Provider>
)
const openManager = (entry, cache) => render(tree(<StylesManager open onClose={vi.fn()} />, entry, cache))
const memberRow = async () => (await screen.findByText(MEMBER.name, { selector: 'span' })).closest('li')

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('the Updates row is this list\'s copy, the plan adds a block, and both 409s carry the server sentence', () => {
    expect(UPDATE.styleId).toBe(COPY.id)
    expect(PLAN.addBlocks.length).toBeGreaterThan(0)
    expect(STALE._contract.status).toBe(409)
    expect(MOVED._contract.status).toBe(409)
    expect(typeof MOVED.body.detail).toBe('string')
    expect(NONE.updates).toEqual([])
    expect(MEMBER.builtin).toBe(false)
    expect(COPY.sourceGalleryId).toBeTruthy()
    // M-2: the copy's stamp is its own, so the base a test expects can only come from the copy
    expect(new Set([COPY_STAMP, NEWER_STAMP, APPLIED.updatedAt]).size).toBe(3)
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

describe('which rows and buttons the library adds (M-3, ruling P3a-T10-R3)', () => {
  it('Updates (N) is not shown when the recorded Updates list is empty', async () => {
    flags()
    updatesAnswer = NONE
    openManager()
    expect(await screen.findByRole('button', { name: 'Community' })).toBeInTheDocument()          // control: library on
    await waitFor(() => expect(called('GET', /\/template-gallery\/updates$/).length).toBeGreaterThan(0))
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /^Updates/ })).toBeNull()
  })

  it('Share is offered on the member\'s own style, never on a built-in one or on a copy adopted from the library', async () => {
    flags()
    openManager()
    expect(within(await memberRow()).getByRole('button', { name: `Share ${MEMBER.name} to community` })).toBeInTheDocument()
    const builtin = within(screen.getAllByText(BUILTIN.name, { selector: 'span' })[0].closest('li'))
    expect(builtin.getByRole('button', { name: `Duplicate ${BUILTIN.name} to edit` })).toBeInTheDocument()   // the row is there
    expect(builtin.queryByRole('button', { name: /to community/ })).toBeNull()
    const copyRow = within(screen.getByRole('button', { name: `Edit ${COPY.name}` }).closest('li'))
    expect(copyRow.queryByRole('button', { name: /to community/ })).toBeNull()
  })
})

describe('Duplicate carries provenance (ruling P3a-T10-R6)', () => {
  it('Duplicate of an adopted copy sends duplicateOf, and the duplicate (which carries the source) offers no Share', async () => {
    const created = { ...COPY, id: 'dup_of_copy', name: `${COPY.name} copy` }          // the server's answer: provenance kept
    routes.unshift(['GET', re(`/api/j2/journal-styles/${COPY.id}`), { style: COPY }])
    routes.unshift(['POST', /^\/api\/j2\/journal-styles$/, () => { listAnswer = listWith(COPY); listAnswer.styles.push(created); return { style: created } }])
    flags()
    openManager()
    fireEvent.click(await screen.findByRole('button', { name: `Duplicate ${COPY.name}` }))
    await waitFor(() => expect(called('POST', /^\/api\/j2\/journal-styles$/)).toHaveLength(1))
    expect(called('POST', /^\/api\/j2\/journal-styles$/)[0].body.duplicateOf).toBe(COPY.id)
    const dupRow = within((await screen.findByRole('button', { name: `Edit ${created.name}` })).closest('li'))
    expect(dupRow.queryByRole('button', { name: /to community/ })).toBeNull()
  })
})

describe('libraryError: what a failed library call says', () => {
  const err = (message, status) => Object.assign(new Error(message), status ? { status } : {})
  it('a 404, a 5xx and a body-less "request failed (N)" all say the fallback, never their own words', () => {
    expect(libraryError(err('Not found', 404), 'FALLBACK')).toBe('FALLBACK')
    expect(libraryError(err('Internal Server Error', 500), 'FALLBACK')).toBe('FALLBACK')
    expect(libraryError(err('request failed (400)', 400), 'FALLBACK')).toBe('FALLBACK')
    expect(libraryError(err('request failed (409)', 409), 'FALLBACK')).toBe('FALLBACK')
  })
  it('a refusal the server explains is shown as written, and the network is "offline"', () => {
    expect(libraryError(err(STALE.body.detail, 409), 'FALLBACK')).toBe(STALE.body.detail)
    expect(libraryError(err(BAD_TS.body.detail, 400), 'FALLBACK')).toBe(BAD_TS.body.detail)
    expect(libraryError(new TypeError('Failed to fetch'), 'FALLBACK')).toBe(OFFLINE_SENTENCE)
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

  it('M-7: sharing an already-listed style again says the listed version stays until the update is approved', async () => {
    publishAnswer = { ...PUBLISHED, template: { ...PUBLISHED.template, status: 'approved', hasRevision: true } }
    const dialog = await share()
    fill(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText(REVISION_SENT_SENTENCE)).toBeInTheDocument()
    expect(REVISION_SENT_SENTENCE).toMatch(/stays listed until an admin approves this update/)
    expect(screen.queryByText(SENT_SENTENCE)).toBeNull()
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
    listAnswer = { ...LIST, styles: LIST.styles.map((s) => (s.id === MEMBER.id ? gone : s)) }
    routes.unshift(['GET', re(`/api/j2/journal-styles/${MEMBER.id}`), { style: { ...gone, outlineBodyJson: null } }])
    const dialog = await share()
    expect(await within(dialog).findByText(OUTLINE_GONE_SENTENCE)).toBeInTheDocument()
  })

  it('...and says nothing of the kind when that template still exists', async () => {
    const kept = { ...MEMBER, outlineTemplateId: 'tpl_kept' }
    routes.unshift(['GET', /^\/api\/j2\/note-templates$/, { templates: [{ id: 'tpl_kept', name: 'Plan', title: 'Plan', createdAt: '1' }] }])
    listAnswer = { ...LIST, styles: LIST.styles.map((s) => (s.id === MEMBER.id ? kept : s)) }
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
    expect(called('POST', PLAN_URL)[0].body).toEqual(sentBody())
    expect(await screen.findByText(`Updated ${APPLIED.name} to the author's version ${APPLIED.sourceVersion}.`)).toBeInTheDocument()
  })

  it('I-2: after a successful update focus lands on the updated copy\'s row, never on <body>', async () => {
    // As in the app: the apply revalidates the Updates list BEFORE it returns (refreshLibrary), so the row and its
    // Review update button (the sheet's opener) are gone by the time the sheet closes. The POST is held until the
    // test has done exactly that.
    let land
    applyAnswer = new Promise((resolve) => { land = resolve })
    const dialog = await openSheet()
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    await waitFor(() => expect(called('POST', PLAN_URL)).toHaveLength(1))
    updatesAnswer = NONE
    await act(async () => { await swrCfg.mutate(LIBRARY_UPDATES_KEY) })
    expect(screen.queryByRole('button', { name: `Review the update to ${UPDATE.styleName}` })).toBeNull()   // opener gone
    await act(async () => { land(contractBody('template-gallery.updates.apply')) })
    await screen.findByText(`Updated ${APPLIED.name} to the author's version ${APPLIED.sourceVersion}.`)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: `Edit ${COPY.name}` })))
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement.isConnected).toBe(true)
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
    expect(called('POST', PLAN_URL)[0].body).toEqual(sentBody({ takeOutline: false }))
  })

  it('ticking it sends takeOutline: true', async () => {
    planAnswer = { plan: PLAN_OUTLINE }
    const dialog = await openSheet()
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: TAKE_OUTLINE_LABEL }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    await waitFor(() => expect(called('POST', PLAN_URL)).toHaveLength(1))
    expect(called('POST', PLAN_URL)[0].body).toEqual(sentBody({ takeOutline: true }))
  })

  it('M-1: the base is the one captured with the plan, even when the list revalidates before Update', async () => {
    const dialog = await openSheet()
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    listAnswer = listWith({ ...COPY, updatedAt: NEWER_STAMP })            // the copy moved in another tab
    const before = called('GET', /^\/api\/j2\/journal-styles$/).length
    await act(async () => { await swrCfg.mutate(STYLES_URL) })
    expect(called('GET', /^\/api\/j2\/journal-styles$/).length).toBeGreaterThan(before)     // it did revalidate
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    await waitFor(() => expect(called('POST', PLAN_URL)).toHaveLength(1))
    expect(called('POST', PLAN_URL)[0].body.baseUpdatedAt).toBe(COPY_STAMP)               // previewed, not live
  })

  it('a 409 shows the server\'s stale sentence, and Look again re-reads the copy and sends the NEW base', async () => {
    applyAnswer = [STALE._contract.status, STALE.body]
    const dialog = await openSheet()
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    const plansBefore = called('GET', PLAN_URL).length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(STALE.body.detail)
    expect(within(dialog).queryByRole('button', { name: 'Update my copy' })).toBeNull()       // no second blind try
    expect(called('POST', PLAN_URL)[0].body.baseUpdatedAt).toBe(COPY_STAMP)
    listAnswer = listWith({ ...COPY, updatedAt: NEWER_STAMP })                              // what the 409 was about
    applyAnswer = contractBody('template-gallery.updates.apply')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look again' }))
    await waitFor(() => expect(called('GET', PLAN_URL).length).toBe(plansBefore + 1))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Update my copy' }))
    await waitFor(() => expect(called('POST', PLAN_URL)).toHaveLength(2))
    expect(called('POST', PLAN_URL)[1].body).toEqual(sentBody({ baseUpdatedAt: NEWER_STAMP }))
  })

  it('M-8: a newer listed version than the one previewed is the server\'s 409, and Look again re-reads the plan', async () => {
    applyAnswer = [MOVED._contract.status, MOVED.body]
    const dialog = await openSheet()
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    const plansBefore = called('GET', PLAN_URL).length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(MOVED.body.detail)
    expect(called('POST', PLAN_URL)[0].body.toVersion).toBe(PLAN.toVersion)
    applyAnswer = contractBody('template-gallery.updates.apply')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look again' }))
    await waitFor(() => expect(called('GET', PLAN_URL).length).toBe(plansBefore + 1))
    expect(await within(dialog).findByRole('button', { name: 'Update my copy' })).toBeInTheDocument()
  })

  it('M-6: a plan that answers 404 after Look again says the copy is already up to date', async () => {
    applyAnswer = [STALE._contract.status, STALE.body]
    const dialog = await openSheet()
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update my copy' }))
    await within(dialog).findByRole('alert')
    planAnswer = [PLAN_404._contract.status, PLAN_404.body]
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look again' }))
    expect(await within(dialog).findByText(UP_TO_DATE_SENTENCE)).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(within(dialog).queryByText(/Couldn't check/)).toBeNull()
    expect(within(dialog).getByText('Close', { selector: 'button' })).toBeInTheDocument()
  })

  it('M-6: when the copy is not in the styles list, it says why Update is unavailable', async () => {
    listAnswer = listWith(null)
    flags()
    openManager()
    fireEvent.click(await screen.findByRole('button', { name: `Updates (${UPDATES.updates.length})` }))
    fireEvent.click(await screen.findByRole('button', { name: `Review the update to ${UPDATE.styleName}` }))
    const dialog = await screen.findByRole('dialog', { name: /^Update / })
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NO_COPY_SENTENCE)
    expect(within(dialog).getByRole('button', { name: 'Update my copy' })).toBeDisabled()
  })

  it('Not now closes the sheet and writes nothing', async () => {
    const dialog = await openSheet()
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `Update ${COPY.name}` })).toBeNull())
    expect(called('POST', PLAN_URL)).toEqual([])
  })
})

// ⛔ Final review M-9: the deep link is the SERVER's (template_gallery.py `LIBRARY_UPDATE_PATH`), read off the
// source the way lib/notices.test.js reads it, never typed here. A rename there now reds this file too, where
// before the manager silently stopped opening the sheet from the bell while every test stayed green.
const SERVER_LINK = readFileSync(resolve(globalThis.process.cwd(), '..', 'api', 'services', 'journal_two',
  'template_gallery.py'), 'utf8').match(/^LIBRARY_UPDATE_PATH = "(.+)"$/m)?.[1]
const linkTo = (id) => `${SERVER_LINK}${id}`
const LINK_PARAM = SERVER_LINK ? [...new URLSearchParams(SERVER_LINK.split('?')[1]).keys()].pop() : null

describe('the bell notice\'s deep link', () => {
  it('reads the server\'s link (non-vacuity)', () => {
    expect(SERVER_LINK).toMatch(/^\/journal\/notebook\?/)
    expect(LINK_PARAM).toBeTruthy()
  })

  it('?styles=1&libraryUpdate=<id> opens the update sheet for that copy, then leaves the URL clean', async () => {
    flags()
    openManager(linkTo(COPY.id))
    const dialog = await screen.findByRole('dialog', { name: `Update ${COPY.name}` })
    expect(await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))).toBeInTheDocument()
    await waitFor(() => expect(new URLSearchParams(lastLocation.search).get(LINK_PARAM)).toBeNull())
    expect(new URLSearchParams(lastLocation.search).get('styles')).toBe('1')     // only its own param is taken
  })

  it('I-1: it opens the sheet even when the Updates list was cached EMPTY before the bell rang', async () => {
    flags()
    const cache = new Map()                                                    // the app's one SWR cache
    updatesAnswer = NONE
    const first = openManager('/journal/notebook', cache)
    await memberRow()
    await waitFor(() => expect(called('GET', /\/template-gallery\/updates$/).length).toBeGreaterThan(0))
    await act(async () => {})
    first.unmount()
    updatesAnswer = UPDATES                                                    // an admin approved; the bell rang
    openManager(linkTo(COPY.id), cache)
    const dialog = await screen.findByRole('dialog', { name: `Update ${COPY.name}` })
    expect(await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))).toBeInTheDocument()
  })

  it('a dismissed deep-linked sheet does not open again', async () => {
    flags()
    openManager(linkTo(COPY.id))
    const dialog = await screen.findByRole('dialog', { name: `Update ${COPY.name}` })
    await within(dialog).findByText(addsBlocksLine(PLAN.addBlocks))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `Update ${COPY.name}` })).toBeNull())
    await act(async () => { await swrCfg.mutate((k) => typeof k === 'string') })     // everything revalidates
    fireEvent.click(screen.getByRole('button', { name: `Updates (${UPDATES.updates.length})` }))  // and re-renders
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: `Update ${COPY.name}` })).toBeNull()
  })

  it('a style id that is not this member\'s opens nothing and shows nothing broken', async () => {
    flags()
    openManager(linkTo('s_not_mine'))
    await memberRow()
    await waitFor(() => expect(called('GET', /\/template-gallery\/updates$/).length).toBeGreaterThan(0))
    await waitFor(() => expect(new URLSearchParams(lastLocation.search).get(LINK_PARAM)).toBeNull())
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: /^Update / })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(called('GET', /\/template-gallery\/updates\/s_not_mine$/)).toEqual([])
  })
})
