// Joystick hub — useHubSettings(): thin wrapper over usePreferences() for the `joystick_hub` key.
// See docs/plans/joystick/00-master-spec-v1.3.md §8 (Phase 4 — Settings and polish).

import { useCallback, useContext, useMemo } from 'react'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import { AuthContext } from '../context/AuthContext'
import { unsetDefault } from './rolloutStage'

/**
 * Parse a stored preference value — `usePreferences`' own `parsePref`, plainly
 * imported. One authority for "what does a stored pref string mean".
 *
 * ⚠️ A test that mocks `../hooks/usePreferences` MUST declare `parsePref`.
 * Vitest's mocked module namespace is a Proxy whose `get` trap THROWS on any
 * export the mock omits, so an incomplete mock fails here with
 * "No `parsePref` export is defined on the mock" — loudly, at the first render,
 * which is the correct behaviour: the mock is wrong, not this file.
 * `Layout.pageTracking.test.jsx` and `Layout.routeSuspense.test.jsx` were
 * completed for exactly this reason (spec §2 exception (g)).
 *
 * ⚰️ An earlier draft read `parsePref` off a namespace import inside a
 * try/catch so an incomplete mock would fall back to a local copy. That put a
 * second parser in production to accommodate a defect in two test files —
 * exactly backwards. It is gone; do not reintroduce it.
 */
const parseStored = (raw) => parsePref(raw, undefined)

/** The one preference key this hook owns — one JSON blob, one key, exactly the
 *  `chart_settings` precedent (`usePreferences.js`'s `CHART_SETTINGS_KEY`). */
export const JOYSTICK_HUB_PREF_KEY = 'joystick_hub'

/**
 * Defaults for every field of the `joystick_hub` preference. Exported so the
 * settings test (and anything else that needs "what does a fresh account
 * start with") asserts against ONE authority instead of a re-typed copy.
 *
 * `overrides` is a JSON PATCH over the registry, never a copy of it — an empty
 * object here means "no overrides yet," not "no actions." A patch is what lets
 * a new default action (added to `registry.js` later) reach an existing user
 * without a migration.
 *
 * @type {{
 *   enabled: boolean,
 *   handedness: 'left'|'right',
 *   haptics: boolean,
 *   holdMs: number,
 *   travelPx: number,
 *   doubleTapMs: number,
 *   stickyFan: boolean,
 *   highContrast: boolean,
 *   traceGestures: boolean,
 *   overrides: Readonly<Record<string, unknown>>,
 * }}
 */
export const HUB_SETTINGS_DEFAULTS = Object.freeze({
  enabled: false,
  handedness: 'right',
  haptics: true,
  holdMs: 500,
  travelPx: 24,
  doubleTapMs: 280,
  stickyFan: true,
  highContrast: false,
  /**
   * ⛔ THE G0 GESTURE TRACE — A DIAGNOSTIC, OFF BY DEFAULT, ADMIN ONLY.
   *
   * Not a member setting: `resolveTraceGestures` below ANDs it with `isAdmin`, so this default
   * being `false` is the second of two independent reasons a member never records anything. It is
   * in the §8 blob rather than in localStorage because the owner flips it from the Settings screen
   * on the device under test, and everything else that screen writes lives here.
   *
   * The trace itself never leaves the device (`gestureTrace.js`): no endpoint, no beacon, no sink.
   */
  traceGestures: false,
  overrides: Object.freeze({}),
})

/**
 * Fold a possibly-partial, possibly-stale stored value over the defaults.
 * Shared by the read path and the write path so there is exactly one place
 * that knows how to complete a partial `joystick_hub` blob — a second copy of
 * this rule is a second authority over what "the settings" are.
 *
 * @param {*} stored  Already-parsed (never a JSON string — callers parse first).
 */
function withDefaults(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...HUB_SETTINGS_DEFAULTS }
  }
  return {
    ...HUB_SETTINGS_DEFAULTS,
    ...stored,
    // Shallow-merge only: `overrides`' own internal shape is a registry patch
    // this hook never interprets, so individual entries are never merged —
    // only the presence of the `overrides` key itself is defaulted.
    overrides: { ...HUB_SETTINGS_DEFAULTS.overrides, ...(stored.overrides || {}) },
  }
}

/**
 * `settings` — the current `joystick_hub` preference, always fully defaulted,
 * with `settings.enabled` resolved per the Phase 1 gate ruling (spec v1.3 §8 /
 * §B11, tightened at the gate — verbatim):
 *
 *   "Enabled if the user's stored joystick_hub.enabled is true; if unset,
 *    enabled only for role === 'admin'; otherwise disabled."
 *
 * ⛔ THERE ARE TWO ROLES: admin and member. NO FOUNDER TIER, NO TIER LADDER.
 * This block used to end "Founder rollout flips the unset-default per tier in a
 * later wave" — a rollout model that does not exist, naming a field
 * (`tier`) that `validateRegistry` actively REJECTS. Phase 2.5 Step 2 flips the
 * unset-default to true for every authenticated user; that is a one-line change
 * here, not a new gate anywhere. See docs/plans/joystick/45-phase2.5-plan.md.
 *
 * This is the ONE authority for that decision — callers (HubRoot included)
 * read `settings.enabled` and never re-derive it from `storedEnabled` +
 * role themselves, which is what makes it a single authority instead of a
 * rule two files could drift on.
 *
 * `updateHubSettings(updater)` — `updater(current) -> next`, written through
 * `setPrefMerged('joystick_hub', ...)` exactly as `chart_settings` does
 * (`usePreferences.js`). `current` handed to `updater` is already defaulted via
 * `withDefaults` AND carries the same resolved `enabled` `settings` does — so
 * an admin whose FIRST settings write is, say, `handedness`, persists their
 * currently-in-effect `enabled: true` rather than silently writing the flat
 * default `false` over their admin-on state. Returning `undefined` from
 * `updater` abandons the write (the same contract `setPrefMerged` documents).
 *
 * @returns {{ settings: object, storedEnabled: (boolean|undefined), updateHubSettings: (updater: (current: object) => (object|undefined)) => Promise<void>, loading: boolean }}
 */
export default function useHubSettings() {
  const { prefs, setPrefMerged, loading } = usePreferences()

  // `useContext(AuthContext)` directly, never the throwing `useAuth()` — this
  // hook must stay callable with no <AuthProvider> mounted (several existing
  // component tests render hub pieces in isolation); no provider ⇒ `null` ⇒
  // "no user" ⇒ not admin ⇒ disabled, which is also simply correct outside
  // the real app shell, not only a test accommodation.
  const authCtx = useContext(AuthContext)
  const isAdmin = authCtx?.user?.role === 'admin'

  const stored = useMemo(() => parseStored(prefs[JOYSTICK_HUB_PREF_KEY]), [prefs])
  const baseSettings = useMemo(() => withDefaults(stored), [stored])

  /**
   * `enabled` EXACTLY as stored — `undefined` when the user has never chosen.
   *
   * ⭐ Load-bearing: "never set" and "explicitly set to false" both read back
   * as `false` once defaults are folded in, but they mean opposite things to
   * the rollout rule above — an admin with no stored choice gets the hub, an
   * admin who turned it off must stay off. Exposed alongside `settings` (not
   * only internally) so a future Settings-page toggle can render "using the
   * admin default" differently from "explicitly off" without re-parsing the
   * preference itself.
   */
  const storedEnabled = stored && typeof stored === 'object' ? stored.enabled : undefined

  // ⛔ THE UNSET DEFAULT IS THE ROLLOUT'S, NOT THIS FILE'S. It used to read `isAdmin` inline,
  // which was correct and was also one of TWO places a rollout stage has to move at once (the
  // other is the Settings card's own visibility). Both now ask `hub/rolloutStage.js`, so a stage
  // cannot half-ship. An explicit boolean never reaches `unsetDefault` — "never chosen" and
  // "explicitly false" stay opposite things, which is the distinction this whole block exists for.
  const resolveEnabled = useCallback(
    (explicitEnabled) => (
      explicitEnabled === undefined ? unsetDefault({ isAdmin }) : !!explicitEnabled
    ),
    [isAdmin],
  )

  /**
   * ⛔⛔ `traceGestures` IS ADMIN-ONLY, AND THAT IS DECIDED HERE — not in the Settings card.
   *
   * The card hides its trace section from non-admins, but hiding a control is an EXPOSURE default,
   * never a boundary: `POST /api/auth/preferences` accepts any `{key, value}` from any
   * authenticated user with no validation (`api/routers/auth.py`), so a member can put
   * `{"traceGestures": true}` into their own blob. Resolving it against `isAdmin` at the one
   * authority every consumer reads means that write resolves to `false` anyway, and
   * `useJoystick` — which has no auth context and never will — needs no gate of its own.
   *
   * ⭐ NOT the `enabled` rule. `enabled` treats UNSET as "admin default ON"; this treats unset, and
   * every non-admin value, as OFF. A diagnostic must never be on because nobody chose.
   */
  const resolveTraceGestures = useCallback(
    (explicitTrace) => isAdmin && explicitTrace === true,
    [isAdmin],
  )

  const settings = useMemo(
    () => ({
      ...baseSettings,
      enabled: resolveEnabled(storedEnabled),
      traceGestures: resolveTraceGestures(baseSettings.traceGestures),
    }),
    [baseSettings, storedEnabled, resolveEnabled, resolveTraceGestures],
  )

  const updateHubSettings = useCallback((updater) => (
    setPrefMerged(JOYSTICK_HUB_PREF_KEY, (current) => {
      const base = withDefaults(current)
      const currentStoredEnabled = current && typeof current === 'object' ? current.enabled : undefined
      const resolvedBase = { ...base, enabled: resolveEnabled(currentStoredEnabled) }
      return typeof updater === 'function' ? updater(resolvedBase) : updater
    })
  ), [setPrefMerged, resolveEnabled])

  return { settings, storedEnabled, updateHubSettings, loading }
}
