import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoteLinkList } from './NoteLinkMenu'

/**
 * G-106 (Wave B lower-frequency sweep, competitive-gap-ledger.md): no test
 * file existed for this component before this pass. `NoteLinkList` is the
 * presentational popup rendered by the `[[`-triggered TipTap Suggestion
 * extension -- tested directly (it takes plain props: `items`, `loading`,
 * `command`), since the extension's own `render()` has no RTL entry point.
 */

describe('NoteLinkList — loading state (G-106)', () => {
  it('shows a Skeleton loading state, not bare text, while a search is in flight', () => {
    render(<NoteLinkList loading items={[]} command={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Searching…')
    expect(screen.queryByText('No matching notes')).toBeNull()
  })

  it('shows the honest empty state once a search resolves with nothing', () => {
    render(<NoteLinkList loading={false} items={[]} command={vi.fn()} />)
    expect(screen.getByText('No matching notes')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('the loading skeleton disappears once results land', () => {
    render(<NoteLinkList loading items={[{ id: 'n1', title: 'NVDA thesis', ticker: 'NVDA' }]} command={vi.fn()} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('NVDA thesis')).toBeTruthy()
  })
})
