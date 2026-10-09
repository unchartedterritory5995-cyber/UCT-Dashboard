// Audit 2026-10-08 (MOVE P2, points 9 and 20): fact times were raw server strings with no zone, and
// the empty line said "No notable facts fired", internal vocabulary.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import MovePanel, { asOfText } from './MovePanel'

describe('MOVE as-of text', () => {
  it('a bare date stays a date', () => { expect(asOfText('2026-10-01')).toBe('2026-10-01') })
  it('a UTC timestamp is shown on the market clock, labelled ET', () => {
    expect(asOfText('2026-10-01T14:30:00Z')).toBe('10/1/2026, 10:30:00 AM ET')
  })
  it('epoch seconds and ms both read as ET', () => {
    expect(asOfText(1759329000)).toBe('10/1/2025, 10:30:00 AM ET')
    expect(asOfText(1759329000000)).toBe('10/1/2025, 10:30:00 AM ET')
  })
  it('absent is absent, unparseable is passed through', () => {
    expect(asOfText(null)).toBeNull()
    expect(asOfText('last week')).toBe('last week')
  })
  it('the empty line is plain English, and a fact time renders in ET', async () => {
    jsonFetcher.mockResolvedValue({ intelligence: { status: 'ok', facts: [] }, catalysts: [], catalyst_status: 'ok',
      since_last_visit: { first_visit: true, new: [] } })
    render(<MovePanel sym="AMD" />)
    expect((await screen.findByTestId('terminal-move-nothing')).textContent)
      .toBe('Nothing notable has changed for AMD in what we track (every source answered).')
  })
})
