// app/src/pages/Screener.focusSwitch.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, expect, test } from 'vitest'
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

test('the how-to bar moves under the Focus layout ? menu; the old page keeps it', () => {
  const { unmount } = wrap({ screenerFocusLayoutEnabled: true, howToChecklistsEnabled: true })
  expect(screen.queryByTestId('how-to-checklist')).toBeNull()
  unmount()
  wrap({ screenerFocusLayoutEnabled: false, howToChecklistsEnabled: true })
  expect(screen.getByTestId('how-to-checklist')).toBeInTheDocument()
})
