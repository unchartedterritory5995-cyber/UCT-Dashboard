// TERM-076 (FB-A12-02) — the member-visible statement of what syncs across devices is RENDERED
// FROM the census manifest, never typed.
//
// ⛔ FB-A12-02's own acceptance test: "The published matrix changes when a key's store changes,
// with no content edit." So these cases prove three things about `DeviceSyncCard`:
//
//   1. every row it shows is a manifest entry, and every member-facing manifest entry is a row —
//      compared as an EXACT SET per list, so a hand-typed row is an extra element and goes red;
//   2. moving one key's store in the manifest moves that row to the other list, with no edit to
//      the component;
//   3. the default render IS the checked-in manifest (not a stale copy of it).
//
// The expected sets are computed HERE from the raw manifest entries, independently of the
// component's own grouping helper — a rail that reused the component's derivation would agree
// with any bug in it.
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import DeviceSyncCard from './DeviceSyncCard'
import MANIFEST from '../../lib/persistence/persistenceManifest.json'
import { CEILINGS, LAYOUT_KINDS } from '../../lib/persistence/personalization'
import { layoutAutoSaves } from '../../pages/charts/layoutDockPins'
import { GRID_MAX_CELLS } from '../../pages/charts/grid/gridLayouts'
import { MAX_COMPARISONS, MAX_CHART_TEMPLATES } from '../../components/chart/chartCeilings'

// Everything that follows the ACCOUNT is listed; on the device, caches and diagnostic switches
// are counted rather than listed.
const MEMBER_KINDS = new Set(['setting', 'work', 'state'])
const idOf = (e) => `${e.store}:${e.key}`
const expected = (m, scope) => m.entries
  .filter((e) => e.scope === scope && (scope === 'cross-device' || MEMBER_KINDS.has(e.kind)))
  .map(idOf).sort()

// EVERY list item in a section counts — a hand-typed <li> has no data-persist-id, reads as
// `null`, and breaks the equality below.
const renderedIds = (testId) => within(screen.getByTestId(testId))
  .getAllByRole('listitem')
  .map((li) => li.getAttribute('data-persist-id'))
  .sort()

describe('DeviceSyncCard is rendered from the persistence manifest', () => {
  it('CONTROL: the manifest has rows in both lists (otherwise equality below proves nothing)', () => {
    expect(expected(MANIFEST, 'cross-device').length).toBeGreaterThan(10)
    expect(expected(MANIFEST, 'device-local').length).toBeGreaterThan(10)
  })

  it('shows exactly the member-facing cross-device entries, and nothing else', () => {
    render(<DeviceSyncCard />)
    expect(renderedIds('sync-cross-device')).toEqual(expected(MANIFEST, 'cross-device'))
  })

  it('shows exactly the member-facing device-local entries, and nothing else', () => {
    render(<DeviceSyncCard />)
    expect(renderedIds('sync-device-local')).toEqual(expected(MANIFEST, 'device-local'))
  })

  it('states the spec\'s own example correctly: drawings stay here, chart settings and tracings sync', () => {
    render(<DeviceSyncCard />)
    const local = screen.getByTestId('sync-device-local')
    const cross = screen.getByTestId('sync-cross-device')
    const label = (store, key) => MANIFEST.entries.find((e) => e.store === store && e.key === key).label
    expect(within(local).getByText(label('localStorage', 'uct-chart-drawings'))).toBeTruthy()
    expect(within(cross).getByText(label('server-preference', 'chart_settings'))).toBeTruthy()
    expect(within(cross).getByText(label('server-preference', 'tracings_doc'))).toBeTruthy()
  })

  it('counts caches and diagnostics instead of listing them — the count is derived too', () => {
    render(<DeviceSyncCard />)
    const n = MANIFEST.entries.filter((e) => !MEMBER_KINDS.has(e.kind) && e.scope === 'device-local').length
    expect(screen.getByTestId('sync-background').textContent).toContain(String(n))
  })

  it('moving one key from localStorage to the account preference moves its row — no copy edit', () => {
    const drawings = MANIFEST.entries.find((e) => e.store === 'localStorage' && e.key === 'uct-chart-drawings')
    const moved = {
      ...MANIFEST,
      entries: MANIFEST.entries.map((e) => (e === drawings ? { ...e, store: 'server-preference', scope: 'cross-device' } : e)),
    }
    render(<DeviceSyncCard manifest={moved} />)
    expect(within(screen.getByTestId('sync-cross-device')).getByText(drawings.label)).toBeTruthy()
    expect(within(screen.getByTestId('sync-device-local')).queryByText(drawings.label)).toBeNull()
    expect(renderedIds('sync-cross-device')).toEqual(expected(moved, 'cross-device'))
  })

  it('the default render is the checked-in manifest', () => {
    // Rows + text, not raw HTML: TileCard mints a per-instance id for its aria wiring.
    const rows = (c) => [...c.querySelectorAll('li')].map((li) => `${li.getAttribute('data-persist-id')}=${li.textContent}`)
    const { container: a } = render(<DeviceSyncCard />)
    const { container: b } = render(<DeviceSyncCard manifest={MANIFEST} />)
    expect(rows(a).length).toBeGreaterThan(20)
    expect(rows(a)).toEqual(rows(b))
    expect(a.textContent).toBe(b.textContent)
  })
})

// TERM-052 (FB-S6-01) — the other two publications, asserted by RENDERED TEXT. The expected
// layout lists are computed HERE by asking `layoutAutoSaves` about each kind, and the expected
// numbers are the constants imported straight from the files that enforce them — never a copy.
const kindLabels = (testId) => within(screen.getByTestId(testId))
  .getAllByRole('listitem').map((li) => li.textContent).sort()
const expectedKinds = (answer) => LAYOUT_KINDS
  .filter((k) => layoutAutoSaves(k.probe) === answer).map((k) => k.label).sort()
const limitText = (id) => screen.getByTestId('sync-ceilings')
  .querySelector(`[data-ceiling-id="${id}"]`).textContent

describe('DeviceSyncCard publishes which layouts save themselves, from the workspace rule', () => {
  it('lists exactly the kinds layoutAutoSaves says save, and exactly the ones it says do not', () => {
    render(<DeviceSyncCard />)
    expect(expectedKinds(true).length).toBeGreaterThan(0) // CONTROL
    expect(expectedKinds(false).length).toBeGreaterThan(0) // CONTROL
    expect(kindLabels('sync-layout-autosaves')).toEqual(expectedKinds(true))
    expect(kindLabels('sync-layout-manual')).toEqual(expectedKinds(false))
    expect(screen.queryByTestId('sync-layout-unreadable')).toBeNull()
  })

  it('says what each list means, in words a member reads', () => {
    render(<DeviceSyncCard />)
    const on = screen.getByTestId('sync-layout-autosaves')
    const off = screen.getByTestId('sync-layout-manual')
    expect(within(on).getByRole('heading').textContent).toBe('Layouts that save as you work')
    expect(on.textContent).toContain('written into the open layout a moment after you stop moving things')
    expect(within(off).getByRole('heading').textContent).toBe('Layouts you save yourself')
    expect(off.textContent).toContain('are not written into it. To keep them, save the board as a new layout.')
  })

  it('PLANTED DRIFT: a different rule moves the rows with no edit to the card', () => {
    const { unmount } = render(<DeviceSyncCard autoSaves={() => true} />)
    expect(kindLabels('sync-layout-autosaves')).toEqual(LAYOUT_KINDS.map((k) => k.label).sort())
    expect(screen.queryByTestId('sync-layout-manual')).toBeNull()
    unmount()
    render(<DeviceSyncCard autoSaves={() => undefined} />)
    expect(kindLabels('sync-layout-unreadable')).toEqual(LAYOUT_KINDS.map((k) => k.label).sort())
    expect(screen.queryByTestId('sync-layout-autosaves')).toBeNull()
  })
})

describe('DeviceSyncCard publishes the limits the code enforces', () => {
  it('shows every ceiling with the number its enforcing constant holds', () => {
    render(<DeviceSyncCard />)
    const rows = within(screen.getByTestId('sync-ceilings')).getAllByRole('listitem')
    expect(rows.map((li) => li.getAttribute('data-ceiling-id')).sort()).toEqual(CEILINGS.map((c) => c.id).sort())
    expect(limitText('multichart-grid')).toBe(`Charts in one multi-chart grid${GRID_MAX_CELLS}`)
    expect(limitText('chart-comparisons')).toBe(`Comparison symbols on one chart${MAX_COMPARISONS}`)
    expect(limitText('chart-templates')).toContain(String(MAX_CHART_TEMPLATES))
    expect(screen.getByTestId('sync-ceilings').textContent).not.toContain('unreadable')
  })

  it('PLANTED DRIFT: moving a constant moves the published number; a lost one reads unreadable', () => {
    const moved = CEILINGS.map((c) => (c.id === 'multichart-grid' ? { ...c, value: 9 } : c))
    const { unmount } = render(<DeviceSyncCard ceilings={moved} />)
    expect(limitText('multichart-grid')).toBe('Charts in one multi-chart grid9')
    unmount()
    const lost = CEILINGS.map((c) => (c.id === 'chart-comparisons' ? { ...c, value: undefined } : c))
    render(<DeviceSyncCard ceilings={lost} />)
    expect(limitText('chart-comparisons')).toBe('Comparison symbols on one chartunreadable')
  })

  it('claims nothing about version history or restore — the versioned store (TERM-021) is dark', () => {
    // Scoped to the TERM-052 sections: the manifest's own labels legitimately say "earlier
    // version" about a renamed key, which is a different claim.
    render(<DeviceSyncCard />)
    const text = ['sync-layout-autosaves', 'sync-layout-manual', 'sync-ceilings']
      .map((id) => screen.getByTestId(id).textContent).join(' ')
    expect(text).toContain('Layouts that save as you work') // CONTROL: the sections rendered
    expect(text).not.toMatch(/version|restore|undo|history/i)
  })
})
