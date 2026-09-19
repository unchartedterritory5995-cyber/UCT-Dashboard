// S1 CP2 — SNAPSHOT IDENTITY on the shell's key handling of the CP1 manifest.
//
// The signed scope is *"the shell reads the manifest for one property only
// (kind), with snapshot-identity on every rendered route."* Snapshot identity
// here means: for EVERY route the CP1 manifest actually declares, the resolved
// title is the SAME every time (pure, deterministic) and matches exactly what
// the manifest's `kind` + `NAV_ITEMS`'s own label say it should be -- not just
// on the handful of routes someone thought to try.
import { describe, it, test, expect } from 'vitest'
import { MANIFEST } from './manifest.js'
import { NAV_ITEMS } from '../components/NavBar.jsx'
import { titleForPath, APP_BRAND, SURFACE_PATHS } from './pageTitle.js'

const NAV_LABEL_BY_PATH = new Map(NAV_ITEMS.map((i) => [i.to, i.label]))

describe('S1 CP2 — the title is derived from the manifest + NAV_ITEMS, never guessed', () => {
  it('NON-VACUITY: the manifest actually has surface-kind literal paths to test', () => {
    const surfaces = MANIFEST.filter((m) => m.kind === 'surface' && m.pathKind === 'literal')
    expect(surfaces.length).toBeGreaterThan(10)
    // and at least some of them are covered by NAV_ITEMS, or every case below is vacuous
    const covered = surfaces.filter((m) => NAV_LABEL_BY_PATH.has(m.path))
    expect(covered.length).toBeGreaterThan(5)
    expect(covered.length).toBeLessThan(surfaces.length) // and some are NOT covered — both branches real
  })

  it('every surface-kind path with a NAV_ITEMS label resolves to "{label} — UCT Intelligence"', () => {
    const disagreements = []
    for (const m of MANIFEST) {
      if (m.kind !== 'surface' || m.pathKind !== 'literal') continue
      const label = NAV_LABEL_BY_PATH.get(m.path)
      if (!label) continue
      const got = titleForPath(m.path)
      const want = `${label} — ${APP_BRAND}`
      if (got !== want) disagreements.push({ path: m.path, got, want })
    }
    expect(disagreements, JSON.stringify(disagreements)).toEqual([])
  })

  it('a surface-kind path NOT in NAV_ITEMS returns null — never a generic guess', () => {
    const uncovered = MANIFEST.filter(
      (m) => m.kind === 'surface' && m.pathKind === 'literal' && !NAV_LABEL_BY_PATH.has(m.path)
    )
    expect(uncovered.length).toBeGreaterThan(0) // non-vacuity
    for (const m of uncovered) expect(titleForPath(m.path), m.path).toBeNull()
  })

  it('a non-surface path with NO surface ancestor returns null (child/redirect/admin)', () => {
    // Excludes 'detail' rows nested under a real surface path (/desk/article/:slug
    // under /desk) — those correctly inherit the parent surface's title, tested
    // separately below. A 'child' row is a relative route SEGMENT (e.g. "trades"),
    // never a real pathname, so it can never share a surface's prefix either way.
    const other = MANIFEST.filter((m) => {
      if (m.kind === 'surface') return false
      const parent = SURFACE_PATHS.find((p) => m.path === p || m.path.startsWith(`${p}/`))
      return !parent
    })
    expect(other.length).toBeGreaterThan(0) // non-vacuity
    for (const m of other) expect(titleForPath(m.path), `${m.path} (${m.kind})`).toBeNull()
  })

  it('a detail path nested under a real surface INHERITS that surface\'s title', () => {
    const nested = MANIFEST.filter(
      (m) => m.kind === 'detail' && SURFACE_PATHS.some((p) => m.path.startsWith(`${p}/`))
    )
    expect(nested.length).toBeGreaterThan(0) // non-vacuity
    for (const m of nested) {
      const parent = SURFACE_PATHS.find((p) => m.path.startsWith(`${p}/`))
      const label = NAV_LABEL_BY_PATH.get(parent)
      const want = label ? `${label} — ${APP_BRAND}` : null
      expect(titleForPath(m.path), m.path).toBe(want)
    }
  })

  it('a nested child path under a real surface still resolves to the SURFACE title (longest-prefix)', () => {
    expect(titleForPath('/journal/anything-not-declared')).toBe(`Journal — ${APP_BRAND}`)
    expect(titleForPath('/charts/whatever')).toBe(`Charts — ${APP_BRAND}`)
  })

  it('an entirely unknown pathname resolves to null', () => {
    expect(titleForPath('/this-route-does-not-exist')).toBeNull()
  })

  it('is a PURE function — the same input always produces the identical output', () => {
    const path = '/dashboard'
    const a = titleForPath(path)
    const b = titleForPath(path)
    expect(a).toBe(b)
    expect(a).toBe(`Dashboard — ${APP_BRAND}`)
  })
})

test('CONTROL: the matcher does not fire on a path that merely starts with the same letters', () => {
  // '/dashboards-are-fun' must NOT match '/dashboard' — this is a real route
  // boundary check, not a substring scan.
  expect(titleForPath('/dashboards-are-fun')).toBeNull()
})
