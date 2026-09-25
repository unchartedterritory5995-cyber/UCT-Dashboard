import { describe, it, expect, afterEach } from 'vitest'
import { Editor, generateHTML, generateJSON } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { Slice } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { AskInsert } from './askInsertNode'
import { PasteContainers, unwrapOpenContainers } from './pasteContainers'
import { AskCitation, askCitationStaleKey } from './askCitationNode'
import { appendAskInsert, buildAskInsertNode } from './askInsert'
import { buildExtensions } from './tiptap'

// G-064 fix round 2 (R2-1): jsdom has no global ClipboardEvent, and
// `EditorView.pasteHTML` constructs one to synthesize a real paste. A minimal
// stand-in carrying `clipboardData` is all `pasteHTML` needs.
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, opts) { super(type, opts); this.clipboardData = (opts && opts.clipboardData) || null }
  }
}

// A bare Editor has no React content component, so ReactNodeViewRenderer
// returns {} and the nodes render through renderHTML. That is exactly what we
// want here: these rails are about the SCHEMA, the keymap and the plugin.
const EXT = [StarterKit, AskInsert, AskCitation, PasteContainers]
// A clipboard written WITHOUT the copy hook: a tab still on an older bundle.
const OLD_EXT = [StarterKit, AskInsert, AskCitation]
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
    // Wave 7 H2 (ruling D-H1): the node gained two OPTIONAL attrs, `action` and
    // `model`, null on every Ask insert. ProseMirror's JSON carries every attr,
    // so an Ask insert's JSON now shows them as null — the HTML does not
    // (renderHTML emits nothing for null; writingHelp.test.js pins that).
    expect(json.content[1].attrs).toEqual({
      insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'q',
      action: null, model: null,
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
// multi-position SELECTION spanning it. Measured before the guard existed:
// selecting from inside "Mine." into the answer and deleting produced
// "Miins fell." — prose moved across the wrapper. Case (a) below is that exact
// recipe. `filterTransaction` in askInsertNode.jsx is the backstop.
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
// the filter. The defect: an undo whose INVERSE step crosses the askInsert edge
// was judged by filterTransaction like any forward edit and refused, while
// `editor.commands.undo()` still returned `true` -- the document never
// changed, and every earlier undo entry was stranded behind it for good.
// `isHistoryTransaction` in askInsertNode.jsx's filterTransaction is the fix.
//
// ⚠️ Final fix wave (I4): this rail used to reach a crossing inverse through a
// defining-paste wrap (answer text pasted at the start of a member paragraph
// re-wrapped that paragraph). pasteContainers.js now unwraps an open askInsert
// (on copy and on paste), so that paste inserts plain text and its undo no
// longer crosses anything --
// the old recipe could no longer fail. The setup is therefore the wrap itself,
// dispatched directly: a wrap is a pure insertion (both of its deleted ranges
// are empty), so the filter accepts it going forward, while its inverse
// deletes the wrapper's two edges, each from outside the block to inside it.
describe('undo of a wrap into an askInsert is never stranded (fix round 2, R2-1)', () => {
  it('a member paragraph wrapped in an askInsert is restored exactly on undo', () => {
    const ed = mount(DOC)
    const before = ed.getJSON()
    const range = ed.state.doc.resolve(locate(ed, 'Mine.')).blockRange()
    ed.view.dispatch(ed.state.tr.wrap(range, [{ type: ed.schema.nodes.askInsert, attrs: INSERT.attrs }]))
    // Sanity: the wrap was accepted -- otherwise undo restoring "before" is trivial.
    expect(ed.state.doc.child(0).type.name).toBe('askInsert')
    expect(ed.state.doc.child(0).textContent).toBe('Mine.')
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getJSON()).toEqual(before)
  })
})

// G-064 final fix wave (I4, controller ruling) — a PARTIAL copy from inside an
// answer pastes as plain content; a WHOLE block keeps its wrapper.
//
// ProseMirror serializes a copy made inside the answer with a `data-pm-slice`
// marker naming the askInsert around it, and the paste rebuilds that wrapper
// (`addContext`). Because askInsert is `defining`, pasting such a slice at the
// START of a member paragraph wrapped the MEMBER'S paragraph in a NEW
// askInsert: the member's own words then read "From Ask Notebook" and dropped
// out of Ask (spec §7.2) — provenance lying in reverse. pasteContainers.js
// unwraps any askInsert that is OPEN at a slice edge — `transformCopied` so the
// clipboard never carries the open wrapper, `transformPasted` for a clipboard
// that does (an older bundle's); a CLOSED one (the whole block, copied as a
// node) is left alone, so provenance still travels with a real answer. Every
// case goes through the real clipboard path: `serializeForClipboard` for the
// copy, `view.pasteHTML` for the paste.
describe('pasting answer text never wraps member prose (final wave, I4)', () => {
  const askInserts = (ed) => {
    const out = []
    ed.state.doc.descendants((node) => { if (node.type.name === 'askInsert') out.push(node) })
    return out
  }
  function copyRange(ed, from, to) {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)))
    return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
  }
  function copyNode(ed, pos) {
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)))
    return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
  }

  it('(a) a word copied from inside an answer, pasted at the start of a member paragraph, is plain text there', () => {
    const ed = mount(DOC)
    const at = locate(ed, 'ins') // interior of "Margins", inside the answer
    // Today's copy side already drops the open wrapper ...
    expect(copyRange(ed, at, at + 3)).not.toContain('askInsert')
    // ... so the PASTE side is proved with a clipboard from an older bundle.
    const el = document.createElement('div')
    document.body.appendChild(el)
    const old = new Editor({ element: el, extensions: OLD_EXT, content: DOC })
    const html = copyRange(old, at, at + 3)
    old.destroy()
    expect(html).toContain('askInsert') // the stale copy really carries the wrapper context
    ed.commands.setTextSelection(1) // the start of "Mine."
    ed.view.pasteHTML(html)
    expect(askInserts(ed)).toHaveLength(1)
    expect(ed.state.doc.child(0).type.name).toBe('paragraph')
    expect(ed.state.doc.child(0).textContent).toBe('insMine.')
  })

  it('(b) a selection copied across the edge (member -> answer) pastes as member paragraphs, no new block', () => {
    const ed = mount(DOC)
    const html = copyRange(ed, locate(ed, 'ne.'), locate(ed, 'rgins'))
    const end = locate(ed, 'After.') + 'After.'.length
    ed.commands.setTextSelection(end)
    ed.view.pasteHTML(html)
    expect(askInserts(ed)).toHaveLength(1)
    expect(ed.state.doc.textContent).toContain('After.ne.')
    expect(ed.state.doc.textContent).toContain('Ma')
  })

  it('(c) the WHOLE block, copied as a node and pasted after the note, keeps its wrapper and attrs', () => {
    const ed = mount(DOC)
    const html = copyNode(ed, findInsert(ed).a)
    ed.commands.setTextSelection(locate(ed, 'After.') + 'After.'.length)
    ed.view.pasteHTML(html)
    const blocks = askInserts(ed)
    expect(blocks).toHaveLength(2)
    // + the two optional H2 attrs, null on an Ask insert (see the round trip above)
    expect(blocks[1].attrs).toEqual({ ...INSERT.attrs, action: null, model: null })
    expect(blocks[1].textContent).toBe('Margins fell .')
  })

  it('(d) answer text pasted at the start of a paragraph INSIDE the answer lands there (was silently refused)', () => {
    const ed = mount(DOC)
    const at = locate(ed, 'ins')
    const html = copyRange(ed, at, at + 3)
    ed.commands.setTextSelection(findInsert(ed).a + 2) // the start of the answer's paragraph
    ed.view.pasteHTML(html)
    const blocks = askInserts(ed)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].textContent).toBe('insMargins fell .')
  })

  it('the unwrapped slice is well-formed, and a closed block is returned untouched', () => {
    const ed = mount(DOC)
    const { a, node } = findInsert(ed)
    const ins = locate(ed, 'ins')
    // `includeParents` = what `selection.content()` copies.
    const cases = [[ins, ins + 3], [3, a + 4], [a + 4, a + node.nodeSize + 3], [1, 4]]
    for (const [from, to] of cases) {
      const out = unwrapOpenContainers(ed.state.doc.slice(from, to, true))
      const max = Slice.maxOpen(out.content)
      expect(out.openStart).toBeLessThanOrEqual(max.openStart)
      expect(out.openEnd).toBeLessThanOrEqual(max.openEnd)
      if (out.openStart) expect(out.content.firstChild.type.name).not.toBe('askInsert')
      if (out.openEnd) expect(out.content.lastChild.type.name).not.toBe('askInsert')
    }
    const whole = ed.state.doc.slice(a, a + node.nodeSize, true)
    expect(unwrapOpenContainers(whole)).toBe(whole)
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

// G-064 final fix wave (I1) — the chip's `claim`: MISSING means "unknown" (a
// share-reduced copy carries only `n`), and must read null; a PRESENT empty
// claim is a real value (a paragraph holding only chips has claim '') and must
// survive a round trip as '' rather than collapse into "unknown".
describe("the citation chip's claim: missing is unknown, empty is real (final wave, I1)", () => {
  function claimOf(spanAttr) {
    const html = `<div data-type="ask-insert"><p>Hi <span data-type="ask-citation" data-n="1"${spanAttr}>[1]</span></p></div>`
    return generateJSON(html, EXT).content[0].content[0].content[1].attrs.claim
  }

  it('no data-claim at all parses to null', () => {
    expect(claimOf('')).toBeNull()
  })

  it('an empty data-claim parses to the real empty claim', () => {
    expect(claimOf(' data-claim=""')).toBe('')
  })

  it('a chip-only paragraph keeps its empty claim through an HTML round trip', () => {
    const chipOnly = buildAskInsertNode({ answer: '[1]', sources: [SRC], insertedAt: '2026-09-22T12:00:00.000Z' })
    expect(chipOnly.content[0].content[0].attrs.claim).toBe('')
    const doc = { type: 'doc', content: [chipOnly] }
    const json = generateJSON(generateHTML(doc, EXT), EXT)
    expect(json.content[0].content[0].content[0].attrs.claim).toBe('')
  })

  it('a chip with no claim is never marked stale, even in a paragraph with text', () => {
    const ed = mount({ type: 'doc', content: [{
      type: 'askInsert', attrs: { insertedAt: null, scope: null, question: '' },
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Margins fell ' }, { type: 'askCitation', attrs: { n: 1 } },
      ] }],
    }] })
    expect(askCitationStaleKey.getState(ed.state).find()).toHaveLength(0)
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
    // G-064 fix round 1 (Finding F7): exactly ONE empty paragraph follows the
    // answer, never more -- so the shape is exact: the original paragraph,
    // the askInsert, and that one trailing paragraph. (Since the close-out it
    // is appendAskInsert's own, added to carry the caret; StarterKit's
    // TrailingNode then has nothing to add.)
    expect(ed.state.doc.childCount).toBe(3)
    expect(ed.state.doc.child(0).textContent).toBe('Mine.')
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
    expect(ed.state.doc.child(2).type.name).toBe('paragraph')
    expect(ed.state.doc.child(2).textContent).toBe('')
  })

  // G-064 final fix wave (M3) — a note that ends with an EMPTY paragraph (the
  // usual state of a note whose last line is blank) used to get the answer
  // AFTER that blank line, leaving a visible gap above it. The empty paragraph
  // is now replaced; the one after the answer is the single one, as above.
  it('replaces a trailing EMPTY paragraph instead of leaving a blank line above the answer', () => {
    const ed = mount({ type: 'doc', content: [MINE, { type: 'paragraph' }] })
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    expect(ed.state.doc.childCount).toBe(3)
    expect(ed.state.doc.child(0).textContent).toBe('Mine.')
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
    expect(ed.state.doc.child(2).type.name).toBe('paragraph')
    expect(ed.state.doc.child(2).textContent).toBe('')
  })

  it('an empty note gets the answer first, with no blank line above it', () => {
    const ed = mount({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    expect(ed.state.doc.childCount).toBe(2)
    expect(ed.state.doc.child(0).type.name).toBe('askInsert')
    expect(ed.state.doc.child(1).textContent).toBe('')
  })

  it('refuses a missing, destroyed or read-only editor', () => {
    const ed = mount({ type: 'doc', content: [MINE] })
    ed.setEditable(false)
    expect(appendAskInsert(ed, INSERT)).toBe(false)
    expect(appendAskInsert(null, INSERT)).toBe(false)
    expect(ed.state.doc.childCount).toBe(1)
  })
})

// G-064 close-out — `insertContentAt` leaves the selection at the end of what
// it inserted, INSIDE the answer's last paragraph. If the editor regained focus
// without a click, the member's next words went into the answer, were labelled
// "From Ask Notebook" and were left out of Ask. The caret now lands in the
// empty paragraph after the block, in the insert's own transaction.
describe('appendAskInsert leaves the caret after the answer, never in it (close-out)', () => {
  function mountWith(extensions, content) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions, content })
    return editor
  }
  const insideAnAnswer = ($pos) => {
    for (let d = $pos.depth; d > 0; d -= 1) if ($pos.node(d).type.name === 'askInsert') return true
    return false
  }
  const SHAPES = {
    'after member prose': { type: 'doc', content: [MINE] },
    'over a trailing empty paragraph': { type: 'doc', content: [MINE, { type: 'paragraph' }] },
    'into an empty note': { type: 'doc', content: [{ type: 'paragraph' }] },
    'after an earlier answer': { type: 'doc', content: [MINE, INSERT] },
  }

  // The REAL extension list: it is what a note's editor runs.
  for (const [name, content] of Object.entries(SHAPES)) {
    it(`${name}: the caret is in the empty paragraph after the block, and typing lands there`, () => {
      const ed = mountWith(buildExtensions(), content)
      ed.commands.setTextSelection(1)
      expect(appendAskInsert(ed, INSERT)).toBe(true)

      const { selection, doc } = ed.state
      expect(selection.empty).toBe(true)
      expect(insideAnAnswer(selection.$from)).toBe(false)
      expect(selection.$from.parent).toBe(doc.lastChild)
      expect(doc.lastChild.type.name).toBe('paragraph')
      expect(doc.lastChild.content.size).toBe(0)
      expect(doc.child(doc.childCount - 2).type.name).toBe('askInsert')

      const answers = () => {
        const out = []
        ed.state.doc.forEach((n) => { if (n.type.name === 'askInsert') out.push(n.textContent) })
        return out
      }
      const before = answers()
      ed.commands.insertContent('x')
      expect(answers()).toEqual(before)
      expect(ed.state.doc.lastChild.type.name).toBe('paragraph')
      expect(ed.state.doc.lastChild.textContent).toBe('x')
      expect(insideAnAnswer(ed.state.selection.$from)).toBe(false)
    })
  }

  // TrailingNode appends only AFTER a transaction, so it cannot carry the
  // caret; the paragraph is appendAskInsert's own, and a host without
  // TrailingNode gets it too.
  it('without TrailingNode, the paragraph after the answer is still there and holds the caret', () => {
    const ed = mountWith([StarterKit.configure({ trailingNode: false }), AskInsert, AskCitation],
      { type: 'doc', content: [MINE] })
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    expect(ed.state.doc.childCount).toBe(3)
    expect(ed.state.doc.lastChild.type.name).toBe('paragraph')
    expect(ed.state.doc.lastChild.content.size).toBe(0)
    expect(ed.state.selection.$from.parent).toBe(ed.state.doc.lastChild)
  })

  it('does not take focus: on the click path focus belongs to the Ask panel', async () => {
    const ed = mountWith(buildExtensions(), { type: 'doc', content: [MINE] })
    const askButton = document.createElement('button')
    document.body.appendChild(askButton)
    askButton.focus()
    expect(document.activeElement).toBe(askButton)
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    // TipTap's `focus` command focuses on a later animation frame, so a
    // synchronous check alone could not see it.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(document.activeElement).toBe(askButton)
    expect(ed.isFocused).toBe(false)
    askButton.remove()
  })

  it('is ONE transaction: a single undo removes the answer and its paragraph together', () => {
    const start = { type: 'doc', content: [MINE, { type: 'paragraph' }] }
    const ed = mountWith(buildExtensions(), start)
    const original = JSON.stringify(ed.getJSON())
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    ed.commands.undo()
    expect(JSON.stringify(ed.getJSON())).toBe(original)
  })
})
