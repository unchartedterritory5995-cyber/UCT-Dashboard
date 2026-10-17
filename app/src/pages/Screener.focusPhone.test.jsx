// app/src/pages/Screener.focusPhone.test.jsx
// SCREENER_FOCUS_PHONE_ENABLED (spec 2026-10-16 s3): phones are admitted to the Focus layout only
// when the phone flag reaches the user. Off (including the flag at `admin` for a member, who reads
// false), a phone keeps today's page.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, expect, test, afterEach } from 'vitest'
import { AuthContext } from '../context/AuthContext'

vi.mock('./screener/shell/ScannerShell', () => ({ default: () => <div data-testid="old-shell" /> }))
vi.mock('./screener/focus/FocusScreener', () => ({ default: () => <div data-testid="focus-screener" /> }))
import Screener from './Screener'

const wrap = (value) => render(
  <MemoryRouter><AuthContext.Provider value={value}><Screener /></AuthContext.Provider></MemoryRouter>)

// useIsPhone() reads matchMedia at mount: answer by width so the real hook decides.
const realMatchMedia = window.matchMedia
function setWidth(px) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    return {
      matches: (!max || px <= Number(max[1])) && (!min || px >= Number(min[1])),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  }
}
afterEach(() => { window.matchMedia = realMatchMedia })

test('(a) phone, layout on, phone flag off: the old page', async () => {
  setWidth(390)
  wrap({ screenerFocusLayoutEnabled: true, screenerFocusPhoneEnabled: false })
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
  expect(screen.queryByTestId('focus-screener')).toBeNull()
})

test('(a) phone, layout on, phone flag absent from the payload: the old page', async () => {
  setWidth(390)
  wrap({ screenerFocusLayoutEnabled: true })
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
  expect(screen.queryByTestId('focus-screener')).toBeNull()
})

test('(b) phone, layout on, phone flag on: the Focus layout', async () => {
  setWidth(390)
  wrap({ screenerFocusLayoutEnabled: true, screenerFocusPhoneEnabled: true })
  expect(await screen.findByTestId('focus-screener')).toBeInTheDocument()
  expect(screen.queryByTestId('old-shell')).toBeNull()
})

test('(b) the phone flag alone does not turn the layout on', async () => {
  setWidth(390)
  wrap({ screenerFocusLayoutEnabled: false, screenerFocusPhoneEnabled: true })
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
  expect(screen.queryByTestId('focus-screener')).toBeNull()
})

test('(c) desktop with the phone flag off: Focus renders, unchanged', async () => {
  setWidth(1280)
  wrap({ screenerFocusLayoutEnabled: true, screenerFocusPhoneEnabled: false })
  expect(await screen.findByTestId('focus-screener')).toBeInTheDocument()
})

test('(c) tablet with the phone flag off: Focus renders, unchanged', async () => {
  setWidth(820)
  wrap({ screenerFocusLayoutEnabled: true, screenerFocusPhoneEnabled: false })
  expect(await screen.findByTestId('focus-screener')).toBeInTheDocument()
})
