// MOVE: "has not appeared in Stock Catalysts recently" implied a window the server does not
// apply (it reads the engine's whole history). The empty line names the real scope.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import MovePanel from './MovePanel'

describe('MOVE catalyst empty copy', () => {
  it('names the whole-history scope, not "recently"', async () => {
    jsonFetcher.mockResolvedValue({ intelligence: { status: 'ok', facts: [] }, catalysts: [], catalyst_status: 'ok',
      since_last_visit: { first_visit: true, new: [] } })
    render(<MovePanel sym="ZZZQ" />)
    const t = (await screen.findByTestId('terminal-move-no-catalysts')).textContent
    expect(t).toBe('ZZZQ has never been flagged by the Stock Catalysts engine (it has recorded since May 25, 2026).')
    expect(t).not.toMatch(/recently/)
  })
})
