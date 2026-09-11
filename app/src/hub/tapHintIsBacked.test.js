// ⛔⛔ A CHIP THAT SAYS "tap: last section" MUST HAVE SOMETHING BEHIND THE TAP.
//
// This is the rail that would have caught Home's lie on the day it shipped.
//
// ── THE DEFECT IT EXISTS FOR ────────────────────────────────────────────────────────────────────
// `registry.js` declares `tapHint: 'tap: last section'` for `home`, and `HubChip` renders that
// string to the member. For most of this feature's life NOTHING could keep that promise:
// `useJoystick` read `mode.onTap` and invoked it with NO ARGUMENTS, so a registry-declared mode
// could not reach `ctx.navigate`. homeSection.js said exactly that in its own header and declined
// to ship an inert handler.
//
// ✅ HOME IS FIXED NOW — HubRoot dispatches all four mode callbacks with ctx, and homeSection
// declares a real `onTap`. This rail is what keeps the NEXT one honest: three modes still promise
// a tap with nothing behind it (chart, catalysts, calendar), and they are invisible for one reason
// only — they sit in PREVIEW_MODES, and `HubRoot.jsx` substitutes 'Preview — more coming' for a
// preview mode's tapHint. The moment any of them leaves that set, its chip starts lying.
//
// ⭐ THE RULE: a tapHint that PROMISES a tap ("tap: …") must be backed by a declared `onTap`, or
// the mode must still be hidden by the projection. Nothing else counts. A promise the member can
// read, against a gesture that does nothing, is worse than no hint at all.
//
// ── WHY THE DETECTOR IS A DECLARATION, NOT A WORD ──────────────────────────────────────────────
// Hub controllers write prose ABOUT `onTap` — homeSection's old header mentioned it three times
// while declaring none. A naive `includes('onTap')` reports such a file as SATISFIED and takes the
// whole rail green over the defect it was written for. That is the same failure
// `contractArity.test.js` records against its own first version ("matched the prose a few lines
// above the real call site"). Two independent defences: comments are stripped, AND the match is a
// DECLARATION (`onTap:` / `onTap =`). The control below owns a fixture proving both, rather than
// pointing at a real file that can change under it — which is exactly what happened when Home
// grew its handler and the first version of that control started failing on good news.
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

  it('⛔ THE CONTROL: prose says `onTap`; only a DECLARATION counts', () => {
    // ⚰️ THIS CONTROL USED TO POINT AT homeSection.js, and Home then GREW a real onTap — so the
    // control started failing on good news, which is a control tied to a moving subject. It now
    // owns its fixture: prose of exactly the shape hub controllers write, which a substring scan
    // reports as satisfied and a declaration scan does not.
    //
    // ⭐ The two detectors are the SAME functions the real assertions use, so this cannot drift
    // into testing a private copy of the logic.
    const prose = `// \`useJoystick.js:449\` calls \`mode?.onTap?.()\` with NO arguments, an arity
// pinned by \`contractArity.test.js\`. A controller cannot reach \`ctx.navigate\` from \`onTap\`,
// so no \`onTap\` is declared rather than one that does nothing.`

    expect(prose.includes('onTap'), 'the fixture must contain the word, or it demonstrates nothing')
      .toBe(true)
    expect(DECLARES_ON_TAP.test(prose), 'a COMMENT mentioning onTap must NOT read as a declaration — '
      + 'if it does, every mode whose header explains why tap is unwired reads as satisfied, and this '
      + 'rail goes green over the exact defect it exists for').toBe(false)
    expect(stripComments(prose).trim(), 'comment-stripping is the second, independent defence')
      .toBe('')

    // And the positive half: a real declaration IS detected.
    expect(DECLARES_ON_TAP.test('  onTap: (ctx) => ctx.navigate(x),'), 'a real declaration must be '
      + 'detected, or the rail can never be satisfied').toBe(true)
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
      // ⭐⭐ THIS LIST IS EMPTY NOW, and that is the end state Phase 3 existed for. Every mode
      // whose chip promises a tap can perform one.
      //
      // ⚰️ Four departures, in order, and every one of them by a HANDLER ARRIVING rather than by
      // an edit here: `home` when HubRoot began passing ctx to onTap and homeSection declared one;
      // `calendar` and `chart` when their controllers shipped in Increment 5; `catalysts` last of
      // all, once the tile's rows became addressable. That is the proof this was a live
      // measurement and never a copied set.
      //
      // ⛔ AN EMPTY LIST IS NOT A DEAD RAIL. Declare a new mode with a "tap: …" hint and no
      // onTap, or un-back an existing one, and it appears here and this goes red. The
      // non-vacuity assertions above are what stop it being empty for the WRONG reason — they
      // require real tap promises to exist and some to be genuinely satisfied, so "empty" can
      // only mean "all backed", never "the detector broke".
      .toEqual([])
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
