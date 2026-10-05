import { useEffect, useState } from 'react'
import styles from '../../pages/Settings.module.css'

// ── FT-036 + FT-033 — where your alerts go, and your webhooks ───────────
// Two dark surfaces, each probed on mount: /api/alerts/routing answers 404
// while ALERT_ROUTING_RULE_ENABLED is off, /api/alerts/webhooks while
// ALERT_WEBHOOKS_ENABLED is off. A section the server does not answer for
// renders nothing; there is no client-side flag.
//
// ⛔ Suspend withholds notifications only. The copy says so because a member
// who reads "suspend" as "delete" would rebuild alerts they never lost.

async function call(fetcher, method, url, body) {
  const init = { method, credentials: 'include' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const r = await fetcher(url, init)
  let json = null
  try { json = await r.json() } catch { /* empty body */ }
  if (!r.ok) throw new Error(json?.detail ? String(json.detail) : `Request failed (${r.status})`)
  return json
}

const CHANNELS = [
  ['email', 'Email'],
  ['push', 'Push notifications'],
  ['webhook', 'Webhooks'],
]

export function RoutingRow({ fetcher = fetch }) {
  const [rule, setRule] = useState(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    let live = true
    call(fetcher, 'GET', '/api/alerts/routing').then(r => { if (live) setRule(r) }).catch(() => {})
    return () => { live = false }
  }, [fetcher])
  if (!rule) return null

  const run = async (fn) => {
    setMsg('')
    try { setRule(await fn()) } catch (e) { setMsg(e.message) }
  }
  return (
    <div className={styles.prefRow} data-testid="alert-routing-row">
      <div className={styles.prefLabelGroup}>
        <span className={styles.prefLabel}>Where your alerts go</span>
        <span className={styles.prefDesc}>
          {rule.suspended
            ? 'All alerts are suspended. Your alerts still run and are kept in your history; nothing is sent until you resume.'
            : 'Every alert also appears in your notification bell. Choose which other channels it uses.'}
        </span>
        <span className={styles.prefDesc}>
          {CHANNELS.map(([key, label]) => (
            <label key={key} style={{ marginRight: 12 }}>
              <input type="checkbox" checked={!!rule[key]} disabled={rule.suspended}
                onChange={e => run(() => call(fetcher, 'PUT', '/api/alerts/routing', { [key]: e.target.checked }))} />
              {' '}{label}
            </label>
          ))}
        </span>
        {msg && <span className={styles.prefDesc} role="status">{msg}</span>}
      </div>
      <button type="button" className={styles.btn}
        onClick={() => run(() => call(fetcher, 'POST',
          rule.suspended ? '/api/alerts/routing/resume' : '/api/alerts/routing/suspend'))}>
        {rule.suspended ? 'Resume alerts' : 'Suspend all'}
      </button>
    </div>
  )
}

export function WebhooksRow({ fetcher = fetch }) {
  const [hooks, setHooks] = useState(null)
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState(null)
  const [msg, setMsg] = useState('')
  const load = () => call(fetcher, 'GET', '/api/alerts/webhooks').then(r => setHooks(r.webhooks || []))
  useEffect(() => { load().catch(() => {}) }, [fetcher]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!hooks) return null

  const add = async () => {
    setMsg('')
    try {
      const made = await call(fetcher, 'POST', '/api/alerts/webhooks', { url })
      setSecret({ id: made.id, value: made.secret })
      setUrl('')
      await load()
    } catch (e) { setMsg(e.message) }
  }
  const act = async (method, path, note) => {
    setMsg('')
    try { await call(fetcher, method, path); setMsg(note); await load() } catch (e) { setMsg(e.message) }
  }
  const live = hooks.filter(h => !h.revoked_at)
  return (
    <div className={styles.prefRow} data-testid="alert-webhooks-row">
      <div className={styles.prefLabelGroup}>
        <span className={styles.prefLabel}>Alert webhooks</span>
        <span className={styles.prefDesc}>
          Each alert is also sent as a signed JSON POST to your https address. Verify the
          X-UCT-Signature header (HMAC-SHA256 of the timestamp and body) with your secret.
        </span>
        {secret && (
          <span className={styles.prefDesc} role="status" data-testid="webhook-secret">
            Your signing secret (shown once, copy it now): <code>{secret.value}</code>
          </span>
        )}
        {live.map(h => (
          <span key={h.id} className={styles.prefDesc}>
            <code>{h.url}</code> (…{h.secret_hint})
            {h.last_error ? ` · last error: ${h.last_error}` : ''}
            {' '}<button type="button" className={styles.btn}
              onClick={() => act('POST', `/api/alerts/webhooks/${h.id}/test`, 'Test queued. It is sent within a minute.')}>Test</button>
            {' '}<button type="button" className={styles.btn}
              onClick={() => act('DELETE', `/api/alerts/webhooks/${h.id}`, 'Webhook revoked.')}>Revoke</button>
          </span>
        ))}
        <span className={styles.prefDesc}>
          <input type="url" aria-label="Webhook address" placeholder="https://your-endpoint.example.com/uct"
            value={url} onChange={e => setUrl(e.target.value)} />
          {' '}<button type="button" className={styles.btn} disabled={!url.trim()} onClick={add}>Add</button>
        </span>
        {msg && <span className={styles.prefDesc} role="status">{msg}</span>}
      </div>
    </div>
  )
}

export default function AlertRoutingPanel({ fetcher }) {
  return (
    <>
      <RoutingRow fetcher={fetcher} />
      <WebhooksRow fetcher={fetcher} />
    </>
  )
}
