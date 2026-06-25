import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollapsibleSection from './CollapsibleSection'

describe('CollapsibleSection', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders the title always; hides children when collapsed by default', () => {
    render(
      <CollapsibleSection id="perf" title="Performance">
        <p>chart body</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('Performance')).toBeInTheDocument()
    expect(screen.queryByText('chart body')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows children when defaultOpen', () => {
    render(
      <CollapsibleSection id="equity" title="Equity" defaultOpen>
        <p>equity body</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('equity body')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('toggles open/closed on click', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleSection id="dist" title="Distribution">
        <p>dist body</p>
      </CollapsibleSection>,
    )
    expect(screen.queryByText('dist body')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('dist body')).toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('dist body')).not.toBeInTheDocument()
  })

  it('persists state to localStorage and re-reads it on mount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <CollapsibleSection id="attr" title="Attribution">
        <p>attr body</p>
      </CollapsibleSection>,
    )
    // collapsed by default → open it (persists "1")
    await user.click(screen.getByRole('button'))
    expect(window.localStorage.getItem('uct.j2.analytics.section.attr')).toBe('1')
    unmount()

    // remount: should read persisted-open even though defaultOpen is false
    render(
      <CollapsibleSection id="attr" title="Attribution">
        <p>attr body</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('attr body')).toBeInTheDocument()
  })

  it('persisted-closed overrides defaultOpen', () => {
    window.localStorage.setItem('uct.j2.analytics.section.opts', '0')
    render(
      <CollapsibleSection id="opts" title="Options" defaultOpen>
        <p>opts body</p>
      </CollapsibleSection>,
    )
    expect(screen.queryByText('opts body')).not.toBeInTheDocument()
  })

  it('renders meta content in the header', () => {
    render(
      <CollapsibleSection id="opts" title="Options Breakdown" meta="3 strategies">
        <p>opts body</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('3 strategies')).toBeInTheDocument()
  })
})
