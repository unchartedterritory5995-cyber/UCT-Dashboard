// Notebook widgets Task 10: the $TICKER chip. A DECORATION on the member's own text, never a node or mark:
// the stored text stays `$NVDA` and the saved JSON is byte-for-byte what it was without the chip.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { findTickerRanges, TICKER_CARD_EVENT } from './tickerChip'
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
  })
})
