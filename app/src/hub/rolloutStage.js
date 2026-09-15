// The staged member rollout — ONE place that answers "who gets the hub, and who can turn it on".
//
// ⛔⛔ THE TWO EXPOSURE ANSWERS USED TO LIVE IN TWO FILES, and they had to agree by hand:
// `useHubSettings.js` decided what an UNSET preference resolves to, and `JoystickSettingsCard.jsx`
// decided whether the card is even rendered. Both are exposure decisions, both are pinned by
// `exposureGate.test.js`, and a rollout moves them TOGETHER. Two authorities over one rollout is
// how a stage half-ships — the card appears for members while the default still says admin, or
// worse the reverse.
//
// ── THE STAGES ────────────────────────────────────────────────────────────────────────────────
//   1  admin preview. An unset preference resolves to `isAdmin`.
//   2  member preview. An unset preference resolves to `true` for every authenticated user.
//   3  general availability. Stage 2 minus the preview framing; exposure is identical.
//
// [!] AN EXPLICIT STORED PREFERENCE ALWAYS WINS, AT EVERY STAGE, IN BOTH DIRECTIONS. Nothing
// above reaches a member who has already chosen - `unsetDefault` is only consulted when there is
// no stored value at all.
//
// [x] THE RETIRED RUNG. Until 2026-09-13 stage 2 meant "the Settings card is visible to members,
// the default stays OFF" - an opt-in rung - and stage 3 meant "an unset preference resolves to
// ON". The owner ruling of that date DELETED the opt-in rung and renumbered: today's stage 2 is
// what used to be stage 3. Recorded because a reader who remembers the old numbering would read
// `ROLLOUT_STAGE = 2` as "members can opt in" when it now means "members have it".
//
// The ruling of record is `docs/plans/joystick/rollout.md`, "THE STAGE DEFINITIONS". This file and
// that document are parsed against each other by `stageLadderAgreement.test.js` - rung count AND
// meanings - so the two can never quietly disagree again.
//
// [*] `cardVisible` DID NOT MOVE IN THE RENUMBERING, and that is worth one line because it looks
// like an omission. Its rule is already `isAdmin || everChose || stage >= 2`: under the old ladder
// stage 2 was the opt-in rung where members first needed the card, and under the new one stage 2
// is member preview where they first need the OPT-OUT. Different reason, same threshold. A member
// who has the hub can always reach the switch that turns it off - that is the recovery-path rule
// this feature has already broken once.
//
// [!] AND THE PREVIEW FRAMING IS NOT DRIVEN FROM HERE. The chip hint comes from `PREVIEW_MODES`
// (`registry.js`), not from this constant - so "the hint becomes the real hint" was always a change
// to that Set, never to this number.
//
// [*] ROLLOUT.MD SECTION 2(b) IS ANSWERED, AND STAGE 2 ANSWERED IT. That section asked whether
// emptying the Set at stage 3 would land two full fans together with the GA flip, and recommended
// shipping `home` and `flow` on their own increments first so that stage 3 stays copy-only. The
// stage-2 commit took that recommendation one rung early: it emptied `PREVIEW_MODES` in the same
// change as the widening, and stated the one member-visible consequence in the diff rather than
// leaving it to a screenshot - `home.wire` inner -> OUTER, `home.journal` outer -> INNER. So by the
// time this constant reads 3 the Set is ALREADY empty, and `stageLadderAgreement.test.js` asserts
// that at every stage >= 2.
//
// [!] WHICH LEAVES EXACTLY ONE THING FOR STAGE 3 TO DROP: the word "(preview)" in the Settings
// card's own label. That is the whole of rollout.md's "framing: removed", it is copy and nothing
// else, and `stageLadderAgreement.test.js` goes red if the word is still in the component at stage
// 3 - so this rung cannot ship as a rename with nothing behind it.
//
// ⛔ A STAGE IS A DEPLOY, DELIBERATELY. This is a build-time constant, not a Railway variable,
// because each stage is meant to be a reviewed change with a member-impact paragraph and a smoke
// run behind it — not something that can drift between what is deployed and what is configured.
//
// ⛔⛔ `HUB_PREVIEW_ENABLED` REMAINS THE KILL SWITCH AND OUTRANKS EVERY STAGE. It is read per
// request in `api/routers/auth.py::_access_payload` and takes effect on a member's next
// authenticated request with NO redeploy. Nothing here can turn the hub on for someone the
// server-side switch has turned off — see `useHubActive.js`, where that check comes first.
export const ROLLOUT_STAGE = 3

/** Human-readable, for the rollout doc and for failure messages. Keyed by stage number. */
export const STAGE_NAMES = Object.freeze({
  1: 'admin preview',
  2: 'member preview',
  3: 'general availability',
})

/**
 * Is the Joystick settings card rendered for this user?
 *
 * ⛔ `isAdmin || everChose` IS STAGE-INDEPENDENT, AND THAT IS THE POINT. The card shipped ungated
 * in PR #101, so members already turned the hub on with it. Hiding it from them at any stage would
 * strand someone who is ON with no way off — the exact defect CLAUDE.md records against this
 * feature ("a dismissable control needs a recovery path IN THE SAME COMMIT"). Removing someone's
 * only way back is the same error as never giving them one, so no stage may do it.
 */
export function cardVisible({ stage = ROLLOUT_STAGE, isAdmin = false, everChose = false } = {}) {
  if (isAdmin || everChose) return true
  return stage >= 2
}

/**
 * What an UNSET preference resolves to. An explicit boolean never reaches here.
 *
 * ⭐ STAGE 3 RETURNS A FLAT `true`, AND DOES NOT RE-TEST THE POINTER. The charter's wording is
 * "default on for coarse-pointer members", and coarse-pointer is ALREADY the gate in
 * `useHubActive.js::useHubEligible` — every caller of this value passes through it. Re-testing the
 * pointer here would put a second opinion about "is this a touch device" beside the one that
 * already decides, which is the defect this repo keeps re-finding. One authority: eligibility.
 */
export function unsetDefault({ stage = ROLLOUT_STAGE, isAdmin = false } = {}) {
  if (isAdmin) return true
  // [!] 2, NOT 3. The renumbering of 2026-09-13 made stage 2 the member-preview rung; this
  // threshold IS the widening, and `exposureGate.test.js` pins it by digest so it cannot move
  // without the owner. Stage 3 changes no exposure at all - it only drops the preview framing.
  return stage >= 2
}
