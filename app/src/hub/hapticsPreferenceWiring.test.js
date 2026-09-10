/**
 * The haptics preference actually reaches the accessible door.
 *
 * ⛔ WHY THIS EXISTS SEPARATELY FROM `actionsSheetHaptic.test.jsx`. That rail renders
 * `HubActionsButton` directly and proves the CUE is correct for every action. It cannot see whether
 * anything passes the member's preference in — and it did not fire when the wiring was deleted from
 * `HubRoot`. A component rail is structurally blind to a severed wire; that is the
 * "built, tested, green, and connected to nothing" class this repo has an audit about.
 *
 * ⭐ SOURCE-DERIVED, like `contractArity.test.js`: read the CALLING file, because the question is
 * "does the caller pass it", and no render of the callee can answer that.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HUB_ROOT = resolve(process.cwd(), 'src', 'hub', 'HubRoot.jsx')
const src = () => readFileSync(HUB_ROOT, 'utf8')

/** The `<HubActionsButton ... />` element as written, comments stripped. */
function actionsButtonElement(text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const at = stripped.indexOf('<HubActionsButton')
  if (at === -1) return null
  return stripped.slice(at, stripped.indexOf('/>', at) + 2)
}

describe('the haptics preference reaches the WCAG path', () => {
  it('the scan can see HubRoot and its actions button — the non-vacuity control', () => {
    const text = src()
    expect(text.length, 'HubRoot.jsx read as empty').toBeGreaterThan(1000)
    const el = actionsButtonElement(text)
    expect(el, 'no <HubActionsButton> element found — the scan is looking at nothing').toBeTruthy()
    // A prop we know is there, so a regex that matches nothing fails HERE rather than downstream.
    expect(el).toMatch(/onAction=/)
  })

  it('⛔ HubRoot passes hapticsEnabled — a default in the leaf is a SECOND answer', () => {
    // `HubActionsButton` defaults the prop to true so the cue was not shipped unreachable. But the
    // member may have turned haptics OFF, and a default that overrides a stored preference is two
    // authorities over one value. Without this line they still feel the sheet buzz.
    const el = actionsButtonElement(src())
    expect(
      el,
      'HubRoot does not pass hapticsEnabled to HubActionsButton, so a member who turned haptics '
      + 'off still feels the actions sheet buzz — the leaf default silently wins',
    ).toMatch(/hapticsEnabled=/)
  })

  it('⛔ it passes the SAME expression the engine reads, not a fresh opinion', () => {
    // `useJoystick` reads `settings.haptics !== false`. A different expression here — `!!haptics`,
    // or `settings.haptics === true` — would make the two doors disagree for an unset preference,
    // which is exactly the state most members are in.
    const el = actionsButtonElement(src())
    expect(el).toMatch(/hapticsEnabled=\{settings\.haptics !== false\}/)
  })
})
