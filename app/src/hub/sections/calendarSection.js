// Calendar (`calendar`) — route `/calendar`. The hub's controller for the week.
//
// ⚰️ WHY THIS ARRIVED LATE. Calendar was a §6 OMISSION, not a §7 error (R-C): §7 declares the mode
// and §C3 gives it a fan, so the mode always existed — the build order simply never listed it. It
// stayed dark through Increments 2-4 with `fanFor` returning `[Voice, Home]`, and this is its
// increment.
//
// ── WHAT THE CHIP PROMISES, AND WHAT NOW KEEPS IT ──────────────────────────────────────────────
// `registry.js` declares `tapHint: 'tap: next day'`. Until this file existed nothing could keep
// that: a registry-declared mode has no `onTap`, and the promise was invisible only because
// `HubRoot` substitutes "Preview — more coming" for a mode still in `PREVIEW_MODES`
// (`tapHintIsBacked.test.js` names calendar as one of the three living on borrowed time). Taking
// the mode OUT of that set without shipping the handler is what would have made the chip lie.
//
// ⭐ EVERY MOVE GOES THROUGH THE PAGE'S OWN `onDayTab`, and that is deliberate. Its comment reads
// "ONE verb in every view: 'take me to that day'. Table scrolls; Board/Month switch to Table and
// scroll — a primary control must never no-op." A hub tap on the Board view would otherwise move a
// cursor nobody can see. Reusing that verb means the hub inherits the view-switch for free and
// cannot drift from what the page's own day tabs do.
//
// ── THE LABEL IS THE PAGE'S, NOT OURS ──────────────────────────────────────────────────────────
// `readout()` returns `days[ds].label` — the SAME string `FeedView.jsx:109` renders as the day
// heading (`{(day.label || ds).toUpperCase()}`). Formatting a date here would put a second
// authority on "what is this day called", and the chip would drift from the heading it is meant to
// be narrating the moment the payload's format changed.
import { useMemo, useRef } from 'react'

import useHubMode from '../useHubMode'
import { modesById } from '../registry'
import { validateActionCtx } from '../contracts'

export const CALENDAR_MODE_ID = 'calendar'

/** The day's own displayed name, or the ISO string when the payload has none. Mirrors
 *  `FeedView.jsx:109` exactly — see the header note on why this is not formatted here. */
export function dayLabelOf(days, ds) {
  if (!ds) return ''
  return days?.[ds]?.label || ds
}

/** Index of `activeDay` within the week, clamped into range; 0 when it is not this week. */
export function dayIndexOf(weekDates, activeDay) {
  if (!Array.isArray(weekDates) || weekDates.length === 0) return 0
  const i = weekDates.indexOf(activeDay)
  return i >= 0 ? i : 0
}

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

/**
 * The mode's fan, with the two actions that need a body given one.
 *
 * ⚰️ `calendar.earnings` IS NOT HERE, AND IT IS NOT AN OVERSIGHT — it was removed from the registry
 * in the same commit. The page LOCKS that event type: `CalendarHeader.jsx:347` reads
 * `const locked = type === 'earnings'; if (locked) return`, so an "Earnings" bubble could only ever
 * have been a gesture that does nothing. That is the `breadth.sizeRule` / `chart.compare` shape,
 * and the standing ruling on it is ship the handler or drop the action.
 */
export function buildCalendarFan({ macroOn = false, onToggleMacro } = {}) {
  const registryFan = modesById[CALENDAR_MODE_ID]?.fan ?? []
  const out = []
  for (const action of registryFan) {
    switch (action.id) {
      case 'calendar.macro':
        out.push({
          ...action,
          // The label carries the STATE, because this is a toggle and a bubble that reads the same
          // in both positions tells the member nothing about which way it will go.
          label: macroOn ? 'Macro off' : 'Macro on',
          run: (ctx) => {
            validateActionCtx(ctx, 'calendarSection calendar.macro')
            onToggleMacro?.()
          },
        })
        break
      default:
        // `calendar.myNames` is `kind: 'navigate'` and needs no body; Voice and Home are
        // HubRoot-owned. Passing them through untouched is the point — this switch adds run
        // bodies, it does not re-decide the fan.
        out.push(action)
    }
  }
  return out
}

/**
 * Build the section config for one render.
 *
 * @param {Object} args
 * @param {string[]} args.weekDates    Ordered ISO day strings for the visible week.
 * @param {Object}   args.days         The page's day payload, keyed by ISO string (carries `label`).
 * @param {string|null} args.activeDay The `?d=` day, if any.
 * @param {(ds: string) => void} args.onDayTab  The page's one "take me to that day" verb.
 * @param {boolean}  args.macroOn      Whether the macro event type is currently shown.
 * @param {() => void} args.onToggleMacro
 * @param {{current: null|{pos: number, index: number}}} args.scrubRef
 */
export function createCalendarSection({
  weekDates = [], days = {}, activeDay = null, onDayTab,
  macroOn = false, onToggleMacro, scrubRef,
}) {
  const count = weekDates.length
  const index = dayIndexOf(weekDates, activeDay)

  const go = (i) => {
    if (count === 0) return
    const ds = weekDates[clamp(i, 0, count - 1)]
    if (ds) onDayTab?.(ds)
  }

  const scrubStart = () => (
    scrubRef?.current ?? { pos: count > 1 ? index / (count - 1) : 0, index }
  )

  return {
    ...modesById[CALENDAR_MODE_ID],
    fan: buildCalendarFan({ macroOn, onToggleMacro }),

    // "tap: next day". ⛔ CLAMPED, NOT WRAPPED. The week is the unit the page pages through
    // (←/→ shift a week, `Calendar.jsx:643`), so wrapping from Friday to Monday would move the
    // member BACKWARD four days while the chip said "next". Running off the end does nothing,
    // which is the honest answer for a control scoped to one week.
    onTap: (ctx) => {
      validateActionCtx(ctx, `calendarSection (${CALENDAR_MODE_ID}) onTap`)
      go(index + 1)
    },

    onDoubleTap: (ctx) => {
      validateActionCtx(ctx, `calendarSection (${CALENDAR_MODE_ID}) onDoubleTap`)
      go(index - 1)
    },

    // Vertical, the default — the week reads as a list down the page in Table view, which is the
    // view `onDayTab` puts the member in.
    scrubAxis: 'y',

    // ⭐ PREVIEW ON DRAG, COMMIT ON RELEASE — the same shape breadth uses, for the same reason.
    // `onDayTab` writes a search param and smooth-scrolls; doing that on every pointer move would
    // fight the scroll animation and spam history. What the member reads mid-drag is the chip.
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
      if (!held) return // a hold-and-release that never moved changes nothing
      go(held.index)
    },

    // The chip narrates the day the thumb is over during a drag, and the live day otherwise.
    readout: () => {
      if (count === 0) return 'No week loaded'
      const i = scrubRef?.current ? scrubRef.current.index : index
      return dayLabelOf(days, weekDates[clamp(i, 0, count - 1)])
    },
  }
}

/**
 * Mount the Calendar section for as long as `/calendar` is on screen.
 *
 * Called from `Calendar.jsx` with the values it already computes — this hook derives nothing about
 * the calendar itself, which is what keeps the hub from becoming a second opinion about which week
 * is showing.
 */
export default function useCalendarHubSection({
  weekDates, days, activeDay, onDayTab, macroOn, onToggleMacro,
}) {
  // A ref, not state: a scrub emits a call per pointer move and re-rendering this page on each one
  // is the jank the deferred commit exists to avoid.
  const scrubRef = useRef(null)

  const config = useMemo(
    () => createCalendarSection({
      weekDates, days, activeDay, onDayTab, macroOn, onToggleMacro, scrubRef,
    }),
    [weekDates, days, activeDay, onDayTab, macroOn, onToggleMacro],
  )

  useHubMode(config)
}

/** Exported for the page: toggling macro is a Set write, and the page owns the Set. */
export function toggleEventType(eventTypes, type) {
  const next = new Set(eventTypes || [])
  if (next.has(type)) next.delete(type)
  else next.add(type)
  return next
}

