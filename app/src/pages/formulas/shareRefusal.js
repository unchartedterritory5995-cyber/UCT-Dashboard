// app/src/pages/formulas/shareRefusal.js
//
// ─── WHAT A MEMBER CAN DO ABOUT EACH SHARE REFUSAL ──────────────────────────
//
// ⛔ NOT ONE SENTENCE FOR ALL OF THEM. `revoked`, `gone` and `table-version` are
// three different situations and only the last has an action the holder of the
// link can take. Collapsing them would leave somebody re-clicking a link that
// will never work, or failing to ask for the one that would.
//
// ⭐ IT LIVES HERE RATHER THAN INSIDE `SharePanel` BECAUSE TWO SURFACES NOW
// ANSWER THE SAME REFUSALS: the builder's paste box, and the page a share link
// opens. The server names the reason (`user_definitions._SHARE_STATUS` maps the
// same four onto HTTP status), and both readers must say the same thing about
// it — a second copy of this map is how a member gets told to "ask for a new
// link" on one screen and something else on the other for one server answer.
//
// ⛔ THE KEYS ARE THE SERVER'S, NOT OURS. `api/services/user_definitions.py`
// raises `ShareRefused` with exactly `not-found`, `revoked`, `gone` and
// `table-version`; `_SHARE_STATUS` in `api/routers/user_definitions.py` is the
// matching closed map on that side. A reason this module does not know falls
// through to `null`, and the caller shows the server's own message alone —
// which is the honest outcome, not a guess dressed as advice.

/** Advice per refusal reason, or `undefined` for a reason we have no action for. */
export const WHAT_TO_DO = Object.freeze({
  'not-found': 'Check you copied the whole link — the token is the part beginning `sh_`.',
  revoked: 'Ask them for a new link.',
  gone: 'They have deleted it, so there is nothing to install.',
  'table-version': 'Ask them to open it and share it again — that will re-issue the link against the current engine.',
})

/** The advice for a reason, or `''` when there is none to give. */
export function whatToDo(reason) {
  return WHAT_TO_DO[reason] || ''
}
