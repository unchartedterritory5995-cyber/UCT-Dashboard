// @vitest-environment node
// P0.1 fix round 1: at <=640px Home's header row wraps and the split button lands on the second
// row at the LEFT, so a menu anchored `right: 0` (min-width 200px) would run off the left edge.
// On a phone the menu hangs from the button's left edge and stays inside the viewport.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
const css = readFileSync(new URL('./NewNoteMenu.module.css', import.meta.url), 'utf8')
describe('NewNoteMenu phone placement', () => {
  const phone = css.split('@media (max-width: 640px)').slice(1).join('')
  const menuRule = /\.menu\s*\{([^}]*)\}/.exec(phone)?.[1] ?? ''
  it('the phone block has a .menu rule (non-vacuity)', () => {
    expect(menuRule.length).toBeGreaterThan(0)
  })
  it('anchors the menu to the left edge of the button, not the right', () => {
    expect(/left:\s*0\b/.test(menuRule)).toBe(true)
    expect(/right:\s*auto\b/.test(menuRule)).toBe(true)
  })
  it('keeps the menu inside the viewport', () => {
    expect(/max-width:\s*calc\(100vw - 32px\)/.test(menuRule)).toBe(true)
  })
})
