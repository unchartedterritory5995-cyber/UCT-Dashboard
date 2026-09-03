// app/src/components/navGroups.test.js
//
// FORMAT + non-restatement only. Route RESOLUTION (does every navigable `to`
// land on a real page, and does `/catalysts` — a documented match-prefix-only
// entry — deliberately NOT resolve) lives in navGroups.route.test.jsx, which
// renders the real App at the URLs the shared module actually produces
// (mirroring app/src/pages/dashboard/doors.route.test.jsx).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { NAV_GROUPS, navigableTargets } from './navGroups'
import { NAV_ITEMS } from './NavBar'

// ⚠️ readFileSync(new URL('./X.js', import.meta.url)) throws "The URL must be
// of scheme file" on this Windows/vitest setup — use fileURLToPath + join
// (established pattern, see NavBar.test.jsx / AlertBell.delivery.test.jsx).
const HERE = dirname(fileURLToPath(import.meta.url))

test('four groups, every route unique across them', () => {
  expect(NAV_GROUPS.map(g => g.key)).toEqual(['home', 'markets', 'charts', 'journal'])
  const all = NAV_GROUPS.flatMap(g => g.routes)
  expect(new Set(all).size).toBe(all.length)
})

// (The MobileTabBar derivation case lived here until the bar's removal,
// 2026-09-01 — NavBar below and navGroups.route.test.jsx carry the rail.)

test('NavBar derives its group headings from the shared module too', () => {
  const src = readFileSync(join(HERE, 'NavBar.jsx'), 'utf8')
  expect(src).toContain('navGroups')
})

// The plan for this task listed `/catalysts` among the markets routes as
// though it were a real page. It is not — the real route is
// `/catalysts/history`. It stays in NAV_GROUPS as a match-prefix (so a visit
// to /catalysts/history still lights the Markets tab/heading) but must never
// become a navigable `to`. navigableTargets() is the ONLY thing either
// consumer treats as a destination.
test('navigableTargets() never includes the /catalysts match-prefix-only entry', () => {
  expect(navigableTargets()).not.toContain('/catalysts')
})

test('navigableTargets() is exactly one `to` per group, plus the home/wire split', () => {
  // routes[0] of every group, plus routes[1] of home (the free-tier Wire
  // tab) — five targets total for four groups.
  expect(navigableTargets().sort()).toEqual(
    ['/calendar', '/dashboard', '/journal', '/model-book', '/morning-wire'].sort(),
  )
})

// Every desktop nav item must land in exactly one of the four shared groups
// (or the shared module has drifted from what NavBar actually links to) —
// this is what makes the "16 unlabeled icons" rail groupable at all.
test('every NavBar item resolves to exactly one NAV_GROUPS bucket', () => {
  for (const item of NAV_ITEMS) {
    const owners = NAV_GROUPS.filter((g) => g.routes.includes(item.to))
    expect(owners.length, `${item.to} (${item.label}) is not in any NAV_GROUPS bucket`).toBe(1)
  }
})
