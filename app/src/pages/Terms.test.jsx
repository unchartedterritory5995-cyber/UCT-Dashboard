import { renderWithProviders, screen } from '../test-utils'
import Terms from './Terms'

// PACKET-S CP1 — FRED requires: "Place the following notice prominently on
// your application: 'This product uses the FRED® API but is not endorsed or
// certified by the Federal Reserve Bank of St. Louis.'", a link to their
// Terms of Use, and a sentence binding FRED-derived feature use to those
// terms. This is a NEW section — no EXISTING section may be renumbered.

test('renders the FRED attribution sentence verbatim', () => {
  renderWithProviders(<Terms />)
  expect(
    screen.getByText(
      /This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St\. Louis\./,
    ),
  ).toBeInTheDocument()
})

test('links to FRED\'s Terms of Use', () => {
  renderWithProviders(<Terms />)
  const link = screen.getByRole('link', { name: /Terms of Use/i })
  expect(link).toHaveAttribute('href', 'https://fred.stlouisfed.org/docs/api/terms_of_use.html')
})

test('states that FRED-derived feature use is subject to FRED\'s own terms', () => {
  renderWithProviders(<Terms />)
  expect(screen.getByText(/subject to those/)).toBeInTheDocument()
  expect(screen.getByText(/terms in addition to this Agreement/)).toBeInTheDocument()
})

test('the new section is numbered 13 and does not renumber any existing section', () => {
  renderWithProviders(<Terms />)
  // Control: every pre-existing numbered heading (1-12) must survive unchanged —
  // proves this was an APPEND, not a renumber, which is exactly what a naive
  // "insert as a new section" implementation could get wrong if it touched the
  // wrong end of the list.
  for (let n = 1; n <= 12; n++) {
    expect(
      screen.getByRole('heading', { name: new RegExp(`^${n}\\. `) }),
    ).toBeInTheDocument()
  }
  expect(
    screen.getByRole('heading', { name: /^13\. Third-Party Data/ }),
  ).toBeInTheDocument()
  // And nothing claims a 14th section — this packet authorizes exactly one.
  expect(screen.queryByRole('heading', { name: /^14\. / })).not.toBeInTheDocument()
})
