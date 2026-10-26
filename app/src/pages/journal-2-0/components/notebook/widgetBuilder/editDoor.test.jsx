// Wave 8 (Task 8.15 fix 1, I-9): the placed widget's "Edit widget" door hands the builder the ⋯ button as the place
// focus returns to, so closing the builder without placing anything lands the member back where they were.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import BuiltWidgetEmbed from '../widgets/BuiltWidgetEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { openWidgetBuilder } from './openWidgetBuilder.js'

vi.mock('./openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 8 }))

const answer = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data })
const PARAMS = {
  asOf: '2026-10-24T14:00:00Z', source: 'manual', sourceKey: 'closed_trades', view: 'number', title: 'Net P&L',
  summary: 'Net P&L of every closed trade.', defId: 'd-1', defRev: 1, def: { v: 1, source: 'closed_trades' },
  measures: [{ label: 'Net P&L', unit: 'trades', kind: 'sum', fmt: 'money' }], value: { v1: 1, n1: 1, s1: '' },
  count: 1, share: false,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => answer({ id: 'd-1', rev: 1, placedRev: 1, etag: 4, archived: false, summary: 'x' })))
  openWidgetBuilder.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('the Edit widget door', () => {
  it('passes the ⋯ button as returnFocus', async () => {
    const editor = { id: 'editor' }
    const getPos = () => 7
    render(<BuiltWidgetEmbed attrs={widgetEmbedNode('builtWidget', PARAMS).attrs} editable onUpdateParams={() => true}
      editor={editor} getPos={getPos} />)
    const more = screen.getByRole('button', { name: 'More for this widget' })
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'How this is made' }))
    const sheet = await screen.findByRole('dialog', { name: 'How this is made' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit widget' }))
    await waitFor(() => expect(openWidgetBuilder).toHaveBeenCalledTimes(1))
    const arg = openWidgetBuilder.mock.calls[0][0]
    expect(arg.from).toEqual({ defId: 'd-1', getPos })
    expect(arg.returnFocus).toBe(more)
  })
})
