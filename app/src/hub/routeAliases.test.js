// V20 (2026-10-10) — the hub `calendar` mode resolves inside the UCT Terminal shell.
// A member the `terminal-next` cohort admits is redirected from /calendar to /terminal/calendar;
// the registry's `routeAliases` lets the hub recognise its calendar mode there, while navigation
// (and the declared section order) keep the one primary route.
import { describe, it, expect } from 'vitest'
import { modes, modesById, validateRegistry } from './registry'
import { ROUTE_ALIASES, SECTION_ROUTES, isSectionRoute, routeToModeId } from './hubRoutes'
import { DECLARED_SECTION_ORDER } from './sections/homeSection'

describe('hub route aliases', () => {
  it('/terminal/calendar resolves to the calendar mode; /calendar still does', () => {
    expect(routeToModeId('/terminal/calendar')).toBe('calendar')
    expect(routeToModeId('/calendar')).toBe('calendar')
    expect(isSectionRoute('/terminal/calendar')).toBe(true)
  })

  it('CONTROL: the rest of the shell is not a section (exact match, never a prefix)', () => {
    expect(routeToModeId('/terminal')).toBeNull()
    expect(routeToModeId('/terminal/calendar/x')).toBeNull()
    expect(isSectionRoute('/terminal')).toBe(false)
  })

  it('an alias is never a navigation target, and never a second entry in the section order', () => {
    expect(modesById.calendar.route).toBe('/calendar')
    expect(SECTION_ROUTES['/terminal/calendar']).toBeUndefined()
    expect(ROUTE_ALIASES).toEqual({ '/terminal/calendar': 'calendar' })
    expect(DECLARED_SECTION_ORDER.filter((id) => id === 'calendar')).toHaveLength(1)
  })

  it('the shipped registry validates', () => {
    expect(validateRegistry(modes)).toEqual([])
  })

  it('validateRegistry refuses an alias that collides, has no primary route, or is not a path', () => {
    const cal = modesById.calendar
    const clash = validateRegistry([...modes.filter((m) => m.id !== 'calendar'), { ...cal, routeAliases: ['/charts'] }])
    expect(clash.some((p) => p.includes('route alias "/charts" is already a route of chart'))).toBe(true)
    const noRoute = validateRegistry([...modes.filter((m) => m.id !== 'calendar'), { ...cal, route: undefined }])
    expect(noRoute.some((p) => p.includes('routeAliases needs a primary route'))).toBe(true)
    const notPath = validateRegistry([...modes.filter((m) => m.id !== 'calendar'), { ...cal, routeAliases: ['terminal'] }])
    expect(notPath.some((p) => p.includes('must be a pathname'))).toBe(true)
  })
})
