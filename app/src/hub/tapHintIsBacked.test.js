// ⛔⛔ A CHIP THAT SAYS "tap: last section" MUST HAVE SOMETHING BEHIND THE TAP.
//
// This is the rail that would have caught Home's lie on the day it shipped.
//
// ── THE DEFECT IT EXISTS FOR ────────────────────────────────────────────────────────────────────
// `registry.js:485` declares `tapHint: 'tap: last section'` for `home`. `HubChip` renders that
// string to the member. And `home` has NO `onTap` anywhere — `homeSection.js` says so in its own
// header, and explains why it cannot have one:
//
//     "⚠️ TAP IS DELIBERATELY NOT WIRED. §C3:905 makes Home's Primary 'last-used section', which
//      means tap must NAVIGATE — and `useJoystick.js:449` calls `mode?.onTap?.()` with no
//      arguments, an arity pinned by contractArity.test.js. A hub-side controller therefore cannot
//      reach ctx.navigate from onTap."
//
// So the product makes a promise in its own voice that no code can keep. It is invisible today for
// one reason only: `home` is in PREVIEW_MODES, and `HubRoot.jsx:433-434` substitutes
// `'Preview — more coming'` for the tapHint of any preview mode. The moment `home` leaves that set
// — which is a one-line change, and is on the roadmap — the chip starts lying to members.
//
// ⭐ THE RULE: a tapHint that PROMISES a tap ("tap: …") must be backed by a declared `onTap`, or
// the mode must still be hidden by the projection. Nothing else counts. A promise the member can
// read, against a gesture that does nothing, is worse than no hint at all — it teaches them the
// product is broken.
//
// ── THE CONTROL THAT MAKES THIS RAIL HONEST ────────────────────────────────────────────────────
// ⛔ `homeSection.js` CONTAINS the string `onTap` — inside the comment quoted above. A naive
// substring scan therefore reports Home as SATISFIED, and this rail would pass while the exact
// defect it was written for sat untouched. That is not hypothetical: it is what the first
// measurement did, and it is the same failure `contractArity.test.js` records against its own
// first version ("its own first version matched the prose ... a few lines above the real call
// site, which is the invented-citation defect committed by a machine").
//
// So comments are stripped before matching, and there is a dedicated test below asserting that
// the stripping is LOAD-BEARING — that Home reads as satisfied WITHOUT it and unsatisfied WITH it.
// A control that cannot fail is not a control.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { modes, PREVIEW_MODES } from './registry'

const HUB = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SECTIONS = path.join(HUB, 'sections')

const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const RAW = readdirSync(SECTIONS)
  .filter((f) => /\.jsx?$/.test(f) && !/\.test\.jsx?$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(path.join(SECTIONS, f), 'utf8') }))

const CODE = RAW.map(({ file, text }) => ({ file, text: stripComments(text) }))

/** Controllers serving a mode — by filename OR by the ids they name, because neither alone is
 *  right: `scan` is served by screenerSection.js, and wireSection.js matches by SUFFIX so it never
 *  contains the literal `'wire.`. (Same lookup as runActionsHaveHandlers.test.js.) */
const controllersFor = (modeId, set) => set
  .filter((c) => c.file === `${modeId}Section.js` || c.text.includes(`'${modeId}.`))

/** A real declaration — `onTap:` or `onTap =` — never the bare word. */
const DECLARES_ON_TAP = /\bonTap\s*[:=]/

const declaresOnTap = (modeId, set = CODE) =>
  controllersFor(modeId, set).some((c) => DECLARES_ON_TAP.test(c.text))

/** A hint that promises a tap. `flow`'s "navigate only" promises nothing and is not a lie. */
const promisesATap = (hint) => typeof hint === 'string' && hint.trim().toLowerCase().startsWith('tap:')

const ROWS = modes.map((m) => ({
  id: m.id,
  hint: m.tapHint,
  promises: promisesATap(m.tapHint),
  backed: declaresOnTap(m.id),
  hidden: PREVIEW_MODES.has(m.id),
}))

describe('a tapHint that promises a tap is backed by an onTap', () => {
  it('non-vacuity — there are real promises, and some are genuinely satisfied', () => {
    const promising = ROWS.filter((r) => r.promises)
    expect(promising.length, 'no mode promises a tap at all, so every assertion below is vacuous')
      .toBeGreaterThan(3)
    expect(promising.filter((r) => r.backed).length, 'NO promise is satisfied by a real onTap — the '
      + 'detector is broken, not the product').toBeGreaterThan(3)
    expect(ROWS.some((r) => !r.promises), 'every mode promises a tap, so the "navigate only" case '
      + 'that must NOT be flagged is untested').toBe(true)
  })

  it('⛔ THE CONTROL: a naive scan IS fooled here, and Home is the proof', () => {
    // ⭐ MEASURED, not assumed — and my own first version of this control asserted the wrong half.
    // `homeSection.js` explains in PROSE why tap is not wired, and that prose contains the word
    // `onTap` three times (`mode?.onTap?.()`, "cannot reach ctx.navigate from `onTap`", "no
    // `onTap` is declared"). So:
    //
    //   naive `includes('onTap')`      raw: FOOLED (true)   stripped: not fooled
    //   declaration /onTap\s*[:=]/     raw: not fooled      stripped: not fooled
    //
    // TWO independent defences, and either alone would hold for this file — the detector matches a
    // DECLARATION rather than a word, AND comments are stripped first. This test pins the reason
    // both exist: a substring scan over this exact file reports Home as SATISFIED, which would take
    // the whole rail green over the defect it was written for.
    const naiveRaw = RAW.filter((c) => c.file === 'homeSection.js')
      .some((c) => c.text.includes('onTap'))
    const naiveStripped = CODE.filter((c) => c.file === 'homeSection.js')
      .some((c) => c.text.includes('onTap'))
    const strict = declaresOnTap('home')

    expect(naiveRaw, 'homeSection.js no longer mentions onTap in prose, so this control no longer '
      + 'demonstrates anything. Find another file whose comments would fool a substring scan, or '
      + 'DELETE this test — a control that cannot fail is not a control.').toBe(true)
    expect(naiveStripped, 'comment-stripping should remove the prose mention — defence one').toBe(false)
    expect(strict, 'Home must read as having NO declared onTap — defence two. If it now has a real '
      + 'one, that is good news: remove home from the borrowed-time list below.').toBe(false)
  })

  it('⛔⛔ no LIVE mode promises a tap it cannot perform', () => {
    const liars = ROWS
      .filter((r) => r.promises && !r.backed && !r.hidden)
      .map((r) => `${r.id} — chip reads "${r.hint}"`)
    expect(liars, 'This mode is LIVE (not in PREVIEW_MODES), its chip renders a "tap: …" promise to '
      + 'the member, and no section controller declares an onTap to keep it. `HubChip` shows the '
      + 'string; the gesture does nothing.\n'
      + 'Ship the handler, or change the hint to describe what tap actually does. A promise in the '
      + "product's own voice with nothing behind it teaches the member the product is broken.")
      .toEqual([])
  })

  it('⛔ the promises living on borrowed time are named, so the next preview exit fails HERE', () => {
    // ⭐ These are safe ONLY because HubRoot.jsx:433-434 substitutes 'Preview — more coming' for a
    // preview mode's tapHint. Removing a mode from PREVIEW_MODES un-hides its hint in the same
    // stroke — so this list is exactly what such a flip would put in front of a member.
    const borrowed = ROWS
      .filter((r) => r.promises && !r.backed && r.hidden)
      .map((r) => `${r.id}: "${r.hint}"`)
      .sort()
    expect(borrowed, 'The set of preview-hidden, unbacked tap promises changed.\n'
      + 'If one LEFT the list a handler arrived — good, update it. If one JOINED, a new hint was '
      + 'written for a gesture nothing performs.\n'
      + '⛔ Taking any of these out of PREVIEW_MODES REQUIRES shipping its onTap in the SAME commit, '
      + 'or rewording the hint. `home` is the live example: §C3 wants "last-used section", which '
      + 'means tap must NAVIGATE, and useJoystick.js:449 calls onTap() with NO ARGUMENTS — so a '
      + 'registry-declared mode structurally cannot reach ctx.navigate from a tap until that arity '
      + 'changes.')
      .toEqual([
        'calendar: "tap: next day"',
        'catalysts: "tap: next row"',
        'chart: "tap: next timeframe"',
        'home: "tap: last section"',
      ])
  })

  it('⛔ the hiding mechanism is checked, not assumed', () => {
    // The whole "safe for now" argument rests on HubRoot substituting the preview string. If that
    // substitution ever went away, every assertion above would still pass while four hints became
    // member-visible — a guard testing the adjacent thing.
    const src = stripComments(readFileSync(path.join(HUB, 'HubRoot.jsx'), 'utf8'))
    expect(src, 'HubRoot no longer substitutes a preview string for a preview mode\'s tapHint, so '
      + 'the four unbacked promises above are now rendered to members verbatim.')
      .toMatch(/isPreviewMode\(activeModeConfig\?\.id\)[\s\S]{0,80}Preview/)
  })
})
