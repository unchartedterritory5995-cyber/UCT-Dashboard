/**
 * Trade Exchange News — custom headline alerts (S7 `news-match`), managed from the
 * News widget's bell. A rule is tickers and/or keywords; a matching headline is
 * delivered through UCT's existing alert system (the bell, plus whatever channels
 * the member's alert routing allows) — this popover only creates, lists and
 * suspends rules. Server: api/routers/alert_taxonomy.py (admin-only while dark).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../../components/ui/UIcon'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import styles from './TradeExchangeNewsWidget.module.css'

export const NEWS_ALERTS_URL = '/api/alerts/taxonomy/news-match'

const fetchRules = async (url) => {
  const r = await fetch(url, { credentials: 'include', cache: 'no-store' })
  if (r.status === 404) return { off: true, predicates: [] }
  if (r.status === 403) return { forbidden: true, predicates: [] }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const splitList = (raw) => String(raw || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)

/** One rule's words, e.g. "NVDA, AMD · "guidance"" (and "both" when mode=all). */
function ruleLabel(p) {
  const params = p?.params || {}
  const parts = [...(params.tickers || []), ...(params.keywords || []).map((k) => `"${k}"`)]
  return parts.join(params.mode === 'all' ? ' + ' : ', ')
}

export default function TradeExchangeNewsAlerts({ onClose, anchorEl, themeVars, initialTickers = null }) {
  const { data, error, mutate } = useSWR(NEWS_ALERTS_URL, fetchRules, { revalidateOnFocus: false })
  // A headline's "Create news alert" opens this with its tickers filled in; the rule
  // is still the member's to review and save (nothing is created on their behalf).
  const [tickers, setTickers] = useState(() => (initialTickers || []).join(' '))
  const [keywords, setKeywords] = useState('')
  const [mode, setMode] = useState('any')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const boxRef = useRef(null)

  // Click-away closes (mousedown, capture) — no document keydown listener here: the
  // widget's own Escape handling lives on the popover element itself.
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || anchorEl?.contains?.(e.target)) return
      onClose?.()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose, anchorEl])

  const add = useCallback(async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch(NEWS_ALERTS_URL, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: splitList(tickers).map((t) => t.toUpperCase().replace(/^\$/, '')),
          keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
          mode }),
      })
      let body = {}
      try {
        body = await r.json()
      } catch {
        // A non-JSON error page: the status line below still says what failed.
      }
      if (!r.ok) {
        setMsg({ tone: 'err', text: body.detail || `Could not save (HTTP ${r.status})` })
      } else {
        setTickers('')
        setKeywords('')
        setMsg({ tone: 'ok', text: 'Alert saved' })
        mutate()
      }
    } catch {
      setMsg({ tone: 'err', text: 'Could not reach UCT — try again' })
    } finally {
      setBusy(false)
    }
  }, [tickers, keywords, mode, mutate])

  const remove = useCallback(async (id) => {
    await fetch(`${NEWS_ALERTS_URL}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }, [mutate])

  const rules = data?.predicates || []
  return (
    <div
      ref={boxRef}
      className={styles.alertsPop}
      style={themeVars || undefined}
      role="dialog"
      aria-label="News alerts"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }}
    >
      <div className={styles.alertsHead}>
        <span>News alerts</span>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close news alerts" title="Close">
          <UIcon name="x" size={13} />
        </button>
      </div>
      {data?.off ? (
        <div className={styles.alertsNote}>News alerts are switched off on this server.</div>
      ) : data?.forbidden ? (
        <div className={styles.alertsNote}>News alerts are in admin preview.</div>
      ) : (
        <>
          <form className={styles.alertsForm} onSubmit={add}>
            <Input className={styles.alertsInput} value={tickers} onChange={(e) => setTickers(e.target.value)}
              placeholder="Tickers, e.g. NVDA AMD" aria-label="Alert tickers" maxLength={120} />
            <Input className={styles.alertsInput} value={keywords} onChange={(e) => setKeywords(e.target.value)}
              placeholder="Keywords, comma-separated" aria-label="Alert keywords" maxLength={300} />
            <div className={styles.alertsRow}>
              <Select className={styles.alertsSelect} value={mode} onChange={(e) => setMode(e.target.value)}
                aria-label="Match mode"
                options={[{ value: 'any', label: 'Ticker OR keyword' }, { value: 'all', label: 'Ticker AND keyword' }]} />
              <button type="submit" className={styles.alertsAdd} disabled={busy || (!tickers.trim() && !keywords.trim())}>
                <UIcon name="plus" size={12} /> Add
              </button>
            </div>
            {msg && <div className={msg.tone === 'err' ? styles.alertsErr : styles.alertsOk}>{msg.text}</div>}
          </form>
          <div className={styles.alertsList}>
            {error && <div className={styles.alertsErr}>Could not load your news alerts.</div>}
            {!error && !rules.length && <div className={styles.alertsNote}>No news alerts yet.</div>}
            {rules.map((p) => (
              <div key={p.id} className={styles.alertsRule}>
                <span className={styles.alertsRuleText} title={ruleLabel(p)}>{ruleLabel(p)}</span>
                <button type="button" className={styles.iconBtn} onClick={() => remove(p.id)}
                  aria-label={`Remove alert ${ruleLabel(p)}`} title="Remove">
                  <UIcon name="trash" size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className={styles.alertsFoot}>
            One alert per headline, delivered to your UCT bell. Ticker detection is provisional.
          </div>
        </>
      )}
    </div>
  )
}
