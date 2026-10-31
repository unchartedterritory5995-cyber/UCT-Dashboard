/**
 * UCT News — AI Explanation requests (POST /api/trade-exchange-news/explain).
 *
 * Asked for only on a member's click; never on render, the stream or history.
 * The request names a headline by its permanent `id` and nothing else: the server
 * explains its own stored text. One page shares one answer per headline, so two
 * News widgets (or a reopened panel) never ask twice, and two clicks while the
 * first is in flight join it.
 */
import { explainError } from '../pages/charts/widgets/tradeExchangeNewsModel'

export const EXPLAIN_URL = '/api/trade-exchange-news/explain'
const MAX_KEPT = 200

const _done = new Map()          // id -> body (an answer; refusals are not kept)
const _pending = new Map()       // id -> Promise

export function cachedExplanation(id) {
  return _done.get(id) || null
}

/** -> { body } or { error: { text, retry } }. Never throws. */
export function requestExplanation(id) {
  if (_done.has(id)) return Promise.resolve({ body: _done.get(id) })
  if (_pending.has(id)) return _pending.get(id)
  const p = (async () => {
    let r
    try {
      r = await fetch(EXPLAIN_URL, {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      })
    } catch {
      return { error: explainError(0, null) }
    }
    const body = await r.json().catch(() => null)
    if (!r.ok || !body?.explanation) return { error: explainError(r.status, body) }
    _done.set(id, body)
    while (_done.size > MAX_KEPT) _done.delete(_done.keys().next().value)
    return { body }
  })().finally(() => _pending.delete(id))
  _pending.set(id, p)
  return p
}

export function _resetExplainCacheForTests() {
  _done.clear()
  _pending.clear()
}
