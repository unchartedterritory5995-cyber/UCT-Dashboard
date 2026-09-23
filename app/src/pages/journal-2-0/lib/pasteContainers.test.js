// pasteContainers.js — behavioural rails, written against the REAL extension
// roster (buildExtensions) and the REAL clipboard path: `serializeForClipboard`
// for the copy, `view.pasteHTML` / `view.pasteText` for the paste.
//
// RED BEFORE ITS FIX: every rail not listed below was red against the code
// before the fix it pins -- a throw, a lost paste, a callout/toggle wrapped
// around member prose, a toggle split by a paste or a drop into its title, a
// node dropped or flattened there, a copied chart keeping its source's
// embedId, a chart pasted over itself losing its own.
// GREEN BOTH WAYS, BY DESIGN -- they pin what a fix must NOT change:
//  - every rail named CONTROL (a whole block keeps its wrapper, a one-line
//    paste into a title is still ProseMirror's own, an empty title fills with
//    pasted text, a paste is one undo step, an ordinary drop is byte-identical
//    to ProseMirror's own);
//  - the drag OUT of a title's own text (judged after the source is removed);
//  - the five keep-the-id embed rails: cut + paste, a paste into another note,
//    a legacy embed, a moved drag, a drag begun as a copy but dropped as a move.
//
// EMBED IDS: a chart pasted or dropped into the note it came from gets a fresh
// embedId when its own would collide; a cut, a moved drag, a paste into another
// note and a legacy (id-less) embed keep what they have.
//
// DROPS: ProseMirror runs transformPasted on a drop but never handlePaste, so
// the drop rails drive the plugin's handleDrop. jsdom has no layout, so
// view.posAtCoords is STUBBED to the position under test, and handleDrop is
// driven the way prosemirror-view's own editHandlers.drop calls it --
// view.someProp('handleDrop', f => f(view, event, slice, moved)) -- with
// view.dragging set as a real drag leaves it. SIX rails (three title drops,
// three chart drops) and the three drop-CONTROL cases instead dispatch a real
// DOM `drop` event (domDrop), so that handler runs whole.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import { buildExtensions } from './tiptap'
import { buildAskInsertNode } from './askInsert'
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'

// jsdom has no layout: a drop ends with view.focus() (as editHandlers.drop
// does), which puts the DOM selection in the editor, and the next scrolled
// transaction (an undo) then measures the caret. Same stub as
// NoteEditorPage.attachments.test.jsx.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
// jsdom has no ClipboardEvent; `view.pasteHTML` constructs one.
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, opts) { super(type, opts); this.clipboardData = (opts && opts.clipboardData) || null }
  }
}

let editor
let warn
// The belt (handlePaste fallback) warns when it fires. Every behavioural rail
// asserts it did NOT fire, so a green rail proves the unwrap, not the belt.
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  editor?.destroy(); editor = null
  const fired = warn.mock.calls.filter((c) => String(c[0]).includes('[pasteContainers]'))
  warn.mockRestore()
  if (!expect.getState().currentTestName.includes('(belt)')) expect(fired).toEqual([])
})
function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const TOGGLE = { type: 'toggle', attrs: { open: true }, content: [
  { type: 'toggleSummary', content: [{ type: 'text', text: 'Summary line' }] },
  { type: 'toggleContent', content: [P('Toggle body.')] },
] }
const CALLOUT = { type: 'callout', attrs: { emoji: '🔥' }, content: [P('Inside callout.')] }
const SRC = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
const INSERT = buildAskInsertNode({ answer: 'Margins fell [1].', sources: [SRC], question: 'q', scope: 'note', insertedAt: '2026-09-22T12:00:00.000Z' })

const locate = (ed, str) => { let hit = null; ed.state.doc.descendants((n, pos) => { if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i } }); return hit }
const count = (ed, type) => { let c = 0; ed.state.doc.descendants((n) => { if (n.type.name === type) c += 1 }); return c }
const firstPos = (ed, type) => { let p = null; ed.state.doc.descendants((n, pos) => { if (p == null && n.type.name === type) p = pos }); return p }
const LIST_TOGGLE = { type: 'bulletList', content: [{ type: 'listItem', content: [P('Item.'), TOGGLE] }] }
const top = (ed) => { const o = []; ed.state.doc.forEach((n) => o.push(`${n.type.name}:${n.textContent}`)); return o }
function copyRange(ed, from, to) {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)))
  return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
}
function copyNode(ed, pos) {
  ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)))
  return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
}
function pasteAt(ed, pos, html) { ed.commands.setTextSelection(pos); ed.view.pasteHTML(html); ed.state.doc.check() }

describe('a toggle-spanning paste never throws (bug 1)', () => {
  it('summary -> body selection, pasted at the END of a member paragraph, lands as plain text', () => {
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    const html = copyRange(ed, locate(ed, 'mmary'), locate(ed, 'body'))
    expect(() => pasteAt(ed, locate(ed, 'After.') + 'After.'.length, html)).not.toThrow()
    expect(count(ed, 'toggle')).toBe(1)
    expect(top(ed)).toEqual(['paragraph:Mine.', 'toggle:Summary lineToggle body.', 'paragraph:After.mmary line', 'paragraph:Toggle '])
  })

  it('summary -> body selection, pasted in the MIDDLE of a member paragraph, splits it around plain text', () => {
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    const html = copyRange(ed, locate(ed, 'mmary'), locate(ed, 'body'))
    expect(() => pasteAt(ed, locate(ed, 'After.') + 3, html)).not.toThrow()
    expect(count(ed, 'toggle')).toBe(1)
    expect(top(ed)).toEqual(['paragraph:Mine.', 'toggle:Summary lineToggle body.', 'paragraph:Aftmmary line', 'paragraph:Toggle er.'])
  })

  it('the same selection from a toggle nested in a LIST ITEM does not throw either', () => {
    const ed = mount([P('Mine.'), LIST_TOGGLE, P('After.')])
    const html = copyRange(ed, locate(ed, 'mmary'), locate(ed, 'body'))
    expect(() => pasteAt(ed, locate(ed, 'After.') + 'After.'.length, html)).not.toThrow()
    expect(count(ed, 'toggle')).toBe(1)
    expect(ed.state.doc.textContent).toBe('Mine.Item.Summary lineToggle body.After.mmary lineToggle ')
  })

  it('foreign <details> HTML (no data-pm-slice) pasted mid-paragraph does not throw and keeps every word', () => {
    const ed = mount([P('Mine.'), P('After.')])
    expect(() => pasteAt(ed, 3, '<details><summary>Sum</summary><p>Body one.</p></details>')).not.toThrow()
    expect(ed.state.doc.textContent).toBe('MiSumBody one.ne.After.')
    expect(count(ed, 'toggle')).toBe(0)
  })

  it('a copy that opens a toggle past its summary round-trips through the clipboard (copy side)', () => {
    // doc.slice(22, 39): from between the summary and the body to just after
    // the toggle -- serialised without the copy hook as <details> with no
    // <summary>, which prosemirror-view's closeSlice cannot re-read.
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    const summaryEnd = locate(ed, 'Summary line') + 'Summary line'.length + 1 // after </summary>
    const toggleEnd = firstPos(ed, 'toggle') + ed.state.doc.nodeAt(firstPos(ed, 'toggle')).nodeSize
    const html = ed.view.serializeForClipboard(ed.state.doc.slice(summaryEnd, toggleEnd, true)).dom.innerHTML
    expect(() => pasteAt(ed, locate(ed, 'After.'), html)).not.toThrow()
    expect(ed.state.doc.textContent).toBe('Mine.Summary lineToggle body.Toggle body.After.')
    expect(count(ed, 'toggle')).toBe(1)
  })
})

describe('a partial callout / toggle copy never wraps member prose (bug 2)', () => {
  it('a word copied from inside a callout, pasted at the start of a member paragraph, is plain text there', () => {
    const ed = mount([P('Mine.'), CALLOUT, P('After.')])
    const at = locate(ed, 'side')
    pasteAt(ed, locate(ed, 'After.'), copyRange(ed, at, at + 3))
    expect(count(ed, 'callout')).toBe(1)
    expect(top(ed)).toEqual(['paragraph:Mine.', 'callout:Inside callout.', 'paragraph:sidAfter.'])
  })

  it('a word copied from a toggle SUMMARY, pasted at the start of a member paragraph, creates no toggle', () => {
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    const at = locate(ed, 'mmary')
    pasteAt(ed, locate(ed, 'After.'), copyRange(ed, at, at + 3))
    expect(count(ed, 'toggle')).toBe(1)
    expect(top(ed)).toEqual(['paragraph:Mine.', 'toggle:Summary lineToggle body.', 'paragraph:mmaAfter.'])
  })

  it('a callout nested inside an answer: a partial copy pasted at a member paragraph start creates neither', () => {
    const DEEP = { type: 'askInsert', attrs: INSERT.attrs, content: [CALLOUT, ...INSERT.content] }
    const ed = mount([P('Mine.'), DEEP, P('After.')])
    const at = locate(ed, 'side')
    pasteAt(ed, 1, copyRange(ed, at, at + 3))
    expect(count(ed, 'askInsert')).toBe(1)
    expect(count(ed, 'callout')).toBe(1)
    expect(top(ed)[0]).toBe('paragraph:sidMine.')
  })
})

describe('each hook has a rail only it can pass', () => {
  it('COPY side: a partial toggle / callout copy puts no container on the clipboard', () => {
    const ed = mount([P('Mine.'), TOGGLE, CALLOUT, P('After.')])
    const toggleHtml = copyRange(ed, locate(ed, 'mmary'), locate(ed, 'body'))
    const calloutHtml = copyRange(ed, locate(ed, 'side'), locate(ed, 'side') + 3)
    expect(toggleHtml).not.toContain('<details')
    expect(calloutHtml).not.toContain('data-type="callout"')
    // ...and the text still travels
    expect(toggleHtml).toContain('mmary line')
    expect(calloutHtml).toContain('sid')
  })

  it('PASTE side: foreign <aside> HTML pasted at the start of a member paragraph does not absorb it', () => {
    const ed = mount([P('Mine.'), P('After.')])
    pasteAt(ed, 1, '<aside><p>Tip one.</p><p>Tip two.</p></aside>')
    expect(count(ed, 'callout')).toBe(0)
    expect(top(ed)).toEqual(['paragraph:Tip one.', 'paragraph:Tip two.Mine.', 'paragraph:After.'])
  })

  it('PASTE side: a clipboard written WITHOUT the copy hook (an older bundle) still pastes as plain text', () => {
    // The copying editor lacks the plugin (a tab still running an older
    // bundle); without the paste hook this is the plain bug.
    const el = document.createElement('div')
    document.body.appendChild(el)
    const old = new Editor({ element: el, extensions: buildExtensions().filter((e) => e.name !== 'pasteContainers'),
      content: { type: 'doc', content: [P('Mine.'), CALLOUT, P('After.')] } })
    const at = locate(old, 'side')
    const html = copyRange(old, at, at + 3)
    old.destroy()
    expect(html).toContain('callout') // the stale clipboard really carries the wrapper
    const ed = mount([P('Mine.'), CALLOUT, P('After.')])
    pasteAt(ed, locate(ed, 'After.'), html)
    expect(count(ed, 'callout')).toBe(1)
    expect(top(ed)).toEqual(['paragraph:Mine.', 'callout:Inside callout.', 'paragraph:sidAfter.'])
  })
})

describe('a WHOLE block still pastes as that block (controls: green before and after)', () => {
  for (const [label, block, type] of [['callout', CALLOUT, 'callout'], ['toggle', TOGGLE, 'toggle']]) {
    it(`a whole ${label} copied as a node pastes as a second ${label}, attrs intact`, () => {
      const ed = mount([P('Mine.'), block, P('After.')])
      pasteAt(ed, locate(ed, 'After.') + 'After.'.length, copyNode(ed, firstPos(ed, type)))
      expect(count(ed, type)).toBe(2)
      const second = []
      ed.state.doc.descendants((n) => { if (n.type.name === type) second.push(n) })
      expect(second[1].attrs).toEqual(second[0].attrs)
      expect(second[1].textContent).toBe(second[0].textContent)
    })
  }
})

// A toggle's summary is a one-line title (`inline*`). Measured before the fix:
// plain two-line text pasted into a summary produced `toggle(summary "plain
// words", empty body)`, `paragraph("second lineSummary line")`,
// `toggle(empty summary, original body)` -- one toggle split into two around
// the pasted blocks. The ruling (fix round 1): TEXT joins into the title with
// its marks and inline atoms; anything carrying STRUCTURE lands whole AFTER
// the toggle; at the very start of a non-empty title everything lands ABOVE it;
// a one-line paste stays ProseMirror's own. No rule may split the toggle, drop
// a node, or flatten a closed block.
const CHIP = { type: 'attachmentChip', attrs: { href: 'https://example.com/f.pdf', name: 'report.pdf', size: 1234 } }
const EMPTY_TITLE_TOGGLE = { type: 'toggle', attrs: { open: true }, content: [
  { type: 'toggleSummary' },
  { type: 'toggleContent', content: [P('Toggle body.')] },
] }
const summaryOf = (ed) => { let s = null; ed.state.doc.descendants((n) => { if (s == null && n.type.name === 'toggleSummary') s = n.textContent }); return s }
const bodyOf = (ed) => { let s = null; ed.state.doc.descendants((n) => { if (s == null && n.type.name === 'toggleContent') s = n.textContent }); return s }
const nodesOf = (ed, type) => { const o = []; ed.state.doc.descendants((n, pos) => { if (n.type.name === type) o.push({ n, pos }) }); return o }

describe('a multi-block TEXT paste into a toggle SUMMARY joins into that summary as one line', () => {
  const CASES = [
    ['plain two-line text', (ed) => ed.view.pasteText('plain words\nsecond line'), 'plain words second line'],
    ['a multi-paragraph HTML paste', (ed) => ed.view.pasteHTML('<p>First para.</p><p>Second para.</p>'), 'First para. Second para.'],
  ]
  for (const [label, paste, joined] of CASES) {
    it(`${label}: exactly one toggle, the summary holds the joined text, the body is unchanged`, () => {
      const ed = mount([P('Mine.'), TOGGLE, P('After.')])
      ed.commands.setTextSelection(locate(ed, 'ary line')) // "Summ|ary line"
      paste(ed)
      ed.state.doc.check()
      expect(count(ed, 'toggle')).toBe(1)
      expect(summaryOf(ed)).toBe(`Summ${joined}ary line`)
      expect(bodyOf(ed)).toBe('Toggle body.')
      expect(top(ed)).toEqual(['paragraph:Mine.', `toggle:Summ${joined}ary lineToggle body.`, 'paragraph:After.'])
      // The caret sits right after what was pasted, as ProseMirror leaves it.
      expect(ed.state.selection.$from.parent.type.name).toBe('toggleSummary')
      expect(ed.state.selection.$from.parent.textContent.slice(ed.state.selection.$from.parentOffset)).toBe('ary line')
    })
  }

  it('marks, a note link and a hard break survive: the INLINE content is joined, not its plain text', () => {
    const ed = mount([
      { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: 'one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ital', marks: [{ type: 'italic' }] }, { type: 'text', text: ' two ' }, { type: 'noteLink', attrs: { noteId: 'n42' } }] },
      TOGGLE, P('After.'),
    ])
    const html = copyRange(ed, 1, 21) // from the start of "Bold" to just after the note link
    ed.commands.setTextSelection(locate(ed, 'ary line'))
    ed.view.pasteHTML(html)
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('SummBold one Ital two ary line') // the hard break became a space
    const inSummary = []
    ed.state.doc.descendants((n) => { if (n.type.name === 'toggleSummary') n.forEach((c) => inSummary.push(c)) })
    expect(inSummary.find((c) => c.text === 'Bold').marks.map((m) => m.type.name)).toEqual(['bold'])
    expect(inSummary.find((c) => c.text === 'Ital').marks.map((m) => m.type.name)).toEqual(['italic'])
    expect(inSummary.filter((c) => c.type.name === 'noteLink').map((c) => c.attrs.noteId)).toEqual(['n42'])
    expect(inSummary.some((c) => c.type.name === 'hardBreak')).toBe(false)
    expect(count(ed, 'noteLink')).toBe(2) // the original and the pasted one
  })

  it('CONTROL: an EMPTY title takes a text paste as its text -- nothing goes above or below the toggle', () => {
    const ed = mount([P('Mine.'), EMPTY_TITLE_TOGGLE, P('After.')])
    ed.commands.setTextSelection(firstPos(ed, 'toggleSummary') + 1)
    ed.view.pasteHTML('<p>First para.</p><p>Second para.</p>')
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('First para. Second para.')
    expect(top(ed)).toEqual(['paragraph:Mine.', 'toggle:First para. Second para.Toggle body.', 'paragraph:After.'])
  })

  // Ruling (a): only empty lines change nothing at EVERY position in the title
  // -- its START included, where rule 3 would otherwise put them above the toggle.
  for (const [where, at] of [
    ['START', (ed) => locate(ed, 'Summary line')],
    ['middle', (ed) => locate(ed, 'ary line')],
    ['end', (ed) => locate(ed, 'Summary line') + 'Summary line'.length],
  ]) {
    for (const [clipLabel, clip] of [
      ['an empty line copied as a block', (ed) => copyNode(ed, ed.state.doc.child(0).nodeSize)], // the empty paragraph, as a node
      ['<p></p><p></p>', () => '<p></p><p></p>'],
    ]) {
      it(`${clipLabel}, pasted at the title's ${where}, changes nothing -- the toggle stays whole`, () => {
        const ed = mount([P('Mine.'), { type: 'paragraph' }, TOGGLE, P('After.')])
        const html = clip(ed)
        ed.commands.setTextSelection(at(ed))
        const was = ed.state.doc
        ed.view.pasteHTML(html)
        ed.state.doc.check()
        expect(ed.state.doc.eq(was)).toBe(true)
        expect(top(ed)).toEqual(['paragraph:Mine.', 'paragraph:', 'toggle:Summary lineToggle body.', 'paragraph:After.'])
      })
    }
  }

  it('CONTROL: a word pasted into a summary is still ProseMirror\'s own inline paste -- its bold survives', () => {
    const ed = mount([{ type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }] }, TOGGLE])
    const html = copyRange(ed, 1, 5)
    ed.commands.setTextSelection(locate(ed, 'ary line'))
    ed.view.pasteHTML(html)
    let marks = null
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'toggleSummary') n.forEach((c) => { if (c.text === 'Bold') marks = c.marks.map((m) => m.type.name) })
    })
    expect(summaryOf(ed)).toBe('SummBoldary line')
    expect(marks).toEqual(['bold']) // a text-only paste would have dropped the mark
  })
})

// Review I-1 / I-2: before this, a slice carrying a block atom lost it (the
// text path kept only textblock text) or, with no text at all, went back to
// ProseMirror and split the toggle; a whole Ask answer was flattened into the
// member's own title text, provenance gone.
describe('a paste into a toggle SUMMARY that carries STRUCTURE lands whole AFTER the toggle', () => {
  const MID = (ed) => ed.commands.setTextSelection(locate(ed, 'ary line')) // "Summ|ary line"
  const CASES = [
    ['text + an attachment chip + text, copied in the editor', [P('Look'), CHIP, P('here'), TOGGLE, P('After.')],
      (ed) => copyRange(ed, locate(ed, 'ook'), locate(ed, 'ere')),
      ['paragraph:ook', 'attachmentChip:', 'paragraph:h'], { attachmentChip: 2 }],
    ['<p>See</p><img>', [P('Mine.'), TOGGLE, P('After.')],
      () => '<p>See</p><img src="https://example.com/a.png">', ['paragraph:See', 'image:'], { image: 1 }],
    ['<p>Look</p><hr><p>here</p>', [P('Mine.'), TOGGLE, P('After.')],
      () => '<p>Look</p><hr><p>here</p>', ['paragraph:Look', 'horizontalRule:', 'paragraph:here'], { horizontalRule: 1 }],
    ['an attachment chip alone, copied as a node', [P('Look'), CHIP, TOGGLE, P('After.')],
      (ed) => copyNode(ed, firstPos(ed, 'attachmentChip')), ['attachmentChip:'], { attachmentChip: 2 }],
    ['a two-item list', [P('Mine.'), TOGGLE, P('After.')],
      () => '<ul><li>one</li><li>two</li></ul>', ['bulletList:onetwo'], { bulletList: 1, listItem: 2 }],
  ]
  for (const [label, doc, clip, landed, counts] of CASES) {
    it(`${label}: one toggle, the title unchanged, every pasted node right after the toggle`, () => {
      const ed = mount(doc)
      const html = clip(ed)
      const before = top(ed)
      MID(ed)
      ed.view.pasteHTML(html)
      ed.state.doc.check()
      expect(count(ed, 'toggle')).toBe(1)
      expect(summaryOf(ed)).toBe('Summary line')
      expect(bodyOf(ed)).toBe('Toggle body.')
      const at = before.indexOf('toggle:Summary lineToggle body.')
      expect(top(ed)).toEqual([...before.slice(0, at + 1), ...landed, ...before.slice(at + 1)])
      for (const [type, n] of Object.entries(counts)) expect(count(ed, type)).toBe(n)
    })
  }

  it('the pasted chip keeps its attrs, and the caret ends at the end of what was inserted', () => {
    const ed = mount([P('Look'), CHIP, P('here'), TOGGLE, P('After.')])
    const html = copyRange(ed, locate(ed, 'ook'), locate(ed, 'ere'))
    MID(ed)
    ed.view.pasteHTML(html)
    const chips = nodesOf(ed, 'attachmentChip')
    expect(chips).toHaveLength(2)
    expect(chips[1].n.attrs).toEqual(chips[0].n.attrs)
    expect(chips[1].pos).toBeGreaterThan(firstPos(ed, 'toggle'))
    const { $from, empty } = ed.state.selection
    expect(empty).toBe(true)
    expect($from.parent.textContent).toBe('h')
    expect($from.parentOffset).toBe(1)
  })

  it('a WHOLE Ask answer pasted mid-title lands whole after the toggle -- wrapper, attrs and citation chip intact', () => {
    const ed = mount([P('Mine.'), INSERT, TOGGLE, P('After.')])
    const html = copyNode(ed, firstPos(ed, 'askInsert'))
    MID(ed)
    ed.view.pasteHTML(html)
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('Summary line')
    const answers = nodesOf(ed, 'askInsert')
    expect(answers).toHaveLength(2)
    expect(answers[1].n.attrs).toEqual(answers[0].n.attrs)
    expect(answers[1].n.textContent).toBe(answers[0].n.textContent)
    expect(answers[1].pos).toBeGreaterThan(firstPos(ed, 'toggle'))
    expect(count(ed, 'askCitation')).toBe(2)
    expect(top(ed)).toEqual(['paragraph:Mine.', `askInsert:${answers[0].n.textContent}`,
      'toggle:Summary lineToggle body.', `askInsert:${answers[0].n.textContent}`, 'paragraph:After.'])
  })

  it('a WHOLE callout copied as a node lands whole after the toggle, attrs intact -- never as title text', () => {
    const ed = mount([P('Mine.'), CALLOUT, TOGGLE, P('After.')])
    const html = copyNode(ed, firstPos(ed, 'callout'))
    MID(ed)
    ed.view.pasteHTML(html)
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('Summary line')
    const callouts = nodesOf(ed, 'callout')
    expect(callouts).toHaveLength(2)
    expect(callouts[1].n.attrs).toEqual(callouts[0].n.attrs)
    expect(top(ed)).toEqual(['paragraph:Mine.', 'callout:Inside callout.', 'toggle:Summary lineToggle body.', 'callout:Inside callout.', 'paragraph:After.'])
  })

  it('a block with no text but real content (a rule) is never swallowed and never splits the toggle', () => {
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    MID(ed)
    ed.view.pasteHTML('<hr>')
    ed.state.doc.check()
    expect(count(ed, 'horizontalRule')).toBe(1)
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('Summary line')
    expect(top(ed)).toEqual(['paragraph:Mine.', 'toggle:Summary lineToggle body.', 'horizontalRule:', 'paragraph:After.'])
  })

  // Ruling (b): the content lands OUTSIDE the title, so deleting the member's
  // selected title text would be a change somewhere they were not looking.
  it('a title SELECTION is left untouched by a STRUCTURE paste -- the blocks land after the toggle', () => {
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    const at = locate(ed, 'ary line')
    ed.commands.setTextSelection({ from: at, to: at + 3 }) // "Summ[ary] line"
    ed.view.pasteHTML('<p>Look</p><hr><p>here</p>')
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('Summary line')
    expect(top(ed)).toEqual(['paragraph:Mine.', 'toggle:Summary lineToggle body.', 'paragraph:Look', 'horizontalRule:', 'paragraph:here', 'paragraph:After.'])
  })

  it('CONTROL: a TEXT-ONLY paste over a title selection still replaces it, as any inline paste does', () => {
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    const at = locate(ed, 'ary line')
    ed.commands.setTextSelection({ from: at, to: at + 3 }) // "Summ[ary] line"
    ed.view.pasteHTML('<p>First para.</p><p>Second para.</p>')
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('SummFirst para. Second para. line')
    expect(top(ed)).toEqual(['paragraph:Mine.', 'toggle:SummFirst para. Second para. lineToggle body.', 'paragraph:After.'])
  })

  it('CONTROL: the paste is ONE undo step -- undo restores the doc exactly', () => {
    const ed = mount([P('Mine.'), INSERT, TOGGLE, P('After.')])
    const html = copyNode(ed, firstPos(ed, 'askInsert'))
    MID(ed)
    const was = ed.state.doc
    ed.view.pasteHTML(html)
    expect(ed.state.doc.eq(was)).toBe(false)
    ed.commands.undo()
    expect(ed.state.doc.eq(was)).toBe(true)
  })
})

// Ruling (a): with the caret at the very START of a non-empty title, a
// multi-block paste goes ABOVE the toggle -- where ProseMirror put it before
// this plugin existed, now explicit -- so the title is never touched.
describe('a multi-block paste at the START of a non-empty toggle title lands ABOVE the toggle', () => {
  const START = (ed) => ed.commands.setTextSelection(locate(ed, 'Summary line'))
  for (const [label, html, landed] of [
    ['text', '<p>First para.</p><p>Second para.</p>', ['paragraph:First para.', 'paragraph:Second para.']],
    ['structure', '<p>Look</p><hr><p>here</p>', ['paragraph:Look', 'horizontalRule:', 'paragraph:here']],
  ]) {
    it(`${label}: the blocks go above, the title and body are unchanged`, () => {
      const ed = mount([P('Mine.'), TOGGLE, P('After.')])
      START(ed)
      ed.view.pasteHTML(html)
      ed.state.doc.check()
      expect(count(ed, 'toggle')).toBe(1)
      expect(summaryOf(ed)).toBe('Summary line')
      expect(top(ed)).toEqual(['paragraph:Mine.', ...landed, 'toggle:Summary lineToggle body.', 'paragraph:After.'])
    })
  }

  it('CONTROL: a one-line paste at the start of the title is still ProseMirror\'s inline paste, into the title', () => {
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    START(ed)
    ed.view.pasteText('Lead ')
    expect(summaryOf(ed)).toBe('Lead Summary line')
    expect(count(ed, 'toggle')).toBe(1)
  })
})

describe('the belt: a slice ProseMirror cannot place is pasted as text, never lost (belt)', () => {
  it('handlePaste falls back to plain text for the raw pre-fix toggle shape', () => {
    const ed = mount([P('Mine.'), P('After.')])
    const { schema } = ed.state
    // The exact shape the Fitter throws on: a toggle open 2/2 whose body is empty.
    const raw = new Slice(Fragment.from(schema.nodes.toggle.create({ open: true }, [
      schema.nodes.toggleSummary.create(null, schema.text('Summary line')),
      schema.nodes.toggleContent.create(null, Fragment.empty),
    ])), 2, 2)
    ed.commands.setTextSelection(locate(ed, 'After.') + 'After.'.length)
    expect(() => ed.state.tr.replaceSelection(raw)).toThrow(/invalid content/) // the shape really is fatal
    const handled = ed.view.someProp('handlePaste', (f) => f(ed.view, new ClipboardEvent('paste'), raw))
    expect(handled).toBe(true)
    expect(ed.state.doc.textContent).toContain('Summary line')
  })
})

// ── Drops ────────────────────────────────────────────────────────────────────
// A drag runs transformPasted but never handlePaste: prosemirror-view's
// editHandlers.drop asks the handleDrop props instead, so without a handleDrop
// neither the title rules nor the belt ran on a drop. jsdom has no layout --
// see the header: `dropAt` stubs view.posAtCoords and calls handleDrop the way
// editHandlers.drop does; `domDrop` dispatches a real `drop` event so that
// handler runs whole (transformPasted, the handleDrop props, its own insert).
const dropEvent = () => ({ clientX: 0, clientY: 0, preventDefault() {} })
function dropAt(ed, pos, slice, { moved = false, node = null } = {}) {
  ed.view.posAtCoords = () => ({ pos, inside: -1 })
  ed.view.dragging = { slice, move: moved, node }
  try { return ed.view.someProp('handleDrop', (f) => f(ed.view, dropEvent(), slice, moved)) } finally { ed.view.dragging = null }
}
// `startMove` is dragstart's own verdict (view.dragging.move); the drop event's
// modifier decides the drop's, and the two can differ.
function domDrop(ed, pos, slice, { copy = false, node = null, startMove = !copy } = {}) {
  ed.view.posAtCoords = () => ({ pos, inside: -1 })
  ed.view.dragging = { slice, move: startMove, node }
  const ev = new Event('drop', { bubbles: true, cancelable: true })
  Object.assign(ev, { clientX: 0, clientY: 0, ctrlKey: copy, altKey: copy }) // the copy modifier, either platform
  Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => '', files: [], types: [] } })
  ed.view.dom.dispatchEvent(ev)
  return ev
}
// Every doc-changing transaction a drop dispatches, by its `uiEvent` meta.
const changes = (ed) => { const seen = []; ed.on('transaction', ({ transaction }) => { if (transaction.docChanged) seen.push(transaction.getMeta('uiEvent')) }); return seen }
const TEXT_DOC = () => [P('First para.'), P('Second para.'), TOGGLE, P('After.')]
const textSource = (ed) => ({ from: locate(ed, 'st para.'), to: locate(ed, 'Second') + 'Second'.length }) // "Fir[st para. | Second] para."

describe('a DROP onto a toggle title follows the title rules -- the toggle is never split', () => {
  it('multi-block text COPIED onto the middle of a title joins into it -- one toggle, the source kept', () => {
    const ed = mount(TEXT_DOC())
    const { from, to } = textSource(ed)
    const slice = ed.state.doc.slice(from, to, true)
    ed.commands.setTextSelection(1) // the selection is NOT where the drop lands
    expect(dropAt(ed, locate(ed, 'ary line'), slice)).toBe(true)
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('Summst para. Secondary line')
    expect(top(ed)).toEqual(['paragraph:First para.', 'paragraph:Second para.', 'toggle:Summst para. Secondary lineToggle body.', 'paragraph:After.'])
    // As ProseMirror's own drop does, what was dropped ends up selected.
    const { from: sf, to: st } = ed.state.selection
    expect(ed.state.doc.textBetween(sf, st)).toBe('st para. Second')
  })

  it('multi-block text MOVED onto a title: the source goes, the text joins the title, ONE undo restores both', () => {
    const ed = mount(TEXT_DOC())
    const was = ed.state.doc
    const { from, to } = textSource(ed)
    ed.commands.setTextSelection({ from, to }) // a text drag moves the selection it started from
    const slice = ed.state.selection.content()
    const seen = changes(ed)
    expect(dropAt(ed, locate(ed, 'ary line'), slice, { moved: true })).toBe(true)
    ed.state.doc.check()
    expect(top(ed)).toEqual(['paragraph:Fir para.', 'toggle:Summst para. Secondary lineToggle body.', 'paragraph:After.'])
    expect(seen).toEqual(['drop']) // ONE transaction, marked as a drop
    ed.commands.undo()
    expect(ed.state.doc.eq(was)).toBe(true)
  })

  it('the same MOVE through prosemirror-view\'s own drop handler (a real drop event) keeps one toggle', () => {
    const ed = mount(TEXT_DOC())
    const { from, to } = textSource(ed)
    ed.commands.setTextSelection({ from, to })
    const ev = domDrop(ed, locate(ed, 'ary line'), ed.state.selection.content())
    ed.state.doc.check()
    expect(ev.defaultPrevented).toBe(true)
    expect(count(ed, 'toggle')).toBe(1)
    expect(top(ed)).toEqual(['paragraph:Fir para.', 'toggle:Summst para. Secondary lineToggle body.', 'paragraph:After.'])
  })

  it('a dragged attachment CHIP dropped mid-title lands after the toggle, the source removed, ONE undo restores both', () => {
    const ed = mount([P('Look'), CHIP, TOGGLE, P('After.')])
    const was = ed.state.doc
    const node = NodeSelection.create(ed.state.doc, firstPos(ed, 'attachmentChip'))
    const seen = changes(ed)
    expect(dropAt(ed, locate(ed, 'ary line'), node.content(), { moved: true, node })).toBe(true)
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(summaryOf(ed)).toBe('Summary line')
    expect(top(ed)).toEqual(['paragraph:Look', 'toggle:Summary lineToggle body.', 'attachmentChip:', 'paragraph:After.'])
    expect(nodesOf(ed, 'attachmentChip')[0].n.attrs).toEqual(was.child(1).attrs)
    expect(ed.state.selection.node && ed.state.selection.node.type.name).toBe('attachmentChip') // the dropped node, selected
    expect(ed.view.hasFocus()).toBe(true) // and the editor focused, as editHandlers.drop leaves it
    expect(seen).toEqual(['drop']) // ONE transaction, marked as a drop
    ed.commands.undo()
    expect(ed.state.doc.eq(was)).toBe(true)
  })

  it('a dragged Ask ANSWER dropped mid-title lands whole after the toggle, the source removed, ONE undo restores both', () => {
    const ed = mount([P('Mine.'), INSERT, TOGGLE, P('After.')])
    const was = ed.state.doc
    const node = NodeSelection.create(ed.state.doc, firstPos(ed, 'askInsert'))
    const seen = changes(ed)
    expect(dropAt(ed, locate(ed, 'ary line'), node.content(), { moved: true, node })).toBe(true)
    ed.state.doc.check()
    const answers = nodesOf(ed, 'askInsert')
    expect(answers).toHaveLength(1)
    expect(answers[0].n.attrs).toEqual(was.child(1).attrs)
    expect(count(ed, 'askCitation')).toBe(1)
    expect(top(ed)).toEqual(['paragraph:Mine.', 'toggle:Summary lineToggle body.', `askInsert:${was.child(1).textContent}`, 'paragraph:After.'])
    expect(seen).toEqual(['drop']) // ONE transaction, marked as a drop
    ed.commands.undo()
    expect(ed.state.doc.eq(was)).toBe(true)
  })

  it('a chip COPIED (the drag-copy modifier) onto a title lands after the toggle and the source stays', () => {
    const ed = mount([P('Look'), CHIP, TOGGLE, P('After.')])
    const node = NodeSelection.create(ed.state.doc, firstPos(ed, 'attachmentChip'))
    expect(dropAt(ed, locate(ed, 'ary line'), node.content(), { node })).toBe(true)
    expect(top(ed)).toEqual(['paragraph:Look', 'attachmentChip:', 'toggle:Summary lineToggle body.', 'attachmentChip:', 'paragraph:After.'])
  })

  it('dropped at the very START of a non-empty title, a chip lands ABOVE the toggle', () => {
    const ed = mount([CHIP, P('Mine.'), TOGGLE, P('After.')])
    const node = NodeSelection.create(ed.state.doc, 0)
    expect(dropAt(ed, locate(ed, 'Summary line'), node.content(), { moved: true, node })).toBe(true)
    expect(top(ed)).toEqual(['paragraph:Mine.', 'attachmentChip:', 'toggle:Summary lineToggle body.', 'paragraph:After.'])
  })

  it('a drag OUT of the title\'s own text dropped back on it is judged where it lands, after the source is gone', () => {
    // Removing "ne. | Sum" moves the title's rest ("mary line") up into the
    // paragraph -- ProseMirror's own delete -- so the drop point lands there,
    // in a paragraph, and the drop is an ordinary one: no toggle is created.
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    ed.commands.setTextSelection({ from: locate(ed, 'ne.'), to: locate(ed, 'mary line') })
    domDrop(ed, locate(ed, 'line'), ed.state.selection.content())
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(top(ed)).toEqual(['paragraph:Mimary ne.', 'paragraph:Sumline', 'toggle:Toggle body.', 'paragraph:After.'])
  })

  it('a title\'s whole text dragged (moved) and let go at the title\'s own start is cancelled -- one toggle, nothing moves', () => {
    // Found by the drop sweep: the move's removal rebuilds the emptied toggle,
    // so the drop point is consumed by the dragged content itself; ProseMirror's
    // own drop landed between the new title and the body and split the toggle.
    const ed = mount([P('Mine.'), TOGGLE, P('After.')])
    const was = ed.state.doc
    const from = locate(ed, 'Summary line')
    ed.commands.setTextSelection({ from, to: locate(ed, 'Toggle body.') })
    domDrop(ed, from, ed.state.selection.content())
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(ed.state.doc.eq(was)).toBe(true)
  })

  it('nothing but empty lines dropped on a title changes nothing -- not even a moved source', () => {
    const ed = mount([P('Mine.'), { type: 'paragraph' }, { type: 'paragraph' }, TOGGLE, P('After.')])
    const was = ed.state.doc
    const start = was.child(0).nodeSize
    ed.commands.setTextSelection({ from: start + 1, to: start + 3 }) // the two empty lines
    const slice = ed.state.selection.content()
    expect(slice.content.childCount).toBe(2)
    expect(dropAt(ed, locate(ed, 'ary line'), slice, { moved: true })).toBe(true)
    expect(ed.state.doc.eq(was)).toBe(true)
  })
})

describe('CONTROL: an ordinary drop between paragraphs is byte-identical to ProseMirror\'s own', () => {
  // The same real drop event into an editor WITHOUT the plugin: that editor
  // runs exactly the drop ProseMirror ran before this plugin had a handleDrop.
  const withoutPlugin = (content) => {
    const el = document.createElement('div'); document.body.appendChild(el)
    return new Editor({ element: el, extensions: buildExtensions().filter((e) => e.name !== 'pasteContainers'), content: { type: 'doc', content } })
  }
  const TEXT = [P('First para.'), P('Second para.'), P('Mine.'), P('After.')]
  const CASES = [
    ['multi-block text copied into the middle of a paragraph', TEXT,
      (ed) => ({ slice: ed.state.doc.slice(locate(ed, 'st para.'), locate(ed, 'Second') + 6, true), copy: true, pos: locate(ed, 'ter.') })],
    ['a text selection moved to the end of another paragraph', TEXT,
      (ed) => { ed.commands.setTextSelection({ from: locate(ed, 'st para.'), to: locate(ed, 'Second') + 6 }); return { slice: ed.state.selection.content(), pos: locate(ed, 'After.') + 6 } }],
    ['a chip moved into the middle of a paragraph', [P('Look'), CHIP, P('Mine.'), P('After.')],
      (ed) => { const node = NodeSelection.create(ed.state.doc, firstPos(ed, 'attachmentChip')); return { slice: node.content(), node, pos: locate(ed, 'ter.') } }],
  ]
  for (const [label, content, setup] of CASES) {
    it(`${label}: the same doc and selection with and without the plugin`, () => {
      const ed = mount(content)
      const base = withoutPlugin(content)
      try {
        const a = setup(ed)
        const b = setup(base)
        const was = ed.state.doc
        expect(dropAt(ed, a.pos, a.slice, { moved: !a.copy, node: a.node })).toBeFalsy() // left to ProseMirror
        expect(ed.state.doc.eq(was)).toBe(true)
        domDrop(ed, a.pos, a.slice, { copy: a.copy, node: a.node })
        domDrop(base, b.pos, b.slice, { copy: b.copy, node: b.node })
        expect(base.state.doc.eq(was)).toBe(false) // non-vacuity: the drop really changed the doc
        expect(JSON.stringify(ed.state.doc.toJSON())).toBe(JSON.stringify(base.state.doc.toJSON()))
        expect(ed.state.selection.toJSON()).toEqual(base.state.selection.toJSON())
      } finally { base.destroy() }
    })
  }
})

describe('the drop belt: a dropped slice ProseMirror cannot place lands as text, never lost (belt)', () => {
  it('handleDrop falls back to plain text for the raw pre-fix toggle shape, dropped between paragraphs', () => {
    const ed = mount([P('Mine.'), P('After.')])
    const { schema } = ed.state
    const raw = new Slice(Fragment.from(schema.nodes.toggle.create({ open: true }, [
      schema.nodes.toggleSummary.create(null, schema.text('Summary line')),
      schema.nodes.toggleContent.create(null, Fragment.empty),
    ])), 2, 2)
    const at = locate(ed, 'After.') + 'After.'.length
    expect(() => ed.state.tr.replaceRange(at, at, raw)).toThrow(/invalid content/) // ProseMirror's own drop would throw
    expect(dropAt(ed, at, raw)).toBe(true)
    ed.state.doc.check()
    expect(ed.state.doc.textContent).toBe('Mine.After.Summary line')
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[pasteContainers] drop fell back'))).toHaveLength(1)
  })
})

// ── A pasted or dropped chart's identity (embedId) ──────────────────────────
// Ask cites a chart precisely only while its embedId is UNIQUE in the note, so
// a chart copied within its own note must arrive with a fresh id -- and
// nothing else may: not a cut, not a moved drag, not a paste into another
// note, and never a legacy embed that has no id at all.
const chart = (embedId) => ({ type: 'widgetEmbed', attrs: {
  ...buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: '15' }, { capturedAt: '2026-09-01T14:00:00.000Z' }), embedId } })
const embedIds = (ed) => nodesOf(ed, 'widgetEmbed').map(({ n }) => n.attrs.embedId)
// A second editor (another note, or the plugin-less baseline); the caller destroys it.
const second = (content, { plugin = true } = {}) => {
  const el = document.createElement('div'); document.body.appendChild(el)
  const extensions = plugin ? buildExtensions() : buildExtensions().filter((e) => e.name !== 'pasteContainers')
  return new Editor({ element: el, extensions, content: { type: 'doc', content } })
}
// The doc with every embedId blanked, so two drops that differ ONLY in the ids
// they carry compare equal (the ids are asserted on their own).
const shapeOf = (ed) => JSON.stringify(ed.state.doc.toJSON(), (k, v) => (k === 'embedId' && v ? 'ID' : v))

describe('a chart PASTED keeps a unique embedId -- a copy gets a fresh one, the original keeps its own', () => {
  it('copy + paste in the SAME note: two distinct ids, the original unchanged', () => {
    const ed = mount([P('Mine.'), chart('e-orig'), P('After.')])
    pasteAt(ed, locate(ed, 'After.') + 6, copyNode(ed, firstPos(ed, 'widgetEmbed')))
    const ids = embedIds(ed)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('e-orig')
    expect(typeof ids[1]).toBe('string')
    expect(ids[1]).not.toBe('e-orig')
  })

  it('cut + paste keeps its id -- the source is gone, so nothing collides', () => {
    const ed = mount([P('Mine.'), chart('e-orig'), P('After.')])
    const html = copyNode(ed, firstPos(ed, 'widgetEmbed')) // leaves the chart selected
    ed.commands.deleteSelection() // the cut's own removal
    pasteAt(ed, locate(ed, 'After.') + 6, html)
    expect(embedIds(ed)).toEqual(['e-orig'])
  })

  // Wave 4 minors (M1): a paste replaces its selection, so the ids are judged
  // against the doc WITHOUT it. The plain copy + paste above is the control:
  // with the source still in the doc, it is re-stamped.
  it('a chart pasted over ITSELF keeps its id -- the chart it replaces is the one that owned it', () => {
    const ed = mount([P('Mine.'), chart('e-orig'), P('After.')])
    const html = copyNode(ed, firstPos(ed, 'widgetEmbed')) // leaves the chart selected
    ed.view.pasteHTML(html)
    ed.state.doc.check()
    expect(embedIds(ed)).toEqual(['e-orig'])
  })

  it('select-all + paste of the note\'s own content keeps EVERY id', () => {
    const ed = mount([P('Mine.'), chart('e-a'), P('Between.'), chart('e-b'), P('After.')])
    ed.commands.selectAll()
    const html = ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
    ed.view.pasteHTML(html) // over the same select-all
    ed.state.doc.check()
    expect(embedIds(ed)).toEqual(['e-a', 'e-b'])
  })

  it('a paste into ANOTHER note keeps its id -- nothing there collides', () => {
    const src = second([P('Mine.'), chart('e-orig'), P('After.')])
    let html
    try { html = copyNode(src, firstPos(src, 'widgetEmbed')) } finally { src.destroy() }
    const ed = mount([P('Other note.')])
    pasteAt(ed, locate(ed, 'note.') + 5, html)
    expect(embedIds(ed)).toEqual(['e-orig'])
  })

  it('a LEGACY embed (no embedId) copied and pasted in its own note stays without one -- none is minted', () => {
    const ed = mount([P('Mine.'), chart(null), P('After.')])
    pasteAt(ed, locate(ed, 'After.') + 6, copyNode(ed, firstPos(ed, 'widgetEmbed')))
    expect(embedIds(ed)).toEqual([null, null])
  })

  it('two embeds sharing ONE id (an old duplicate) pasted into another note come out as two ids', () => {
    const src = second([P('Mine.'), chart('e-dup'), chart('e-dup'), P('After.')])
    let html
    try { html = copyRange(src, locate(src, 'ne.'), locate(src, 'Aft')) } finally { src.destroy() }
    const ed = mount([P('Other note.')])
    pasteAt(ed, locate(ed, 'note.') + 5, html)
    const ids = embedIds(ed)
    expect(ids).toHaveLength(2)
    expect(ids).toContain('e-dup')
    expect(new Set(ids).size).toBe(2)
  })
})

describe('a chart DROPPED keeps a unique embedId -- decided by the drop, not by dragstart', () => {
  it('dragged and MOVED within the note, it keeps its id', () => {
    const ed = mount([P('Mine.'), chart('e-orig'), P('After.')])
    const node = NodeSelection.create(ed.state.doc, firstPos(ed, 'widgetEmbed'))
    domDrop(ed, locate(ed, 'After.') + 6, node.content(), { node })
    ed.state.doc.check()
    expect(embedIds(ed)).toEqual(['e-orig'])
    expect(top(ed).slice(0, 2)).toEqual(['paragraph:Mine.', 'paragraph:After.']) // it did move
  })

  it('dragged as a COPY, it gets a fresh id -- and otherwise lands exactly as ProseMirror\'s own drop would', () => {
    const content = [P('Mine.'), chart('e-orig'), P('After.')]
    const ed = mount(content)
    const base = second(content, { plugin: false })
    try {
      for (const e of [ed, base]) {
        const node = NodeSelection.create(e.state.doc, firstPos(e, 'widgetEmbed'))
        domDrop(e, locate(e, 'After.') + 3, node.content(), { copy: true, node })
      }
      ed.state.doc.check()
      const ids = embedIds(ed)
      expect(ids).toHaveLength(2)
      expect(ids[0]).toBe('e-orig')
      expect(ids[1]).not.toBe('e-orig')
      expect(embedIds(base)).toEqual(['e-orig', 'e-orig']) // what the plugin-less drop produced
      expect(shapeOf(ed)).toBe(shapeOf(base))
      expect(ed.state.selection.toJSON()).toEqual(base.state.selection.toJSON())
    } finally { base.destroy() }
  })

  it('a drag BEGUN as a copy but dropped as a move keeps its id -- the drop\'s verdict wins', () => {
    const ed = mount([P('Mine.'), chart('e-orig'), P('After.')])
    const node = NodeSelection.create(ed.state.doc, firstPos(ed, 'widgetEmbed'))
    domDrop(ed, locate(ed, 'After.') + 6, node.content(), { node, startMove: false }) // dragstart said copy
    expect(embedIds(ed)).toEqual(['e-orig'])
  })

  it('a chart COPIED onto a toggle title lands after the toggle with a fresh id', () => {
    const ed = mount([P('Mine.'), chart('e-orig'), TOGGLE, P('After.')])
    const node = NodeSelection.create(ed.state.doc, firstPos(ed, 'widgetEmbed'))
    expect(dropAt(ed, locate(ed, 'ary line'), node.content(), { node })).toBe(true)
    expect(top(ed).map((s) => s.split(':')[0])).toEqual(['paragraph', 'widgetEmbed', 'toggle', 'widgetEmbed', 'paragraph'])
    const ids = embedIds(ed)
    expect(ids[0]).toBe('e-orig')
    expect(ids[1]).not.toBe('e-orig')
  })
})
