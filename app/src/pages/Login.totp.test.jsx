import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Login from './Login'

const login = vi.fn()
const verifyTotp = vi.fn()
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login, verifyTotp }),
}))

const nav = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => nav,
}))

beforeEach(() => vi.clearAllMocks())

const submitPassword = () => {
  render(<MemoryRouter><Login /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } })
  fireEvent.click(screen.getByRole('button', { name: /log in/i }))
}

describe('Login 2FA challenge step', () => {
  it('normal accounts log straight in — no code step', async () => {
    login.mockResolvedValue({ user: { role: null }, plan: 'pro' })
    submitPassword()
    await waitFor(() => expect(nav).toHaveBeenCalledWith('/dashboard', { replace: true }))
    expect(screen.queryByText(/two-factor check/i)).not.toBeInTheDocument()
  })

  it('a requires_totp response swaps to the code step and verifies', async () => {
    login.mockResolvedValue({ requires_totp: true, challenge_token: 'tok123' })
    verifyTotp.mockResolvedValue({ user: { role: 'admin' }, plan: 'free' })
    submitPassword()
    await screen.findByText(/two-factor check/i)
    expect(nav).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))
    await waitFor(() => expect(verifyTotp).toHaveBeenCalledWith('tok123', '654321'))
    await waitFor(() => expect(nav).toHaveBeenCalledWith('/dashboard', { replace: true }))
  })

  it('a wrong code shows the error and stays on the code step', async () => {
    login.mockResolvedValue({ requires_totp: true, challenge_token: 'tok123' })
    const err = new Error("That code didn't work — try the next one from your app, or a backup code")
    err.status = 401
    verifyTotp.mockRejectedValue(err)
    submitPassword()
    await screen.findByText(/two-factor check/i)
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))
    await screen.findByText(/didn't work/i)
    expect(screen.getByText(/two-factor check/i)).toBeInTheDocument()
  })

  it('an expired challenge sends the user back to the password step', async () => {
    login.mockResolvedValue({ requires_totp: true, challenge_token: 'tok123' })
    const err = new Error('Sign-in expired — enter your password again')
    err.status = 401
    verifyTotp.mockRejectedValue(err)
    submitPassword()
    await screen.findByText(/two-factor check/i)
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))
    await screen.findByText(/welcome back/i)
    expect(screen.getByText(/expired/i)).toBeInTheDocument()
  })

  it('the back link returns to the password step', async () => {
    login.mockResolvedValue({ requires_totp: true, challenge_token: 'tok123' })
    submitPassword()
    await screen.findByText(/two-factor check/i)
    fireEvent.click(screen.getByRole('button', { name: /back to password/i }))
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument()
  })
})
