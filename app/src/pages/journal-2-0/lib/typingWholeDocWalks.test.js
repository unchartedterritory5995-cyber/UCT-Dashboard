// Wave 10 (lane TY, standard 4 -- "typing < 16 ms/char up to the size cap").
// docs/notebook/perf-budgets.md: typing is over its 16 ms/char line at every
// measured size. Two extensions in EVERY note's roster (buildExtensions()) used
// to re-walk the WHOLE document on every keystroke regardless of whether the
// note held the node type each one cares about:
//   - codeBlockNode.js's `view()` asked `hasCodeBlock(doc, 'codeBlock')` on every
//     transaction, forever, in any note that has never held a code block --
//     because nothing ever set `requested` to short-circuit it.
//   - askCitationNode.jsx's staleness plugin recomputed `staleCitationDecorations`
//     (its own full walk) on every doc-changing transaction, unconditionally --
//     no gate on whether the note has ever held an Ask citation chip at all.
// Both are fixed the same way: track "has this doc EVER held one" INCREMENTALLY
// (lib/stepInsertsNodeType.js), from the transaction's own inserted content,
// never by re-walking the document. This file is the rail for that shared
// helper, for the transition each fix has to get right (a note BORN without the
// node type, which GAINS its first one live -- the one case none of the other
// per-extension test files exercise, since they all start from a doc that
// already holds one), and a structural rail proving the walk is gone from the
// keystroke path.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { Fragment, Node as PMNode } from '@tiptap/pm/model'
import { buildExtensions } from './tiptap'
import { fragmentHasNodeType, stepsIntroduceNodeType } from './stepInsertsNodeType'
import { askCitationStaleKey } from './askCitationNode'
import { appendAskInsert, buildAskInsertNode } from './askInsert'
import { codeHighlightPluginKey } from './codeBlockNode'
import { highlighterLoader } from './codeLanguages'
import { readToolbarFormatState } from '../components/notebook/NoteEditorPage'

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

function mount(content, extensions = buildExtensions()) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions, content: { type: 'doc', content } })
  return editor
}
const P = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const findInsert = (ed) => {
  let found = null
  ed.state.doc.forEach((node, offset) => { if (!found && node.type.name === 'askInsert') found = { a: offset, node } })
  return found
}

describe('lib/stepInsertsNodeType.js', () => {
  it('finds the target node at the top level of a slice', () => {
    const ed = mount([P('hi')])
    const code = ed.schema.nodes.codeBlock.create(null, ed.schema.text('x'))
    expect(fragmentHasNodeType(Fragment.from(code), 'codeBlock')).toBe(true)
  })

  it('tells apart "not there" from "there, but nested inside something else"', () => {
    const ed = mount([P('hi')])
    const para = ed.schema.nodes.paragraph.create(null, ed.schema.text('x'))
    expect(fragmentHasNodeType(Fragment.from(para), 'codeBlock')).toBe(false)
    const code = ed.schema.nodes.codeBlock.create(null, ed.schema.text('x'))
    const wrapped = ed.schema.nodes.blockquote.create(null, code)
    expect(fragmentHasNodeType(Fragment.from(wrapped), 'codeBlock')).toBe(true)
  })

  it('a transaction with no doc-changing step (e.g. a bare selection move) introduces nothing', () => {
    const ed = mount([P('hi')])
    const tr = ed.state.tr.setSelection(ed.state.selection)
    expect(tr.docChanged).toBe(false)
    expect(stepsIntroduceNodeType(tr, 'codeBlock')).toBe(false)
  })

  it('a plain-text insertion introduces nothing', () => {
    const ed = mount([P('hi')])
    const tr = ed.state.tr.insertText('more words', 1)
    expect(stepsIntroduceNodeType(tr, 'codeBlock')).toBe(false)
  })

  it('a step that inserts the target node type at the top of its slice is caught', () => {
    const ed = mount([P('hi')])
    const code = ed.schema.nodes.codeBlock.create(null, ed.schema.text('x'))
    const tr = ed.state.tr.replaceWith(0, ed.state.doc.content.size, code)
    expect(stepsIntroduceNodeType(tr, 'codeBlock')).toBe(true)
  })
})

describe('codeBlockNode: the highlighter still loads the first time a code block appears live in a note born without one', () => {
  it('never fetched while the note stays plain text -- many small keystroke-shaped edits', async () => {
    const spy = vi.spyOn(highlighterLoader, 'load')
    const ed = mount([P('price reclaimed the 20 EMA on rising volume')])
    for (let i = 0; i < 15; i += 1) {
      ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()
    }
    ed.commands.toggleHeading({ level: 2 })
    await new Promise((r) => setTimeout(r, 0))
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('toggleCodeBlock() on a note that has never held one triggers exactly one fetch', () => {
    const spy = vi.spyOn(highlighterLoader, 'load')
    const ed = mount([P('a swing trade note'), P('nothing to highlight yet')])
    ed.commands.setTextSelection(3)
    ed.commands.toggleCodeBlock()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('a code block inserted elsewhere (selection stays outside it) also flips hasBlock -- checked directly against plugin state, never the loader spy: an EARLIER test in this file may already have loaded the highlighter for good, which would make a spy-call-count assertion here order-dependent on something this fix does not own', () => {
    const ed = mount([P('leading paragraph'), P('trailing paragraph')])
    expect(codeHighlightPluginKey.getState(ed.state).hasBlock).toBe(false)
    ed.chain()
      .insertContentAt(ed.state.doc.content.size,
        { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'x=1' }] },
        { updateSelection: false })
      .run()
    expect(codeHighlightPluginKey.getState(ed.state).hasBlock).toBe(true)
  })
})

describe('askCitationNode: staleness still activates the first time a citation chip appears live in a note born without one', () => {
  const SRC = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
  const INSERT = buildAskInsertNode({
    answer: 'Margins fell [1].', sources: [SRC], question: 'q', scope: 'note',
    insertedAt: '2026-09-22T12:00:00.000Z',
  })

  it('a fresh live insert is not stale; editing its paragraph afterwards makes it so', () => {
    const ed = mount([P('Mine.'), P('After.')])
    expect(askCitationStaleKey.getState(ed.state).find()).toHaveLength(0)
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    expect(askCitationStaleKey.getState(ed.state).find()).toHaveLength(0)
    const at = findInsert(ed).a
    ed.chain().setTextSelection(at + 2).insertContent('Really, ').run()
    expect(askCitationStaleKey.getState(ed.state).find()).toHaveLength(1)
  })

  it('typing in an unrelated paragraph of a citation-less note never marks anything stale', () => {
    const ed = mount([P('Mine.'), P('After.')])
    for (let i = 0; i < 10; i += 1) {
      ed.chain().setTextSelection(1).insertContent('x').run()
    }
    expect(askCitationStaleKey.getState(ed.state).find()).toHaveLength(0)
  })
})

describe('structural rail: neither extension re-walks the document once neither node type is present', () => {
  // columnsGuard does its OWN two whole-document walks per keystroke
  // (perf-budgets.md: measured and ruled out, 0.07/0.12 ms at 2,000 paragraphs
  // in Node) -- unmodified by this wave. Excluding it is what makes a raw call
  // COUNT meaningful for the two walks this wave actually removed.
  const extensions = () => buildExtensions().filter((e) => e.name !== 'columnsGuard')

  it('20 keystrokes in a plain note call Node.prototype.descendants zero additional times', () => {
    const ed = mount([P('price reclaimed the 20 EMA on rising volume')], extensions())
    const spy = vi.spyOn(PMNode.prototype, 'descendants')
    for (let i = 0; i < 20; i += 1) {
      ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('control: the same shape of edit DOES call it when a citation chip already exists (the correctness path this wave leaves alone) -- a citation, not a code block, because it needs no async highlighter load to stay deterministic here', () => {
    const ed = mount([{
      type: 'askInsert', attrs: { insertedAt: null, scope: null, question: '' },
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Margins fell ' }, { type: 'askCitation', attrs: { n: 1 } },
      ] }],
    }], extensions())
    const insertAt = findInsert(ed).a + 1
    const spy = vi.spyOn(PMNode.prototype, 'descendants')
    for (let i = 0; i < 5; i += 1) {
      ed.chain().setTextSelection(insertAt).insertContent('y').run()
    }
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  // Wave 10 (lane TY7, "whose caller" perf pass). A THIRD whole-doc walk, a
  // size-scaling cost ty5 left named only by self time (nodesBetween /
  // matchType / forEach / child / posBeforeChild, prosemirror-model's own
  // Fragment.nodesBetween, which iterates its children from index 0 up to
  // `to` REGARDLESS of `from`) -- traced by a CPU-profile call-tree walk
  // (docs/notebook/perf-runs/ty7/) to `@tiptap/core`'s `isNodeActive`, called
  // by `readToolbarFormatState` (NoteEditorPage.jsx) 6 times EVERY
  // keystroke (heading x2, bulletList, orderedList, blockquote, codeBlock).
  // `nodeActiveAtCursor` (lib/fastToolbarProbes.js) answers the same
  // collapsed-selection question from `$from`'s own resolved ancestor chain
  // instead -- an O(1) array index per depth, never `Fragment.nodesBetween`.
  //
  // ⛔ A literal "zero nodesBetween calls" assertion for typing alone would be
  // FALSE, and measuring that (not assuming it) is what this rail is for:
  // `@tiptap/extension-link`'s own built-in `autolink` plugin calls
  // `findChildrenInRange`/`textBetween` from its `appendTransaction` on every
  // doc-changing transaction -- genuinely, correctly scoped to
  // `getChangedRanges(transform)` (the transaction's own local edit), never
  // the whole doc. It still costs nodesBetween calls near the TAIL of a flat
  // document, because `Fragment.prototype.nodesBetween`'s own loop
  // (`for (let i = 0, pos = 0; pos < to; i++)`) starts at index 0 regardless
  // of how narrow `[from, to]` is -- the SAME core-machinery tax ty5's own
  // README names for point 2, paid by a correctly-scoped VENDOR call site
  // this lane does not own and is not fixing. So the rail compares
  // readToolbarFormatState's OWN marginal contribution against that baseline,
  // not against a hand-picked zero.
  it('readToolbarFormatState, called on a FLAT 300-paragraph note with the caret at the END (the exact shape this size-scaling cost was measured on), adds only a ONE-TIME, bounded nodesBetween cost on top of the pre-existing (vendor, correctly-scoped, left alone) typing baseline -- never a PER-KEYSTROKE one', () => {
    // canBlockquoteFast's memoization still pays for the first, necessary
    // evaluation of canRunHistory(editor, 'toggleBlockquote') -- which, per
    // prosemirror-commands' own `toggleWrap`, checks "is this already a
    // blockquote" via isNodeActive internally (2 more nodesBetween calls for
    // this doc's ancestor depth, traced via a stack-trace diagnostic, not
    // guessed). That is a REAL, bounded, ONE-TIME cost -- never repeated for
    // a keystroke that does not change the block context -- so the rail
    // measures the delta at 20 keystrokes AND at 40, and asserts it does NOT
    // grow between them (the signature this lane actually fixed: the cost no
    // longer scales with how long you keep typing).
    const paras = () => { const a = []; for (let i = 0; i < 300; i += 1) a.push(P(`p${i}`)); return a }

    const baselineAfter = (n) => {
      const ed = mount(paras(), extensions())
      ed.chain().setTextSelection(ed.state.doc.content.size - 1).run()
      const spy = vi.spyOn(PMNode.prototype, 'nodesBetween')
      for (let i = 0; i < n; i += 1) ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()
      const calls = spy.mock.calls.length
      spy.mockRestore()
      ed.destroy()
      return calls
    }
    const withToolbarAfter = (n) => {
      const ed = mount(paras(), extensions())
      ed.chain().setTextSelection(ed.state.doc.content.size - 1).run()
      const spy = vi.spyOn(PMNode.prototype, 'nodesBetween')
      for (let i = 0; i < n; i += 1) {
        ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()
        // NoteEditorPage calls readToolbarFormatState on every 'transaction'/
        // 'selectionUpdate' event, which is every keystroke.
        readToolbarFormatState(ed)
      }
      const calls = spy.mock.calls.length
      spy.mockRestore()
      ed.destroy()
      return calls
    }

    const base20 = baselineAfter(20)
    const base40 = baselineAfter(40)
    expect(base20).toBeGreaterThan(0) // non-vacuity: the baseline is real, not a spy that never fires
    expect(base40).toBeGreaterThan(base20) // and it DOES scale with keystrokes (the Link plugin's own cost, unrelated)

    const delta20 = withToolbarAfter(20) - base20
    const delta40 = withToolbarAfter(40) - base40
    expect(delta20).toBeGreaterThan(0) // the one-time cost is real, not zero by construction
    expect(delta20).toBeLessThanOrEqual(4) // small: one cache-miss evaluation's own internal cost
    expect(delta40).toBe(delta20) // and it does NOT grow between 20 and 40 keystrokes -- never per-keystroke
  })

  // Mutation target for the rail above: reverting `nodeActiveAtCursor` back
  // to a direct `editor.isActive(...)` call in `readToolbarFormatState` must
  // make `withToolbarCalls` EXCEED `baselineCalls` (6 extra isNodeActive
  // walks a keystroke, each several nodesBetween calls deep for a nested
  // ancestor chain) -- proving the rail above can actually fail, not just
  // read as reassuring.
  it('control: calling the REAL editor.isActive(nodeType) directly (what readToolbarFormatState used to do) DOES add nodesBetween calls on top of the same typing baseline', () => {
    const paras = []
    for (let i = 0; i < 300; i += 1) paras.push(P(`p${i}`))
    const ed = mount(paras, extensions())
    ed.chain().setTextSelection(ed.state.doc.content.size - 1).run()
    const spy = vi.spyOn(PMNode.prototype, 'nodesBetween')
    ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('x').run()
    const afterTyping = spy.mock.calls.length
    ed.isActive('bulletList')
    expect(spy.mock.calls.length).toBeGreaterThan(afterTyping)
    spy.mockRestore()
  })
})
