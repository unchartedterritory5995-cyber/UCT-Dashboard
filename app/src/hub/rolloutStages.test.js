// ⛔⛔ THE ROLLOUT'S TRUTH TABLE, AND THE PROOF THAT SHIPPING IT CHANGES NOTHING TODAY.
//
// `rolloutStage.js` moved two exposure decisions into one module so a stage cannot half-ship. The
// decisions themselves are unchanged at stage 1, and THAT is the load-bearing claim of this
// deploy: the flags go out dark. If shipping the mechanism also shipped a behaviour change, the
// stage gates would be decorative — the rollout would already have happened.
//
// So the first group below is not a truth table at all. It is an equivalence proof against the two
// expressions that were inline before, written out here as the reference implementation.
import { describe, it as vitestIt, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROLLOUT_STAGE, STAGE_NAMES, cardVisible, unsetDefault } from './rolloutStage'

let defined = 0
let executed = 0
function it(name, fn) {
  defined += 1
  return vitestIt(name, (...a) => { executed += 1; return fn(...a) })
}
it.each = (rows) => (name, fn) => {
  defined += rows.length
  return vitestIt.each(rows)(name, (...a) => { executed += 1; return fn(...a) })
}
afterAll(() => {
  expect(executed).toBeGreaterThan(0)
  expect(executed).toBe(defined)
})

const HERE = path.dirname(fileURLToPath(import.meta.url))
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

// The four people this rollout is about. `everChose` means a stored BOOLEAN — five other shapes
// all fold to "never chosen", which is why the card's own check is `typeof === 'boolean'`.
const PEOPLE = [
  ['an admin, never chose', { isAdmin: true, everChose: false }],
  ['an admin who turned it off', { isAdmin: true, everChose: true }],
  ['a member who already opted in', { isAdmin: false, everChose: true }],
  ['a member who never chose', { isAdmin: false, everChose: false }],
]

describe('⛔⛔ STAGE 1 IS A NO-OP — the flags ship dark', () => {
  // The two expressions exactly as they read before this change, kept as the reference.
  const OLD_cardVisible = ({ isAdmin, everChose }) => !(!isAdmin && !everChose)
  const OLD_unsetDefault = ({ isAdmin }) => isAdmin

  it.each(PEOPLE)('%s: card visibility is unchanged at stage 1', (_label, who) => {
    expect(cardVisible({ stage: 1, ...who })).toBe(OLD_cardVisible(who))
  })

  it.each(PEOPLE)('%s: the unset default is unchanged at stage 1', (_label, who) => {
    expect(unsetDefault({ stage: 1, isAdmin: who.isAdmin })).toBe(OLD_unsetDefault(who))
  })

  it('⛔ and the SHIPPED stage really is 1 — advancing it is a deliberate, visible edit', () => {
    // ⭐ Pinned on purpose. A stage change must break this line, so nobody advances the rollout as
    // a side effect of another edit. When a stage genuinely advances, this expectation moves in
    // the SAME commit as the member-impact paragraph that justifies it.
    expect(ROLLOUT_STAGE, 'the rollout stage moved. That is a member-visible change and it must '
      + 'arrive with its own deploy, member-impact paragraph and smoke run — see rollout.md.')
      .toBe(1)
  })
})

describe('the stage table, stated once', () => {
  // stage -> [card visible to a member who never chose, unset default for that member]
  const TABLE = [
    [1, false, false],
    [2, true, false],
    [3, true, true],
  ]

  it.each(TABLE)('stage %i: member card=%s, member unset default=%s', (stage, card, dflt) => {
    expect(cardVisible({ stage, isAdmin: false, everChose: false })).toBe(card)
    expect(unsetDefault({ stage, isAdmin: false })).toBe(dflt)
  })

  it('CONTROL: the stages are not all the same — the table discriminates', () => {
    // Without this, a `cardVisible` that returned a constant would satisfy every row above.
    const cards = TABLE.map(([s]) => cardVisible({ stage: s, isAdmin: false, everChose: false }))
    const defaults = TABLE.map(([s]) => unsetDefault({ stage: s, isAdmin: false }))
    expect(new Set(cards).size, 'card visibility is identical at every stage').toBe(2)
    expect(new Set(defaults).size, 'the unset default is identical at every stage').toBe(2)
  })

  it('every stage has a name, so rollout.md and the code cannot disagree', () => {
    for (const [stage] of TABLE) {
      expect(STAGE_NAMES[stage], `stage ${stage} has no name`).toBeTruthy()
    }
  })
})

describe('⛔⛔ the invariants no stage may break', () => {
  it.each([[1], [2], [3]])('stage %i: a member who ALREADY CHOSE keeps the card', (stage) => {
    // ⚰️ THE STRAND CASE. The card shipped ungated in PR #101, so members turned the hub on with
    // it. A stage that hid the card from them would remove their only way back — the same defect
    // as the "Hide joystick" toast that pointed at a Settings screen which did not exist yet.
    expect(cardVisible({ stage, isAdmin: false, everChose: true }),
      `stage ${stage} hides the card from a member who already chose — they are stranded ON with `
      + 'no way off').toBe(true)
  })

  it.each([[1], [2], [3]])('stage %i: an admin is never worse off', (stage) => {
    expect(cardVisible({ stage, isAdmin: true, everChose: false })).toBe(true)
    expect(unsetDefault({ stage, isAdmin: true })).toBe(true)
  })

  it('⛔ an EXPLICIT false is honoured at every stage — stage 3 is a default, not an override', () => {
    // `unsetDefault` is only ever consulted for `undefined`; this asserts the CALL SITE keeps that
    // true, because a stage-3 that overrode an explicit opt-out would be turning the hub back on
    // for someone who switched it off.
    const src = stripComments(readFileSync(path.join(HERE, 'useHubSettings.js'), 'utf8'))
    expect(src, 'useHubSettings no longer guards unsetDefault behind `explicitEnabled === '
      + 'undefined` — an explicit false could now be overridden by the rollout stage')
      .toMatch(/explicitEnabled === undefined\s*\?\s*unsetDefault\(/)
  })

  it('⛔ the kill switch still outranks the stage', () => {
    // HUB_PREVIEW_ENABLED=false must win over any stage, and it wins by being checked FIRST in
    // useHubEligible. Asserted against the source order, because a stage that could re-enable a
    // killed hub would make the no-redeploy rollback a fiction.
    const src = stripComments(readFileSync(path.join(HERE, 'useHubActive.js'), 'utf8'))
    const killIdx = src.indexOf('hubPreviewEnabled')
    expect(killIdx, 'useHubEligible no longer reads hubPreviewEnabled at all').toBeGreaterThan(-1)
    expect(src.slice(0, killIdx), 'something is consulted BEFORE the server-side kill switch in '
      + 'useHubEligible').not.toMatch(/ROLLOUT_STAGE|rolloutStage/)
  })

  it('CONTROL: both call sites really import the stage module', () => {
    // ⛔ NON-VACUITY for the whole file. If the predicates were exported but nothing consumed
    // them, every assertion above would pass while the product kept its old inline logic.
    const settings = stripComments(readFileSync(path.join(HERE, 'useHubSettings.js'), 'utf8'))
    const card = stripComments(
      readFileSync(path.join(HERE, '..', 'pages', 'settings', 'JoystickSettingsCard.jsx'), 'utf8'),
    )
    expect(settings, 'useHubSettings does not consume unsetDefault').toMatch(/from '\.\/rolloutStage'/)
    expect(card, 'JoystickSettingsCard does not consume cardVisible').toMatch(/rolloutStage'/)
    expect(settings, 'the old inline admin default is still there').not.toMatch(/undefined \? isAdmin/)
    expect(card, 'the old inline card gate is still there').not.toMatch(/!isAdmin && !everChose/)
  })
})
