/**
 * Wave 8 lane 8B, B3 — what the PUBLIC share page asks the network for, and what it tells a
 * crawler (findings F-BODY-LEAKS (a) and F-IN-PAGE-META of
 * docs/notebook/share-links-authorization-proof.md).
 *
 * ⛔ THE PAGE MAKES NO REQUEST BUT THE PAYLOAD. Every node the server's reducer lets through
 * is rendered here from a payload shaped exactly as `public_note_payload.reduce` (share mode)
 * emits it, and `fetch` is spied: the only call is `GET /api/j2/shared/{token}`. Images are
 * `<img>` loads of this note's proxied files, never `fetch`.
 *
 * ⭐ THE CONTROL PROVES THE SPY CAN SEE THE REQUEST THE REDUCTION PREVENTS. The same page given
 * a RAW `noteLink` node (what the stored body holds, before the reducer turns it into the
 * text "linked note") mounts `NoteLinkView`, which asks `/api/j2/notes/link-targets` with the
 * VIEWER's cookie. Without that control, "no extra request" could be a spy that sees nothing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SharedNotePage from './SharedNotePage'
import { SHARED_NOTE_ENDPOINT, SHARED_NOTE_ROUTE, sharedNotePath } from './lib/noteShareLink'
import { _resetNoteLinkTargetsBatchForTests } from './lib/noteLinkTargetsBatch'
import { PUBLIC_ROBOTS, PUBLIC_REFERRER } from './public/PublicPageMeta'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const TOKEN = 'tokPublicReq_9f'
const ATT = `/api/j2/shared/${TOKEN}/att/`
const NEUTRAL = 'A market-data item is not shown on public pages.'
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const p = (...content) => ({ type: 'paragraph', content })

/** What the server sends for a note holding one of nearly everything (share mode). */
const REDUCED_BODY = {
  type: 'doc',
  content: [
    p(t('My own words, '), t('bold', [{ type: 'bold' }]), t(' and '),
      t('an outside link', [{ type: 'link', attrs: { href: 'https://example.com/a' } }])),
    p(t('See the '), t('linked note'), t(' for the entry.')),
    p(t('As the answer said '), { type: 'askCitation', attrs: { n: 1 } }),
    { type: 'image', attrs: { src: `${ATT}inline/pic.png`, alt: 'my chart' } },
    { type: 'widgetEmbed', attrs: {
      v: 1, widgetId: 'fundamentals', mode: 'snapshot', capturedAt: '2026-09-01T12:00:00Z',
      params: { symbol: 'AAPL', view: 'quarterly' },
      fallback: { url: `${ATT}inline/fund.png`, w: 900, h: 300 }, caption: null,
      layout: { width: 'full', height: null } } },
    p(t(NEUTRAL)),
    p(t('AAPL · Analyst Price Target (Consensus): $212.50 (captured 2026-09-01)')),
    { type: 'askInsert', attrs: { insertedAt: '2026-09-25T09:41:00', scope: 'selection',
      question: 'Rewrite — shorter', action: 'rewrite', model: 'claude-sonnet-5' },
    content: [p(t('A tighter version.'))] },
  ],
}
const note = (bodyJson) => ({
  title: 'Public request census', subtitle: null, heroImageUrl: `${ATT}hero/h.png`,
  updatedAt: '2026-09-25T10:00:00Z', bodyJson,
})

const calls = []
let payload = null

beforeEach(() => {
  calls.length = 0
  payload = note(REDUCED_BODY)
  _resetNoteLinkTargetsBatchForTests()
  for (const m of document.head.querySelectorAll('meta[name="robots"], meta[name="referrer"]')) m.remove()
  vi.stubGlobal('fetch', vi.fn((url) => {
    calls.push(String(url))
    if (String(url).startsWith(`${SHARED_NOTE_ENDPOINT}/`)) {
      return payload
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ note: payload }) })
        : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not found' }) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ targets: {} }) })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  _resetNoteLinkTargetsBatchForTests()
})

function openPage(token = TOKEN) {
  return render(
    <MemoryRouter initialEntries={[sharedNotePath(token)]}>
      <Routes><Route path={SHARED_NOTE_ROUTE} element={<SharedNotePage />} /></Routes>
    </MemoryRouter>,
  )
}

/** Longer than noteLinkTargetsBatch's 30 ms window, so a queued lookup has fired. */
const settle = () => new Promise((r) => setTimeout(r, 150))

describe('the public share page asks for the payload and nothing else', () => {
  it('a reduced note renders, and the only request is the payload', async () => {
    openPage()
    await screen.findByTestId('shared-note')
    expect(screen.getByText(/linked note/)).toBeInTheDocument()
    expect(screen.getByText(NEUTRAL)).toBeInTheDocument()
    expect(screen.getByText(/Analyst Price Target \(Consensus\): \$212\.50/)).toBeInTheDocument()
    expect(await screen.findByText('Compass · Rewrite · claude-sonnet-5 · 09:41')).toBeInTheDocument()
    await settle()
    expect(calls).toEqual([`${SHARED_NOTE_ENDPOINT}/${TOKEN}`])
  })

  it('CONTROL: a RAW noteLink (what the reducer removes) makes the page ask link-targets', async () => {
    payload = note({ type: 'doc', content: [p(t('see '), { type: 'noteLink', attrs: { noteId: 'n-private-7' } })] })
    openPage()
    await screen.findByTestId('shared-note')
    await settle()
    expect(calls.some((u) => u.startsWith('/api/j2/notes/link-targets') && u.includes('n-private-7')),
      `the spy could not see the request the reduction exists to prevent: ${calls.join(', ')}`).toBe(true)
  })
})

describe('the page tells a crawler not to index it, in every state', () => {
  const metas = () => ({
    robots: document.head.querySelector('meta[name="robots"]')?.getAttribute('content'),
    referrer: document.head.querySelector('meta[name="referrer"]')?.getAttribute('content'),
  })

  it('the note itself', async () => {
    openPage()
    await screen.findByTestId('shared-note')
    expect(metas()).toEqual({ robots: PUBLIC_ROBOTS, referrer: PUBLIC_REFERRER })
    expect(PUBLIC_ROBOTS).toBe('noindex, nofollow')
    expect(PUBLIC_REFERRER).toBe('no-referrer')
  })

  it('a dead link', async () => {
    payload = null
    openPage('dead-token')
    const gone = await screen.findByTestId('shared-note-gone')
    expect(gone).toHaveTextContent('This link is no longer available.')
    expect(gone).toHaveTextContent('It may have expired, or the note may have been unshared or removed.')
    expect(metas()).toEqual({ robots: PUBLIC_ROBOTS, referrer: PUBLIC_REFERRER })
  })

  it('while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    openPage()
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading…')
    expect(metas()).toEqual({ robots: PUBLIC_ROBOTS, referrer: PUBLIC_REFERRER })
  })
})

describe('the read-only document is an article named by its title, not a nameless textbox', () => {
  // Measured in the real browser (evidence/wave8-8b-67c219fd1/run2): TipTap's default
  // role="textbox" on a read-only public document is an axe aria-input-field-name violation.
  it('the rendered document carries role=article and the note title as its name', async () => {
    openPage()
    await screen.findByTestId('shared-note')
    const doc = document.querySelector('.ProseMirror')
    expect(doc.getAttribute('role')).toBe('article')
    expect(doc).toHaveAccessibleName('Public request census')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('a keyboard user can see where focus is on the public page', () => {
  const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/SharedNotePage.module.css'), 'utf8')
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('no rule on the page removes the focus outline', () => {
    expect(rules).not.toMatch(/outline\s*:\s*(none|0)\b/)
  })

  it('links and the document show a visible ring on keyboard focus', () => {
    expect(rules).toMatch(/\.ProseMirror a:focus-visible\)/)
    expect(rules).toMatch(/\.ProseMirror:focus-visible\)/)
    expect(rules).toMatch(/outline:\s*2px solid var\(--accent\)/)
  })
})
