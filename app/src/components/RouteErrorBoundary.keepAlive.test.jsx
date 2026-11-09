// Today every route change remounts the whole shell: RouteErrorBoundary is keyed by pathname and sits
// above <Routes>. While a pop-out window is open the shell has to stay mounted, or the board on the
// other monitor dies with it. With nothing popped, the key is exactly the pathname, as it always was.
import { render, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import RouteErrorBoundary from './RouteErrorBoundary'
import { registerPopout } from '../lib/popoutRegistry'

const log = []
function Shell() {
  useEffect(() => { log.push('mount'); return () => { log.push('unmount') } }, [])
  return <Outlet />
}
let navigate
function Page({ name }) { navigate = useNavigate(); return <div>{name}</div> }

const mounts = () => log.filter((l) => l === 'mount').length

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/charts']}>
      <RouteErrorBoundary>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/charts" element={<Page name="charts" />} />
            <Route path="/dashboard" element={<Page name="dashboard" />} />
            <Route path="/journal" element={<Page name="journal" />} />
          </Route>
        </Routes>
      </RouteErrorBoundary>
    </MemoryRouter>,
  )
}
const go = (to) => act(async () => { navigate(to) })

beforeEach(() => { log.length = 0 })

describe('RouteErrorBoundary while a pop-out is open', () => {
  it('with nothing popped, every navigation remounts the shell exactly as it always has', async () => {
    renderApp()
    await go('/dashboard')
    await go('/journal')
    expect(mounts()).toBe(3)
  })

  it('with a window open, navigation does not remount the shell', async () => {
    renderApp()
    const release = registerPopout()
    await go('/dashboard')
    await go('/journal')
    await go('/charts')
    expect(mounts(), log.join()).toBe(1)
    act(() => release())
  })

  it('the last window closing does not remount the page the member is on', async () => {
    renderApp()
    const release = registerPopout()
    await go('/dashboard')
    act(() => release())
    expect(mounts(), 'the close must not flash the current page').toBe(1)
  })

  it('and the next real navigation goes back to the normal remount', async () => {
    renderApp()
    const release = registerPopout()
    await go('/dashboard')
    act(() => release())
    await go('/journal')
    expect(mounts()).toBe(2)
  })
})
