/**
 * The Data Charts V2 gate — RUNTIME since DC-2 §2, read off the auth payload.
 *
 * ⚰️ WHAT THIS REPLACES, AND WHY THE REPLACEMENT WAS THE POINT. V2-1 shipped behind
 * `VITE_BREADTH_CHARTS_V2_ENABLED`, a build-time flag Vite bakes into the bundle. Three
 * consequences, all of them real and all of them blocking the DC-2 flip:
 *
 *   1. a flip was a REBUILD and a deploy, not a variable;
 *   2. a rollback was a deploy too — the slow lever, on the surface most likely to need
 *      the fast one;
 *   3. a per-owner preview could not be expressed AT ALL, because there is exactly one
 *      bundle and it cannot be on for one member and off for everyone else.
 *
 * ⛔⛔ AND IT WAS NEVER ON. The ledger row recorded `UNSET on every service`, baked
 * `undefined` — so `v2Enabled()` was false in production for the whole of V2-1's life.
 * Flipping the new runtime flags while this gate stayed build-time would have been the
 * repo's own recurring defect in its purest form: a feature built, tested, green, and
 * connected to nothing, with a member-visible flip that reached nobody.
 *
 * ⛔ THE SHELL NEVER RENDERS ALONE, and that is a safety property rather than a tidiness
 * one. V2-1 is explicitly NOT a chart — it is a diagnostic list of point counts. A member
 * who reached it with both increments off would LOSE the shipped V1 charts and get text
 * in their place, which is a regression dressed as a release. So the tab is V2 only when
 * at least one increment is on, and that makes "shell without a chart reaches a member"
 * impossible by construction instead of by remembering.
 *
 * ⛔ `=== true`, never truthiness, and the default on an absent context is FALSE. These
 * are ENABLEMENT gates: a payload that has not arrived, a backend too old to carry the
 * field, or a tree rendered outside `AuthProvider` must every one of them read as "not
 * released" — an unreleased surface must never flash into view while the answer is still
 * loading. (The hub's kill switch is the opposite polarity on purpose; collapsing the two
 * to `!!` would silently invert one of them.)
 *
 * ⛔ READ THROUGH `useContext`, NOT `useAuth()`. `useAuth` THROWS outside a provider, and
 * the flag-off golden renders `<BreadthCharts />` bare — a throw there would turn "the
 * gate is off" into a crash, i.e. exactly the state the golden exists to prove is calm.
 */
import { useContext } from 'react'
import { AuthContext } from '../../../context/AuthContext'

/** The payload keys, for docs and rails. ⛔ The server owns these names. */
export const DC_FLAG_KEYS = {
  v22: 'breadth_dc_v2_2_enabled',
  v23: 'breadth_dc_v2_3_enabled',
}

/** Both increments, independently. The owner reverts them separately. */
export function useDcFlags() {
  const ctx = useContext(AuthContext)
  return {
    v22: ctx?.breadthDcV22Enabled === true,
    v23: ctx?.breadthDcV23Enabled === true,
  }
}

/** Does the Data Charts tab render V2 at all? Only if an increment is on — see above. */
export function useV2Enabled() {
  const { v22, v23 } = useDcFlags()
  return v22 || v23
}

export default useV2Enabled
