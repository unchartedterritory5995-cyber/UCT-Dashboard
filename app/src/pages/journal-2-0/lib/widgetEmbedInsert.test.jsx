// Insert-position rail for widgetEmbed (found live in the P5 audit): with no
// prior selection and a doc ENDING in an atom node, a bare focus() lands a
// NodeSelection on that atom and insertContent REPLACES it — the inbox tray
// silently ate the trailing embed (invisible when old and new params match).
// Every programmatic insert into an unfocused editor goes through
// focus('end'), which is a TEXT position and appends.
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'

const seedDoc = () => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Note' }] },
    { type: 'widgetEmbed', attrs: buildWidgetEmbedAttrs('chart', { symbol: 'SPY', tf: 'D' }) },
  ],
})

const embeds = (ed) => ed.getJSON().content.filter((n) => n.type === 'widgetEmbed')

describe('programmatic widgetEmbed insertion', () => {
  it("focus('end') appends after a trailing embed instead of replacing it", () => {
    const ed = new Editor({ extensions: buildExtensions(), content: seedDoc() })
    const ok = ed.chain().focus('end').insertWidgetEmbed('chart', { symbol: 'AMD', tf: '15' }).run()
    const out = embeds(ed)
    ed.destroy()
    expect(ok).toBe(true)
    expect(out.map((e) => e.attrs.params.symbol)).toEqual(['SPY', 'AMD'])
  })

  // The OTHER half of the NodeSelection trap (prod smoke, 8/13): insertContent
  // leaves a NodeSelection ON the freshly inserted atom, so the very next
  // keystroke REPLACED the embed the user just created. Every insert path must
  // exit with the caret in a TEXT position after the embed — typing prose
  // right after inserting a chart is the most natural next action there is.
  it('typing immediately after insertWidgetEmbed lands AFTER the embed, never over it', () => {
    const ed = new Editor({ extensions: buildExtensions(), content: seedDoc() })
    ed.chain().focus('end').insertWidgetEmbed('chart', { symbol: 'AMD', tf: '15' }).run()
    // Simulate the user's next keystroke at whatever selection insert left.
    ed.commands.insertContent('and here is why')
    const out = embeds(ed)
    const text = ed.getText()
    ed.destroy()
    expect(out.map((e) => e.attrs.params.symbol)).toEqual(['SPY', 'AMD'])
    expect(text).toContain('and here is why')
  })

  it('typing after an ARRAY insert (the /mtf and /compare shape) keeps every embed', () => {
    const ed = new Editor({ extensions: buildExtensions(), content: seedDoc() })
    const nodes = ['D', '60', '15'].map((tf) => ({
      type: 'widgetEmbed', attrs: buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf }),
    }))
    ed.chain().focus('end').insertContent(nodes).caretAfterWidgetEmbed().run()
    ed.commands.insertContent('x')
    const out = embeds(ed)
    ed.destroy()
    expect(out.map((e) => e.attrs.params.symbol)).toEqual(['SPY', 'NVDA', 'NVDA', 'NVDA'])
  })

  it('caretAfterWidgetEmbed steps INTO existing following text instead of minting a paragraph', () => {
    const ed = new Editor({
      extensions: buildExtensions(),
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
        ],
      },
    })
    // Put the caret at the start of 'after', insert an embed above it.
    ed.commands.setTextSelection(9)
    ed.chain().insertWidgetEmbed('chart', { symbol: 'AMD', tf: 'D' }).run()
    ed.commands.insertContent('X')
    const json = ed.getJSON()
    const paraTexts = json.content.filter((n) => n.type === 'paragraph')
      .map((n) => (n.content || []).map((c) => c.text).join(''))
    ed.destroy()
    expect(embedsOf(json)).toHaveLength(1)
    // The keystroke landed in the EXISTING next paragraph — no extra empty one.
    expect(paraTexts).toEqual(['before', 'Xafter'])
  })
})

const embedsOf = (json) => json.content.filter((n) => n.type === 'widgetEmbed')
