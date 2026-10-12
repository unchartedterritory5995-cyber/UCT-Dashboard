import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

function renderSection(props = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    ok(String(url).endsWith('/preview') ? previewBody : listBody))
  const onKind = vi.fn()
  const onStyle = vi.fn()
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <KindSection onKind={onKind} onStyle={onStyle} busy={false} {...props} />
  </SWRConfig>)
  return { onKind, onStyle }
}

describe('New note: pick a kind', () => {
  it('lists every kind and one press makes a note of that kind', async () => {
    const { onKind } = renderSection()
    const group = await screen.findByRole('group', { name: 'Start from a kind of note' })
    expect(within(group).getAllByRole('button', { name: /^New / }).length).toBe(listBody.kinds.length)
    fireEvent.click(within(group).getByRole('button', { name: 'New Trade plan' }))
    expect(onKind).toHaveBeenCalledWith('trade_plan')
  })

  it('names the default style on each kind button', async () => {
    renderSection()
    const btn = await screen.findByRole('button', { name: 'New Trade plan' })
    expect(btn.textContent).toContain('Trade plan (starter)')
  })

  it('Choose another style lists that kind’s styles, previews one with my data, and uses it', async () => {
    const { onStyle } = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for Trade plan' }))
    const list = screen.getByRole('list', { name: 'Styles for Trade plan' })
    const mine = within(list).getAllByRole('listitem').find((li) => !/Built-in/.test(li.textContent))
    fireEvent.click(within(mine).getByRole('button', { name: /^Preview / }))
    expect(await screen.findByText(new RegExp(`Shown with ${previewBody.ticker}`))).toBeTruthy()
    // the chart block shows as a line, not a live chart
    expect(document.querySelector('[data-block="chart"]').textContent).toContain('NVDA')
    fireEvent.click(within(mine).getByRole('button', { name: /^Use / }))
    expect(onStyle).toHaveBeenCalledWith('s-mine')
  })

  it('"Use this style" inside the preview makes the note and closes the preview', async () => {
    const { onStyle } = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for Trade plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview My plan' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use this style' }))
    expect(onStyle).toHaveBeenCalledWith('s-mine')
  })

  it('a preview that fails says so and offers no Use', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for Trade plan' }))
    globalThis.fetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview My plan' }))
    expect((await screen.findByRole('alert')).textContent).toContain('boom')
    expect(screen.getByRole('button', { name: 'Use this style' })).toBeDisabled()
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
