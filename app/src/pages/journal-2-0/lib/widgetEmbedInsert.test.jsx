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
})
