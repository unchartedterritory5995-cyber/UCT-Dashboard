// app/src/pages/Screener.focusSwitch.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, expect, test, afterEach } from 'vitest'
import { AuthContext } from '../context/AuthContext'
import { TerminalPanelContext } from '../components/terminal'
import styles from './Screener.module.css'

vi.mock('./screener/shell/ScannerShell', () => ({ default: () => <div data-testid="old-shell" /> }))
vi.mock('./screener/focus/FocusScreener', () => ({ default: () => <div data-testid="focus" /> }))
import Screener from './Screener'

const wrap = (value, props = {}) => render(
  <MemoryRouter><AuthContext.Provider value={value}><Screener {...props} /></AuthContext.Provider></MemoryRouter>)

// useIsPhone() reads matchMedia at mount: answer true only for the phone query (max-width: 640px).
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

test('phone (<=640) keeps the old shell even with the flag on', async () => {
  setWidth(390)
  wrap({ screenerFocusLayoutEnabled: true })
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
  expect(screen.queryByTestId('focus')).toBeNull()
})

test('tablet (641-1024) renders the focus layout with the flag on', async () => {
  setWidth(820)
  wrap({ screenerFocusLayoutEnabled: true })
  expect(await screen.findByTestId('focus')).toBeInTheDocument()
  expect(screen.queryByTestId('old-shell')).toBeNull()
})

test('the phone/tablet boundary: 640 is a phone, 641 is a tablet', async () => {
  setWidth(640)
  const phone = wrap({ screenerFocusLayoutEnabled: true })
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
  phone.unmount()
  setWidth(641)
  wrap({ screenerFocusLayoutEnabled: true })
  expect(await screen.findByTestId('focus')).toBeInTheDocument()
})

test('flag off renders the old shell', async () => {
  wrap({ screenerFocusLayoutEnabled: false })
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
  expect(screen.queryByTestId('focus')).toBeNull()
})

test('flag on renders the focus layout', async () => {
  setWidth(1280)
  wrap({ screenerFocusLayoutEnabled: true })
  expect(await screen.findByTestId('focus')).toBeInTheDocument()
  expect(screen.queryByTestId('old-shell')).toBeNull()
})

test('embedded always renders the old shell', async () => {
  wrap({ screenerFocusLayoutEnabled: true }, { embedded: true })
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
})

test('outside an AuthProvider renders the old shell', async () => {
  render(<MemoryRouter><Screener /></MemoryRouter>)
  expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
})

test('the how-to bar moves under the Focus layout ? menu; the old page keeps it', async () => {
  const { unmount } = wrap({ screenerFocusLayoutEnabled: true, howToChecklistsEnabled: true })
  await screen.findByTestId('focus')
  expect(screen.queryByTestId('how-to-checklist')).toBeNull()
  unmount()
  wrap({ screenerFocusLayoutEnabled: false, howToChecklistsEnabled: true })
  await screen.findByTestId('old-shell')
  expect(screen.getByTestId('how-to-checklist')).toBeInTheDocument()
})

test('the Focus layout draws no empty header strip above its top bar', async () => {
  const { container, unmount } = wrap({ screenerFocusLayoutEnabled: true })
  expect(container.querySelector('h1')).toBeNull()
  // the Focus top bar is the page's first child: nothing renders above it
  expect(container.firstChild.firstChild).toBe(await screen.findByTestId('focus'))
  unmount()
  // control: the old page keeps its header with the heading in it
  const old = wrap({ screenerFocusLayoutEnabled: false })
  await screen.findByTestId('old-shell')
  expect(old.container.querySelector('h1')).not.toBeNull()
})

// Flag off (and always for the /charts widget and the Terminal SCR panel) the header renders as it
// did before the Focus layout: present even when it holds nothing, because its min-height is part
// of those layouts. The Focus layout is the only place it steps aside.
const headerOf = async (container) => {
  const shell = await screen.findByTestId('old-shell')
  const first = container.firstChild.firstChild
  expect(first).not.toBe(shell)
  return first
}

test('flag off, embedded: the empty header strip still renders above the old shell', async () => {
  const { container } = wrap({ screenerFocusLayoutEnabled: false }, { embedded: true })
  const header = await headerOf(container)
  expect(header.tagName).toBe('DIV')
  expect(header.className).toBe(styles.headerFull)
  expect(header.querySelector('h1')).toBeNull()
})

test('flag off, in a terminal panel: the empty header strip still renders above the old shell', async () => {
  const { container } = render(
    <MemoryRouter><AuthContext.Provider value={{ screenerFocusLayoutEnabled: false }}>
      <TerminalPanelContext.Provider value={{ code: 'SCR', density: 'comfortable', inset: true }}>
        <Screener />
      </TerminalPanelContext.Provider>
    </AuthContext.Provider></MemoryRouter>)
  const header = await headerOf(container)
  expect(header.tagName).toBe('DIV')
  expect(header.className).toBe(styles.headerFull)
  expect(header.querySelector('h1')).toBeNull()
})

test('flag ON never changes the embedded widget or the terminal panel header', async () => {
  const { container, unmount } = wrap({ screenerFocusLayoutEnabled: true }, { embedded: true })
  expect((await headerOf(container)).className).toBe(styles.headerFull)
  unmount()
  const panel = render(
    <MemoryRouter><AuthContext.Provider value={{ screenerFocusLayoutEnabled: true }}>
      <TerminalPanelContext.Provider value={{ code: 'SCR', density: 'comfortable', inset: true }}>
        <Screener />
      </TerminalPanelContext.Provider>
    </AuthContext.Provider></MemoryRouter>)
  expect((await headerOf(panel.container)).className).toBe(styles.headerFull)
})
