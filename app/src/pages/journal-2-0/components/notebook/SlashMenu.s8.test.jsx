// S8 (the audit's M3): the slash menu leads with Basics, shows ten rows and "All N blocks…" on a bare `/`,
// lets the keyboard own Enter once the member has typed (B8), and answers a query with no block by saying
// where the thing lives, Esc keeping the typed text (detail #26). Driven the way a member drives it: the
// REAL slash extension, the menu as rendered, keys through the editor.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { render, cleanup, waitFor, act, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import { EditorContent } from '@tiptap/react'
import { buildExtensions } from '../../lib/tiptap'
import { SlashList, ITEMS, groupedSlashItems, compactSlashItems, noMatchLines, COMPACT_ROWS } from './SlashMenu'

// jsdom has no Range layout; an editor focus() scrolls the caret into view on the next frame.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

let ed
afterEach(() => {
  cleanup()
  ed?.destroy()
  ed = null
  document.querySelectorAll('#uct-slash-menu, [data-testid="slash-no-match"]').forEach((n) => n.parentElement?.remove())
})
const pressKey = (k) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: k })))
const options = () => [...document.querySelectorAll('#uct-slash-menu [role="option"]')]
const rows = () => options().map((o) => o.firstElementChild.textContent)
const labels = () => [...document.querySelectorAll('#uct-slash-menu [data-slash-label]')].map((n) => n.textContent)

async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  ed = new Editor({ element: el, extensions: buildExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }] } })
  render(createElement(EditorContent, { editor: ed }))
  ed.commands.focus('end', { scrollIntoView: false })
}
const type = (text) => act(async () => { ed.commands.insertContent(text) })

describe('a bare / (M3: ten rows, basics first)', () => {
  it('shows ten rows under Basics first, then "All N blocks…", which opens every row in place', async () => {
    await mount()
    await type('/')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    const shown = rows()
    expect(shown).toHaveLength(COMPACT_ROWS + 1)
    const all = shown[COMPACT_ROWS]
    const n = Number(/^All (\d+) blocks…$/.exec(all)?.[1])
    expect(n).toBeGreaterThan(COMPACT_ROWS)
    expect(labels()[0]).toBe('Basics')
    expect(shown).toEqual(expect.arrayContaining(['Heading 2', 'Checklist', 'Table', 'Image', 'Chart']))
    // The keyboard reaches it too: up from the top wraps to "All N blocks…", and Enter opens rather than inserts.
    await act(async () => { pressKey('ArrowUp') })
    await act(async () => { pressKey('Enter') })
    expect(options()).toHaveLength(n)
    expect(ed.state.doc.textContent).toBe('Plan /')   // nothing was inserted
    expect(rows()[0]).toBe('Heading 1')
  })

  it('the compact list is a few from each section, in menu order', () => {
    const full = groupedSlashItems(ITEMS, [])
    const few = compactSlashItems(full)
    expect(few).toHaveLength(COMPACT_ROWS)
    // Order kept: the ten are a subsequence of the full list.
    const idx = few.map((it) => full.indexOf(it))
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    expect(few.filter((it) => it.section === 'basics').length).toBeGreaterThanOrEqual(4)
    // A short list is shown whole.
    expect(compactSlashItems(full.slice(0, 3))).toEqual(full.slice(0, 3))
  })

  it('a markdown hint rides on the right of the row, outside its name', async () => {
    const items = groupedSlashItems(ITEMS, [])
    const { getByRole } = render(<SlashList items={items} command={() => {}} />)
    const h2 = getByRole('option', { name: /^Heading 2/ })
    expect(h2.textContent).toContain('##')
    expect(h2.querySelector('[aria-hidden="true"]').textContent).toBe('##')
  })
})

describe('B8: once the member types, the keyboard owns Enter', () => {
  it('hover a row, type /table, press Enter: Table is inserted', async () => {
    await mount()
    await type('/')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    fireEvent.mouseEnter(options()[1])                     // the mouse comes to rest on the second row
    await type('table')
    await waitFor(() => expect(rows()[0]).toBe('Table'))
    expect(rows()[1]).toBe('Table of contents')
    // The list moved under the resting mouse: the row now beneath it gets the enter event, and must not take
    // the highlight off the top match.
    fireEvent.mouseEnter(options()[1])
    expect(options()[0].getAttribute('aria-selected')).toBe('true')
    await act(async () => { pressKey('Enter') })
    const types = ed.getJSON().content.map((n) => n.type)
    expect(types).toContain('table')
    expect(types).not.toContain('tableOfContents')
  })

  it('CONTROL: on a bare / the highlight still follows the mouse', async () => {
    await mount()
    await type('/')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    fireEvent.mouseEnter(options()[2])
    expect(options()[2].getAttribute('aria-selected')).toBe('true')
  })
})

describe('no match (detail #26): say where it lives; Esc keeps the text', () => {
  const note = () => document.querySelector('[data-testid="slash-no-match"]')
  const status = () => document.querySelector('[role="status"][aria-live="polite"]')

  it('/scanner names the Screener page, through a region mounted empty first; Esc closes and keeps /scanner', async () => {
    await mount()
    await type('/')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    expect(status()).not.toBeNull()
    expect(status().textContent).toBe('')                  // mounted empty with the list
    await type('scanner')
    await waitFor(() => expect(note()).not.toBeNull())
    expect(note().textContent).toContain('No block called "scanner".')
    expect(note().textContent).toContain('Screener results come in from the Screener page: Send to Notebook.')
    expect(note().textContent).toContain('Esc to keep typing')
    expect(status().textContent).toContain('No block called "scanner".')
    await act(async () => { pressKey('Escape') })
    expect(note()).toBeNull()                              // the menu closed (Suggestion ends the session on Esc)
    expect(ed.state.doc.textContent).toBe('Plan /scanner') // and the typed text stays
  })

  it('an unknown word says only that there is none; prose after a space says nothing', () => {
    expect(noMatchLines('zzz')).toEqual({ title: 'No block called "zzz".', where: null })
    expect(noMatchLines('screener').where).toMatch(/Screener page/)
    expect(noMatchLines('or this')).toBeNull()
    expect(noMatchLines('')).toBeNull()
    // Fix round 1 (review finding 8b): "/" before a digit is ordinary writing ("1/2", "target / 200"), and one letter
    // is a word still being typed: no box.
    for (const q of ['2', '200', '1x', 'a', '_x']) expect(noMatchLines(q), q).toBeNull()
  })

  it('a session that STARTS on a no-match query (a paste) still announces it: the region fills after it mounts', async () => {
    await mount()
    const records = []
    const mo = new MutationObserver((rs) => records.push(...rs))
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    await type('/scanner')
    await waitFor(() => expect(status()?.textContent).toContain('No block called "scanner".'))
    await new Promise((r) => setTimeout(r, 0))
    mo.disconnect()
    const filledLater = records.some((r) => r.type === 'childList' && r.target === status()
      && [...r.addedNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.includes('No block called')))
    expect(filledLater).toBe(true)
  })

  it('prose after a space ("target / 200") shows no box', async () => {
    await mount()
    await type('/200')
    await new Promise((r) => setTimeout(r, 20))
    expect(note()).toBeNull()
  })
})
