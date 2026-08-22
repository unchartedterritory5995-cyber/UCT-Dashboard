/** The track-record route is DERIVED from trackRecordLink.js (one authority)
 *  and mounted OUTSIDE AuthGuard — the wire test the share-link posture
 *  requires (a severed wire is invisible to component tests). */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TRACK_RECORD_ROUTE, trackRecordPath, buildTrackRecordUrl } from './lib/trackRecordLink'

describe('track-record share link', () => {
  it('path builder and route describe the same shape', () => {
    expect(TRACK_RECORD_ROUTE).toBe('/track/:token')
    expect(trackRecordPath('abc123')).toBe('/track/abc123')
    expect(buildTrackRecordUrl('abc123')).toMatch(/\/track\/abc123$/)
  })

  it('App.jsx mounts the route FROM the link module (no hand-typed copy)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../App.jsx'), 'utf-8')
    expect(src).toContain('path={TRACK_RECORD_ROUTE}')
    expect(src).toContain("from './pages/journal-2-0/lib/trackRecordLink'")
    // the route must sit OUTSIDE the AuthGuard block — it appears before
    // the "Protected routes" marker
    const routeAt = src.indexOf('path={TRACK_RECORD_ROUTE}')
    const guardAt = src.indexOf('Protected routes — require authentication')
    expect(routeAt).toBeGreaterThan(0)
    expect(guardAt).toBeGreaterThan(routeAt)
  })
})
