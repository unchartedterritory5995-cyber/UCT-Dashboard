// TERM-087 — the AI Search widget shows a generated answer's editable object
// BESIDE the prose, and shows nothing new when the answer carries none (the
// flag-off answer is byte-for-byte the old shape, so the widget must be too).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <button>Share to Floor</button> }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (v, d) => d }))
import AiSearchWidget from './AiSearchWidget'
import { parseFormula } from '../../../components/chart/engine/ast/parse'

const PROSE = { answer: 'Several leaders are holding their 50-day.', citations: [], related_questions: [] }
const CONDITION = '(close > sma(close, 50))'

// Plain JSON mock — no .body stream, so the widget takes its single-shot path.
function mockAnswer(body) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
}

async function ask(text) {
  render(<AiSearchWidget />)
  const box = screen.getByLabelText('Ask anything about the markets')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(screen.getByText(/Several leaders/)).toBeTruthy())
}

describe('AiSearchWidget — scan_object', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { delete global.fetch })

  it('flag off: an answer with no scan_object renders the prose and NOTHING else new', async () => {
    mockAnswer(PROSE)
    await ask('find stocks above their 50 day')
    expect(screen.queryByTestId('scan-object')).toBeNull()
    expect(screen.queryByTestId('scan-object-refusal')).toBeNull()
    expect(screen.queryByRole('button', { name: /open in builder/i })).toBeNull()
  })

  it('flag on: the object appears BESIDE the prose with its Open in builder door', async () => {
    mockAnswer({ ...PROSE, scan_object: {
      ok: true, kind: 'scan', source: CONDITION, ast: parseFormula(CONDITION).ast,
      not_understood: [], unavailable: [], import_id: 'imp-1' } })
    await ask('find stocks above their 50 day')
    expect(await screen.findByRole('button', { name: /open in builder/i }, { timeout: 10000 })).toBeTruthy()
    expect(screen.getByText(/Several leaders/)).toBeTruthy()
  })

  it('a refused object says why, beside the prose, and offers no door', async () => {
    mockAnswer({ ...PROSE, scan_object: { ok: false, kind: 'scan', gate: 'scan:not-a-condition',
      reason: 'compare it to something, or save it as an indicator' } })
    await ask('find stocks above their 50 day')
    expect(await screen.findByTestId('scan-object-refusal', {}, { timeout: 10000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /open in builder/i })).toBeNull()
  })
})
