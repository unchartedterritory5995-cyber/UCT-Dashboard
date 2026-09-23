import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

import AskCitationView from './AskCitationView'

const node = (attrs = {}) => ({ attrs: {
  n: 1, label: 'NVDA thesis', nav: { kind: 'note', note_id: 'n1' }, citation: 'exact', claim: 'x', ...attrs,
} })

beforeEach(() => navSpy.mockClear())

describe('AskCitationView', () => {
  it('renders [n] and names its source', () => {
    render(<AskCitationView node={node()} decorations={[]} />)
    expect(screen.getByRole('button', { name: 'Source 1: NVDA thesis' })).toHaveTextContent('[1]')
  })

  it('opens the cited note', () => {
    render(<AskCitationView node={node()} decorations={[]} />)
    fireEvent.click(screen.getByRole('button'))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n1')
  })

  it('a stale chip says "edited" in visible text and in its name', () => {
    render(<AskCitationView node={node()} decorations={[{ spec: { askStale: true } }]} />)
    const b = screen.getByRole('button')
    expect(b).toHaveTextContent('[1 · edited]')
    expect(b).toHaveAccessibleName('Source 1: NVDA thesis, text edited since inserted')
  })

  it('insert-time precision is stated in words', () => {
    render(<AskCitationView node={node({ citation: 'page_only' })} decorations={[]} />)
    expect(screen.getByRole('button')).toHaveAccessibleName('Source 1: NVDA thesis, page only')
  })

  it('a source with no note is not clickable, and a shared copy (attrs reduced to n) still reads', () => {
    render(<AskCitationView node={{ attrs: { n: 2 } }} decorations={[]} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('[2]')).toBeInTheDocument()
    expect(screen.getByText('Source 2: source')).toBeInTheDocument()
  })
})
