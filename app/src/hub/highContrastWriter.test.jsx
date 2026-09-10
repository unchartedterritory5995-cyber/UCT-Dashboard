// ⛔⛔ THE SETTING HAD NO WRITER. A member could toggle "High contrast", the preference
// persisted, and NOT ONE PIXEL CHANGED.
//
// Three of the four parts existed and looked like a shipped feature:
//   · `useHubSettings.js:61`            highContrast: false      — the stored default
//   · `JoystickSettingsCard.jsx:136`    a checkbox on screen     — B13 put it in front of members
//   · `styles/tokens.css:527`           [data-hub-contrast="high"] { … }  — the consumer
// and the fourth — anything that SETS the attribute — did not exist anywhere. A repo-wide search
// for `data-hub-contrast` found it in exactly one file: the stylesheet waiting to be triggered.
//
// ⭐ That is the same defect class as the joystick's own "Hide with no recovery": a control whose
// promise the product cannot keep. It is worse than an absent toggle, because an absent toggle
// tells the truth. And it was MEMBER-REACHABLE — B13 shipped the card.
//
// This rail is the fourth part's proof. It asserts the ATTRIBUTE LANDS ON THE DOM, not that a
// setter was called — the 2026-09-09 ruling after two toast defects: "user-facing feedback is
// asserted by rendered DOM text/state after the triggering action settles, never by state alone."
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const HUB = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

// Only the pieces the writer depends on are stubbed. The writer itself, and the eligibility gate
// it honours, run for real.
let settings = { enabled: true, handedness: 'right', highContrast: false }
let eligible = true

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
  resolveVisible: () => false,          // render the edge-tab branch: cheap, and it is one of the
}))                                     // three siblings the attribute has to cover.
vi.mock('./HubEdgeTab', () => ({
  default: () => null,
  restoreToast: () => '',
}))
vi.mock('../pages/journal-2-0/lib/useJournalToast', () => ({
  useJournalToast: () => ['', vi.fn()],
  JournalToast: () => null,
}))

const ATTR = 'data-hub-contrast'
const read = () => document.documentElement.getAttribute(ATTR)

async function mount() {
  const { default: HubRoot } = await import('./HubRoot')
  return render(<HubRoot />)
}

beforeEach(() => {
  settings = { enabled: true, handedness: 'right', highContrast: false }
  eligible = true
  document.documentElement.removeAttribute(ATTR)
  vi.resetModules()
})
afterEach(cleanup)

describe('highContrast actually reaches the DOM', () => {
  it('the consumer exists — non-vacuity, and it names the tokens it overrides', () => {
    // If the stylesheet block ever went away, every assertion below would still pass while the
    // attribute did nothing again — the guard would be testing the adjacent thing.
    const css = readFileSync(path.join(HUB, '..', 'styles', 'tokens.css'), 'utf8')
    expect(css, 'tokens.css no longer defines [data-hub-contrast="high"], so setting the attribute '
      + 'changes nothing and this whole feature is inert again').toContain('[data-hub-contrast="high"]')
    const block = css.slice(css.indexOf('[data-hub-contrast="high"]'))
    const decls = block.slice(0, block.indexOf('}')).match(/--[a-z-]+\s*:/g) || []
    expect(decls.length, 'the high-contrast block declares nothing').toBeGreaterThan(2)
    // ⚠️ Every token it REDEFINES must be a --hub-* one. The attribute is set on <html>, so a
    // non-hub token here would restyle the entire app the moment a member ticks the box.
    for (const d of decls) {
      expect(d.trim(), `the high-contrast block redefines ${d.trim()} — that is NOT a --hub-* token, `
        + 'and this attribute is set globally on documentElement, so it would leak into the whole app')
        .toMatch(/^--hub-/)
    }
  })

  it('⛔ ON: the attribute lands on documentElement', async () => {
    settings = { ...settings, highContrast: true }
    await mount()
    expect(read(), 'highContrast is on and the hub is eligible, but nothing set data-hub-contrast — '
      + 'the member ticked the box and no pixel changed, which is the defect this rail exists for')
      .toBe('high')
  })

  it('⛔ OFF: the attribute is absent', async () => {
    settings = { ...settings, highContrast: false }
    await mount()
    expect(read(), 'the attribute is present while the setting is off').toBeNull()
  })

  it('⛔ the attribute does not outlive the hub — unmount clears it', async () => {
    settings = { ...settings, highContrast: true }
    const view = await mount()
    expect(read()).toBe('high')
    view.unmount()
    expect(read(), 'unmounting the hub left a stray modifier on <html>. A member who turns the hub '
      + 'off, or a viewport that stops being eligible, must not keep the app in a hub mode.')
      .toBeNull()
  })

  it('⛔ an INELIGIBLE hub never writes it, even with the setting on', async () => {
    // Eligibility is the kill switch and the capability floor. A hub that cannot draw must not
    // restyle anything — the attribute would be a live trace of a feature that is supposed to be
    // gone, the same reasoning that removes the edge tab under HUB_PREVIEW_ENABLED=false.
    settings = { ...settings, highContrast: true }
    eligible = false
    await mount()
    expect(read(), 'the hub is not eligible — kill switch off, or a viewport that cannot draw it — '
      + 'yet it still wrote a global style modifier').toBeNull()
  })
})
