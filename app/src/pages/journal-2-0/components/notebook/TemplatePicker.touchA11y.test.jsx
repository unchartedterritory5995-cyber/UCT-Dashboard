// The template picker on a touch screen, and its outline (WebKit + axe walk, 2026-10-27):
//   4. the search box's "Up and Down choose a template. Enter opens it." and the live line's "Enter opens Blank
//      note." are keyboard words a VoiceOver/TalkBack member cannot act on. On a coarse pointer the hint is not
//      drawn and the live line says how many templates the search or chip left ("3 templates.");
//   5. the built-in family labels ("Around a trade") and "Your templates" are h3 headings, peers of the Template
//      library's h3, so heading navigation reaches them. The keyboard half is the control: unchanged.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'

// The touch live line's words (TemplatePicker's own `touchMatchWords`, kept private so the module exports only
// what it already did): "1 template." / "<n> templates."
const touchMatchWords = (n) => (n === 1 ? '1 template.' : `${n} templates.`)
import { loadTemplates } from '../../lib/templatesLoader'
import { FAMILIES, templatesByFamily } from '../../lib/notebookTemplates'

const coarse = vi.hoisted(() => ({ on: false }))
vi.mock('../../../../hooks/useBreakpoint', async (orig) => ({
  ...(await orig()), useHasCoarsePointer: () => coarse.on,
}))

beforeAll(() => loadTemplates())
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
})
afterEach(() => { cleanup(); coarse.on = false })

const live = () => document.querySelector('[data-template-search-status]').textContent
const box = () => screen.getByRole('searchbox', { name: 'Search templates' })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const realCards = () => document.querySelectorAll('[data-template-card]:not([data-template-anchor])').length

function mount() {
  render(<MemoryRouter><TemplatePicker onPick={() => {}} onPickMember={() => {}} /></MemoryRouter>)
}

describe('4. touch: no keyboard words, a count instead', () => {
  it('the key hint is not drawn and not described; the live line is silent until the member filters', async () => {
    coarse.on = true
    mount()
    await settle()
    expect(screen.queryByText(/Up and Down choose a template/)).toBeNull()
    expect(box().getAttribute('aria-describedby')).toBeNull()
    expect(live()).toBe('')
    expect(document.body.textContent).not.toMatch(/Enter opens/)
  })

  it('a chip says how many templates it left, and a search says it too', async () => {
    coarse.on = true
    mount()
    await settle()
    const fam = FAMILIES.find((f) => templatesByFamily(f.key).length > 1)
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter templates by category' }))
      .getByRole('button', { name: fam.label }))
    await settle()
    expect(realCards()).toBe(templatesByFamily(fam.key).length)          // non-vacuity: the chip did filter
    expect(live()).toBe(touchMatchWords(templatesByFamily(fam.key).length))
    const one = templatesByFamily(fam.key)[0].label
    fireEvent.change(box(), { target: { value: one } })
    await settle()
    expect(realCards()).toBeGreaterThan(0)
    expect(live()).toBe(touchMatchWords(realCards()))
    expect(live()).not.toMatch(/Enter/)
  })

  it('CONTROL: a fine pointer keeps the key hint, its description and "Enter opens ..." exactly as before', async () => {
    mount()
    await settle()
    const hint = screen.getByText('Up and Down choose a template. Enter opens it.')
    expect(box().getAttribute('aria-describedby')).toBe(hint.id)
    fireEvent.focus(box())
    await settle()
    expect(live()).toMatch(/^Enter opens .+\.$/)
  })
})

describe('5. the picker outline: every family is a heading', () => {
  it('each built-in family label and "Your templates" is an h3 that still names its group', async () => {
    mount()
    await settle()
    for (const fam of FAMILIES.filter((f) => templatesByFamily(f.key).length)) {
      const h = screen.getByRole('heading', { level: 3, name: fam.label })
      expect(screen.getByRole('group', { name: fam.label }).getAttribute('aria-labelledby')).toBe(h.id)
    }
    expect(screen.getByRole('heading', { level: 3, name: 'Your templates' })).toBeInTheDocument()
  })
})
