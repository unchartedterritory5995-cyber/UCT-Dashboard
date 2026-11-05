// Tier 1a bytes (perf-budgets.md): the thesis REVIEW section is fetched only for a note that is a thesis, never on the
// Notebook's first open. Its own file because the module registry is per FILE: the factory counter starts at 0 here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const loads = vi.hoisted(() => ({ factoryRuns: 0 }))
vi.mock('./ThesisReviewSection', () => {
  loads.factoryRuns += 1
  return { default: () => <div data-testid="thesis-review" /> }
})
vi.mock('../../hooks/useThesisSummary', () => ({ default: () => ({ evidence: [], changelog: [], isLoading: false, refresh: vi.fn() }) }))
vi.mock('../../hooks/useNoteFacts', () => ({ default: () => ({ facts: [] }) }))
vi.mock('../../hooks/useNoteExcerpts', () => ({ default: () => ({ excerpts: [] }) }))
vi.mock('../../hooks/useEvidenceCandidates', () => ({ default: () => ({ candidates: [], isLoading: false, refresh: vi.fn() }) }))

import ThesisSection from './ThesisSection'

beforeEach(() => { global.fetch = vi.fn(); window.localStorage.clear() })

describe('the thesis review section loads on demand', () => {
  it('a plain note never fetches it; a thesis fetches it once', async () => {
    const plain = render(<MemoryRouter><ThesisSection noteId="n1" note={{ id: 'n1', title: 'Groceries', tags: [], propertiesJson: {} }} /></MemoryRouter>)
    await new Promise((r) => setTimeout(r, 20))
    expect(loads.factoryRuns).toBe(0)
    plain.unmount()
    render(<MemoryRouter><ThesisSection noteId="n2" note={{ id: 'n2', title: 'NVDA', tags: ['thesis'], propertiesJson: {} }} /></MemoryRouter>)
    expect(await screen.findByTestId('thesis-review')).toBeTruthy()
    expect(loads.factoryRuns).toBe(1)
  })
})
