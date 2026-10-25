// Wave 10 Task 10.20: the position size calculator's `/` item (W10-R8). Offered only while wave 10 is on (the latched
// notebook_widgets_w10_enabled), in the Planning a trade group; `/size` puts it first; it inserts its own kind.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ITEMS, blockItemsAvailable, blockItemGroup, rankedBlockItems, slashItems } from './SlashMenu'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const TITLE = 'Position size calculator'
const item = () => ITEMS.find((i) => i.title === TITLE)

afterEach(() => { __resetNotebookFlags() })

describe('/ Position size calculator', () => {
  it('size_calc_item_only_when_w10_on', () => {
    expect(ITEMS.filter((i) => i.title === TITLE)).toHaveLength(1)              // in the menu exactly once
    // off: not offered, whatever else is on
    latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_widgets_w9_enabled: true })
    expect(blockItemsAvailable({}).some((i) => i.title === TITLE)).toBe(false)
    expect(slashItems('size', {}).some((i) => i.title === TITLE)).toBe(false)
    expect(slashItems('', {}).some((i) => i.title === TITLE)).toBe(false)
    __resetNotebookFlags()
    // on: offered, in Planning a trade, and the bare / lists it
    latchNotebookFlags({ notebook_widgets_w10_enabled: true })
    const here = blockItemsAvailable({})
    const it10 = here.find((i) => i.title === TITLE)
    expect(it10).toBeTruthy()
    expect(blockItemGroup(it10)).toBe('plan')
    expect(slashItems('', {}).some((i) => i.title === TITLE)).toBe(true)
  })

  it('its words, keywords and the /size command', () => {
    expect(item().keywords).toEqual(['size', 'shares', 'risk', 'calculator', 'position'])
    expect(item().cmd).toBe('size')
    latchNotebookFlags({ notebook_widgets_w10_enabled: true })
    const here = blockItemsAvailable({})
    expect(rankedBlockItems(here, 'size')[0].title).toBe(TITLE)
    expect(slashItems('size', {})[0].title).toBe(TITLE)
    for (const k of ['shares', 'calculator']) expect(rankedBlockItems(here, k).map((i) => i.title), k).toContain(TITLE)
  })

  it('inserts the sizeCalc block, after deleting the typed command', () => {
    latchNotebookFlags({ notebook_widgets_w10_enabled: true })
    const log = []
    const chain = {}
    for (const name of ['focus', 'deleteRange', 'insertWidgetEmbed']) chain[name] = vi.fn((...a) => { log.push([name, ...a]); return chain })
    chain.run = vi.fn(() => true)
    item().command({ editor: { chain: () => chain }, range: { from: 2, to: 7 } })
    expect(chain.insertWidgetEmbed).toHaveBeenCalledTimes(1)
    expect(chain.insertWidgetEmbed).toHaveBeenCalledWith('sizeCalc')
    expect(log.findIndex(([n]) => n === 'deleteRange')).toBeLessThan(log.findIndex(([n]) => n === 'insertWidgetEmbed'))
  })
})
