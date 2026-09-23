import { describe, it, expect, afterEach } from 'vitest'
import { Editor, generateHTML, generateJSON } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { AskInsert } from './askInsertNode'
import { AskCitation, askCitationStaleKey } from './askCitationNode'
import { appendAskInsert, buildAskInsertNode } from './askInsert'
import { buildExtensions } from './tiptap'

// G-064 fix round 2 (R2-1): jsdom has no global ClipboardEvent, and
// `EditorView.pasteHTML` constructs one to synthesize a real paste. This
// mirrors the reviewer's own probe scripts (`w.ClipboardEvent = ...`).
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, opts) { super(type, opts); this.clipboardData = (opts && opts.clipboardData) || null }
  }
}

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

// G-064 fix round 2 (R2-1): the doc position of the first occurrence of `str`
// inside any text node, for building a real copy selection without hand
// counting positions.
function locate(ed, str) {
  let hit = null
  ed.state.doc.descendants((node, pos) => {
    if (hit || !node.isText) return
    const i = node.text.indexOf(str)
    if (i >= 0) hit = pos + i
  })
  return hit
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

// G-064 fix round 1 (Finding F2, controller ruling) — `isolating` blocks a
// JOIN across the edge (Backspace/Delete above) but not an explicit
// multi-position SELECTION spanning it. Measured (probe_boundary.cjs):
// selecting from inside "Mine." into the answer and deleting produced
// "Miins fell." — prose moved across the wrapper. `filterTransaction` in
// askInsertNode.jsx is the backstop.
describe('a selection cannot delete across the block edge (P1 fix round 1)', () => {
  it('(a) selecting from inside "Mine." into the answer, then deleting: the doc is unchanged', () => {
    const ed = mount(DOC)
    const before = ed.getJSON()
    const { a } = findInsert(ed)
    ed.chain().setTextSelection({ from: 3, to: a + 4 }).deleteSelection().run()
    expect(ed.getJSON()).toEqual(before)
  })

  it('(b) the reverse direction, from inside the answer into "After.": unchanged', () => {
    const ed = mount(DOC)
    const before = ed.getJSON()
    const { a, node } = findInsert(ed)
    const afterStart = a + node.nodeSize
    ed.chain().setTextSelection({ from: a + 4, to: afterStart + 3 }).deleteSelection().run()
    expect(ed.getJSON()).toEqual(before)
  })

  it('(c) typing over a crossing selection: unchanged', () => {
    const ed = mount(DOC)
    const before = ed.getJSON()
    const { a } = findInsert(ed)
    ed.chain().setTextSelection({ from: 3, to: a + 4 }).insertContent('x').run()
    expect(ed.getJSON()).toEqual(before)
  })

  it('(d) STILL ALLOWED: a node selection of the whole block can still delete it', () => {
    const ed = mount(DOC)
    const { a } = findInsert(ed)
    ed.commands.setNodeSelection(a)
    ed.commands.deleteSelection()
    expect(ed.state.doc.childCount).toBe(2)
    expect(ed.state.doc.child(0).textContent).toBe('Mine.')
    expect(ed.state.doc.child(1).textContent).toBe('After.')
  })

  it('(d) STILL ALLOWED: select-all-and-delete still clears the whole document', () => {
    const ed = mount(DOC)
    ed.commands.selectAll()
    ed.commands.deleteSelection()
    expect(ed.state.doc.textContent).toBe('')
    let hasAskInsert = false
    ed.state.doc.descendants((node) => { if (node.type.name === 'askInsert') hasAskInsert = true })
    expect(hasAskInsert).toBe(false)
  })

  it('(d) STILL ALLOWED: appendAskInsert still works when the doc already ends with an askInsert', () => {
    const ed = mount({ type: 'doc', content: [MINE, INSERT] })
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    let count = 0
    ed.state.doc.forEach((node) => { if (node.type.name === 'askInsert') count += 1 })
    expect(count).toBe(2)
  })

  it('(e) a raw lift step out of the block is blocked; the block keeps its paragraph', () => {
    // G-064 fix round 2 (R2-2): the `lift` COMMAND already refuses to run
    // under `isolating` before it ever reaches the filter (`isNodeActive`'s
    // own pre-check), so asserting the doc is unchanged after
    // `ed.commands.lift('askInsert')` proves the command's guard, not this
    // extension's. Dispatch the raw `Transform.lift` step directly instead --
    // that is the only way to exercise `filterTransaction` itself.
    const ed = mount(DOC)
    const before = ed.getJSON()
    const { a } = findInsert(ed)
    const insideStart = a + 2
    const insideEnd = a + 2
    const { state } = ed
    const $a = state.doc.resolve(insideStart)
    const $b = state.doc.resolve(insideEnd)
    const range = $a.blockRange($b)
    ed.view.dispatch(state.tr.lift(range, 0))
    expect(ed.getJSON()).toEqual(before)
  })
})

// G-064 fix round 2 (R2-1, controller ruling) — history transactions bypass
// the filter. Measured (reviewer's rr_probe*.cjs, reproduced independently
// against the real repo code): copying a word from INSIDE the answer
// paragraph and pasting it at the very START of a member paragraph triggers
// ProseMirror's "defining-paste wrapping" (the copied slice carries a
// `data-pm-slice` marker naming the source askInsert, so the paste re-wraps
// the destination paragraph in a NEW askInsert of the same attrs). The
// controller deferred that paste behaviour itself -- what this fixes is that
// `editor.commands.undo()` on the result returned `true` while leaving the
// document completely unchanged, permanently stranding every earlier undo
// entry. `isHistoryTransaction` in askInsertNode.jsx's filterTransaction is
// the fix; this reproduces the exact failing recipe and shows undo restores
// the pre-paste document byte-for-byte.
describe('undo after a defining-paste wrap is never stranded (fix round 2, R2-1)', () => {
  it('pasting a copied answer fragment at the start of a member paragraph restores exactly on undo', () => {
    const ed = mount(DOC)
    const before = ed.getJSON()
    const copyFrom = locate(ed, 'ins') // interior of "Margins", inside the answer paragraph
    const copyTo = copyFrom + 3
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, copyFrom, copyTo)))
    const html = ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
    ed.commands.setTextSelection(1)
    ed.view.pasteHTML(html)
    // Sanity: the paste actually mutated the document (defining-paste
    // wrapping fired) -- otherwise undo restoring "before" would be trivial.
    expect(ed.getJSON()).not.toEqual(before)
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getJSON()).toEqual(before)
  })
})

// G-064 fix round 2 (R2-3) — a parse rail for the citation chip's `data-n`
// attribute (askCitationNode.jsx's F4 fix): missing and empty both read
// null, never the real value zero; `data-n="0"` itself must read the real 0.
describe("a parse rail for the citation chip's data-n attribute (fix round 2, R2-3)", () => {
  function nOf(spanAttr) {
    const html = `<div data-type="ask-insert"><p>Hi <span data-type="ask-citation"${spanAttr}>[?]</span></p></div>`
    const json = generateJSON(html, EXT)
    let n
    let found = false
    const visit = (node) => {
      if (found || !node || typeof node !== 'object') return
      if (node.type === 'askCitation') { n = node.attrs.n; found = true; return }
      if (Array.isArray(node.content)) node.content.forEach(visit)
    }
    visit(json)
    return n
  }

  it('no data-n at all parses to null', () => {
    expect(nOf('')).toBeNull()
  })

  it('an empty data-n parses to null', () => {
    expect(nOf(' data-n=""')).toBeNull()
  })

  it('data-n="3" parses to 3', () => {
    expect(nOf(' data-n="3"')).toBe(3)
  })

  it('data-n="0" parses to the real 0, not null', () => {
    expect(nOf(' data-n="0"')).toBe(0)
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
    // G-064 fix round 1 (Finding F3): the old version only moved the
    // selection, so it never actually exercised staleness -- an assertion
    // over a check that never ran proves nothing. Make a chip stale first,
    // then assert the ONE edit that did it fired exactly ONE update, and that
    // nothing about staleness ever reached the document's own JSON.
    const ed = mount(DOC)
    let updates = 0
    ed.on('update', () => { updates += 1 })
    ed.chain().setTextSelection(findInsert(ed).a + 2).insertContent('X').run()
    expect(stale(ed)).toBe(1)
    expect(updates).toBe(1)
    expect(JSON.stringify(ed.getJSON())).not.toContain('askStale')
  })
})

describe('appendAskInsert (spec §5.2)', () => {
  it('appends at the end, never replacing a selected node', () => {
    const ed = mount({ type: 'doc', content: [MINE] })
    ed.commands.setNodeSelection(0)
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    // G-064 fix round 1 (Finding F7): StarterKit's TrailingNode extension
    // auto-appends exactly ONE empty paragraph after a non-paragraph last
    // block (Callout/Toggle/embeds behave identically), never more -- so the
    // shape is exact: the original paragraph, the askInsert, and that one
    // trailing paragraph.
    expect(ed.state.doc.childCount).toBe(3)
    expect(ed.state.doc.child(0).textContent).toBe('Mine.')
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
    expect(ed.state.doc.child(2).type.name).toBe('paragraph')
    expect(ed.state.doc.child(2).textContent).toBe('')
  })

  it('refuses a missing, destroyed or read-only editor', () => {
    const ed = mount({ type: 'doc', content: [MINE] })
    ed.setEditable(false)
    expect(appendAskInsert(ed, INSERT)).toBe(false)
    expect(appendAskInsert(null, INSERT)).toBe(false)
    expect(ed.state.doc.childCount).toBe(1)
  })
})
