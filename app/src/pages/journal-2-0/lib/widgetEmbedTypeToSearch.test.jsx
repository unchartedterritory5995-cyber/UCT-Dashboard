// Audit 2026-11-05, spec S3 (B7): click a chart in a note, type "AMD" -- the chart was REPLACED by
// the text. A selected chart is an atom NodeSelection, and ProseMirror's default for a printable key
// over a node selection is to replace the node. Now a printable key over a selected CHART never
// reaches that default: it asks the chart to open its ticker search with the key typed (the Charts
// page idiom, SymbolSearch.openWith). Delete and Backspace still remove it, and Undo brings it back.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { undo } from '@tiptap/pm/history'
import { buildExtensions } from './tiptap'
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'
import { CHART_EMBED_TYPE_EVENT } from './widgetEmbedNode'

const seed = (widgetId = 'chart') => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Note' }] },
    { type: 'widgetEmbed', attrs: buildWidgetEmbedAttrs(widgetId, { symbol: 'SPY', tf: 'D' }) },
    { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
  ],
})

let ed
afterEach(() => { ed?.destroy(); ed = null })

function selectEmbed() {
  ed = new Editor({ extensions: buildExtensions(), content: seed() })
  let pos = -1
  ed.state.doc.descendants((n, p) => { if (n.type.name === 'widgetEmbed') pos = p })
  ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)))
  return pos
}
const embeds = () => ed.getJSON().content.filter((n) => n.type === 'widgetEmbed')
const press = (key, extra = {}) => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
  ed.view.dom.dispatchEvent(ev)
  return ev
}

describe('S3 (B7): a typed key never replaces a selected chart', () => {
  it('a printable key is taken: nothing replaces the chart, and the chart is asked to search for it', () => {
    selectEmbed()
    const asked = []
    ed.view.dom.addEventListener(CHART_EMBED_TYPE_EVENT, (e) => asked.push(e.detail.text))
    const ev = press('A')
    expect(ev.defaultPrevented).toBe(true)
    expect(asked).toEqual(['A'])
    expect(embeds()).toHaveLength(1)
    expect(embeds()[0].attrs.params.symbol).toBe('SPY')
  })

  it('text input over the selected chart (IME, a phone keyboard) is taken the same way', () => {
    const pos = selectEmbed()
    const asked = []
    ed.view.dom.addEventListener(CHART_EMBED_TYPE_EVENT, (e) => asked.push(e.detail.text))
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, pos, pos + 1, 'a', () => null))
    expect(handled).toBe(true)
    expect(asked).toEqual(['A'])
    expect(embeds()).toHaveLength(1)
  })

  it('a shortcut (Ctrl/Cmd+key) is not taken', () => {
    selectEmbed()
    expect(press('c', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press('c', { metaKey: true }).defaultPrevented).toBe(false)
  })

  it('Delete and Backspace still remove the chart, and Undo restores it', () => {
    selectEmbed()
    press('Delete')
    expect(embeds()).toHaveLength(0)
    undo(ed.state, ed.view.dispatch)
    expect(embeds()).toHaveLength(1)
    ed.destroy()
    selectEmbed()
    press('Backspace')
    expect(embeds()).toHaveLength(0)
  })

  it('CONTROL: a caret in text still types', () => {
    ed = new Editor({ extensions: buildExtensions(), content: seed() })
    ed.commands.setTextSelection(3)
    expect(press('A').defaultPrevented).toBe(false)
  })
})
