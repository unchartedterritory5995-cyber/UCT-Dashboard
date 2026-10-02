// Wave 11 lane 11D — "Trade-plan canvas" in the Notebook's New note sheet, and "Plan this
// trade" on a ticker's research page: the real components with only the network faked
// (a11y/fixtures.jsx).
//
// ⛔ THE GATE IS RAILED ON THE RENDERED DOM: "flag off ⇒ absent" means no button a member
// could press is in the document. Each absent case carries a control that the surface itself
// rendered (the sheet's template gallery, the research page's New thesis), so absence is
// never vacuous.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH, installFetch, latchWave8Flags, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'
import TickerResearchWorkspace from '../components/notebook/TickerResearchWorkspace'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function openNewNoteSheet() {
  render(<Providers route="/journal/notebook?view=all"><NotebookTab /></Providers>)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
  const sheet = await screen.findByRole('dialog', { name: 'New note' })
  expect(within(sheet).getAllByText('Blank note').length).toBeGreaterThan(0)   // control
  return sheet
}

describe('the New note sheet — Trade-plan canvas', () => {
  it('absent while no flag has latched', async () => {
    installFetch()
    __resetNotebookFlags()
    const sheet = await openNewNoteSheet()
    expect(within(sheet).queryByRole('button', { name: /Trade-plan canvas/ })).toBeNull()
  })
  it('absent while the gate is latched OFF (every other flag on)', async () => {
    installFetch()
    latchWave8Flags(true, { notebook_trade_canvas_enabled: false })
    const sheet = await openNewNoteSheet()
    expect(within(sheet).queryByRole('group', { name: 'Plan a trade' })).toBeNull()
  })
  it('gate on: one press makes a canvas note (a tradeCanvas body, tagged) and opens it', async () => {
    const created = { id: 'nc1', title: 'Trade plan — Oct 1', updatedAt: '2026-10-01T14:00:00.000000+00:00', tags: ['trade-plan'] }
    // one answer for the list GET and the create POST (the stub sees only the URL)
    const spy = installFetch([[/^\/api\/j2\/notes$/, { note: created, notes: [], total: 0 }]])
    latchWave8Flags(true, { notebook_trade_canvas_enabled: true })
    const sheet = await openNewNoteSheet()
    const group = within(sheet).getByRole('group', { name: 'Plan a trade' })
    fireEvent.click(within(group).getByRole('button', { name: /Trade-plan canvas/ }))
    await waitFor(() => {
      const post = spy.mock.calls.find(([u, o]) => String(u) === '/api/j2/notes' && o?.method === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse(post[1].body)
      expect(body.bodyJson.content[0].type).toBe('tradeCanvas')
      expect(body.tags).toEqual(['trade-plan'])
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull())
  })
})

describe('the research page — Plan this trade', () => {
  const SUMMARY = {
    identity: { symbol: 'NVDA', name: 'NVIDIA' }, notes: [], activeTheses: [], pastTheses: [],
    facts: [], documents: [], tradeSummary: null,
  }
  it('absent with the gate off (control: New thesis is there)', async () => {
    installFetch([[/^\/api\/j2\/research\/NVDA/, SUMMARY], [/^\/api\/j2\/notes\/research\/NVDA/, SUMMARY]])
    latchWave8Flags(true, { notebook_trade_canvas_enabled: false })
    render(<Providers><TickerResearchWorkspace symbol="NVDA" onOpenNote={() => {}} /></Providers>)
    await screen.findByRole('button', { name: /New thesis/ })
    expect(screen.queryByRole('button', { name: /Plan this trade/ })).toBeNull()
  })
  it('gate on: makes a canvas for the ticker with a live daily chart of it, and opens it', async () => {
    const created = { id: 'nc2', title: 'NVDA trade plan', updatedAt: '2026-10-01T14:00:00.000000+00:00' }
    const spy = installFetch([
      [/^\/api\/j2\/research\/NVDA/, SUMMARY], [/^\/api\/j2\/notes\/research\/NVDA/, SUMMARY],
      [/^\/api\/j2\/notes$/, { note: created, notes: [], total: 0 }],
    ])
    latchWave8Flags(true, { notebook_trade_canvas_enabled: true })
    const opened = []
    render(<Providers><TickerResearchWorkspace symbol="NVDA" onOpenNote={(n) => opened.push(n.id)} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: /Plan this trade/ }))
    await waitFor(() => expect(opened).toEqual(['nc2']))
    const post = spy.mock.calls.find(([u, o]) => String(u) === '/api/j2/notes' && o?.method === 'POST')
    const body = JSON.parse(post[1].body)
    expect(body.ticker).toBe('NVDA')
    expect(body.bodyJson.content[0].attrs.board.items).toEqual([
      expect.objectContaining({ kind: 'chart', symbol: 'NVDA', tf: 'D', mode: 'live' }),
    ])
  })
})
