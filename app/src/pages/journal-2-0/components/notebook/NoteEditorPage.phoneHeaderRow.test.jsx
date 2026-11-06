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
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import editorStyles from './NoteEditorPage.module.css'

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
export function headerRowBudget({ editorCss, tabCss, layoutCss, tokensCss, width, count = 4 }) {
  const vars = {}
  for (const [, n, v] of tokensCss.matchAll(/(--tap-min|--space-sm):\s*([\d.]+px)/g)) if (!(n in vars)) vars[n] = parseFloat(v)
  const ed = rulesAt(editorCss, width)
  const tab = rulesAt(tabCss, width)
  // Review 4: the gutter through the cascade at this width, so a phone override of `--page-pad-x` is read.
  const gutter = px(effective(rulesAt(layoutCss, width), '.root', '--page-pad-x'), vars)
  const reserve = px(effective(tab, '.wrap[data-note-open] .mainNote [data-note-header]', 'padding-left'), vars)
  const padRight = px((effective(ed, '.header', 'padding') || '').split(/\s+/)[1], vars)
  const gap = px(effective(ed, '.headerControls', 'gap'), vars)
  // The phone rule is `.headerControls .aiGroup` (0,2,0): the bare `.aiGroup` is declared after the phone block, so a
  // bare phone rule would lose. Specificity, then source order: the compound selector wins wherever it applies.
  const aiGap = px(effective(ed, '.headerControls .aiGroup', 'gap') ?? effective(ed, '.aiGroup', 'gap'), vars)
  const control = px(effective(ed, '.chromeBtn', 'min-width'), vars)
  // `count` is the controls a phone shows in the row (Favorite · AI · Share · ⋯ today). The render half below COUNTS them
  // in a rendered editor and passes the number in, so a fifth control cannot pass by being left out of the sum.
  // Review 3: transient items (`chromeMsg`, the SaveFailed lines) are NOT in the row on a phone: `.headerMsg` takes a
  // line of its own (railed below), so they are excluded here on purpose.
  const controls = count * control + (count - 1) * gap + aiGap
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

  it('the save indicator is on the line under the title on a phone, in a box that holds Saved and Saving… alike', () => {
    // Review 2: a reserved width, so "Saved" <-> "Saving…" never wraps and unwraps the details line while typing.
    const ed = rulesAt(SHEETS().editorCss, 390)
    expect(effective(ed, '.savedLine', 'min-width')).toBe('4.5em')
    expect(effective(ed, '.savedLine', 'text-align')).toBe('right')
    expect(effective(ed, '.savedLine', 'margin-left')).toBe('auto')
  })

  it('a header message takes a line of its own on a phone, never a place in the row (review 3)', () => {
    const ed = rulesAt(SHEETS().editorCss, 390)
    expect(effective(ed, '.headerControls .headerMsg', 'flex-basis')).toBe('100%')
    expect(effective(ed, '.headerControls .headerMsg', 'order')).toBe('3')
    // ...and above a phone the rule does not apply (the desktop row is unchanged)
    expect(effective(rulesAt(SHEETS().editorCss, 1200), '.headerControls .headerMsg', 'flex-basis')).toBeNull()
    // every message the header can show wears the class: chromeMsg and the three SaveFailed lines
    const jsx = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx'), 'utf8')
    const header = jsx.slice(jsx.indexOf('data-tour="ask-row"'), jsx.indexOf('data-tour="note-export"'))
    expect(header.match(/<SaveFailed [^\n]*\/>/g)).toHaveLength(3)
    for (const sf of header.match(/<SaveFailed [^\n]*\/>/g)) expect(sf).toContain('className={styles.headerMsg}')
    expect(header).toMatch(/className=\{`\$\{styles\.chromeMsg\} \$\{styles\.headerMsg\}`\}/)
  })

  it('⭐ CONTROL -- the budget reads the cascade: the pre-batch phone CSS (8 px gaps, the AI gap) does NOT fit', () => {
    // Review 7: the old phone rules spliced back out of the REAL stylesheet, so the base `.headerControls` gap (8) and
    // the bare `.aiGroup` gap (4) are what the reader finds -- 104 + 176 + 24 + 4 + 12 = 320 > 312.
    const sheets = SHEETS()
    const old = sheets.editorCss
      .replace(/\.headerControls\s*\{\s*gap:\s*4px;[^}]*\}/, '')
      .replace(/\.headerControls \.aiGroup\s*\{\s*gap:\s*0;\s*\}/, '')
    // non-vacuity: BOTH rules were found in the real stylesheet and removed
    expect(/\.headerControls\s*\{\s*gap:\s*4px;[^}]*\}/.test(sheets.editorCss)).toBe(true)
    expect(/\.headerControls \.aiGroup\s*\{\s*gap:\s*0;\s*\}/.test(sheets.editorCss)).toBe(true)
    const b = headerRowBudget({ ...sheets, editorCss: old, width: 360 })
    expect(b).toMatchObject({ gap: 8, aiGap: 4 })
    expect(b.fits, JSON.stringify(b)).toBe(false)
    // ...and a fifth control does not fit either: the count is a real term
    expect(headerRowBudget({ ...sheets, width: 360, count: 5 }).fits).toBe(false)
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
// Review 1: the hook's answer is switchable, so a test can open the note from LOADING to loaded.
const { LOAD } = vi.hoisted(() => ({ LOAD: { loading: false } }))
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: LOAD.loading ? null : NOTE, isLoading: LOAD.loading, update: vi.fn(async (p) => ({ ...NOTE, ...p })), refresh: vi.fn() }),
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
  LOAD.loading = false
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

describe('the row the phone draws, counted (review 4)', () => {
  // The controls a phone SHOWS in the header row: real buttons, not inside a closed panel (`[hidden]`), not the Ask
  // toggle and not a `.phoneInMore` item (both `display: none` in the phone block), not a header message.
  const phoneVisibleControls = () => [...header().querySelectorAll('[data-tour="ask-row"] button')].filter((el) =>
    !el.closest('[hidden]') && !el.closest('[data-ask-toggle]') && !el.closest(`.${editorStyles.phoneInMore}`)
    && !el.closest(`.${editorStyles.headerMsg}`))

  it('counts the controls the phone shows and the budget fits THAT count at 360 and 390 px', async () => {
    await renderAt(390)
    const n = phoneVisibleControls().length
    expect(n, phoneVisibleControls().map((b) => b.getAttribute('aria-label')).join(', ')).toBe(4)
    for (const w of [360, 390]) expect(headerRowBudget({ ...SHEETS(), width: w, count: n }).fits, `${w}`).toBe(true)
  })

  it('CONTROL: the count sees a control dropped into the row', async () => {
    await renderAt(390)
    const stray = document.createElement('button')
    header().querySelector('[data-tour="ask-row"]').appendChild(stray)
    expect(phoneVisibleControls()).toHaveLength(5)
    expect(headerRowBudget({ ...SHEETS(), width: 360, count: 5 }).fits).toBe(false)
    stray.remove()
  })
})

describe('the save indicator mounts EMPTY when the note arrives (review 1)', () => {
  // A live region that arrives already holding words is often not announced. The region must be inserted empty and
  // filled by a later commit -- on an open that goes LOADING -> loaded, which is every real open.
  async function openFromLoading(w) {
    width = w
    LOAD.loading = true
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    const ui = <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>
    const { rerender } = render(ui)
    expect(document.querySelector('[data-save-indicator]')).toBeNull() // still loading: no region yet
    // Record the region's text AT INSERTION (inside React's commit, before any effect can fill it): a DOM insert
    // spy, because a MutationObserver reports after the commit, when the words may already be there.
    const origAppend = Node.prototype.appendChild
    const origInsert = Node.prototype.insertBefore
    const snap = []
    const watch = (node) => {
      if (node?.nodeType === 1) {
        const region = node.matches('[data-save-indicator]') ? node : node.querySelector('[data-save-indicator]')
        if (region) snap.push(region.textContent)
      }
    }
    Node.prototype.appendChild = function (n) { watch(n); return origAppend.call(this, n) }
    Node.prototype.insertBefore = function (n, r) { watch(n); return origInsert.call(this, n, r) }
    try {
      LOAD.loading = false
      await act(async () => { rerender(ui) })
    } finally {
      Node.prototype.appendChild = origAppend
      Node.prototype.insertBefore = origInsert
    }
    await screen.findByPlaceholderText('Title')
    await waitFor(() => expect(document.querySelector('[data-save-indicator]')?.textContent).toBe('Saved'))
    return snap
  }

  it.each([390, 1440])('at %i px the region is inserted with no words, then says "Saved"', async (w) => {
    const snap = await openFromLoading(w)
    expect(snap.length).toBeGreaterThan(0)
    expect(snap[0]).toBe('')
  })
})
