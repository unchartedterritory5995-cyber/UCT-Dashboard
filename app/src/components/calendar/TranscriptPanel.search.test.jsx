// Search behaviour on the real panel.
//
// The reported defect was that transcript search "does not work properly": it
// only highlighted. It never counted, never filtered, never moved the view — so
// on a transcript of this length typing produced no visible change and read as
// broken. These assert the things a reader actually does.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const mockUseTranscript = vi.fn(() => ({ data: undefined, isLoading: false }))
vi.mock('../../hooks/useTranscript', () => ({
  default: (...args) => mockUseTranscript(...args),
}))

import TranscriptPanel from './TranscriptPanel'

const TRANSCRIPT = {
  symbol: 'DIS', quarter: '2026Q3', resolved: true,
  segments: [
    { speaker: 'Operator', title: '', sentiment: null,
      content: 'Welcome to the call.' },
    { speaker: 'Hugh Johnston', title: '', sentiment: null,
      content: 'We expect margin expansion, and further margin leverage next year.' },
    { speaker: 'Benjamin Daniel Swinburne, C.F.A.', title: '', sentiment: null,
      content: 'A question on ESPN.' },
  ],
}

// The panel debounces at 150ms; drive fake timers past it.
const settle = () => act(() => { vi.advanceTimersByTime(200) })

function openPanel() {
  render(<TranscriptPanel sym="DIS" />)
  fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
}

function type(value) {
  fireEvent.change(screen.getByLabelText('Search transcript'), { target: { value } })
  settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  mockUseTranscript.mockReturnValue({ data: TRANSCRIPT, isLoading: false })
})

describe('TranscriptPanel — search', () => {
  it('counts matches instead of silently highlighting', () => {
    openPanel()
    type('margin')
    // "margin expansion" + "margin leverage" -> two, and the reader is on the first
    expect(screen.getByRole('status').textContent).toBe('1 / 2')
  })

  it('steps through matches and wraps around', () => {
    openPanel()
    type('margin')
    const next = screen.getByRole('button', { name: 'Next match' })
    fireEvent.click(next)
    expect(screen.getByRole('status').textContent).toBe('2 / 2')
    fireEvent.click(next)
    expect(screen.getByRole('status').textContent).toBe('1 / 2')
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(screen.getByRole('status').textContent).toBe('2 / 2')
  })

  it('marks exactly ONE hit as the active one', () => {
    openPanel()
    type('margin')
    expect(document.querySelectorAll('[data-active-match="true"]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(document.querySelectorAll('[data-active-match="true"]')).toHaveLength(1)
  })

  it('scrolls the active match into view', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    openPanel()
    type('margin')
    expect(spy).toHaveBeenCalled()
  })

  it('finds a SPEAKER by name, comma and credentials included', () => {
    openPanel()
    type('Swinburne')
    expect(screen.getByRole('status').textContent).toBe('1 / 1')
  })

  it('says so when nothing matches, rather than going quiet', () => {
    openPanel()
    type('cryptocurrency')
    expect(screen.getByRole('status').textContent).toBe('No matches')
  })

  it('"Only matching turns" hides the rest — and highlighting alone does not', () => {
    openPanel()
    type('margin')
    // Highlighting is NOT filtering: every turn is still on screen.
    expect(screen.getByText(/Welcome to the call/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText(/only matching turns/i))
    expect(screen.queryByText(/Welcome to the call/)).toBeNull()
    // The matching turn's text is split across <mark> nodes, so assert on the
    // rendered textContent rather than a single text node.
    expect(document.body.textContent).toContain('further margin leverage next year')
    expect(screen.getByText('Hugh Johnston')).toBeTruthy()
  })

  it('Enter advances, Shift+Enter goes back', () => {
    openPanel()
    type('margin')
    const input = screen.getByLabelText('Search transcript')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('status').textContent).toBe('2 / 2')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByRole('status').textContent).toBe('1 / 2')
  })

  it('shows no search chrome until there is a query', () => {
    openPanel()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next match' })).toBeNull()
  })

  it('resets the cursor when the query changes, never past the end', () => {
    openPanel()
    type('margin')
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(screen.getByRole('status').textContent).toBe('2 / 2')
    // 'ESPN' has a single hit; a stale index of 1 would render "2 / 1".
    type('ESPN')
    expect(screen.getByRole('status').textContent).toBe('1 / 1')
  })
})
