// The template picker on a touch screen, and its outline (WebKit + axe walk, 2026-10-27):
//   4. the search box's "Up and Down choose a template. Enter opens it." and the live line's "Enter opens Blank
//      note." are keyboard words a VoiceOver/TalkBack member cannot act on. On a coarse pointer the hint is not
//      drawn and the live line says how many templates the search or chip left ("3 templates.");
//   5. the built-in family labels ("Around a trade") and "Your templates" are h3 headings, peers of the Template
//      library's h3, so heading navigation reaches them. The keyboard half is the control: unchanged.
//
// Review fix (D1/D2): the count is DERIVED from what each section shows -- built-ins + the member's own + the
// Template library's -- with all three present here (the library from the server's REAL contract answer, the
// member's list from a fake that resolves when the test says). Every expected number below is computed from those
// DATA (the catalog, the fixture rows, the member list), never by counting the cards the picker drew, and every
// value the live line ever held is recorded, so a transient wrong number is caught as well as a wrong final one.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import TemplatePicker from './TemplatePicker'
import { loadTemplates } from '../../lib/templatesLoader'
import { FAMILIES, templatesByFamily } from '../../lib/notebookTemplates'
import { LIBRARY_GROUPS } from '../../lib/templateLibrary'
import { libraryRows, libraryMatches, libraryInCategory } from './library/TemplateLibrarySection'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import LIBRARY_FIXTURE from '../../__fixtures__/contract/template-gallery.library.json'

const coarse = vi.hoisted(() => ({ on: false }))
vi.mock('../../../../hooks/useBreakpoint', async (orig) => ({
  ...(await orig()), useHasCoarsePointer: () => coarse.on,
}))

// The touch live line's words (TemplatePicker's own `touchMatchWords`, kept private so the module exports only
// what it already did): "1 template." / "<n> templates."
const touchMatchWords = (n) => (n === 1 ? '1 template.' : `${n} templates.`)

// The member's own templates: one shares a word with nothing built-in or in the library ("Zebra"), so a search can
// match ONLY the member's (N3).
const MEMBER = [
  { id: 'm1', name: 'Zebra stripe review', title: 'Zebra stripe review' },
  { id: 'm2', name: 'My gap plan', title: 'My gap plan' },
]
const ONLY_MEMBER = 'zebra'

let releaseMembers                     // resolves the member list when a test says so
let memberGate
let releaseLibrary                     // resolves the library list (open by default; one test re-gates it)
let libraryGate
const serve = { library: 200, members: 200, w11: true }   // per-test answers (reset in beforeEach)
beforeAll(() => loadTemplates())
beforeEach(() => {
  memberGate = new Promise((r) => { releaseMembers = r })
  libraryGate = new Promise((r) => { releaseLibrary = r })
  releaseLibrary()
  Object.assign(serve, { library: 200, members: 200, w11: true })
  globalThis.fetch = vi.fn(async (url) => {
    const path = new URL(String(url), 'http://x').pathname
    if (path === '/api/j2/template-gallery/library') {
      await libraryGate
      if (serve.library !== 200) return { ok: false, status: serve.library, json: async () => ({ detail: 'boom' }) }
      return { ok: true, status: 200, json: async () => LIBRARY_FIXTURE.body }
    }
    if (path === '/api/j2/note-templates') {
      await memberGate
      if (serve.members !== 200) return { ok: false, status: serve.members, json: async () => ({ detail: 'boom' }) }
      return { ok: true, status: 200, json: async () => ({ templates: MEMBER }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
})
afterEach(() => { cleanup(); coarse.on = false; __resetNotebookFlags() })

/* ---- the oracle: what each section should show, from DATA ---- */
const LIB_ROWS = libraryRows(LIBRARY_FIXTURE.body)
const GROUP_KEYS = new Set(LIBRARY_GROUPS.map((g) => g.key))
const builtInExpected = (q, cat) => FAMILIES
  .filter((f) => cat === 'all' || cat === f.key)
  .reduce((n, f) => n + templatesByFamily(f.key).filter((t) => !q
    || [t.label, t.description, t.when, ...(t.tags || [])].join(' ').toLowerCase().includes(q)).length, 0)
const libraryExpected = (q, cat) => (cat === 'member' ? 0
  : LIB_ROWS.filter((r) => GROUP_KEYS.has(r.group) && libraryMatches(r, q) && libraryInCategory(r, cat)).length)
const memberExpected = (q, cat) => (cat === 'all' || cat === 'member'
  ? MEMBER.filter((t) => !q || t.name.toLowerCase().includes(q)).length : 0)
const expected = (q, cat) => builtInExpected(q, cat) + libraryExpected(q, cat) + memberExpected(q, cat)

/* ---- the DOM side ---- */
const liveEl = () => document.querySelector('[data-template-search-status]')
const box = () => screen.getByRole('searchbox', { name: 'Search templates' })
const settle = (ms = 120) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
/** Waits until the live line says `text` (the settle is a timer; a loaded run needs more than one tick). */
const says = (text) => vi.waitFor(() => expect(liveEl().textContent).toBe(text), { timeout: 4000 })
const chip = (label) => within(screen.getByRole('group', { name: 'Filter templates by category' }))
  .getByRole('button', { name: label })

/** Every text the live line ever held, in order, including one replaced within the same task: built from each
 *  mutation's OLD value (a MutationObserver callback runs after the task, when the text is already the last one). */
function recordLive() {
  const said = []
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') said.push(r.oldValue || '')
      else for (const n of r.removedNodes) said.push(n.textContent || '')
    }
  })
  mo.observe(liveEl(), { childList: true, characterData: true, characterDataOldValue: true, subtree: true })
  return {
    said,
    stop: () => {
      for (const r of mo.takeRecords()) {
        if (r.type === 'characterData') said.push(r.oldValue || '')
        else for (const n of r.removedNodes) said.push(n.textContent || '')
      }
      mo.disconnect()
      said.push(liveEl().textContent)
      // consecutive repeats are one utterance
      return said.filter((t, i) => t && t !== said[i - 1])
    },
  }
}

async function mount({ members = true, library = true } = {}) {
  if (serve.w11) latchNotebookFlags({ notebook_widgets_w11_enabled: true })
  // A fresh SWR cache per test, so the member list is asked for (and gated) every time.
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><TemplatePicker onPick={() => {}} onPickMember={() => {}} /></MemoryRouter>
    </SWRConfig>,
  )
  if (serve.w11) await screen.findByRole('heading', { name: 'Template library' })
  if (!library) return
  if (members) {
    releaseMembers()
    if (serve.members === 200) await screen.findByRole('button', { name: MEMBER[0].name })
    else await screen.findByText("Couldn't load your templates.")
  }
  await settle()
}

describe('4. touch: no keyboard words, a count instead', () => {
  it('the key hint is not drawn and not described; the live line is silent until the member filters', async () => {
    coarse.on = true
    await mount()
    expect(screen.queryByText(/Up and Down choose a template/)).toBeNull()
    expect(box().getAttribute('aria-describedby')).toBeNull()
    expect(liveEl().textContent).toBe('')
    expect(document.body.textContent).not.toMatch(/Enter opens/)
  })

  it('the count is built-ins + the member\'s own + the library\'s, each addend non-zero, and never a passing wrong number', async () => {
    coarse.on = true
    await mount()
    // Non-vacuity: every addend is present on the filters used below.
    expect(builtInExpected('', 'all')).toBeGreaterThan(0)
    expect(libraryExpected('', 'all')).toBeGreaterThan(0)
    expect(memberExpected('', 'all')).toBe(MEMBER.length)
    const rec = recordLive()
    fireEvent.click(chip('All'))
    await says(touchMatchWords(expected('', 'all')))
    // A search that changes all three addends at once ("plan": built-in plans, library plans, "My gap plan").
    fireEvent.change(box(), { target: { value: 'plan' } })
    expect(builtInExpected('plan', 'all')).toBeGreaterThan(0)
    expect(libraryExpected('plan', 'all')).toBeGreaterThan(0)
    expect(memberExpected('plan', 'all')).toBe(1)
    await says(touchMatchWords(expected('plan', 'all')))
    // A family chip: the library rows it keeps, and no member templates.
    fireEvent.change(box(), { target: { value: '' } })
    fireEvent.click(chip('Around a trade'))
    expect(libraryExpected('', 'trades')).toBeGreaterThan(0)
    await says(touchMatchWords(expected('', 'trades')))
    await settle()
    // Every non-empty thing the line ever said was one of the right answers, in order: nothing transient.
    expect(rec.stop()).toEqual([
      touchMatchWords(expected('', 'all')),
      touchMatchWords(expected('plan', 'all')),
      touchMatchWords(expected('', 'trades')),
    ])
  })

  it('a chip tapped BEFORE the member\'s list loads waits for it, then says the full count (D1: not a stale one)', async () => {
    coarse.on = true
    await mount({ members: false })
    const rec = recordLive()
    fireEvent.click(chip('All'))
    await settle()
    releaseMembers()
    await screen.findByRole('button', { name: MEMBER[0].name })
    await says(touchMatchWords(expected('', 'all')))
    await settle()
    expect(rec.stop()).toEqual([touchMatchWords(expected('', 'all'))])   // the short count never spoken
  })

  describe('the library answering late', () => {
    it('a chip tapped BEFORE the Template library answers waits for it, then says the full count', async () => {
      coarse.on = true
      // Re-gate this test's library before mounting: the fetch reads `libraryGate` when it is called.
      libraryGate = new Promise((r) => { releaseLibrary = r })
      releaseMembers()
      await mount({ library: false })
      await screen.findByRole('button', { name: MEMBER[0].name })
      const rec = recordLive()
      fireEvent.click(chip('All'))
      await settle(200)
      releaseLibrary()
      await screen.findByText(LIB_ROWS[0].title)
      await says(touchMatchWords(expected('', 'all')))
      await settle()
      expect(rec.stop()).toEqual([touchMatchWords(expected('', 'all'))])   // never builtIn + member alone
    })
  })

  it('a member template being renamed (a form, not a card) still counts', async () => {
    coarse.on = true
    await mount()
    fireEvent.click(chip('Your templates'))
    await says(touchMatchWords(MEMBER.length))
    fireEvent.click(screen.getByRole('button', { name: `Rename ${MEMBER[0].name}` }))
    expect(screen.getByRole('textbox', { name: `New name for ${MEMBER[0].name}` })).toBeInTheDocument()
    fireEvent.click(chip('All'))
    await says(touchMatchWords(expected('', 'all')))
  })

  it('CONTROL: a fine pointer keeps the key hint, its description and "Enter opens ..." exactly as before', async () => {
    await mount()
    const hint = screen.getByText('Up and Down choose a template. Enter opens it.')
    expect(box().getAttribute('aria-describedby')).toBe(hint.id)
    fireEvent.focus(box())
    await vi.waitFor(() => expect(liveEl().textContent).toMatch(/^Enter opens .+\.$/))
  })
})

// Review M-1: an ABSENT or FAILED section is a known 0, not a reason to stay silent. Each says the other two.
describe('a section that is off or failed counts as a known 0', () => {
  // Inside the cap (CONFIG_TIMEOUT_MS = 3000): the line must speak because the addend is KNOWN, not because it gave up.
  const promptly = (text) => vi.waitFor(() => expect(liveEl().textContent).toBe(text), { timeout: 1500 })

  it('wave 11 off (no Template library): "All" says built-ins + the member\'s own', async () => {
    coarse.on = true
    serve.w11 = false
    await mount()
    expect(document.querySelector('[data-template-library]')).toBeNull()        // non-vacuity: the section is absent
    fireEvent.click(chip('All'))
    await promptly(touchMatchWords(builtInExpected('', 'all') + memberExpected('', 'all')))
  })

  it('the library answering 500: "All" says built-ins + the member\'s own', async () => {
    coarse.on = true
    serve.library = 500
    await mount()
    await vi.waitFor(() => expect(document.querySelector('[data-template-library] [data-refusal]')).not.toBeNull())
    fireEvent.click(chip('All'))
    await promptly(touchMatchWords(builtInExpected('', 'all') + memberExpected('', 'all')))
  })

  it('the member list answering 500: "All" says built-ins + the library\'s', async () => {
    coarse.on = true
    serve.members = 500
    await mount()
    fireEvent.click(chip('All'))
    await promptly(touchMatchWords(builtInExpected('', 'all') + libraryExpected('', 'all')))
  })
})

// Review L-1: a request that never answers cannot keep the line silent for good. Fake timers, so the cap is exact.
describe('a hung request: the line speaks what is known after the cap', () => {
  afterEach(() => { vi.useRealTimers() })
  it('silent just under 3 s, then built-ins + the library; a late member answer then updates it', async () => {
    coarse.on = true
    await mount({ members: false })                    // the member list is never released (hung)
    vi.useFakeTimers()
    fireEvent.click(chip('All'))
    await act(async () => { vi.advanceTimersByTime(2900) })
    expect(liveEl().textContent).toBe('')                // still waiting: under the cap
    await act(async () => { vi.advanceTimersByTime(200) })   // past 3000: gave up waiting
    await act(async () => { vi.advanceTimersByTime(100) })   // the settle
    expect(liveEl().textContent).toBe(touchMatchWords(builtInExpected('', 'all') + libraryExpected('', 'all')))
    vi.useRealTimers()
    releaseMembers()
    await screen.findByRole('button', { name: MEMBER[0].name })
    await says(touchMatchWords(expected('', 'all')))
  })
})

describe('N3: "No templates match" counts the member\'s own matches too', () => {
  it('a search matching only the member\'s templates shows them and no "No templates match"', async () => {
    coarse.on = true
    await mount()
    expect(builtInExpected(ONLY_MEMBER, 'all') + libraryExpected(ONLY_MEMBER, 'all')).toBe(0)   // non-vacuity
    fireEvent.change(box(), { target: { value: ONLY_MEMBER } })
    await says(touchMatchWords(1))
    expect(screen.getByRole('button', { name: MEMBER[0].name })).toBeInTheDocument()
    expect(screen.queryByText(/No templates match/)).toBeNull()
  })

  it('L-2: while "Your templates" is still loading, "No templates match" is not shown (it would vanish after)', async () => {
    await mount({ members: false })
    fireEvent.change(box(), { target: { value: ONLY_MEMBER } })
    await settle(200)
    expect(screen.queryByText(/No templates match/)).toBeNull()
    releaseMembers()
    await screen.findByRole('button', { name: MEMBER[0].name })
    expect(screen.queryByText(/No templates match/)).toBeNull()
    // CONTROL in the same state: a search the member's list does not match shows it once the list has answered.
    fireEvent.change(box(), { target: { value: 'qqq no such template anywhere' } })
    expect(await screen.findByText(/No templates match/)).toBeInTheDocument()
  })

  it('CONTROL: a search matching nothing anywhere still says "No templates match"', async () => {
    await mount()
    fireEvent.change(box(), { target: { value: 'qqq no such template anywhere' } })
    expect(await screen.findByText(/No templates match/)).toBeInTheDocument()
  })
})

describe('5. the picker outline: every family is a heading', () => {
  it('each built-in family label and "Your templates" is an h3 that still names its group', async () => {
    await mount()
    for (const fam of FAMILIES.filter((f) => templatesByFamily(f.key).length)) {
      const h = screen.getByRole('heading', { level: 3, name: fam.label })
      expect(screen.getByRole('group', { name: fam.label }).getAttribute('aria-labelledby')).toBe(h.id)
    }
    expect(screen.getByRole('heading', { level: 3, name: 'Your templates' })).toBeInTheDocument()
  })
})
