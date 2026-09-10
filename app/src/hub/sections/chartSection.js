// Chart (`chart`) — §3.5. The hub's controller for the phone chart.
//
// ⭐ THE HUB NEVER SEES THE DESKTOP WORKSPACE, and that is what makes this tractable. Every
// viewport that passes the hub gate (`useHubActive.js:84`, coarse pointer <=1023px) also passes
// `ChartsWorkspace`'s own `isMobile`, with no gap between them — so this section targets
// `mobile/MobileChartsApp.jsx` and nothing else. The 3.5a scout measured that; it is not an
// assumption about which breakpoints happen to overlap.
//
// ── WHAT THE CHIP PROMISES ─────────────────────────────────────────────────────────────────────
// `registry.js` declares `tapHint: 'tap: next timeframe'`, and until this file existed nothing
// could keep it. `handleTf` (`MobileChartsApp.jsx:186`) is the real setter — it writes `opts.tf`
// through the page's own `onOptsChange`, the same path the TF picker uses.
//
// ⛔ `onTfChange` IS A NOTIFICATION, NOT A SETTER (3.5a scout). `StockChart` calls it to ANNOUNCE
// that a keyboard shortcut already changed the timeframe. Driving it would tell the page a change
// happened that never did.
//
// ── ONE AUTHORITY FOR THE LADDER ───────────────────────────────────────────────────────────────
// Order and labels come from `TF_ORDER`, `tfSortKey` and `tfLabel` — the same three the picker
// sheet uses (`MobileTfSheet.jsx:12-14`). A list retyped here would put the gesture and the sheet
// on different ladders, and "next" would land somewhere the picker does not show next.
import { createElement, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import useHubMode from '../useHubMode'
import { useHubEligible } from '../useHubActive'
import { modesById } from '../registry'
import { validateActionCtx } from '../contracts'
import PlanTradeSheet from '../PlanTradeSheet'
import { AuthContext } from '../../context/AuthContext'
import { useFlagged } from '../../hooks/useFlagged'
import { createNoteViaApi } from '../../pages/journal-2-0/lib/noteCreation'
import { JournalToast } from '../../pages/journal-2-0/lib/useJournalToast'
import { tfLabel, tfSortKey } from '../../components/chart/timeframes'
import { TF_ORDER } from '../../components/chart/keyboardShortcuts'

export const CHART_MODE_ID = 'chart'

/**
 * The ladder the gesture steps along — native timeframes plus the member's own customs, ordered by
 * the shared `tfSortKey`.
 *
 * ⚠️ Mirrors `MobileTfSheet.jsx:13-14` deliberately, and the rail asserts the two agree. The
 * FUNCTIONS are shared, so only the union expression is duplicated; the rail exists because the day
 * they diverge, "next" and the picker stop describing the same ladder.
 */
export function timeframeLadder(customTfs = [], tf = null) {
  return [...new Set([...TF_ORDER, ...(customTfs || []), ...(tf ? [tf] : [])])]
    .sort((a, b) => tfSortKey(a) - tfSortKey(b))
}

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

/** What the bridge publishes when no provider is mounted: every door closed, none broken. */
const NO_ACTIONS = Object.freeze({ toggle: null, isFlagged: null })

/**
 * ⛔ WHY A BRIDGE COMPONENT AND NOT A HOOK CALL IN THE SECTION HOOK.
 *
 * `useFlagged` calls `useAuth()`, which THROWS outside an `AuthProvider` — and a hook cannot be
 * called conditionally. `MobileChartsApp` renders under a provider in the app, but it is also
 * rendered BARE by its own suites, so a hard auth dependency inside it turns "the hub is not
 * available here" into a crashed chart. Same idiom `screenerSection.js:349` and `HubVoiceBridge`
 * already use: read the context null-safely, and only mount the component that uses the hook when
 * a provider is actually there.
 */
function ActionsBridge({ apiRef }) {
  const { toggle, isFlagged } = useFlagged()
  useEffect(() => {
    apiRef.current = { toggle, isFlagged }
    return () => { apiRef.current = NO_ACTIONS }
  }, [toggle, isFlagged, apiRef])
  return null
}

/** Where the section's toast sits: just above the hub's own resting corner. */
const TOAST_STYLE = Object.freeze({
  position: 'fixed',
  top: 'auto',
  bottom: 'calc(env(safe-area-inset-bottom) + 68px + 84px + 8px)',
  right: '16px',
  zIndex: 'var(--z-hub-open)',
})

/**
 * Build the mode's fan with real bodies, and drop what this surface cannot perform.
 *
 * ⚰️ TWO ACTIONS ARE DROPPED, each for a measured reason, on the standing ruling that an unhandled
 * `kind:'run'` is shipped with a handler or not at all:
 *
 *   · `chart.compare` — its ONLY write path is `setComparison` on `chartApiById`, whose sole caller
 *     `CompareSymbolsPanel` mounts at `ChartsWorkspace.jsx:2811`, AFTER the `if (isMobile)` return
 *     at `:2224`. Not a missing handler: the panel STRUCTURALLY cannot mount on any viewport the
 *     hub runs on, so there is nothing to call.
 *   · `chart.logTrade` — logging an EXECUTED trade happens only under `pages/journal-2-0/**`, which
 *     rule 12 forbids this branch from touching. `chart.planTrade` (a PLANNED trade) is the one
 *     this surface can honour, and it ships below.
 *
 * Both stay DECLARED in the registry — unlike `calendar.earnings`, deleted because its behaviour is
 * impossible rather than merely unreachable from here. A controller dropping what it cannot do is
 * the sanctioned mechanism (`runActionsHaveHandlers.test.js`: "a controller rebuilds and drops what
 * it cannot do").
 */
export function buildChartFan({ onFlag, onNote, onPlanTrade, flagged = false } = {}) {
  const registryFan = modesById[CHART_MODE_ID]?.fan ?? []
  const out = []
  for (const action of registryFan) {
    switch (action.id) {
      case 'chart.flag':
        out.push({
          ...action,
          label: flagged ? 'Unflag' : 'Flag',
          run: (ctx) => { validateActionCtx(ctx, 'chartSection chart.flag'); onFlag?.() },
        })
        break
      case 'chart.note':
        out.push({
          ...action,
          run: async (ctx) => { validateActionCtx(ctx, 'chartSection chart.note'); await onNote?.() },
        })
        break
      case 'chart.planTrade':
        out.push({
          ...action,
          run: (ctx) => { validateActionCtx(ctx, 'chartSection chart.planTrade'); onPlanTrade?.() },
        })
        break
      case 'chart.compare':
      case 'chart.logTrade':
        break // dropped — see the block comment above
      default:
        out.push(action) // Voice and Home are HubRoot's own
    }
  }
  return out
}

/**
 * Build the `HubSectionConfig` for one render.
 *
 * @param {Object} args
 * @param {string} args.tf      The chart's current timeframe code.
 * @param {string[]} args.tfs   The ordered ladder (see `timeframeLadder`).
 * @param {(code: string) => void} args.onTf  `MobileChartsApp`'s own `handleTf`.
 */
export function createChartSection({
  tf, tfs = [], symbol = null, onTf, onFlag, onNote, onPlanTrade, flagged = false, scrubRef,
}) {
  const count = tfs.length
  const index = Math.max(0, tfs.indexOf(tf))

  const go = (i) => {
    if (count === 0) return
    const code = tfs[clamp(i, 0, count - 1)]
    if (code && code !== tf) onTf?.(code)
  }

  const scrubStart = () => (
    scrubRef?.current ?? { pos: count > 1 ? index / (count - 1) : 0, index }
  )

  return {
    ...modesById[CHART_MODE_ID],
    fan: buildChartFan({ onFlag, onNote, onPlanTrade, flagged }),

    // "tap: next timeframe". ⛔ CLAMPED at both ends rather than wrapping: the ladder runs from
    // one minute to monthly, so wrapping would jump a member from 1m straight to 1M — the largest
    // move available — in answer to a control that says "next".
    onTap: (ctx) => {
      validateActionCtx(ctx, `chartSection (${CHART_MODE_ID}) onTap`)
      go(index + 1)
    },

    onDoubleTap: (ctx) => {
      validateActionCtx(ctx, `chartSection (${CHART_MODE_ID}) onDoubleTap`)
      go(index - 1)
    },

    scrubAxis: 'y',

    // Preview on drag, commit on release. A timeframe change refetches bars and re-frames the
    // chart, so applying every intermediate step of one drag would fire a request per pointer
    // move — the fetch-herd shape `useStaggeredMount` exists to prevent elsewhere on this page.
    onScrub: (_ctx, scrub) => {
      if (!scrub || typeof scrub.delta !== 'number' || !Number.isFinite(scrub.delta)) return
      if (scrub.axis !== 'y' || count === 0) return
      const from = scrubStart()
      const pos = clamp(from.pos + scrub.delta, 0, 1)
      scrubRef.current = { pos, index: Math.round(pos * (count - 1)) }
    },

    onScrubCommit: () => {
      const held = scrubRef?.current
      if (scrubRef) scrubRef.current = null
      if (!held) return
      go(held.index)
    },

    // The chip says the timeframe in the PICKER'S words (`tfLabel`), so the gesture and the sheet
    // read the same. It carries the symbol because a timeframe alone does not say what you are
    // looking at.
    readout: () => {
      if (count === 0) return 'No chart'
      const i = scrubRef?.current ? scrubRef.current.index : index
      const label = tfLabel(tfs[clamp(i, 0, count - 1)])
      return symbol ? `${symbol} · ${label}` : label
    },
  }
}

/**
 * The section's whole mounted footprint, armed only where the hub can actually render.
 *
 * `useHubEligible` is the hub's ONE answer to "could the control exist here at all". Where it says
 * no there is no pad and no fan, so mounting the auth-backed bridge would buy a member nothing and
 * would add a second `role="status"` region to a page whose announcements come from elsewhere.
 * Gating the mount is also what keeps this invisible to `MobileChartsApp`'s own suites, which
 * render it bare: jsdom fails the capability floor by construction.
 */
export function ChartHubMount({ apiRef, msg, onToast, planTrade, onClosePlanTrade }) {
  const auth = useContext(AuthContext)
  const eligible = useHubEligible()
  if (!eligible) return null
  return createElement(
    Fragment,
    null,
    auth ? createElement(ActionsBridge, { key: 'bridge', apiRef }) : null,
    createElement(JournalToast, { key: 'toast', msg, style: TOAST_STYLE }),
    /**
     * ⛔ SYMBOL ONLY — no entry, stop, size or side. The chart holds a price series, not a trade
     * plan: it has no account context and no levels the member has committed to. Passing a
     * fabricated level into a box someone acts on is the defect the Screener ruling
     * (2026-09-09) already settled for the same sheet.
     */
    planTrade
      ? createElement(PlanTradeSheet, {
        key: 'plan',
        ...planTrade,
        sourceMode: CHART_MODE_ID,
        onToast,
        onClose: onClosePlanTrade,
      })
      : null,
  )
}

/**
 * Mount the Chart section while the phone chart is on screen.
 *
 * @returns {{hubMount: object}} A ready-to-render element for the page. The PAGE renders it — a
 *   sheet owned by the hub would have to live above the route, and this one is about the chart's
 *   own symbol.
 */
export default function useChartHubSection({ tf, symbol, customTfs, onTf }) {
  const scrubRef = useRef(null)
  const apiRef = useRef(NO_ACTIONS)
  const [planTrade, setPlanTrade] = useState(null)
  const [msg, setMsg] = useState(null)

  const onToast = useCallback((text) => {
    setMsg(text)
    // The toast host OUTLIVES every control that writes to it (the §C2 structural corollary), so
    // clearing on a timer here is safe — nothing unmounts the message mid-frame.
    if (text) window.setTimeout(() => setMsg(null), 2600)
  }, [])

  const tfs = useMemo(() => timeframeLadder(customTfs, tf), [customTfs, tf])
  // Read through the ref so the fan does not change identity when the bridge mounts.
  const flagged = !!(symbol && apiRef.current?.isFlagged?.(symbol))

  const onFlag = useCallback(() => {
    if (!symbol) return
    const toggle = apiRef.current?.toggle
    if (!toggle) { onToast('Sign in to flag'); return }
    toggle(symbol)
  }, [symbol, onToast])

  const onNote = useCallback(async () => {
    // The same one-call seam `notebookSection` uses — never a second note-creation path.
    const note = await createNoteViaApi(symbol ? { ticker: symbol } : {})
    onToast(note ? 'Note created' : 'Could not create the note')
  }, [symbol, onToast])

  const onPlanTrade = useCallback(() => {
    if (!symbol) { onToast('No symbol on the chart'); return }
    setPlanTrade({ symbol })
  }, [symbol, onToast])

  const config = useMemo(
    () => createChartSection({
      tf, tfs, symbol, onTf, onFlag, onNote, onPlanTrade, flagged, scrubRef,
    }),
    [tf, tfs, symbol, onTf, onFlag, onNote, onPlanTrade, flagged],
  )

  useHubMode(config)

  return {
    hubMount: createElement(ChartHubMount, {
      apiRef, msg, onToast, planTrade, onClosePlanTrade: () => setPlanTrade(null),
    }),
  }
}
