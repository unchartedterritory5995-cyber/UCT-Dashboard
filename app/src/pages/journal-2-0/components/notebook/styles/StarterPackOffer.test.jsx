// P5 Task 5: "How do you trade?", the starter pack offer (R-P5-5), through the REAL client
// (lib/starterPacks.js, lib/journalStyles.js) with only the network and the preferences hook faked.
// Server answers are the generated contract fixtures (__fixtures__/contract): the empty list (a member with no
// styles of their own), the list with one of the member's own, and the swing install. A failure is transport
// (a 5xx), not a server answer, so it stays inline.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { contractBody } from '../../../__fixtures__/contract'
import { PACKS, STARTER_PACK_PREF } from '../../../lib/starterPacks'

const setPref = vi.fn()
// The real hook resolves {ok: true} when the server took the write (usePreferences postPref).
const setPrefMerged = vi.fn(async () => ({ ok: true }))
let prefsNow = {}
vi.mock('../../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: prefsNow, setPref, setPrefMerged, loading: false, readFailed: false }),
}))
vi.mock('../../../lib/offline/settleNoteWrite', () => ({
  settleNoteWrite: vi.fn(async () => {}),
  settleNoteWrites: vi.fn(async () => {}),
}))

import KindSection from './KindSection'
import StylesManager from './StylesManager'
import StarterPackOffer from './StarterPackOffer'

const EMPTY = contractBody('journal-styles.list.empty')           // built-ins only
const WITH_OWN = contractBody('journal-styles.list')               // one style of the member's own
const INSTALLED = contractBody('journal-styles.starter-pack.install')
const TITLES = INSTALLED.installed.map((i) => i.title)
const TITLE = 'How do you trade?'
const LINE = 'Pick one and we will add three styles you can change.'
const FAILED = "Couldn't confirm that pack. Try again; nothing is added twice."
const EMPTY_LINE = 'Nothing was added. This pack has no styles to add right now.'
const NOT_SAVED = "Couldn't save your answer, so this card may ask again."
const INSTALL_URL = /^\/api\/j2\/journal-styles\/starter-packs\/swing$/

let calls
let list
let install
function installFetch() {
  calls = []
  globalThis.fetch = vi.fn((input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(typeof input === 'string' ? input : input.url).split('?')[0]
    calls.push({ method, path })
    let status = 200
    let body = { detail: 'Not found' }
    if (method === 'GET' && path === '/api/j2/journal-styles') body = list
    else if (method === 'GET' && path === '/api/j2/note-kinds/mapping-offer') body = { offer: null }
    else if (method === 'POST' && INSTALL_URL.test(path)) [status, body] = install
    else status = 404
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
  })
}
const posts = () => calls.filter((c) => c.method === 'POST' && INSTALL_URL.test(c.path))

const swr = (child) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{child}</SWRConfig>
)
const kindSection = () => render(swr(<KindSection onCreate={vi.fn()} />))
const cards = () => screen.queryAllByRole('region', { name: TITLE })
const manager = () => render(swr(<StylesManager open onClose={vi.fn()} />))
const card = () => screen.queryByRole('region', { name: TITLE })
const flags = (starter = true) => latchNotebookFlags({
  notebook_journal_styles_enabled: true, notebook_starter_packs_enabled: starter,
})
/** The value the last setPrefMerged call writes, run through its updater as the hook would. */
const written = () => {
  const [key, updater] = setPrefMerged.mock.calls.at(-1)
  return { key, value: typeof updater === 'function' ? updater(undefined) : updater }
}

beforeEach(() => {
  __resetNotebookFlags()
  prefsNow = {}
  setPref.mockClear()
  setPrefMerged.mockClear()
  list = EMPTY
  install = [200, INSTALLED]
  Element.prototype.scrollIntoView = vi.fn()
  installFetch()
})
afterEach(() => { __resetNotebookFlags() })

describe('How do you trade? (R-P5-5)', () => {
  it('1. with the switch off there is no card and no Starter packs link', async () => {
    flags(false)
    const { unmount } = kindSection()
    await screen.findByRole('group', { name: 'Start from a kind of note' })
    expect(card()).toBeNull()
    unmount()
    manager()
    await screen.findByRole('button', { name: /New style/ })
    expect(card()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Starter packs' })).toBeNull()
  })

  it('2. test_no_offer_for_a_member_with_styles: one own style means no card, and the link still opens it', async () => {
    flags()
    list = WITH_OWN
    expect(WITH_OWN.styles.some((s) => !s.builtin)).toBe(true)                  // control: the fixture has one
    manager()
    const link = await screen.findByRole('button', { name: 'Starter packs' })
    expect(card()).toBeNull()
    fireEvent.click(link)
    const offer = await screen.findByRole('region', { name: TITLE })
    expect(within(offer).getByText(LINE)).toBeInTheDocument()
  })

  it('2b. the link opens the offer even after the member dismissed it', async () => {
    flags()
    prefsNow = { [STARTER_PACK_PREF]: JSON.stringify({ v: 1, state: 'dismissed', at: '2026-10-18T00:00:00.000Z' }) }
    manager()
    fireEvent.click(await screen.findByRole('button', { name: 'Starter packs' }))
    expect(await screen.findByRole('region', { name: TITLE })).toBeInTheDocument()
  })

  it('3. with zero own styles and no preference the card shows in KindSection, and at the top of the manager', async () => {
    flags()
    const { unmount } = kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    expect(within(offer).getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(within(offer).getByText(LINE)).toBeInTheDocument()
    unmount()
    manager()
    const inManager = await screen.findByRole('region', { name: TITLE })
    // at the top of the list column: before the New style button
    const newStyle = screen.getByRole('button', { name: /New style/ })
    expect(inManager.compareDocumentPosition(newStyle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('3b. a member who already answered sees no card in KindSection', async () => {
    flags()
    prefsNow = { [STARTER_PACK_PREF]: JSON.stringify({ v: 1, state: 'installed', pack: 'day', at: '2026-10-18T00:00:00.000Z' }) }
    kindSection()
    await screen.findByRole('group', { name: 'Start from a kind of note' })
    expect(card()).toBeNull()
  })

  it('4. choosing Swing posts once, writes the installed state, and shows the added titles', async () => {
    flags()
    kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Swing' }))
    expect(await within(offer).findByText(`Added: ${TITLES.join(', ')}. They are in your Styles.`)).toBeInTheDocument()
    expect(posts()).toHaveLength(1)
    const { key, value } = written()
    expect(key).toBe('notebook_starter_pack')
    expect(Object.keys(value).sort()).toEqual(['at', 'pack', 'state', 'v'])
    expect(value).toMatchObject({ v: 1, state: 'installed', pack: 'swing' })
    expect(value.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(512)
    expect(screen.getByRole('region', { name: TITLE })).toBe(offer)              // the result stays on screen
  })

  it('4b. Already had and Skipped lines appear only when non-empty, and a skipped row names its reason', async () => {
    flags()
    install = [200, {
      installed: [INSTALLED.installed[0]], alreadyHad: [TITLES[1]],
      skipped: [{ title: TITLES[2], reason: 'You can keep up to 200 styles. Delete one first.' }],
    }]
    kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Swing' }))
    expect(await within(offer).findByText(`Added: ${TITLES[0]}. They are in your Styles.`)).toBeInTheDocument()
    expect(within(offer).getByText(`Already had: ${TITLES[1]}.`)).toBeInTheDocument()
    expect(within(offer).getByText(`Skipped: ${TITLES[2]}. You can keep up to 200 styles. Delete one first.`)).toBeInTheDocument()
  })

  it('4c. with nothing already had or skipped, neither line is shown', async () => {
    flags()
    kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Swing' }))
    await within(offer).findByText(/^Added: /)
    expect(within(offer).queryByText(/^Already had:/)).toBeNull()
    expect(within(offer).queryByText(/^Skipped:/)).toBeNull()
  })

  it('5. Not now writes the dismissed state and the card does not come back on rerender', async () => {
    flags()
    const { rerender, unmount } = kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(card()).toBeNull())
    const { key, value } = written()
    expect(key).toBe('notebook_starter_pack')
    expect(Object.keys(value).sort()).toEqual(['at', 'state', 'v'])               // dismissed carries no pack
    expect(value).toMatchObject({ v: 1, state: 'dismissed' })
    expect(posts()).toHaveLength(0)
    // a rerender with the server's answer, and a fresh mount, both leave it gone
    prefsNow = { [STARTER_PACK_PREF]: JSON.stringify(value) }
    rerender(swr(<KindSection onCreate={vi.fn()} />))
    expect(card()).toBeNull()
    unmount()
    kindSection()
    await screen.findByRole('group', { name: 'Start from a kind of note' })
    expect(card()).toBeNull()
  })

  it('6. a failed install shows the failure sentence and writes no state', async () => {
    flags()
    install = [500, { detail: 'boom' }]
    kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Swing' }))
    expect(await within(offer).findByRole('alert')).toHaveTextContent(FAILED)
    expect(posts()).toHaveLength(1)
    expect(setPrefMerged).not.toHaveBeenCalled()
    expect(within(offer).queryByText(/^Added:/)).toBeNull()
  })

  it('7. every button has a name, and tab order follows reading order', async () => {
    flags()
    kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    const buttons = within(offer).getAllByRole('button')
    expect(buttons.map((b) => b.textContent.trim())).toEqual([...PACKS.map((p) => p.label), 'Not now'])
    for (const b of buttons) {
      expect(b.getAttribute('aria-label') || b.textContent.trim()).toBeTruthy()
      // no positive tabindex: the DOM order, which is the reading order, is the tab order
      expect(Number(b.getAttribute('tabindex') || 0)).toBeLessThanOrEqual(0)
    }
    // the heading and the line come before the first button in the document
    const first = buttons[0]
    for (const text of [TITLE, LINE]) {
      const node = within(offer).getByText(text)
      expect(node.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

// P5 final fix: the Task 5 review's before-arming minors, and ruling P5-T10-R2 (one offer per page).
describe('How do you trade? -- what the card says, and one card per page', () => {
  it('8. an empty answer still says what happened (nothing was added), and writes the installed state', async () => {
    flags()
    install = [200, { installed: [], alreadyHad: [], skipped: [] }]
    kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Swing' }))
    const line = await within(offer).findByText(EMPTY_LINE)
    expect(within(offer).getByRole('status').contains(line)).toBe(true)
    expect(within(offer).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(written().value).toMatchObject({ state: 'installed', pack: 'swing' })
  })

  it('9. an installed answer the server did not take is said, beside the true Added line', async () => {
    flags()
    setPrefMerged.mockResolvedValueOnce({ ok: false })
    kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Swing' }))
    await within(offer).findByText(/^Added: /)                          // the styles WERE added (the server said so)
    expect(within(offer).getByRole('alert')).toHaveTextContent(NOT_SAVED)
  })

  it('9b. a write that landed shows no not-saved alert (control for 9)', async () => {
    flags()
    kindSection()
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Swing' }))
    await within(offer).findByText(/^Added: /)
    expect(within(offer).queryByRole('alert')).toBeNull()
  })

  it('10. a dismissed answer the server did not take keeps the card and says so; Not now again closes it', async () => {
    flags()
    const onClose = vi.fn()
    setPrefMerged.mockResolvedValueOnce(undefined)                      // a network failure resolves with nothing
    render(swr(<StarterPackOffer onClose={onClose} />))
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Not now' }))
    expect(await within(offer).findByRole('alert')).toHaveTextContent(NOT_SAVED)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(within(offer).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(setPrefMerged).toHaveBeenCalledTimes(2)
  })

  it('11. P5-T10-R2: two kind sections and the manager on one page show ONE card, on the surface opened last', async () => {
    flags()
    const { rerender } = render(swr(<><KindSection onCreate={vi.fn()} /><KindSection onCreate={vi.fn()} /></>))
    await screen.findByRole('region', { name: TITLE })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(cards()).toHaveLength(1)
    // the second section opened last, so it holds the card
    const sections = screen.getAllByRole('group', { name: 'Start from a kind of note' }).map((g) => g.closest('section'))
    expect(sections).toHaveLength(2)
    expect(sections[1].contains(cards()[0])).toBe(true)
    // the Styles manager opening over them takes the card; there is still one
    rerender(swr(<><KindSection onCreate={vi.fn()} /><KindSection onCreate={vi.fn()} /><StylesManager open onClose={vi.fn()} /></>))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Journal styles' }).contains(cards()[0] || null)).toBe(true))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(cards()).toHaveLength(1)
  })

  it('12. Not now on the one card leaves no card on any surface; the owner closing hands the page back', async () => {
    flags()
    const { rerender } = render(swr(<><KindSection onCreate={vi.fn()} /><KindSection onCreate={vi.fn()} /></>))
    const offer = await screen.findByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(cards()).toHaveLength(0))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(cards()).toHaveLength(0)
    // the owner (the second section) leaves; the first asks R-P5-5 afresh: the answer is now recorded, so no card
    prefsNow = { [STARTER_PACK_PREF]: JSON.stringify(written().value) }
    rerender(swr(<KindSection onCreate={vi.fn()} />))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(cards()).toHaveLength(0)
  })

  it('12b. the owner closing without an answer hands the card back to the surface still on screen', async () => {
    flags()
    const { rerender } = render(swr(<><KindSection onCreate={vi.fn()} /><KindSection key="sheet" onCreate={vi.fn()} /></>))
    await screen.findByRole('region', { name: TITLE })
    rerender(swr(<KindSection onCreate={vi.fn()} />))
    await waitFor(() => expect(cards()).toHaveLength(1))
  })
})
