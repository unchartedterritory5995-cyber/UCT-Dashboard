import { describe, it, expect, afterEach } from 'vitest'
import { ITEMS, blockItemGroup, blockItemMatches } from './SlashMenu'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { STYLE_EVENT } from '../../lib/journalStylesFlag'

afterEach(() => __resetNotebookFlags())
// S7 (one vocabulary): the row reads "Template" now; it is still the journal style switch underneath.
const item = () => ITEMS.find((i) => i.title === 'Template')

describe('/style', () => {
  it('is a Planning a trade item available only while journal styles are on', () => {
    expect(item()).toBeTruthy()
    expect(blockItemGroup(item())).toBe('plan')
    expect(item().available({})).toBe(false)
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    expect(item().available({})).toBe(true)
  })
  it('answers /style (a keyword now) and /template by its title', () => {
    expect(blockItemMatches(item(), 'style')).toBe(true)
    expect(blockItemMatches(item(), 'template')).toBe(true)
  })
  it('dispatches the style event on the editor root', () => {
    const seen = []
    const dom = { dispatchEvent: (e) => seen.push(e.type) }
    const chain = { focus: () => chain, deleteRange: () => chain, run: () => true }
    item().command({ editor: { chain: () => chain, view: { dom } }, range: { from: 1, to: 2 } })
    expect(seen).toEqual([STYLE_EVENT])
  })
})
