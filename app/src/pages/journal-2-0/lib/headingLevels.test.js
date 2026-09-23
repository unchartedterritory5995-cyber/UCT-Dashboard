// Wave 5 — headings H4–H6 through every door: stored, typed, keyed, pasted,
// slashed, styled.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { ITEMS } from '../components/notebook/SlashMenu'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_CSS = fs.readFileSync(path.join(HERE, 'noteContent.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content })
  return editor
}
const H = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const levels = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'heading') o.push([n.attrs.level, n.textContent]) }); return o }
function type(ed, text) {
  for (const ch of text) {
    const { from, to } = ed.state.selection
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)))
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
  }
}

describe('H4–H6', () => {
  it('a stored level 4, 5 or 6 renders as ITSELF (it rendered as <h1> when only 1-3 were enabled)', () => {
    const ed = mount({ type: 'doc', content: [H(4, 'Four'), H(5, 'Five'), H(6, 'Six')] })
    // (StarterKit's trailing-node plugin may add an empty paragraph after them.)
    expect(ed.getHTML().startsWith('<h4>Four</h4><h5>Five</h5><h6>Six</h6>')).toBe(true)
    expect([...ed.view.dom.querySelectorAll('h4, h5, h6')].map((h) => h.tagName)).toEqual(['H4', 'H5', 'H6'])
  })

  it('pasted or imported <h4>-<h6> keep their level (they became paragraphs)', () => {
    const ed = mount('<h4>Risks</h4><h5>China</h5><h6>Note</h6>')
    expect(levels(ed)).toEqual([[4, 'Risks'], [5, 'China'], [6, 'Note']])
  })

  it('#### / ##### / ###### and a space make the heading', () => {
    for (const [marks, level] of [['####', 4], ['#####', 5], ['######', 6]]) {
      const ed = mount('<p></p>')
      ed.commands.setTextSelection(1)
      type(ed, `${marks} Title`)
      expect(levels(ed)).toEqual([[level, 'Title']])
      ed.destroy(); editor = null
    }
  })

  it('Mod-Alt-4 / 5 / 6 toggle them', () => {
    const ed = mount('<p>Heading text</p>')
    ed.commands.setTextSelection(3)
    for (const level of [4, 5, 6]) {
      const ev = new KeyboardEvent('keydown', { key: String(level), ctrlKey: true, altKey: true })
      expect(ed.view.someProp('handleKeyDown', (f) => f(ed.view, ev))).toBe(true)
      expect(levels(ed)).toEqual([[level, 'Heading text']])
    }
  })

  it('the slash menu offers Heading 4, 5 and 6, and each sets its level', () => {
    for (const level of [4, 5, 6]) {
      const item = ITEMS.find((it) => it.title === `Heading ${level}`)
      expect(item, `Heading ${level}`).toBeTruthy()
      const ed = mount('<p>Topic/h</p>')
      item.command({ editor: ed, range: { from: 6, to: 8 } })
      expect(levels(ed)).toEqual([[level, 'Topic']])
      ed.destroy(); editor = null
    }
  })

  it.each([4, 5, 6])('h%i has a style on every surface (noteContent.css), guarded from widget embeds', (level) => {
    const re = new RegExp(`\\.ProseMirror h${level}:not\\(:where\\(\\[data-widget-embed-view\\] \\*\\)\\)\\s*\\{([^}]*)\\}`)
    const m = CONTENT_CSS.match(re)
    expect(m, `h${level} rule with the embed guard`).not.toBe(null)
    expect(m[1]).toMatch(/font-size\s*:\s*[\d.]+em/)
  })
})
