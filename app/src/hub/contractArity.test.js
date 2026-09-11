// ⛔ THE DERIVATION RAIL. Every hub callback's argument list, taken from the RUNTIME CALL SITE.
//
// Owner ruling, 2026-09-09: "A contract is verified against the runtime call site, never against a
// harness that restates it. Arity is not a shape; validators do not catch it, derivation rails do."
//
// WHY THIS FILE EXISTS — R-05, and it was self-inflicted.
//
// `HubRoot.jsx` has called `onScrub(ctx, scrub)` since Phase 2, and `registry.js` documented that.
// Task 0's Phase 3 typedef said `onScrub(scrub)`, and Task 0's own contract harness hand-wired the
// one-argument form **to match the typedef**. So the contract and its test agreed with each other
// and neither agreed with the product: a section built against the documented shape would have
// read `ctx.delta === undefined` on a real page, with a green suite behind it. Two Wave A
// integrators found it independently, from opposite sections, on their first day.
//
// `validateSectionConfig` cannot catch this. It checks that `onScrub` is a FUNCTION — and a
// function of the wrong arity is still a function. JavaScript will happily call it and pass the
// context into a parameter named `scrub`. Nothing throws. Nothing logs. The gesture just quietly
// does the wrong thing, which is the entire failure mode this hub keeps paying for.
//
// So nothing here is typed by hand. Each callback's argument list is READ from the file that
// actually calls it, and the contract and the harness are asserted against that.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => readFileSync(path.join(HERE, f), 'utf8')

const HUB_ROOT = read('HubRoot.jsx')
const USE_JOYSTICK = read('useJoystick.js')
const CONTRACTS = read('contracts.js')
const HARNESS = read('phase3Contracts.test.jsx')

/**
 * ⛔ COMMENTS ARE STRIPPED FIRST, and that is not tidiness — it is this rail's own near-miss.
 * `HubRoot.jsx` contains the prose "passed through to the mode's own `onScrub(ctx, delta)`" a few
 * lines ABOVE the real call site, and the first version of this file matched the comment and
 * reported `onScrub(ctx, delta)` as the runtime truth. A rail that reads a COMMENT as evidence is
 * the invented-citation defect committed by a machine — caught here only because the arity it
 * derived happened to disagree with the typedef.
 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * Split on TOP-LEVEL commas only. `(ctx: object, scrub: {delta: number, axis: 'x'|'y'})` contains
 * three commas and two parameters; a naive split reports three, and the rail then fails against
 * itself rather than against the product.
 */
function splitTopLevel(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if ('{[('.includes(ch)) depth += 1
    else if ('}])'.includes(ch)) depth -= 1
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim() !== '') out.push(cur)
  return out.map((x) => x.trim())
}

/**
 * Every callback `contracts.js` documents on `HubSectionConfig`, with the file that actually
 * invokes it. ⭐ The FILE is named here; the ARGUMENT LIST never is — that is the whole point.
 */
const CALLBACKS = [
  // ⚰️ THESE TWO MOVED. `useJoystick` used to read them off `mode` and call them with NO
  // ARGUMENTS — which is exactly why a registry-declared mode could never navigate from a tap:
  // the hook owns the double-tap timing but has no `ctx` and never will. HubRoot dispatches all
  // four mode callbacks now, so this rail follows the call site rather than pinning the old one.
  { name: 'onTap', source: HUB_ROOT, where: 'HubRoot.jsx' },
  { name: 'onDoubleTap', source: HUB_ROOT, where: 'HubRoot.jsx' },
  { name: 'onScrub', source: HUB_ROOT, where: 'HubRoot.jsx' },
  { name: 'onScrubCommit', source: HUB_ROOT, where: 'HubRoot.jsx' },
  // ⭐ NOT on HubSectionConfig — `confirmPayload` is declared on the ACTION (`HubActionRef`), and
  // it is the R-14 seam: the only route `HubConfirmPayload.fields` has to the sheet. It belongs
  // here for exactly the reason the four above do — `validateSectionConfig` checks that it is a
  // FUNCTION, and a function of the wrong arity is still a function. A section that read a
  // payload-shaped first argument instead of `ctx` would return a sheet built from `undefined`
  // with nothing thrown and nothing logged.
  { name: 'confirmPayload', source: HUB_ROOT, where: 'HubRoot.jsx' },
]

/** The arguments a call site passes, e.g. `onScrub?.(ctx, scrub)` -> ['ctx', 'scrub']. */
function callSiteArgs(source, name) {
  const m = stripComments(source).match(new RegExp(`${name}\\??\\.?\\(([^)]*)\\)`))
  if (!m) return null
  return splitTopLevel(m[1].trim())
}

/** The parameters a `@property {(a: T, b: U) => void} [name]` typedef declares. */
function typedefParams(name) {
  const line = CONTRACTS.split(/\r?\n/).find((l) => l.includes(`[${name}]`) && l.includes('@property'))
  if (!line) return null
  // Balanced scan from the opening `{(` — a `[^)]*` span stops inside a nested object type.
  const open = line.indexOf('{(')
  if (open === -1) return null
  let depth = 0
  let end = -1
  for (let i = open + 1; i < line.length; i += 1) {
    if (line[i] === '(') depth += 1
    else if (line[i] === ')') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  if (end === -1) return null
  return splitTopLevel(line.slice(open + 2, end).trim()).map((s) => s.split(':')[0].trim())
}

describe('every documented hub callback matches its runtime call site', () => {
  it('CONTROL: every callback was located in the file that calls it', () => {
    // Without this a renamed call site yields `null` everywhere and every assertion below
    // vacuously passes — the exact shape of failure this rail exists to prevent, one level up.
    for (const { name, source, where } of CALLBACKS) {
      expect(callSiteArgs(source, name), `no call site for ${name} in ${where}`).not.toBeNull()
      expect(typedefParams(name), `no @property typedef for ${name} in contracts.js`).not.toBeNull()
    }
  })

  it.each(CALLBACKS)('$name: the typedef declares exactly what $where passes', ({ name, source, where }) => {
    const actual = callSiteArgs(source, name)
    const declared = typedefParams(name)
    expect(
      declared.length,
      `contracts.js documents ${name}(${declared.join(', ')}) but ${where} calls `
      + `${name}(${actual.join(', ')}). Arity is not a shape — validateSectionConfig cannot see `
      + 'this, and a section built against the wrong one fails silently on a real page.',
    ).toBe(actual.length)
  })

  it('⛔ onScrub is context-FIRST in both, by name — the R-05 regression itself', () => {
    expect(callSiteArgs(HUB_ROOT, 'onScrub')[0]).toBe('ctx')
    expect(typedefParams('onScrub')[0]).toBe('ctx')
  })

  it('readout() is called with the same arity the typedef declares', () => {
    // Not in CALLBACKS: `readout` is invoked as `activeModeConfig.readout(ctx)` inside a useMemo
    // rather than through the optional-call form, so it needs its own read.
    const m = stripComments(HUB_ROOT).match(/readout\(([^)]*)\)/)
    expect(m, 'HubRoot no longer calls readout() — every section chip readout is dead again').toBeTruthy()
    const actual = splitTopLevel(m[1].trim())
    expect(typedefParams('readout').length).toBe(actual.length)
    expect(actual[0]).toBe('ctx')
  })

  it('listAdapter.scrollTo has NO hub-side call site, and that is recorded rather than assumed', () => {
    // ⚠️ Deliberately not derived from HubRoot: `scrollTo` is called by the SECTION (the hub hands
    // it the index it moved to). There is nothing to derive here — and saying so out loud is the
    // point, because an empty derivation that silently passes would read as coverage. When a
    // hub-side caller appears, add it to CALLBACKS and delete this test.
    expect(stripComments(HUB_ROOT).includes('scrollTo'),
      'a hub-side scrollTo call site appeared — derive it instead of exempting it').toBe(false)
    expect(CONTRACTS).toMatch(/scrollTo/)
  })
})

describe('the contract HARNESS invokes what the call site does', () => {
  // The second half of R-05: the typedef and the harness both said `onScrub(scrub)`. Matching the
  // contract to the product is not enough if the test that "proves" the contract restates the
  // wrong thing — the harness has to be checked against the same derived truth.
  it('the harness wires onScrub context-first', () => {
    expect(HARNESS, 'phase3Contracts.test.jsx wires onScrub without ctx — it is restating the '
      + 'contract instead of reproducing HubRoot').toMatch(/onScrub\?\.\(\s*ctx\s*,/)
  })

  it('the harness wires onScrubCommit context-first', () => {
    expect(HARNESS).toMatch(/onScrubCommit\?\.\(\s*ctx\s*\)/)
  })
})

describe('R-09 — HubRoot actually DISPATCHES run and confirm', () => {
  // ⛔ Until Wave B, `runAction` handled `home`, `navigate` and `*.voice`, and everything else
  // fell through to a DEV console.warn whose comment asserted it was "unreachable, and that is the
  // point". True in a navigation-only preview — and it meant that flipping PREVIEW_MODES would
  // have shipped four dead bubbles per section: the member drags to Flag / Move stop / Breakeven /
  // Close, the fan closes, nothing happens.
  //
  // ⭐ THE COMMENT IS WHY IT SURVIVED. It did not read "not implemented yet"; it read as a
  // DECISION, so nobody re-checked it against the increment that makes it reachable. Asserted
  // structurally here because a section's own tests invoke its handlers directly and are
  // therefore blind to whether the hub ever calls them.
  const src = stripComments(HUB_ROOT)

  it('dispatches kind: run by calling action.run(ctx)', () => {
    expect(src, 'HubRoot no longer invokes action.run — every run bubble is dead again')
      .toMatch(/action\.run\?\.\(\s*ctx\s*\)/)
  })

  it('dispatches kind: confirm through the sheet, not by writing on the gesture', () => {
    expect(src).toMatch(/action\.kind === 'confirm'/)
    expect(src, 'the confirm branch no longer reads confirmText(ctx)').toMatch(/confirmText\?\.\(\s*ctx\s*\)/)
    expect(src, 'HubConfirmSheet is no longer mounted — confirm actions have nowhere to open')
      .toMatch(/<HubConfirmSheet/)
  })

  it('CONTROL: the fall-through warn survives for a genuinely unhandled kind', () => {
    // Deleting the warn entirely would make a future unknown kind silent, which is the same
    // failure one step later.
    expect(src).toMatch(/unhandled kind/)
  })
})
