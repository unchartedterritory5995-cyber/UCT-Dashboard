// Audit 2026-11-05, spec S9 (M8): a Template library "Use" makes the note in ONE press.
//
// A fake server answers the library, preview-mine and use-template routes and records every request, so a test that
// opens a second sheet, makes a copy through Adopt, or starts a routine nobody asked for cannot pass on rendering alone.
//   * Use: exactly ONE use-template, no adopt / adopt-tool, the note titled "{Template} · {Ddd, Mon D}", every reuse
//     question answered "not now" (`{skip: true}`: nothing is made), the note landed through the host;
//   * ticked "Also start this every weekday": the same Use answers `{create: true}` (one routine, server-side);
//   * the member's own routine is used when the server found one, ticked or not;
//   * a choice the server cannot answer opens Customize first instead of guessing;
//   * "Customize first" opens the adoption sheet, titled "Customize", with the template's name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TemplateLibrarySection, { SECTION_TITLE } from './TemplateLibrarySection'
import { CUSTOMIZE_LABEL, START_LABEL, USE_LABEL } from './libraryUse'
import { CUSTOMIZE_FIRST, START_EVERY_WEEKDAY, templateNoteTitle, questionChoice } from './oneStepUse'
import { TITLE as CUSTOMIZE_TITLE } from './AdoptSheet'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('./openAdoptSheet', () => ({ openAdoptSheet: vi.fn() }))
const { openAdoptSheet } = await import('./openAdoptSheet')

const row = (o) => ({
  title: 'Untitled', description: '', category: 'journal', author: 'UCT', firm: false, featured: true,
  itemType: 'style', usedBy: 0, helpfulCount: 0, updatedAt: '2026-10-03T14:00:00', contains: [],
  inYourTemplates: false, group: 'before_open', ...o,
})
const LIB = [row({ id: 'g-open', title: 'Pre-market plan' })]
const NOTE = { id: 'n-1', title: 'Pre-market plan · Thu, Nov 5' }

let calls
let preview
let hold = null   // a promise the fake server waits on before answering a Use (the double-press rail)
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
function installServer() {
  calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    calls.push({ path: u.pathname, method, body: init.body ? JSON.parse(init.body) : null })
    if (u.pathname === '/api/j2/template-gallery/library' && method === 'GET') return json(200, { templates: LIB })
    if (u.pathname.endsWith('/preview-mine')) return json(200, preview)
    if (u.pathname.endsWith('/use-template') && method === 'POST') {
      if (hold) await hold
      return json(200, { note: NOTE, skipped: [], style: { id: 's-1' }, credit: '', created: {}, reused: {} })
    }
    return json(404, {})
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))   // Thu, Nov 5 in New York
  preview = { slots: [], cards: [], tools: [], questions: [{ slot: 'routine_a', kind: 'routine', createName: 'Night-before prep' }] }
  installServer()
  openAdoptSheet.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

async function mount(props = {}) {
  render(<TemplateLibrarySection {...props} />)
  await screen.findByRole('heading', { name: SECTION_TITLE })
  await waitFor(() => expect(document.querySelector('[data-library-card="g-open"]')).not.toBeNull())
}
const writes = () => calls.filter((c) => c.method === 'POST' && !c.path.endsWith('/preview-mine'))

describe('one-step Use (S9)', () => {
  it('Use makes exactly one note, titled, with no routine and no second sheet, and lands it', async () => {
    const landNote = vi.fn()
    await mount({ landNote })
    await userEvent.setup().click(screen.getByRole('button', { name: `${USE_LABEL} Pre-market plan` }))
    await waitFor(() => expect(landNote).toHaveBeenCalledTimes(1))
    expect(landNote).toHaveBeenCalledWith(NOTE)
    // ONE write: the use. No adopt (a copy of its own), no adopt-tool, no second sheet.
    expect(writes().map((c) => c.path)).toEqual(['/api/j2/template-gallery/g-open/use-template'])
    const [use] = writes()
    expect(use.body.title).toBe('Pre-market plan · Thu, Nov 5')
    expect(use.body.choices).toEqual({ routine_a: { skip: true } })   // zero routines: nothing is made
    expect(openAdoptSheet).not.toHaveBeenCalled()
  })

  it('the checkbox is unticked by default; ticked, the Use starts the routine (create)', async () => {
    await mount({ landNote: vi.fn() })
    const box = screen.getByRole('checkbox', { name: START_LABEL })
    expect(box.checked).toBe(false)
    const user = userEvent.setup()
    await user.click(box)
    await user.click(screen.getByRole('button', { name: `${USE_LABEL} Pre-market plan` }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body.choices).toEqual({ routine_a: { create: true } })
  })

  it("the member's own routine is used when the server found one, ticked or not", async () => {
    preview = { ...preview, questions: [{ slot: 'routine_a', kind: 'routine', use: { id: 'r-9', name: 'Mine' } }] }
    await mount({ landNote: vi.fn() })
    await userEvent.setup().click(screen.getByRole('button', { name: `${USE_LABEL} Pre-market plan` }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body.choices).toEqual({ routine_a: { use: 'r-9' } })
    expect(questionChoice({ use: { id: 'r-9' } }, true)).toEqual({ use: 'r-9' })
  })

  it('the server\'s first answers are sent as they came', async () => {
    preview = { ...preview, slots: [{ id: 'p1', label: 'Setup', type: 'setup', value: 'Flag' }] }
    await mount({ landNote: vi.fn() })
    await userEvent.setup().click(screen.getByRole('button', { name: `${USE_LABEL} Pre-market plan` }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body.answers).toEqual({ p1: 'Flag' })
  })

  it('a choice the server cannot answer opens Customize first instead of guessing (nothing written)', async () => {
    preview = { ...preview, slots: [{ id: 'p1', label: 'Setup', type: 'setup', value: null, any: false }] }
    await mount({ landNote: vi.fn() })
    await userEvent.setup().click(screen.getByRole('button', { name: `${USE_LABEL} Pre-market plan` }))
    await waitFor(() => expect(openAdoptSheet).toHaveBeenCalledTimes(1))
    expect(writes()).toEqual([])
    expect(openAdoptSheet.mock.calls[0][0]).toMatchObject({ galleryId: 'g-open', kind: 'template', name: 'Pre-market plan' })
  })

  it('"Customize first" opens the adoption sheet for the template, and writes nothing', async () => {
    await mount({ landNote: vi.fn() })
    const c = within(document.querySelector('[data-library-card="g-open"]'))
    await userEvent.setup().click(c.getByRole('button', { name: `${CUSTOMIZE_LABEL}: Pre-market plan` }))
    await waitFor(() => expect(openAdoptSheet).toHaveBeenCalledTimes(1))
    expect(calls.filter((x) => x.method === 'POST')).toEqual([])
    expect(CUSTOMIZE_TITLE).toBe('Customize')
  })

  it('a double press makes one note', async () => {
    const landNote = vi.fn()
    await mount({ landNote })
    const user = userEvent.setup()
    const use = screen.getByRole('button', { name: `${USE_LABEL} Pre-market plan` })
    // Fix round 2: the first Use is held IN FLIGHT while the second press lands, so the rail tests a double press and
    // not two presses that happen to run one after the other on a slow machine.
    let release
    hold = new Promise((r) => { release = r })
    try {
      await user.click(use)
      await user.click(use)
      release()
      await waitFor(() => expect(landNote).toHaveBeenCalled())
      expect(writes()).toHaveLength(1)
    } finally {
      hold = null
    }
  })
})

describe('the words', () => {
  it('the title is "{Template} · {Ddd, Mon D}" in New York', () => {
    expect(templateNoteTitle('Pre-market plan', new Date('2026-11-05T15:00:00Z'))).toBe('Pre-market plan · Thu, Nov 5')
    // 01:00 UTC on Nov 6 is still Nov 5 on the Eastern clock.
    expect(templateNoteTitle('Daily prep', new Date('2026-11-06T01:00:00Z'))).toBe('Daily prep · Thu, Nov 5')
    expect(templateNoteTitle('  ', new Date('2026-11-05T15:00:00Z'))).toBe('Thu, Nov 5')
  })
  it('the section restates the one-step module\'s words exactly', () => {
    expect(CUSTOMIZE_LABEL).toBe(CUSTOMIZE_FIRST)
    expect(START_LABEL).toBe(START_EVERY_WEEKDAY)
    expect(START_LABEL).toBe('Also start this every weekday')
  })
})
