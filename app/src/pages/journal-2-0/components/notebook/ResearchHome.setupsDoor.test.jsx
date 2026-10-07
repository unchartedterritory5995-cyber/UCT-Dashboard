// Finish program, lane NAV, item A: the active setups board's one door.
//
// docs/notebook/BETA-HANDOFF.md 1b said of NOTEBOOK_SETUPS_BOARD_ENABLED: "No menu link to it
// yet". The board is a real page at /journal/notebook/setups and nothing on the Notebook's own
// surface pointed at it, so a member with the switch on could reach it only through the tour
// or a typed URL.
//
// What this holds:
//   * switch ON: Research Home carries ONE link to the board, in every state a member who has
//     notes can land on (quiet, quiet with a failed load, the full home);
//   * switch OFF: the page is the page it was. The proof is a DOM comparison, not an absence
//     check alone: the switch-on render with the one link taken out is byte-for-byte the
//     switch-off render, so the link is the WHOLE difference (no wrapper, no spacer);
//   * the path and the flag are read from the board's own authority, never retyped here;
//   * Research Home is on the Notebook's first-open path, so the door must not pull the board
//     page (charts, grid) into it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

let hookResult
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => hookResult }))

import ResearchHome from './ResearchHome'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { SETUPS_BOARD_FLAG, SETUPS_BOARD_PATH, setupsBoardEnabled } from '../../lib/setupsBoardLink'
import { START_ROUTES } from './onboarding/tourRegistry'
import { expectNoAxeViolations } from '../../a11y/axeHarness'

const here = dirname(fileURLToPath(import.meta.url))
const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
const FULL = { ...EMPTY, favorites: [{ id: 'n1', title: 'Fav note', updatedAt: '2026-09-01T00:00:00Z' }] }

function renderHome(props = {}) {
  return render(
    <MemoryRouter>
      <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()}
        onImport={vi.fn()} onOpenToday={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}
const door = () => screen.queryByRole('link', { name: 'Active setups' })
// UIcon's gradient id and React's useId are counters of mount order, not markup.
const normalise = (html) => html.replace(/uig\d+/g, 'uig').replace(/:r[0-9a-z]+:/g, ':r:')

beforeEach(() => {
  hookResult = { home: EMPTY, isLoading: false, error: null, refresh: vi.fn() }
  __resetNotebookFlags()
})
afterEach(() => __resetNotebookFlags())

describe('the setups board door: one authority', () => {
  it('the flag key is the auth payload key and the path is a route the tour may start on', () => {
    expect(SETUPS_BOARD_FLAG).toBe('notebook_setups_board_enabled')
    expect(START_ROUTES).toContain(SETUPS_BOARD_PATH)
  })

  // One fact in two files, pinned against each other. The page keeps its own literal because
  // the tour rail (tours/b3Research.test.jsx) reads that literal off the page's source, and
  // this module must not import the page (first-open bytes). So the test PARSES the page's
  // declaration rather than restating it, and fails if either side moves alone.
  it('the board page gates on the SAME flag key and serves the SAME path', () => {
    const page = readFileSync(resolve(here, 'SetupsBoard.jsx'), 'utf8')
    const m = page.match(/export const BOARD_FLAG\s*=\s*'([^']+)'/)
    expect(m, "SetupsBoard.jsx's BOARD_FLAG declaration").toBeTruthy()
    expect(m[1]).toBe(SETUPS_BOARD_FLAG)
    const app = readFileSync(resolve(here, '../../../../App.jsx'), 'utf8')
    expect(app).toMatch(/<Route path="notebook\/setups" element=\{<SetupsBoard \/>\}/)
    expect(SETUPS_BOARD_PATH).toBe('/journal/notebook/setups')
  })

  it('reads the switch as OFF until the payload says on', () => {
    expect(setupsBoardEnabled()).toBe(false)
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    expect(setupsBoardEnabled()).toBe(true)
  })
})

describe('Research Home, setups board switch ON', () => {
  beforeEach(() => latchNotebookFlags({ notebook_setups_board_enabled: true }))

  it('quiet home: exactly one link, named, pointing at the board', () => {
    renderHome()
    expect(screen.getByText('Nothing needs your attention right now.')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Active setups' })).toHaveLength(1)
    expect(door().getAttribute('href')).toBe(SETUPS_BOARD_PATH)
  })

  it('quiet home with a failed load still offers it', () => {
    hookResult = { home: EMPTY, isLoading: false, error: new Error('boom'), refresh: vi.fn() }
    renderHome()
    expect(door()).toBeTruthy()
  })

  it('full home: exactly one link, after the Today button', () => {
    hookResult = { home: FULL, isLoading: false, error: null, refresh: vi.fn() }
    renderHome()
    expect(screen.getAllByRole('link', { name: 'Active setups' })).toHaveLength(1)
    const today = screen.getByRole('button', { name: /^Today$/ })
    expect(today.compareDocumentPosition(door()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('carries the touch floor class, so it is 44px on a phone and a tablet', () => {
    renderHome()
    expect(door().className).toMatch(/setupsLink/)
    const css = readFileSync(resolve(here, 'ResearchHome.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const touch = css.match(/@media \(max-width: 1024px\)\s*\{\s*\.setupsLink\s*\{([^}]*)\}/)
    expect(touch, 'a <=1024px rule for .setupsLink').toBeTruthy()
    expect(touch[1]).toMatch(/min-height:\s*var\(--tap-min/)
    expect(touch[1]).toMatch(/display:\s*inline-flex/)
  })

  it('axe finds nothing wrong with the home that carries the door', async () => {
    hookResult = { home: FULL, isLoading: false, error: null, refresh: vi.fn() }
    const { container } = renderHome()
    expect(door()).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('is not offered on the first-run screen (no notes means no plans to show)', () => {
    renderHome({ hasAnyNotes: false })
    expect(door()).toBeNull()
  })
})

describe('Research Home, setups board switch OFF', () => {
  for (const [name, home, error] of [
    ['quiet home', EMPTY, null],
    ['quiet home, failed load', EMPTY, new Error('boom')],
    ['full home', FULL, null],
  ]) {
    it(`${name}: no link, and the link is the whole difference from switch ON`, () => {
      hookResult = { home, isLoading: false, error, refresh: vi.fn() }
      const off = renderHome()
      expect(door()).toBeNull()
      expect(off.container.querySelector(`a[href="${SETUPS_BOARD_PATH}"]`)).toBeNull()
      const offHtml = normalise(off.container.innerHTML)
      off.unmount()

      latchNotebookFlags({ notebook_setups_board_enabled: true })
      const on = renderHome()
      const link = on.container.querySelector(`a[href="${SETUPS_BOARD_PATH}"]`)
      expect(link, 'control: switch ON renders the link').toBeTruthy()
      expect(normalise(on.container.innerHTML)).not.toBe(offHtml)
      link.remove()
      expect(normalise(on.container.innerHTML)).toBe(offHtml)
    })
  }

  it('an explicit false is OFF too', () => {
    latchNotebookFlags({ notebook_setups_board_enabled: false })
    renderHome()
    expect(door()).toBeNull()
  })
})

describe('first-open bytes', () => {
  it('Research Home does not import the board page; the link module imports only the flag reader', () => {
    const home = readFileSync(resolve(here, 'ResearchHome.jsx'), 'utf8')
    expect(home).not.toMatch(/from\s+['"]\.\/SetupsBoard['"]/)
    expect(home).not.toMatch(/import\(['"]\.\/SetupsBoard['"]\)/)
    const lib = readFileSync(resolve(here, '../../lib/setupsBoardLink.js'), 'utf8')
    const imports = [...lib.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(imports).toEqual(['./offline/notebookFlags'])
  })
})
