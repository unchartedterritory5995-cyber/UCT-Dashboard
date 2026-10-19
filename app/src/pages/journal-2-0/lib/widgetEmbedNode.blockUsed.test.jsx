// P5 Task 6: `insertWidgetEmbed` counts one `block_used` when the widget it inserted is a trader block
// (`WIDGET_REGISTRY[id].block === true`, read from the eager registry, never journalBlocks.js: F8). A chart, a
// capture widget or a dry run (`editor.can()`) counts nothing, and a block's params never leave the browser.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { ITEMS, widgetItems } from '../components/notebook/SlashMenu'
import { WIDGET_REGISTRY } from '../../../widgets/registry'

// jsdom has no Range geometry (SlashMenu.blocks.test.jsx).
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const TELEMETRY = '/api/j2/telemetry'
const seed = () => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan' }] }] })
let editors = []
function setup() {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })
  const ed = new Editor({ extensions: buildExtensions(), content: seed() })
  editors.push(ed)
  const sent = () => spy.mock.calls.filter(([url]) => url === TELEMETRY).map(([, init]) => JSON.parse(init.body))
  return { ed, sent }
}
const embeds = (ed) => ed.getJSON().content.filter((n) => n.type === 'widgetEmbed').map((n) => n.attrs.widgetId)
const endRange = (ed) => { const at = ed.state.doc.content.size - 1; return { from: at, to: at } }

afterEach(() => { for (const ed of editors) ed.destroy(); editors = []; vi.restoreAllMocks() })

describe('block_used', () => {
  it('a slash insert of Position sizing fires block_used {kind: positionSizing} once', () => {
    const { ed, sent } = setup()
    expect(WIDGET_REGISTRY.positionSizing.block).toBe(true)                    // control: it IS a block
    const item = ITEMS.find((i) => i.title === WIDGET_REGISTRY.positionSizing.labels.menu)
    expect(item).toBeTruthy()
    item.command({ editor: ed, range: endRange(ed) })
    expect(embeds(ed)).toEqual(['positionSizing'])                             // the insert really happened
    expect(sent()).toEqual([{ event: 'block_used', props: { kind: 'positionSizing' } }])
  })

  it('a /chart insert of a non-block widget fires nothing', () => {
    const { ed, sent } = setup()
    const [chart] = widgetItems('chart AMD 15m')
    expect(chart?.cmd).toBe('chart')
    chart.command({ editor: ed, range: endRange(ed) })
    expect(embeds(ed)).toEqual(['chart'])                                      // control: it inserted
    expect(sent()).toEqual([])
  })

  it('insertWidgetEmbed of a widget that is not a block fires nothing', () => {
    const { ed, sent } = setup()
    expect(WIDGET_REGISTRY.chart.block).not.toBe(true)
    ed.chain().focus('end').insertWidgetEmbed('chart', { symbol: 'AMD', tf: '15' }).run()
    expect(embeds(ed)).toEqual(['chart'])
    expect(sent()).toEqual([])
  })

  it('a dry run (editor.can()) inserts nothing and counts nothing', () => {
    const { ed, sent } = setup()
    expect(ed.can().insertWidgetEmbed('positionSizing')).toBe(true)
    expect(embeds(ed)).toEqual([])
    expect(sent()).toEqual([])
  })

  it("the block's params never ride along", () => {
    const { ed, sent } = setup()
    ed.chain().focus('end').insertWidgetEmbed('positionSizing', { entry: 123.45, stop: 120, grade: 'A+' }).run()
    expect(sent()).toEqual([{ event: 'block_used', props: { kind: 'positionSizing' } }])
    expect(JSON.stringify(sent())).not.toContain('123')
  })
})
