// Task 9.6c (9.6b m-3): My tools' Duplicate. It sends the one per-intent key (lib/toolsCrud), and a replayed copy that
// was archived in another tab since is shown where it really is: the Archived list, its row focused (Restore is its
// action), with one sentence saying so, never "Made …" in the Active list. A 409 for a reused key shows the server's
// sentence as it came, and the next press works under a fresh key. Every assertion reads what the member SEES or what
// the server is SENT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import MyToolsSheet from './MyToolsSheet'
import { installToolsFetch, refuse, ROUTINES } from './__fixtures__/toolsFixtures'
import { CRUD_COPY } from '../../../lib/toolsCrud'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('../routines/openRoutineEditor.js', () => ({ openRoutineEditor: vi.fn(() => () => {}) }))
vi.mock('../routines/openTrackerEditor.js', () => ({ openTrackerEditor: vi.fn(() => () => {}) }))

const S_KEY_REUSED = 'That Duplicate was already sent for a different routine or tracker. Press Duplicate again to copy this one.'
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const live = () => screen.getByTestId('my-tools-message')
const saysLive = (text) => waitFor(() => expect(live()).toHaveTextContent(text))
const rows = () => screen.getAllByTestId('my-tools-tool-row')
const rowOf = (name) => rows().find((r) => within(r).queryByText(name, { exact: true }))
const menuItem = (label) => screen.getByRole('menuitem', { name: label })
const sent = (net, path) => net.calls.filter((c) => c.method === 'POST' && c.path === path)

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function openTab() {
  render(<MyToolsSheet onClose={() => {}} uid="u1" tab="routines" />)
  await screen.findByRole('heading', { name: /routines?$/ })
}
async function duplicateRow(name) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  await screen.findByRole('menu', { name })
  fireEvent.click(menuItem('Duplicate'))
}

describe('My tools adopts a duplicate answer honestly', () => {
  it('a replayed copy that was archived meanwhile: the Archived list, its row focused, one sentence', async () => {
    const copy = { ...ROUTINES.active[1], id: 'r2c', name: 'Rules I keep copy', archived: true, replayed: true }
    let net = null
    net = installToolsFetch([
      ['POST', 'routines/r2/duplicate', () => { net.data.routines.archived.push(copy); return copy }],
    ])
    await openTab()
    await duplicateRow('Rules I keep')
    await saysLive(CRUD_COPY.copyArchived)
    expect(live()).not.toHaveTextContent('Made')
    expect(await screen.findByRole('heading', { name: '2 archived' })).toBeInTheDocument()
    const row = rowOf('Rules I keep copy')
    expect(within(row).getByRole('button', { name: 'Restore Rules I keep copy' })).toBeInTheDocument()
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true))
    expect(sent(net, 'routines/r2/duplicate')[0].headers['Idempotency-Key']).toMatch(UUID4)
  })

  it('a live copy still lands in Active, "Made …", as before', async () => {
    const net = installToolsFetch([
      ['POST', 'routines/r2/duplicate', () => ({ ...ROUTINES.active[1], id: 'r2d', name: 'Rules I keep copy' })],
    ])
    await openTab()
    await duplicateRow('Rules I keep')
    await saysLive('Made “Rules I keep copy”.')
    expect(screen.getByRole('heading', { name: '3 routines' })).toBeInTheDocument()
    expect(sent(net, 'routines/r2/duplicate')).toHaveLength(1)
  })

  it('a 409 for a reused key shows the server\'s sentence verbatim; the next press works under a fresh key', async () => {
    let first = true
    const net = installToolsFetch([
      ['POST', 'routines/r3/duplicate', () => {
        if (first) { first = false; return refuse(409, 'conflict', S_KEY_REUSED) }
        return { ...ROUTINES.active[2], id: 'r3c', name: 'Trade-day check copy' }
      }],
    ])
    await openTab()
    await duplicateRow('Trade-day check')
    await saysLive(S_KEY_REUSED)
    await duplicateRow('Trade-day check')
    await saysLive('Made “Trade-day check copy”.')
    const [a, b] = sent(net, 'routines/r3/duplicate').map((c) => c.headers['Idempotency-Key'])
    expect(a).toMatch(UUID4)
    expect(b).toMatch(UUID4)
    expect(b).not.toBe(a)
  })
})
