// S9 CP1 follow-up — Login.jsx's post-login routing check was a second,
// independent copy of the paid-plan literal that dropped the active-trial
// clause AuthContext.jsx's canonical isPaid carries. A member on an active
// trial got routed to the free page immediately after signing in. Fixed by
// reading `data.paid_equiv` (the backend's own `_access_payload` answer,
// already on the login response) instead of re-deriving anything.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'

const navigateSpy = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateSpy }
})

let loginImpl
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: (...a) => loginImpl(...a), verifyTotp: vi.fn() }),
}))

import Login from './Login'

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>,
  )
}

async function submit() {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw' } })
  fireEvent.click(screen.getByRole('button', { name: /log in/i }))
  await waitFor(() => expect(navigateSpy).toHaveBeenCalled())
}

beforeEach(() => {
  navigateSpy.mockClear()
})

test('an active-trial member is routed to /dashboard, not the free page', async () => {
  // ⭐ THE DEFECT, AS AN INEQUALITY. Before the fix this routed to
  // /morning-wire: role is neither admin nor a paid plan, and the old check
  // never looked at trial at all.
  loginImpl = async () => ({
    user: { role: 'member' }, plan: 'free',
    trial: { active: true, days_left: 5 }, paid_equiv: true,
  })
  renderLogin()
  await submit()
  expect(navigateSpy).toHaveBeenCalledWith('/dashboard', { replace: true })
})

test('a genuinely free, non-trial member still lands on /morning-wire', async () => {
  loginImpl = async () => ({
    user: { role: 'member' }, plan: 'free',
    trial: { active: false, days_left: 0 }, paid_equiv: false,
  })
  renderLogin()
  await submit()
  expect(navigateSpy).toHaveBeenCalledWith('/morning-wire', { replace: true })
})

test('a paid-plan member still lands on /dashboard', async () => {
  loginImpl = async () => ({
    user: { role: 'member' }, plan: 'pro',
    trial: { active: false, days_left: 0 }, paid_equiv: true,
  })
  renderLogin()
  await submit()
  expect(navigateSpy).toHaveBeenCalledWith('/dashboard', { replace: true })
})

test('an admin still lands on /dashboard', async () => {
  loginImpl = async () => ({
    user: { role: 'admin' }, plan: 'free',
    trial: { active: false, days_left: 0 }, paid_equiv: true,
  })
  renderLogin()
  await submit()
  expect(navigateSpy).toHaveBeenCalledWith('/dashboard', { replace: true })
})
