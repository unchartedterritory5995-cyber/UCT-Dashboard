// app/src/pages/journal-2-0/a11y/myToolsWidgets.a11y.test.jsx
//
// Wave 9 Task 9.18 fix 1 (I-1): My tools (components/notebook/myTools/) joined the derived population, so the wave 8
// Widgets tab's surfaces need axe recipes of their own: the widgets list, a widget's version history, the restore
// question it asks for a widget in several notes, and the typed-name delete. Each recipe asserts what painted before
// axe runs, so an empty screen cannot pass as a clean one. `fetch` is a fake server (myToolsFixtures).
import { describe, beforeEach, afterEach, vi, expect } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { createRef } from 'react'
import { axeSurface } from './surface'
import MyToolsSheet from '../components/notebook/myTools/MyToolsSheet'
import VersionHistory from '../components/notebook/myTools/VersionHistory'
import DeleteConfirm from '../components/notebook/myTools/DeleteConfirm'
import { installFetch, LIVE, ARCHIVED } from '../components/notebook/myTools/__fixtures__/myToolsFixtures'

vi.mock('../components/notebook/widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))
vi.mock('../components/notebook/widgets/SetsDialog', () => ({ openSetsDialog: vi.fn(() => () => {}) }))

const settle = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const REVS = [
  { rev: 3, summary: 'Net P&L, split by setup, for closed trades in the last 90 days.', savedAt: '2025-03-04T17:00:00Z',
    named: null, current: true, placed: false, plan: {} },
  { rev: 2, summary: 'Net P&L, split by symbol, for closed trades in the last 30 days.', savedAt: '2025-03-01T18:30:00Z',
    named: 'Before the setup split', current: false, placed: true, plan: {} },
]
const history = (routes = []) => {
  installFetch([['GET', `/${LIVE[0].id}/revs`, () => ({ revs: REVS })], ...routes])
  render(<VersionHistory d={LIVE[0]} onBack={() => {}} subBackRef={createRef()} announce={() => {}} onChanged={() => {}} />)
}

describe('a11y: My tools, the Widgets tab (wave 8 surfaces, registered in wave 9)', () => {
  beforeEach(() => { vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { fn(0); return 0 }) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  axeSurface('my-tools-widgets', async () => {
    installFetch()
    render(<MyToolsSheet onClose={() => {}} uid="u1" />)
    expect(await screen.findByRole('heading', { name: '2 widgets' })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'My tools' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Used in 3 notes/ })).toBeTruthy()
    await settle()
  })

  axeSurface('my-tools-widget-history', async () => {
    history()
    expect(await screen.findByRole('heading', { name: 'Version history: Net P&L by setup' })).toBeTruthy()
    expect((await screen.findAllByTestId('my-tools-rev')).length).toBe(2)
    await settle()
  })

  axeSurface('my-tools-widget-restore-question', async () => {
    history([['POST', '/w1/revs/2/restore', () => ({ ...LIVE[0], rev: 4, etag: 8 })]])
    await screen.findAllByTestId('my-tools-rev')
    const row = document.querySelector('[data-rev="2"]')
    fireEvent.click(within(row).getByRole('button', { name: /^Restore the version from/ }))
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText('This widget is in 3 notes.')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Save as a new widget/ })).toBeTruthy()
    await settle()
  })

  axeSurface('my-tools-widget-delete', async () => {
    installFetch()
    render(<DeleteConfirm d={ARCHIVED[0]} onBack={() => {}} onDeleted={() => {}} />)
    expect(await screen.findByRole('textbox', { name: /Type Old edge to confirm/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete permanently' }).getAttribute('aria-disabled')).toBe('true')
    await settle()
  })
})
