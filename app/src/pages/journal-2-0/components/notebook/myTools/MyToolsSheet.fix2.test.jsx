// Wave 8 (Task 8.17 fix round 2): the re-review's findings, each as a test that fails without its fix.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react'
import { useEffect, useState } from 'react'
import MyToolsSheet from './MyToolsSheet'
import { openMyTools } from './openMyTools'
import { installFetch, refuse } from './__fixtures__/myToolsFixtures'

const bp = vi.hoisted(() => ({ phone: false, touch: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))
vi.mock('../widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))
vi.mock('../widgets/SetsDialog', () => ({ openSetsDialog: vi.fn(() => () => {}) }))

const live = () => screen.getByTestId('my-tools-message')
const saysLive = (text) => waitFor(() => expect(live()).toHaveTextContent(text))
const actionsOf = (name) => screen.getByRole('button', { name: `Actions for ${name}` })
async function menuFor(name) {
  fireEvent.click(actionsOf(name))
  return screen.findByRole('menu', { name })
}
const menuItem = (label) => screen.getByRole('menuitem', { name: label })
const showList = (label) => fireEvent.click(screen.getByRole('button', { name: label, pressed: false }))
function later() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
/** How many times an element was ADDED under `node` (a MutationObserver over its children). */
function countAdditions(node) {
  const seen = { n: 0 }
  const obs = new MutationObserver((records) => {
    for (const r of records) seen.n += [...r.addedNodes].filter((x) => x.nodeType === 1).length
  })
  obs.observe(node, { childList: true, subtree: true })
  return { seen, stop: () => obs.disconnect() }
}

let net
beforeEach(() => { bp.phone = false; bp.touch = false; net = installFetch() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function openSheet(props = {}) {
  const onClose = vi.fn()
  render(<MyToolsSheet onClose={onClose} uid="u1" {...props} />)
  await screen.findByRole('heading', { name: /widgets?$/ })
  return { onClose }
}

describe('I-2: the same message twice is announced twice', () => {
  it('two identical refusals in a row put two new nodes in the live region', async () => {
    // Rename's Save, refused twice the same way: nothing clears the region between the two (unlike a menu action).
    net = installFetch([['PUT', '/w1', () => refuse(500, 'failed', '')]])
    await openSheet()
    const region = live()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Rename'))
    const input = await screen.findByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Again' } })
    const watch = countAdditions(region)
    fireEvent.submit(input.closest('form'))
    await saysLive("That didn't go through. Try again.")
    await waitFor(() => expect(watch.seen.n).toBe(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save name' })).not.toHaveAttribute('aria-busy'))
    fireEvent.submit(input.closest('form'))
    await waitFor(() => expect(net.calls.filter((c) => c.method === 'PUT')).toHaveLength(2))
    await waitFor(() => expect(watch.seen.n).toBe(2))
    expect(region).toHaveTextContent("That didn't go through. Try again.")
    expect(live()).toBe(region)
    watch.stop()
  })

  it('CONTROL: the count sees a keyed replacement, and stays at zero for an equal-text re-render', async () => {
    const bumps = {}
    function Harness({ id, keyed }) {
      const [n, set] = useState(1)
      useEffect(() => { bumps[id] = () => set((x) => x + 1) })
      return <p data-testid={id}>{keyed ? <span key={n}>same</span> : <span>same</span>}</p>
    }
    render(<><Harness id="plain" keyed={false} /><Harness id="keyed" keyed /></>)
    const plain = countAdditions(screen.getByTestId('plain'))
    const keyed = countAdditions(screen.getByTestId('keyed'))
    act(() => { bumps.plain(); bumps.keyed() })
    act(() => { bumps.plain(); bumps.keyed() })
    await waitFor(() => expect(keyed.seen.n).toBe(2))
    expect(plain.seen.n).toBe(0)
    plain.stop()
    keyed.stop()
  })
})

describe('M-1: a control is never disabled under the member\'s focus', () => {
  it('Archive in its panel stays focusable while it runs, a second click sends nothing, and focus stays on it', async () => {
    const answer = later()
    net = installFetch([['POST', '/w1/archive', () => answer.promise.then(() => refuse(500, 'failed', ''))]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Archive'))
    const btn = await screen.findByRole('button', { name: 'Archive' })
    btn.focus()
    fireEvent.click(btn)
    const running = await screen.findByRole('button', { name: 'Archiving…' })
    expect(running).not.toBeDisabled()
    expect(running).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(running)
    expect(net.calls.filter((c) => c.path === '/w1/archive')).toHaveLength(1)
    await act(async () => { answer.resolve() })
    await saysLive("That didn't go through. Try again.")
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveFocus()
  })

  it('Save name stays focusable while it runs and a second Enter sends nothing', async () => {
    const answer = later()
    net = installFetch([['PUT', '/w1', () => answer.promise.then(() => refuse(500, 'failed', ''))]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Rename'))
    const input = await screen.findByLabelText('Name')
    fireEvent.change(input, { target: { value: 'New' } })
    fireEvent.submit(input.closest('form'))
    const saving = await screen.findByRole('button', { name: 'Saving…' })
    expect(saving).not.toBeDisabled()
    fireEvent.submit(input.closest('form'))
    expect(net.calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    await act(async () => { answer.resolve() })
    await saysLive("That didn't go through. Try again.")
  })

  it('the desktop row\'s Restore stays focusable while it runs', async () => {
    const answer = later()
    net = installFetch([['POST', '/a1/unarchive', () => answer.promise.then(() => refuse(500, 'failed', ''))]])
    await openSheet()
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    const btn = screen.getByRole('button', { name: 'Restore Old edge' })
    btn.focus()
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute('aria-disabled', 'true'))
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(net.calls.filter((c) => c.path === '/a1/unarchive')).toHaveLength(1)
    await act(async () => { answer.resolve() })
    await saysLive("That didn't go through. Try again.")
    expect(btn).toHaveFocus()
  })
})

describe('M-3: a failed re-read takes focus at once, never later', () => {
  it('after Delete, a failed re-read focuses the failure\'s Try again', async () => {
    let reads = 0
    net = installFetch([
      ['POST', '/a1/delete', () => ({ id: 'a1', deletedAt: '2025-03-04T17:00:00Z' })],
      ['GET', '?view=archived', () => { reads += 1; return reads === 1 ? { widgets: net.lists.archived } : refuse(500, 'failed', '') }],
    ])
    await openSheet()
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    await menuFor('Old edge')
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByLabelText('Type Old edge to confirm')
    fireEvent.change(field, { target: { value: 'Old edge' } })
    fireEvent.submit(field.closest('form'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus())
  })

  it('a failed re-read with nothing to retry (402) focuses its sentence', async () => {
    let reads = 0
    net = installFetch([
      ['POST', '/a1/unarchive', () => ({ id: 'a1' })],
      ['GET', '?view=archived', () => { reads += 1; return reads === 1 ? { widgets: net.lists.archived } : { ok: false, status: 402, json: async () => ({}) } }],
    ])
    await openSheet()
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    fireEvent.click(screen.getByRole('button', { name: 'Restore Old edge' }))
    await waitFor(() => expect(screen.getByTestId('my-tools-load-failed')).toHaveFocus())
    expect(screen.getByTestId('my-tools-load-failed')).toHaveTextContent('My tools needs a paid plan.')
  })
})

describe('M-4: the Reload copy', () => {
  it('says the latest was loaded and the new name is still here', async () => {
    net = installFetch([['PUT', '/w1', () => refuse(409, 'conflict', 'SERVER: stale.')], ['GET', '/w1', () => ({ ...net.lists.live[0], etag: 12 })]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Rename'))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
    await saysLive("Loaded the latest “Net P&L by setup”. Your new name is still here; save it when you're ready.")
  })
})

describe('M-5: openMyTools while open', () => {
  afterEach(async () => {
    const close = openMyTools({})
    await act(async () => { close() })
    await waitFor(() => expect(document.querySelector('[data-my-tools-root]')).toBeNull())
  })

  it('the same widget asked for again, after the member moved to another list, is focused again', async () => {
    await act(async () => { openMyTools({ defId: 'w1', uid: 'u1' }) })
    await waitFor(() => expect(actionsOf('Net P&L by setup')).toHaveFocus())
    showList('Recently deleted')
    await screen.findByRole('heading', { name: '1 recently deleted' })
    await act(async () => { openMyTools({ defId: 'w1' }) })
    await waitFor(() => expect(actionsOf('Net P&L by setup')).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Active', pressed: true })).toBeInTheDocument()
  })

  it('...and after the member moved to another tab', async () => {
    await act(async () => { openMyTools({ defId: 'w1', uid: 'u1' }) })
    await waitFor(() => expect(actionsOf('Net P&L by setup')).toHaveFocus())
    fireEvent.click(screen.getByRole('tab', { name: 'Trackers' }))
    await act(async () => { openMyTools({ defId: 'w1' }) })
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(actionsOf('Net P&L by setup')).toHaveFocus())
  })

  it('honours the new tab, and the new navigate', async () => {
    const first = vi.fn()
    const second = vi.fn()
    await act(async () => { openMyTools({ uid: 'u1', navigate: first }) })
    await screen.findByRole('heading', { name: '2 widgets' })
    await act(async () => { openMyTools({ tab: 'templates', navigate: second }) })
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Widgets' }))
    await screen.findByRole('heading', { name: '2 widgets' })
    fireEvent.click(within(screen.getAllByTestId('my-tools-row')[0]).getByRole('button', { name: /^Used in 3 notes/ }))
    fireEvent.click(await screen.findByRole('link', { name: /Weekly review/ }), { button: 0 })
    expect(second).toHaveBeenCalledWith('/journal/notebook?note=n1')
    expect(first).not.toHaveBeenCalled()
  })
})
