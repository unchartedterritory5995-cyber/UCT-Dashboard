/**
 * Journal 2.0 — P4 one-shot localStorage migration runner (Task A6).
 *
 * The 8→5 nav restructure (P4) is a ROUTING change: the new surfaces GROUP the
 * SAME existing tab components under new nested routes, so every
 * localStorage-backed pref key still resolves under the new shell unchanged.
 * There is therefore NOTHING to migrate in P4 — this runner is a flag-gated
 * NO-OP scaffold that establishes the one-shot pattern + a version flag ready
 * for P5.
 *
 * Keys that keep resolving verbatim under the new shell (same components):
 *   uct.j2.selectedAccountId · uct.j2.openPositions.columns ·
 *   uct.j2.tradeJournal.columns · uct.j2.calendar.mode ·
 *   uct.j2.analytics.section.<id> · uct.j2.holdings.sort ·
 *   uct.j2.nudges.dismissed.<accountId>
 *
 * P5 (the unified Trades single-table + server pagination + day-page
 * unification) is where the REAL migration lands: the two column-pref keys
 * `uct.j2.openPositions.columns` + `uct.j2.tradeJournal.columns` collapse into
 * one `uct.j2.trades.columns`. That key-merge will be added here as a guarded
 * step (bump the flag) when P5 ships — see the P5 plan.
 *
 * Contract: idempotent (running twice = no-op), non-destructive (never deletes
 * or overwrites an existing key), never throws (storage may be unavailable).
 */

// Version flag. Its presence ('1') means every migration through v4 has run.
// Bump to a new key (e.g. uct.j2.migrated.v5) ONLY when adding a migration step
// that must re-run for browsers already past v4.
export const J2_MIGRATION_FLAG = 'uct.j2.migrated.v4'

/**
 * Run any pending one-shot J2 localStorage migrations exactly once.
 *
 * @returns {boolean} true when this call performed the (first) migration;
 *   false when it was a no-op because migrations already ran, or because
 *   storage is unavailable.
 */
export function runJ2LocalStorageMigrations() {
  try {
    if (localStorage.getItem(J2_MIGRATION_FLAG) === '1') return false // already migrated

    // ── P4 migrations: NONE ──────────────────────────────────────────────
    // The nav moved; the storage keys did not. Nothing to copy / rename /
    // merge. (P5's openPositions.columns + tradeJournal.columns →
    // trades.columns merge will be added here, guarded by this same flag,
    // when the unified Trades table ships.)

    localStorage.setItem(J2_MIGRATION_FLAG, '1')
    return true
  } catch {
    // Storage unavailable (private mode / quota) → report "nothing migrated";
    // never throw on the JournalLayout mount path.
    return false
  }
}
