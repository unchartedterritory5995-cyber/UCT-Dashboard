// app/src/components/firstRun/viewportLockedRoutes.test.js
//
// F5 fix round 2: the pages where "Meet Compass" waits because they are sized to the viewport.
// The list is not an opinion -- it is the `locked` result of a measurement committed beside the
// evidence (docs/notebook/proof/f5-r2-routes/routes-before-a0c32d2e2.json, instrument
// instrument/f5_route_scroll_measure.py: every NavBar route plus /settings at 1200x800,
// scrollbars shown, card pending vs dismissed, <main>'s scroll range and the page's bottom).
//
// How a new locked page cannot be silently missed: the rail below fails when NAV_ITEMS gains a
// route the measurement never saw, and when the declared list differs from the measured set in
// either direction -- so a new route cannot ship without a fresh measurement, and the list
// cannot be edited by hand away from it. (What it cannot see: an EXISTING page that becomes
// viewport-locked later without a nav change. Re-running the committed instrument is one command.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VIEWPORT_LOCKED_ROUTES, isViewportLockedRoute } from './viewportLockedRoutes'
import { NAV_ITEMS } from '../NavBar'

const MEASUREMENT_FILE =join(process.cwd(), '..', 'docs', 'notebook', 'proof', 'f5-r2-routes',
  // 2026-10-07: composite — the pre-fix run for every route plus the /terminal row measured on
  // c941080f0 (the file's `provenance` says why and how to replace it).
  'routes-composite-a0c32d2e2+terminal-c941080f0.json')
const m = JSON.parse(readFileSync(MEASUREMENT_FILE, 'utf8'))

describe('viewport-locked routes are the measured ones (viewportLockedRoutes.js)', () => {
  it('non-vacuity: the run completed, both controls held, and every route has a verdict', () => {
    expect(m.not_run, 'the run completed').toBeNull()
    expect(m.viewport).toBe('1200x800')
    expect(m.scrollbars).toBe('shown')
    expect(m.control.charts_classified_locked, 'positive control: /charts (78 px, fix round 1) reads LOCKED').toBe(true)
    expect(m.control.settings_classified_ordinary, 'negative control: /settings reads ordinary').toBe(true)
    expect(m.rows.map((r) => r.route)).toEqual(m.routes)
    for (const r of m.rows) {
      expect(r.class.verdict, r.route).toMatch(/^(LOCKED|ordinary)$/)
      expect(r.class.card_displayed, `${r.route}: the card was on screen with it pending`).toBe(true)
    }
    expect(m.locked.length, 'a set, not an empty list that matches anything').toBeGreaterThan(0)
  })

  it('the declared list IS the measured `locked` set (nothing added or dropped by hand)', () => {
    expect([...VIEWPORT_LOCKED_ROUTES].sort()).toEqual([...m.locked].sort())
    for (const r of m.rows) {
      expect(isViewportLockedRoute(r.route), `${r.route} measured ${r.class.verdict}`).toBe(r.class.verdict === 'LOCKED')
    }
  })

  it('every NavBar route was measured (a new route needs a new measurement)', () => {
    const measured = new Set(m.routes)
    const missing = NAV_ITEMS.map((i) => i.to).filter((to) => !measured.has(to))
    expect(missing, 're-run docs/notebook/proof/f5-r2-routes/instrument/f5_route_scroll_measure.py').toEqual([])
  })

  it('matches the exact page only: not an unmeasured child route, not a route that shares its letters', () => {
    expect(isViewportLockedRoute('/charts')).toBe(true)
    expect(isViewportLockedRoute('/charts/'), 'a trailing slash is the same page').toBe(true)
    expect(isViewportLockedRoute('/calendar/mystocks'), 'a child route is another page, unmeasured').toBe(false)
    expect(isViewportLockedRoute('/community/abc123'), 'a thread is another page, unmeasured').toBe(false)
    expect(isViewportLockedRoute('/chartsx')).toBe(false)
    expect(isViewportLockedRoute('/')).toBe(false)
    expect(isViewportLockedRoute(undefined)).toBe(false)
  })
})
