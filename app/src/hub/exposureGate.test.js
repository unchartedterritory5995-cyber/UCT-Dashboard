/**
 * ⛔⛔ THE EXPOSURE RAIL. Four facts decide who can see the joystick hub. This program's standing
 * deploy authorization is conditional on all four being intact, and this is the one rail that may
 * NEVER be edited without a hard stop (H11) — because the only way it goes red is if the answer to
 * "who sees this feature" has changed, and that is never a test's problem to absorb.
 *
 * ⭐ WHY SOURCE ASSERTIONS AND NOT BEHAVIOUR TESTS. Each fact already has behavioural rails
 * elsewhere — `useHubActive`'s floor, `JoystickSettingsCard.test.jsx`'s five states,
 * `test_hub_preview_flag.py`'s per-request read. Those prove the code does what it says. This one
 * proves the code still SAYS it: it pins the literal, so a change cannot be made and the test
 * "fixed" to match in the same commit without the diff showing this file, which is the review
 * signal that matters.
 *
 * FOUR FACTS:
 *   1. The hub mounts ONLY on a coarse-pointer device under 1024px.
 *   2. An UNSET preference resolves to `isAdmin` — never to "on".
 *   3. The Settings card is admin-only, except anyone who already chose either way.
 *   4. `HUB_PREVIEW_ENABLED` defaults ON and is read PER REQUEST — a kill switch, not a launch
 *      switch, so a variable someone forgot to set is not a silent shutdown.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve(process.cwd(), 'src')
const REPO = resolve(process.cwd(), '..')
const read = (p) => readFileSync(p, 'utf8')

describe('⛔ EXPOSURE — who can see the hub', () => {
  it('the files exist and are readable — the non-vacuity control', () => {
    for (const p of [
      resolve(APP, 'hub/useHubActive.js'),
      resolve(APP, 'hub/useHubSettings.js'),
      resolve(APP, 'pages/settings/JoystickSettingsCard.jsx'),
    ]) {
      expect(existsSync(p), `${p} is missing — every assertion below would pass vacuously`).toBe(true)
      expect(read(p).length).toBeGreaterThan(500)
    }
  })

  it('1. the hub mounts ONLY on a coarse-pointer device under 1024px', () => {
    const src = read(resolve(APP, 'hub/useHubActive.js'))
    expect(
      src,
      'the device floor changed. Widening it puts the hub on desktops, where it cannot be dismissed '
      + 'by the gesture that dismisses it on a phone.',
    ).toContain("matchMedia('(max-width: 1023px) and (pointer: coarse)')")
    // And the floor must still be a hard return, not a warning.
    expect(src).toMatch(/\(max-width: 1023px\) and \(pointer: coarse\)'\)\.matches\)\s*return false/)
  })

  it('2. an UNSET preference resolves to isAdmin — never to "on"', () => {
    const src = read(resolve(APP, 'hub/useHubSettings.js'))
    expect(
      src,
      'the default changed. `undefined -> true` would turn the hub on for every member on a phone '
      + 'the moment this deploys, with no one having asked for it.',
    ).toContain('explicitEnabled === undefined ? isAdmin : !!explicitEnabled')
  })

  it('3. the Settings card is admin-only, except anyone who already chose', () => {
    const src = read(resolve(APP, 'pages/settings/JoystickSettingsCard.jsx'))
    expect(src, 'B6 gate removed or inverted').toContain('if (!isAdmin && !everChose) return null')
    expect(
      src,
      "`everChose` must stay `typeof === 'boolean'`. `!== undefined` admits {\"enabled\":null} as a "
      + 'deliberate choice and shows the card to a member who never made one.',
    ).toContain("typeof storedEnabled === 'boolean'")
  })

  it('4. HUB_PREVIEW_ENABLED defaults ON and is read per request', () => {
    // ⚠️ This one lives in api/, which this program never edits — so the rail reads it rather than
    // asserting a diff. If the file moves, that is a finding, not a skip.
    const p = resolve(REPO, 'api/routers/auth.py')
    expect(existsSync(p), 'api/routers/auth.py moved — the kill switch is elsewhere now').toBe(true)
    const src = read(p)
    expect(
      src,
      'the kill switch default changed. OFF-by-default makes a variable someone forgot to set '
      + 'indistinguishable from a deliberate shutdown.',
    ).toContain('"HUB_PREVIEW_ENABLED", "1"')
    // Read INSIDE the request handler, not captured at import — the no-redeploy rollback depends
    // on it, and a module-level capture passes every other test while making that a fiction.
    const lines = src.split('\n')
    const readLine = lines.findIndex((l) => l.includes('"HUB_PREVIEW_ENABLED"'))
    expect(readLine, 'the flag name is gone from auth.py').toBeGreaterThan(-1)

    // A module-level capture sits at column 0. This read is nested inside a handler.
    const indent = lines[readLine].match(/^\s*/)[0].length
    expect(
      indent,
      'HUB_PREVIEW_ENABLED is read at module level — captured once at import, so flipping the '
      + 'variable would need a redeploy and the documented rollback becomes a fiction',
    ).toBeGreaterThan(0)

    // And there is an enclosing def above it, at a shallower indent.
    let enclosing = null
    for (let i = readLine; i >= 0; i -= 1) {
      const m = lines[i].match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/)
      if (m && m[1].length < indent) { enclosing = m[2]; break }
    }
    expect(enclosing, 'no enclosing function found above the HUB_PREVIEW_ENABLED read').toBeTruthy()
  })
})
