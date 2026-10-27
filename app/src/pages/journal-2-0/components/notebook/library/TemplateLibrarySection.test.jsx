// Task 11.16: the Template library section and the library cards' facts.
//
// A fake server answers the routes Task 11.12 will mount, in the plan's shapes (`GET /library` -> `{templates: [row]}`,
// each row the gallery `_summary` plus `group`, `contains`, `inYourTemplates`), and records every request, so a test
// that asks the wrong route, or asks for a preview with the member's data from a LIST, cannot pass on rendering alone.
// ⛔ Feedback is asserted by RENDERED TEXT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TemplateLibrarySection, { IN_YOURS, SECTION_TITLE } from './TemplateLibrarySection'
import LibraryCardFacts, { FILLS_SENTENCE, containsWords, updatedWords, usedByWords } from './LibraryCardFacts'
import { FAMILY_CATEGORIES, FAMILY_GROUPS, LIBRARY_GROUPS, familyKeeps } from '../../../lib/templateLibrary'
import { FAMILIES } from '../../../lib/notebookTemplates'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The server's gallery categories, parsed from template_gallery.py (never retyped here). */
function serverCategories() {
  const src = readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'template_gallery.py'), 'utf8')
  const m = /^CATEGORIES\s*=\s*\(([^)]*)\)/m.exec(src)
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : []
}

/** Merge step M4: the server's library groups, parsed from template_library.py's GROUPS tuple (never retyped). */
function serverGroups() {
  const src = readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'template_library.py'), 'utf8')
  const m = /^GROUPS\s*=\s*\((.*)\)\s*$/m.exec(src)
  return m ? [...m[1].matchAll(/\("([a-z_]+)",\s*"([^"]+)"\)/g)].map((x) => ({ key: x[1], label: x[2] })) : []
}

/** Merge step M3: the shipped official seed's live rows (Task 11.10), read from the JSON file (never retyped). */
function seedRows() {
  const src = readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'template_library_seed.json'), 'utf8')
  return JSON.parse(src).templates
}

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))

const row = (o) => ({
  title: 'Untitled', description: '', category: 'journal', author: 'UCT', firm: false, featured: true,
  itemType: 'style', usedBy: 0, helpfulCount: 0, updatedAt: '2026-10-03T14:00:00', contains: [],
  inYourTemplates: false, ...o,
})
// Deliberately NOT in group order: the section draws the groups in LIBRARY_GROUPS order, never the answer's.
const LIB = [
  row({ id: 'g-recap', title: 'Daily recap', group: 'after_close', description: 'closing the trading day',
    contains: ['P&L by setup', 'Win rate', 'Daily review', 'Mood', 'Focus', 'Rules kept'], usedBy: 12, helpfulCount: 3 }),
  row({ id: 'g-night', title: 'Night-before prep', group: 'night_before', description: 'planning tomorrow',
    contains: ['Watchlist routine'], usedBy: 1, inYourTemplates: true }),
  row({ id: 'g-open', title: 'Pre-market prep', group: 'before_open', description: 'the hour before the bell',
    contains: ['Gap scan', 'Levels'], category: 'trade_plan' }),
  row({ id: 'g-mind', title: 'Calm under fire', group: 'mindset', description: 'a reset after a loss' }),
]

let calls
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
function installServer({ library = LIB, status = 200 } = {}) {
  calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    calls.push({ path: u.pathname, method })
    if (u.pathname === '/api/j2/template-gallery/library' && method === 'GET') {
      return status === 200 ? json(200, { templates: library }) : json(status, {})
    }
    if (u.pathname.endsWith('/preview-mine')) return json(200, { slots: [], cards: [], tools: [], questions: [] })
    const m = u.pathname.match(/^\/api\/j2\/template-gallery\/([^/]+)$/)
    if (m && method === 'GET') return json(200, { template: { id: m[1], bodyJson: { type: 'doc', content: [] } } })
    return json(404, {})
  })
}

beforeEach(() => installServer())
afterEach(cleanup)

const card = (id) => document.querySelector(`[data-library-card="${id}"]`)
async function mount(props = {}) {
  render(<TemplateLibrarySection {...props} />)
  await screen.findByRole('heading', { name: SECTION_TITLE })
  await waitFor(() => expect(document.querySelectorAll('[data-library-card]').length).toBeGreaterThan(0))
}

describe('the library card facts', () => {
  it('card_fields_and_new_instead_of_zero', async () => {
    await mount()
    const recap = card('g-recap')
    // A card's title is a heading under its group's h4 (fix round 1 m-3), so heading navigation reaches every template.
    expect(within(recap).getByRole('heading', { level: 5, name: 'Daily recap' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 5 })).toHaveLength(LIB.length)
    expect(within(recap).getByText('Template')).toBeInTheDocument()
    expect(within(recap).getByText('UCT')).toBeInTheDocument()
    expect(within(recap).getByText('For: closing the trading day')).toBeInTheDocument()
    expect(within(recap).getByText('Contains: P&L by setup, Win rate, Daily review, Mood and 2 more')).toBeInTheDocument()
    expect(within(recap).getByText('Used by 12 traders · Updated Oct 3 · 3 found this helpful')).toBeInTheDocument()
    expect(within(recap).getByText(FILLS_SENTENCE)).toBeInTheDocument()
    // An unused item reads "New", and NO card anywhere shows a zero.
    const mind = card('g-mind')
    expect(within(mind).getByText('New · Updated Oct 3')).toBeInTheDocument()
    // A template that holds no widget, routine or tracker has nothing of the member's to fill in.
    expect(within(mind).queryByText(FILLS_SENTENCE)).toBeNull()
    expect(within(card('g-night')).getByText('Used by 1 trader · Updated Oct 3')).toBeInTheDocument()
    const all = document.querySelector('[data-template-library]').textContent
    expect(all).not.toMatch(/\b0\b|\(0\)/)
  })

  it('the words, one rule each (a 0, a negative, a NaN and junk are all "New"; four names, then "and n more")', () => {
    for (const n of [0, -2, NaN, Infinity, '3', null, undefined]) expect(usedByWords(n)).toBe('New')
    expect(usedByWords(2)).toBe('Used by 2 traders')
    expect(containsWords(['A', '', 'B', 7, 'C', 'D', 'E'])).toBe('Contains: A, B, C, D and 1 more')
    expect(containsWords(['A', 'B', 'C', 'D'])).toBe('Contains: A, B, C, D')
    expect(containsWords([])).toBe('')
    // A naive stamp is UTC (W11-R15): 03:30 UTC on Oct 4 is still Oct 3 on the Eastern clock.
    expect(updatedWords('2026-10-04T03:30:00')).toBe('Updated Oct 3')
    expect(updatedWords('2026-10-04T03:30:00Z')).toBe('Updated Oct 3')
    expect(updatedWords('2026-10-04')).toBe('Updated Oct 4')
    expect(updatedWords('not a day')).toBe('')
  })

  it('a credit is the server\'s own line, drawn as it came; a type chip names each listed type', () => {
    const credit = "Based on Alice Trader's Breakout checklist"
    const { container } = render(
      <ul>
        <li><LibraryCardFacts item={row({ id: 'a', credit, itemType: 'widget_definition' })} /></li>
        <li><LibraryCardFacts item={row({ id: 'b', itemType: 'routine' })} /></li>
        <li><LibraryCardFacts item={row({ id: 'c', itemType: 'tracker' })} /></li>
      </ul>,
    )
    expect(container.querySelector('[data-credit]').textContent).toBe(credit)
    expect([...container.querySelectorAll('[data-type-chip]')].map((n) => n.textContent)).toEqual(['Widget', 'Routine', 'Tracker'])
  })

  it('list_cards_never_call_preview_mine (a fetch spy over the list, the badge and the chips)', async () => {
    await mount()
    expect(calls).toEqual([{ path: '/api/j2/template-gallery/library', method: 'GET' }])
    expect(within(card('g-night')).getByText(IN_YOURS)).toBeInTheDocument()
    expect(within(card('g-recap')).queryByText(IN_YOURS)).toBeNull()
    // CONTROL: the spy does see a preview with the member's data, once a card's Preview opens the detail.
    await userEvent.setup().click(within(card('g-recap')).getByRole('button', { name: /^Preview Daily recap/ }))
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/preview-mine'))).toHaveLength(1))
    expect(calls.find((c) => c.path.endsWith('/preview-mine')).path).toBe('/api/j2/template-gallery/g-recap/preview-mine')
  })
})

describe('the Template library section', () => {
  it('groups_in_order_and_search_matches_contains', async () => {
    await mount()
    const order = [...document.querySelectorAll('[data-library-group]')].map((g) => g.getAttribute('data-library-group'))
    expect(order).toEqual(LIBRARY_GROUPS.map((g) => g.key).filter((k) => LIB.some((r) => r.group === k)))
    expect(order).toEqual(['night_before', 'before_open', 'after_close', 'mindset'])
    // Each group is a row named by its label.
    expect(screen.getByRole('list', { name: 'The night before' })).toContainElement(card('g-night'))
    cleanup()

    // A search matches what a template CONTAINS (lower-cased, as the picker hands it), not only its title.
    await mount({ query: 'gap scan' })
    expect([...document.querySelectorAll('[data-library-card]')].map((c) => c.getAttribute('data-library-card'))).toEqual(['g-open'])
    cleanup()
    await mount({ query: 'reset after' })
    expect([...document.querySelectorAll('[data-library-card]')].map((c) => c.getAttribute('data-library-card'))).toEqual(['g-mind'])
  })

  it("FAMILY_CATEGORIES is one mapping over the real chips and the server's real categories", () => {
    const cats = serverCategories()
    expect(cats.length).toBeGreaterThan(3)                                   // non-vacuity: the tuple was read
    expect(Object.keys(FAMILY_CATEGORIES).sort()).toEqual(FAMILIES.map((f) => f.key).sort())
    for (const list of Object.values(FAMILY_CATEGORIES)) for (const c of list) expect(cats).toContain(c)
    // Every category the server can send is reached by exactly ONE chip: no listed template is unreachable, and
    // no two chips share a category (merge step M3: rituals and mind both named journal).
    for (const c of cats) expect(Object.values(FAMILY_CATEGORIES).filter((l) => l.includes(c)).length, c).toBe(1)
    // FAMILY_GROUPS names real chips and real library groups.
    const groupKeys = LIBRARY_GROUPS.map((g) => g.key)
    for (const [fam, list] of Object.entries(FAMILY_GROUPS)) {
      expect(FAMILIES.map((f) => f.key), fam).toContain(fam)
      for (const g of list) expect(groupKeys, g).toContain(g)
    }
  })

  it("LIBRARY_GROUPS is the server's template_library.GROUPS, key for key and word for word (M4)", () => {
    const server = serverGroups()
    expect(server.length).toBeGreaterThan(5)                                 // non-vacuity: the tuple was read
    expect(LIBRARY_GROUPS.map((g) => ({ key: g.key, label: g.label }))).toEqual(server)
  })

  it('every picker chip keeps at least one row of the shipped official seed, and every seed row has a chip (M3)', () => {
    const seed = seedRows()
    expect(seed.length).toBeGreaterThan(20)                                  // non-vacuity: the seed was read
    for (const fam of FAMILIES) expect(seed.filter((r) => familyKeeps(fam.key, r)).length, fam.key).toBeGreaterThan(0)
    for (const r of seed) expect(FAMILIES.some((f) => familyKeeps(f.key, r)), r.title).toBe(true)
    // The Mindset chip keeps the library's Mindset group (its seed row is a research row by category).
    expect(seed.filter((r) => familyKeeps('mind', r)).map((r) => r.group)).toEqual(seed.filter((r) => r.group === 'mindset').map(() => 'mindset'))
  })

  it('every picker chip shows the library rows of its mapped categories and groups (what the server sends)', async () => {
    const cats = serverCategories()
    // One row per server category, each in a group no chip maps (so a category match is the only way in), plus one
    // row per library group in a category no chip maps (so a group match is the only way in).
    const mapped = new Set(Object.values(FAMILY_GROUPS).flat())
    const plain = LIBRARY_GROUPS.find((g) => !mapped.has(g.key)).key
    const rows = [
      ...cats.map((c, i) => row({ id: `g-${c}`, title: `Template ${i}`, group: plain, category: c })),
      ...LIBRARY_GROUPS.map((g, i) => row({ id: `gr-${g.key}`, title: `Grouped ${i}`, group: g.key, category: 'zz_unmapped' })),
    ]
    for (const fam of FAMILIES) {
      installServer({ library: rows })
      await mount({ category: fam.key })
      const shown = [...document.querySelectorAll('[data-library-card]')].map((c) => c.getAttribute('data-library-card')).sort()
      const want = rows.filter((r) => FAMILY_CATEGORIES[fam.key].includes(r.category)
        || (FAMILY_GROUPS[fam.key] || []).includes(r.group)).map((r) => r.id).sort()
      expect(want.length, fam.key).toBeGreaterThan(0)                        // each chip keeps something
      expect(shown, fam.key).toEqual(want)
      cleanup()
    }
    installServer()
    render(<TemplateLibrarySection category="member" />)
    await waitFor(() => expect(calls.length).toBe(1))
    expect(screen.queryByRole('heading', { name: SECTION_TITLE })).toBeNull()
  })

  it('onMatches reports how many templates the section shows (0 with none, 0 on the "Your templates" chip)', async () => {
    const seen = []
    const onMatches = (n) => seen.push(n)
    const { rerender } = render(<TemplateLibrarySection onMatches={onMatches} query="gap scan" />)
    await waitFor(() => expect(seen.at(-1)).toBe(1))
    rerender(<TemplateLibrarySection onMatches={onMatches} query="" />)
    await waitFor(() => expect(seen.at(-1)).toBe(LIB.length))
    rerender(<TemplateLibrarySection onMatches={onMatches} query="" category="member" />)
    await waitFor(() => expect(seen.at(-1)).toBe(0))
  })

  it('a search that matches nothing shows no section (the picker says "no match"); a dark route shows none', async () => {
    render(<TemplateLibrarySection query="zzzz no such thing" />)
    await waitFor(() => expect(calls.length).toBe(1))
    expect(screen.queryByRole('heading', { name: SECTION_TITLE })).toBeNull()
    cleanup()
    installServer({ status: 404 })
    render(<TemplateLibrarySection />)
    await waitFor(() => expect(calls.length).toBe(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-template-library]')).toBeNull()
  })

  it('another refusal is a sentence on screen, never silence', async () => {
    installServer({ status: 500 })
    render(<TemplateLibrarySection />)
    expect(await screen.findByText("That didn't go through. Try again.")).toBeInTheDocument()
  })
})
