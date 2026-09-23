// pasteContainers.js — behavioural rails, written against the REAL extension
// roster (buildExtensions) and the REAL clipboard path: `serializeForClipboard`
// for the copy, `view.pasteHTML` / `view.pasteText` for the paste. Each rail
// was RED before the fix it pins -- a throw, a lost paste, a callout/toggle
// wrapped around member prose, a toggle split by a paste into its title, or a
// node dropped or flattened there. The rails named CONTROL are green both ways
// on purpose: they pin what the fixes must NOT change (a whole block keeps its
// wrapper, a one-line paste into a title is still ProseMirror's own, an empty
// title fills with pasted text).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import { buildExtensions } from './tiptap'
import { buildAskInsertNode } from './askInsert'

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
