// app/src/pages/journal-2-0/a11y/myToolsTools.a11y.test.jsx
//
// Wave 9 Task 9.18: My tools' Routines and Trackers tabs through 8A's axe harness, in the states a member meets: the
// routines list (schedule words, Used in, a template line) and its open menu; a rename refused by a stale tab with
// Reload; the archive sentence with its count; an archived routine's typed-name delete; a routine's notes; the
// trackers list with the two check-in trackers first and read-only; Recently deleted; the phone form with the actions
// in their own sheet; and an offline list. Each recipe asserts what painted before axe runs, so an empty screen cannot
// pass as a clean one. My tools (components/notebook/myTools/) is outside the derived population, so its files are
// OUTSIDE_POPULATION_SURFACES entries naming this rail. `fetch` is a fake server.
import { describe, beforeEach, afterEach, vi, expect } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { axeSurface } from './surface'
import MyToolsSheet from '../components/notebook/myTools/MyToolsSheet'
import { installToolsFetch, refuse } from '../components/notebook/myTools/__fixtures__/toolsFixtures'

const bp = vi.hoisted(() => ({ phone: false, touch: false }))
vi.mock('../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))
vi.mock('../components/notebook/routines/openRoutineEditor.js', () => ({ openRoutineEditor: vi.fn(() => () => {}) }))
vi.mock('../components/notebook/routines/openTrackerEditor.js', () => ({ openTrackerEditor: vi.fn(() => () => {}) }))

const settle = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const open = async (tab) => {
  render(<MyToolsSheet onClose={() => {}} uid="u1" tab={tab} />)
  await screen.findByRole('heading', { name: new RegExp(`${tab}$`) })
}
const rowOf = (name) => screen.getAllByTestId('my-tools-tool-row')
  .find((r) => r.querySelector('[data-tool-name]')?.textContent === name)
const live = () => screen.getByTestId('my-tools-message')

describe('a11y: My tools, Routines and Trackers (wave 9, Task 9.18)', () => {
  beforeEach(() => { bp.phone = false; bp.touch = false })
  afterEach(() => { vi.unstubAllGlobals() })

  axeSurface('my-tools-routines', async () => {
    installToolsFetch()
    await open('routines')
    expect(rowOf('Morning prep')).toHaveTextContent('Every trading day')
    expect(rowOf('Trade-day check')).toHaveTextContent('From a template')
    expect(screen.getByRole('button', { name: /^Used in 2 notes/ })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Show' })).toBeTruthy()
    await settle()
  })

  axeSurface('my-tools-routines-menu', async () => {
    installToolsFetch()
    await open('routines')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Morning prep' }))
    const menu = await screen.findByRole('menu', { name: 'Morning prep' })
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toBeTruthy()
    await settle()
  })

  axeSurface('my-tools-tool-rename', async () => {
    installToolsFetch([['PUT', 'routines/r1', () => refuse(409, 'conflict', 'Changed in another tab. Reload to see the newer version.')]])
    await open('routines')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Morning prep' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Morning routine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeTruthy()
    await waitFor(() => expect(live()).toHaveTextContent('Changed in another tab.'))
  })

  axeSurface('my-tools-tool-archive', async () => {
    installToolsFetch()
    await open('routines')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Morning prep' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    expect(await screen.findByText('It stays in your 2 notes. Its history is kept.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive routine' })).toBeTruthy()
    await settle()
  })

  axeSurface('my-tools-tool-delete', async () => {
    installToolsFetch()
    await open('routines')
    fireEvent.click(screen.getByRole('button', { name: 'Archived', pressed: false }))
    await screen.findByRole('heading', { name: '1 archived' })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Old routine' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }))
    expect(await screen.findByRole('textbox', { name: /Type Old routine to confirm/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete permanently' }).getAttribute('aria-disabled')).toBe('true')
    await settle()
  })

  axeSurface('my-tools-tool-used-in', async () => {
    installToolsFetch()
    await open('routines')
    fireEvent.click(screen.getByRole('button', { name: /^Used in 2 notes/ }))
    expect(await screen.findByRole('link', { name: /Weekly review/ })).toBeTruthy()
    await settle()
  })

  axeSurface('my-tools-trackers', async () => {
    installToolsFetch()
    await open('trackers')
    expect(rowOf('Check-in mood')).toHaveTextContent('From your check-ins')
    expect(rowOf('Coffee')).toHaveTextContent('Number · cups')
    expect(screen.getAllByTestId('my-tools-tool-row')[0].querySelector('[data-tool-name]').textContent).toBe('Check-in mood')
    await settle()
  })

  axeSurface('my-tools-trackers-deleted', async () => {
    installToolsFetch()
    await open('trackers')
    fireEvent.click(screen.getByRole('button', { name: 'Recently deleted', pressed: false }))
    await screen.findByRole('heading', { name: '1 recently deleted' })
    expect(rowOf('Gone tracker')).toHaveTextContent('Kept until')
    await settle()
  })

  axeSurface('my-tools-trackers-phone', async () => {
    bp.phone = true
    bp.touch = true
    installToolsFetch()
    await open('trackers')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Sleep' }))
    await waitFor(() => expect(document.querySelectorAll('[data-sheet-panel]')).toHaveLength(2))
    expect(document.querySelectorAll('[data-sheet-panel]')[1].textContent).toContain('Rename')
    await settle()
  })

  axeSurface('my-tools-tools-offline', async () => {
    installToolsFetch()
    const nav = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      render(<MyToolsSheet onClose={() => {}} uid="u1" tab="trackers" />)
      expect(await screen.findByTestId('my-tools-load-failed')).toHaveTextContent("You're offline. Your trackers show here")
      await settle()
    } finally {
      nav.mockRestore()
    }
  })
})
