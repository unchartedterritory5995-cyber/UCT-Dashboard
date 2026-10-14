// Perf 4: the flag-on desktop path never requests ScannerShell (FocusScreener is mocked, so its
// internal Table-mode ScannerShell import is not in play). Pair: Screener.lazyChunks.flagOff.test.jsx.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, expect, test, afterEach } from 'vitest'
import { AuthContext } from '../context/AuthContext'

const loaded = vi.hoisted(() => ({ shell: 0, focus: 0 }))
vi.mock('./screener/shell/ScannerShell', () => { loaded.shell += 1; return { default: () => <div data-testid="old-shell" /> } })
vi.mock('./screener/focus/FocusScreener', () => { loaded.focus += 1; return { default: () => <div data-testid="focus" /> } })
import Screener from './Screener'

const realMatchMedia = window.matchMedia
afterEach(() => { window.matchMedia = realMatchMedia })

test('flag on, desktop: FocusScreener loads and the ScannerShell module is never requested', async () => {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    return { matches: (!max || 1280 <= Number(max[1])) && (!min || 1280 >= Number(min[1])), media: query, addEventListener: () => {}, removeEventListener: () => {} }
  }
  render(<MemoryRouter><AuthContext.Provider value={{ screenerFocusLayoutEnabled: true }}><Screener /></AuthContext.Provider></MemoryRouter>)
  expect(await screen.findByTestId('focus')).toBeInTheDocument()
  expect(loaded.focus).toBe(1)
  expect(loaded.shell).toBe(0)
})
