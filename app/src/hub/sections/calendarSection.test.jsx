// Calendar's controller — §C3 / R-C, and the promise its chip has been making since Phase 2.
//
// `registry.js` declares `tapHint: 'tap: next day'`. Nothing could keep that until this section
// existed, and the lie was invisible only because `HubRoot` substitutes "Preview — more coming"
// while a mode sits in `PREVIEW_MODES`. This increment takes `calendar` OUT of that set, so the
// hint is now what a member actually reads — which is exactly when it has to be true.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  createCalendarSection, buildCalendarFan, dayLabelOf, dayIndexOf, toggleEventType,
  CALENDAR_MODE_ID,
} from './calendarSection'
import { modesById, fanFor, PREVIEW_MODES } from '../registry'
import { validateSectionConfig } from '../contracts'

const WEEK = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']
const DAYS = {
  '2026-09-14': { label: 'Mon Sep 14' },
  '2026-09-15': { label: 'Tue Sep 15' },
  '2026-09-16': { label: 'Wed Sep 16' },
  '2026-09-17': { label: 'Thu Sep 17' },
  '2026-09-18': { label: 'Fri Sep 18' },
}
const CTX = { mode: 'calendar', symbol: null, navigate: vi.fn() }

function make(over = {}) {
  const onDayTab = vi.fn()
  const onToggleMacro = vi.fn()
  const scrubRef = { current: null }
  const config = createCalendarSection({
    weekDates: WEEK, days: DAYS, activeDay: '2026-09-16',
    onDayTab, onToggleMacro, scrubRef, ...over,
  })
  return { config, onDayTab, onToggleMacro, scrubRef }
}

describe('the mode is live, and the chip no longer needs the preview string', () => {
  it('⛔⛔ calendar has LEFT PREVIEW_MODES — this whole file is about that flip', () => {
    expect(PREVIEW_MODES.has('calendar'), 'calendar is still preview-hidden, so its fan is still '
      + '[Voice, Home] and nothing below describes what a member sees').toBe(false)
  })

  it('⛔ the registry hint it must now keep', () => {
    expect(modesById[CALENDAR_MODE_ID].tapHint).toBe('tap: next day')
  })

  it('the config passes the section contract', () => {
    const { config } = make()
    expect(() => validateSectionConfig(config, 'calendarSection')).not.toThrow()
    expect(config.id).toBe('calendar')
  })
})

describe('tap is "next day", and it goes through the page\'s own verb', () => {
  it('⛔⛔ tap advances one day and calls onDayTab', () => {
    const { config, onDayTab } = make()          // active = index 2
    config.onTap(CTX)
    expect(onDayTab, 'tap did not move the day at all — the hint promises "next day"')
      .toHaveBeenCalledWith('2026-09-17')
  })

  it('⛔ double-tap goes back one day', () => {
    const { config, onDayTab } = make()
    config.onDoubleTap(CTX)
    expect(onDayTab).toHaveBeenCalledWith('2026-09-16'.replace('16', '15'))
  })

  it('⛔ it CLAMPS at the end of the week — it does not wrap', () => {
    // Wrapping Friday -> Monday moves the member BACKWARD four days while the chip says "next".
    // The week is the unit the page pages through (←/→ shift a week), so running off the end
    // doing nothing is the honest answer.
    const { config, onDayTab } = make({ activeDay: '2026-09-18' })
    config.onTap(CTX)
    expect(onDayTab).toHaveBeenCalledWith('2026-09-18')
    const back = make({ activeDay: '2026-09-14' })
    back.config.onDoubleTap(CTX)
    expect(back.onDayTab).toHaveBeenCalledWith('2026-09-14')
  })

  it('⛔ an EMPTY week is inert rather than throwing', () => {
    const { config, onDayTab } = make({ weekDates: [], days: {} })
    expect(() => config.onTap(CTX)).not.toThrow()
    expect(onDayTab).not.toHaveBeenCalled()
    expect(config.readout()).toBe('No week loaded')
  })

  it('a day outside the visible week starts the cursor at the first day, not at -1', () => {
    // `?d=` can point at another week while the payload has not caught up.
    expect(dayIndexOf(WEEK, '2026-10-01')).toBe(0)
    expect(dayIndexOf(WEEK, null)).toBe(0)
    expect(dayIndexOf([], 'anything')).toBe(0)
    const { config, onDayTab } = make({ activeDay: '2026-10-01' })
    config.onTap(CTX)
    expect(onDayTab).toHaveBeenCalledWith('2026-09-15')
  })
})

describe('the chip narrates the PAGE\'S day name, not one of ours', () => {
  it('⛔⛔ readout is the payload\'s own label', () => {
    const { config } = make()
    expect(config.readout(), 'the chip is not showing the day\'s own label — formatting a date '
      + 'here puts a second authority on "what is this day called" and drifts from the heading '
      + 'FeedView renders').toBe('Wed Sep 16')
  })

  it('⛔ THE CONTROL: the label comes from the DATA, so changing the data changes the chip', () => {
    // If the section formatted the ISO string itself, this would still read "Wed Sep 16".
    const { config } = make({ days: { ...DAYS, '2026-09-16': { label: 'MIDWEEK' } } })
    expect(config.readout()).toBe('MIDWEEK')
  })

  it('falls back to the ISO string when the payload carries no label', () => {
    expect(dayLabelOf({}, '2026-09-16')).toBe('2026-09-16')
    expect(dayLabelOf(null, '2026-09-16')).toBe('2026-09-16')
    expect(dayLabelOf(DAYS, null)).toBe('')
  })
})

describe('the day scrub previews and commits, like every other section', () => {
  it('⛔ a drag moves the chip WITHOUT navigating', () => {
    const { config, onDayTab } = make({ activeDay: '2026-09-14' })
    config.onScrub(CTX, { delta: 0.5, axis: 'y' })
    expect(config.readout(), 'the chip did not follow the drag').toBe('Wed Sep 16')
    expect(onDayTab, 'a mid-drag step navigated — that fights the smooth scroll and spams history')
      .not.toHaveBeenCalled()
  })

  it('⛔⛔ release commits the previewed day', () => {
    const { config, onDayTab } = make({ activeDay: '2026-09-14' })
    config.onScrub(CTX, { delta: 1, axis: 'y' })
    config.onScrubCommit(CTX)
    expect(onDayTab).toHaveBeenCalledWith('2026-09-18')
  })

  it('⛔ the WRONG axis is ignored, and a NaN delta is refused', () => {
    const { config, scrubRef } = make()
    config.onScrub(CTX, { delta: 1, axis: 'x' })
    expect(scrubRef.current, 'a horizontal drag moved a vertical scrub').toBeNull()
    config.onScrub(CTX, { delta: Number.NaN, axis: 'y' })
    expect(scrubRef.current, 'a NaN delta was written into the held position').toBeNull()
  })

  it('a hold-and-release that never moved changes nothing', () => {
    const { config, onDayTab } = make()
    config.onScrubCommit(CTX)
    expect(onDayTab).not.toHaveBeenCalled()
  })

  it('declares its axis so the no-drag range can drive it', () => {
    expect(make().config.scrubAxis).toBe('y')
  })
})

describe('the fan ships only what it can perform', () => {
  it('⛔⛔ calendar.earnings is GONE FROM THE REGISTRY, not shipped inert', () => {
    // `CalendarHeader.jsx:347` locks that event type (`const locked = type === 'earnings'`), so the
    // bubble could only ever have been silent. Dropped on the breadth.sizeRule precedent.
    const ids = (modesById[CALENDAR_MODE_ID].fan || []).map((a) => a.id)
    expect(ids, 'calendar.earnings is back in the registry. The page REFUSES to toggle that type, '
      + 'so it cannot be given a body — it is drop-or-nothing.').not.toContain('calendar.earnings')
  })

  it('⛔ THE CONTROL: the page really does lock earnings — the reason is measured, not asserted', () => {
    // ⭐ The justification for deleting a declared action must not rot into folklore. If the lock
    // is ever lifted, this goes red and the action becomes buildable again.
    const header = readFileSync(
      path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
        '..', '..', 'pages', 'calendar', 'CalendarHeader.jsx'), 'utf8')
    expect(header, 'CalendarHeader no longer locks the earnings event type — the reason '
      + 'calendar.earnings was removed no longer holds, and the action can be built.')
      .toMatch(/locked\s*=\s*type\s*===\s*'earnings'/)
  })

  it('⛔⛔ calendar.macro carries a REAL body and toggles', () => {
    const { config, onToggleMacro } = make()
    const macro = config.fan.find((a) => a.id === 'calendar.macro')
    expect(macro, 'the macro action is missing from the built fan').toBeTruthy()
    expect(typeof macro.run, 'macro is kind:run with no body — the silent-bubble defect')
      .toBe('function')
    macro.run(CTX)
    expect(onToggleMacro).toHaveBeenCalled()
  })

  it('⛔ the macro label says which way it will go', () => {
    expect(buildCalendarFan({ macroOn: false }).find((a) => a.id === 'calendar.macro').label)
      .toBe('Macro on')
    expect(buildCalendarFan({ macroOn: true }).find((a) => a.id === 'calendar.macro').label)
      .toBe('Macro off')
  })

  it('⛔ EVERY run action in the shipped fan has a body — no silent bubbles', () => {
    const { config } = make()
    const naked = fanFor(config)
      .filter((a) => a.kind === 'run' && !/\.voice$/.test(a.id) && typeof a.run !== 'function')
      .map((a) => a.id)
    expect(naked, 'these bubbles are LIVE and answer a deliberate gesture with silence').toEqual([])
  })

  it('the navigate action is passed through untouched', () => {
    const my = make().config.fan.find((a) => a.id === 'calendar.myNames')
    expect(my.kind).toBe('navigate')
    expect(my.to).toBe('/calendar/mystocks')
  })

  it('non-vacuity — the built fan is not empty and came from the registry', () => {
    const built = buildCalendarFan({})
    expect(built.length, 'the fan builder returned nothing, so every assertion above is vacuous')
      .toBeGreaterThan(2)
    expect(built.map((a) => a.id)).toContain('calendar.myNames')
  })
})

describe('toggleEventType is a pure Set operation', () => {
  it('adds, removes, and never mutates the input', () => {
    const before = new Set(['earnings'])
    const on = toggleEventType(before, 'macro')
    expect([...on].sort()).toEqual(['earnings', 'macro'])
    expect([...before], 'the caller\'s Set was mutated — it is a persisted preference')
      .toEqual(['earnings'])
    expect([...toggleEventType(on, 'macro')]).toEqual(['earnings'])
    expect([...toggleEventType(null, 'macro')]).toEqual(['macro'])
  })
})
