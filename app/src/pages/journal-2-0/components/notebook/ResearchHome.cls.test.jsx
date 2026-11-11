// Tier 4 fix round 2 (the live scorecard, 2026-11-05): Research Home measured CLS 0.13 at 1440 and 0.107 at 390.
// Attributed on production (scratchpad ux/visual/clsprobe*.py):
//   - the first-run welcome showed for a member WITH notes while NotebookTab's count was still loading, then gave way
//     to Home (0.023 + 0.023 at 390);
//   - React REUSED one <div> across skeleton -> welcome -> Home's top row, so the reused node "moved" (0.0597 at 1440:
//     the welcome took the skeleton's node and its own 40 px top margin);
//   - two lazy pieces arrived after first paint and pushed every box below them: the closed AI-actions door
//     (+52 px at 1440, +64 at 390) and the setups box (which on a phone also wrapped to a second row, 58 -> 81).
// jsdom lays nothing out, so this rails the CAUSES: the skeleton holds until the count is known, the three states are
// three different nodes, and each lazy piece has a held-height fallback equal to what arrives.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

let loading = true
vi.mock('../../hooks/useNotebookHome', () => ({
  default: () => ({ home: loading ? null : { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }, isLoading: loading, error: null, refresh: vi.fn() }),
}))
vi.mock('./AskPanel', () => ({ default: () => null }))
// The two lazy pieces never arrive here, so what is on screen is their Suspense fallback.
vi.mock('./SetupsBox', () => new Promise(() => {}))
vi.mock('./AiActionsPanel', () => new Promise(() => {}))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'

const el = (props) => (
  <SWRConfig value={{ provider: () => new Map() }}>
    <AuthContext.Provider value={{ isPaid: true }}>
      <MemoryRouter><ResearchHome onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()} onImport={vi.fn()} {...props} /></MemoryRouter>
    </AuthContext.Provider>
  </SWRConfig>
)
beforeEach(() => { loading = true })
afterEach(() => { cleanup(); __resetNotebookFlags() })

describe('Research Home holds still while it loads', () => {
  it('stays on its skeleton until the note count is known (no welcome flash for a member with notes)', () => {
    loading = false
    const { rerender } = render(el({ hasAnyNotes: false, notesKnown: false }))
    expect(document.querySelector('[data-home-skeleton]')).not.toBeNull()
    expect(screen.queryByText('Welcome to your Notebook')).toBeNull()
    rerender(el({ hasAnyNotes: true, notesKnown: true }))
    expect(document.querySelector('[data-home-skeleton]')).toBeNull()
    expect(screen.queryByText('Welcome to your Notebook')).toBeNull()
  })

  it('CONTROL: a member known to have no notes gets the welcome', () => {
    loading = false
    render(el({ hasAnyNotes: false, notesKnown: true }))
    expect(screen.getByText('Welcome to your Notebook')).toBeInTheDocument()
  })

  it('skeleton, welcome and Home\'s top row are three different nodes (a reused node that moves is a shift)', () => {
    const { container, rerender } = render(el({ hasAnyNotes: false, notesKnown: true }))
    const skeleton = container.querySelector('[data-home-skeleton]')
    loading = false
    rerender(el({ hasAnyNotes: false, notesKnown: true }))
    const welcome = screen.getByText('Welcome to your Notebook').closest('div[class]')
      .closest(`div:not([class*="welcomeHeader"])`)
    const welcomeRoot = container.firstElementChild
    expect(welcomeRoot).not.toBe(skeleton)
    expect(welcome).toBeTruthy()
    rerender(el({ hasAnyNotes: true, notesKnown: true }))
    const top = container.firstElementChild
    expect(top).not.toBe(welcomeRoot)
    expect(top).not.toBe(skeleton)
  })

  it('the setups box and the AI-actions door hold their height while their chunks load', () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true, notebook_ai_actions_enabled: true })
    loading = false
    render(el({ hasAnyNotes: true, notesKnown: true }))
    expect(document.querySelector('[data-home-reserve="setups"]')).not.toBeNull()
    expect(document.querySelector('[data-home-reserve="ai-actions"]')).not.toBeNull()
  })
})

describe('the held heights equal what arrives (stylesheet)', () => {
  const css = (rel) => readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const HOME = css('ResearchHome.module.css')
  const AI = css('AiActionsPanel.module.css')
  const SETUPS = css('SetupsBox.module.css')
  const blocks = (text) => {
    const out = { top: {}, touch: {}, phone: {} }
    let i = 0; let media = 'top'
    const re = /@media[^{]*\{|([^{}]+)\{([^{}]*)\}|\}/g
    let m
    while ((m = re.exec(text))) {
      if (m[0].startsWith('@media')) media = /max-width:\s*640px/.test(m[0]) ? 'phone' : /max-width:\s*1024px/.test(m[0]) ? 'touch' : 'other'
      else if (m[0] === '}') media = 'top'
      else if (out[media]) for (const s of m[1].split(',').map((x) => x.trim())) out[media][s] = `${out[media][s] || ''};${m[2]}`
      i++
    }
    return out
  }
  const decl = (body, prop) => { const r = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body || ''); return r ? r[1].trim() : null }
  const h = blocks(HOME); const a = blocks(AI); const s = blocks(SETUPS)

  it('the AI-actions reserve is the closed door: its toggle height, then its 12 px margin', () => {
    expect(decl(a.top['.toggle'], 'min-height')).toBe('32px')
    expect(decl(h.top['.aiActionsReserve'], 'height')).toBe('32px')
    expect(decl(a.touch['.toggle'], 'min-height')).toBe('44px')
    expect(decl(h.touch['.aiActionsReserve'], 'height')).toBe('var(--tap-min, 44px)')
    expect(decl(a.top['.wrap'], 'margin-bottom')).toBe('12px')
    expect(decl(h.top['.aiActionsReserve'], 'margin-bottom')).toBe('var(--space-md)')
  })

  it('the setups reserve is one row (47 / 58 px), and on a phone the box is always two rows (81 px)', () => {
    expect(decl(h.top['.setupsReserve'], 'height')).toBe('47px')
    expect(decl(h.touch['.setupsReserve'], 'height')).toBe('58px')
    expect(decl(h.phone['.setupsReserve'], 'height')).toBe('81px')
    expect(decl(s.phone['.box'], 'flex-direction')).toBe('column')
  })
})
