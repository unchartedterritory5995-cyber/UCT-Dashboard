import { useEffect, useMemo, useState } from 'react'
import styles from './AiSpend.module.css'

// Admin: where the Claude API money goes. Reads the one AI-spend ledger
// (api/services/llm_usage.py) — every Anthropic call, hooked at the SDK, named
// by the feature (module) that made it and joined to the AI-door register.

const DAY_OPTIONS = [1, 7, 30, 90]
const PALETTE = ['#d4a64a', '#4f9cf9', '#3fbf7f', '#e0675a', '#a57ee8', '#3cc6c6', '#e89a3c', '#8a93a6']

const usd = (n, d = 2) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`
const pct = (n) => `${Math.round((Number(n) || 0) * 1000) / 10}%`
const tok = (n) => {
  const v = Number(n) || 0
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(v)
}
export const featureName = (door) => {
  const base = String(door || '').replace(/^api\/(services|routers)\//, '').replace(/\.py$/, '')
  return base || 'unattributed'
}

function useJson(url) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    if (!url) { setState({ data: null, loading: false, error: null }); return undefined }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(url, { credentials: 'include' })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }) })
      .catch((e) => { if (!cancelled) setState({ data: null, loading: false, error: String(e) }) })
    return () => { cancelled = true }
  }, [url])
  return state
}

function Stat({ label, value, sub }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {sub ? <div className={styles.statSub}>{sub}</div> : null}
    </div>
  )
}

function DailyChart({ days, top, colorOf }) {
  const max = Math.max(0.01, ...days.map((d) => d.total))
  if (!days.length) return <div className={styles.empty}>No calls recorded in this window yet.</div>
  return (
    <div className={styles.chart} role="img" aria-label="Daily Claude spend by feature">
      {days.map((d) => {
        const keys = [...top, 'other'].filter((k) => d.doors[k])
        return (
          <div key={d.day} className={styles.col} title={`${d.day}: ${usd(d.total)} · ${d.calls} calls`}>
            <div className={styles.colValue}>{usd(d.total, 0)}</div>
            <div className={styles.bar} style={{ height: `${(d.total / max) * 100}%` }}>
              {keys.map((k) => (
                <div key={k} style={{ flex: d.doors[k], background: colorOf(k) }} />
              ))}
            </div>
            <div className={styles.colLabel}>{d.day.slice(5)}</div>
          </div>
        )
      })}
    </div>
  )
}

function DoorDetail({ door, days, onClose }) {
  const { data, loading, error } = useJson(`/api/admin/llm-usage/door?door=${encodeURIComponent(door)}&days=${days}`)
  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <div>
          <h2 className={styles.h2}>{featureName(door)}</h2>
          <code className={styles.path}>{door}</code>
          {data?.surface ? <p className={styles.sub}>{data.surface}</p> : null}
          {data?.budget ? <p className={styles.sub}><strong>Budget today:</strong> {data.budget}</p> : null}
        </div>
        <button type="button" className={styles.dayBtn} onClick={onClose}>Close</button>
      </div>
      {loading ? <div className={styles.empty}>Loading…</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {data ? (
        <>
          <div className={styles.stats}>
            <Stat label="Spend" value={usd(data.totals.cost)} sub={`${data.totals.calls} calls`} />
            <Stat label="Per call" value={usd(data.totals.calls ? data.totals.cost / data.totals.calls : 0, 4)} />
            <Stat label="Cache hit" value={pct(data.totals.cache_ratio)} sub="share of input read from cache" />
            <Stat label="Failed" value={data.totals.failed} />
          </div>
          <h3 className={styles.h3}>By function</h3>
          <table className={styles.table}>
            <thead><tr><th>Function</th><th>Calls</th><th>Spend</th><th>Input</th><th>Cache read</th><th>Output</th></tr></thead>
            <tbody>
              {data.by_func.map((r) => (
                <tr key={r.func || '-'}><td><code>{r.func || '—'}</code></td><td>{r.calls}</td><td>{usd(r.cost)}</td>
                  <td>{tok(r.input)}</td><td>{tok(r.cache_read)}</td><td>{tok(r.output)}</td></tr>
              ))}
            </tbody>
          </table>
          <h3 className={styles.h3}>By model</h3>
          <table className={styles.table}>
            <thead><tr><th>Model</th><th>Calls</th><th>Spend</th></tr></thead>
            <tbody>{data.by_model.map((r) => <tr key={r.model}><td>{r.model}</td><td>{r.calls}</td><td>{usd(r.cost)}</td></tr>)}</tbody>
          </table>
          <h3 className={styles.h3}>Most recent calls</h3>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead><tr><th>When (UTC)</th><th>Function</th><th>Model</th><th>Kind</th><th>In</th><th>Cache</th><th>Out</th><th>Cost</th></tr></thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={i} className={r.ok ? '' : styles.failedRow}>
                    <td>{r.at.replace('T', ' ').slice(0, 19)}</td><td><code>{r.func}</code></td><td>{r.model}</td><td>{r.kind}</td>
                    <td>{tok(r.input_tokens)}</td><td>{tok(r.cache_read_tokens)}</td><td>{tok(r.output_tokens)}</td><td>{usd(r.cost_usd, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}

const budgetLabel = (door) => (door === '*' ? 'Whole site' : door === '*background' ? 'All background jobs' : featureName(door))

export function Budgets({ rows, doorOptions, onChanged }) {
  const [form, setForm] = useState({ door: '*', daily_usd: '', mode: 'alert', note: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const save = async (body) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/llm-usage/budgets', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onChanged()
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }
  const remove = async (door) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/llm-usage/budgets?door=${encodeURIComponent(door)}`, { method: 'DELETE', credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onChanged()
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }
  return (
    <div>
      <h2 className={styles.h2}>Daily budgets</h2>
      <p className={styles.sub}>
        <strong>Alert</strong> posts to the ops channel at 80%, at 100%, and when today&apos;s pace projects past the budget.
        <strong> Block</strong> also refuses that feature&apos;s Claude calls until midnight ET once the budget is spent
        (background jobs skip their run instead of failing). &ldquo;All background jobs&rdquo; never blocks a member feature.
      </p>
      <table className={styles.table}>
        <thead><tr><th>Applies to</th><th>Budget / day</th><th>Mode</th><th>Spent today</th><th>Projected</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.door}>
              <td><span className={styles.feature}>{budgetLabel(b.door)}</span>{b.note ? <span className={styles.surface}>{b.note}</span> : null}</td>
              <td>{usd(b.daily_usd)}</td>
              <td>
                <select aria-label={`mode for ${budgetLabel(b.door)}`} value={b.mode} disabled={busy}
                  onChange={(e) => save({ door: b.door, daily_usd: b.daily_usd, mode: e.target.value, note: b.note })}>
                  <option value="alert">alert</option><option value="block">block</option>
                </select>
              </td>
              <td>{usd(b.spent)}<div className={styles.share}><div style={{ width: pct(Math.min(1, b.pct)) }} /></div></td>
              <td>{usd(b.projected)}</td>
              <td><span className={`${styles.level} ${styles[`level_${b.level}`] || ''}`}>{b.blocking ? 'blocking' : b.level}</span></td>
              <td><button type="button" className={styles.linkBtn} disabled={busy} onClick={() => remove(b.door)}>remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className={styles.budgetForm} onSubmit={(e) => {
        e.preventDefault()
        const usdN = Number(form.daily_usd)
        if (!(usdN > 0)) { setErr('Budget must be more than $0'); return }
        save({ ...form, daily_usd: usdN })
      }}>
        <select aria-label="budget target" value={form.door} onChange={(e) => setForm({ ...form, door: e.target.value })}>
          <option value="*">Whole site</option>
          <option value="*background">All background jobs</option>
          {doorOptions.map((d) => <option key={d} value={d}>{featureName(d)}</option>)}
        </select>
        <input aria-label="daily budget in dollars" type="number" min="0.01" step="0.01" placeholder="$ / day"
          value={form.daily_usd} onChange={(e) => setForm({ ...form, daily_usd: e.target.value })} />
        <select aria-label="budget mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
          <option value="alert">alert</option><option value="block">block</option>
        </select>
        <input aria-label="note" placeholder="note (optional)" value={form.note} maxLength={300}
          onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button type="submit" className={styles.dayBtnActive} disabled={busy}>Set budget</button>
      </form>
      {err ? <div className={styles.error}>{err}</div> : null}
    </div>
  )
}

export default function AiSpend() {
  const [days, setDays] = useState(7)
  const [open, setOpen] = useState(null)
  const [rev, setRev] = useState(0)
  const { data, loading, error } = useJson(`/api/admin/llm-usage/summary?days=${days}&r=${rev}`)
  const doorOptions = useMemo(() => {
    const all = new Set([...(data?.by_door || []).map((r) => r.door), ...(data?.silent_doors || [])])
    return [...all].sort()
  }, [data])

  const colorOf = useMemo(() => {
    const top = data?.top_doors || []
    return (k) => (k === 'other' ? '#4b5263' : PALETTE[top.indexOf(k) % PALETTE.length])
  }, [data])

  const t = data?.totals
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.h1}>AI Spend</h1>
          <p className={styles.sub}>
            Every Claude API call the site makes, named by the feature that made it. Recorded at the SDK, so a new
            feature shows up here the day it ships. Prices include cache reads/writes, web searches and the batch discount.
          </p>
        </div>
        <div className={styles.daysRow}>
          {DAY_OPTIONS.map((n) => (
            <button key={n} type="button" className={`${styles.dayBtn} ${days === n ? styles.dayBtnActive : ''}`}
              onClick={() => setDays(n)}>{n}d</button>
          ))}
        </div>
      </div>

      {loading && !data ? <div className={styles.empty}>Loading…</div> : null}
      {error ? <div className={styles.error}>Could not load: {error}</div> : null}

      {data ? (
        <>
          <div className={styles.stats}>
            <Stat label="Today so far" value={usd(data.today_totals.cost)} sub={`${data.today_totals.calls} calls`} />
            <Stat label={`Last ${days}d`} value={usd(t.cost)} sub={`${t.calls.toLocaleString()} calls`} />
            <Stat label="Average / day" value={usd(t.avg_per_day)} sub={`${t.days_with_data} day(s) with data`} />
            <Stat label="Cache hit" value={pct(t.cache_ratio)} sub={`${tok(t.cache_read)} of input from cache`} />
            <Stat label="Tokens" value={`${tok(t.input + t.cache_read + t.cache_write)} in`} sub={`${tok(t.output)} out · ${t.web_searches} searches`} />
          </div>
          {data.ledger_first_day && data.ledger_first_day > data.since ? (
            <p className={styles.note}>Ledger started {data.ledger_first_day}; earlier days have no data.</p>
          ) : null}

          <h2 className={styles.h2}>Daily spend by feature</h2>
          <DailyChart days={data.by_day} top={data.top_doors} colorOf={colorOf} />
          <div className={styles.legend}>
            {[...data.top_doors, 'other'].map((k) => (
              <span key={k}><i style={{ background: colorOf(k) }} />{k === 'other' ? 'other' : featureName(k)}</span>
            ))}
          </div>

          <Budgets rows={data.budgets || []} doorOptions={doorOptions} onChanged={() => setRev((n) => n + 1)} />

          <h2 className={styles.h2}>Features, most expensive first</h2>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr><th>Feature</th><th>Kind</th><th>Spend</th><th>Share</th><th>Calls</th><th>Per call</th>
                  <th>Cache hit</th><th>Output</th><th>Budget</th><th>Models</th></tr>
              </thead>
              <tbody>
                {data.by_door.map((r) => (
                  <tr key={r.door} className={styles.clickRow} onClick={() => setOpen(r.door)}>
                    <td><span className={styles.feature}>{featureName(r.door)}</span>
                      {r.surface ? <span className={styles.surface}>{r.surface}</span> : null}</td>
                    <td><span className={`${styles.kind} ${styles[`kind_${r.kind}`] || ''}`}>{r.kind}</span></td>
                    <td><strong>{usd(r.cost)}</strong></td>
                    <td><div className={styles.share}><div style={{ width: pct(r.share) }} /></div>{pct(r.share)}</td>
                    <td>{r.calls.toLocaleString()}</td><td>{usd(r.cost_per_call, 4)}</td><td>{pct(r.cache_ratio)}</td>
                    <td>{tok(r.output)}</td>
                    <td>{r.budget ? <span className={`${styles.level} ${styles[`level_${r.budget.level}`] || ''}`}>{usd(r.budget.daily_usd, 0)} {r.budget.mode}</span> : '—'}</td>
                    <td className={styles.models}>{r.models.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open ? <DoorDetail door={open} days={days} onClose={() => setOpen(null)} /> : null}

          <div className={styles.grid2}>
            <div>
              <h2 className={styles.h2}>By model</h2>
              <table className={styles.table}>
                <thead><tr><th>Model</th><th>Spend</th><th>Share</th><th>Calls</th><th>Cache hit</th></tr></thead>
                <tbody>{data.by_model.map((r) => (
                  <tr key={r.model}><td>{r.model || '—'}</td><td>{usd(r.cost)}</td><td>{pct(r.share)}</td><td>{r.calls}</td><td>{pct(r.cache_ratio)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div>
              <h2 className={styles.h2}>By source</h2>
              <table className={styles.table}>
                <thead><tr><th>Service</th><th>Spend</th><th>Calls</th></tr></thead>
                <tbody>{data.by_service.map((r) => (
                  <tr key={r.service}><td>{r.service}</td><td>{usd(r.cost)}</td><td>{r.calls}</td></tr>
                ))}</tbody>
              </table>
              <h2 className={styles.h2}>By call type</h2>
              <table className={styles.table}>
                <thead><tr><th>Kind</th><th>Spend</th><th>Calls</th></tr></thead>
                <tbody>{data.by_kind.map((r) => (
                  <tr key={r.kind}><td>{r.kind}</td><td>{usd(r.cost)}</td><td>{r.calls}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          {data.unlisted_doors.length ? (
            <div className={styles.warn}>
              <strong>Not in the AI-door register:</strong> {data.unlisted_doors.join(', ')}
            </div>
          ) : null}
          <details className={styles.details}>
            <summary>Registered AI features with no Claude calls in this window ({data.silent_doors.length})</summary>
            <p className={styles.sub}>Off by flag, idle, or OpenAI/Perplexity-only.</p>
            <ul>{data.silent_doors.map((d) => <li key={d}><code>{d}</code></li>)}</ul>
          </details>
          <p className={styles.note}>
            Ledger: {data.ledger.recorded} recorded this process · {data.ledger.dropped} dropped · {data.ledger.write_errors} write errors ·
            service {data.ledger.service}. Reconcile against the Anthropic Console weekly.
          </p>
        </>
      ) : null}
    </div>
  )
}
