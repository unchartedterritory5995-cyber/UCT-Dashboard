// Wave 8 (Task 8.17 fix round 1): the door from a placed widget ("Manage…") hands My tools the app router's navigate
// when the widget is drawn inside a router, and nothing when it is not (BuiltWidgetEmbed.test.jsx covers that half).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import BuiltWidgetEmbed from '../widgets/BuiltWidgetEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { openMyTools } from './openMyTools.js'

vi.mock('./openMyTools.js', () => ({ openMyTools: vi.fn(() => () => {}) }))
vi.mock('../widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 8 }))

const PARAMS = {
  asOf: '2026-10-24T14:00:00Z', source: 'manual', sourceKey: 'closed_trades', title: 'Net P&L', defId: 'd-1', defRev: 1,
  def: { v: 1, source: 'closed_trades' }, scopeLabel: 'Main account', rangeLabel: 'Last 90 days', count: 47,
  sourceDetail: 'Your closed trades in the Journal.', share: false, view: 'number',
  measures: [{ label: 'Net P&L', unit: 'trades', kind: 'sum', fmt: 'money' }], value: { v1: 2140, n1: 47, n: 47 },
}

beforeEach(() => {
  openMyTools.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ id: 'd-1', rev: 1, placedRev: 1, etag: 4, archived: false, summary: 'x' }),
  })))
})
afterEach(() => vi.unstubAllGlobals())

describe('Manage… from a placed widget inside the app router', () => {
  it('passes a navigate that moves the router', async () => {
    function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p> }
    const editor = { id: 'editor' }
    render(
      <MemoryRouter initialEntries={['/journal/notebook?note=here']}>
        <Routes><Route path="*" element={<Where />} /></Routes>
        <BuiltWidgetEmbed attrs={widgetEmbedNode('builtWidget', PARAMS).attrs} editable onUpdateParams={() => true}
          editor={editor} getPos={() => 1} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More for this widget' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Manage…' }))
    await waitFor(() => expect(openMyTools).toHaveBeenCalledTimes(1))
    const arg = openMyTools.mock.calls[0][0]
    expect(arg).toMatchObject({ editor, defId: 'd-1' })
    expect(typeof arg.navigate).toBe('function')
    act(() => { arg.navigate('/journal/notebook?note=n7') })
    expect(screen.getByTestId('where')).toHaveTextContent('/journal/notebook?note=n7')
  })
})
