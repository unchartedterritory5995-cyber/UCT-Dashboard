// Finish program, lane KEYS round 2. A page can say where focus should land.
//
// Round 1 put focus on a hidden title before the page. On Trades that still left 44 Tabs
// (filters, date fields, 13 column headers) between the member and the first trade. A page
// now marks its own landing with `data-route-landing` (the <RouteLanding/> element, or the
// attribute on an element of its own). Focus goes there instead, also when the page's content
// arrives a moment after the navigation (a lazy chunk, a fetch).
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import RouteFocusTarget, { RouteLanding } from './routeFocus'

afterEach(cleanup)

function Late({ ms, children }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), ms); return () => clearTimeout(t) }, [ms])
  return on ? children : null
}

function app(page) {
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <RouteFocusTarget title="Page title" />
      <Routes>
        <Route path="/a" element={<Link to="/b">go</Link>} />
        <Route path="/b" element={page} />
      </Routes>
    </MemoryRouter>,
  )
}
const go = () => fireEvent.click(screen.getByRole('link', { name: 'go' }))
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 40)) })

describe('a page can mark where focus lands after a navigation', () => {
  it('focus goes to the page landing, not to the title before the page', async () => {
    app(<div><button type="button">a filter</button><RouteLanding title="Trades list" /><button type="button">first trade</button></div>)
    go()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Trades list')))
    expect(document.activeElement.getAttribute('tabindex')).toBe('-1')
  })

  it('an element of the page itself can be the landing (a table body)', async () => {
    app(<table><thead><tr><th><button type="button">sort</button></th></tr></thead>
      <tbody tabIndex={-1} data-route-landing="" aria-label="Trades"><tr><td>row</td></tr></tbody></table>)
    go()
    await waitFor(() => expect(document.activeElement?.tagName).toBe('TBODY'))
  })

  it('a landing that arrives late still gets focus, moved from the title', async () => {
    app(<div><button type="button">a filter</button><Late ms={120}><RouteLanding title="Late list" /></Late></div>)
    go()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Page title')))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Late list')))
  })

  it('a late landing does NOT take focus the member has already moved', async () => {
    app(<div><button type="button">a filter</button><Late ms={120}><RouteLanding title="Late list" /></Late></div>)
    go()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Page title')))
    screen.getByRole('button', { name: 'a filter' }).focus()
    await act(async () => { await new Promise((r) => setTimeout(r, 200)) })
    expect(screen.getByText('Late list')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'a filter' }))
  })

  it('CONTROL: a page with no landing keeps the title as the landing', async () => {
    app(<div><button type="button">a filter</button></div>)
    go()
    await frame()
    expect(document.activeElement).toBe(screen.getByText('Page title'))
  })
})
