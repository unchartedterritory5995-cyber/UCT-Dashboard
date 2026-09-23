// pasteContainers.js — behavioural rails, written against the REAL extension
// roster (buildExtensions) and the REAL clipboard path: `serializeForClipboard`
// for the copy, `view.pasteHTML` for the paste. Every rail below was RED before
// the plugin existed (a throw, a lost paste, or a callout/toggle wrapped around
// member prose), except the whole-block controls, which are green both ways.
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

// A toggle's summary is a one-line title. Measured before the fix: plain
// two-line text pasted into a summary produced `toggle(summary "plain words",
// empty body)`, `paragraph("second lineSummary line")`, `toggle(empty summary,
// original body)` -- one toggle split into two around the pasted blocks.
describe('a multi-block paste into a toggle SUMMARY stays in that summary as one line', () => {
  const summaryOf = (ed) => { let s = null; ed.state.doc.descendants((n) => { if (s == null && n.type.name === 'toggleSummary') s = n.textContent }); return s }
  const bodyOf = (ed) => { let s = null; ed.state.doc.descendants((n) => { if (s == null && n.type.name === 'toggleContent') s = n.textContent }); return s }
  const CASES = [
    ['plain two-line text', (ed) => ed.view.pasteText('plain words\nsecond line'), 'plain words second line'],
    ['a multi-paragraph HTML paste', (ed) => ed.view.pasteHTML('<p>First para.</p><p>Second para.</p>'), 'First para. Second para.'],
    ['a two-item list', (ed) => ed.view.pasteHTML('<ul><li>one</li><li>two</li></ul>'), 'one two'],
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
    })
  }

  it('a WHOLE callout copied as a node and pasted into a summary lands as its text, not a second block', () => {
    const ed = mount([P('Mine.'), CALLOUT, TOGGLE, P('After.')])
    const html = copyNode(ed, firstPos(ed, 'callout'))
    ed.commands.setTextSelection(locate(ed, 'ary line'))
    ed.view.pasteHTML(html)
    ed.state.doc.check()
    expect(count(ed, 'toggle')).toBe(1)
    expect(count(ed, 'callout')).toBe(1)
    expect(summaryOf(ed)).toBe('SummInside callout.ary line')
    expect(bodyOf(ed)).toBe('Toggle body.')
  })

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
