// app/src/pages/Screener.focusSwitch.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthContext } from '../context/AuthContext'

vi.mock('./screener/shell/ScannerShell', () => ({ default: () => <div data-testid="old-shell" /> }))
vi.mock('./screener/focus/FocusScreener', () => ({ default: () => <div data-testid="focus" /> }))
import Screener from './Screener'

const wrap = (value, props = {}) => render(
  <MemoryRouter><AuthContext.Provider value={value}><Screener {...props} /></AuthContext.Provider></MemoryRouter>)

test('flag off renders the old shell', () => {
  wrap({ screenerFocusLayoutEnabled: false })
  expect(screen.getByTestId('old-shell')).toBeInTheDocument()
  expect(screen.queryByTestId('focus')).toBeNull()
})

test('flag on renders the focus layout', () => {
  wrap({ screenerFocusLayoutEnabled: true })
  expect(screen.getByTestId('focus')).toBeInTheDocument()
  expect(screen.queryByTestId('old-shell')).toBeNull()
})

test('embedded always renders the old shell', () => {
  wrap({ screenerFocusLayoutEnabled: true }, { embedded: true })
  expect(screen.getByTestId('old-shell')).toBeInTheDocument()
})

test('outside an AuthProvider renders the old shell', () => {
  render(<MemoryRouter><Screener /></MemoryRouter>)
  expect(screen.getByTestId('old-shell')).toBeInTheDocument()
})
