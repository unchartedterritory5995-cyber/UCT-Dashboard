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
