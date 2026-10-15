// Perf 4: the flag-off path never requests the Focus layout's module. Module evaluation is
// per file, so each path gets its own file (the other half: Screener.lazyChunks.flagOn.test.jsx).
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, expect, test } from 'vitest'
import { AuthContext } from '../context/AuthContext'

const loaded = vi.hoisted(() => ({ shell: 0, focus: 0 }))
vi.mock('./screener/shell/ScannerShell', () => { loaded.shell += 1; return { default: () => <div data-testid="old-shell" /> } })
vi.mock('./screener/focus/FocusScreener', () => { loaded.focus += 1; return { default: () => <div data-testid="focus" /> } })
import Screener from './Screener'

test('flag off: the old shell loads and the FocusScreener module is never requested', async () => {
  render(<MemoryRouter><AuthContext.Provider value={{ screenerFocusLayoutEnabled: false }}><Screener /></AuthContext.Provider></MemoryRouter>)
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
  expect(loaded.shell).toBe(1)
  expect(loaded.focus).toBe(0)
})
