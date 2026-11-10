// app/src/components/AuthGuard.maintenanceCache.test.jsx
//
// RouteErrorBoundary is keyed by pathname and sits above <Routes>, so every sidebar click remounts
// AuthGuard. AuthGuard used to start each mount with `maintenanceChecked = false` and hold the page
// at its splash until GET /api/maintenance answered: measured 72-418 ms of splash on 6 of 6 clicks.
//
// The answer now lives at module scope. These tests pin both halves of that trade: a repeat
// navigation does not wait, and maintenance mode still lands.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Profiler } from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import RouteErrorBoundary from './RouteErrorBoundary'

const auth = { user: null, isPaid: true, loading: false, authTransient: false, retryAuth: vi.fn() }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))
vi.mock('./AppErrorFallback', () => ({ default: () => <div data-testid="fallback">error screen</div> }))

// The module cache is the thing under test, so each test gets a fresh copy of the module.
let AuthGuard
beforeEach(async () => {
  vi.resetModules()
  AuthGuard = (await import('./AuthGuard')).default
})

/** A /api/maintenance stub whose answers the test releases by hand. */
function stubMaintenance() {
  const pending = []
  const fetchMock = vi.fn(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }))
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    answer: async (body) => {
      const p = pending.shift()
      await act(async () => {
        p.resolve({ ok: true, json: () => Promise.resolve(body) })
        for (let i = 0; i < 8; i++) await Promise.resolve()
      })
    },
    fail: async () => {
      const p = pending.shift()
      await act(async () => {
        p.reject(new Error('network'))
        for (let i = 0; i < 8; i++) await Promise.resolve()
      })
    },
  }
}

let navigate
function Nav() { navigate = useNavigate(); return null }
let crashing = null
function Page({ name }) {
  if (crashing === name) throw new Error(`crash on ${name}`)
  return <div data-testid="page">{name}</div>
}

// The real shape: the boundary above <Routes>, keyed by pathname, AuthGuard inside it.
function App({ initial = '/dashboard', onCommit }) {
  const tree = (
    <RouteErrorBoundary>
      <Routes>
        <Route element={<AuthGuard />}>
          <Route path="/dashboard" element={<Page name="dashboard" />} />
          <Route path="/charts" element={<Page name="charts" />} />
          <Route path="/journal" element={<Page name="journal" />} />
        </Route>
      </Routes>
    </RouteErrorBoundary>
  )
  return (
    <MemoryRouter initialEntries={[initial]}>
      <Nav />
      {onCommit ? <Profiler id="guard" onRender={onCommit}>{tree}</Profiler> : tree}
    </MemoryRouter>
  )
}

const go = (to) => act(async () => { navigate(to) })
const splash = () => screen.queryByRole('status')
const maintenancePage = () => screen.queryByText(/back shortly/i)

beforeEach(() => {
  auth.user = { role: 'user', email_verified: true }
  auth.isPaid = true
  auth.loading = false
  crashing = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-09T15:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AuthGuard maintenance answer: the first load', () => {
  it('still holds at the splash until the very first answer arrives', async () => {
    const m = stubMaintenance()
    render(<App />)
    expect(splash()).toBeTruthy()
    expect(screen.queryByTestId('page')).toBeNull()
    await m.answer({ maintenance: false })
    expect(splash()).toBeNull()
    expect(screen.getByTestId('page').textContent).toBe('dashboard')
  })

  it('a first answer of maintenance=true blocks a member', async () => {
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: true })
    expect(maintenancePage()).toBeTruthy()
    expect(screen.queryByTestId('page')).toBeNull()
  })

  it('an admin still passes maintenance mode', async () => {
    auth.user = { role: 'admin', email_verified: true }
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: true })
    expect(maintenancePage()).toBeNull()
    expect(screen.getByTestId('page')).toBeTruthy()
  })
})

describe('AuthGuard maintenance answer: a repeat navigation', () => {
  it('paints the page on the first render, with no splash and no new request inside the window', async () => {
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: false })
    expect(m.fetchMock).toHaveBeenCalledTimes(1)

    await go('/charts')
    expect(splash(), 'a repeat navigation must not wait on /api/maintenance').toBeNull()
    expect(screen.getByTestId('page').textContent).toBe('charts')
    expect(m.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('past the window it still paints at once and re-asks in the background', async () => {
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: false })

    vi.setSystemTime(new Date('2026-11-09T15:00:16Z'))
    await go('/charts')
    expect(splash()).toBeNull()
    expect(screen.getByTestId('page').textContent).toBe('charts')
    expect(m.fetchMock).toHaveBeenCalledTimes(2)
    await m.answer({ maintenance: false })
    expect(screen.getByTestId('page').textContent).toBe('charts')
  })

  it('maintenance switched on lands on the first navigation past the window', async () => {
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: false })

    vi.setSystemTime(new Date('2026-11-09T15:00:16Z'))
    await go('/charts')
    await m.answer({ maintenance: true })
    expect(maintenancePage(), 'maintenance mode must still take effect').toBeTruthy()
    expect(screen.queryByTestId('page')).toBeNull()
  })

  it('a maintenance=true answer is never trusted for the window: every navigation re-asks', async () => {
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: true })
    expect(maintenancePage()).toBeTruthy()

    await go('/charts')
    expect(maintenancePage(), 'still blocked while the re-check runs').toBeTruthy()
    expect(m.fetchMock).toHaveBeenCalledTimes(2)
    await m.answer({ maintenance: false })
    expect(maintenancePage()).toBeNull()
    expect(screen.getByTestId('page').textContent).toBe('charts')
  })

  it('a background re-check that changes nothing commits nothing', async () => {
    const m = stubMaintenance()
    const commits = []
    render(<App onCommit={(id, phase) => commits.push(phase)} />)
    await m.answer({ maintenance: false })

    vi.setSystemTime(new Date('2026-11-09T15:00:16Z'))
    await go('/charts')
    const before = commits.length
    await m.answer({ maintenance: false })
    expect(commits.length, 'the answer matched what is on screen, so nothing may re-render').toBe(before)
  })
})

describe('AuthGuard maintenance answer: what does not count as an answer', () => {
  it('a failed check opens the gate as it always did, and is not remembered', async () => {
    const m = stubMaintenance()
    render(<App />)
    await m.fail()
    expect(screen.getByTestId('page').textContent).toBe('dashboard')

    await go('/charts')
    expect(splash(), 'no answer was ever recorded, so the next mount asks again').toBeTruthy()
    expect(m.fetchMock).toHaveBeenCalledTimes(2)
    await m.answer({ maintenance: false })
    expect(screen.getByTestId('page').textContent).toBe('charts')
  })

  it('a body without a boolean (an error payload) is not recorded as "not in maintenance"', async () => {
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ detail: 'Internal Server Error' })
    await go('/charts')
    expect(m.fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a failed re-check does not lift a maintenance=true answer', async () => {
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: true })
    await go('/charts')
    await m.fail()
    expect(maintenancePage(), 'one network blip must not let members in').toBeTruthy()
  })

  it('two mounts while one request is out share that request', async () => {
    const m = stubMaintenance()
    render(<App />)
    await go('/charts')
    expect(m.fetchMock).toHaveBeenCalledTimes(1)
    await m.answer({ maintenance: false })
    expect(screen.getByTestId('page').textContent).toBe('charts')
  })
})

describe('A route error still recovers on navigation', () => {
  const quietly = () => vi.spyOn(console, 'error').mockImplementation(() => {})

  it('with nothing popped, the error screen clears on the next navigation', async () => {
    const spy = quietly()
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: false })

    crashing = 'charts'
    await go('/charts')
    expect(screen.getByTestId('fallback')).toBeTruthy()

    crashing = null
    await go('/journal')
    expect(screen.queryByTestId('fallback'), 'the error screen survived the navigation').toBeNull()
    expect(screen.getByTestId('page').textContent).toBe('journal')
    spy.mockRestore()
  })

  it('going back to the route that crashed tries it again', async () => {
    const spy = quietly()
    const m = stubMaintenance()
    render(<App />)
    await m.answer({ maintenance: false })

    crashing = 'charts'
    await go('/charts')
    expect(screen.getByTestId('fallback')).toBeTruthy()
    await go('/journal')
    crashing = null
    await go('/charts')
    expect(screen.queryByTestId('fallback')).toBeNull()
    expect(screen.getByTestId('page').textContent).toBe('charts')
    spy.mockRestore()
  })
})
