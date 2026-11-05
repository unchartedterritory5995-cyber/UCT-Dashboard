// VIS-4 (audit 2026-11-05, visual issue 9): the hub cursor's gold outline is painted only while the hub
// is ENGAGED. `useHubCursor` marks a row `data-hub-cursor="active"` on every page whether or not a hub can
// drive it, so on a desktop (no hub) the outline sat on a row that was not open -- a second, wrong
// "selected". HubRoot writes `data-hub-engaged` on <html> while it is eligible AND on screen; tokens.css
// scopes its one cursor rule to it. Asserted on the DOM, the same way as the high-contrast writer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const HUB = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

// Only the pieces the writer depends on are stubbed. The writer itself, and the eligibility gate
// it honours, run for real.
let settings = { enabled: true, handedness: 'right', highContrast: false }
let eligible = true
let visible = true

vi.mock('./useHubSettings', () => ({
  default: () => ({ settings, storedEnabled: true, updateHubSettings: vi.fn() }),
}))
vi.mock('./useHubActive', () => ({
  default: () => false,
  useHubEligible: () => eligible,
}))
vi.mock('./hubSessionVisibility', () => ({
  default: () => false,
  useHubSessionOverride: () => false,
  hideForSession: vi.fn(),
  showForSession: vi.fn(),
  resolveVisible: () => visible,
}))
vi.mock('./HubEdgeTab', () => ({
  default: () => null,
  restoreToast: () => '',
}))
vi.mock('../pages/journal-2-0/lib/useJournalToast', () => ({
  useJournalToast: () => ['', vi.fn()],
  JournalToast: () => null,
}))


const ATTR = 'data-hub-engaged'
const read = () => document.documentElement.getAttribute(ATTR)

async function mount() {
  const { default: HubRoot } = await import('./HubRoot')
  return render(<MemoryRouter><HubRoot /></MemoryRouter>)
}

beforeEach(() => {
  settings = { enabled: true, handedness: 'right', highContrast: false }
  eligible = true
  visible = true
  document.documentElement.removeAttribute(ATTR)
  vi.resetModules()
})
afterEach(cleanup)

describe('the hub cursor paints only while the hub is engaged', () => {
  it('the one cursor rule is scoped to the attribute (non-vacuity: the consumer exists)', () => {
    const css = readFileSync(path.join(HUB, '..', 'styles', 'tokens.css'), 'utf8')
    expect(css).toContain(':root[data-hub-engaged] [data-hub-cursor="active"] {')
    // and no second, unscoped copy of it
    expect(css.split(/\r?\n/).filter((l) => l.startsWith('[data-hub-cursor="active"]'))).toEqual([])
  })

  it('eligible and on screen: the attribute is set', async () => {
    await mount()
    expect(read()).toBe('')
  })

  it('hidden (the member put it away): no attribute, so no outline', async () => {
    visible = false
    await mount()
    expect(read()).toBeNull()
  })

  it('ineligible (a desktop, the kill switch): no attribute, so no outline', async () => {
    eligible = false
    await mount()
    expect(read()).toBeNull()
  })

  it('unmount clears it: the attribute does not outlive the hub', async () => {
    const view = await mount()
    expect(read()).toBe('')
    view.unmount()
    expect(read()).toBeNull()
  })
})
