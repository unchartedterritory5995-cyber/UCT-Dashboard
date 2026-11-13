// Wave 8 lane 8C (C1): the Notebook help articles on /support.
//
// ⛔ The routes and Settings sections a link may point at are DERIVED by parsing App.jsx and
// Settings.jsx (acorn + acorn-jsx), never typed here; the links are read from Support.jsx the
// same way. ⛔ Copy is asserted as rendered text. ⛔ Every request is read from
// fetch.mock.calls outside the mock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Support, { FAQS, inferSourceTopic, visibleFaqs } from './Support'
import { AuthContext } from '../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from './journal-2-0/lib/offline/notebookFlags'
import { replayableTours, startPath } from './journal-2-0/components/notebook/onboarding/tourRegistry'

const JsxParser = Parser.extend(jsx())
const SRC = path.resolve(process.cwd(), 'src')
const parse = (file) => JsxParser.parse(fs.readFileSync(path.join(SRC, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })

function visit(n, fn) {
  if (!n || typeof n.type !== 'string') return
  fn(n)
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((c) => visit(c, fn))
    else if (v && typeof v.type === 'string') visit(v, fn)
  }
}
const attr = (el, name) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name?.name === name)
const literal = (a) => (a?.value?.type === 'Literal' ? a.value.value : null)

/** Every route path App.jsx declares, nested <Route>s composed. */
function appRoutes() {
  const out = new Set()
  const walk = (n, prefix) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'JSXElement' && n.openingElement.name?.name === 'Route') {
      const p = literal(attr(n, 'path'))
      const full = p == null ? prefix : (p.startsWith('/') ? p : `${prefix.replace(/\/$/, '')}/${p}`)
      if (p != null) out.add(full)
      for (const c of n.children) walk(c, full)
      return
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((c) => walk(c, prefix))
      else if (v && typeof v.type === 'string') walk(v, prefix)
    }
  }
  walk(parse('App.jsx'), '')
  return out
}

/** The `id`s of Settings.jsx's SECTIONS array. */
function settingsSections() {
  const ids = new Set()
  visit(parse('pages/Settings.jsx'), (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'SECTIONS' && n.init?.type === 'ArrayExpression') {
      for (const el of n.init.elements) {
        const id = el.properties?.find((p) => p.key?.name === 'id')
        if (id?.value?.type === 'Literal') ids.add(id.value.value)
      }
    }
  })
  return ids
}

/** Every <Link to> in a topic:'notebook' article, and in the helpers those articles use. */
const HELPERS = ['TourLink', 'ShareLinkSentence', 'PublishSentence', 'WalkthroughsSection', 'WhatsNewSection']
function notebookLinks() {
  const links = []
  const collect = (node) => visit(node, (n) => {
    if (n.type !== 'JSXElement' || n.openingElement.name?.name !== 'Link') return
    const to = attr(n, 'to')
    // Help > Walkthroughs links each tour to `startPath(t)` (its declared start,
    // else the Notebook root). That is not a literal, so every value it can take
    // -- one per replayable registered tour -- is checked instead; any OTHER
    // expression still reads as null and fails below.
    const ex = to?.value?.expression
    if (ex?.type === 'CallExpression' && ex.callee?.name === 'startPath') {
      links.push(...replayableTours().map((t) => startPath(t)))
    } else {
      links.push(literal(to))
    }
  })
  visit(parse('pages/Support.jsx'), (n) => {
    if (n.type === 'ObjectExpression') {
      const topic = n.properties.find((p) => p.key?.name === 'topic')
      if (topic?.value?.value === 'notebook') collect(n)
    }
    if (n.type === 'FunctionDeclaration' && HELPERS.includes(n.id?.name)) collect(n)
  })
  return links
}

function resolves(to, routes, sections) {
  if (typeof to !== 'string') return false
  const url = new URL(to, 'http://x')
  const known = [...routes].some((r) => {
    if (r === url.pathname) return true
    const re = new RegExp(`^${r.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*')}$`)
    return !r.includes('*') && re.test(url.pathname)
  })
  if (!known) return false
  if (url.pathname === '/settings' && url.searchParams.has('section')) return sections.has(url.searchParams.get('section'))
  return true
}

const NOTEBOOK = () => FAQS.filter((f) => f.topic === 'notebook')

// ── the page ─────────────────────────────────────────────────────────────────

function renderSupport(from = '/journal/notebook') {
  return render(
    <AuthContext.Provider value={{ user: { id: 'u1', email: 'm@local.dev' }, plan: 'pro', isPaid: true }}>
      <MemoryRouter initialEntries={[{ pathname: '/support', state: from ? { from } : null }]}>
        <Support />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  global.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/auth/faq-votes') return { ok: true, json: async () => ({ votes: [] }) }
    if (url === '/api/auth/tickets') return { ok: true, json: async () => [] }
    if (url === '/api/support/status') return { ok: true, json: async () => ({ status: 'operational', components: [] }) }
    if (String(url).startsWith('/api/auth/faq-vote/')) return { ok: true, json: async () => ({ ok: true, method: init.method }) }
    return { ok: false, json: async () => ({}) }
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const quickAnswer = async (q) => screen.findByRole('button', { name: q })

describe('inferSourceTopic', () => {
  it('the Notebook is asked before the Journal', () => {
    expect(inferSourceTopic({ state: { from: '/journal/notebook/abc' } })).toBe('notebook')
    expect(inferSourceTopic({ state: { from: '/journal/notebook' } })).toBe('notebook')
    expect(inferSourceTopic({ state: { from: '/journal/trades' } })).toBe('journal')
    expect(inferSourceTopic({ state: { from: '/settings' } })).toBe('account')
  })
})

describe('the articles', () => {
  it('at least twelve, each with a notebook- id the vote endpoint accepts', () => {
    const ids = NOTEBOOK().map((f) => f.id)
    expect(ids.length).toBeGreaterThanOrEqual(12)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^notebook-[a-z0-9-]+$/)
      expect(id.length).toBeLessThanOrEqual(64)
    }
    expect(new Set(FAQS.map((f) => f.id)).size).toBe(FAQS.length)   // unique across the page
  })

  it('no article for the personal API or email-in (their gates are server-only)', () => {
    const text = NOTEBOOK().map((f) => `${f.q} ${f.keywords}`).join(' ').toLowerCase()
    expect(text).not.toMatch(/personal api|api token|email-in|inbound email|email a note/)
  })
})

describe('every link resolves (derived, never typed)', () => {
  const routes = appRoutes()
  const sections = settingsSections()
  const links = notebookLinks()

  it('NON-VACUITY: the parses found what they must', () => {
    expect(routes.has('/journal/notebook')).toBe(true)
    expect(routes.has('/support')).toBe(true)
    expect(sections.has('connections')).toBe(true)
    expect(links).toContain('/journal/notebook')
    expect(links).toContain('/settings?section=connections')
  })

  it('each Notebook article link is an App route or a Settings section', () => {
    const broken = links.filter((to) => !resolves(to, routes, sections))
    expect(broken).toEqual([])
  })

  it('CONTROLS: a typo in a route or a section fails', () => {
    expect(resolves('/journal/notebok', routes, sections)).toBe(false)
    expect(resolves('/settings?section=nope', routes, sections)).toBe(false)
    expect(resolves('/journal/notebook/research/NVDA', routes, sections)).toBe(true)
  })
})

describe('the gated articles', () => {
  const SHARE_Q = 'How do I share a note or publish it to the web?'
  const SAMPLE_Q = 'What is the sample notebook, and how do I remove it?'

  it('hidden while no flag has latched, and while the flags are off', () => {
    expect(visibleFaqs().map((f) => f.q)).not.toContain(SHARE_Q)
    latchNotebookFlags({ j2_share_links_enabled: false, notebook_publish_enabled: false, notebook_onboarding_enabled: false })
    const qs = visibleFaqs().map((f) => f.q)
    expect(qs).not.toContain(SHARE_Q)
    expect(qs).not.toContain(SAMPLE_Q)
  })

  it('share links alone: the article shows, with the share sentence and without the publish one', async () => {
    latchNotebookFlags({ j2_share_links_enabled: true, notebook_publish_enabled: false })
    renderSupport()
    fireEvent.click(await quickAnswer(SHARE_Q))
    const a = screen.getByText(/Use the share button in a note's toolbar/).closest('div')
    expect(a).toHaveTextContent('Share link makes a read-only link to the note that anyone with the link can open.')
    expect(a).not.toHaveTextContent('Publish to the web')
    // owner ruling (backend review M-5): a trashed note's link comes back with the note
    expect(a).toHaveTextContent('Moving the note to Trash takes its link or page down, and restoring the note brings it back.')
  })

  it('publishing alone: the article shows, with the publish sentence only', async () => {
    latchNotebookFlags({ j2_share_links_enabled: false, notebook_publish_enabled: true })
    renderSupport()
    fireEvent.click(await quickAnswer(SHARE_Q))
    const a = screen.getByText(/Use the share button in a note's toolbar/).closest('div')
    expect(a).toHaveTextContent('Publish to the web turns the note into a public page.')
    expect(a).not.toHaveTextContent('Share link makes')
    expect(a).toHaveTextContent('Moving the note to Trash takes its link or page down, and restoring the note brings it back.')
  })

  it('the sample article follows the onboarding gate, and its tour link opens the Notebook with the tour', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    renderSupport()
    fireEvent.click(await quickAnswer(SAMPLE_Q))
    expect(screen.getByText(/five example notes in a folder called "Sample notebook"/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Take the tour' })).toHaveAttribute('href', '/journal/notebook')
    // Go-live wave 1: the strip is gone; the article names the one door (the notes list's More menu row) -- and
    // still says plainly that deleting the folder is NOT it (its notes move to Unfiled), as final review M-8 asked.
    const article = screen.getByRole('button', { name: SAMPLE_Q }).parentElement
    expect(article).toHaveTextContent(
      'open More notebook actions (the three dots) on the notes list and choose Remove the sample notebook',
    )
    expect(article).toHaveTextContent('Deleting the folder alone keeps its notes: they move to Unfiled.')
    expect(article).not.toHaveTextContent(/strip/)
  })

  it('rendered: the share question is absent from the page with the gates off', async () => {
    latchNotebookFlags({ j2_share_links_enabled: false, notebook_publish_enabled: false, notebook_onboarding_enabled: false })
    renderSupport()
    await quickAnswer('How do I get started with the Notebook?')
    expect(screen.queryByRole('button', { name: SHARE_Q })).toBeNull()
    expect(screen.queryByRole('button', { name: SAMPLE_Q })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Take the tour' })).toBeNull()
  })
})

// Wave 14 (lane W14-0): Help > Walkthroughs, reading the tour registry.
describe('Walkthroughs (the tour registry\'s Help list)', () => {
  // W14-C1: task reminders is a kill switch that reads ON when a payload omits it, and its
  // tour is listed whenever it is on; these two cases pin it OFF to isolate the base tour.
  it('hidden while the onboarding gate is off', async () => {
    latchNotebookFlags({ notebook_task_reminders_enabled: false, notebook_onboarding_enabled: false })
    renderSupport()
    await quickAnswer('How do I get started with the Notebook?')
    expect(screen.queryByText('Walkthroughs')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Replay' })).toBeNull()
  })

  it('W14-C1 ruling: hidden while the wave-14 switch is off, even with onboarding on (Help as before wave 14)', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false, notebook_formulas_enabled: true })
    renderSupport()
    await quickAnswer('How do I get started with the Notebook?')
    expect(screen.queryByText('Walkthroughs')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Replay' })).toBeNull()
  })

  // S14 (audit 2026-11-05, detail #68): the verb now READS the seen-state -- Start for a tour never taken, Replay
  // for one taken (Support.whatsNew.test.jsx drives both). This member has no record, so it says Start.
  it('lists the base tour by name, with a Start link into the Notebook (never taken)', async () => {
    latchNotebookFlags({ notebook_task_reminders_enabled: false, notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
    renderSupport()
    await quickAnswer('How do I get started with the Notebook?')
    const heading = screen.getByText('Walkthroughs')
    const list = heading.parentElement
    expect(within(list).getByText('Notebook basics')).toBeInTheDocument()
    // Lane FIN-A11Y (review R4, M-14): every row said just "Replay", twenty links with one
    // name. The visible word stays; the link's NAME now says which tour it replays.
    const replay = within(list).getByRole('link', { name: 'Start the Notebook basics tour' })
    expect(replay).toHaveAttribute('href', '/journal/notebook')
    expect(replay).toHaveTextContent(/^Start$/)
    expect(within(list).queryByRole('link', { name: 'Start' })).toBeNull()
    const names = within(list).getAllByRole('link').map((a) => a.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the copy contract', () => {
  const EXPECTED = [
    'How do I get started with the Notebook?',
    'How do templates and the daily note work?',
    'How do I link notes together?',
    'How do I organize notes with folders, tags and archive?',
    'How do I search my notes and jump between them?',
    'What can Ask your notebook answer?',
    'How do I save pages from the web or my phone into the Notebook?',
    'Can I keep PDFs and scanned documents in a note?',
    'How do I import notes from Notion, Obsidian or Evernote?',
    'How do I export my notes, and what does each format keep?',
    'Does the Notebook work offline, and what is a conflicted copy?',
    'Can I use the Notebook with a keyboard or a screen reader?',
    'What is the sample notebook, and how do I remove it?',
    'How do I share a note or publish it to the web?',
  ]

  it('every Notebook question, in order, rendered first for a member who came from the Notebook', async () => {
    latchNotebookFlags({ j2_share_links_enabled: true, notebook_publish_enabled: true, notebook_onboarding_enabled: true })
    renderSupport('/journal/notebook/abc')
    await quickAnswer(EXPECTED[0])
    const listed = screen.getAllByRole('button', { expanded: false }).map((b) => b.textContent.trim())
    const firstNotebook = listed.indexOf(EXPECTED[0])
    expect(listed.slice(firstNotebook, firstNotebook + EXPECTED.length)).toEqual(EXPECTED)
    expect(firstNotebook).toBe(listed.findIndex((t) => EXPECTED.includes(t)))
    // contextual: the Notebook's articles lead the Quick answers
    const others = FAQS.filter((f) => f.topic !== 'notebook').map((f) => f.q)
    expect(listed.findIndex((t) => others.includes(t))).toBeGreaterThan(firstNotebook)
  })

  it('the sentences a member acts on, rendered', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    renderSupport()
    const read = async (q) => {
      fireEvent.click(await quickAnswer(q))
      return screen.getByRole('button', { name: q }).parentElement.textContent
    }
    expect(await read('How do I search my notes and jump between them?')).toContain('open the quick switcher — ⌘ K on a Mac, Ctrl K elsewhere')
    const kb = await read('Can I use the Notebook with a keyboard or a screen reader?')
    expect(kb).toContain('Press ? in the Journal to see every keyboard shortcut.')
    expect(kb).not.toMatch(/Ctrl|⌘|Cmd|Alt\+|Shift\+/)     // it never restates a chord
    const exp = await read('How do I export my notes, and what does each format keep?')
    for (const f of ['Markdown', 'Web page (HTML)', 'JSON', 'Word (.docx)']) expect(exp).toContain(f)
    // Final fix (C5): Print is inside the note's Export menu now.
    expect(exp).toContain('For a PDF, open Export, choose Print, then Save as PDF.')
    // Final fix (C5): Trash and Archived sit under the folders panel's "More" fold.
    expect(await read('How do I organize notes with folders, tags and archive?')).toContain('Trash and Archived are under More in the folders panel.')
    expect(await read('What is the sample notebook, and how do I remove it?')).toContain('move to Trash (under More in the folders panel)')
    expect(await read('Does the Notebook work offline, and what is a conflicted copy?')).toContain('(conflicted copy)')
    expect(await read('What can Ask your notebook answer?')).toContain("Ask says it couldn't find it rather than guessing.")
    // Simplify pass 2 (A5): a template is called a template, never "a layout".
    const tpl = await read('How do templates and the daily note work?')
    expect(tpl).toContain('to start a note from a template: a thesis, a daily note and more.')
    expect(tpl).not.toMatch(/\blayout/i)
  })

})

describe('votes work with the new ids', () => {
  it('a vote on a Notebook article reaches the endpoint under its id, and counts', async () => {
    renderSupport()
    fireEvent.click(await quickAnswer('How do I get started with the Notebook?'))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, this was helpful' }))
    await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => u === '/api/auth/faq-vote/notebook-getting-started')).toBe(true))
    const [, init] = global.fetch.mock.calls.find(([u]) => u === '/api/auth/faq-vote/notebook-getting-started')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ helpful: true })
    const row = screen.getByText('Was this helpful?').parentElement
    expect(within(row).getByRole('button', { name: 'Yes, this was helpful' })).toHaveTextContent('1')
  })
})

// ⛔ Audit 2026-11-05, spec S5 (B14): the Linking answer read "Unlinked mentionsshows notes ...".
// JSX drops a line break between a closing tag and the next word, so `</strong>` at a line's end
// glued itself to the word on the next line. Checked as RENDERED text for every answer on the page:
// an inline element is never glued to a word on either side.
describe('no answer glues a word to a bold, code or link (B14)', () => {
  const INLINE = new Set(['STRONG', 'CODE', 'KBD', 'EM', 'A', 'B', 'I'])
  const glued = (container) => {
    const out = []
    container.querySelectorAll('*').forEach((el) => {
      if (!INLINE.has(el.tagName)) return
      const next = el.nextSibling
      if (next?.nodeType === 3 && /^[A-Za-z0-9]/.test(next.textContent)) out.push(`${el.textContent}|${next.textContent.slice(0, 12)}`)
      const prev = el.previousSibling
      if (prev?.nodeType === 3 && /[A-Za-z0-9]$/.test(prev.textContent) && !/^\s/.test(el.textContent)) {
        out.push(`${prev.textContent.slice(-12)}|${el.textContent}`)
      }
    })
    return out
  }

  it('the Linking answer says "Unlinked mentions shows"', () => {
    const faq = FAQS.find((f) => f.id === 'notebook-linking-notes')
    const { container } = render(<MemoryRouter><div>{faq.a}</div></MemoryRouter>)
    expect(container.textContent).toContain('Unlinked mentions shows notes')
  })

  it('every answer, every topic', () => {
    const bad = []
    for (const f of FAQS) {
      if (!f.a || typeof f.a === 'string') continue
      const { container, unmount } = render(<MemoryRouter><div>{f.a}</div></MemoryRouter>)
      for (const g of glued(container)) bad.push(`${f.id}: ${g}`)
      unmount()
    }
    expect(bad).toEqual([])
  })
})

// S14 (audit 2026-11-05): the Help menu's landings and the in-feature "?" (HelpAnswerLink.jsx) land on Quick answers.
describe('Quick answers: Help landings (S14)', () => {
  const renderAt = (hash) => render(
    <AuthContext.Provider value={{ user: { id: 'u1', email: 'm@local.dev' }, plan: 'pro', isPaid: true }}>
      <MemoryRouter initialEntries={[{ pathname: '/support', hash }]}>
        <Support />
      </MemoryRouter>
    </AuthContext.Provider>,
  )

  it('#answer-<id> opens THAT answer and puts focus on its question', async () => {
    renderAt('#answer-notebook-import')
    const q = await screen.findByRole('button', { name: 'How do I import notes from Notion, Obsidian or Evernote?' })
    await waitFor(() => expect(q).toHaveAttribute('aria-expanded', 'true'))
    await waitFor(() => expect(document.activeElement).toBe(q))
    expect(q.closest('[id]').id).toBe('answer-notebook-import')
    // CONTROL: only that one is open
    expect(screen.getByRole('button', { name: 'How do I link notes together?' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('an unknown answer id opens nothing (never a wrong answer)', async () => {
    renderAt('#answer-nope')
    await quickAnswer('How do I link notes together?')
    expect(screen.queryAllByRole('button', { expanded: true }).filter((b) => b.closest('[id^="answer-"]'))).toEqual([])
  })

  it('#help-search focuses Search help, which filters the answers and says so when nothing matches', async () => {
    const user = userEvent.setup()
    renderAt('#help-search')
    const box = await screen.findByRole('searchbox', { name: 'Search help' })
    await waitFor(() => expect(document.activeElement).toBe(box))
    await user.type(box, 'export formats')
    expect(screen.getByRole('button', { name: 'How do I export my notes, and what does each format keep?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'How do I link notes together?' })).toBeNull()
    await user.clear(box)
    await user.type(box, 'zzqqxx')
    expect(screen.getAllByRole('status').some((s) => /No answer matches/.test(s.textContent))).toBe(true)
    // review Important 3: the sentence's "open a ticket" is the door to the new-ticket form
    expect(screen.getByRole('link', { name: 'open a ticket' })).toHaveAttribute('href', '/support?view=new')
  })

  it('#quick-answers focuses the Quick answers heading', async () => {
    renderAt('#quick-answers')
    const h = await screen.findByRole('heading', { level: 2, name: 'Quick answers' })
    await waitFor(() => expect(document.activeElement).toBe(h))
  })
})
