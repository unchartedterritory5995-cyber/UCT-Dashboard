// UCT Terminal — HELP's per-member flag status marker. A code with a `flag` property must
// show whether it is enabled for the CURRENT member's account flags, using the exact same
// gate `resolvePanel`/`flagOn` apply (functions.js) -- never a second implementation. A code
// with no `flag` property is always available and carries no marker at all.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import HelpPanel from './HelpPanel'
import { BY_CODE, flagOn } from '../functions'

// TECH ('researchTechnicalTabEnabled') and FTD ('researchDepth.ftd_dataset_enabled') are both
// real registry entries with a `ticker.flag` -- used here as the enabled/disabled pair rather
// than inventing fixture codes, so the test exercises the real registry's real shapes (a plain
// key and a dotted Depth key). HELP (market, no flag) stands in for the unflagged case.

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
