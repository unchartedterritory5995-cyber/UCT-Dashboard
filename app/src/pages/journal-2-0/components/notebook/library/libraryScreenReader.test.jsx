// The Template library and its detail sheet as a screen reader meets them (WebKit + axe walk, 2026-10-27; axe was
// clean, these are the announcement-quality findings it cannot score):
//   1. a TAP-opened detail gives focus back to the card's Preview button on close (WebKit never focuses a tapped
//      button, so the Sheet's own record was the New note panel);
//   2. a card says its title as its heading and inside its one action, never a third time as a named group;
//   3. the detail's two dismiss buttons have two names (the header x is "Close", the footer is "Cancel").
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react'
import TemplateLibrarySection, { SECTION_TITLE } from './TemplateLibrarySection'
import TemplateDetailSheet, { CANCEL_LABEL } from './TemplateDetailSheet'

vi.mock('./openAdoptSheet', () => ({ openAdoptSheet: vi.fn(() => () => {}) }))

const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
const row = (o) => ({ description: '', category: 'journal', author: 'UCT', itemType: 'style', usedBy: 0,
  helpfulCount: 0, contains: [], inYourTemplates: false, ...o })
const LIB = [
  row({ id: 'g-night', title: 'Night-before prep', group: 'night_before' }),
  row({ id: 'g-recap', title: 'Daily recap', group: 'after_close' }),
]

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    if (u.pathname === '/api/j2/template-gallery/library' && method === 'GET') return json(200, { templates: LIB })
    if (u.pathname.endsWith('/preview-mine')) return json(200, { slots: [], cards: [], tools: [], questions: [] })
    const m = u.pathname.match(/^\/api\/j2\/template-gallery\/([^/]+)$/)
    if (m && method === 'GET') return json(200, { template: { id: m[1], bodyJson: { type: 'doc', content: [] } } })
    return json(404, {})
  })
})
afterEach(cleanup)

const frames = (n = 3) => act(() => new Promise((resolve) => {
  const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve())
  step(n)
}))
const card = (id) => document.querySelector(`[data-library-card="${id}"]`)
const previewOf = (id) => within(card(id)).getByRole('button', { name: /^Preview / })

/** The section inside a stand-in for the New note sheet's panel, which holds focus the way the real one does. */
async function mount() {
  render(<div role="dialog" aria-label="New note" tabIndex={-1} data-testid="picker"><TemplateLibrarySection /></div>)
  await screen.findByRole('heading', { name: SECTION_TITLE })
  await waitFor(() => expect(card('g-night')).not.toBeNull())
}
const detail = () => screen.getByRole('dialog', { name: 'Night-before prep' })

describe('1. focus after a TAP-opened detail closes', () => {
  /** WebKit's tap: focus stays on the picker; the click lands on the Preview button without focusing it. */
  async function tapOpen() {
    await mount()
    screen.getByTestId('picker').focus()
    fireEvent.click(previewOf('g-night'))
    await frames()
    expect(detail()).toBeInTheDocument()
    expect(document.activeElement).not.toBe(previewOf('g-night'))   // non-vacuity: the tap did not focus it
  }

  it('the header x gives focus back to the Preview button', async () => {
    await tapOpen()
    fireEvent.click(within(detail()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Night-before prep' })).toBeNull()
    expect(document.activeElement).toBe(previewOf('g-night'))
  })

  it('Escape and the footer Cancel do too', async () => {
    await tapOpen()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(previewOf('g-night'))
    screen.getByTestId('picker').focus()
    fireEvent.click(previewOf('g-night'))
    await frames()
    fireEvent.click(within(detail()).getByRole('button', { name: CANCEL_LABEL }))
    expect(document.activeElement).toBe(previewOf('g-night'))
  })

  it('CONTROL: a keyboard open (the button focused first) also lands back on that button', async () => {
    await mount()
    previewOf('g-recap').focus()
    fireEvent.click(previewOf('g-recap'))
    await frames()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(previewOf('g-recap'))
  })
})

describe('2. a card says its title twice at most: its heading, then its action', () => {
  it('no named group wraps the Preview button; the heading and the button are the title\'s only two holders', async () => {
    await mount()
    const c = card('g-night')
    expect(within(c).queryAllByRole('group')).toHaveLength(0)
    expect(within(c).getByRole('heading', { level: 5, name: 'Night-before prep' })).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Preview Night-before prep, from the Template library' }))
      .toBeInTheDocument()
    // Nothing else in the card is NAMED by the title (aria-labelledby pointing at the heading, or an aria-label).
    const headingId = within(c).getByRole('heading', { level: 5 }).id
    const namedByTitle = [...c.querySelectorAll('[aria-labelledby], [aria-label]')]
      .filter((el) => (el.getAttribute('aria-labelledby') || '').split(' ').includes(headingId)
        || (el.getAttribute('aria-label') || '').includes('Night-before prep'))
    expect(namedByTitle.map((el) => el.tagName)).toEqual(['BUTTON'])
  })

  it('CONTROL: the group headings and their named lists are untouched (the page\'s outline relies on them)', async () => {
    await mount()
    expect(screen.getAllByRole('heading', { level: 4 }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('list').some((l) => l.getAttribute('aria-labelledby'))).toBe(true)
  })
})

describe('3. the detail sheet\'s dismiss buttons are distinguishable', () => {
  it('exactly one "Close" (the header x) and one "Cancel" (the footer), and both close', async () => {
    const onClose = vi.fn()
    render(<TemplateDetailSheet item={{ id: 'g-night', title: 'Night-before prep' }} onClose={onClose} />)
    const dlg = await screen.findByRole('dialog', { name: 'Night-before prep' })
    expect(within(dlg).getAllByRole('button', { name: 'Close' })).toHaveLength(1)
    expect(within(dlg).getAllByRole('button', { name: CANCEL_LABEL })).toHaveLength(1)
    const names = within(dlg).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.trim())
    expect(new Set(names).size).toBe(names.length)                    // every button in the sheet has its own name
    fireEvent.click(within(dlg).getByRole('button', { name: CANCEL_LABEL }))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
