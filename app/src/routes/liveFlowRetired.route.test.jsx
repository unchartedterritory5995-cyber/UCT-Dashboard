// ⚰️ /live-flow is the BULLFLOW page, and Bullflow is retired.
//
// "live flow is from massive, bullflow is no more" — owner, 2026-07-27.
//
//     DEAD:  Bullflow SSE → liveflow_worker → /api/live/alerts/recent → LiveFlow.jsx
//     LIVE:  Massive WS  → massive_ws_worker → FlowDB → /api/live/massive/recent
//                                                     → LiveFlowMassive.jsx
//
// The page was never in the nav (which correctly points at /live-massive), but
// the ROUTE still existed — so a stale bookmark landed on "Connecting to
// stream…" forever behind a red SSE 403. A broken door with a working one right
// beside it.
//
// A redirect, not a 404: the member wanted live flow, and live flow exists — it
// moved rails. This pins that decision, because "delete the route" and "point it
// somewhere useful" look identical in a diff and are very different to a member.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const appSrc = fs.readFileSync(
  path.resolve(process.cwd(), 'src/App.jsx'), 'utf8')

describe('/live-flow is retired to the Massive rail', () => {
  it('the route still exists — a bookmark must not 404', () => {
    expect(appSrc).toMatch(/path="\/live-flow"/)
  })

  it('it redirects to /live-massive rather than rendering the dead page', () => {
    const m = appSrc.match(/path="\/live-flow"\s+element=\{([^}]*)\}/)
    expect(m, '/live-flow route element not found').toBeTruthy()
    expect(m[1]).toMatch(/Navigate\s+to="\/live-massive"/)
    expect(m[1]).toMatch(/replace/)   // don't trap Back on the redirect
    expect(m[1]).not.toMatch(/<LiveFlow\s*\/>/)
  })

  it('the dead page is no longer imported by the router', () => {
    // Left imported, the chunk still ships and the page stays one edit from
    // being routed again by someone who does not know why it was unrouted.
    expect(appSrc).not.toMatch(/import\('\.\/pages\/LiveFlow'\)/)
  })

  it('the LIVE page is still routed — the control', () => {
    // Every assertion above is about removing something. If this file were
    // reading the wrong App.jsx, or the router lost both pages, the tests above
    // would still pass. Pin that the replacement is actually there.
    expect(appSrc).toMatch(/path="\/live-massive"\s+element=\{<LiveFlowMassive \/>\}/)
    expect(appSrc).toMatch(/import\('\.\/pages\/LiveFlowMassive'\)/)
  })

  it('the retirement reason is recorded at the route', () => {
    // The next person sees an unrouted page and a redirect; without the reason
    // the obvious "fix" is to route it back.
    const before = appSrc.slice(0, appSrc.indexOf('path="/live-flow"'))
    const comment = before.slice(-900)
    expect(comment.toLowerCase()).toMatch(/bullflow/)
  })
})
