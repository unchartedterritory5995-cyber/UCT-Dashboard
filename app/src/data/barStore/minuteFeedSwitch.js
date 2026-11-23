// app/src/data/barStore/minuteFeedSwitch.js — the per-browser switch of the minute feed into the registry.
//
// WHAT IT SWITCHES (minuteFeed.js, 2026-11-23). During the regular session the page reads the universe minute frame
// stream-ingest publishes each minute (one small GET a minute, the same file the device store's worker reads) and
// appends the bar that just closed to every regular 1-minute key the bar store already HOLDS, so a row warmed a minute
// ago is still current when the member presses it and the switch does not have to ask the server first.
//
// localStorage 'uct.minuteFeed', the device store's rule (deviceStore/switch.js):
//   '1'                      on
//   '0' / any other value    off
//   no key at all            the default (MINUTE_FEED_DEFAULT_ON: OFF, so it can be measured before anyone gets it)
// ONE DECISION PER PAGE LOAD: read when the app's bar store gets its first chart; a change of the key takes effect on
// the next load.
//
// ⭐ THE SERVER'S KILL WINS, AND THERE IS NO NEW SERVER SETTING: CHART_SPEED_ENABLED=0 (lib/chartSpeed.js, the cookie
// `uct_chart_speed=0`) turns this off over a member's own '1'. At page load through `chartSpeedKilled()` here; on a
// page left open the feed reads the cookie FRESH before every poll (minuteFeed.js) and stops for good.
//
// ⛔ NOT WITH THE DEVICE STORE ON (first slice). The device store's worker already downloads the same frames; a page
// that also ran this would download them twice. So with `uct.deviceStore` on this does not run at all (the worker
// forwarding its frames to the page is a later slice), and a member with the store on is exactly where they were.
//
// Tiny on purpose: index.js imports this statically; the feed itself (the frame decoder, the consumer, the applier) is
// one lazy chunk loaded only when the switch is on. Off, the whole cost is one localStorage read when the first chart
// mounts.

import { chartSpeedKilled } from '../../lib/chartSpeed'
import { deviceStoreEnabled } from '../deviceStore/switch'

export const MINUTE_FEED_KEY = 'uct.minuteFeed'
export const MINUTE_FEED_DEFAULT_ON = false

/** This page load's answer from the key (null: not read yet). */
let _decided = null

function _read() {
  try {
    if (typeof localStorage === 'undefined') return MINUTE_FEED_DEFAULT_ON
    const v = localStorage.getItem(MINUTE_FEED_KEY)
    if (v === null) return MINUTE_FEED_DEFAULT_ON   // no key at all: the default
    return v === '1'                                // '1' on; '0' and ANY other stored value off
  } catch {
    return false
  }
}

/** Is the minute feed into the registry on for this page load? Never throws. */
export function minuteFeedEnabled() {
  if (chartSpeedKilled()) return false      // the server's kill, over a local '1'
  if (deviceStoreEnabled()) return false    // the device store's worker already reads the frames (see the header)
  if (_decided === null) _decided = _read()
  return _decided
}

/**
 * The app store's starter (index.js getBarStore hands it to createBarStore, which calls it once, when the first chart
 * subscribes). Off: returns null and loads nothing. On: loads the feed's chunk and starts it; the handle's `stop` also
 * covers a load still in flight.
 * @param {object} store   the BarStore (its registry and `isActive`)
 * @param {object} [o]     tests: `load` (the chunk loader) and options for createPageMinuteFeed
 */
export function appMinuteFeed(store, { load = () => import('./minuteFeed.js'), feedOpts = {} } = {}) {
  if (!minuteFeedEnabled()) return null
  let feed = null
  let stopped = false
  const ready = Promise.resolve().then(load).then((m) => {
    if (stopped) return null
    feed = m.createPageMinuteFeed({ store, ...feedOpts })
    feed.start()
    // numbers only, for a measurement harness (the page has it only where the switch is on)
    try { if (typeof window !== 'undefined') window.__uctMinuteFeed = { status: () => feed.status() } } catch { /* none */ }
    return feed
  }).catch(() => null)
  return {
    /** Resolves to the running feed (null when it could not load or was stopped first). */
    ready,
    stop() { stopped = true; try { feed?.stop('disposed') } catch { /* ignore */ } },
    /** The feed's own numbers (null until it runs): what a measurement harness reads to see it is on. */
    status: () => feed?.status?.() ?? null,
  }
}

/** Tests: forget this page load's answer (a new page load). */
export function __resetMinuteFeedSwitchForTests() { _decided = null }
