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
})
