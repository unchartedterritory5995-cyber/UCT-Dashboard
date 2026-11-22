// What a /r/* render page does with the server's answer to a read.
//
// The render token is checked in ONE place: the server (`_check_token` in
// api/routers/render_panels.py). A render page forwards the `?token=` from its own address on each
// /api/r/* read and shows its refused state when the server answers 401 or 403. The page holds no
// copy of the token and makes no comparison of its own.
//
// A page that draws only what its address carries has no data read to take that answer from, so
// it asks the server once before it draws (`useServerTokenCheck` below).
//
// HISTORY, kept as a record:
//   - Fourteen render pages each carried their own copy of a comparison against a value the build
//     compiled in. Fourteen copies of a guard cannot be mutation-proved and cannot be rotated in
//     one step, so the guard moved into this file and the pages called it
//     (memory: lesson_a_guard_repeated_is_a_guard_unproved).
//   - 2026-09-13 (rotation): the comparison here accepted the previous token as well as the current
//     one, because the value was compiled in at BUILD time and a rotation was therefore a rebuild.
//     chart-renderer was never in this path: it navigates to whatever URL it is handed and never
//     validates anything (OI-19).
//   - 2026-11-19: one check, on the server, instead of two copies of it. This file stopped reading
//     the two build variables (the render token and its "previous" slot), `Dockerfile.web` stopped
//     passing them to the build, and each page takes the server's answer. Accepting the previous
//     token while a rotation is in flight is now the server's alone
//     (`CHART_RENDER_TOKEN_PREVIOUS` on `web`).
//
// Rail: `renderTokenSource.rail.test.js` (beside this file) fails if a file under app/src reads
// either build variable again.
import { useEffect, useState } from 'react'

// True when the server refused a read: 403 is the render token check, 401 a missing session.
export function renderRefused(status) {
  return status === 401 || status === 403
}

// The line a panel page shows for a failed read. `reason` is whatever the read rejected with: the
// HTTP status of an answered request, or an error object when nothing usable came back.
export function renderReadError(reason) {
  return renderRefused(reason) ? 'unauthorized' : 'data unavailable'
}

const SERVER_CHECK_MS = 4000

// Asks the server whether the address's token is accepted, for a page with no data read of its
// own. It makes ONE read of an existing token-checked route and ignores the body.
//   'pending'  no answer yet
//   'refused'  the server answered 401 or 403
//   'ok'       any other answer, a request that failed, or no answer within four seconds
// It fails open on purpose: a slow or failing server must never cost a render. The first outcome
// is the decision; an answer that arrives after the four seconds changes nothing.
export function useServerTokenCheck(token) {
  const [answer, setAnswer] = useState({ token: null, state: 'pending' })
  useEffect(() => {
    let open = true // false once decided, and after unmount or a change of token
    let timer = null
    const controller = new AbortController()
    const decide = (state) => {
      if (!open) return
      open = false
      clearTimeout(timer)
      setAnswer({ token, state })
    }
    timer = setTimeout(() => { decide('ok'); controller.abort() }, SERVER_CHECK_MS)
    const url = `/api/r/chart-settings?token=${encodeURIComponent(token)}`
    new Promise((resolve) => { resolve(fetch(url, { signal: controller.signal })) })
      .then((r) => decide(renderRefused(r.status) ? 'refused' : 'ok'))
      .catch(() => decide('ok'))
    return () => {
      open = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [token])
  return answer.token === token ? answer.state : 'pending'
}
