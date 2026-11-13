// Follow-up A: `block_inserted` -- a widget or block a member inserts through a door (the slash menu, the palette, the
// palette opened from the phone "+") counts ONCE per press, by its registry id; an insert outside a door (a template,
// a paste, a capture) counts nothing. `block_used` (the 13 trader blocks) is unchanged beside it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { ITEMS, slashCommand, widgetItems } from '../components/notebook/SlashMenu'
import { WIDGET_REGISTRY } from '../../../widgets/registry'
import { withInsertDoor } from './notebookUsage'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const TELEMETRY = '/api/j2/telemetry'
const seed = () => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan' }] }] })
let editors = []
function setup() {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })
  const ed = new Editor({ extensions: buildExtensions(), content: seed() })
  editors.push(ed)
  const sent = (event) => spy.mock.calls.filter(([url]) => url === TELEMETRY).map(([, init]) => JSON.parse(init.body))
    .filter((b) => b.event === event)
  return { ed, sent }
}
const embeds = (ed) => ed.getJSON().content.filter((n) => n.type === 'widgetEmbed').map((n) => n.attrs.widgetId)
const endRange = (ed) => { const at = ed.state.doc.content.size - 1; return { from: at, to: at } }

afterEach(() => { for (const ed of editors) ed.destroy(); editors = []; vi.restoreAllMocks() })

describe('block_inserted', () => {
  it('a slash press on Position sizing sends one block_inserted {positionSizing, slash}; block_used still fires', () => {
    const { ed, sent } = setup()
    const item = ITEMS.find((i) => i.title === WIDGET_REGISTRY.positionSizing.labels.menu)
    withInsertDoor('slash', () => item.command({ editor: ed, range: endRange(ed) }))
    expect(embeds(ed)).toEqual(['positionSizing'])
    expect(sent('block_inserted')).toEqual([{ event: 'block_inserted', props: { kind: 'positionSizing', via: 'slash' } }])
    expect(sent('block_used')).toEqual([{ event: 'block_used', props: { kind: 'positionSizing' } }])
  })

  it('the slash menu runs every item inside the slash door (slashCommand, read from its source)', () => {
    const { ed, sent } = setup()
    const [chart] = widgetItems('chart AMD 15m')
    // slashCommand runs only for a live Suggestion session (lib/suggestionSession.js), which a unit editor has none of;
    // so its body is read: the item's command runs inside withInsertDoor('slash', ...).
    const src = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/SlashMenu.jsx'), 'utf8')
    const body = src.split('export const slashCommand = ')[1].split('\n})')[0]
    expect(body).toMatch(/withInsertDoor\('slash', \(\) => props\.command\(\{ editor, range \}\)\)/)
    expect(typeof slashCommand).toBe('function')
    withInsertDoor('slash', () => chart.command({ editor: ed, range: endRange(ed) }))
    expect(embeds(ed)).toEqual(['chart'])
    expect(sent('block_inserted')).toEqual([{ event: 'block_inserted', props: { kind: 'chart', via: 'slash' } }])
  })

  it('a press that inserts three charts (/mtf) still counts once', () => {
    const { ed, sent } = setup()
    const [mtf] = widgetItems('mtf AMD')
    expect(mtf?.cmd).toBe('mtf')
    withInsertDoor('palette', () => mtf.command({ editor: ed, range: endRange(ed) }))
    expect(embeds(ed).length).toBeGreaterThan(1)
    expect(sent('block_inserted')).toEqual([{ event: 'block_inserted', props: { kind: 'chart', via: 'palette' } }])
  })

  it('CONTROL: the same insert outside a door counts nothing', () => {
    const { ed, sent } = setup()
    ed.chain().focus('end').insertWidgetEmbed('watchlist', {}).run()
    expect(embeds(ed)).toEqual(['watchlist'])
    expect(sent('block_inserted')).toEqual([])
  })

  it('a text block from the slash menu (a heading) is not a registry block and counts nothing', () => {
    const { ed, sent } = setup()
    const heading = ITEMS.find((i) => i.title === 'Heading 1')
    withInsertDoor('slash', () => heading.command({ editor: ed, range: endRange(ed) }))
    expect(sent('block_inserted')).toEqual([])
  })

  it('fix round 1 (I4): a body reload (setContent) while a slow press is in flight is not claimed by its door', async () => {
    const { ed, sent } = setup()
    let release
    const press = withInsertDoor('slash', () => new Promise((r) => { release = r }))
    ed.commands.setContent({ type: 'doc', content: [
      { type: 'widgetEmbed', attrs: { widgetId: 'watchlist' } }, { type: 'paragraph' },
    ] })
    expect(embeds(ed)).toEqual(['watchlist'])                   // control: a widget did land
    release()
    await press
    expect(sent('block_inserted')).toEqual([])
  })
})
