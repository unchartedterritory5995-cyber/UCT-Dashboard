/**
 * ⛔⛔ THE EXPOSURE RAIL. The facts that decide who can see the joystick hub. This program's
 * standing deploy authorization is conditional on them being intact, and this is the one rail that
 * may NEVER be edited without a hard stop (H11) — because the only way it goes red is if the answer
 * to "who sees this feature" has changed, and that is never a test's problem to absorb.
 *
 * ⭐ EDITED ONCE, UNDER A NAMED AUTHORIZATION — owner ruling 2026-09-11, "H11 — EXPOSURE RAIL,
 * STAGE-AWARE". It was rewritten from four flat source-literal assertions into a TABLE KEYED BY THE
 * ROLLOUT STAGE. Nothing was waived in the move; see "WHAT THE TWO REDS BECAME" below.
 *
 * ⛔ WHY IT HAD TO CHANGE. `hub/rolloutStage.js` made the rollout stage the single authority over
 * two of these facts, so the old assertions — which pinned literal expressions inside
 * `useHubSettings.js` and `JoystickSettingsCard.jsx` — were pinning strings that had legitimately
 * moved. A rail that reds because the answer MOVED, when the answer has not CHANGED, trains people
 * to edit it. That is the failure mode this file exists to prevent, so the fix is to make the rail
 * understand stages rather than to keep re-pinning the strings.
 *
 * ⭐ WHY SOURCE ASSERTIONS *AND* BEHAVIOUR NOW. Facts 1, 4 and 5 still pin literals: they live in
 * files this program does not own (`api/routers/auth.py`) or describe a structural property a
 * behavioural test cannot see. Facts 2 and 3 are now asserted by CALLING the real predicates,
 * because a stage-parametric function's answer is the thing worth pinning and a string no longer
 * is. Both halves still force the diff to show this file.
 *
 * ── THE TABLE CONTRACT ─────────────────────────────────────────────────────────────────────────
 *   * The row matching `ROLLOUT_STAGE` is EXECUTED against the product.
 *   * Every other row is DIGEST-PINNED, so a future stage's row cannot be quietly pre-edited into
 *     agreeing with a change that has not shipped.
 *   * A stage flip is ONE constant change in `rolloutStage.js` and NOTHING here. ⛔ If advancing a
 *     stage ever requires editing this file beyond its own table, that is H11 again — stop.
 *
 * ── WHAT THE TWO REDS BECAME (owner: "confirm each is covered, not waived") ─────────────────────
 *   Old fact 2, `'explicitEnabled === undefined ? isAdmin : !!explicitEnabled'`
 *     → stage row `unsetDefault: {admin, member}`, asserted by calling `unsetDefault()`, PLUS the
 *       call-site guard that an explicit boolean never reaches it. Strictly stronger: the old
 *       string could not tell you what the expression RETURNED.
 *   Old fact 3, `'if (!isAdmin && !everChose) return null'` + `"typeof storedEnabled === 'boolean'"`
 *     → stage row `cardVisible: {admin, memberWhoChose, memberWhoNever}`, asserted by calling
 *       `cardVisible()`, PLUS the unchanged `typeof === 'boolean'` pin, which is a different fact
 *       (what counts as "chose") and is kept verbatim.
 *
 * FIVE FACTS:
 *   1. The hub mounts ONLY on a coarse-pointer device under 1024px.
 *   2. What an UNSET preference resolves to, per stage — never silently "on".
 *   3. Who sees the Settings card, per stage — never stranding a member who already chose.
 *   4. `HUB_PREVIEW_ENABLED` defaults ON and is read PER REQUEST — a kill switch, not a launch
 *      switch, so a variable someone forgot to set is not a silent shutdown.
 *   5. The gesture trace is admin-only and off by default, and the pointer path is unchanged when
 *      it is off. ⭐ Behaviour is owned by `gestureTrace.test.js`; this row pins the one-line
 *      EXPOSURE statement only, so the two are not duplicate guards (a guard repeated is a guard
 *      unproved).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { ROLLOUT_STAGE, STAGE_NAMES, cardVisible, unsetDefault } from './rolloutStage'

const APP = resolve(process.cwd(), 'src')
const REPO = resolve(process.cwd(), '..')
const read = (p) => readFileSync(p, 'utf8')

// ── THE STAGE TABLE ───────────────────────────────────────────────────────────────────────────
// Pure data on purpose. A row that held functions could not be digest-pinned, and pinning is what
// stops a future row being edited ahead of the deploy that earns it.
const STAGE_TABLE = {
  1: {
    name: 'admin only',
    unsetDefault: { admin: true, member: false },
    cardVisible: { admin: true, memberWhoChose: true, memberWhoNever: false },
  },
  2: {
    name: 'settings card visible to members, default OFF (opt-in)',
    unsetDefault: { admin: true, member: false },
    cardVisible: { admin: true, memberWhoChose: true, memberWhoNever: true },
  },
  3: {
    name: 'unset preference resolves to ON',
    unsetDefault: { admin: true, member: true },
    cardVisible: { admin: true, memberWhoChose: true, memberWhoNever: true },
  },
}

// ⛔ DIGESTS OF EVERY ROW, PINNED. Editing any row changes its digest. The current row's digest is
// pinned too — so the row cannot be edited to match a product change instead of the other way
// round — but the current row is ALSO executed, which is the difference between the two kinds.
const ROW_DIGESTS = {
  1: '4008a0eab37e',
  2: 'dfaec4d58683',
  3: 'bd8cb93557ef',
}

const digest = (row) => createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 12)

describe('⛔ EXPOSURE — who can see the hub', () => {
  it('the files exist and are readable — the non-vacuity control', () => {
    for (const p of [
      resolve(APP, 'hub/useHubActive.js'),
      resolve(APP, 'hub/useHubSettings.js'),
      resolve(APP, 'hub/rolloutStage.js'),
      resolve(APP, 'pages/settings/JoystickSettingsCard.jsx'),
    ]) {
      expect(existsSync(p), `${p} is missing — every assertion below would pass vacuously`).toBe(true)
      expect(read(p).length).toBeGreaterThan(400)
    }
  })

  it('⛔ the stage the rail is asserting is a real, named row', () => {
    expect(
      STAGE_TABLE[ROLLOUT_STAGE],
      `ROLLOUT_STAGE is ${ROLLOUT_STAGE} and this table has no row for it. A stage cannot ship `
      + 'before its exposure facts are written down.',
    ).toBeTruthy()
    expect(
      STAGE_TABLE[ROLLOUT_STAGE].name,
      `the stage-${ROLLOUT_STAGE} row's name disagrees with STAGE_NAMES in rolloutStage.js`,
    ).toBe(STAGE_NAMES[ROLLOUT_STAGE])
  })

  it('⛔⛔ no row has been edited — including the ones that are not current', () => {
    // ⭐ THIS IS THE ANTI-PRE-EDIT GUARD. Without it, someone widening exposure at stage 3 could
    // land the table row today and the product change later, and the rail would greet the flip as
    // already-ratified. A future row is a PROMISE; changing it is a change to this file, which is
    // H11, which is the whole point.
    for (const stage of Object.keys(STAGE_TABLE)) {
      expect(
        digest(STAGE_TABLE[stage]),
        `the stage-${stage} row ("${STAGE_TABLE[stage].name}") has been edited. If this is a `
        + 'deliberate widening of who can see the hub, it needs the owner (H11) — not a digest '
        + 'update. If the row is right and the digest is stale, that means somebody changed a row '
        + 'and did not say so.',
      ).toBe(ROW_DIGESTS[stage])
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

  it(`2. at stage ${ROLLOUT_STAGE}, an UNSET preference resolves as the table says`, () => {
    const row = STAGE_TABLE[ROLLOUT_STAGE]
    const stage = `stage ${ROLLOUT_STAGE} ("${row.name}")`

    expect(
      unsetDefault({ isAdmin: true }),
      `${stage}, FACT 2: an admin with no stored preference should resolve to `
      + `${row.unsetDefault.admin}. The rollout constant and the product disagree.`,
    ).toBe(row.unsetDefault.admin)

    expect(
      unsetDefault({ isAdmin: false }),
      `${stage}, FACT 2: a MEMBER with no stored preference should resolve to `
      + `${row.unsetDefault.member}. If this flipped to true unannounced, the hub turns on for `
      + 'every member on a phone the moment it deploys, with no one having asked for it.',
    ).toBe(row.unsetDefault.member)

    // ⛔ AND AN EXPLICIT CHOICE NEVER REACHES THAT DEFAULT. This is the half the old literal
    // carried implicitly; without it, stage 3 would override a member who switched the hub OFF.
    const src = read(resolve(APP, 'hub/useHubSettings.js'))
    expect(
      src,
      `${stage}, FACT 2: useHubSettings no longer guards the rollout default behind `
      + '`explicitEnabled === undefined`, so an explicit false could be overridden by the stage.',
    ).toMatch(/explicitEnabled === undefined\s*\?\s*unsetDefault\(/)
  })

  it(`3. at stage ${ROLLOUT_STAGE}, the Settings card is visible as the table says`, () => {
    const row = STAGE_TABLE[ROLLOUT_STAGE]
    const stage = `stage ${ROLLOUT_STAGE} ("${row.name}")`

    expect(
      cardVisible({ isAdmin: true, everChose: false }),
      `${stage}, FACT 3: an admin should see the card.`,
    ).toBe(row.cardVisible.admin)

    expect(
      cardVisible({ isAdmin: false, everChose: true }),
      `${stage}, FACT 3: a member who ALREADY CHOSE must keep the card at every stage — it is `
      + 'their only way back off. Hiding it strands them ON with no recovery path.',
    ).toBe(row.cardVisible.memberWhoChose)

    expect(
      cardVisible({ isAdmin: false, everChose: false }),
      `${stage}, FACT 3: a member who never chose should ${row.cardVisible.memberWhoNever
        ? 'see' : 'NOT see'} the card. A silent widening here is a rollout nobody authorized.`,
    ).toBe(row.cardVisible.memberWhoNever)

    // Unchanged from the original rail, and a DIFFERENT fact: what counts as "chose".
    const src = read(resolve(APP, 'pages/settings/JoystickSettingsCard.jsx'))
    expect(
      src,
      "`everChose` must stay `typeof === 'boolean'`. `!== undefined` admits {\"enabled\":null} as a "
      + 'deliberate choice and shows the card to a member who never made one.',
    ).toContain("typeof storedEnabled === 'boolean'")
  })

  it('4. HUB_PREVIEW_ENABLED defaults ON and is read per request', () => {
    // ⚠️ This one lives in api/, which this program edits only under a named waiver — so the rail
    // reads it rather than asserting a diff. If the file moves, that is a finding, not a skip.
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

    // ⛔ THE KILL SWITCH OUTRANKS EVERY STAGE, and it does so by being consulted FIRST.
    const active = read(resolve(APP, 'hub/useHubActive.js'))
    const killIdx = active.indexOf('hubPreviewEnabled')
    expect(killIdx, 'useHubEligible no longer reads hubPreviewEnabled at all').toBeGreaterThan(-1)
    expect(
      active.slice(0, killIdx),
      'something is consulted BEFORE the server-side kill switch in useHubEligible. A stage that '
      + 'could re-enable a killed hub makes the no-redeploy rollback a fiction.',
    ).not.toMatch(/ROLLOUT_STAGE|rolloutStage/)
  })

  it('5. the gesture trace is admin-only and off by default', () => {
    // ⭐ EXPOSURE STATEMENT ONLY. `gestureTrace.test.js` owns the behaviour — that the pointer path
    // is unchanged when the flag is off, that the buffer stays empty, that there is no sink. This
    // asserts the one thing that belongs in an EXPOSURE rail: a member cannot turn it on.
    const src = read(resolve(APP, 'hub/useHubSettings.js'))
    expect(
      src,
      'FACT 5: the trace toggle is no longer ANDed with isAdmin at its one authority. A member can '
      + 'POST {"traceGestures": true} straight to the unvalidated preferences endpoint, so this AND '
      + 'is what stops a member recording their own pointer stream.',
    ).toMatch(/isAdmin\s*&&\s*explicitTrace === true/)
    expect(
      src,
      'FACT 5: the trace default is no longer false. Off-by-default is the second of the two '
      + 'independent reasons a member records nothing.',
    ).toMatch(/traceGestures:\s*false/)
  })
})
