// VIS-6 (live finding, production 390x844): the list's sort select drew "Updated" far larger than the
// "All notes" and "View: List" dropdowns beside it. Cause: tokens.css's touch-tier
// `input, select, textarea { font-size: 16px !important }`, which stops iOS zooming on focus.
//
// The fix keeps the select at 16 px (no zoom) and, on the touch tier, makes it a transparent layer over a
// FACE drawn with the very classes the View trigger wears.
//
// Fix round 1 (review 10): the behaviour is railed on the RENDERED tab -- the face's classes equal the View
// trigger's, the face follows the select (the one value both read, review 9), the face is hidden from assistive
// tech and the select stays the named control. jsdom lays nothing out, so the touch-tier geometry, the
// keyboard-only ring and the hover (review 3) are read from the stylesheet.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'
import styles from './NotebookTab.module.css'

const SRC = join(process.cwd(), 'src')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = strip(readFileSync(join(SRC, 'pages/journal-2-0/tabs/NotebookTab.module.css'), 'utf8'))
const TOKENS = strip(readFileSync(join(SRC, 'styles/tokens.css'), 'utf8'))
const BUTTONS = strip(readFileSync(join(SRC, 'styles/buttons.css'), 'utf8'))

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function renderTab(route = '/journal/notebook?view=all') {
  installFetch([[/mapping-offer$/, { offer: null }]])
  render(<Providers auth={AUTH} route={route}><NotebookTab /></Providers>)
  await settle()
  return screen.getByRole('toolbar', { name: 'Notes list tools' })
}
const classSet = (el, drop = []) => [...el.classList].filter((c) => !drop.includes(c)).sort()

describe('the sort face, rendered', () => {
  it('wears exactly the View trigger\'s classes (plus its own hook), and is hidden from assistive tech', async () => {
    const bar = await renderTab()
    const view = within(bar).getByRole('button', { name: /^View:/ })
    const face = bar.querySelector('[data-sort-face]')
    expect(face).not.toBeNull()
    expect(classSet(face, [styles.sortFace])).toEqual(classSet(view))
    expect(face).toHaveAttribute('aria-hidden', 'true')
    // the same chevron, at the same size
    expect(face.querySelector('svg').getAttribute('width')).toBe(view.querySelector('svg').getAttribute('width'))
  })

  it('the select is still the control: named, and the face follows what it picks', async () => {
    const bar = await renderTab()
    const select = within(bar).getByRole('combobox', { name: 'Sort notes' })
    const face = bar.querySelector('[data-sort-face]')
    expect(face.textContent).toBe(select.selectedOptions[0].textContent)
    fireEvent.change(select, { target: { value: 'title' } })
    await settle()
    expect(select.value).toBe('title')
    expect(face.textContent).toBe('Title')
    expect(face.parentElement).toBe(select.parentElement) // the select lies over its own face
  })
})

/** `{ selector: body }` for the rules inside every `@media (max-width: 1024px)` block, and outside any block. */
function rules(css) {
  const inTouch = {}
  const top = {}
  let i = 0
  let depth = 0
  let media = null
  let sel = ''
  while (i < css.length) {
    const ch = css[i]
    if (ch === '{') {
      const head = sel.trim()
      if (head.startsWith('@media')) { media = head; sel = ''; i++; depth++; continue }
      const close = css.indexOf('}', i)
      const body = css.slice(i + 1, close)
      const into = media && /max-width:\s*1024px/.test(media) && !/min-width/.test(media) ? inTouch : (media ? null : top)
      if (into) for (const s of head.split(',').map((x) => x.trim())) into[s] = `${into[s] || ''};${body}`
      sel = ''
      i = close + 1
      continue
    }
    if (ch === '}') { depth--; if (depth === 0) media = null; sel = ''; i++; continue }
    sel += ch
    i++
  }
  return { inTouch, top }
}
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body || '')
  return m ? m[1].trim() : null
}

describe('the sort face, on the touch tier (stylesheet)', () => {
  const { inTouch, top } = rules(CSS)

  it('the select is a transparent layer over the whole face; the face draws and lets taps through', () => {
    const layer = inTouch['.sortWrap > .sortSelect']
    expect(decl(layer, 'opacity')).toBe('0')
    expect(decl(layer, 'position')).toBe('absolute')
    expect(decl(layer, 'inset')).toBe('0')
    expect(decl(inTouch['.sortWrap'], 'position')).toBe('relative')
    expect(decl(inTouch['.sortFace'], 'display')).toBe('inline-flex')
    expect(decl(inTouch['.sortFace'], 'pointer-events')).toBe('none')
  })

  it('fix round 1 (review 3): the ring is for KEYBOARD focus only, and never a bare :focus-within', () => {
    const ring = inTouch['.sortWrap:has(> .sortSelect:focus-visible) > .sortFace']
    expect(decl(ring, 'outline')).toMatch(/2px solid var\(--ut-gold\)/)
    expect(Object.keys(inTouch).filter((s) => /sortWrap:focus-within|sortFace:focus\b/.test(s))).toEqual([])
  })

  it('fix round 1 (review 3): hovering the sort lights the face exactly as View\'s btn-secondary hover does', () => {
    // Fix round 3 (R3): only for a pointer that hovers (a tap must not leave the face lit), so the rule sits in a
    // nested `@media (hover: hover)` inside the touch block, and nowhere outside it.
    const nested = /@media \(hover: hover\)\s*\{\s*\.sortWrap:hover > \.sortFace\s*\{([^}]*)\}/.exec(CSS)
    expect(nested, 'the hover rule inside @media (hover: hover)').toBeTruthy()
    expect(CSS.match(/\.sortWrap:hover > \.sortFace/g)).toHaveLength(1)
    const hover = nested[1]
    const btn = /\.btn-secondary:hover\s*\{([^}]*)\}/.exec(BUTTONS)[1]
    expect(decl(hover, 'background')).toBe(decl(btn, 'background'))
    expect(decl(hover, 'border-color')).toBe(decl(btn, 'border-color'))
  })

  it('above the touch tier the face is not drawn and the select is laid out as before', () => {
    expect(decl(top['.sortFace'], 'display')).toBe('none')
    expect(decl(top['.sortWrap'], 'display')).toBe('contents')
  })

  it('iOS still never zooms: the touch-tier 16 px rule stands, and nothing here sets the select smaller', () => {
    expect(TOKENS).toMatch(/@media \(max-width: 1024px\)\s*\{\s*input, select, textarea \{\s*font-size: 16px !important;/)
    for (const [s, body] of Object.entries(inTouch)) {
      if (!s.includes('sortSelect')) continue
      const fs = decl(body, 'font-size')
      if (fs) expect(Number.parseFloat(fs), s).toBeGreaterThanOrEqual(16)
    }
  })
})
