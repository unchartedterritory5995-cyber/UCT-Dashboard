// Wave 8 (Task 8.17 fix round 1): the review's findings, each as a test that fails without its fix.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import MyToolsSheet from './MyToolsSheet'
import { openMyTools } from './openMyTools'
import { installFetch, refuse } from './__fixtures__/myToolsFixtures'
import { COPY } from './myToolsLib'
import { FAILURE_COPY } from '../../../lib/builtWidgets'

const bp = vi.hoisted(() => ({ phone: false, touch: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))
vi.mock('../widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))
vi.mock('../widgets/SetsDialog', () => ({ openSetsDialog: vi.fn(() => () => {}) }))

const live = () => screen.getByTestId('my-tools-message')
const saysLive = (text) => waitFor(() => expect(live()).toHaveTextContent(text))
const rowOf = (name) => screen.getAllByTestId('my-tools-row').find((r) => within(r).queryByText(name, { exact: true }))
const actionsOf = (name) => screen.getByRole('button', { name: `Actions for ${name}` })
async function menuFor(name) {
  fireEvent.click(actionsOf(name))
  return bp.touch ? null : screen.findByRole('menu', { name })
}
const menuItem = (label) => screen.getByRole(bp.touch ? 'button' : 'menuitem', { name: label })
const showList = (label) => fireEvent.click(screen.getByRole('button', { name: label, pressed: false }))
/** A promise the test resolves by hand, for a server answer that must arrive LATER. */
function later() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const A2 = { id: 'a2', name: 'Second archived', plan: { view: { type: 'list' } }, rev: 1, placedRev: 1, etag: 1,
  archived: true, usedIn: 0, summary: 'x', updatedAt: '2025-01-05T17:00:00Z' }

let net
beforeEach(() => {
  bp.phone = false
  bp.touch = false
  net = installFetch()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function openSheet(props = {}) {
  const onClose = vi.fn()
  render(<MyToolsSheet onClose={onClose} uid="u1" {...props} />)
  await screen.findByRole('heading', { name: /widgets?$/ })
  return { onClose }
}

describe('rename', () => {
  it('while a newer version is waiting, a rename saves "only": the waiting version is never pushed into the notes', async () => {
    net = installFetch([['PUT', '/w1', (req) => ({ ...net.lists.live[0], name: req.body.name, etag: 8 })]])
    await openSheet()                                                  // w1: rev 3, placedRev 2
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Rename'))
    expect(screen.getByText(/has a newer version your 3 notes have not taken yet/)).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Setup P&L' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(net.calls.find((c) => c.method === 'PUT')?.body.apply).toBe('only'))
  })

  it('a conflict keeps the typed name across Reload, and the next save carries the fresh etag', async () => {
    let puts = 0
    net = installFetch([
      ['PUT', '/w1', () => { puts += 1; return puts === 1 ? refuse(409, 'conflict', 'SERVER: stale.') : { ...net.lists.live[0], name: 'Mine', etag: 13 } }],
      ['GET', '/w1', () => ({ ...net.lists.live[0], etag: 12 })],
    ])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Rename'))
    const input = await screen.findByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await saysLive('SERVER: stale.')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull())
    expect(screen.getByLabelText('Name')).toHaveValue('Mine')
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(puts).toBe(2))
    expect(net.calls.filter((c) => c.method === 'PUT').map((c) => c.headers['If-Match'])).toEqual(['7', '12'])
  })

  it('a 428 (no If-Match reached the server) is the conflict sentence the client owns', async () => {
    net = installFetch([['PUT', '/w1', () => ({ ok: false, status: 428, json: async () => ({}) })]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Rename'))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await saysLive(FAILURE_COPY.conflict)
  })
})

describe('focus after a row leaves', () => {
  it('Restore from Archived moves focus to the next row, and to the heading when none is left', async () => {
    net.lists.archived = [net.lists.archived[0], A2]
    net = installFetch([['POST', /^\/a\d\/unarchive$/, (req) => {
      net.lists.archived = net.lists.archived.filter((w) => `/${w.id}/unarchive` !== req.path)
      return { id: req.path.split('/')[1], archived: false }
    }]])
    net.lists.archived = [net.lists.archived[0], A2]
    await openSheet()
    showList('Archived')
    await screen.findByRole('heading', { name: '2 archived' })
    fireEvent.click(screen.getByRole('button', { name: 'Restore Old edge' }))
    await waitFor(() => expect(actionsOf('Second archived')).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Restore Second archived' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '0 archived' })).toHaveFocus())
  })

  it('after Delete, focus waits for the list read again, then goes to the next row', async () => {
    const reread = later()
    let reads = 0
    net = installFetch([
      ['POST', '/a1/delete', () => ({ id: 'a1', deletedAt: '2025-03-04T17:00:00Z' })],
      ['GET', '?view=archived', () => { reads += 1; return reads === 1 ? { widgets: [net.lists.archived[0], A2] } : reread.promise.then(() => ({ widgets: [A2] })) }],
    ])
    await openSheet()
    showList('Archived')
    await screen.findByRole('heading', { name: '2 archived' })
    await menuFor('Old edge')
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByLabelText('Type Old edge to confirm')
    fireEvent.change(field, { target: { value: 'Old edge' } })
    fireEvent.submit(field.closest('form'))
    await saysLive('moved to Recently deleted')
    await waitFor(() => expect(reads).toBe(2))
    expect(actionsOf('Second archived')).not.toHaveFocus()             // the old list is not the truth yet
    await act(async () => { reread.resolve() })
    await waitFor(() => expect(actionsOf('Second archived')).toHaveFocus())
    expect(screen.queryByText('Old edge', { exact: true })).toBeNull()
  })

  it('Duplicate from the menu: the trigger stays usable while it runs, then focus lands on the new copy', async () => {
    const answer = later()
    net = installFetch([['POST', '', () => answer.promise.then(() => {
      const copy = { ...net.lists.live[0], id: 'w3', name: 'Net P&L by setup copy', updatedAt: '2025-03-05T17:00:00Z' }
      net.lists.live = [copy, ...net.lists.live]
      return copy
    })]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Duplicate'))
    await waitFor(() => expect(net.calls.some((c) => c.method === 'POST')).toBe(true))
    expect(actionsOf('Net P&L by setup')).toBeEnabled()               // a menu closing onto a disabled button drops focus
    expect(actionsOf('Net P&L by setup')).toHaveAttribute('aria-busy', 'true')
    await act(async () => { answer.resolve() })
    await waitFor(() => expect(actionsOf('Net P&L by setup copy')).toHaveFocus())
  })
})

describe('the one live region', () => {
  it('is one node for the whole life of the tab; only its text changes', async () => {
    net = installFetch([['POST', /^\/w\d\/archive$/, () => ({ archived: true })], ['POST', '', () => refuse(409, 'count_cap', 'SERVER: cap.')]])
    await openSheet()
    const node = live()
    expect(node).toHaveAttribute('role', 'status')
    expect(node).toHaveTextContent('')
    await menuFor('Win rate')
    fireEvent.click(menuItem('Archive'))
    await saysLive('Archived “Win rate”.')
    expect(live()).toBe(node)
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Version history'))                      // a panel pushes in: still the same node
    await screen.findByRole('heading', { name: /^Version history/ })
    expect(live()).toBe(node)
    fireEvent.click(screen.getByRole('button', { name: 'Back to your widgets' }))
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Duplicate'))
    await saysLive('SERVER: cap.')
    expect(live()).toBe(node)
    expect(live()).toHaveAttribute('data-tone', 'error')
  })
})

describe('closing and navigating', () => {
  it('the back button (popstate) closes My tools, once', async () => {
    const { onClose } = await openSheet()
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with the app router\'s navigate, a note link moves the ROUTER (a real MemoryRouter) and never pushState', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    const onClose = vi.fn()
    function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p> }
    function Host() { const navigate = useNavigate(); return <MyToolsSheet onClose={onClose} uid="u1" navigate={navigate} /> }
    render(
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <Routes><Route path="*" element={<Where />} /></Routes>
        <Host />
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: '2 widgets' })
    fireEvent.click(within(rowOf('Net P&L by setup')).getByRole('button', { name: /^Used in 3 notes/ }))
    fireEvent.click(await screen.findByRole('link', { name: /Weekly review/ }), { button: 0 })
    expect(screen.getByTestId('where')).toHaveTextContent('/journal/notebook?note=n1')
    expect(push).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('reads and refusals', () => {
  it('offline, the list reads itself again when the connection comes back', async () => {
    let online = false
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online)
    render(<MyToolsSheet onClose={() => {}} uid="u1" />)
    expect(await screen.findByTestId('my-tools-load-failed')).toHaveTextContent(COPY.offlineList)
    online = true
    // The listener is registered once the failure is drawn; the event is sent until the list answers.
    await waitFor(() => {
      act(() => { window.dispatchEvent(new Event('online')) })
      expect(screen.getByRole('heading', { name: '2 widgets' })).toBeInTheDocument()
    })
  })

  it('a 402 says "My tools needs a paid plan." with nothing to retry', async () => {
    net = installFetch([['GET', '?view=live', () => ({ ok: false, status: 402, json: async () => ({ detail: 'Built widgets require a paid plan' }) })]])
    render(<MyToolsSheet onClose={() => {}} uid="u1" />)
    expect(await screen.findByTestId('my-tools-load-failed')).toHaveTextContent('My tools needs a paid plan.')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('an action on a widget deleted in another tab (404) says so and reads the list again', async () => {
    net = installFetch([['POST', '/w1/archive', () => ({ ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) })]])
    await openSheet()
    const before = net.calls.filter((c) => c.path === '?view=live').length
    net.lists.live = [net.lists.live[1]]
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Archive'))
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))
    await saysLive("That widget isn't available.")
    await waitFor(() => expect(net.calls.filter((c) => c.path === '?view=live').length).toBe(before + 1))
    expect(await screen.findByRole('heading', { name: '1 widget' })).toBeInTheDocument()
  })
})

describe('the row', () => {
  it('the ⋯ button says what it opens and whether it is open: a menu on desktop, a dialog on touch', async () => {
    await openSheet()
    const btn = actionsOf('Net P&L by setup')
    expect(btn).toHaveAttribute('aria-haspopup', 'menu')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await menuFor('Net P&L by setup')
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    cleanup()
    bp.touch = true
    await openSheet()
    expect(actionsOf('Net P&L by setup')).toHaveAttribute('aria-haspopup', 'dialog')
  })

  it('a long name and summary carry a tooltip of their full text', async () => {
    await openSheet()
    const row = rowOf('Net P&L by setup')
    expect(within(row).getByText('Net P&L by setup', { exact: true }).closest('[title]')).toHaveAttribute('title', 'Net P&L by setup')
    expect(within(row).getByText(/split by setup/)).toHaveAttribute('title', 'Net P&L, split by setup, for closed trades in the last 90 days.')
  })
})

describe('openMyTools', () => {
  it('called again while open, the open sheet switches to the new widget (here an archived one)', async () => {
    let close
    await act(async () => { close = openMyTools({ editor: null, defId: 'w1', uid: 'u1' }) })
    await waitFor(() => expect(actionsOf('Net P&L by setup')).toHaveFocus())
    let again
    await act(async () => { again = openMyTools({ editor: null, defId: 'a1' }) })
    expect(again).toBe(close)
    expect(document.querySelectorAll('[data-my-tools-root]')).toHaveLength(1)
    await waitFor(() => expect(actionsOf('Old edge')).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Archived', pressed: true })).toBeInTheDocument()
    await act(async () => { close() })
    await waitFor(() => expect(document.querySelector('[data-my-tools-root]')).toBeNull())
  })
})
