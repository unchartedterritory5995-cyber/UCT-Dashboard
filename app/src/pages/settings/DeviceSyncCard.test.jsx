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
