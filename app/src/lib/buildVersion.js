// Bundle identity: lets the app notice a new frontend build has shipped.
//
// The id is the entry bundle's own path (`assets/index-<hash>.js`, no leading
// slash). The server reports the same string as `/api/health` `build_id`
// (api/main.py::_bundle_build_id). Both sides are pinned to the literal
// `assets/index-abc123.js` in their tests.

function normalize(src) {
  if (typeof src !== 'string' || !src) return ''
  let path = src
  try {
    path = new URL(src, 'http://x').pathname
  } catch {
    path = src.split(/[?#]/)[0]
  }
  return path.replace(/^\/+/, '')
}

/** The page's own entry <script type="module" src="/assets/...">. '' if none. */
export function getClientBuildId(doc) {
  try {
    const scripts = doc?.querySelectorAll?.('script[type="module"][src]') || []
    for (const s of scripts) {
      const id = normalize(s.getAttribute('src'))
      if (id.startsWith('assets/')) return id
    }
  } catch {
    /* fall through */
  }
  return ''
}

/**
 * Polls health and calls onNewBuild(id) once per new server build id, after the
 * same differing id is seen on 2 consecutive polls. Empty ids and fetch
 * failures never fire (a failure also resets the streak). Not mounted here.
 */
export function createBuildWatcher({ fetchHealth, clientId, onNewBuild, onBuildCleared, intervalMs = 300000 }) {
  if (!clientId) return { stop() {} }
  let streakId = ''
  let streak = 0
  let announced = ''
  let stopped = false
  const reset = () => {
    streakId = ''
    streak = 0
  }
  const poll = async () => {
    let serverId = ''
    try {
      const body = await fetchHealth()
      serverId = typeof body?.build_id === 'string' ? body.build_id : ''
    } catch {
      reset()
      return
    }
    if (stopped) return
    if (!serverId || serverId === clientId) {
      reset()
      // The server is back on this client's own build (a rollback): withdraw what was announced.
      if (serverId && announced) {
        announced = ''
        try {
          onBuildCleared?.()
        } catch {
          /* a bad callback must not stop polling */
        }
      }
      return
    }
    if (serverId === streakId) streak += 1
    else {
      streakId = serverId
      streak = 1
    }
    if (streak >= 2 && serverId !== announced) {
      announced = serverId
      try {
        onNewBuild?.(serverId)
      } catch {
        /* a bad callback must not stop polling */
      }
    }
  }
  const timer = setInterval(poll, intervalMs)
  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
  }
}

/**
 * Which frontend build is current. Asks /build.json, the frontend's own identity, and uses its answer
 * only when it names an entry bundle (`assets/...`). Anything else falls back to /api/health: a server
 * with no /build.json route answers that path with the app shell and a 200, so "ok" alone proves
 * nothing. Same shape as fetchHealthSafe (the watcher reads `build_id`), and it never throws.
 *
 * When the two disagree, /build.json wins: /api/health names the bundle the API process was built
 * with, which is the members' frontend only while that process also serves the frontend.
 */
export async function fetchBuildSafe({ fetchImpl = (...a) => fetch(...a), timeoutMs = 10000 } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchImpl('/build.json', { cache: 'no-store', signal: ctl.signal })
    if (res && res.ok) {
      const body = await res.json()
      if (typeof body?.build_id === 'string' && body.build_id.startsWith('assets/')) return body
    }
  } catch {
    /* fall through to health */
  } finally {
    clearTimeout(timer)
  }
  return fetchHealthSafe({ fetchImpl, timeoutMs })
}

/**
 * Reads /api/health with its own 10 second limit. Never throws: any failure resolves null, which the
 * watcher treats as "no information" and resets its streak.
 */
export async function fetchHealthSafe({ fetchImpl = (...a) => fetch(...a), timeoutMs = 10000 } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchImpl('/api/health', { cache: 'no-store', signal: ctl.signal })
    if (!res || !res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
