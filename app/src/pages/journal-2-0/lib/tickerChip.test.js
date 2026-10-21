// Notebook widgets Task 10: the $TICKER chip. A DECORATION on the member's own text, never a node or mark:
// the stored text stays `$NVDA` and the saved JSON is byte-for-byte what it was without the chip.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { findTickerRanges, TICKER_CARD_EVENT, tickerChipKey } from './tickerChip'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'

const para = (...content) => ({ type: 'paragraph', content })
const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t })
const docOf = (...blocks) => ({ type: 'doc', content: blocks })

let editors = []
function mount(content, { editable = true } = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = new Editor({ element: el, extensions: buildExtensions(), content, editable })
  editors.push(editor)
  return { editor, el }
}
const chips = (el) => [...el.querySelectorAll('.tickerChip')].map((n) => [n.getAttribute('data-symbol'), n.textContent])

beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_widgets_w1_enabled: true }) })
afterEach(() => { editors.forEach((e) => e.destroy()); editors = []; document.body.innerHTML = ''; __resetNotebookFlags() })

describe('findTickerRanges', () => {
  it('"$NVDA up" gives one range, NVDA', () => {
    expect(findTickerRanges('$NVDA up')).toEqual([{ from: 0, to: 5, symbol: 'NVDA' }])
  })
  it.each(['$5', 'US$NVDA', '$nvda', '$$', '$TOOLONGX'])('%s gives none', (s) => {
    expect(findTickerRanges(s)).toEqual([])
  })
  it('"$BRK.B" gives BRK.B', () => {
    expect(findTickerRanges('$BRK.B')).toEqual([{ from: 0, to: 6, symbol: 'BRK.B' }])
  })
  it('a sentence-ending period is not part of the symbol', () => {
    expect(findTickerRanges('Bought $NVDA.')).toEqual([{ from: 7, to: 12, symbol: 'NVDA' }])
  })
  it('finds every one in a line', () => {
    expect(findTickerRanges('$AMD and $NVDA').map((r) => r.symbol)).toEqual(['AMD', 'NVDA'])
  })
})

// F3: the matcher dropped its lookbehind (iOS 16 is the floor, and a lookbehind literal throws there at parse).
// These pin that the rewrite matches exactly what the lookbehind form matched.
describe('findTickerRanges without a lookbehind matches what the lookbehind form did', () => {
  // The pre-F3 pattern, kept HERE as the oracle (a test file is outside noRegexLookbehind's product scan; the
  // test runner's Node has lookbehind). Built from a string so the product rail's literal scan cannot mistake it.
  const OLD = new RegExp('(?<![\\w$])\\$([A-Z][A-Z.]{0,5})(?![\\w$])', 'g')
  const oldRanges = (t) => [...String(t || '').matchAll(OLD)].map((m) => {
    const symbol = m[1].replace(/\.+$/, '')
    return { from: m.index, to: m.index + 1 + symbol.length, symbol }
  })

  it.each([
    ['x$NVDA', []], ['_$NVDA', []], ['9$NVDA', []], ['$$NVDA', []],
    ['($NVDA)', [{ from: 1, to: 6, symbol: 'NVDA' }]],
    ['-$NVDA', [{ from: 1, to: 6, symbol: 'NVDA' }]],
    ['line\n$NVDA', [{ from: 5, to: 10, symbol: 'NVDA' }]],
    ['$NVDA$AMD', []], ['$NVDAx', []], ['$NVDA_', []],
    ['$AMD,$NVDA', [{ from: 0, to: 4, symbol: 'AMD' }, { from: 5, to: 10, symbol: 'NVDA' }]],
    ['$A.$B', [{ from: 0, to: 2, symbol: 'A' }, { from: 3, to: 5, symbol: 'B' }]],
    ['$BRK.B.', [{ from: 0, to: 6, symbol: 'BRK.B' }]],
    ['', []], [null, []],
  ])('prefix and $ rules: %j', (s, want) => {
    expect(findTickerRanges(s)).toEqual(want)
    expect(findTickerRanges(s)).toEqual(oldRanges(s))
  })

  it('every string of up to 5 chars over the rule-relevant alphabet gives the old answer', () => {
    const alphabet = ['$', 'A', 'B', '.', 'a', '1', '_', ' ', '\n', '(']
    let strings = ['']
    let checked = 0
    const diffs = []
    for (let len = 1; len <= 5; len += 1) {
      strings = strings.flatMap((s) => alphabet.map((c) => s + c))
      for (const s of strings) {
        checked += 1
        const a = JSON.stringify(findTickerRanges(s))
        if (a !== JSON.stringify(oldRanges(s))) diffs.push(s)
      }
    }
    expect(checked).toBe(111110) // non-vacuity: every string was compared
    expect(oldRanges('($AB $A')).toHaveLength(2) // and the oracle does find tickers in this alphabet
    expect(diffs).toEqual([])
  })
})

describe('TickerChipExtension', () => {
  it('decorates $NVDA, and the document, text and JSON are unchanged', () => {
    const content = docOf(para(text('Watching $NVDA up')))
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_widgets_w1_enabled: false })
    const bare = mount(content).editor
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    const { editor, el } = mount(content)
    expect(chips(el)).toEqual([['NVDA', '$NVDA']])
    expect(editor.getText()).toBe('Watching $NVDA up')
    expect(editor.getJSON()).toEqual(content)
    expect(JSON.stringify(editor.getJSON())).toBe(JSON.stringify(bare.getJSON()))
    expect(editor.getHTML()).not.toContain('tickerChip')
  })

  it('is absent inside a code mark and inside a code block', () => {
    const { el } = mount(docOf(
      para(text('$NVDA', [{ type: 'code' }]), text(' and $AMD')),
      { type: 'codeBlock', content: [text('$TSLA')] },
    ))
    expect(chips(el)).toEqual([['AMD', '$AMD']])
  })

  it('the prefix rule reads the text, not the marks: a code-marked word char blocks, a code-marked "(" does not', () => {
    const { el } = mount(docOf(
      para(text('x', [{ type: 'code' }]), text('$AMD')),
      para(text('(', [{ type: 'code' }]), text('$NVDA)')),
    ))
    expect(chips(el)).toEqual([['NVDA', '$NVDA']])
  })

  it('is absent with the W1 flag off', () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_widgets_w1_enabled: false })
    const { el } = mount(docOf(para(text('$NVDA up'))))
    expect(chips(el)).toEqual([])
  })

  it('is absent when the editor is read-only, and goes when an editor turns read-only', () => {
    const { el } = mount(docOf(para(text('$NVDA up'))), { editable: false })
    expect(chips(el)).toEqual([])
    const live = mount(docOf(para(text('$AMD up'))))
    expect(chips(live.el)).toEqual([['AMD', '$AMD']])
    live.editor.setEditable(false)
    expect(chips(live.el)).toEqual([])
  })

  it('follows typing: a new ticker appears, an edited one changes', () => {
    const { editor, el } = mount(docOf(para(text('$NVDA up')), para(text('second'))))
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' $AMD')
    expect(chips(el)).toEqual([['NVDA', '$NVDA'], ['AMD', '$AMD']])
    editor.commands.insertContentAt(6, 'X') // $NVDAX (the text starts at 1)
    expect(chips(el)).toEqual([['NVDAX', '$NVDAX'], ['AMD', '$AMD']])
  })

  it('a click dispatches uct:ticker-card with the symbol and a rect', () => {
    const { editor, el } = mount(docOf(para(text('Watching $NVDA up'))))
    const got = []
    editor.view.dom.addEventListener(TICKER_CARD_EVENT, (e) => got.push(e.detail))
    expect(TICKER_CARD_EVENT).toBe('uct:ticker-card')
    el.querySelector('.tickerChip').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(got).toHaveLength(1)
    expect(got[0].symbol).toBe('NVDA')
    expect(got[0].rect).toBeTruthy()
    expect(typeof got[0].rect.bottom).toBe('number')
    // The chip's document position rides along, inside the paragraph that holds it.
    expect(Number.isInteger(got[0].pos)).toBe(true)
    expect(editor.state.doc.resolve(got[0].pos).parent.textContent).toBe('Watching $NVDA up')
  })

  it('a code mark put on $NVDA removes the chip, and taking it off restores it', () => {
    const { editor, el } = mount(docOf(para(text('Watching $NVDA up'))))
    expect(chips(el)).toEqual([['NVDA', '$NVDA']])
    editor.chain().setTextSelection({ from: 10, to: 15 }).setMark('code').run()
    expect(chips(el)).toEqual([])
    editor.chain().setTextSelection({ from: 10, to: 15 }).unsetMark('code').run()
    expect(chips(el)).toEqual([['NVDA', '$NVDA']])
    expect(editor.getText()).toBe('Watching $NVDA up')
  })

  it('a code mark that only partly covers the ticker still removes the chip', () => {
    const { editor, el } = mount(docOf(para(text('Watching $NVDA up'))))
    editor.chain().setTextSelection({ from: 12, to: 13 }).setMark('code').run()
    expect(chips(el)).toEqual([])
  })

  it('turning the paragraph into a code block removes the chip, and back restores it', () => {
    const { editor, el } = mount(docOf(para(text('Watching $NVDA up')), para(text('$AMD'))))
    editor.chain().setTextSelection(3).setCodeBlock().run()
    expect(editor.state.doc.firstChild.type.name).toBe('codeBlock')
    expect(chips(el)).toEqual([['AMD', '$AMD']])
    // The SET, not just the DOM: a code block's view may not paint inline decorations, so a chip mapped
    // into it would be invisible here and still live (and clickable the moment the view painted it).
    const inCode = () => tickerChipKey.getState(editor.state).find(0, editor.state.doc.firstChild.nodeSize)
    expect(inCode()).toEqual([])
    editor.commands.insertContentAt(2, 'x') // typing inside the code block keeps it clean
    expect(inCode()).toEqual([])
    editor.chain().setTextSelection(3).setParagraph().run()
    expect(chips(el)).toEqual([['NVDA', '$NVDA'], ['AMD', '$AMD']])
  })

  it('deleting the ticker, or its $, removes the chip', () => {
    const { editor, el } = mount(docOf(para(text('Watching $NVDA up and $AMD'))))
    expect(chips(el)).toEqual([['NVDA', '$NVDA'], ['AMD', '$AMD']])
    editor.commands.deleteRange({ from: 10, to: 11 }) // the $ of $NVDA
    expect(chips(el)).toEqual([['AMD', '$AMD']])
    const at = editor.getText().indexOf('$AMD') + 1
    editor.commands.deleteRange({ from: at, to: at + 4 })
    expect(chips(el)).toEqual([])
  })

  it('joining two paragraphs that each hold half a ticker makes one chip for the whole symbol', () => {
    const { editor, el } = mount(docOf(para(text('buy $NV')), para(text('DA now'))))
    expect(chips(el)).toEqual([['NV', '$NV']]) // $NV is a symbol on its own
    const second = editor.state.doc.firstChild.nodeSize + 1
    editor.chain().setTextSelection(second).joinBackward().run()
    expect(editor.state.doc.childCount).toBe(1)
    expect(chips(el)).toEqual([['NVDA', '$NVDA']])
  })
})
