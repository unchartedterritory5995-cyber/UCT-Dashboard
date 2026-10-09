// Wave 2 (audit 2026-10-08): a brand-new member gets a short, dismissible orientation; the
// dismissal is remembered on the account; a member who already has a board never sees it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const pref = vi.hoisted(() => ({ prefs: {}, loading: false, setPref: null }))
vi.mock('../../hooks/usePreferences', () => ({
  parsePref: (raw, fb) => { try { return raw == null ? fb : JSON.parse(raw) } catch { return fb } },
  default: () => ({ prefs: pref.prefs, loading: pref.loading, setPref: pref.setPref }),
}))
import FirstRunCard, { ORIENTATION_PREF } from './FirstRunCard'

beforeEach(() => { pref.prefs = {}; pref.loading = false; pref.setPref = vi.fn() })
afterEach(cleanup)

describe('first-run orientation', () => {
  it('shows for a member with no saved board, and its examples run', () => {
    const onTry = vi.fn()
    render(<FirstRunCard onTry={onTry} />)
    expect(screen.getByRole('region', { name: /New to the terminal/ })).toBeTruthy()
    fireEvent.click(screen.getByTestId('terminal-firstrun-try-NVDA-GP'))
    expect(onTry).toHaveBeenCalledWith('NVDA GP')
    fireEvent.click(screen.getByTestId('terminal-firstrun-try-HELP'))
    expect(onTry).toHaveBeenCalledWith('HELP')
  })

  it('dismissing hides it and remembers that on the account', () => {
    render(<FirstRunCard />)
    fireEvent.click(screen.getByTestId('terminal-firstrun-dismiss'))
    expect(screen.queryByTestId('terminal-firstrun')).toBeNull()
    expect(pref.setPref).toHaveBeenCalledWith(ORIENTATION_PREF, '1')
  })

  it('CONTROL: a member who has a board, or dismissed it before, never sees it', () => {
    pref.prefs = { terminal_layout: '{}' }
    render(<FirstRunCard />)
    expect(screen.queryByTestId('terminal-firstrun')).toBeNull()
    cleanup()
    pref.prefs = { [ORIENTATION_PREF]: '1' }
    render(<FirstRunCard />)
    expect(screen.queryByTestId('terminal-firstrun')).toBeNull()
  })

  it('does not decide while preferences are still loading', () => {
    pref.loading = true
    render(<FirstRunCard />)
    expect(screen.queryByTestId('terminal-firstrun')).toBeNull()
  })
})
