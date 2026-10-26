// Wave 8 (Task 8.17 fix round 3): version history focus with a BROWSER-LIKE frame (requestAnimationFrame on a 16 ms
// timer, never synchronous), and the Escape handler's layout-effect timing as a deterministic rail.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import { createRef, useEffect } from 'react'
import VersionHistory, { QUESTION_BACK } from './VersionHistory'
import { installFetch, refuse, LIVE } from './__fixtures__/myToolsFixtures'

// The rail for item 2 needs to look at the parent's Escape handler at the moment the question MOUNTS: a wrapper over
// the real question whose passive mount effect captures `subBackRef.current` (children's passive effects run after
// every layout effect and after the parent's passive CLEANUPS, so only a layout-effect assignment is there yet).
const probe = vi.hoisted(() => ({ ref: null, captured: undefined }))
vi.mock('./RestoreQuestion', async (orig) => {
  const Real = (await orig()).default
  function Wrapped(props) {
    useEffect(() => { probe.captured = probe.ref ? probe.ref.current : undefined }, [])
    return <Real {...props} />
  }
  return { default: Wrapped }
})

const S_CONFLICT = 'SERVER: changed in another tab, from the server.'
const REVS = [
  { rev: 3, summary: 'Now.', savedAt: '2025-03-04T17:00:00Z', named: null, current: true, placed: false, plan: {} },
  { rev: 2, summary: 'Then.', savedAt: '2025-03-01T18:30:00Z', named: null, current: false, placed: true, plan: {} },
]
const W1 = LIVE[0]
const restored = (extra = {}) => ({ ...W1, rev: 4, etag: 8, ...extra })
const revRow = (rev) => document.querySelector(`[data-rev="${rev}"]`)

function mount(routes = []) {
  installFetch([['GET', '/w1/revs', () => ({ revs: REVS })], ...routes])
  const announce = vi.fn()
  const subBack = createRef()
  probe.ref = subBack
  probe.captured = undefined
  render(<VersionHistory d={W1} onBack={() => {}} subBackRef={subBack} announce={announce} onChanged={() => {}} />)
  return { announce, subBack }
}
async function toQuestion() {
  await screen.findAllByTestId('my-tools-rev')
  fireEvent.click(within(revRow(2)).getByRole('button', { name: /^Restore the version from/ }))
  fireEvent.click(within(revRow(2)).getByRole('button', { name: 'Restore' }))
  await screen.findByRole('heading', { name: 'Restore this version?' })
}
/** Let every pending 16 ms frame run, and then some. */
const frames = () => act(async () => { await new Promise((r) => { setTimeout(r, 80) }) })

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => setTimeout(() => fn(performance.now()), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => clearTimeout(id))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('focus with a browser-like frame (m1)', () => {
  it('leaving the question focuses the newest version\'s Name button, not the heading', async () => {
    mount([['POST', '/w1/revs/2/restore', () => ({ ...restored(), rev: 3 })]])
    await toQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Back to versions' }))
    await frames()
    expect(within(revRow(3)).getByRole('button', { name: /^Name this version/ })).toHaveFocus()
  })

  it('a revert met by a stale tab focuses Reload, and keeps it there', async () => {
    mount([
      ['POST', '/w1/revs/2/restore', () => restored()],
      ['PUT', '/w1', () => ({ ...W1, id: 'w9', name: 'copy', rev: 1, etag: 1 })],
      ['POST', '/w1/revs/3/restore', () => refuse(409, 'conflict', S_CONFLICT)],
    ])
    await toQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    const reload = await screen.findByRole('button', { name: 'Reload' })
    await frames()
    expect(reload).toHaveFocus()
  })

  it('after a successful Reload, focus moves to the retry (the Reload button is gone), never to the page', async () => {
    const { announce } = mount([
      ['POST', '/w1/revs/2/restore', () => restored()],
      ['PUT', '/w1', () => ({ ...W1, id: 'w9', name: 'copy', rev: 1, etag: 1 })],
      ['POST', '/w1/revs/3/restore', () => refuse(409, 'conflict', S_CONFLICT)],
      ['GET', '/w1', () => restored({ etag: 20 })],
    ])
    await toQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull())
    await frames()
    expect(screen.getByRole('button', { name: 'Go back to the version before' })).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
    expect(announce).toHaveBeenLastCalledWith('Loaded the latest version of this widget. You can now go back to the version before.', 'ok')
  })

  it('and with a frame that runs at once (the other side of the race), focus still lands on the retry', async () => {
    window.requestAnimationFrame.mockImplementation((fn) => { fn(0); return 0 })
    mount([
      ['POST', '/w1/revs/2/restore', () => restored()],
      ['PUT', '/w1', () => ({ ...W1, id: 'w9', name: 'copy', rev: 1, etag: 1 })],
      ['POST', '/w1/revs/3/restore', () => refuse(409, 'conflict', S_CONFLICT)],
      ['GET', '/w1', () => restored({ etag: 20 })],
    ])
    await toQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Go back to the version before' })).toHaveFocus()
  })
})

describe('the Escape handler is current the moment the question mounts (rail for the layout effect)', () => {
  it('a mount-time Escape sees the question\'s handler: it backs out of the question and says so', async () => {
    const { announce } = mount([['POST', '/w1/revs/2/restore', () => restored()]])
    await toQuestion()
    expect(typeof probe.captured).toBe('function')
    let handled
    act(() => { handled = probe.captured() })
    expect(handled).toBe(true)
    expect(announce).toHaveBeenLastCalledWith(QUESTION_BACK, 'ok')
  })
})
