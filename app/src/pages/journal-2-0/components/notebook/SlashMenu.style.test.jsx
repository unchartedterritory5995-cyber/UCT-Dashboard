import { describe, it, expect, afterEach } from 'vitest'
import { ITEMS, blockItemGroup } from './SlashMenu'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { STYLE_EVENT } from '../../lib/journalStylesFlag'

afterEach(() => __resetNotebookFlags())
const item = () => ITEMS.find((i) => i.title === 'Journal style')

describe('/style', () => {
  it('is a Trading item available only while journal styles are on', () => {
    expect(item()).toBeTruthy()
    expect(blockItemGroup(item())).toBe('trading')
    expect(item().available({})).toBe(false)
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    expect(item().available({})).toBe(true)
  })
  it('answers /style by title and keyword', () => {
    expect(item().keywords).toContain('style')
  })
  it('dispatches the style event on the editor root', () => {
    const seen = []
    const dom = { dispatchEvent: (e) => seen.push(e.type) }
    const chain = { focus: () => chain, deleteRange: () => chain, run: () => true }
    item().command({ editor: { chain: () => chain, view: { dom } }, range: { from: 1, to: 2 } })
    expect(seen).toEqual([STYLE_EVENT])
  })
})
