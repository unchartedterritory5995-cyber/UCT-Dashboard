// pasteContainers.js — unit rails for the helper itself, swept over every
// slice of a doc that nests all three containers (and a toggle in a list).
// The behavioural rails through the real clipboard are pasteContainers.test.js.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { buildExtensions } from './tiptap'
import { buildAskInsertNode } from './askInsert'
import { unwrapOpenContainers } from './pasteContainers'

// The spec, written out: the rail must not read the set it is checking.
const MUST_UNWRAP = new Set(['askInsert', 'callout', 'toggle'])

let editor
afterEach(() => { editor?.destroy(); editor = null })
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const TOG = (sum, body) => ({ type: 'toggle', attrs: { open: true }, content: [
  { type: 'toggleSummary', content: sum ? [{ type: 'text', text: sum }] : [] }, { type: 'toggleContent', content: body }] })
const CAL = (body) => ({ type: 'callout', attrs: { emoji: 'x' }, content: body })
const SRC = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
const INSERT = buildAskInsertNode({ answer: 'Margins fell [1].', sources: [SRC], question: 'q', scope: 'note', insertedAt: '2026-09-22T12:00:00.000Z' })
const NESTED = [P('Mine.'),
  { type: 'askInsert', attrs: INSERT.attrs, content: [CAL([TOG('Sum', [P('Body.'), CAL([P('Deep.')])])]), ...INSERT.content] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [P('Item.'), TOG('', [P('In list.')])] }] },
  P('After.')]

describe('unwrapOpenContainers', () => {
  it('buildExtensions() registers the plugin', () => {
    expect(buildExtensions().map((e) => e.name)).toContain('pasteContainers')
  })

  it('every slice of a nested doc comes back well-formed, with no container open on either edge spine', () => {
    const el = document.createElement('div'); document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: NESTED } })
    const { doc } = editor.state
    let changed = 0
    for (let from = 0; from <= doc.content.size; from += 1) {
      for (let to = from + 1; to <= doc.content.size; to += 1) {
        const s = doc.slice(from, to, true)
        const out = unwrapOpenContainers(s)
        if (out !== s) changed += 1
        const max = Slice.maxOpen(out.content)
        expect(out.openStart).toBeLessThanOrEqual(max.openStart)
        expect(out.openEnd).toBeLessThanOrEqual(max.openEnd)
        for (const [open, pick] of [[out.openStart, (f) => f.firstChild], [out.openEnd, (f) => f.lastChild]]) {
          let f = out.content
          for (let d = 0; d < open && f.childCount; d += 1) { const n = pick(f); expect(MUST_UNWRAP.has(n.type.name)).toBe(false); f = n.content }
        }
        // Nothing is lost: the text of the slice survives the unwrap exactly.
        expect(out.content.textBetween(0, out.content.size, '|')).toBe(s.content.textBetween(0, s.content.size, '|'))
        // The result is placeable: replacing the whole doc body with it never throws.
        expect(() => editor.state.tr.replaceRange(0, doc.content.size, out)).not.toThrow()
      }
    }
    expect(changed).toBeGreaterThan(0) // non-vacuity: the sweep really exercised the unwrap
  })

  it('a slice with no container on an open edge is returned as the SAME object', () => {
    const el = document.createElement('div'); document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [P('Mine.'), CAL([P('Whole.')]), P('After.')] } })
    const s = editor.state.doc.slice(2, editor.state.doc.content.size - 2, true) // callout sits wholly inside
    expect(s.openStart).toBe(1)
    expect(unwrapOpenContainers(s)).toBe(s)
  })
})
