// The community layouts window: what a member sees of what others shared, what "Use layout" does to
// their own board, their own shared layouts, reporting, and the admin's review queue. The server is
// stood in for at fetch (its own rules are tests/test_screener_layout_gallery.py).
import { StrictMode } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
import CommunityLayouts, { LayoutThumb } from '../CommunityLayouts'
import { sanitize, saveMine, PRESETS, MAX_MINE } from '../boardModel'
import { toReview } from '../communityApi'

const BASE = '/api/screener/layout-gallery'
const item = (id, name, patch = {}) => ({ id, name, author: 'Dana K', layout: { widgets: PRESETS[1].widgets }, uses: 3, mine: false, status: 'approved', reported: false, createdAt: '2026-11-17T12:00:00Z', ...patch })
let answer
let calls
beforeEach(() => {
  answer = { items: [item('g1', 'Swing desk'), item('g2', 'Chart wall', { uses: 1, author: 'A UCT member', layout: { widgets: PRESETS[0].widgets } })], mine: [], limits: { maxMine: 10 } }
  calls = []
  globalThis.fetch = vi.fn(async (u, o = {}) => {
    const url = String(u), method = o.method || 'GET'
    calls.push([method, url.replace(BASE, ''), o.body ? JSON.parse(o.body) : undefined])
    if (method === 'GET') return answer.fail ? { ok: false, status: 500, json: async () => ({ detail: 'Server error' }) } : { ok: true, json: async () => answer }
    if (answer.refuse) return { ok: false, status: 429, json: async () => ({ detail: answer.refuse }) }
    return { ok: true, json: async () => ({ ok: true, reported: true, already: false, item: item('g1', 'Swing desk') }) }
  })
})
const writes = () => calls.filter(c => c[0] !== 'GET')
const draw = (patch = {}) => {
  const props = { board: { ...sanitize(null), edit: false }, api: { adoptLayout: vi.fn(() => true) }, say: vi.fn(), onShare: vi.fn(), onClose: vi.fn(), ...patch }
  render(<CommunityLayouts {...props} />)
  return props
}
const card = id => screen.getByTestId(`community-item-${id}`)
// a card's words without its picture's labels
const words = li => [...li.children].slice(1).map(c => c.textContent).join('')

test('lists what members shared: a picture, the name, who shared it and how often it was used', async () => {
  answer.queue = [item('q1', 'Waiting', { status: 'pending' })]
  draw()
  expect(screen.getByRole('status')).toHaveTextContent('Loading community layouts…')
  await waitFor(() => expect(card('g1')).toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: 'Community layouts' })).toBeInTheDocument()
  expect(card('g1')).toHaveTextContent('Swing deskby Dana K · used 3 times')
  expect(card('g2')).toHaveTextContent('Chart wallby A UCT member · used once')
  expect(within(card('g1')).getByRole('img')).toHaveAccessibleName('Layout with Screens, Results, Chart, News & catalysts')
  // an admin's queue is never shown to a member, even if the server sent one
  expect(screen.queryByRole('region', { name: 'For review' })).toBeNull()
  expect(screen.queryByTestId('community-item-q1')).toBeNull()
})

test('the picture places each widget where the layout puts it', () => {
  const { container } = render(<LayoutThumb widgets={PRESETS[0].widgets} />)
  const boxes = [...container.querySelectorAll('[role=img] > span')].map(b => [b.textContent, b.style.left, b.style.top, b.style.width, b.style.height])
  expect(boxes[0][0]).toBe('Chart')
  expect(boxes[0].slice(1).map(v => Math.round(parseFloat(v)))).toEqual([0, 0, 71, 100])
  expect(boxes.map(b => b[0])).toEqual(['Chart', 'Results', 'Why'])
  // a layout that cannot be drawn is an empty picture, never a crash
  expect(render(<LayoutThumb widgets={[{ type: 'heatmap' }]} />).container.querySelectorAll('[role=img] > span')).toHaveLength(0)
})

test('Use layout copies it into My layouts, counts the use, says so and closes', async () => {
  const p = draw()
  await waitFor(() => expect(card('g1')).toBeInTheDocument())
  fireEvent.click(within(card('g1')).getByRole('button', { name: 'Use layout' }))
  expect(p.api.adoptLayout).toHaveBeenCalledWith('Swing desk', PRESETS[1].widgets)
  expect(writes()).toEqual([['POST', '/g1/use', {}]])
  expect(p.say).toHaveBeenLastCalledWith('Added “Swing desk” to My layouts')
  expect(p.onClose).toHaveBeenCalledTimes(1)
})

test('with a full list of your own nothing is added, counted or closed, and the member is told why', async () => {
  let full = sanitize(null)
  for (let i = 0; i < MAX_MINE; i++) full = saveMine(full, `L${i}`, `m-${i}`)
  const p = draw({ board: { ...full, edit: false } })
  await waitFor(() => expect(card('g1')).toBeInTheDocument())
  fireEvent.click(within(card('g1')).getByRole('button', { name: 'Use layout' }))
  expect(p.api.adoptLayout).not.toHaveBeenCalled()
  expect(writes()).toEqual([])
  expect(p.say).toHaveBeenLastCalledWith(`You have ${MAX_MINE} layouts of your own. Delete one to add another.`)
  expect(p.onClose).not.toHaveBeenCalled()
})

test('Report asks why, sends the reason once, and a layout already reported offers no second report', async () => {
  answer.items[1].reported = true
  const p = draw()
  await waitFor(() => expect(card('g1')).toBeInTheDocument())
  expect(within(card('g2')).queryByRole('button', { name: /Report/ })).toBeNull()
  expect(card('g2')).toHaveTextContent('Reported')
  fireEvent.click(within(card('g1')).getByRole('button', { name: 'Report Swing desk' }))
  expect(within(screen.getByRole('menu', { name: 'Report Swing desk' })).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['The name is not OK', 'It does not work', 'Something else'])
  fireEvent.click(screen.getByRole('menuitem', { name: 'It does not work' }))
  await waitFor(() => expect(p.say).toHaveBeenLastCalledWith('Reported. Thank you.'))
  expect(writes()).toEqual([['POST', '/g1/report', { reason: 'broken' }]])
})

test('your own shared layouts say where each stands and can be taken down; a refusal is said in the server\'s words', async () => {
  answer.mine = [item('m1', 'My board', { mine: true, status: 'pending', uses: 0 }), item('m2', 'Old one', { mine: true, status: 'declined', uses: 0 }), item('m3', 'Liked', { mine: true, uses: 12 })]
  answer.items = [answer.mine[2]]
  const p = draw()
  await waitFor(() => expect(card('m1')).toBeInTheDocument())
  const yours = screen.getByRole('region', { name: 'Shared by you' })
  expect(within(yours).getAllByRole('listitem').map(words)).toEqual(['My boardWaiting for reviewStop sharing', 'Old oneNot approvedStop sharing', 'LikedShared · used 12 timesStop sharing'])
  // your own listed layout is not offered back to you under "Shared by members"
  expect(screen.getByRole('region', { name: 'Shared by members' })).toHaveTextContent('No one else has shared a layout yet.')
  fireEvent.click(within(card('m1')).getByRole('button', { name: 'Stop sharing' }))
  await waitFor(() => expect(p.say).toHaveBeenLastCalledWith('Stopped sharing “My board”'))
  expect(writes()).toEqual([['DELETE', '/m1', undefined]])
  answer.refuse = 'You\'ve sent a lot of requests. Try again later.'
  fireEvent.click(within(card('m2')).getByRole('button', { name: 'Stop sharing' }))
  await waitFor(() => expect(p.say).toHaveBeenLastCalledWith('You\'ve sent a lot of requests. Try again later.'))
})

test('an admin reviews in the same window: approve or decline what waits, hide or dismiss what was reported, unhide', async () => {
  answer.queue = [item('q1', 'New one', { status: 'pending', reports: 0, hidden: false }), item('q2', 'Rude name', { reports: 2, hidden: false }), item('q3', 'Was hidden', { reports: 0, hidden: true })]
  const p = draw({ isAdmin: true })
  await waitFor(() => expect(card('q1')).toBeInTheDocument())
  const review = screen.getByRole('region', { name: 'For review' })
  expect(within(review).getAllByRole('listitem').map(words)).toEqual([
    'New oneby Dana K · Waiting for reviewApproveDecline', 'Rude nameby Dana K · 2 reportsHideDismiss reports', 'Was hiddenby Dana K · HiddenUnhide'])
  fireEvent.click(within(card('q1')).getByRole('button', { name: 'Approve' }))
  await waitFor(() => expect(p.say).toHaveBeenLastCalledWith('Approved “New one”'))
  fireEvent.click(within(card('q2')).getByRole('button', { name: 'Dismiss reports' }))
  await waitFor(() => expect(p.say).toHaveBeenLastCalledWith('Reports dismissed'))
  fireEvent.click(within(card('q3')).getByRole('button', { name: 'Unhide' }))
  await waitFor(() => expect(p.say).toHaveBeenLastCalledWith('“Was hidden” is listed again'))
  expect(writes()).toEqual([['PATCH', '/admin/q1', { action: 'approve' }], ['PATCH', '/admin/q2', { action: 'dismiss' }], ['PATCH', '/admin/q3', { action: 'unhide' }]])
  // the list is read again after each action
  expect(calls.filter(c => c[0] === 'GET').length).toBe(4)
})

test('nothing shared yet, a failed load with Try again, a list that holds something undrawable, Escape and Share', async () => {
  answer.items = [item('bad', 'Broken', { layout: { widgets: [{ type: 'heatmap', x: 0, y: 0, w: 24, h: 20 }] } })]
  const first = draw()
  await waitFor(() => expect(screen.getByRole('region', { name: 'Shared by members' })).toHaveTextContent('No one has shared a layout yet. Yours could be the first.'))
  expect(screen.queryByTestId('community-item-bad')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Share my layout…' }))
  expect(first.onShare).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(first.onClose).toHaveBeenCalledTimes(1)
  document.body.innerHTML = ''
  answer = { fail: true }
  draw()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server error'))
  answer = { items: [item('g1', 'Swing desk')], mine: [] }
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(card('g1')).toBeInTheDocument())
})

// Found in the local preview: under React's development double-mount the window stayed on
// "Loading…" forever, because the first mount's clean-up had marked it closed.
test('the list still arrives when React mounts the window twice (development)', async () => {
  const props = { board: { ...sanitize(null), edit: false }, api: { adoptLayout: vi.fn(() => true) }, say: vi.fn(), onShare: vi.fn(), onClose: vi.fn() }
  render(<StrictMode><CommunityLayouts {...props} /></StrictMode>)
  await waitFor(() => expect(card('g1')).toBeInTheDocument())
  expect(screen.queryByRole('status')).toBeNull()
})

test('the author is told when a layout of theirs was hidden, instead of reading "Shared"', async () => {
  answer.mine = [item('m1', 'Taken down', { mine: true, hidden: true, uses: 9 })]
  draw()
  await waitFor(() => expect(card('m1')).toBeInTheDocument())
  expect(words(card('m1'))).toBe('Taken downHidden by UCTStop sharing')
})

test('what an admin still has to review: layouts waiting, and listed layouts with open reports', () => {
  expect(toReview([item('a', 'A', { status: 'pending' }), item('b', 'B', { reports: 2 }), item('c', 'C', { reports: 0 }),
    item('d', 'D', { hidden: true, reports: 3 }), item('e', 'E', { status: 'declined', reports: 0 }), null])).toBe(2)
  expect(toReview(undefined)).toBe(0)
  expect(toReview('nope')).toBe(0)
})

// Found on the live site 2026-11-17: after "Stop sharing", Escape no longer closed the window.
test('when the button that held the focus disappears, the focus comes back to the window and Escape still closes it', async () => {
  answer.mine = [item('m1', 'My board', { mine: true, status: 'pending', uses: 0 })]
  const p = draw()
  await waitFor(() => expect(card('m1')).toBeInTheDocument())
  const stop = within(card('m1')).getByRole('button', { name: 'Stop sharing' })
  stop.focus()
  answer.mine = []
  fireEvent.click(stop)
  await waitFor(() => expect(screen.queryByTestId('community-item-m1')).toBeNull())
  const dialog = screen.getByRole('dialog', { name: 'Community layouts' })
  await waitFor(() => expect(document.activeElement).toBe(dialog))
  fireEvent.keyDown(document.activeElement, { key: 'Escape' })
  expect(p.onClose).toHaveBeenCalledTimes(1)
})

test('a layout nobody has used yet says so, not "used 0 times"', async () => {
  answer.items = [item('g1', 'Fresh', { uses: 0 })]
  answer.mine = [item('m3', 'Mine', { mine: true, uses: 0 })]
  draw()
  await waitFor(() => expect(card('g1')).toBeInTheDocument())
  expect(words(card('g1'))).toContain('by Dana K · not used yet')
  expect(words(card('m3'))).toContain('Shared · not used yet')
})
