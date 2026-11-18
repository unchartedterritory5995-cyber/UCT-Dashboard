// The host above the routed page that keeps the Charts workspace mounted while a pop-out is open.
// The workspace is stubbed here: this file proves WHEN it is mounted, not what it does while hidden
// (ChartsWorkspace.keepAlive.test.jsx does that against the real board).
//
// ⛔⛔ The render-count rail is shaped on hub/hubRegistrarLoop.test.jsx: a shared render loop froze
// navigation app-wide for 4.5 hours on 2026-09-10. This host sits in every signed-in page's shell.
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useNavigate } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Past this many renders the host is looping, not settling. */
const CAP = 50
const counters = { renders: 0, mounts: 0, unmounts: 0 }
vi.mock('./ChartsWorkspace', async () => {
  const { useEffect } = await import('react')
  return {
    default: function StubWorkspace({ hidden }) {
      // A test tally, deliberately mutated during render: counting renders IS the measurement here.
      // eslint-disable-next-line react-hooks/immutability
      counters.renders += 1
      if (counters.renders > CAP) throw new Error(`render loop: ${counters.renders}`)
      useEffect(() => { counters.mounts += 1; return () => { counters.unmounts += 1 } }, [])
      return <div data-testid="workspace" data-hidden={hidden ? 'y' : 'n'} />
    },
  }
})

import ChartsDeskHost, { ChartsRouteSlot } from './ChartsDeskHost'
import { registerPopout, requestDeskLaunch, finishDeskLaunch, withdrawDeskLaunch, isDeskLaunchPending } from '../../lib/popoutRegistry'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

let navigate
function Nav() { navigate = useNavigate(); return null }
function Shell() { return (<><Nav /><ChartsDeskHost /><Outlet /></>) }

async function settle() { await act(async () => { await new Promise((r) => setTimeout(r, 30)) }) }
async function renderAt(route) {
  const view = render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/charts" element={<ChartsRouteSlot />} />
          <Route path="/dashboard" element={<div>dash</div>} />
          <Route path="/journal" element={<div>journal</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  await settle()
  if (route.toLowerCase().startsWith('/charts')) await waitFor(() => expect(screen.getByTestId('workspace')).toBeTruthy(), { timeout: 10000 })
  return view
}
const go = (to) => act(async () => { navigate(to) })

beforeEach(() => { counters.renders = 0; counters.mounts = 0; counters.unmounts = 0 })
afterEach(() => { cleanup(); withdrawDeskLaunch() })

describe('ChartsDeskHost', () => {
  it('mounts the workspace visible on /charts and nowhere else when nothing is popped', async () => {
    await renderAt('/charts')
    expect(screen.getByTestId('workspace').dataset.hidden).toBe('n')
    await go('/dashboard')
    expect(screen.queryByTestId('workspace'), 'with nothing popped it unmounts as today').toBeNull()
    expect(counters.unmounts).toBe(1)
  })

  it.each(['/Charts', '/CHARTS', '/charts/', '/Charts/'])('%s is the Charts page: React Router matches it, so the host must too', async (route) => {
    await renderAt(route)
    expect(screen.getByTestId('workspace').dataset.hidden, 'a blank page where the workspace used to be').toBe('n')
  })

  it('a pop-out open elsewhere does not mount a workspace on a page that never had one', async () => {
    const release = registerPopout()
    await renderAt('/dashboard')
    expect(screen.queryByTestId('workspace'), 'BreadthDrillModal owns its own portal').toBeNull()
    expect(counters.mounts).toBe(0)
    act(() => release())
  })

  it('while a window is open the workspace stays mounted and hidden, and only one instance exists', async () => {
    await renderAt('/charts')
    const release = registerPopout()
    await go('/dashboard')
    const hiddenBoard = screen.getByTestId('workspace')
    expect(hiddenBoard.dataset.hidden).toBe('y')
    await go('/journal')
    expect(screen.getByTestId('workspace')).toBe(hiddenBoard)
    await go('/charts')
    expect(screen.getByTestId('workspace')).toBe(hiddenBoard)
    expect(screen.getByTestId('workspace').dataset.hidden).toBe('n')
    expect(counters.mounts, 'return must not mount a second instance').toBe(1)
    expect(document.querySelectorAll('[data-testid="workspace"]')).toHaveLength(1)
    act(() => release())
  })

  it('when the last window closes while hidden, the workspace goes', async () => {
    await renderAt('/charts')
    const release = registerPopout()
    await go('/dashboard')
    expect(screen.getByTestId('workspace')).toBeTruthy()
    act(() => release())
    expect(screen.queryByTestId('workspace')).toBeNull()
    expect(counters.unmounts).toBe(1)
  })

  describe('launch restore', () => {
    it('mounts the workspace hidden on a page that never had one, while a restore is pending', async () => {
      requestDeskLaunch()
      await renderAt('/dashboard')
      expect(screen.getByTestId('workspace').dataset.hidden).toBe('y')
    })

    it('a pending restore on /charts is just the visible workspace', async () => {
      requestDeskLaunch()
      await renderAt('/charts')
      expect(screen.getByTestId('workspace').dataset.hidden).toBe('n')
    })

    it('goes away when the restore ends with nothing open', async () => {
      requestDeskLaunch()
      await renderAt('/dashboard')
      act(() => finishDeskLaunch())
      expect(screen.queryByTestId('workspace')).toBeNull()
    })

    it('stays when the restore opened a window, and goes when that window does', async () => {
      requestDeskLaunch()
      await renderAt('/dashboard')
      const release = registerPopout()
      act(() => finishDeskLaunch())
      expect(screen.getByTestId('workspace').dataset.hidden).toBe('y')
      expect(counters.mounts).toBe(1)
      act(() => release())
      expect(screen.queryByTestId('workspace')).toBeNull()
    })

    it('a request that lands after the workspace settled does not hold it', async () => {
      finishDeskLaunch()
      requestDeskLaunch()
      expect(isDeskLaunchPending()).toBe(false)
      await renderAt('/dashboard')
      expect(screen.queryByTestId('workspace')).toBeNull()
    })

    it('settles: launch restore adds no render loop', async () => {
      requestDeskLaunch()
      await renderAt('/dashboard')
      const release = registerPopout()
      act(() => finishDeskLaunch())
      await go('/journal')
      await go('/charts')
      act(() => release())
      await settle()
      expect(counters.renders).toBeLessThan(CAP)
    })
  })

  it('⛔⛔ settles: no render loop from the host through mount, popping and navigating', async () => {
    await renderAt('/charts')
    const release = registerPopout()
    await go('/dashboard')
    await go('/charts')
    await go('/journal')
    await go('/charts')
    await go('/dashboard')
    act(() => release())
    await settle()
    expect(counters.renders, 'the host re-rendered on its own state').toBeLessThan(CAP)
    expect(counters.renders).toBeGreaterThan(0)
  })

  it('⛔ THE CONTROL: the host reads a primitive store, not context objects that change each render', () => {
    const src = readFileSync(path.join(HERE, 'ChartsDeskHost.jsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code, 'read the registry through useSyncExternalStore').toMatch(/useSyncExternalStore\(subscribePopouts, hasOpenPopouts/)
    expect(code).not.toMatch(/useAuth\(\)/)
    expect(code).not.toMatch(/usePreferences\(\)/)
  })

  it('⛔ THE CONTROL: Layout itself gained no state for this', () => {
    const src = readFileSync(path.join(HERE, '..', '..', 'components', 'Layout.jsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect((code.match(/useState\(/g) || []).length, 'Layout holds only moreOpen and skipSlot').toBe(2)
    expect(code).toMatch(/<ChartsDeskHost/)
  })
})
