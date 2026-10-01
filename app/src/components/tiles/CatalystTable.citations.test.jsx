// TERM-050: the catalyst tile's cited sources render through S8's <Provenance>.
import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../voice/ReadAloudButton', () => ({ default: () => null }))

import { CitationsPopover } from './CatalystTable'

const SOURCES = ['https://www.reuters.com/markets/a', 'https://example.org/b', 'not a url']

function open() {
  render(<CitationsPopover sources={SOURCES} />)
  fireEvent.click(screen.getByTitle('3 sources cited'))
  return screen.getAllByTestId('catalyst-source')
}

describe('CatalystTable citations compose on <Provenance>', () => {
  it('renders nothing when there are no sources', () => {
    const { container } = render(<CitationsPopover sources={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('wraps every cited source in a present-provenance affordance around the same link', () => {
    const rows = open()
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(within(row).getByTestId('provenance-present')).toBeInTheDocument()
    const link = within(rows[0]).getByRole('link')
    expect(link).toHaveAttribute('href', SOURCES[0])
    expect(link).toHaveTextContent('reuters.com')
    // an unparseable source still renders, as its own text
    expect(within(rows[2]).getByRole('link')).toHaveTextContent('not a url')
  })

  it('names the source in the disclosure and invents no observed-at time', () => {
    const rows = open()
    fireEvent.click(within(rows[0]).getByTestId('provenance-detail-toggle'))
    const panel = within(rows[0]).getByTestId('provenance-detail-panel')
    expect(panel.textContent).toMatch(/Source: catalyst source · reuters\.com/)
    expect(panel.textContent).not.toMatch(/Observed:/)
  })
})
