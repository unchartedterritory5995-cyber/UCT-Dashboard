// Wave 6 item 2 — the callout picker: five styles chosen from the callout's
// own control, drawn with UIcon (never an emoji), railed on a REAL editor and
// round-tripped through the REAL exporter and the REAL importer.
import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Editor, generateHTML, generateJSON } from '@tiptap/core'
import fs from 'node:fs'
import path from 'node:path'
import { buildExtensions } from './tiptap'
import { CALLOUT_VARIANTS, normalizeCalloutVariant } from './calloutNode'
import { ITEMS } from '../components/notebook/SlashMenu'
import { REPO_ROOT, exportMarkdownMany, importMarkdown, pythonAvailable } from './testing/exportBridge'

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const CALLOUT = (attrs, text = 'Watch the gap.') => ({ type: 'callout', attrs, content: [P(text)] })
const theCallout = (ed) => { let c = null; ed.state.doc.descendants((n) => { if (!c && n.type.name === 'callout') c = n }); return c }
const box = () => document.querySelector('[data-type="callout"]')
const pick = () => box().querySelector('button.uctCalloutPick')
const menu = () => box().querySelector('[role="group"][aria-label="Callout style"]')
const option = (label) => [...menu().querySelectorAll('button')].find((b) => b.textContent === label)

describe('the variant attribute', () => {
  it('parses data-variant, and refuses anything that is not one of the five', () => {
    const ext = buildExtensions()
    expect(generateJSON('<aside data-variant="warning">x</aside>', ext).content[0].attrs.variant).toBe('warning')
    expect(generateJSON('<aside data-variant="purple">x</aside>', ext).content[0].attrs.variant).toBe(null)
    expect(normalizeCalloutVariant('constructor')).toBe(null)
  })

  it('a styled callout\'s static HTML carries data-variant and NO emoji stand-in; an emoji callout keeps its emoji', () => {
    const ext = buildExtensions()
    const styled = generateHTML({ type: 'doc', content: [CALLOUT({ variant: 'info', emoji: '💡' })] }, ext)
    expect(styled).toContain('data-variant="info"')
    expect(styled).toMatch(/class="uctCalloutIcon"[^>]*><\/div>/)
    const emoji = generateHTML({ type: 'doc', content: [CALLOUT({ emoji: '🔥' })] }, ext)
    expect(emoji).not.toContain('data-variant')
    expect(emoji).toContain('🔥')
  })
})

describe('the callout\'s own control (node view)', () => {
  it('a styled callout draws its UIcon — an SVG, never an emoji — and names its style', () => {
    mount([CALLOUT({ variant: 'warning' })])
    expect(box().getAttribute('data-variant')).toBe('warning')
    expect(pick().getAttribute('aria-label')).toBe('Callout style: Warning')
    expect(pick().querySelector('svg')).toBeTruthy()
    expect(pick().textContent).toBe('')
  })

  it('an emoji callout (a Notion import) still shows the member\'s emoji', () => {
    mount([CALLOUT({ emoji: '🔥' })])
    expect(box().hasAttribute('data-variant')).toBe(false)
    expect(pick().textContent).toBe('🔥')
    expect(pick().getAttribute('aria-label')).toBe('Callout style: emoji')
  })

  it('opens the five styles, marks the current one, and a pick restyles THIS callout', () => {
    const ed = mount([CALLOUT({ variant: 'note' }), CALLOUT({ variant: 'info' }, 'other')])
    fireEvent.click(pick())
    expect(pick().getAttribute('aria-expanded')).toBe('true')
    expect([...menu().querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Note', 'Info', 'Success', 'Warning', 'Danger'])
    expect(option('Note').getAttribute('aria-pressed')).toBe('true')
    // each option draws its UIcon too
    expect([...menu().querySelectorAll('button')].every((b) => b.querySelector('svg'))).toBe(true)
    fireEvent.click(option('Danger'))
    expect(theCallout(ed).attrs.variant).toBe('danger')
    expect(box().getAttribute('data-variant')).toBe('danger')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(pick())
    // the OTHER callout is untouched
    const variants = []
    ed.state.doc.descendants((n) => { if (n.type.name === 'callout') variants.push(n.attrs.variant) })
    expect(variants).toEqual(['danger', 'info'])
  })

  it('an emoji callout can be given a style (and its emoji is kept in the document)', () => {
    const ed = mount([CALLOUT({ emoji: '🔥' })])
    fireEvent.click(pick())
    fireEvent.click(option('Success'))
    expect(theCallout(ed).attrs).toMatchObject({ variant: 'success', emoji: '🔥' })
    expect(pick().querySelector('svg')).toBeTruthy()
  })

  it('Escape closes the picker and hands focus back; so does a press outside it', () => {
    mount([CALLOUT({ variant: 'note' })])
    fireEvent.click(pick())
    fireEvent.keyDown(menu(), { key: 'Escape' })
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(pick())
    fireEvent.click(pick())
    fireEvent.mouseDown(document.body)
    expect(menu()).toBeNull()
  })

  it('arrow keys move between the styles', () => {
    mount([CALLOUT({ variant: 'note' })])
    fireEvent.click(pick())
    expect(document.activeElement).toBe(option('Note'))
    fireEvent.keyDown(menu(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(option('Info'))
    fireEvent.keyDown(menu(), { key: 'ArrowUp' })
    fireEvent.keyDown(menu(), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(option('Danger'))
  })

  it('a read-only editor (a locked note) offers no picker', () => {
    const ed = mount([CALLOUT({ variant: 'note' })], { editable: false })
    fireEvent.click(pick())
    expect(menu()).toBeNull()
    expect(theCallout(ed).attrs.variant).toBe('note')
  })

  it('/Callout inserts a STYLED callout (a note)', () => {
    const ed = mount([P('x')])
    ITEMS.find((i) => i.title === 'Callout').command({ editor: ed, range: { from: 1, to: 2 } })
    expect(theCallout(ed).attrs.variant).toBe('note')
  })
})

describe('export: one list of styles in two files', () => {
  it('notes_export.py _CALLOUT_VARIANTS equals the client CALLOUT_VARIANTS', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'api/services/journal_two/notes_export.py'), 'utf8')
    const m = /^_CALLOUT_VARIANTS = frozenset\(\{([^}]*)\}\)/m.exec(src)
    expect(m, 'the server list was not found').toBeTruthy()
    const server = [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort()
    expect(server).toEqual([...CALLOUT_VARIANTS].sort())
  })
})

const hasPython = pythonAvailable()
const d = hasPython ? describe : describe.skip
if (!hasPython) console.warn('\n⛔ callout export round trip NOT VERIFIED: `python` is not on PATH.\n')

d('export round trip — the real exporter, then the real importer', () => {
  // ⛔ ONE spawn for the whole describe (wave 7 lane J, fix round 1, I-1): each bridge spawn
  // pays the ~7 s census import, and six of them -- one per test -- ran every test against
  // the 15 s testTimeout. The six documents are exported together here, under a 60 s hook
  // budget (the selectionExport.roundtrip.test.js precedent), and each test reads its own.
  const STYLED = (variant) => ({ type: 'doc', content: [CALLOUT({ variant, emoji: '💡' }, 'Gap fill below 120.')] })
  const EMOJI = { type: 'doc', content: [CALLOUT({ emoji: '🔥' }, 'hot')] }
  let exported
  beforeAll(() => {
    const markdowns = exportMarkdownMany([...CALLOUT_VARIANTS.map(STYLED), EMOJI])
    exported = new Map([...CALLOUT_VARIANTS, 'emoji'].map((key, i) => [key, markdowns[i]]))
  }, 60_000)

  it.each(CALLOUT_VARIANTS)('a %s callout comes back as a %s callout, text intact', (variant) => {
    const md = exported.get(variant)
    expect(md).toContain(`<aside data-variant="${variant}">`)
    expect(md).not.toContain('💡')
    const back = importMarkdown(md)
    const c = back.content.find((n) => n.type === 'callout')
    expect(c.attrs.variant).toBe(variant)
    expect(JSON.stringify(c.content)).toContain('Gap fill below 120.')
  })

  it('an emoji callout still round-trips as an emoji callout (no variant invented)', () => {
    const md = exported.get('emoji')
    const c = importMarkdown(md).content.find((n) => n.type === 'callout')
    expect(c.attrs).toMatchObject({ variant: null, emoji: '🔥' })
  })
})
