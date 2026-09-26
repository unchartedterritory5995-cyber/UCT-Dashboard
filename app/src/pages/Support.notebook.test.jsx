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
import { MemoryRouter } from 'react-router-dom'
import Support, { FAQS, inferSourceTopic, visibleFaqs } from './Support'
import { AuthContext } from '../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from './journal-2-0/lib/offline/notebookFlags'

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
const HELPERS = ['TourLink', 'ShareLinkSentence', 'PublishSentence']
function notebookLinks() {
  const links = []
  const collect = (node) => visit(node, (n) => {
    if (n.type === 'JSXElement' && n.openingElement.name?.name === 'Link') links.push(literal(attr(n, 'to')))
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
  })

  it('publishing alone: the article shows, with the publish sentence only', async () => {
    latchNotebookFlags({ j2_share_links_enabled: false, notebook_publish_enabled: true })
    renderSupport()
    fireEvent.click(await quickAnswer(SHARE_Q))
    const a = screen.getByText(/Use the share button in a note's toolbar/).closest('div')
    expect(a).toHaveTextContent('Publish to the web turns the note into a public page.')
    expect(a).not.toHaveTextContent('Share link makes')
  })

  it('the sample article follows the onboarding gate, and its tour link opens the Notebook with the tour', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    renderSupport()
    fireEvent.click(await quickAnswer(SAMPLE_Q))
    expect(screen.getByText(/five example notes in a folder called "Sample notebook"/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Take the tour' })).toHaveAttribute('href', '/journal/notebook')
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
    expect(exp).toContain('For a PDF, choose Print, then Save as PDF.')
    expect(await read('Does the Notebook work offline, and what is a conflicted copy?')).toContain('(conflicted copy)')
    expect(await read('What can Ask your notebook answer?')).toContain("Ask says it couldn't find it rather than guessing.")
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
