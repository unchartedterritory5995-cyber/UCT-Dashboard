/**
 * ⛔⛔ THE LADDER IS DESCRIBED IN THREE PLACES. THIS FAILS WHEN THEY DISAGREE.
 *
 * `ROLLOUT_STAGE` decides who can see the hub, and what each number MEANS is written down three
 * times: the comment above the constant, the stage table in `docs/plans/joystick/rollout.md`, and
 * the resolver itself (`STAGE_NAMES` + `unsetDefault`). Three authorities over one value is the
 * defect this repo keeps paying for — and on 2026-09-13 it was live: the ruling said stage 2 meant
 * "member preview" while `unsetDefault` said `stage >= 3`, so `ROLLOUT_STAGE = 2` would have
 * shipped the retired opt-in rung under a member-impact paragraph promising the opposite.
 *
 * ⭐ IT PARSES ALL THREE RATHER THAN RESTATING ANY. A fourth hand-typed copy of the ladder inside
 * this file would be a fourth thing to drift. The expectations below are derived from the sources
 * and compared against each other; the only literals are the RUNG NUMBERS, which are what the
 * owner ruled and the one thing a parser cannot infer.
 *
 * ⛔ EVERY PARSE CARRIES A NON-VACUITY CONTROL. A regex that matches nothing yields an empty map,
 * and two empty maps agree perfectly — which is exactly how a rail like this passes forever while
 * the thing it guards rots (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROLLOUT_STAGE, STAGE_NAMES, unsetDefault, cardVisible } from './rolloutStage'
import { PREVIEW_MODES } from './registry'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const STAGE_SRC = readFileSync(path.join(HERE, 'rolloutStage.js'), 'utf8')
const ROLLOUT_MD = readFileSync(
  path.join(REPO, 'docs', 'plans', 'joystick', 'rollout.md'), 'utf8')

/** The rungs the owner ruled. The one literal in this file, and deliberately so. */
const RUNGS = [1, 2, 3]

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * The comment above the constant: `//   1  admin preview. ...`
 * ⛔ Scoped to the block that precedes `export const ROLLOUT_STAGE`, so prose further down the
 * file that happens to start with a digit cannot be read as a rung.
 */
function namesFromComment() {
  const cut = STAGE_SRC.indexOf('export const ROLLOUT_STAGE')
  expect(cut, 'the constant declaration was not found — this parser is reading the wrong file')
    .toBeGreaterThan(0)
  const head = STAGE_SRC.slice(0, cut)
  const out = {}
  for (const m of head.matchAll(/^\/\/\s{2,}([123])\s\s+([^.]+)\./gm)) {
    out[Number(m[1])] = norm(m[2])
  }
  return out
}

/** The stage table in rollout.md: `| **2** ... | **Member preview** |` — the LAST cell is the name. */
function namesFromDoc() {
  const out = {}
  for (const m of ROLLOUT_MD.matchAll(/^\|\s*\*\*([123])\*\*[^|\n]*\|(?:[^|\n]*\|){2}\s*\*\*([^*|]+)\*\*\s*\|/gm)) {
    out[Number(m[1])] = norm(m[2])
  }
  return out
}

describe('⛔ the ladder agrees with itself in all three places', () => {
  it('the comment above the constant declares exactly the ruled rungs', () => {
    const fromComment = namesFromComment()
    // NON-VACUITY: a broken regex yields {} and would "agree" with everything below.
    expect(Object.keys(fromComment).map(Number).sort(), 'the comment parser found no rungs, so '
      + 'every comparison below would pass over an empty set').toEqual(RUNGS)
  })

  it('rollout.md declares exactly the ruled rungs', () => {
    const fromDoc = namesFromDoc()
    expect(Object.keys(fromDoc).map(Number).sort(), 'the rollout.md parser found no rungs — the '
      + 'stage table moved or changed shape, and this rail is now looking at nothing').toEqual(RUNGS)
  })

  it('the resolver declares exactly the ruled rungs', () => {
    expect(Object.keys(STAGE_NAMES).map(Number).sort()).toEqual(RUNGS)
  })

  it('⛔ all three agree on the NAME of every rung', () => {
    const fromComment = namesFromComment()
    const fromDoc = namesFromDoc()
    for (const n of RUNGS) {
      expect(fromComment[n], `stage ${n}: the comment above the constant and STAGE_NAMES disagree`)
        .toBe(norm(STAGE_NAMES[n]))
      expect(fromDoc[n], `stage ${n}: rollout.md and STAGE_NAMES disagree. One of them was edited `
        + 'without the other, which is how "member preview" and an opt-in rung ended up sharing a '
        + 'number.').toBe(norm(STAGE_NAMES[n]))
    }
  })

  it('⛔ the names DISCRIMINATE — three rungs, three different meanings', () => {
    // Without this, a ladder whose every rung was named "stage" would satisfy every check above.
    const names = RUNGS.map((n) => norm(STAGE_NAMES[n]))
    expect(new Set(names).size, 'two rungs share a name, so agreement proves nothing').toBe(3)
  })
})

describe('⛔ the resolver BEHAVES the way the three descriptions say', () => {
  // The names are words; these are the decisions those words promise. A ladder can agree with
  // itself in prose and still resolve the wrong way round.
  it('stage 1 is admin preview: an unset preference is ON for an admin, OFF for a member', () => {
    expect(unsetDefault({ stage: 1, isAdmin: true })).toBe(true)
    expect(unsetDefault({ stage: 1, isAdmin: false })).toBe(false)
  })

  it('stage 2 is member preview: an unset preference is ON for everybody', () => {
    expect(unsetDefault({ stage: 2, isAdmin: false }), 'stage 2 must resolve ON for a member — '
      + 'this is THE widening, and if it reads false the ladder still has the retired opt-in rung')
      .toBe(true)
    expect(unsetDefault({ stage: 2, isAdmin: true })).toBe(true)
  })

  it('stage 3 changes no exposure at all — it only drops the preview framing', () => {
    for (const isAdmin of [true, false]) {
      expect(unsetDefault({ stage: 3, isAdmin }), 'stage 3 resolved differently from stage 2. GA '
        + 'is stage 2 minus the framing; any exposure difference means the ladder grew a rung the '
        + 'ruling does not have.').toBe(unsetDefault({ stage: 2, isAdmin }))
    }
  })

  it('⭐ anyone who HAS the hub can reach the switch that turns it off', () => {
    // The recovery-path rule, expressed as the property rather than as a threshold: at every
    // stage where an unset preference gives a member the hub, the Settings card must be there.
    for (const stage of RUNGS) {
      if (unsetDefault({ stage, isAdmin: false })) {
        expect(cardVisible({ stage, isAdmin: false, everChose: false }),
          `stage ${stage} turns the hub ON for a member who never chose, and hides the only `
          + 'persistent way to turn it off. That is the dismissable-control defect this feature '
          + 'has already shipped once.').toBe(true)
      }
    }
  })
})

describe('⛔ no mode is still a teaser once members have the hub', () => {
  it(`PREVIEW_MODES is empty at stage ${ROLLOUT_STAGE}`, () => {
    if (ROLLOUT_STAGE < 2) return // admin preview may legitimately carry teasers
    expect([...PREVIEW_MODES], 'a mode is still on its preview fan while every member has the hub, '
      + 'so "Preview — more coming" is in front of everyone on that section.').toEqual([])
  })

  it('⛔ the check above can fail — PREVIEW_MODES is a real Set, not a stub', () => {
    // Non-vacuity: an import that resolved to undefined would spread to [] and pass forever.
    expect(PREVIEW_MODES).toBeInstanceOf(Set)
    expect(typeof PREVIEW_MODES.has).toBe('function')
  })
})

/**
 * ⛔⛔ "FRAMING: REMOVED" IS A CLAIM ABOUT COPY, SO IT IS CHECKED AGAINST THE COPY.
 *
 * rollout.md's stage table says stage 3 differs from stage 2 in exactly one column — `framing`,
 * `preview` -> `removed`. Every other rail in this file proves the two rungs are the SAME on
 * exposure, which is the point of GA; none of them can tell a real rung from a rename, because a
 * rename passes all of them. This is the half that can.
 *
 * ⭐ THE OTHER HALF OF THE FRAMING IS ALREADY RAILED ABOVE. `PREVIEW_MODES` drives the chip hint
 * and is asserted empty at stage >= 2. That left the Settings card's own label as the last place
 * the word reaches a member — and a label is not something a Set can speak for.
 *
 * ⛔ COMMENTS ARE STRIPPED FIRST. The component explains, in a comment, that the recovery defect
 * was hit "on the live admin preview" — prose about the feature's history, not copy on a member's
 * screen. A scan that counts that is reporting a property of itself.
 */
describe('⛔ THE FRAMING IS ACTUALLY GONE — stage 3 is not a rename', () => {
  const CARD = path.join(REPO, 'app', 'src', 'pages', 'settings', 'JoystickSettingsCard.jsx')
  const CARD_SRC = readFileSync(CARD, 'utf8')
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
  const code = stripComments(CARD_SRC)

  it('CONTROL: the card really was read, and it really renders the label this rail is about', () => {
    // NON-VACUITY. A moved file, a typo in the path, or a stripper that ate the whole body all
    // yield a source with no "preview" in it — and would pass the assertion below forever.
    expect(CARD_SRC.length, 'JoystickSettingsCard.jsx read as empty — this rail is looking at '
      + 'nothing, and its assertion would pass over an empty string').toBeGreaterThan(500)
    expect(code, 'the comment stripper removed the component body, not just its comments')
      .toMatch(/Joystick shortcuts/)
  })

  it('CONTROL: the check can FAIL — it sees the word when the word is there', () => {
    // A guard nobody has watched fire is not a guard. The needle is built by concatenation so
    // this file cannot satisfy its own search.
    const planted = code.replace('Joystick shortcuts', 'Joystick shortcuts (' + 'prev' + 'iew)')
    expect(planted, 'the planted case did not differ from the real one, so this control proves '
      + 'nothing about the assertion below').not.toBe(code)
    expect(/prev(?:)iew/i.test(planted), 'the scan cannot see the word even when it is planted '
      + 'directly in the source — the assertion below is vacuous').toBe(true)
  })

  it(`at stage ${ROLLOUT_STAGE} the card's member-facing copy ${ROLLOUT_STAGE >= 3
    ? 'says nothing about a preview' : 'may still say preview'}`, () => {
    if (ROLLOUT_STAGE < 3) return // rungs 1 and 2 ARE the preview; the word belongs there
    const hits = code.match(/prev(?:)iew/gi) || []
    expect(hits, 'stage 3 is general availability and rollout.md promises the preview framing is '
      + 'REMOVED, but the Settings card still says it in copy a member reads. A rung that renames '
      + 'itself and changes nothing is the one thing this stage could ship by accident.')
      .toEqual([])
  })
})
