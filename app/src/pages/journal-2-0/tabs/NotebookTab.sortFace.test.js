// VIS-6 (live finding, production 390x844): the list's sort select drew "Updated" far larger than the
// "All notes" and "View: List" dropdowns beside it. Cause: tokens.css's touch-tier
// `input, select, textarea { font-size: 16px !important }`, which stops iOS zooming on focus.
//
// The fix keeps the select at 16 px (no zoom) and, on the touch tier, makes it a transparent layer over a
// FACE drawn with the very classes the View trigger wears. jsdom does no layout, so this rail reads the
// sources: the face's classes equal View's, the face is aria-hidden, the select keeps its name, and at
// <=1024 px the select is the invisible full-cover layer while above it the face is not drawn.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const JSX = readFileSync(join(SRC, 'pages/journal-2-0/tabs/NotebookTab.jsx'), 'utf8')
const CSS = strip(readFileSync(join(SRC, 'pages/journal-2-0/tabs/NotebookTab.module.css'), 'utf8'))
const TOKENS = strip(readFileSync(join(SRC, 'styles/tokens.css'), 'utf8'))

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

describe('the sort dropdown matches View and Folders on the touch tier', () => {
  const { inTouch, top } = rules(CSS)

  it('the face wears the View trigger\'s own classes, and is hidden from assistive tech', () => {
    const view = /<button \{\.\.\.viewMenu\.triggerProps\} type="button" className=\{`([^`]+)`\}/.exec(JSX)
    const face = /<span className=\{`([^`]+)`\} aria-hidden="true" data-sort-face="">/.exec(JSX)
    expect(view && face).toBeTruthy()
    const classes = (s) => s.replace(/\$\{styles\.sortFace\}/, '').trim().split(/\s+/).sort()
    expect(classes(face[1])).toEqual(classes(view[1]))
  })

  it('the select is still the control: named, and the only thing that changes the sort', () => {
    const wrap = JSX.slice(JSX.indexOf('data-sort-wrap'), JSX.indexOf('</select>'))
    expect(wrap).toMatch(/<select\s+className=\{styles\.sortSelect\}/)
    expect(wrap).toMatch(/aria-label="Sort notes"/)
    expect(wrap).toMatch(/onChange=\{\(e\) => setSort\(e\.target\.value\)\}/)
  })

  it('at <=1024 px the select is a transparent layer over the whole face; the face draws, and lets taps through', () => {
    const layer = inTouch['.sortWrap > .sortSelect']
    expect(decl(layer, 'opacity')).toBe('0')
    expect(decl(layer, 'position')).toBe('absolute')
    expect(decl(layer, 'inset')).toBe('0')
    expect(decl(inTouch['.sortWrap'], 'position')).toBe('relative')
    expect(decl(inTouch['.sortFace'], 'display')).toBe('inline-flex')
    expect(decl(inTouch['.sortFace'], 'pointer-events')).toBe('none')
    // a keyboard member still sees where focus is
    expect(decl(inTouch['.sortWrap:focus-within > .sortFace'], 'outline')).toMatch(/2px solid var\(--ut-gold\)/)
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
