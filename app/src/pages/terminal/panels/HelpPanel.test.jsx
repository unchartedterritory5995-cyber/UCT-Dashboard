// UCT Terminal — HELP's per-member flag status marker. A code with a `flag` property must
// show whether it is enabled for the CURRENT member's account flags, using the exact same
// gate `resolvePanel`/`flagOn` apply (functions.js) -- never a second implementation. A code
// with no `flag` property is always available and carries no marker at all.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import HelpPanel, { scopeLabel } from './HelpPanel'
import { BY_CODE, flagOn } from '../functions'

// TECH ('researchTechnicalTabEnabled') and FTD ('researchDepth.ftd_dataset_enabled') are both
// real registry entries with a `ticker.flag` -- used here as the enabled/disabled pair rather
// than inventing fixture codes, so the test exercises the real registry's real shapes (a plain
// key and a dotted Depth key). HELP (market, no flag) stands in for the unflagged case.

describe('HELP says which codes leave the terminal (audit 2026-10-08)', () => {
  it('a door that leaves the terminal is marked; an embedded panel is not', () => {
    expect(scopeLabel(BY_CODE.JRNL)).toBe('market (opens a page)')
    expect(scopeLabel(BY_CODE.GEX)).toBe('security (opens a page) · market (opens a page)')
    expect(scopeLabel(BY_CODE.MB)).toBe('security · market (opens a page)')
    expect(scopeLabel(BY_CODE.FA)).toBe('security')
    expect(scopeLabel(BY_CODE.MOST)).toBe('market')
  })

  it('lane C doors (DESK, NB, RES) are marked; panel codes (U20, REL, HELP) are not', () => {
    for (const code of ['DESK', 'NB', 'RES']) expect(scopeLabel(BY_CODE[code])).toContain('opens a page')
    for (const code of ['U20', 'REL', 'HELP']) expect(scopeLabel(BY_CODE[code])).not.toContain('opens a page')
  })

  it('the list a member reads carries the marker', () => {
    render(<HelpPanel auth={{}} />)
    expect(screen.getByText('Journal').closest('button').textContent).toContain('opens a page')
    expect(screen.getByText('Financials').closest('button').textContent).not.toContain('opens a page')
  })
})

describe('HelpPanel per-member flag markers', () => {
  it('a code with a disabled flag shows the disabled marker', () => {
    render(<HelpPanel auth={{}} />)
    const marker = screen.getByTestId('terminal-help-flag-TECH')
    expect(marker).toHaveTextContent('not enabled')
    // Sanity: TECH really is gated off by this auth, via the real helper.
    expect(flagOn({}, BY_CODE.TECH.ticker.flag)).toBe(false)
  })

  it('a code with an enabled flag shows the enabled marker', () => {
    render(<HelpPanel auth={{ researchTechnicalTabEnabled: true }} />)
    const marker = screen.getByTestId('terminal-help-flag-TECH')
    expect(marker).toHaveTextContent('enabled')
    expect(marker).not.toHaveTextContent('not enabled')
  })

  it('a dotted Depth flag agrees with flagOn too', () => {
    render(<HelpPanel auth={{ researchDepth: { ftd_dataset_enabled: true } }} />)
    expect(screen.getByTestId('terminal-help-flag-FTD')).toHaveTextContent('enabled')
    expect(screen.getByTestId('terminal-help-flag-FTD')).not.toHaveTextContent('not enabled')
  })

  it('a code with no `flag` property shows no marker at all', () => {
    render(<HelpPanel auth={{}} />)
    // HELP itself (market-only, no flag declared anywhere in the registry) must carry
    // neither an enabled nor a disabled marker.
    expect(BY_CODE.HELP.market.flag).toBeUndefined()
    expect(screen.queryByTestId('terminal-help-flag-HELP')).toBeNull()
  })

  it('before the sign-in payload has arrived, no gated code says "not enabled" (quality pass 2026-10-05)', () => {
    const { rerender } = render(<HelpPanel auth={{ loading: true }} />)
    expect(screen.queryByText(/not enabled/)).toBeNull()
    expect(screen.queryByTestId('terminal-help-flag-TECH')).toBeNull()
    expect(screen.getByText('TECH')).toBeTruthy()            // the row itself still lists
    rerender(<HelpPanel auth={{ loading: false, authTransient: true }} />)
    expect(screen.queryByText(/not enabled/)).toBeNull()
    rerender(<HelpPanel auth={{ loading: false }} />)          // arrived: the real answer
    expect(screen.getByTestId('terminal-help-flag-TECH')).toHaveTextContent('not enabled')
  })

  it('HELP never disagrees with the real gate: marker state matches flagOn for every flagged code', () => {
    const auth = { researchTechnicalTabEnabled: true, researchDepth: { ftd_dataset_enabled: false } }
    render(<HelpPanel auth={auth} />)
    for (const f of Object.values(BY_CODE)) {
      const flag = f.ticker?.flag || f.market?.flag
      if (!flag) continue
      const marker = screen.queryByTestId(`terminal-help-flag-${f.code}`)
      expect(marker).not.toBeNull()
      const expected = flagOn(auth, flag) ? 'enabled' : 'not enabled'
      expect(marker.textContent).toContain(expected)
    }
  })
})

describe('HELP: the BOARD entry lists the "Board of" codes', () => {
  it('names exactly the codes the "Board of" menu on a list offers (the same list, never a copy)', async () => {
    const { boardableCodes, QUICK_BOARD_CODES } = await import('../scanBoard')
    const auth = { researchTechnicalTabEnabled: true }
    render(<HelpPanel auth={auth} />)
    const line = screen.getByTestId('terminal-help-board-codes')
    const shown = [...line.querySelectorAll('kbd')].map((k) => k.textContent).filter((c) => c !== 'BOARD OWN')
    expect(shown).toEqual(boardableCodes(auth).map((c) => c.code))
    expect(shown.length).toBeGreaterThan(2)                      // non-vacuous: GP, DES, CN at least
    expect(shown.every((c) => QUICK_BOARD_CODES.includes(c))).toBe(true)
    expect(line.textContent).toContain('Board of')
  })

  it('a code the member cannot use is not offered, and nothing is listed before flags arrive', async () => {
    const { boardableCodes } = await import('../scanBoard')
    const off = boardableCodes({}).map((c) => c.code)
    const on = boardableCodes({ researchTechnicalTabEnabled: true }).map((c) => c.code)
    expect(on.length).toBeGreaterThan(off.length)                // TECH is flag-gated
    render(<HelpPanel auth={{ loading: true }} />)
    expect(screen.queryByTestId('terminal-help-board-codes')).toBeNull()
  })
})
