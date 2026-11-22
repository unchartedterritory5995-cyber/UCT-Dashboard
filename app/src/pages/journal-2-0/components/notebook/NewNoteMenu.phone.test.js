// @vitest-environment node
// P0.1 fix round 1: on a phone a menu anchored `right: 0` (min-width 200px) under a trigger at the LEFT of a row
// would run off the left edge, so the engine's menu hangs from its trigger's left edge and stays inside the viewport.
// (It was written for Research Home's split button, deleted in go-live wave 1; the rule is the shared engine's.)
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
