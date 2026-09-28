// app/src/components/ui/Switch.parity.test.jsx
//
// ─── TERM-067 · THE SWITCH MIGRATION CHANGES NO DOM ────────────────────────────
//
// The Watchlist and Theme Tracker settings panels each carried a byte-identical
// local `Toggle` (the census names them: the only form-control wrapper defined
// twice). Both now render `components/ui/Switch`. This file is the promise that
// the swap changed nothing a member, a screen reader or a stylesheet can see.
//
// ⛔ THE ORACLE IS THE RETIRED CODE, RESTATED ONCE, HERE. `oldToggleHtml` is the
// deleted local `Toggle` transcribed verbatim — same attributes, same class join
// (`${toggle}${on ? ' ' + toggleOn : ''}`), same knob — built from the panel's
// OWN CSS module, so a hash change moves both sides at once. It was run GREEN
// against the old panels BEFORE they were migrated, then kept as the oracle.
//
// Two comparisons, and they catch different things:
//   • outerHTML string equality — attribute ORDER and exact class text (a stray
//     trailing space in `class` is a real difference and fails here);
//   • Node.isEqualNode — the DOM spec's own definition of "the same node", so a
//     pass cannot be an artefact of how jsdom happens to serialise.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {} }),
}))

import WatchlistSettingsPanel from '../../pages/watchlist/WatchlistSettingsPanel'
import ThemeTrackerSettingsPanel from '../../pages/theme-tracker/ThemeTrackerSettingsPanel'
import { WATCHLIST_DEFAULTS } from '../../pages/watchlist/watchlistSettings'
import { THEME_TRACKER_DEFAULTS } from '../../pages/theme-tracker/themeTrackerSettings'
import wlStyles from '../../pages/watchlist/WatchlistSettingsPanel.module.css'
import ttStyles from '../../pages/theme-tracker/ThemeTrackerSettingsPanel.module.css'

afterEach(cleanup)

/** The retired local `Toggle`, verbatim, as HTML. The oracle. */
function oldToggleHtml(styles, on, label) {
  const tpl = document.createElement('template')
  const cls = `${styles.toggle}${on ? ' ' + styles.toggleOn : ''}`
  tpl.innerHTML = `<button type="button" role="switch" aria-checked="${on}" class="${cls}" title="${label}"><span class="${styles.knob}"></span></button>`
  return tpl.content.firstChild
}

const PANELS = [
  { name: 'WatchlistSettingsPanel', Panel: WatchlistSettingsPanel, defaults: WATCHLIST_DEFAULTS, styles: wlStyles },
  { name: 'ThemeTrackerSettingsPanel', Panel: ThemeTrackerSettingsPanel, defaults: THEME_TRACKER_DEFAULTS, styles: ttStyles },
]
const SWITCHES = [
  { key: 'tintEnabled', label: 'Toggle tick tint' },
  { key: 'showLogos', label: 'Toggle company logos' },
]

describe('the oracle is not vacuous', () => {
  it('the CSS module really exposes the three classes the old Toggle used', () => {
    for (const { styles } of PANELS) {
      for (const k of ['toggle', 'toggleOn', 'knob']) expect(styles[k], k).toBeTruthy()
    }
  })

  it('the oracle distinguishes on from off, and a trailing-space class from a clean one', () => {
    const on = oldToggleHtml(wlStyles, true, 'x')
    const off = oldToggleHtml(wlStyles, false, 'x')
    expect(on.isEqualNode(off)).toBe(false)
    const spaced = off.cloneNode(true)
    spaced.setAttribute('class', off.getAttribute('class') + ' ')
    expect(spaced.isEqualNode(off)).toBe(false)
  })
})

describe.each(PANELS)('$name — every switch renders the retired Toggle\'s exact DOM', ({ Panel, defaults, styles }) => {
  for (const on of [true, false]) {
    it(`both switches, all ${on ? 'ON' : 'OFF'}`, () => {
      const settings = { ...defaults, tintEnabled: on, showLogos: on }
      render(<Panel settings={settings} onChange={() => {}} onReset={() => {}} onClose={() => {}} />)
      const found = [...document.body.querySelectorAll('[role="switch"]')]
      expect(found).toHaveLength(SWITCHES.length)
      found.forEach((el, i) => {
        const want = oldToggleHtml(styles, on, SWITCHES[i].label)
        expect(el.outerHTML).toBe(want.outerHTML)
        expect(el.isEqualNode(want)).toBe(true)
      })
    })
  }

  it('a click still sends exactly the patch the old Toggle sent', () => {
    const onChange = vi.fn()
    render(<Panel settings={{ ...defaults, tintEnabled: true, showLogos: false }}
      onChange={onChange} onReset={() => {}} onClose={() => {}} />)
    const [tint, logos] = document.body.querySelectorAll('[role="switch"]')
    fireEvent.click(tint)
    fireEvent.click(logos)
    expect(onChange.mock.calls).toEqual([[{ tintEnabled: false }], [{ showLogos: true }]])
  })
})
