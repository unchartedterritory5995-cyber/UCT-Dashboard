/* MOB-01 — the phone's door to the EXISTING workspace/layout system.
 *
 * ⭐ WHAT THIS RAIL IS FOR. The 2026-09 mobile teardown found that UCT already
 * has a server-backed workspace with named layouts, admin-published firm
 * prebuilts, and a full set of handlers — and that the phone rendered NO door to
 * any of it, because `wsGlobalLayouts`/`wsMyLayouts` were computed two lines
 * BELOW `ChartsWorkspace`'s `if (isMobile)` return and referenced only on the
 * desktop path. So the failure mode this file guards is not "the sheet looks
 * wrong", it is **"the phone silently loses access to the layout system again"**.
 *
 * ⛔ THE SHEET MUST OWN NO PERSISTENCE. Every assertion below checks that an
 * action reaches the callback ChartsWorkspace passed in — the same function the
 * desktop menu calls. If someone later gives this component its own
 * `/api/charts/layouts` client or its own store, the "no second persistence
 * layer" test is the one that should go red.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MobileLayoutsSheet from './MobileLayoutsSheet'

const MINE = [
  { id: 11, name: 'Swing board', scope: 'user' },
  { id: 12, name: 'Earnings week', scope: 'user' },
]
const PREBUILT = [{ id: 90, name: 'UCT Standard', scope: 'global' }]

function setup(over = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    mine: MINE,
    prebuilt: PREBUILT,
    active: null,
    isAdmin: false,
    loading: false,
    savedFlash: false,
    onApply: vi.fn(),
    onApplyUctDefault: vi.fn(),
    onSaveCurrent: vi.fn(),
    onSaveAs: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(),
    ...over,
  }
  render(<MobileLayoutsSheet {...props} />)
  return props
}

describe('MOB-01 — the phone can reach the layout system', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the user\'s own layouts AND the firm-published prebuilts', () => {
    setup()
    expect(screen.getByText('Swing board')).toBeInTheDocument()
    expect(screen.getByText('Earnings week')).toBeInTheDocument()
    expect(screen.getByText('UCT Standard')).toBeInTheDocument()
    expect(screen.getByText('UCT Default')).toBeInTheDocument()   // the frozen restore point
  })

  it('applying a layout calls ChartsWorkspace\'s applyTemplate with that row, and closes', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Open layout Swing board' }))
    expect(p.onApply).toHaveBeenCalledTimes(1)
    expect(p.onApply.mock.calls[0][0]).toMatchObject({ id: 11, name: 'Swing board' })
    expect(p.onClose).toHaveBeenCalled()
  })

  it('the prebuilt "UCT Default" routes to applyUctDefault, not to applyTemplate', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: /UCT Default/ }))
    expect(p.onApplyUctDefault).toHaveBeenCalledTimes(1)
    expect(p.onApply).not.toHaveBeenCalled()
  })

  it('Save calls the existing handleSaveLayout', async () => {
    const p = setup()
    await userEvent.click(screen.getByText('Save'))
    expect(p.onSaveCurrent).toHaveBeenCalledTimes(1)
  })

  it('Save as… passes the typed name to the existing handler', async () => {
    const p = setup()
    await userEvent.click(screen.getByText('Save as…'))
    await userEvent.type(screen.getByLabelText('Layout name'), 'Phone board')
    await userEvent.click(screen.getByText('Save layout'))
    expect(p.onSaveAs).toHaveBeenCalledWith('Phone board', 'user')
  })

  it('a duplicate name is refused BEFORE the network, with the reason on screen', async () => {
    const p = setup()
    await userEvent.click(screen.getByText('Save as…'))
    await userEvent.type(screen.getByLabelText('Layout name'), '  swing BOARD  ')
    await userEvent.click(screen.getByText('Save layout'))
    expect(p.onSaveAs).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/already used/i)
  })

  it('a save failure is surfaced and the sheet stays open', async () => {
    const p = setup({ onSaveAs: vi.fn(() => Promise.reject(new Error('Server said no'))) })
    await userEvent.click(screen.getByText('Save as…'))
    await userEvent.type(screen.getByLabelText('Layout name'), 'Anything')
    await userEvent.click(screen.getByText('Save layout'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no')
    expect(p.onClose).not.toHaveBeenCalled()
  })

  it('an empty/whitespace name cannot be submitted at all', async () => {
    const p = setup()
    await userEvent.click(screen.getByText('Save as…'))
    await userEvent.type(screen.getByLabelText('Layout name'), '   ')
    expect(screen.getByText('Save layout')).toBeDisabled()
    expect(p.onSaveAs).not.toHaveBeenCalled()
  })

  // ── destructive-action protection ─────────────────────────────────────────
  it('delete is CONFIRMED, never a single tap', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete layout Swing board' }))
    expect(p.onDelete).not.toHaveBeenCalled()          // first tap only arms it
    await userEvent.click(screen.getByText('Delete'))
    expect(p.onDelete).toHaveBeenCalledWith(11)
  })

  it('Cancel disarms a delete', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete layout Earnings week' }))
    await userEvent.click(screen.getByText('Cancel'))
    expect(p.onDelete).not.toHaveBeenCalled()
  })

  it('⛔ a member is NOT offered delete on a firm-published layout', () => {
    setup({ isAdmin: false })
    expect(screen.queryByRole('button', { name: 'Delete layout UCT Standard' })).toBeNull()
    // …and the row says WHY it is read-only rather than just lacking a control.
    const row = screen.getByRole('button', { name: 'Open layout UCT Standard' })
    expect(within(row).getByText('Firm')).toBeInTheDocument()
  })

  it('an admin IS offered delete on a firm-published layout', () => {
    setup({ isAdmin: true })
    expect(screen.getByRole('button', { name: 'Delete layout UCT Standard' })).toBeInTheDocument()
  })

  it('a member gets no firm-wide scope choice, and always saves to their own scope', async () => {
    const member = setup({ isAdmin: false })
    await userEvent.click(screen.getByText('Save as…'))
    expect(screen.queryByRole('radiogroup')).toBeNull()
    await userEvent.type(screen.getByLabelText('Layout name'), 'Mine')
    await userEvent.click(screen.getByText('Save layout'))
    expect(member.onSaveAs).toHaveBeenCalledWith('Mine', 'user')
  })

  it('an admin can publish firm-wide, and the chosen scope reaches the handler', async () => {
    const admin = setup({ isAdmin: true })
    await userEvent.click(screen.getByText('Save as…'))
    await userEvent.click(screen.getByRole('radio', { name: 'Firm-wide' }))
    await userEvent.type(screen.getByLabelText('Layout name'), 'Firm board')
    await userEvent.click(screen.getByText('Save layout'))
    expect(admin.onSaveAs).toHaveBeenCalledWith('Firm board', 'global')
  })

  // ── state / empty / loading ───────────────────────────────────────────────
  it('the open layout is marked with aria-current, not colour alone', () => {
    setup({ active: { id: 12, name: 'Earnings week', scope: 'user' } })
    expect(screen.getByRole('button', { name: 'Open layout Earnings week' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Open layout Swing board' })).not.toHaveAttribute('aria-current')
    expect(screen.getByText(/Current — Earnings week/)).toBeInTheDocument()
  })

  it('with no named layout open it says so rather than showing a blank header', () => {
    setup({ active: null })
    expect(screen.getByText(/Current — unsaved arrangement/)).toBeInTheDocument()
  })

  it('the empty state explains what Save as… would do', () => {
    setup({ mine: [] })
    expect(screen.getByText(/None yet/)).toBeInTheDocument()
  })

  it('the loading state does not masquerade as "you have no layouts"', () => {
    setup({ mine: [], loading: true })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText(/None yet/)).toBeNull()
  })

  it('savedFlash surfaces as a dirty-state confirmation on the Save row', () => {
    setup({ savedFlash: true })
    expect(screen.getByText('Saved ✓')).toBeInTheDocument()
  })

  it('a long layout name does not get its own row treatment (it ellipsises via .rowLabel)', () => {
    const long = 'A layout name that is far longer than any phone screen can show without wrapping'
    setup({ mine: [{ id: 77, name: long, scope: 'user' }] })
    expect(screen.getByRole('button', { name: `Open layout ${long}` })).toBeInTheDocument()
  })
})

// ── the structural guarantee ────────────────────────────────────────────────
describe('MOB-01 — no second persistence layer was introduced', () => {
  const raw = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'MobileLayoutsSheet.jsx'),
    'utf8',
  )
  // ⚠️ SCAN THE CODE, NOT THE PROSE. The first draft of this rail matched the component's
  // own header comment — which names `/api/charts/layouts` precisely to say it must NOT be
  // called here — and went red on a file that was correct. A probe that a correct file
  // fails is worse than no probe: strip block/line comments first.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the sheet never calls the layouts API, a preference, or storage itself', () => {
    for (const forbidden of ['/api/charts/layouts', 'useChartLayouts', 'usePreferences', 'fetch(', 'localStorage']) {
      expect(src, `MobileLayoutsSheet reached for "${forbidden}" — it must go through ChartsWorkspace's handlers`)
        .not.toContain(forbidden)
    }
  })

  it('it does not promise to save the tickers, because handleSaveAsTemplate sends groups:null', () => {
    // The desktop deliberately keeps the symbol out of a template ("a template must not
    // swap the stock you're looking at"). Copy that promise, don't contradict it.
    expect(raw).toMatch(/groups: null|never swaps the symbol/)
  })
})
