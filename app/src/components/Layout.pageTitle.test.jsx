import React from 'react'
// S1 CP2 — a real DOM/wire proof that Layout ACTUALLY sets document.title on
// mount, not just that pageTitle.js's pure function returns the right string.
// Mirrors the "component tests are structurally blind to a severed wire" lesson
// this repo has paid for before: pageTitle.test.js alone would stay green even
// if usePageTitle() were never called from Layout at all.
import { renderWithProviders } from '../test-utils'
import Layout from './Layout'
import { APP_BRAND } from '../surfaces/pageTitle.js'

beforeEach(() => { document.title = 'Some Previous Title' })

test('mounting Layout at a nav-covered surface sets document.title', () => {
  renderWithProviders(
    <Layout><div>child</div></Layout>,
    { route: '/dashboard' }
  )
  expect(document.title).toBe(`Dashboard — ${APP_BRAND}`)
})

test('a different nav-covered route gets its OWN title, not a stale one', () => {
  renderWithProviders(
    <Layout><div>child</div></Layout>,
    { route: '/charts' }
  )
  expect(document.title).toBe(`Charts — ${APP_BRAND}`)
})

test('a route CP2 does not cover leaves document.title exactly as it was', () => {
  renderWithProviders(
    <Layout><div>child</div></Layout>,
    { route: '/admin' }
  )
  expect(document.title).toBe('Some Previous Title')
})

// ⛔ Fix round 1 (review minor 16): React runs a child's effects before its parent's. The open note's
// editor sets "{title} · Notebook · UCT Intelligence", then Layout's pathname effect overwrote it with
// "Notebook · UCT Intelligence" in the same commit -- on any client navigation straight into a note.
// Layout leaves the tab to the editor when a note is open.
function NoteTitleChild() {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { document.title = 'NVDA swing plan · Notebook · UCT Intelligence' }, [])
  return <div>note</div>
}

test('an open note keeps its own tab title (Layout does not overwrite it)', () => {
  renderWithProviders(<Layout><NoteTitleChild /></Layout>, { route: '/journal/notebook?note=n1' })
  expect(document.title).toBe('NVDA swing plan · Notebook · UCT Intelligence')
})

test('CONTROL: the Notebook home is still named by Layout', () => {
  renderWithProviders(<Layout><div>home</div></Layout>, { route: '/journal/notebook' })
  expect(document.title).toBe(`Notebook · ${APP_BRAND}`)
})
