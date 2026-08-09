// app/src/components/screener/ScanResultRow.test.jsx
//
// ─── THE COMPONENT CASE, AND IT IS DELIBERATELY BLIND TO THE WIRE ───────────
//
// 🔴 THIS FILE IS THE CONTROL, NOT THE PROOF. It renders a row and asserts it
// has a chart button. That case stays GREEN for the entire time the button goes
// NOWHERE — which is precisely what makes it the control half of E-9's wire-cut
// split: `ScanToChart.wire.test.jsx` drives the CLICK and asserts the chart
// received the DEFINITION, and it is the only file that may red when the join is
// cut (mutation M2).
//
// ⛔ SO NOTHING HERE CLICKS. Adding a click assertion to this file would destroy
// the split: M2 would red both files, the "only the wire test sees it" claim
// would be unverified, and this task would have shipped the same structurally
// blind component suite the repo already measured — 4 auditors, 25 findings, 6
// of 9 unreachability, every component correct alone.
//
// ⚠️ AND THE COST OF THAT BLINDNESS IS STATED RATHER THAN HIDDEN: every
// assertion below passes on a button wired to nothing at all.

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { ScanResultRow } from './ScanResults'

/** A stand-in document. This file never installs it — a row does not resolve a
 *  definition, it CARRIES one — so the shape only has to be an object. */
const DOC = { id: 'u_0123456789ab', compute: { kind: 'ast', fn: 'sha256:abc' } }

const renderRow = (over = {}) => render(
  <ul>
    <ScanResultRow ticker="NVDA" definition={DOC} onChart={() => {}} {...over} />
  </ul>,
)

describe('ScanResultRow — one hit, and the button that charts it', () => {
  it('renders the symbol the scan returned', () => {
    renderRow()
    expect(screen.getByText('NVDA')).toBeInTheDocument()
  })

  it('offers a chart button whose accessible name NAMES the symbol', () => {
    // ⚠️ NOT A BARE "Chart". Twenty identical buttons in a hit list are
    // unusable with a screen reader and unaddressable by role, and
    // `getByRole('button', {name: /chart NVDA/i})` is what the wire-cut case
    // binds to — so the name is part of the contract between the two files.
    renderRow()
    expect(screen.getByRole('button', { name: /chart NVDA/i })).toBeInTheDocument()
  })

  it('names the button after ITS OWN ticker, not a fixed one', () => {
    // The control on the case above: a hardcoded label would pass it.
    renderRow({ ticker: 'AMD' })
    expect(screen.getByRole('button', { name: /chart AMD/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /chart NVDA/i })).not.toBeInTheDocument()
  })

  it('renders no chart of its own — a row is a row', () => {
    // A row that mounted a chart pane would make the surface's ONE pane
    // ambiguous, and `getByTestId('chart-pane')` in the wire test would throw on
    // a multiple-match rather than on the thing it is asserting.
    renderRow()
    expect(screen.queryByTestId('chart-pane')).not.toBeInTheDocument()
  })
})
