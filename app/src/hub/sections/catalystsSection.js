// Catalysts (`catalysts`) — §3.6. The last section, and the one with the most findings.
//
// ⛔⛔ THE TILE IS NOT ALWAYS THERE. `Dashboard.jsx:187` reads
// `heroState === 'WEEKEND' ? <TheWeek /> : <CatalystTable />`, and `heroState` is WEEKEND on
// Saturdays, Sundays AND market holidays — roughly 114 days a year on which this mode has NO
// surface at all. That is not a bug to fix here; it is a fact the section has to be honest about.
// Because registration is mount-scoped, the hub simply falls back to the route-derived mode on
// those days and the member sees the preview fan. Nothing pretends otherwise.
//
// ⛔⛔ AND THE TILE MOUNTS THREE TIMES AT ONCE. `Dashboard.jsx` renders `{hero}` TWICE (desktop
// zone B at :224 and the mobile stack at :247) and `MorningWire.jsx:381` renders a third, compact
// copy. So a global `document.querySelector('[data-catalyst-row-id]')` would address whichever
// tree happened to come first in the document, which on a phone is the desktop one.
//
// ⭐ SCOPING IS SOLVED BY NOT QUERYING GLOBALLY AT ALL. Exactly ONE instance passes `enabled`, and
// it hands this hook a ref to its OWN root, so every node lookup is bounded by the subtree that
// registered. There is no scope attribute to keep in sync and no way for two instances to fight
// over the cursor — a second registration is impossible rather than merely discouraged.
import { createElement, useCallback, useEffect, useMemo, useState } from 'react'

import useHubMode from '../useHubMode'
import useHubCursor from '../useHubCursor'
import { modesById } from '../registry'
import { validateActionCtx } from '../contracts'
import { chartsLinkPath } from '../../lib/chartDeepLink'
import { JournalToast } from '../../pages/journal-2-0/lib/useJournalToast'

/** Where the section's toast sits: just above the hub's own resting corner. */
const TOAST_STYLE = Object.freeze({
  position: 'fixed',
  top: 'auto',
  bottom: 'calc(env(safe-area-inset-bottom) + 68px + 84px + 8px)',
  right: '16px',
  zIndex: 'var(--z-hub-open)',
})

export const CATALYSTS_MODE_ID = 'catalysts'

/** The row identity. `ticker` is the tile's own React key, and one ticker appears once per day. */
export const rowKey = (r) => String(r?.ticker || '')

/**
 * Build the fan with real bodies, and drop what the tile does not have.
 *
 * ⚰️ `catalysts.filter` IS DROPPED, and the reason is that its premise is no longer true. The
 * registry says it "opens the tile's own filter UI" — but the tag chips are rendered inline and
 * unconditionally whenever there are rows (`CatalystTable.jsx:723`, `allRows.length > 0 &&`), so
 * there is no closed UI to open. A bubble whose whole job is to reveal something already on screen
 * answers a deliberate gesture with nothing observable, which is the `chart.compare` shape.
 *
 * It stays DECLARED rather than deleted: the day the tile gains a collapsed filter sheet (a real
 * possibility on a phone), the action becomes buildable again and the declaration is already there.
 */
export function buildCatalystsFan({ symbol, flagged = false, onFlag, onNote } = {}) {
  const registryFan = modesById[CATALYSTS_MODE_ID]?.fan ?? []
  const out = []
  for (const action of registryFan) {
    switch (action.id) {
      case 'catalysts.chartIt':
        // ⭐ THE SYMBOL RIDES THE URL — nothing on /charts reads hub context. `chartsLinkPath` is
        // the ONE module that knows how to point the charts page at something; a hand-typed
        // `?sym=` here would be the second half of a pair that agrees only on the day it is
        // written. Same seam `screenerSection` uses.
        out.push({ ...action, to: symbol ? chartsLinkPath({ symbol }) : action.to })
        break
      case 'catalysts.why':
        out.push({
          ...action,
          to: symbol
            ? `/ai-search?q=${encodeURIComponent(`Why is ${symbol} moving today?`)}`
            : action.to,
        })
        break
      case 'catalysts.flag':
        out.push({
          ...action,
          label: flagged ? 'Unflag' : 'Flag',
          run: (ctx) => { validateActionCtx(ctx, 'catalystsSection catalysts.flag'); onFlag?.() },
        })
        break
      case 'catalysts.note':
        out.push({
          ...action,
          run: async (ctx) => { validateActionCtx(ctx, 'catalystsSection catalysts.note'); await onNote?.() },
        })
        break
      case 'catalysts.filter':
        break // dropped — see the block comment above
      default:
        out.push(action) // Voice and Home are HubRoot's own
    }
  }
  return out
}

/**
 * Build the section config for one render.
 *
 * @param {Object} args
 * @param {Array} args.rows      The tile's own FILTERED, SORTED rows — what the member sees.
 * @param {Object} args.cursor   `useHubCursor`'s return.
 * @param {() => void} args.reveal  Scrolls the cursor's row into view.
 */
export function createCatalystsSection({
  rows = [], cursor, reveal, onFlag, onNote, flagged = false,
}) {
  const { index, count, next, prev, scrubTo } = cursor
  const current = rows[index] || null
  const symbol = current ? rowKey(current) : null

  return {
    ...modesById[CATALYSTS_MODE_ID],
    fan: buildCatalystsFan({ symbol, flagged, onFlag, onNote }),

    // "tap: next row". ⛔ THE REVEAL IS PART OF THE STEP, not a nicety (R-15). The tile can be
    // longer than the viewport, so moving the index without scrolling leaves the member's only
    // feedback as the chip — a step nobody can see.
    onTap: (ctx) => {
      validateActionCtx(ctx, `catalystsSection (${CATALYSTS_MODE_ID}) onTap`)
      next()
      reveal?.()
    },

    onDoubleTap: (ctx) => {
      validateActionCtx(ctx, `catalystsSection (${CATALYSTS_MODE_ID}) onDoubleTap`)
      prev()
      reveal?.()
    },

    scrubAxis: 'y',

    // ⭐ THE CURSOR STORE IS THE ONE POSITION AUTHORITY, so the scrub writes through `scrubTo`
    // rather than holding a private preview index. The rows are short enough that revealing per
    // step is cheap — unlike breadth, where a step mounts two chart libraries.
    onScrub: (_ctx, scrub) => {
      if (!scrub || typeof scrub.delta !== 'number' || !Number.isFinite(scrub.delta)) return
      if (scrub.axis !== 'y' || count === 0) return
      const pos = Math.min(1, Math.max(0, (index / Math.max(1, count - 1)) + scrub.delta))
      scrubTo(pos)
    },

    onScrubCommit: () => { reveal?.() },

    // The ticker AND its tag: "NVDA · Earnings" says what the row is, not merely where it is.
    readout: () => {
      if (count === 0) return 'No catalysts'
      if (!current) return 'No catalysts'
      const tag = current.tag ? ` · ${current.tag}` : ''
      return `${rowKey(current)}${tag}`
    },
  }
}

/**
 * Mount the Catalysts section — called BY the tile instance that owns the hub.
 *
 * @param {Object} args
 * @param {Array} args.rows        The tile's filtered+sorted rows.
 * @param {boolean} args.enabled   Only ONE of the three concurrent tiles passes true.
 * @param {{current: HTMLElement|null}} args.rootRef  That instance's own root element.
 * @param {{current: {toggle: Function|null, isFlagged: Function|null}}} args.actionsRef
 * @param {(text: string) => void} [args.onToast]
 */
export default function useCatalystsHubSection({
  rows = [], enabled = false, rootRef, toggleFlag, isFlagged, createNote,
}) {
  const [msg, setMsg] = useState(null)
  const onToast = useCallback((text) => {
    setMsg(text)
    // The toast host outlives every control that writes to it (§C2's structural corollary), so a
    // timer is safe here — nothing unmounts the message in the same commit that sets it, which is
    // the defect `hubHideRestore.test.jsx`'s copy contract exists for.
    if (text) window.setTimeout(() => setMsg(null), 2600)
  }, [])

  const list = useMemo(() => (enabled ? rows : []), [enabled, rows])
  const cursor = useHubCursor(CATALYSTS_MODE_ID, list, { key: rowKey })
  const { index, paintCursor } = cursor

  /** Row nodes, bounded by the registering instance's OWN subtree. */
  const rowNodes = useCallback(
    () => Array.from(rootRef?.current?.querySelectorAll('[data-catalyst-row-id]') || []),
    [rootRef],
  )

  const reveal = useCallback(() => {
    const node = rowNodes()[cursor.index]
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [rowNodes, cursor.index])

  // Paint on every index or list change — the same contract `notebookSection` follows.
  useEffect(() => {
    if (!enabled) return
    paintCursor(rowNodes())
  }, [enabled, index, list, paintCursor, rowNodes])

  const current = list[index] || null
  const symbol = current ? rowKey(current) : null
  const flagged = !!(symbol && isFlagged?.(symbol))

  // ⭐ FLAGGING AND NOTE-WRITING ARE INJECTED, not imported here. `CatalystTable` already calls
  // `useAuth()` and (through `useUserTickerSet`) `useFlagged()`, so the tile is the one place that
  // already carries the auth dependency — taking it a second time inside the hub would add a
  // second subscription for no gain, and importing it here would make this module unusable from
  // any surface without a provider. Dependency injection keeps the section testable with plain
  // functions and keeps the auth requirement where it already lives.
  const onFlag = useCallback(() => {
    if (!symbol) return
    if (!toggleFlag) { onToast('Sign in to flag'); return }
    toggleFlag(symbol)
  }, [symbol, toggleFlag, onToast])

  const onNote = useCallback(async () => {
    const note = await createNote?.(symbol ? { ticker: symbol } : {})
    onToast(note ? 'Note created' : 'Could not create the note')
  }, [symbol, createNote, onToast])

  const config = useMemo(
    () => (enabled
      ? createCatalystsSection({ rows: list, cursor, reveal, onFlag, onNote, flagged })
      : undefined),
    [enabled, list, cursor, reveal, onFlag, onNote, flagged],
  )

  // ⛔ CONDITIONAL REGISTRATION, NOT A CONDITIONAL HOOK. `useHubMode` is always called; it
  // early-returns on a falsy config (`useHubMode.js:38`). That is what lets the OTHER two tile
  // instances mount this hook harmlessly and register nothing.
  useHubMode(config)

  return {
    // Rendered by the tile. Null when this instance is not the registering one, so the other two
    // mounts add no second live region to the page.
    hubMount: enabled
      ? createElement(JournalToast, { key: 'catalysts-toast', msg, style: TOAST_STYLE })
      : null,
  }
}
