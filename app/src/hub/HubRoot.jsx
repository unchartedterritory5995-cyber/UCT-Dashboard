// Joystick hub — Phase 2 composition: the real gesture engine + glass UI wired
// to navigation, Home, and the Phase-2 "nothing writes yet" placeholder toast.
// See docs/plans/joystick/00-master-spec-v1.4.md §2c, §2f, §5, §8/§B11 (enable-gate).
//
// ⛔ FILE SCOPE (this session): this is one of the Wiring engineer's four files.
// `useJoystick.js`, `HubPad.jsx`, `HubKnob.jsx`, `HubFan.jsx`, `HubChip.jsx`,
// `HubScrim.jsx`, `HubActionsButton.jsx` and `hubViewport.js` are being written
// by other agents in this same worktree — imported here strictly against their
// documented contracts (see the Phase 2 spec), never modified or recreated
// from this file. If one is missing when a test runs, that test fails on
// module resolution, not on logic in this file.

import { useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useHubSettings from './useHubSettings'
import useHubActive, { useHubEligible } from './useHubActive'
import { useHub } from './HubContext'
import useKeyboardVisible from '../hooks/useKeyboardVisible'
import useHubViewport from './hubViewport'
import useJoystick from './useJoystick'
import HubPad from './HubPad'
import HubKnob from './HubKnob'
import HubFan from './HubFan'
import HubChip from './HubChip'
import HubScrim from './HubScrim'
import HubActionsButton from './HubActionsButton'
import HubVoiceBridge from './HubVoiceBridge'
import HubCoachMark from './HubCoachMark'
import HubEdgeTab, { restoreToast } from './HubEdgeTab'
import useHubSessionOverride, { hideForSession, showForSession, resolveVisible }
  from './hubSessionVisibility'
import { modesById, fanFor, isPreviewMode } from './registry'
import { RING_NAMES } from './constants'
import { useJournalToast, JournalToast } from '../pages/journal-2-0/lib/useJournalToast'

/**
 * Resolve a `HubAction.to` value to an actual router path.
 *
 * `to` is either a mode id known to the registry (`'chart'`, `'scan'`, ...) —
 * resolved to that mode's own `route` — or already a literal path
 * (`/ai-search`, `/calendar/mystocks`, `/journal/notebook?new=daily-prep`).
 * Reading the route off `modesById` rather than hand-mapping mode ids to
 * paths here keeps ONE authority over "what path does mode X live at"
 * (`registry.js`'s own `route` field — the same field `hubRoutes.js` derives
 * `SECTION_ROUTES` from) — a second table here would be exactly the
 * hand-typed-second-authority defect this codebase keeps re-finding.
 */
function resolveNavTarget(to) {
  return modesById[to]?.route ?? to
}

/**
 * The gated shell — everything that actually mounts once the hub is on.
 *
 * Renamed from Phase 1's internal `HubPad` to `HubShell`: `./HubPad.jsx` is
 * now a real, separate component (the glass gesture pad itself, per the fixed
 * contract this file composes), and keeping the old name here would collide
 * with that import. The SPLIT itself is the one piece of Phase 1 worth
 * keeping verbatim — this component exists only inside the enabled branch, so
 * `useKeyboardVisible()`, `useHubViewport()` and `useJoystick()`'s pointer
 * handlers are never even reached while the hub is gated off. See
 * `HubRoot.test.jsx`'s "off adds no listeners" suite.
 */
function HubShell({ toastMsg, setToastMsg }) {
  const keyboardVisible = useKeyboardVisible()
  const { scrimExcludeBottom, hidden: viewportHidden } = useHubViewport()
  const { settings, updateHubSettings } = useHubSettings()
  const {
    mode, activeModeConfig, symbol, timeframe, activeScan, selectedPosition,
    chartRef, livePrice, isStreaming, lastSection,
  } = useHub()
  const navigate = useNavigate()
  const padRef = useRef(null)

  const mirrored = settings.handedness === 'left'
  // ⛔ THE PREVIEW PROJECTION, not `mode.fan`. Phase 2.5 ships navigation-only plus Voice, so
  // an unwired action is ABSENT rather than present-and-inert — no "Phase 3" toast on a
  // deliberate gesture. `fanFor` is a view over the registry; Phase 3 flips `PREVIEW` and every
  // full fan returns untouched. See registry.js.
  const fan = fanFor(activeModeConfig)

  // The context object every mode's onTap/onDoubleTap/onScrub/onScrubCommit is
  // called with (registry.js's HubMode JSDoc) — Part C4's shared cross-section
  // values, read-only from here.
  const ctx = useMemo(() => ({
    mode, symbol, timeframe, activeScan, selectedPosition, chartRef, livePrice,
    isStreaming, lastSection,
  }), [mode, symbol, timeframe, activeScan, selectedPosition, chartRef, livePrice, isStreaming, lastSection])

  const goHome = useCallback(() => navigate('/dashboard'), [navigate])

  // The one place every navigate/run/confirm/home action resolves — fed by
  // BOTH doors an action can fire from: `useJoystick`'s `onFire` (a gesture)
  // and `HubActionsButton`'s `onAction` (the Peek sheet, the WCAG 2.5.1 door
  // — spec §C2). `onAction` hands this the bare action directly; `useJoystick`
  // hands its `onFire` the whole RESOLVED target instead (`{action, index,
  // angle, ring}` — its own JSDoc's `ResolveResult`), unwrapped just below.
  //
  // ⛔ PHASE 2 SCOPE: `navigate` actions only. `run` and `confirm` fire the
  // placeholder toast and touch NOTHING else — no fetch, no state write,
  // nothing. NOTHING IN PHASE 2 WRITES. Phase 3 gives `run`/`confirm` a real
  // implementation (confirm sheets, `hub_planned_trades`, etc. — master spec §6).
  const runAction = useCallback((action) => {
    if (!action) return
    if (action.kind === 'home') { goHome(); return }
    if (action.kind === 'navigate') { navigate(resolveNavTarget(action.to)); return }
    if (action.kind === 'run' && action.id.endsWith('.voice')) {
      voiceConnectRef.current?.('compass')
      return
    }
    // ⛔ UNREACHABLE IN THE PREVIEW, AND THAT IS THE POINT. `fanFor` shows only navigate,
    // Voice and Home, so nothing can reach here; `validatePreview` fails the build if a
    // `run`/`confirm` action ever appears in a preview fan. The Phase-2 "Phase 3" toast is
    // deliberately gone — a control that answers a gesture with "not yet" teaches the member
    // the product is unfinished.
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[hub] preview reached an unwired action:', action.id)
    }
  }, [goHome, navigate, setToastMsg])

  // DEVICE-TEST HOOK (Phase 2 device suite). Records which action actually fired
  // so a real-device run can assert the OUTCOME of a gesture without depending on
  // a navigation that may be async or a toast that auto-dismisses.
  //
  // ⭐ Written imperatively on the DOM node, NOT through state, and deliberately:
  // routing it through `useState` would add a render on every fire, and the thing
  // this attribute exists to measure is whether ten consecutive fan selections
  // land on the intended target. An instrument that changes the render behaviour
  // of the gesture it measures is not an instrument. React never reconciles this
  // attribute because no JSX prop declares it.
  const rootRef = useRef(null)
  // Filled by HubVoiceBridge only while a VoiceProvider is mounted; null elsewhere, so the
  // Voice action no-ops on a route with no voice rather than throwing.
  const voiceConnectRef = useRef(null)
  const fireResolved = useCallback((resolved) => {
    rootRef.current?.setAttribute('data-hub-last-action', resolved?.action?.id ?? '')
    runAction(resolved?.action)
  }, [runAction])

  // `useJoystick` hands `onScrub` `{delta, axis}` (its own JSDoc) — passed
  // through to the mode's own `onScrub(ctx, delta)` (registry.js's HubMode
  // JSDoc) as one object rather than picked apart here, since some modes need
  // the axis (chart mode scrubs symbol vertically, bar position horizontally
  // — spec Part C "chart") and others don't.
  const handleScrub = useCallback((scrub) => {
    activeModeConfig?.onScrub?.(ctx, scrub)
  }, [activeModeConfig, ctx])

  const handleScrubCommit = useCallback(() => {
    activeModeConfig?.onScrubCommit?.(ctx)
  }, [activeModeConfig, ctx])

  // `useJoystick`'s `mode` param is the whole HubMode config (it reads
  // `mode.fan`/`mode.onTap`/`mode.onDoubleTap` itself) — NOT the bare mode id
  // string the presentational components below take.
  const { handlers, state, dismiss } = useJoystick({
    mode: activeModeConfig,
    settings,
    padRef,
    onFire: fireResolved,
    onScrub: handleScrub,
    onScrubCommit: handleScrubCommit,
    onHome: goHome,
  })

  // The coach mark dismisses itself the first time the fan actually opens — see HubCoachMark.
  const usedRef = useRef(false)
  if (state.open) usedRef.current = true

  const dismissCoachMark = useCallback(() => (
    updateHubSettings((cur) => (cur.coachMarkSeen ? undefined : { ...cur, coachMarkSeen: true }))
  ), [updateHubSettings])

  /**
   * "Hide joystick" — the member's opt-out (Phase 2.5 Step 2; present for admins in Step 1 so
   * the path is exercised before members ever see it).
   *
   * ⚠️ Until Phase 4 ships the Settings toggle there are exactly TWO ways back: an admin flips
   * this member's stored preference, or the member clears it. Both are documented in
   * 45-phase2.5-plan.md, because a member told only "soon" with no path is a support ticket
   * nobody can close — which is why the toast names Settings rather than promising a date.
   */
  /**
   * "Hide joystick" — SESSION ONLY. It does NOT write the preference.
   *
   * ⛔ IT USED TO. The preference write made hiding a one-way door: the Settings toggle ships
   * in Phase 4, so the only routes back were an admin editing the database or the member
   * pasting a fetch() into a devtools console. The owner hit exactly that on the live admin
   * preview. A control that can be dismissed and not recovered is a defect regardless of how
   * good the toast copy is.
   *
   * A PERSISTENT hide now exists only where a real re-enable path sits beside it — the
   * Settings → Joystick toggle.
   */
  const hideHub = useCallback(() => {
    setToastMsg('Hidden for now. Reload to bring it back.')
    hideForSession()
  }, [setToastMsg])

  const hidden = keyboardVisible || viewportHidden
  const selectedId = state.target?.action?.id ?? null

  // An action whose `requires` the current context cannot satisfy renders DISABLED, never hidden
  // (spec 2e). Hiding it teaches the member the action does not exist; dimming it with a reason
  // teaches them what to select first. Computed here because this is the only place that holds
  // both the fan and the live context.
  const disabledIds = useMemo(() => {
    // ⚠️ `chart` is deliberately absent. Satisfying it means "the chart is mounted and ready to
    // accept commands", and Wave 0 established that no such signal reaches the host: StockChart
    // has `onBarsReady`, but neither ChartPane nor the mobile shell wires it through. Reading
    // `chartRef.current` here would ALSO be a refs-during-render violation (React cannot
    // re-render when a ref changes, so the answer would be stale as often as not). Rather than
    // guess, chart-requiring actions stay enabled; in Phase 2 they fire the "Phase 3" toast
    // anyway. Phase 3 wires a real readiness signal and adds it here.
    const have = { symbol: !!symbol, position: !!selectedPosition }
    return fan
      .filter((a) => (a.requires ?? []).some((r) => have[r] === false))
      .map((a) => a.id)
  }, [fan, symbol, selectedPosition])
  const targetColor = state.target?.action?.color ?? null

  return (
    <div
      ref={rootRef}
      data-testid="hub-root"
      hidden={hidden}
      style={{
        position: 'fixed',
        right: '24px',
        bottom: 'calc(env(safe-area-inset-bottom) + 68px)',
        width: '84px',
        height: '84px',
        // ⛔ THE Z-INDEX BELONGS ON THIS ELEMENT, AND WITHOUT IT THE WHOLE SCALE IS INERT.
        //
        // `position: fixed` ALWAYS creates a stacking context — z-index `auto` or not. So
        // every `--z-hub-*` value inside this subtree (pad 360, fan/scrim 401, …) is scoped
        // to a context that itself sat at level `auto` (0) in the root context. The children
        // were ordering themselves correctly relative to each other and the whole hub was
        // painting at 0 relative to the page.
        //
        // Measured, three devices, `/charts` (Pixel 8, Galaxy S24, iPhone 15 Pro): a
        // Lightweight Charts canvas at `z-index: 2` covered the pad at every sample from
        // 250ms after load, so `elementFromPoint` at the pad centre returned CANVAS and the
        // pointerdown never reached the pad — a hub that rendered and could not be touched.
        // With this one line, `padIsTop` is true at every sample on all three, including
        // while the chart's canvas count grows 0 → 3 → 15.
        //
        // ⭐ It only ever "worked" elsewhere because nothing on those routes competed above
        // 0. The documented ordering (hub-open > backdrop > hub-rest > fab) was never
        // actually in effect against the rest of the app — `hubZIndex.test.js` compared the
        // TOKENS, which were always correct, and could not see that the subtree carrying
        // them was pinned to one rung.
        zIndex: state.open ? 'var(--z-hub-open)' : 'var(--z-hub-rest)',
      }}
    >
      <HubVoiceBridge connectRef={voiceConnectRef} />
      <HubCoachMark
        show={!settings.coachMarkSeen}
        used={usedRef.current}
        mirrored={mirrored}
        onDismiss={dismissCoachMark}
      />
      <HubScrim
        open={state.open}
        excludeBottom={scrimExcludeBottom}
        onPointerDown={dismiss}
      />
      <HubFan
        actions={fan}
        mirrored={mirrored}
        open={state.open}
        sticky={state.sticky}
        selectedId={selectedId}
        disabledIds={disabledIds}
      />
      <HubPad ref={padRef} {...handlers} mirrored={mirrored} />
      <HubKnob
        mode={activeModeConfig?.label}
        modeColor={activeModeConfig?.color}
        targetColor={targetColor}
        offset={state.knob}
        pressing={state.pressing}
        dragging={state.dragging}
        mirrored={mirrored}
      />
      {/* Phase 3 wires a real per-mode scrub readout (e.g. "NVDA · 4H") off
          `activeModeConfig`; nothing in the registry produces one yet, so this
          stays null (HubChip falls back to the literal "Scrub" while scrubbing). */}
      <HubChip
        label={activeModeConfig?.label}
        // Preview chip hint (Phase 2.5): the mode name still leads, but the hint says what
        // this build IS rather than what tap does — most taps do nothing until Phase 3.
        // Per-mode: a section that has shipped its real fan shows its real hint again.
        tapHint={isPreviewMode(activeModeConfig?.id)
          ? 'Preview — more coming' : activeModeConfig?.tapHint}
        scrubbing={state.scrubbing}
        scrubReadout={null}
        open={state.open}
        // Named only while a ring is actually selected, so the chip does not assert a
        // ring during a sticky-open fan nobody is touching.
        ringName={state.dragging && state.ring != null ? RING_NAMES[state.ring] : null}
        mirrored={mirrored}
        modeColor={activeModeConfig?.color}
      />
      {/* onFeedback MUST be wired. With the hub enabled, Layout.jsx stops mounting
          `<FeedbackWidget/>` on touch (spec 2c), so an unwired entry here would not be a
          deferred feature — it would DELETE the only feedback path a mobile member has.
          `/support` is that path's real destination (FeedbackWidget's own menu offers it),
          so navigating there keeps the capability whole without reaching into that
          component's internals. Phase 4 can restore the richer in-place form. */}
      <HubActionsButton
        onHide={hideHub}
        mode={activeModeConfig?.label}
        actions={fan}
        mirrored={mirrored}
        disabledIds={disabledIds}
        onAction={runAction}
        onFeedback={() => navigate('/support?view=new&prefill=%5Bjoystick%20preview%5D%20')}
      />
      <JournalToast msg={toastMsg} />
    </div>
  )
}

/**
 * Whether the hub will actually render, given EVERY mount condition —
 * `settings.enabled` plus every capability/viewport check below. Exported so
 * `Layout.jsx`'s orb/feedback-FAB gate (spec §2 exception (a)) reads this ONE
 * authority instead of re-deriving "is the hub really showing" — a second
 * copy of these checks would be exactly the kind of drift this codebase keeps
 * re-discovering. Because these conditions already require
 * `(max-width: 1023px) and (pointer: coarse)`, a `true` result also means the
 * viewport is touch by construction — there is no separate "and the viewport
 * is touch" test left to duplicate at the call site.
 */

/**
 * Mounted once, inside `<HubProvider>` as a sibling of `<FeedbackWidget/>` in
 * Layout.jsx (§2c). Renders `null` unless `useHubActive()` says every mount
 * condition holds — see that hook for the full list.
 */
export default function HubRoot() {
  const eligible = useHubEligible()
  const { settings } = useHubSettings()
  const sessionOverride = useHubSessionOverride()
  const [toastMsg, setToastMsg] = useJournalToast()

  // Not eligible = kill switch off, or a browser/viewport that cannot draw the hub. Nothing
  // renders, not even the restore tab: there would be nothing to restore.
  if (!eligible) return null

  if (resolveVisible(settings.enabled, sessionOverride)) {
    return <HubShell toastMsg={toastMsg} setToastMsg={setToastMsg} />
  }

  // Hidden — but never unrecoverable. `persistent` only changes the toast copy: the tab itself
  // appears for a session hide and a stored hide alike, because a member who cannot find their
  // way back does not care which kind it was.
  const persistent = !settings.enabled
  const mirrored = settings.handedness === 'left'
  return (
    <>
      <HubEdgeTab
        persistent={persistent}
        mirrored={mirrored}
        onRestore={() => { showForSession(); setToastMsg(restoreToast(persistent)) }}
      />
      {/* ⛔ BOTH BRANCHES MUST RENDER A TOAST, AND THE STATE MUST LIVE ABOVE THEM.
          Every message this feature shows is set by an action that FLIPS THIS BRANCH:
          "Hide joystick" unmounts HubShell, the restore tab unmounts this. So a toast owned
          by either branch is destroyed in the same commit that fills it — the message renders
          for zero frames and the member is told nothing. Both of those shipped: the hide toast
          ("Hidden for now. Reload to bring it back.") is the ONLY thing that says the hide is
          temporary, and the restore toast is the only thing that names Settings → Joystick.

          ⭐ The anchor is explicit because `.toast` is `position:absolute` with `top:30px`.
          Inside `hub-root` that resolves against the hub's own 84px box; out here the nearest
          positioned ancestor is the page, which would pin it to the top of the document. The
          `style` escape hatch is JournalToast's own documented answer for a different anchor. */}
      <JournalToast
        msg={toastMsg}
        style={{
          position: 'fixed',
          top: 'auto',
          bottom: 'calc(env(safe-area-inset-bottom) + 68px + 24px + 52px)',
          right: mirrored ? 'auto' : '16px',
          left: mirrored ? '16px' : 'auto',
          zIndex: 'var(--z-hub-rest)',
        }}
      />
    </>
  )
}
