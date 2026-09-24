import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { setCurrentAccountId } from '../pages/journal-2-0/lib/offline/currentAccount'
import { clearIntroSeen } from '../components/intro/introStorage'
import { latchNotebookFlags, FLAG_FALLBACKS } from '../pages/journal-2-0/lib/offline/notebookFlags'
import { setUnauthorizedHandler } from '../hooks/livePriceStore'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [plan, setPlan] = useState('free')
  const [subscription, setSubscription] = useState(null)
  // full-access trial: { active, days_left } from the auth responses.
  // Drives the trial banner AND counts toward isPaid (full-access equivalence).
  const [trial, setTrial] = useState(null)
  // Whether an annual Stripe price is configured (pricing page honest copy).
  const [annualAvailable, setAnnualAvailable] = useState(false)
  // Joystick hub preview kill switch, read per request by the backend and carried
  // on every auth payload (see api/routers/auth.py::_access_payload).
  // ⛔ DEFAULTS TRUE. A backend too old to send the field, or a payload that failed
  // to parse, must not silently hide a shipped feature — only an explicit `false`
  // from the server kills it. `=== false` below, never a truthiness test.
  const [hubPreviewEnabled, setHubPreviewEnabled] = useState(true)
  // Default FALSE, mirroring the server's off-by-default enablement gate:
  // an unset flag, a failed fetch, or the pre-settle first render must all
  // read as "not enabled" so the tab can never flash into view unreleased.
  const [researchTechnicalTabEnabled, setResearchTechnicalTabEnabled] = useState(false)
  // Research "Flow" tab (A13 Wave B). Default FALSE, same reason as the
  // Technical tab above: an unset flag, a failed fetch, or the pre-settle
  // first render must all read as "not enabled".
  const [researchFlowTabEnabled, setResearchFlowTabEnabled] = useState(false)
  // S7 filing watch. Default FALSE like the Technical tab: an enablement
  // gate must never default to exposed while the payload is still loading.
  const [s7FilingWatchEnabled, setS7FilingWatchEnabled] = useState(false)
  // Breadth Data Charts V2 increments (DC-2 §2). Default FALSE, same enablement
  // polarity and the same reason. ⭐ These REPLACE the build-time
  // `VITE_BREADTH_CHARTS_V2_ENABLED`: baked into the bundle, a flip was a rebuild,
  // a rollback was a deploy, and a per-owner preview was inexpressible because
  // there is only one bundle. The server also accepts `admin`, which is why the
  // value arrives already resolved for THIS user — the client is told yes or no
  // and never re-derives it from a role it would have to keep in step.
  const [breadthDcV22Enabled, setBreadthDcV22Enabled] = useState(false)
  const [breadthDcV23Enabled, setBreadthDcV23Enabled] = useState(false)
  // ⛔ WAVE K KEEPS NO REACT STATE FOR THE NOTEBOOK'S FLAGS, deliberately.
  // They are LATCHED for the life of the tab (`notebookFlags.js`), so they can
  // never change — and a `useState` that can never change is a second copy of a
  // value that already has one authority, which is how the two halves drift.
  // The Notebook asks `notebookFlag()`; nothing re-renders on a flag.

  /**
   * ⛔⛔ ONE MAP, FOUR PATHS. Every server-served flag is applied here and only
   * here: the initial `/api/auth/me` (and every `refetch` through it), login,
   * the TOTP second factor, and signup.
   *
   * ⚰️ This said "signup, login, refresh and the initial /api/auth/me" — wrong
   * twice, and a comment naming a mechanism is a claim about a run. `refetch` IS
   * the /me path, so that list double-counted one seat and omitted the real
   * fourth, the second factor. An auditor would have hunted a "refresh" seat
   * that does not exist and left `verifyTotp` unexamined.
   *
   * ⚰️ It was four hand-copied blocks of three lines. Adding Wave K's flags
   * would have made it four blocks of SEVEN — and the failure mode of that
   * shape is silent: a flag wired into three paths and missed in the fourth
   * works everywhere except the one entry point nobody tested, which is
   * typically signup. `K-R10` asserts every flag reaches all four paths.
   *
   * ⛔ EACH TEST IS WRITTEN OUT, not generalised to truthiness. `!== false` and
   * `=== true` are DIFFERENT DEFAULTS on purpose (kill switch vs enablement
   * gate) and collapsing them to `!!` would silently flip a polarity —
   * `lesson_chosen_with_nullish_consumed_with_truthiness`.
   */
  const SERVER_FLAGS = [
    ['hub_preview_enabled', (d) => d.hub_preview_enabled !== false, setHubPreviewEnabled],
    ['research_technical_tab_enabled', (d) => d.research_technical_tab_enabled === true, setResearchTechnicalTabEnabled],
    ['research_flow_tab_enabled', (d) => d.research_flow_tab_enabled === true, setResearchFlowTabEnabled],
    ['s7_filing_watch_enabled', (d) => d.s7_filing_watch_enabled === true, setS7FilingWatchEnabled],
    ['breadth_dc_v2_2_enabled', (d) => d.breadth_dc_v2_2_enabled === true, setBreadthDcV22Enabled],
    ['breadth_dc_v2_3_enabled', (d) => d.breadth_dc_v2_3_enabled === true, setBreadthDcV23Enabled],
  ]

  const applyServerFlags = (data) => {
    for (const [, read, set] of SERVER_FLAGS) set(read(data || {}))
    // ⛔ The Notebook LATCHES its own answer for the life of the tab (K-R9).
    // This call is what feeds the latch; the latch decides whether to take it.
    //
    // ⛔⛔ DERIVED FROM `FLAG_FALLBACKS`, NEVER RE-TYPED HERE. This was four
    // hand-copied keys, and a fifth (`notebook_door_guard`, Q1 fix 6's rollback
    // lever) would have had to be added in this file as well as the module that
    // already owns the list — the second-authority-over-one-value defect, in
    // the file K-R10 exists to keep honest. A key added to the module now
    // arrives here the day it lands.
    latchNotebookFlags(Object.fromEntries(
      Object.keys(FLAG_FALLBACKS).map((k) => [k, (data || {})[k]]),
    ))
  }
  const [loading, setLoading] = useState(true)
  // R2 (2026-08-22 stress repro): a TRANSIENT failure on session validation
  // (5xx, or the fetch itself threw) must never read as "logged out" — only a
  // definitive answer from the backend (ok, or a 4xx rejection) may decide
  // auth state. True only when the INITIAL /api/auth/me could not answer for
  // a transient reason; AuthGuard renders its splash + auto-retries on it
  // instead of bouncing to /login.
  const [authTransient, setAuthTransient] = useState(false)

  // Mirror of `user` for fetchUser's transient branch. fetchUser is a stable
  // useCallback([]) — reading the `user` state inside it would be a stale
  // closure, so the ref tracks the last committed value instead.
  const userRef = useRef(null)
  useEffect(() => { userRef.current = user }, [user])
  // ⛔⛔ THE SINGLE WRITER of the out-of-React account id. Six client call sites
  // advance a note's server revision and must record it in the durable landed
  // ring or the drain forks the member's note (measured 2026-09-12); two of them
  // are plain lib functions that cannot call a hook. This is the ONE place the
  // signed-in user is established, so it is the one place that publishes it.
  // ⛔ Clearing on sign-out is not optional: a stale id points a write at the
  // PREVIOUS member's IndexedDB store.
  useEffect(() => { setCurrentAccountId(user?.id ?? null) }, [user])

  const fetchUser = useCallback(async () => {
    // The backend did not ANSWER (>=500, or fetch threw). Distinct from a
    // 401/403, which is the backend answering "no".
    const transientFailure = () => {
      if (!userRef.current) {
        // Initial load: we don't KNOW yet — flag it rather than committing
        // user=null-as-logged-out.
        setAuthTransient(true)
      }
      // A refetch blip with a user already in state: keep the user and ALL
      // plan state untouched — a 503 must not log anyone out.
      return { plan: 'free', role: null, transient: true }
    }
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setPlan(data.plan)
        setSubscription(data.subscription || null)
        setTrial(data.trial || null)
        setAnnualAvailable(!!(data.billing && data.billing.annual_available))
        applyServerFlags(data)
        setAuthTransient(false)
        return { plan: data.plan, role: data.user?.role }
      } else if (res.status >= 500) {
        return transientFailure()
      } else {
        // Definitive rejection — 401/403 (and every other 4xx, unchanged
        // from today's behavior): logged out, and any transient flag clears.
        setUser(null)
        setPlan('free')
        setSubscription(null)
        setTrial(null)
        setAuthTransient(false)
        return { plan: 'free', role: null }
      }
    } catch {
      return transientFailure()
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUser() }, [fetchUser])

  // OI-17 follow-up: livePriceStore's poll has no session context of its own — a
  // 401 there means the session died mid-poll, and only AuthContext can turn that
  // into a real definitive check. Re-running fetchUser here is exactly `retryAuth`:
  // a genuine 401 flips `user` to null and AuthGuard redirects to /login (the
  // visible signal that was missing); a false alarm (a momentary blip on that one
  // endpoint) leaves the session untouched, same as any other transient failure.
  useEffect(() => {
    setUnauthorizedHandler(() => { fetchUser() })
    return () => setUnauthorizedHandler(null)
  }, [fetchUser])

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    // 2FA accounts don't get a session from the password alone — the caller
    // shows the code step and finishes via verifyTotp.
    if (data.requires_totp) return data
    setUser(data.user)
    setPlan(data.plan)
    setTrial(data.trial || null)
    setAnnualAvailable(!!(data.billing && data.billing.annual_available))
    applyServerFlags(data)
    return data
  }

  // Second half of a 2FA login: the challenge token from login() plus a
  // 6-digit authenticator code (or a backup code) → real session.
  const verifyTotp = async (challengeToken, code) => {
    const res = await fetch('/api/auth/login/totp-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_token: challengeToken, code }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const e = new Error(err.detail || 'Verification failed')
      e.status = res.status
      throw e
    }
    const data = await res.json()
    setUser(data.user)
    setPlan(data.plan)
    setTrial(data.trial || null)
    setAnnualAvailable(!!(data.billing && data.billing.annual_available))
    applyServerFlags(data)
    return data
  }

  const signup = async (email, password, displayName, referralCode) => {
    const body = { email, password, display_name: displayName }
    if (referralCode) body.referral_code = referralCode
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Signup failed')
    }
    const data = await res.json()
    setUser(data.user)
    setPlan(data.plan)
    setTrial(data.trial || null)
    setAnnualAvailable(!!(data.billing && data.billing.annual_available))
    applyServerFlags(data)
    return data
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setPlan('free')
    setTrial(null)
    clearIntroSeen()
  }

  const startCheckout = async (billing = 'monthly') => {
    const res = await fetch('/api/auth/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: billing === 'annual' ? 'annual' : 'monthly' }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to create checkout session')
    }
    const data = await res.json()
    window.location.href = data.checkout_url
  }

  const openPortal = async () => {
    const res = await fetch('/api/auth/portal', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to create portal session')
    const data = await res.json()
    window.location.href = data.portal_url
  }

  // Single source of truth for "is this a paying user" — gates every
  // API-cost feature (Compass, voice, read-aloud). Mirrors the backend
  // is_paid_or_trial() chokepoint: admin OR paid plan OR active trial.
  // Admins always pass; trial users get full feature access.
  const isPaid = user?.role === 'admin'
    || ['pro', 'premium', 'lifetime'].includes(plan)
    || !!(trial && trial.active)

  return (
    <AuthContext.Provider value={{ user, plan, isPaid, subscription, trial, annualAvailable, hubPreviewEnabled, researchTechnicalTabEnabled, researchFlowTabEnabled, s7FilingWatchEnabled, breadthDcV22Enabled, breadthDcV23Enabled, loading, authTransient, login, verifyTotp, signup, logout, startCheckout, openPortal, refetch: fetchUser, retryAuth: fetchUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * Safe paid-status read for gating API-cost UI (Compass, voice, read-aloud).
 * Returns isPaid from context, but defaults to `true` when no AuthProvider is
 * mounted — that only happens in isolated component tests, never in the real
 * app (AuthProvider wraps the root). The authoritative cost protection is the
 * backend 402 gate; this hook only decides whether to render the affordance.
 */
export function useIsPaid() {
  const ctx = useContext(AuthContext)
  return ctx ? ctx.isPaid : true
}
