// Finish program, lane FE2 (after lane DATA2's server halves were merged in): the surfaces show
// the SERVER'S OWN sentence for what is unavailable, read from the payload.
//
//   review draft      `disciplineOmitted`  {reason, sentence}   in place of the discipline section
//   setups board      `planDrawing`        {available, reason, sentence}   in the empty state
//   find similar      status "example" + `neverMatched` {reason, sentence}
//   sample removal    `foldersKept`        [{name, memberNotes, sentence}]   in the confirmation
//
// Every payload here starts from a recorded contract fixture (`__fixtures__/contract`, written
// by tools/notebook_contract_fixtures.py). The fixtures were recorded with the switches ON, so
// the "off" cases set only the fields lane DATA2's record names for that state
// (docs/notebook/fin-data2.md), on top of the recorded body.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { contractBody } from './__fixtures__/contract'
import { latchNotebookFlags, __resetNotebookFlags } from './lib/offline/notebookFlags'
import { buildDraftBlocks } from './lib/reviewDrafts'
import { emptyBoardText } from './components/notebook/SetupsBoard'
import BoardCard from './components/notebook/BoardCard'
import SimilarNames from './components/notebook/SimilarNames'
import { removeSampleNotebook, removedMessage, SAMPLE_COPY } from './components/notebook/onboarding/sampleNotebook'

vi.mock('../../components/StockChart', () => ({ default: () => null }))

const wrap = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter>{children}</MemoryRouter>
  </SWRConfig>
)
const realFetch = global.fetch
beforeEach(() => { __resetNotebookFlags() })
afterEach(() => { __resetNotebookFlags(); global.fetch = realFetch; vi.restoreAllMocks() })
const answer = (body) => vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body }))

describe('the recorded answers carry the new fields (so these tests read real shapes)', () => {
  it('review draft, setups board, find similar', () => {
    expect(contractBody('review-drafts.daily')).toHaveProperty('disciplineOmitted', null)
    expect(contractBody('setups-board.empty').planDrawing).toEqual({ available: true, reason: null, sentence: null })
    expect(contractBody('setups-board.forty').cards[0]).toHaveProperty('similarNeverMatched', false)
    expect(contractBody('similar-names.matches')).toHaveProperty('neverMatched', null)
    expect(contractBody('similar-names.matches').template.example).toBe(false)
  })
})

describe('review draft: the server’s sentence stands where the discipline section would be', () => {
  const OFF = { reason: 'plan_grading_off', sentence: 'Plan grading is switched off, so this draft has no discipline record.' }
  it('with `disciplineOmitted`, the draft prints that sentence under the Discipline record heading', () => {
    const payload = { ...contractBody('review-drafts.daily'), discipline: null, disciplineOmitted: OFF }
    const t = JSON.stringify(buildDraftBlocks(payload))
    expect(t).toContain('Discipline record')
    expect(t).toContain(OFF.sentence)
    expect(t).not.toContain('Plan rate:')
  })

  it('the recorded draft (plan grading on) has the real section and no such sentence', () => {
    const t = JSON.stringify(buildDraftBlocks(contractBody('review-drafts.daily')))
    expect(t).toContain('Plan rate:')
    expect(t).not.toContain('switched off')
  })

  it('an older answer with no `disciplineOmitted` still says why, in the client’s own words', () => {
    const payload = { ...contractBody('review-drafts.daily'), discipline: null }
    delete payload.disciplineOmitted
    expect(JSON.stringify(buildDraftBlocks(payload))).toContain('Not in this draft.')
  })
})

describe('setups board: the empty state reads `planDrawing`', () => {
  const OFF = { available: false, reason: 'chart_plan_off', sentence: 'Drawing a plan on a chart is switched off, so no new setup can be added here yet.' }
  it('unavailable: the server’s sentence, and no step the member cannot take', () => {
    const t = emptyBoardText({ planDrawing: OFF, chartPlanOn: true })
    expect(t).toBe(`No open setups yet. ${OFF.sentence}`)
    expect(t).not.toMatch(/Draw an entry line/)
  })
  it('available (the recorded answer): how to make a setup', () => {
    const t = emptyBoardText({ planDrawing: contractBody('setups-board.empty').planDrawing, chartPlanOn: false })
    expect(t).toMatch(/Draw an entry line on a chart in a plan note/)
  })
  it('no `planDrawing` at all (an older answer): the client’s own flag decides', () => {
    expect(emptyBoardText({ chartPlanOn: false })).not.toMatch(/Draw an entry line/)
    expect(emptyBoardText({ chartPlanOn: true })).toMatch(/Draw an entry line/)
  })
})

describe('find similar: an example is never matched, and says so in the server’s words', () => {
  const NEVER = { reason: 'sample_example', sentence: 'This chart is an example, so it is never matched. Tag a chart of your own to find names like it.' }
  const exampleAnswer = () => {
    const base = contractBody('similar-names.matches')
    return { ...base, status: 'example', matches: [], asOf: null, template: { ...base.template, example: true }, neverMatched: NEVER }
  }

  it('status "example": the sheet shows the `neverMatched` sentence (it used to show nothing)', async () => {
    latchNotebookFlags({ notebook_find_similar_enabled: true })
    global.fetch = answer(exampleAnswer())
    render(<SimilarNames noteId="n1" embedKey="ex-plan" />, { wrapper: wrap })
    expect(await screen.findByText(NEVER.sentence)).toBeInTheDocument()
    expect(screen.queryByText(/matched tonight/)).toBeNull()
  })

  it('CONTROL — the recorded answer for the member’s own chart lists its matches and no such sentence', async () => {
    latchNotebookFlags({ notebook_find_similar_enabled: true })
    const body = contractBody('similar-names.matches')
    global.fetch = answer(body)
    render(<SimilarNames noteId="n1" embedKey="e1" />, { wrapper: wrap })
    expect(await screen.findByText(new RegExp(body.matches[0].symbol))).toBeInTheDocument()
    expect(screen.queryByText(/is an example/)).toBeNull()
  })

  it('a board card with `similarNeverMatched` does not offer the door; the recorded card does', () => {
    const card = contractBody('setups-board.forty').cards.find((c) => c.similarEmbedKey)
    const first = render(<ul><BoardCard card={{ ...card, similarNeverMatched: true }} mounted={false} onBarsReady={() => {}} onFindSimilar={vi.fn()} /></ul>, { wrapper: wrap })
    expect(screen.queryByRole('button', { name: `Find more like ${card.symbol}` })).toBeNull()
    expect(screen.getByText('Examples are not matched against the day’s names.')).toBeInTheDocument()
    first.unmount()
    render(<ul><BoardCard card={card} mounted={false} onBarsReady={() => {}} onFindSimilar={vi.fn()} /></ul>, { wrapper: wrap })
    expect(screen.getByRole('button', { name: `Find more like ${card.symbol}` })).toBeInTheDocument()
  })
})

describe('sample removal: a folder that stayed says why', () => {
  const KEPT = [{ id: 'f2', name: 'Capability examples', memberNotes: 1, sentence: 'The folder "Capability examples" has 1 note of yours in it, so it was kept.' }]
  it('the removal call hands back what was kept', async () => {
    global.fetch = answer({ trashed: ['a', 'b'], foldersRemoved: [{ id: 'f1', name: 'Sample notebook' }], foldersKept: KEPT })
    const out = await removeSampleNotebook()
    expect(out).toMatchObject({ ok: true, trashed: ['a', 'b'], foldersKept: KEPT })
  })
  it('the confirmation carries each kept folder’s sentence after the usual one', () => {
    expect(removedMessage({ foldersKept: KEPT })).toBe(`${SAMPLE_COPY.removed} ${KEPT[0].sentence}`)
  })
  it('the RECORDED answers: nothing kept is the usual sentence; two kept folders add their two sentences', () => {
    expect(removedMessage(contractBody('sample-notebook.remove'))).toBe(SAMPLE_COPY.removed)
    const kept = contractBody('sample-notebook.remove.folder-kept')
    expect(kept.foldersKept).toHaveLength(2)
    expect(removedMessage(kept)).toBe([SAMPLE_COPY.removed, ...kept.foldersKept.map((f) => f.sentence)].join(' '))
  })

  // `foldersOlder` names two different things with one sentence ("An older example folder may
  // remain..."): a folder an old seed made, AND a member's OWN folder the seed reused. Its rows
  // are {id, name, sentence}: nothing in them tells the two apart, and calling a member's own
  // folder "an example folder" is wrong. So the client prints a neutral sentence with the
  // folder's name, never the server's. (No recorded answer has a populated `foldersOlder`: a
  // legacy folder cannot be made through a route. The row below is the recorded answer plus
  // the shape lane DATA2's record gives.)
  it('a folder in `foldersOlder` gets the neutral sentence, never "example folder"', () => {
    const body = { ...contractBody('sample-notebook.remove'), foldersOlder: [{ id: 'f9', name: 'Sample notebook', sentence: 'An older example folder may remain. It was made before folders were marked, so it was left alone. You can delete it by hand.' }] }
    const text = removedMessage(body)
    expect(text).toBe(`${SAMPLE_COPY.removed} The folder "Sample notebook" was left in place.`)
    expect(text).not.toMatch(/example folder/)
  })

  it('kept and older together: each folder is named once', () => {
    const kept = contractBody('sample-notebook.remove.folder-kept')
    const text = removedMessage({ ...kept, foldersOlder: [{ id: 'f9', name: 'My ideas', sentence: 'x' }] })
    expect(text.endsWith('The folder "My ideas" was left in place.')).toBe(true)
    expect(text).toContain(kept.foldersKept[0].sentence)
  })

  it('the removal call hands `foldersOlder` back too', async () => {
    global.fetch = answer({ ...contractBody('sample-notebook.remove'), foldersOlder: [{ id: 'f9', name: 'N', sentence: 's' }] })
    expect((await removeSampleNotebook()).foldersOlder).toEqual([{ id: 'f9', name: 'N', sentence: 's' }])
  })

  it('nothing kept (or an older answer): the usual sentence alone', () => {
    expect(removedMessage({ foldersKept: [] })).toBe(SAMPLE_COPY.removed)
    expect(removedMessage({})).toBe(SAMPLE_COPY.removed)
  })
})
