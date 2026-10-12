import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { BUILTIN_NOTE_KINDS } from '../../../lib/noteKinds'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import KindSection from './KindSection'

// Fixtures mirror the server's list/preview bodies (journal_styles._builtin/_row, preview_style).
// The generated contract fixtures belong to Task 8 and are not in this tree yet.
const builtin = (k) => ({
  id: `builtin:${k.id}`, name: `${k.name} (starter)`, kindId: k.id, builtin: true, isDefault: true,
  version: 1, outlineTemplateId: null, hasOutline: true, blocks: [], properties: {},
})
const listBody = {
  kinds: BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true })),
  styles: [
    ...BUILTIN_NOTE_KINDS.map(builtin),
    { id: 's-mine', name: 'My plan', kindId: 'trade_plan', builtin: false, isDefault: false, version: 2,
      outlineTemplateId: null, hasOutline: true, blocks: [{ block: 'chart', enabled: true }], properties: {} },
  ],
  blockKinds: [],
}
const previewBody = {
  bodyJson: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
    { type: 'widgetEmbed', attrs: { widgetId: 'chart', params: { symbol: 'NVDA', tf: 'D' } } },
  ] },
  properties: {}, skipped: [], ticker: 'NVDA', tickerSource: 'latest-note',
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => latchNotebookFlags({ notebook_journal_styles_enabled: true }))
afterEach(() => { vi.restoreAllMocks(); __resetNotebookFlags() })

function renderSection(props = {}, { list = listBody, preview = previewBody } = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    ok(String(url).endsWith('/preview') ? preview : list))
  const onCreate = vi.fn()
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <KindSection onCreate={onCreate} busy={false} {...props} />
  </SWRConfig>)
  return { onCreate }
}

describe('New note: pick a kind', () => {
  it('lists every kind and one press makes a note of that kind', async () => {
    const { onCreate } = renderSection()
    const group = await screen.findByRole('group', { name: 'Start from a kind of note' })
    expect(within(group).getAllByRole('button', { name: /^New / }).length).toBe(listBody.kinds.length)
    fireEvent.click(within(group).getByRole('button', { name: 'New Trade plan' }))
    expect(onCreate).toHaveBeenCalledWith({ kindId: 'trade_plan' })
  })

  it('names the default style on each kind button', async () => {
    renderSection()
    const btn = await screen.findByRole('button', { name: 'New Trade plan' })
    expect(btn.textContent).toContain('Trade plan (starter)')
  })

  it('Choose another style lists that kind’s styles, previews one with my data, and uses it', async () => {
    const { onCreate } = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for Trade plan' }))
    const list = screen.getByRole('list', { name: 'Styles for Trade plan' })
    const mine = within(list).getAllByRole('listitem').find((li) => !/Built-in/.test(li.textContent))
    fireEvent.click(within(mine).getByRole('button', { name: /^Preview / }))
    expect(await screen.findByText(new RegExp(`Shown with ${previewBody.ticker}`))).toBeTruthy()
    // the chart block shows as a line, not a live chart
    expect(screen.getByText(/Chart · NVDA · Daily/).tagName).toBe('EM')
    fireEvent.click(within(mine).getByRole('button', { name: /^Use / }))
    expect(onCreate).toHaveBeenCalledWith({ styleId: 's-mine' })
  })

  it('"Use this style" inside the preview makes the note and closes the preview', async () => {
    const { onCreate } = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for Trade plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview My plan' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use this template' }))
    expect(onCreate).toHaveBeenCalledWith({ styleId: 's-mine' })
  })

  it('a preview that fails says so and offers no Use', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for Trade plan' }))
    globalThis.fetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview My plan' }))
    expect((await screen.findByRole('alert')).textContent).toContain('boom')
    expect(screen.getByRole('button', { name: 'Use this template' })).toBeDisabled()
  })

  // Round 2, I2: with the switch on, a block the app KNOWS is described by its name; only a block this
  // bundle truly does not know is "from a newer version".
  it('previews a known widget by its own name, a truly unknown one as a newer-version block', async () => {
    const embed = (widgetId, params = {}) => ({ type: 'widgetEmbed', attrs: { widgetId, params } })
    renderSection({}, { preview: { ...previewBody, bodyJson: { type: 'doc', content: [
      embed('news', { symbol: 'NVDA' }), embed('chart', {}), embed('zz_future'),
    ] } } })
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for Trade plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview My plan' }))
    await screen.findByText(/Shown with NVDA/)
    const lines = [...document.querySelectorAll('[data-template-preview-body] em')].map((el) => el.textContent)
    expect(lines).toEqual(['News', 'Chart of the note’s ticker', 'A block from a newer version (zz_future)'])
  })

  it('a kind with no styles says so instead of opening an empty list', async () => {
    renderSection({}, { list: { ...listBody, kinds: [...listBody.kinds, { id: 'k_mine', name: 'My kind', icon: null }] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for My kind' }))
    expect(screen.getByText('No styles for this kind yet.')).toBeTruthy()
  })

  it('two pickers on screen do not share a heading id', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok(listBody))
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <KindSection onCreate={() => {}} /><KindSection onCreate={() => {}} />
    </SWRConfig>)
    await screen.findAllByRole('group', { name: 'Start from a kind of note' })
    const ids = [...document.querySelectorAll('section[aria-labelledby]')].map((s) => s.getAttribute('aria-labelledby'))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(document.getElementById(id)).toBeTruthy()
  })

  it('autoFocusFirst puts keyboard focus on the first kind once the list is there', async () => {
    renderSection({ autoFocusFirst: true })
    const first = await screen.findByRole('button', { name: 'New Trade plan' })
    await waitFor(() => expect(document.activeElement).toBe(first))
  })

  it('without autoFocusFirst it takes no focus', async () => {
    renderSection()
    const first = await screen.findByRole('button', { name: 'New Trade plan' })
    expect(document.activeElement).not.toBe(first)
  })

  it('every kind button carries the touch-floor class', async () => {
    renderSection()
    const btn = await screen.findByRole('button', { name: 'New Trade plan' })
    expect(btn.className).toMatch(/kindBtn/)
  })

  it('with the switch off the hook asks for nothing (the mount itself is gated in NotebookTab)', async () => {
    __resetNotebookFlags()
    renderSection()
    await Promise.resolve()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
