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
//   1  admin only. The current, shipped state.
//   2  the Settings card is visible to members; the default stays OFF. Opt-in.
//   3  an unset preference resolves to ON. An explicit `false` is still honoured.
//
// [!] THE THREE LINES ABOVE DESCRIBE THE CODE. THEY ARE NOT THE RULING ANY MORE.
//
// Owner ruling 2026-09-13 (`docs/plans/joystick/rollout.md`, "THE STAGE DEFINITIONS") redefines
// the ladder, and the numbers DO NOT LINE UP with what this file implements:
//
//   ruled 1  unset -> isAdmin ................. == code stage 1, identical
//   ruled 2  unset -> true for EVERY user ..... == code stage 3 (`unsetDefault: stage >= 3`)
//   ruled 3  same exposure, preview framing off == nothing here; the code has no such rung
//   (retired) the opt-in rung - card visible, default OFF - is dropped by the ruling
//
// [!] SO `ROLLOUT_STAGE = 2` IN TODAY'S SOURCE SHIPS THE RETIRED OPT-IN RUNG - the hub still OFF
// for every member - under a member-impact paragraph that would say "member preview". That is the
// trap this comment exists to spring, and it is why the ruling is recorded at the call site and
// not only in a document nobody has open while editing this line.
//
// [*] NOTHING IS RENUMBERED YET, DELIBERATELY. Renumbering is a member-facing exposure change and
// belongs to the stage-2 PR (rollout.md section 3a), which Patrick merges - not to the commit that
// writes the ruling down. When that PR is written it moves TOGETHER: `ROLLOUT_STAGE`,
// `STAGE_NAMES`, `unsetDefault()`, the `STAGE_TABLE` row in `exposureGate.test.js` AND that row's
// `ROW_DIGESTS` entry, plus `rolloutStages.test.js`, which asserts the stage has not moved and is
// MEANT to go red when it does. Until then `STAGE_NAMES` below is the code's own vocabulary and is
// correct about the code; the ruling is correct about the plan; this block is the one place that
// says which is which, so the two can never quietly disagree.
//
// [!] AND THE PREVIEW FRAMING IS NOT DRIVEN FROM HERE. The chip hint comes from `PREVIEW_MODES`
// (`registry.js`), not from this constant - so ruled stage 3's "the hint becomes the real hint" is
// a change to that Set, and on 2026-09-13 it still holds `home` and `flow`. Emptying it exposes
// two full fans, which is new behaviour. See rollout.md section 2(b): an open question, not a task.
//
// ⛔ A STAGE IS A DEPLOY, DELIBERATELY. This is a build-time constant, not a Railway variable,
// because each stage is meant to be a reviewed change with a member-impact paragraph and a smoke
// run behind it — not something that can drift between what is deployed and what is configured.
//
// ⛔⛔ `HUB_PREVIEW_ENABLED` REMAINS THE KILL SWITCH AND OUTRANKS EVERY STAGE. It is read per
// request in `api/routers/auth.py::_access_payload` and takes effect on a member's next
// authenticated request with NO redeploy. Nothing here can turn the hub on for someone the
// server-side switch has turned off — see `useHubActive.js`, where that check comes first.
export const ROLLOUT_STAGE = 1

/** Human-readable, for the rollout doc and for failure messages. Keyed by stage number. */
export const STAGE_NAMES = Object.freeze({
  1: 'admin only',
  2: 'settings card visible to members, default OFF (opt-in)',
  3: 'unset preference resolves to ON',
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
  return stage >= 3
}
