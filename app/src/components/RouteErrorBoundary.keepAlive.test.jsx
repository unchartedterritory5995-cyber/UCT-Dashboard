// Today every route change remounts the whole shell: RouteErrorBoundary is keyed by pathname and sits
// above <Routes>. While a pop-out window is open the shell has to stay mounted, or the board on the
// other monitor dies with it. With nothing popped, the key is exactly the pathname, as it always was.
import { render, act, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import RouteErrorBoundary from './RouteErrorBoundary'
import { registerPopout } from '../lib/popoutRegistry'

vi.mock('./AppErrorFallback', () => ({ default: () => <div data-testid="fallback">error screen</div> }))

const log = []
// The windows die with the shell, as PopoutWindow's do: `shellOwnsWindow` opens one for the shell's life.
let shellOwnsWindow = false
function Shell() {
  useEffect(() => { log.push('mount'); return () => { log.push('unmount') } }, [])
  useEffect(() => (shellOwnsWindow ? registerPopout() : undefined), [])
  return <Outlet />
}
let navigate
function Nav() { navigate = useNavigate(); return null }
let crashing = null
function Page({ name }) {
  if (crashing === name) throw new Error(`crash on ${name}`)
  return <div>{name}</div>
}

const mounts = () => log.filter((l) => l === 'mount').length

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/charts']}>
      <Nav />
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

beforeEach(() => { log.length = 0; shellOwnsWindow = false; crashing = null })

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

describe('RouteErrorBoundary: an error screen under a held key', () => {
  const quietly = () => vi.spyOn(console, 'error').mockImplementation(() => {})

  it('clears when the member goes back to the path that opened the window', async () => {
    const spy = quietly()
    shellOwnsWindow = true
    renderApp()
    await go('/dashboard')
    crashing = 'journal'
    await go('/journal')              // the crash takes the shell, and every window with it
    expect(screen.getByTestId('fallback')).toBeTruthy()
    crashing = null
    await go('/charts')               // the held key IS /charts, so the key alone cannot clear this
    expect(screen.queryByTestId('fallback'), 'the error screen survived the navigation').toBeNull()
    expect(screen.getByText('charts')).toBeTruthy()
    spy.mockRestore()
  })

  it('clears on any navigation while a window owned elsewhere is still open', async () => {
    const spy = quietly()
    renderApp()
    const release = registerPopout()
    crashing = 'dashboard'
    await go('/dashboard')
    expect(screen.getByTestId('fallback')).toBeTruthy()
    crashing = null
    await go('/journal')
    expect(screen.queryByTestId('fallback')).toBeNull()
    expect(screen.getByText('journal')).toBeTruthy()
    act(() => release())
    spy.mockRestore()
  })

  it('stays up while the member has not navigated, so a crash is not retried on its own', async () => {
    const spy = quietly()
    shellOwnsWindow = true
    renderApp()
    crashing = 'journal'
    await go('/journal')
    expect(screen.getByTestId('fallback')).toBeTruthy()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('fallback')).toBeTruthy()
    spy.mockRestore()
  })

  it('a healthy tree is not reset by the pathname changing under a held key', async () => {
    renderApp()
    const release = registerPopout()
    await go('/dashboard')
    await go('/charts')
    await go('/journal')
    expect(mounts(), log.join()).toBe(1)
    expect(log).not.toContain('unmount')
    act(() => release())
  })
})
