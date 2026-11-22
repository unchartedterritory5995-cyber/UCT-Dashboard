// S17 (audit 2026-11-05, M7): an empty widget's ask -- its sentence, input, suggestions and the empty live line --
// read by axe, as it renders inside a note.
import { describe, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeSurface } from './surface'
import EmptyNamesAsk, { NAMES_ASK } from '../components/notebook/EmptyNamesAsk'
import { __resetMyNamesQueue } from '../lib/myNames'

beforeEach(() => {
  __resetMyNamesQueue()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })))
})
afterEach(() => vi.unstubAllGlobals())

describe('the empty widget ask -- axe', () => {
  axeSurface('empty-names-ask', async () => {
    render(<main><EmptyNamesAsk /></main>)
    expect(screen.getByText(NAMES_ASK)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Suggestions' })).toBeInTheDocument()
  })
})
