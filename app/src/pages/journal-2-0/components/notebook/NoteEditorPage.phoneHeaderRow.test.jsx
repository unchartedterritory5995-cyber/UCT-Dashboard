// Finish batch (audit 2026-11-05, iPhone): the phone note header is ONE row at 360 px and up.
//
// Measured on production before (Chromium, 390 x 844 and 360 x 844, bench member): back and Folders on the first row
// with "Saved", whose box was 186 px wide (`.savedIndicator`'s base `min-width: 15.5em` is declared AFTER the phone
// block, so the phone's own 5.5em never applied); Favorite, AI and Share (71 px) on a second row; More alone on a third.
// The header was 144 px tall and the title's top sat at y=336. With this change applied to the same page: one 61 px
// row at 360 and at 390, every control 44 x 44, and the title's top at y=253.
//
// ⛔ A STRUCTURAL RAIL, NOT THE VERDICT. jsdom lays nothing out, so this rail does the row's arithmetic from the
// declarations that size it (the cascade's EFFECTIVE value, base and phone rules in source order -- the trap that hid
// the 186 px), and renders the editor to prove the indicator and Share's word are where the arithmetic assumes. The
// verdict is a real browser at 360 and 390 px.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

const read = (rel) => readFileSync(join(process.cwd(), 'src', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The rules that apply at `width` px, in source order: base rules plus every `max-width` block that matches. */
export function rulesAt(css, width) {
  const out = []
  const walk = (text, applies) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const head = text.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      for (; j < text.length && depth > 0; j += 1) {
        if (text[j] === '{') depth += 1
        else if (text[j] === '}') depth -= 1
      }
      const inner = text.slice(open + 1, j - 1)
      if (head.startsWith('@media')) {
        const clauses = [...head.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)]
        const ok = clauses.length > 0 && clauses.every(([, k, n]) => (k === 'max' ? width <= +n : width >= +n))
        walk(inner, applies && ok)
      } else if (applies && !head.startsWith('@')) {
        out.push({ sels: head.split(',').map((s) => s.trim()), decls: inner })
      }
      i = j
    }
  }
  walk(css, true)
  return out
}

/** The effective value of `prop` (or its shorthand's part) for exactly `selector`: the LAST declaration wins. */
export function effective(rules, selector, prop) {
  let val = null
  for (const { sels, decls } of rules) {
    if (!sels.includes(selector)) continue
    for (const part of decls.split(';')) {
      const c = part.indexOf(':')
      if (c < 0) continue
      if (part.slice(0, c).trim() === prop) val = part.slice(c + 1).replace(/!important/, '').trim()
    }
  }
  return val
}

const px = (v, vars) => {
  if (v == null) return NaN
  const s = String(v).trim()
  if (/^0$/.test(s)) return 0
  let m = /^(-?[\d.]+)px$/.exec(s)
  if (m) return +m[1]
  m = /^var\((--[\w-]+)(?:,\s*[^)]+)?\)$/.exec(s)
  if (m) return vars[m[1]]
  m = /^calc\((.+)\)$/.exec(s)
  if (m) {
    const expr = m[1].replace(/var\((--[\w-]+)(?:,\s*[^)]+)?\)/g, (_, n) => String(vars[n])).replace(/px/g, '')
    if (!/^[\d\s.+*()-]+$/.test(expr)) return NaN
    return Function(`return (${expr})`)()
  }
  return NaN
}

/** The phone note header's width budget, from the stylesheets. `widthOk` is what the row needs at `width` px. */
export function headerRowBudget({ editorCss, tabCss, layoutCss, tokensCss, width }) {
  const vars = {}
  for (const [, n, v] of tokensCss.matchAll(/(--tap-min|--space-sm):\s*([\d.]+px)/g)) if (!(n in vars)) vars[n] = parseFloat(v)
  const ed = rulesAt(editorCss, width)
  const tab = rulesAt(tabCss, width)
  const gutter = px(/--page-pad-x:\s*([\d.]+px)/.exec(layoutCss)?.[1], vars)
  const reserve = px(effective(tab, '.wrap[data-note-open] .mainNote [data-note-header]', 'padding-left'), vars)
  const padRight = px((effective(ed, '.header', 'padding') || '').split(/\s+/)[1], vars)
  const gap = px(effective(ed, '.headerControls', 'gap'), vars)
  // The phone rule is `.headerControls .aiGroup` (0,2,0): the bare `.aiGroup` is declared after the phone block, so a
  // bare phone rule would lose. Specificity, then source order: the compound selector wins wherever it applies.
  const aiGap = px(effective(ed, '.headerControls .aiGroup', 'gap') ?? effective(ed, '.aiGroup', 'gap'), vars)
  const control = px(effective(ed, '.chromeBtn', 'min-width'), vars)
  // Favorite · AI (Writing help; Ask is not displayed on a phone, its slot leaves one empty node beside it) · Share · ⋯
  const controls = 4 * control + 3 * gap + aiGap
  const need = reserve + controls + padRight
  const room = width - 2 * gutter
  return { gutter, reserve, padRight, gap, aiGap, control, controls, need, room, fits: need <= room }
}

const SHEETS = () => ({
  editorCss: read('pages/journal-2-0/components/notebook/NoteEditorPage.module.css'),
  tabCss: read('pages/journal-2-0/tabs/NotebookTab.module.css'),
  layoutCss: read('pages/journal-2-0/JournalLayout.module.css'),
  tokensCss: read('styles/tokens.css'),
})

describe('the phone note header row fits ONE line at 360 and 390 px (structural)', () => {
  it.each([360, 390])('at %i px: back + Folders (104) + four 44 px controls + the right pad fit the Journal frame', (width) => {
    const b = headerRowBudget({ ...SHEETS(), width })
    // ⛔ NON-VACUITY: every term was read, none is NaN or a silent 0 where a size belongs.
    expect(b).toMatchObject({ gutter: 24, reserve: 104, control: 44, padRight: 12, gap: 4, aiGap: 0 })
    expect(b.need, JSON.stringify(b)).toBeLessThanOrEqual(b.room)
  })

  it('the save indicator is not a header item on a phone, so its reserved width is not in the row', () => {
    // its phone home is the line under the title (`.savedLine`, base rule: no reserved width)
    const ed = rulesAt(SHEETS().editorCss, 390)
    expect(effective(ed, '.savedLine', 'min-width')).toBeNull()
    expect(effective(ed, '.savedLine', 'margin-left')).toBe('auto')
  })

  it('⭐ CONTROL -- the arithmetic fails the old row (8 px gaps, a 4 px AI gap, the 186 px indicator)', () => {
    const b = headerRowBudget({ ...SHEETS(), width: 360 })
    const old = b.reserve + 4 * 44 + 3 * 8 + 4 + 12 + 186 + 12
    expect(old).toBeGreaterThan(b.room)
    // ...and the effective-value reader sees a later base rule beat an earlier phone rule (the trap).
    const css = '@media (max-width: 640px) { .x { min-width: 5.5em; } } .x { min-width: 15.5em; }'
    expect(effective(rulesAt(css, 390), '.x', 'min-width')).toBe('15.5em')
    expect(effective(rulesAt(css, 1200), '.x', 'min-width')).toBe('15.5em')
    const later = '.x { gap: 8px; } @media (max-width: 640px) { .x { gap: 4px; } }'
    expect(effective(rulesAt(later, 390), '.x', 'gap')).toBe('4px')
    expect(effective(rulesAt(later, 1200), '.x', 'gap')).toBe('8px')
  })
})

// ── The render half: the indicator and Share's word are where the arithmetic assumes ─────────────────────────────

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'Swing plan', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [P('First body line.')] },
}
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(async (p) => ({ ...NOTE, ...p })), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isPaid: true }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})

let width = 1200
let originalMatchMedia
beforeEach(() => {
  originalMatchMedia = window.matchMedia
  window.matchMedia = vi.fn((query) => {
    const clauses = [...String(query).matchAll(/\((max|min)-width:\s*(\d+)px\)/g)]
    const matches = clauses.length > 0 && clauses.every(([, k, n]) => (k === 'max' ? width <= +n : width >= +n))
    return { matches, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }
  })
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_writing_help_enabled: true, j2_share_links_enabled: true })
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => {
  window.matchMedia = originalMatchMedia
  __resetNotebookFlags()
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

async function renderAt(w) {
  width = w
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await waitFor(() => expect(document.querySelector('[data-save-indicator]')?.textContent).toBe('Saved'))
}
const header = () => document.querySelector('[data-note-header]')
const indicators = () => [...document.querySelectorAll('[data-save-indicator]')]

describe('where the indicator and Share\'s word are', () => {
  it('on a phone: ONE indicator, on the line under the title, not in the header', async () => {
    await renderAt(390)
    expect(indicators()).toHaveLength(1)
    expect(header().contains(indicators()[0])).toBe(false)
    expect(indicators()[0].closest('[data-note-details-line]')).not.toBeNull()
    expect(indicators()[0].getAttribute('role')).toBe('status')
  })

  it('CONTROL: above a phone the indicator stays in the header (tablet and desktop unchanged)', async () => {
    for (const w of [820, 1440]) {
      await renderAt(w)
      expect(indicators(), `${w}`).toHaveLength(1)
      expect(header().contains(indicators()[0]), `${w}`).toBe(true)
      expect(indicators()[0].closest('[data-note-details-line]')).toBeNull()
      document.body.innerHTML = ''
    }
  })

  it('Share is named "Share" and its word is the phone-hidden label (the icon shows on a phone)', async () => {
    await renderAt(390)
    const share = screen.getByRole('button', { name: 'Share' })
    expect(header().contains(share)).toBe(true)
    const word = [...share.querySelectorAll('span')].find((s) => s.textContent === 'Share')
    expect(word).toBeTruthy()
    // the same hidden-label class Writing help uses (`.phoneIconLabel`, declared in the phone block only)
    const wh = screen.getByRole('button', { name: 'Writing help' })
    const whLabel = [...wh.querySelectorAll('span')].find((s) => s.textContent === 'Writing help')
    expect(word.className).toBe(whLabel.className)
    expect(word.className).not.toBe('')
  })
})
