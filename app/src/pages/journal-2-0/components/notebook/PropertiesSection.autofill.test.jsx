// Wave 10 lane 10B — G-165 "autofill properties", narrow (ruling R-3): the
// editor half. Asserted by what the member SEES and by what reaches the door:
//   - "Suggest values" appears only when writing help is on AND there is an
//     empty member-set property to fill;
//   - suggestions render labelled as Compass's, with the note's own words as
//     evidence, and "Nothing is saved until you accept a value";
//   - ⛔ NOTHING IS WRITTEN until the member accepts ONE suggestion, and then
//     exactly that one property goes through the property door (`updateNote`);
//   - Dismiss writes nothing; a failure says the server's sentence.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let notePropsResult
const updateNoteSpy = vi.fn(() => Promise.resolve({}))
const refreshSpy = vi.fn(() => Promise.resolve())

vi.mock('../../hooks/useNoteProperties', () => ({ default: () => notePropsResult }))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({ default: () => ({ propertyDefs: [], create: vi.fn() }) }))

import PropertiesSection from './PropertiesSection'

const OPTS = [{ id: 'watching', label: 'Watching' }, { id: 'active', label: 'Active' }]
const PROPS = [
  { id: 'builtin:ticker', name: 'Ticker', type: 'text', source: 'financial_derived', value: 'NVDA' },
  { id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set', value: null, options: OPTS },
  { id: 'builtin:review_date', name: 'Review Date', type: 'date', source: 'user_set', value: null },
]
const SUGGESTIONS = [
  { propertyId: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', value: 'active',
    display: 'Active', evidence: 'Long NVDA into earnings', source: 'compass' },
  { propertyId: 'builtin:review_date', name: 'Review Date', type: 'date', value: '2026-10-14',
    display: '2026-10-14', evidence: 'earnings on 2026-10-14', source: 'compass' },
]

let fetchMock
beforeEach(() => {
  updateNoteSpy.mockClear()
  refreshSpy.mockClear()
  notePropsResult = { properties: PROPS, isLoading: false, refresh: refreshSpy }
  fetchMock = vi.fn(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({ suggestions: SUGGESTIONS, model: 'claude-sonnet-5', source: 'compass' }),
  }))
  global.fetch = fetchMock
})
afterEach(() => { vi.restoreAllMocks() })

const writes = () => fetchMock.mock.calls.filter(([, o]) => ['PUT', 'PATCH', 'DELETE'].includes(o?.method))

async function openSuggestions() {
  render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} autofillOn />)
  fireEvent.click(screen.getByRole('button', { name: 'Suggest values with Compass' }))
  return screen.findByRole('region', { name: 'Suggested values' })
}

describe('PropertiesSection — Suggest values (wave 10, G-165)', () => {
  it('is offered only when writing help is on AND an empty member-set property exists', () => {
    const { unmount } = render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    expect(screen.queryByRole('button', { name: 'Suggest values with Compass' })).toBeNull()
    unmount()
    notePropsResult = { properties: [PROPS[0], { ...PROPS[1], value: 'active' }], isLoading: false, refresh: refreshSpy }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} autofillOn />)
    expect(screen.queryByRole('button', { name: 'Suggest values with Compass' })).toBeNull()
  })

  it('asks the autofill route, and shows each suggestion labelled as Compass\'s, with its evidence', async () => {
    const panel = await openSuggestions()
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/j2/notes/n1/writing-help/autofill')
    expect(opts.method).toBe('POST')
    expect(within(panel).getByText('Suggested by Compass from this note · claude-sonnet-5')).toBeTruthy()
    expect(within(panel).getByText('Nothing is saved until you accept a value.')).toBeTruthy()
    const row = panel.querySelector('[data-suggestion="builtin:thesis_status"]')
    expect(within(row).getByText('Thesis Status')).toBeTruthy()
    expect(within(row).getByText('Active')).toBeTruthy()
    expect(within(row).getByText('Long NVDA into earnings')).toBeTruthy()
  })

  it('⛔ writes NOTHING until the member accepts — then exactly ONE property, through the door', async () => {
    const panel = await openSuggestions()
    expect(updateNoteSpy).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept Thesis Status: Active' }))
    await waitFor(() => expect(updateNoteSpy).toHaveBeenCalledTimes(1))
    expect(updateNoteSpy).toHaveBeenCalledWith({ properties: { 'builtin:thesis_status': 'active' } })
    // the accepted one leaves the list; the other is still only a suggestion
    await waitFor(() => expect(panel.querySelector('[data-suggestion="builtin:thesis_status"]')).toBeNull())
    expect(panel.querySelector('[data-suggestion="builtin:review_date"]')).toBeTruthy()
    // and this component itself never PUT anything: the write is the door's
    expect(writes()).toEqual([])
  })

  it('Dismiss writes nothing, and the last one handled closes the panel', async () => {
    const panel = await openSuggestions()
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss Thesis Status' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss Review Date' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Suggested values' })).toBeNull())
    expect(updateNoteSpy).not.toHaveBeenCalled()
  })

  it('a save that fails keeps the suggestion on screen with the door\'s error', async () => {
    updateNoteSpy.mockImplementationOnce(() => Promise.reject(new Error('note changed - refresh and retry')))
    const panel = await openSuggestions()
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept Review Date: 2026-10-14' }))
    expect(await screen.findByText('note changed - refresh and retry')).toBeTruthy()
    expect(panel.querySelector('[data-suggestion="builtin:review_date"]')).toBeTruthy()
  })

  it('an empty answer says so; a refusal says the server\'s sentence', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ suggestions: [], model: 'm' }) }))
    const panel = await openSuggestions()
    expect(within(panel).getByText('Compass found nothing in this note to fill in.')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    fetchMock.mockImplementationOnce(() => Promise.resolve({
      ok: false, status: 429, json: () => Promise.resolve({ detail: "You've used today's writing help — it resets at midnight ET" }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest values with Compass' }))
    expect(await screen.findByText("You've used today's writing help — it resets at midnight ET")).toBeTruthy()
    expect(updateNoteSpy).not.toHaveBeenCalled()
  })

  // review M-2: a suggestion only ever fills an EMPTY property, so Accept asks
  // again at ACCEPT time. Two ways the value arrives while the panel is open.
  it('⛔ Accept writes nothing when ANOTHER TAB set the property after Suggest -- and says so', async () => {
    const panel = await openSuggestions()
    const filled = PROPS.map((p) => (p.id === 'builtin:thesis_status' ? { ...p, value: 'watching' } : p))
    refreshSpy.mockImplementationOnce(() => Promise.resolve({ properties: filled }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept Thesis Status: Active' }))
    expect(await screen.findByText('Thesis Status already has a value, so the suggestion was not applied.')).toBeTruthy()
    expect(updateNoteSpy).not.toHaveBeenCalled()
    expect(panel.querySelector('[data-suggestion="builtin:thesis_status"]')).toBeNull()
    expect(panel.querySelector('[data-suggestion="builtin:review_date"]')).toBeTruthy()
  })

  it('⛔ Accept writes nothing when the member set the property BY HAND after Suggest', async () => {
    const { rerender } = render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} autofillOn />)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest values with Compass' }))
    const panel = await screen.findByRole('region', { name: 'Suggested values' })
    // the member's own save lands and the section re-reads it
    notePropsResult = {
      properties: PROPS.map((p) => (p.id === 'builtin:review_date' ? { ...p, value: '2026-11-02' } : p)),
      isLoading: false, refresh: refreshSpy,
    }
    rerender(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} autofillOn />)
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept Review Date: 2026-10-14' }))
    expect(await screen.findByText('Review Date already has a value, so the suggestion was not applied.')).toBeTruthy()
    expect(updateNoteSpy).not.toHaveBeenCalled()
  })

  // review M-4: the editor passes autofillOn=false for a locked or unreadable
  // note; the PANEL goes with the button, so no Accept outlives the lock.
  it('autofillOn turning off (the note was locked) removes the open panel and every Accept', async () => {
    const { rerender } = render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} autofillOn />)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest values with Compass' }))
    await screen.findByRole('region', { name: 'Suggested values' })
    rerender(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} autofillOn={false} />)
    expect(screen.queryByRole('region', { name: 'Suggested values' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Accept / })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Suggest values with Compass' })).toBeNull()
    expect(updateNoteSpy).not.toHaveBeenCalled()
  })

  it('the client module makes ONE request, to the autofill route, and it is not a write', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/lib/propertyAutofill.js'), 'utf8')
    const fetches = [...src.matchAll(/fetch\(\s*`([^`]+)`/g)].map((m) => m[1])
    expect(fetches).toEqual(['/api/j2/notes/${encodeURIComponent(noteId)}/writing-help/autofill'])
    expect(src).not.toMatch(/method:\s*'(PUT|PATCH|DELETE)'/)
  })
})

// ⭐ Wave 10 (10D, R-16): an ACCEPTED suggestion is writing help that reached the note —
// counted as `writing_help_used {action: autofill}`, with no property, value or evidence.
// A dismissal and a failed save count nothing.
describe('writing_help_used — an accepted autofill counts itself, and nothing it filled in', () => {
  const telemetry = () => fetchMock.mock.calls
    .filter(([u]) => u === '/api/j2/telemetry')
    .map(([, init]) => JSON.parse(init.body))

  it('Accept sends ONE writing_help_used {autofill, property}', async () => {
    const panel = await openSuggestions()
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept Thesis Status: Active' }))
    await waitFor(() => expect(telemetry()).toHaveLength(1))
    expect(telemetry()).toEqual([
      { event: 'writing_help_used', props: { action: 'autofill', scope: 'property', replaced: false } },
    ])
    expect(JSON.stringify(telemetry())).not.toMatch(/Thesis|active|NVDA|thesis_status/)
  })

  it('Dismiss and a failed save send nothing', async () => {
    updateNoteSpy.mockImplementationOnce(() => Promise.reject(new Error('note changed - refresh and retry')))
    const panel = await openSuggestions()
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept Review Date: 2026-10-14' }))
    expect(await screen.findByText('note changed - refresh and retry')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss Thesis Status' }))
    expect(telemetry()).toEqual([])
  })
})
