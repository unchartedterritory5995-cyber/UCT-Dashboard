import { describe, it, expect, afterEach } from 'vitest'
import { Editor, generateHTML, generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { AskInsert } from './askInsertNode'
import { AskCitation, askCitationStaleKey } from './askCitationNode'
import { appendAskInsert, buildAskInsertNode } from './askInsert'
import { buildExtensions } from './tiptap'

// A bare Editor has no React content component, so ReactNodeViewRenderer
// returns {} and the nodes render through renderHTML. That is exactly what we
// want here: these rails are about the SCHEMA, the keymap and the plugin.
const EXT = [StarterKit, AskInsert, AskCitation]
let editor
afterEach(() => { editor?.destroy(); editor = null })

function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: EXT, content })
  return editor
}

function findInsert(ed) {
  let found = null
  ed.state.doc.forEach((node, offset) => { if (!found && node.type.name === 'askInsert') found = { a: offset, node } })
  return found
}

const SRC = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
const INSERT = buildAskInsertNode({
  answer: 'Margins fell [1].', sources: [SRC], question: 'q', scope: 'note',
  insertedAt: '2026-09-22T12:00:00.000Z',
})
const MINE = { type: 'paragraph', content: [{ type: 'text', text: 'Mine.' }] }
const AFTER = { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] }
const DOC = { type: 'doc', content: [MINE, INSERT, AFTER] }

describe('registration — never remove', () => {
  it('buildExtensions() carries both nodes', () => {
    const names = buildExtensions().map((e) => e.name)
    expect(names).toContain('askInsert')
    expect(names).toContain('askCitation')
  })
})

describe('HTML round trip (copy/paste stability)', () => {
  it('keeps every chip attribute', () => {
    const json = generateJSON(generateHTML(DOC, EXT), EXT)
    const chip = json.content[1].content[0].content[1]
    expect(chip.type).toBe('askCitation')
    expect(chip.attrs).toEqual({
      n: 1, label: 'NVDA thesis', nav: { kind: 'note', note_id: 'n1' },
      citation: 'exact', claim: 'Margins fell .',
    })
    expect(json.content[1].attrs).toEqual({
      insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'q',
    })
  })

  it('re-parses its own output unchanged', () => {
    const first = generateJSON(generateHTML(DOC, EXT), EXT)
    expect(generateJSON(generateHTML(first, EXT), EXT)).toEqual(first)
  })
})

describe('the provenance wrapper survives editing (P1)', () => {
  it('Backspace at the start of the body does not lift it out', () => {
    const ed = mount(DOC)
    const before = ed.getJSON()
    ed.commands.setTextSelection(findInsert(ed).a + 2)
    ed.commands.keyboardShortcut('Backspace')
    expect(ed.getJSON()).toEqual(before)
  })

  it('Delete at the end of the body does not pull the next paragraph in', () => {
    const ed = mount(DOC)
    const { a, node } = findInsert(ed)
    ed.commands.setTextSelection(a + node.nodeSize - 2)
    ed.commands.keyboardShortcut('Delete')
    expect(ed.state.doc.childCount).toBe(3)
    expect(ed.state.doc.child(2).textContent).toBe('After.')
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
  })

  it('deleting every character of the body keeps the wrapper', () => {
    const ed = mount(DOC)
    const { a, node } = findInsert(ed)
    ed.chain().setTextSelection({ from: a + 2, to: a + node.nodeSize - 2 }).deleteSelection().run()
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
    expect(ed.state.doc.child(1).textContent).toBe('')
  })
})

describe('a citation says so when its paragraph was edited (P2)', () => {
  const stale = (ed) => askCitationStaleKey.getState(ed.state).find().length

  it('a fresh insert has nothing stale', () => {
    expect(stale(mount(DOC))).toBe(0)
  })

  it("editing the chip's paragraph marks it stale", () => {
    const ed = mount(DOC)
    ed.chain().setTextSelection(findInsert(ed).a + 2).insertContent('Really, ').run()
    expect(stale(ed)).toBe(1)
  })

  it('editing a different paragraph changes nothing', () => {
    const ed = mount(DOC)
    ed.chain().setTextSelection(1).insertContent('Still ').run()
    expect(stale(ed)).toBe(0)
  })

  it('undoing the edit clears it again — computed, never stored', () => {
    const ed = mount(DOC)
    ed.chain().setTextSelection(findInsert(ed).a + 2).insertContent('X').run()
    expect(stale(ed)).toBe(1)
    ed.commands.undo()
    expect(stale(ed)).toBe(0)
  })

  it('the check never writes to the document', () => {
    const ed = mount(DOC)
    let updates = 0
    ed.on('update', () => { updates += 1 })
    ed.commands.setTextSelection(1)
    expect(updates).toBe(0)
    expect(JSON.stringify(ed.getJSON())).not.toContain('askStale')
  })
})

describe('appendAskInsert (spec §5.2)', () => {
  it('appends at the end, never replacing a selected node', () => {
    const ed = mount({ type: 'doc', content: [MINE] })
    ed.commands.setNodeSelection(0)
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    // StarterKit's TrailingNode extension auto-appends an empty paragraph
    // after a non-paragraph last block, so assert the real append position
    // rather than an exact childCount.
    expect(ed.state.doc.childCount).toBeGreaterThanOrEqual(2)
    expect(ed.state.doc.child(0).textContent).toBe('Mine.')
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
    for (let i = 2; i < ed.state.doc.childCount; i += 1) {
      expect(ed.state.doc.child(i).type.name).toBe('paragraph')
      expect(ed.state.doc.child(i).textContent).toBe('')
    }
  })

  it('refuses a missing, destroyed or read-only editor', () => {
    const ed = mount({ type: 'doc', content: [MINE] })
    ed.setEditable(false)
    expect(appendAskInsert(ed, INSERT)).toBe(false)
    expect(appendAskInsert(null, INSERT)).toBe(false)
    expect(ed.state.doc.childCount).toBe(1)
  })
})
