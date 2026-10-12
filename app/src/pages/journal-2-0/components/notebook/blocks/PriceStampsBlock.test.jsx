import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
let STYLES_ON = true
vi.mock('../../../lib/journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => STYLES_ON }))
import PriceStampsBlock from './PriceStampsBlock'
import { buildExtensions } from '../../../lib/tiptap'
import { PRICE_STAMPS_KEY } from '../../../lib/blocks/priceStamps'

afterEach(() => { STYLES_ON = true })

describe('PriceStampsBlock', () => {
  it('a named switch; turning it on is one setParams', () => {
    const setParams = vi.fn(() => true)
    render(<PriceStampsBlock params={{ on: 'no' }} setParams={setParams} editable />)
    const sw = screen.getByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.textContent).toBe('Price stamps: off')
    fireEvent.click(sw)
    expect(setParams).toHaveBeenCalledTimes(1)
    expect(setParams).toHaveBeenCalledWith({ on: 'yes' })
  })
  it('on: the switch says so, and turning it off is one setParams', () => {
    const setParams = vi.fn(() => true)
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={setParams} editable />)
    const sw = screen.getByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.textContent).toBe('Price stamps: on')
    fireEvent.click(sw)
    expect(setParams).toHaveBeenCalledWith({ on: 'no' })
  })
  it('says how it works', () => {
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/Write \$NVDA and press Enter/)).toBeTruthy()
  })
  it('a read-only note: the switch shows its state and cannot be changed', () => {
    const setParams = vi.fn()
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={setParams} editable={false} />)
    const sw = screen.getByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.disabled).toBe(true)
    fireEvent.click(sw)
    expect(setParams).not.toHaveBeenCalled()
  })
  it('the switch off: says what it needs, and the toggle is disabled (S24)', () => {
    STYLES_ON = false
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('This block needs Journal styles, which is not on for you.')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Stamp prices as I write' }).disabled).toBe(true)
    expect(screen.queryByText(/Write \$NVDA and press Enter/)).toBeNull()
  })
})

// ── Fix round 1 (option E): the block HOLDS the editor's stamp plugin while it is mounted and on ──────
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Long $NVDA here' }] }] }
function realEditor() {
  const ed = new Editor({ extensions: buildExtensions(), content })
  ed.storage.uctJournalWidgets = { noteId: 'n1', noteTicker: null }
  return ed
}
const stampPlugins = (ed) => ed.state.plugins.filter((p) => p.spec.key === PRICE_STAMPS_KEY)
const block = (ed, on = 'yes', editable = true) => <PriceStampsBlock params={{ on }} setParams={vi.fn()} editable={editable} editor={ed} />
async function enterStamps(ed) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ fact: { id: 'f1' } }) }))
  ed.commands.setTextSelection(ed.state.doc.content.size - 1)
  ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })))
  await new Promise((r) => setTimeout(r, 30))
  return global.fetch.mock.calls.filter(([u]) => u === '/api/j2/trader-blocks/price-stamp').length
}

describe('PriceStampsBlock holds the price-stamp plugin', () => {
  it('mounted and on: the plugin is registered FIRST, and Enter stamps', async () => {
    const ed = realEditor()
    expect(stampPlugins(ed)).toHaveLength(0)
    render(block(ed))
    expect(stampPlugins(ed)).toHaveLength(1)
    expect(ed.state.plugins[0].spec.key).toBe(PRICE_STAMPS_KEY)
    expect(await enterStamps(ed)).toBe(1)
  })

  it('two stamps blocks: ONE plugin; removing one keeps stamping; removing both unregisters', async () => {
    const ed = realEditor()
    const a = render(block(ed))
    const b = render(block(ed))
    expect(stampPlugins(ed)).toHaveLength(1)
    a.unmount()
    expect(stampPlugins(ed)).toHaveLength(1)
    expect(await enterStamps(ed)).toBe(1)
    b.unmount()
    await waitFor(() => expect(stampPlugins(ed)).toHaveLength(0))       // the last let-go waits a microtask (N-1)
  })

  it('the block switched off: unregistered, and Enter stamps nothing', async () => {
    const ed = realEditor()
    const r = render(block(ed))
    expect(stampPlugins(ed)).toHaveLength(1)
    r.rerender(block(ed, 'no'))
    await waitFor(() => expect(stampPlugins(ed)).toHaveLength(0))
    expect(await enterStamps(ed)).toBe(0)
  })

  it('the block removed from the note: unregistered, and Enter stamps nothing', async () => {
    const ed = realEditor()
    const r = render(block(ed))
    r.unmount()
    await waitFor(() => expect(stampPlugins(ed)).toHaveLength(0))
    expect(await enterStamps(ed)).toBe(0)
  })

  it('the journal styles switch off: nothing registers, even with on = yes (S24)', async () => {
    STYLES_ON = false
    const ed = realEditor()
    render(block(ed))
    expect(stampPlugins(ed)).toHaveLength(0)
    expect(await enterStamps(ed)).toBe(0)
  })

  it('a read-only block registers nothing', () => {
    const ed = realEditor()
    render(block(ed, 'yes', false))
    expect(stampPlugins(ed)).toHaveLength(0)
  })

})
