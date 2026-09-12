/**
 * The signed-in account id, readable OUTSIDE React.
 *
 * ⛔⛔ WHY THIS EXISTS. Six client call sites advance a note's server revision
 * (`POST|DELETE /hero`, `POST /embeds` ×3, and the editor's own save). Every one
 * of them must record that revision in the durable landed ring, or the drain
 * asks "is this server copy ours?", answers **no** about our own write, and forks
 * the member's note — measured 2026-09-12, six doors, two endpoint families.
 *
 * ⛔ Two of those six are plain lib functions (`captureTargets.js`,
 * `importer/enrichment.js`). They cannot call a hook, and threading an account id
 * to them would change `targetsFor()`'s public signature plus four component call
 * sites — six patches to avoid one mechanism, which is the opposite of the ruling.
 *
 * ⛔⛔ IT IS A SINGLE WRITER, AND THAT IS THE WHOLE DESIGN.
 * `AuthContext` establishes the user; it is the ONLY caller of the setter. This
 * module **derives** from that one authority and never restates it
 * (`lesson_a_second_authority_over_one_value`). If you are tempted to call
 * `setCurrentAccountId` from a second place, you are creating the defect this
 * file was written to avoid.
 *
 * ⛔ IT MUST BE CLEARED ON SIGN-OUT. A stale id would point a write at the
 * previous member's IndexedDB store. `AuthContext` clears it whenever `user`
 * becomes null, and a rail drives exactly that.
 */

let accountId = null

/** ⛔ ONE CALLER ONLY: `AuthContext`. */
export function setCurrentAccountId(id) {
  accountId = id || null
}

/** → the signed-in account id, or `null` when nobody is signed in. */
export function getCurrentAccountId() {
  return accountId
}
