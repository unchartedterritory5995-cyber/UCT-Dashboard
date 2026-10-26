// Wave 8 consolidation round 2 (ruling R-50): My tools' two saves that MAKE a widget (the restore question's "Save as
// a new widget" PUT and Duplicate's create POST) carry an Idempotency-Key: one per intent, the same key for a retry
// after a lost answer (so the server replays the one copy), a fresh key once an answer confirmed the outcome.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import MyToolsSheet from './MyToolsSheet'
import VersionHistory from './VersionHistory'
import { installFetch, refuse, LIVE } from './__fixtures__/myToolsFixtures'

const bp = vi.hoisted(() => ({ touch: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('../widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))
vi.mock('../widgets/SetsDialog', () => ({ openSetsDialog: vi.fn(() => () => {}) }))

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const lost = () => Promise.reject(new Error('the network dropped the answer'))
const keyOf = (c) => c.headers['Idempotency-Key']
const REVS = [
  { rev: 3, summary: 'Now.', savedAt: '2025-03-04T17:00:00Z', named: null, current: true, placed: false, plan: {} },
  { rev: 2, summary: 'Before.', savedAt: '2025-03-01T18:30:00Z', named: null, current: false, placed: true, plan: {} },
]
const W1 = LIVE[0]

let net
beforeEach(() => { vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { fn(0); return 0 }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('R-50: "Save as a new widget" from the restore question', () => {
  async function toQuestion(putReply) {
    let puts = 0
    net = installFetch([
      ['GET', `/${W1.id}/revs`, () => ({ revs: REVS })],
      ['POST', `/${W1.id}/revs/2/restore`, () => ({ ...W1, rev: 4, etag: 8 })],
      ['PUT', `/${W1.id}`, (req) => { puts += 1; return putReply(puts, req) }],
      ['POST', `/${W1.id}/revs/3/restore`, () => ({ ...W1, rev: 5, etag: 9 })],
    ])
    render(<VersionHistory d={W1} onBack={vi.fn()} subBackRef={createRef()} announce={vi.fn()} onChanged={vi.fn()} />)
    await screen.findAllByTestId('my-tools-rev')
    const row = document.querySelector('[data-rev="2"]')
    fireEvent.click(within(row).getByRole('button', { name: /^Restore the version from/ }))
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }))
    await screen.findByText('This widget is in 3 notes.')
  }
  const puts = () => net.calls.filter((c) => c.method === 'PUT')

  it('a retry after a lost answer sends the SAME key and body, so the server makes exactly one copy', async () => {
    const copies = new Set()
    await toQuestion((n, req) => {
      copies.add(keyOf(req))                                       // the server's view: one copy per key
      return n === 1 ? lost() : { ...W1, id: 'w9', name: 'Copy', rev: 1, etag: 1 }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save as a new widget' })).not.toHaveAttribute('aria-busy', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    await waitFor(() => expect(puts()).toHaveLength(2))
    expect(keyOf(puts()[0])).toMatch(UUID4)
    expect(keyOf(puts()[1])).toBe(keyOf(puts()[0]))
    expect(puts()[1].body).toEqual(puts()[0].body)
    expect(copies.size).toBe(1)
  })

  it('a confirmed refusal ends the intent: the next press is a new request with a fresh key', async () => {
    await toQuestion((n) => (n === 1 ? refuse(409, 'count_cap', 'SERVER: cap.') : { ...W1, id: 'w9', rev: 1, etag: 1 }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save as a new widget' })).not.toHaveAttribute('aria-busy', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    await waitFor(() => expect(puts()).toHaveLength(2))
    expect(keyOf(puts()[1])).toMatch(UUID4)
    expect(keyOf(puts()[1])).not.toBe(keyOf(puts()[0]))
  })

  it('"Update all" (update_all) carries no key', async () => {
    await toQuestion(() => ({ ...W1, rev: 4, etag: 9 }))
    fireEvent.click(screen.getByRole('radio', { name: /Update all/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Update/ }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0].body).toEqual({ apply: 'update_all' })
    expect('Idempotency-Key' in puts()[0].headers).toBe(false)
  })
})

describe('R-50: Duplicate', () => {
  async function duplicate() {
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Net P&L by setup' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
  }
  const posts = () => net.calls.filter((c) => c.method === 'POST' && c.path === '')

  it('a press after a lost answer re-sends the same key and body: one copy', async () => {
    let n = 0
    const copies = new Set()
    net = installFetch([['POST', '', (req) => {
      n += 1
      copies.add(keyOf(req))
      return n === 1 ? lost() : { ...W1, id: 'w3', name: 'Net P&L by setup copy' }
    }]])
    render(<MyToolsSheet onClose={vi.fn()} uid="u1" />)
    await screen.findByRole('heading', { name: /widgets?$/ })
    await duplicate()
    await waitFor(() => expect(posts()).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Net P&L by setup' })).not.toHaveAttribute('aria-busy', 'true'))
    await duplicate()
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(keyOf(posts()[0])).toMatch(UUID4)
    expect(keyOf(posts()[1])).toBe(keyOf(posts()[0]))
    expect(posts()[1].body).toEqual(posts()[0].body)
    expect(copies.size).toBe(1)
  })

  it('after a copy landed, a second Duplicate is a new intent with a fresh key (a second copy, as asked)', async () => {
    net = installFetch([['POST', '', () => ({ ...W1, id: `w${net.calls.length + 10}`, name: 'Net P&L by setup copy' })]])
    render(<MyToolsSheet onClose={vi.fn()} uid="u1" />)
    await screen.findByRole('heading', { name: /widgets?$/ })
    await duplicate()
    await waitFor(() => expect(posts()).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Net P&L by setup' })).not.toHaveAttribute('aria-busy', 'true'))
    await duplicate()
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(keyOf(posts()[1])).toMatch(UUID4)
    expect(keyOf(posts()[1])).not.toBe(keyOf(posts()[0]))
  })
})
