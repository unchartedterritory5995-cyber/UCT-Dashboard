// Fire-and-forget tracker for landing-page conversion events.
//
// Each visitor gets a localStorage-stable UUID the first time they
// land. Subsequent events on the same browser are correlated under
// that visitor_id without requiring auth. POSTs to
// /api/landing-analytics/event; failures are silently swallowed so a
// flaky network never blocks a CTA from navigating.

const KEY = 'uct.landing.visitor_id'

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older browsers
  return 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function visitorId() {
  if (typeof window === 'undefined') return ''
  try {
    let id = window.localStorage.getItem(KEY)
    if (!id) {
      id = uuid()
      window.localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // Storage blocked (private mode, cookies off, etc.) — fall back
    // to an ephemeral per-pageload ID. Still useful in aggregate.
    return uuid()
  }
}

/**
 * Track a landing-page event.
 * @param {string} event   One of the names in ALLOWED_EVENTS server-side.
 * @param {object} [props] Optional small JSON payload.
 */
export function track(event, props) {
  if (typeof window === 'undefined') return
  try {
    const body = JSON.stringify({
      event,
      visitor_id: visitorId(),
      props: props && typeof props === 'object' ? props : undefined,
      referrer: document.referrer || undefined,
      path: window.location.pathname || undefined,
    })
    // Use sendBeacon when available so the request survives a
    // navigation (critical for CTA clicks). Falls back to fetch
    // with keepalive — both are best-effort and never block the UI.
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon('/api/landing-analytics/event', blob)
      return
    }
    fetch('/api/landing-analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Swallow — analytics must never break the page
  }
}
