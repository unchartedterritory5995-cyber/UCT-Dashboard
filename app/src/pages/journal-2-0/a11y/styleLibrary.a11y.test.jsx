// app/src/pages/journal-2-0/a11y/styleLibrary.a11y.test.jsx
//
// P3a Task 9: the community STYLE library through 8A's axe harness (the ONE way a Notebook rail asks
// axe-core). The gallery recipes in templateGallery.a11y.test.jsx run with the library switch OFF, so
// they never render these components -- hence recipes of their own rather than a `coveredBy` entry
// that would be untrue. Each recipe proves the state it is about rendered before axe runs:
//   * style-library-card   -- the Styles view: a style card with its Adopt confirm open;
//   * style-library-author -- an author's page with its Follow toggle and their items.
// Task 11 adds the library's remaining surfaces (telemetry, the walk) to this file.
// The fake server answers with the recorded contract fixtures (`__fixtures__/contract`).
import { describe, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import TemplateGallery from '../components/notebook/TemplateGallery'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contractBody } from '../__fixtures__/contract'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const STYLES = contractBody('template-gallery.list.styles').templates
const STYLE = STYLES[0]
const PAGE = contractBody('template-gallery.authors.page')

function stub() {
  global.fetch = vi.fn((url) => {
    const u = new URL(String(url), 'http://x')
    if (u.pathname === '/api/j2/template-gallery') {
      const picks = u.searchParams.get('section') === 'picks'
      return json({ templates: STYLES.filter((t) => !picks || t.featured), viewer: { admin: false } })
    }
    if (u.pathname === `/api/j2/template-gallery/authors/${PAGE.author.handle}`) return json(PAGE)
    return json({ detail: 'Not found' }, 404)
  })
}

function renderGallery() {
  const user = userEvent.setup()
  render(
    <Providers>
      <TemplateGallery onBack={() => {}} initialType="style" />
    </Providers>,
  )
  return user
}

describe('P3a surfaces (community style library)', () => {
  beforeEach(() => {
    stub()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_template_gallery_enabled: true, notebook_style_library_enabled: true })
  })
  afterEach(() => { __resetNotebookFlags() })

  axeSurface('style-library-card', async () => {
    const user = renderGallery()
    await screen.findByRole('heading', { name: STYLE.title })
    screen.getByRole('group', { name: 'Filter by trading style' })
    await user.click(screen.getByRole('button', { name: `Adopt ${STYLE.title}` }))
    within(screen.getByRole('group', { name: `Adopt ${STYLE.title}?` }))
      .getByRole('checkbox', { name: 'Notify me when the author updates' })
    await settle()
  })

  axeSurface('style-library-author', async () => {
    const user = renderGallery()
    await screen.findByRole('heading', { name: STYLE.title })
    await user.click(screen.getByRole('button', { name: `See styles by ${STYLE.author}` }))
    await screen.findByRole('heading', { name: PAGE.author.label })
    screen.getByRole('button', { name: `Follow ${PAGE.author.label}` })
    await settle()
  })
})
