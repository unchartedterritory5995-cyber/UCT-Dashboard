import { renderWithProviders, screen, fireEvent } from '../test-utils'
import { vi } from 'vitest'

// Defense-in-depth from the 8/21 UI stress sweep (FIX A): ScannerShell now
// mounts inside its own ErrorBoundary (see Screener.jsx) so a render throw
// there degrades to a compact "Screener hit an error." fallback + Retry
// instead of leaving nothing on screen. `shouldThrow` is a mutable ref so
// the mock can throw on the first mount and stop throwing after Retry
// bumps the boundary's key and remounts a fixed child.
const { shouldThrow } = vi.hoisted(() => ({ shouldThrow: { current: true } }))

vi.mock('./screener/shell/ScannerShell', () => ({
  default: () => {
    if (shouldThrow.current) throw new Error('boom from ScannerShell')
    return <div>scanner shell recovered</div>
  },
}))

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: [], mutate: vi.fn() })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import Screener from './Screener'

describe('Screener — ScannerShell error boundary', () => {
  beforeEach(() => {
    shouldThrow.current = true
    // React logs the caught error via console.error (ErrorBoundary.jsx's own
    // componentDidCatch) — expected noise, not a test failure signal here.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    console.error.mockRestore()
  })

  it('a throw in ScannerShell renders the compact fallback, and Retry remounts a fixed child', () => {
    renderWithProviders(<Screener />)

    expect(screen.getByText('Screener hit an error.')).toBeInTheDocument()
    expect(screen.queryByText('scanner shell recovered')).not.toBeInTheDocument()

    // Fix the underlying condition (mirrors a transient failure clearing),
    // then click Retry — it bumps the boundary's key, remounting the shell.
    shouldThrow.current = false
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(screen.getByText('scanner shell recovered')).toBeInTheDocument()
    expect(screen.queryByText('Screener hit an error.')).not.toBeInTheDocument()
  })
})
