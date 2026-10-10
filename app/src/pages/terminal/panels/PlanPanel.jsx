// PLAN: trade plan -> alerts -> journal (wave 8, lane G). `NVDA PLAN`, or `NVDA PLAN 203 195` to
// prefill the buy point and the stop (BRKO's Plan button passes the pivot).
//
// Type a buy point and a stop, and optionally a target and an account size (sized by sizeMath.js,
// the SIZE panel's own arithmetic). Two buttons, each one explicit write:
//   Set alerts      two price alerts, the buy point and the stop, through alertCommand.setAlert:
//                   the SAME POST /api/watchlist-alerts ALRT, the bell and the chart menus use.
//   Log to journal  one Journal 2.0 notebook note (POST /api/j2/notes, tagged `trade-plan`), then a
//                   link that opens it. Journal 2.0's own files are not touched.
//
// ⛔ NOTHING IS WRITTEN ON MOUNT. A panel re-mounts on reload, on a restored board and on a shared
// `?cmd=` link, so a write here happens only inside a button's click handler, and each button stays
// spent (and says so) until the plan changes, so a double press cannot write twice.
// ⛔ Every write ends in a visible sentence: what was set or saved, or what was not and why.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Input from '../../../components/ui/Input'
import useLivePrices from '../../../hooks/useLivePrices'
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelCommand, PanelState, useInTerminalPanel, usePanelFreshness, panelAsOf } from '../../../components/terminal'
import { formatCurrency } from '../../../lib/presentation/presentationPrimitives'
import { setAlert } from '../alertCommand'
import { parseAlertPrice } from '../alertModel'
import { DEFAULT_RISK_PCT, parseNum } from './sizeMath'
import { loadSizePrefs } from './SizePanel'
import {
  NOTES_URL, alertLegs, alertsResultText, journalFailureText, noteHref, planLines, planNote, readPlan,
} from './planModel'
import shared from './myNamesPanel.module.css'
import sizeStyles from './sizePanel.module.css'
import styles from './planPanel.module.css'

/** A command-line price argument (`203`, `>203`) as field text, or ''. */
const argPrice = (v) => {
  const p = parseAlertPrice(v)
  return p ? String(p.price) : ''
}

export default function PlanPanel({ sym, buy: buyArg = null, stop: stopArg = null }) {
  const s = String(sym || '').trim().toUpperCase() || null
  const inPanel = useInTerminalPanel()
  const ids = useId()
  const [prefs] = useState(loadSizePrefs)
  const [buy, setBuy] = useState(() => argPrice(buyArg))
  const [stop, setStop] = useState(() => argPrice(stopArg))
  const [target, setTarget] = useState('')
  const [account, setAccount] = useState(prefs.account)
  const [riskPct, setRiskPct] = useState(prefs.riskPct)
  const [alerts, setAlerts] = useState({ busy: false, sig: null, ok: null, text: null })
  const [journal, setJournal] = useState({ busy: false, sig: null, ok: null, text: null, noteId: null })

  // A pressed button is disabled while it writes (and stays disabled once spent), which drops
  // keyboard focus to the page. When the write ends, focus lands on the sentence that says what
  // happened, so a keyboard or screen-reader member is not left nowhere. Only when the press came
  // from a focused button and focus has not moved on since.
  const alertsOutRef = useRef(null)
  const journalOutRef = useRef(null)
  const refocus = useRef(null)
  const armRefocus = (which, e) => {
    const from = e?.currentTarget || null
    refocus.current = from && typeof document !== 'undefined' && document.activeElement === from ? { which, from } : null
  }
  useEffect(() => {
    const pending = refocus.current
    if (!pending) return
    const el = pending.which === 'alerts' ? alertsOutRef.current : journalOutRef.current
    if (!el) return
    refocus.current = null
    const active = document.activeElement
    if (!active || active === document.body || active === pending.from) el.focus()
  }, [alerts.text, journal.text])

  // A new command (`NVDA PLAN 210 200`) re-seeds the two prices it names (adjusted during render,
  // React's own pattern for state that follows a prop).
  const [seeded, setSeeded] = useState({ buyArg, stopArg })
  if (seeded.buyArg !== buyArg || seeded.stopArg !== stopArg) {
    setSeeded({ buyArg, stopArg })
    if (buyArg != null && buyArg !== seeded.buyArg) setBuy(argPrice(buyArg))
    if (stopArg != null && stopArg !== seeded.stopArg) setStop(argPrice(stopArg))
  }

  const { prices } = useLivePrices(s ? [s] : [])
  const live = s ? parseNum(prices?.[s]?.price) : null
  const liveKnown = live != null
  const liveAt = useMemo(() => (liveKnown ? new Date().toISOString() : null), [liveKnown])
  usePanelFreshness(liveAt ? panelAsOf('Live price (reference only)', liveAt) : null)

  const plan = useMemo(() => readPlan({ buy, stop, target, account, riskPct }), [buy, stop, target, account, riskPct])
  const sig = plan.ok ? JSON.stringify([s, plan.buy, plan.stop, plan.target, plan.size?.shares ?? null]) : null
  const blank = String(buy).trim() === '' || String(stop).trim() === ''

  if (!s) {
    return (
      <PanelState kind="empty" title="PLAN needs a ticker." testId="terminal-plan-needs-ticker">
        Type a ticker first, for example NVDA PLAN.
      </PanelState>
    )
  }

  const onSetAlerts = async (e) => {
    if (!plan.ok || alerts.busy) return
    armRefocus('alerts', e)
    setAlerts({ busy: true, sig: null, ok: null, text: null })
    const results = []
    for (const leg of alertLegs(plan)) {
      try {
        await setAlert({ sym: s, price: leg.price, direction: leg.direction })
        results.push({ leg, ok: true })
      } catch (err) {
        results.push({ leg, ok: false, text: err?.memberText || 'It could not be saved just now; try again.' })
      }
    }
    const allOk = results.every((r) => r.ok)
    // Spent only when every alert landed; a partial result can be pressed again after a fix.
    setAlerts({ busy: false, sig: allOk ? sig : null, ok: allOk, text: alertsResultText(s, results) })
  }

  const onLogJournal = async (e) => {
    if (!plan.ok || journal.busy) return
    armRefocus('journal', e)
    setJournal({ busy: true, sig: null, ok: null, text: null, noteId: null })
    try {
      const body = await jsonFetcher(NOTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(planNote(s, plan)),
      })
      const noteId = body?.note?.id ?? null
      setJournal({ busy: false, sig, ok: true, noteId,
        text: `Logged to your journal as a note: ${s} trade plan.` })
    } catch (err) {
      setJournal({ busy: false, sig: null, ok: false, noteId: null, text: journalFailureText(err) })
    }
  }

  const alertsSpent = alerts.sig != null && alerts.sig === sig
  const journalSpent = journal.sig != null && journal.sig === sig

  // The plan's refusal sentence can be about any field, so every field points at it.
  const errorId = `${ids}-error`
  const showError = !blank && !plan.ok
  const field = (key, label, value, set, hint = null) => (
    <div className={sizeStyles.field}>
      <label className={sizeStyles.label} htmlFor={`${ids}-${key}`}>{label}</label>
      <Input id={`${ids}-${key}`} className={sizeStyles.input} type="text" inputMode="decimal" autoComplete="off"
        aria-describedby={[hint ? `${ids}-${key}-hint` : null, showError ? errorId : null].filter(Boolean).join(' ') || undefined}
        value={value} onChange={(e) => set(e.target.value)} data-testid={`terminal-plan-${key}`} />
      {hint ? <span className={sizeStyles.hint} id={`${ids}-${key}-hint`}>{hint}</span> : null}
    </div>
  )

  return (
    <div className={`${shared.wrap} ${inPanel ? shared.inPanel : ''}`} data-testid="terminal-plan">
      <p className={shared.lede}>
        Plan a trade in {s}. Set the buy point and the stop, then set alerts on both and log the plan to your journal.
      </p>

      <form className={sizeStyles.form} onSubmit={(e) => e.preventDefault()} aria-label="Trade plan inputs">
        {field('buy', 'Buy point ($)', buy, setBuy, live != null ? `${s} now ${formatCurrency(live)}` : null)}
        {field('stop', 'Stop ($)', stop, setStop)}
        {field('target', 'Target ($, optional)', target, setTarget)}
        {field('account', 'Account size ($, optional)', account, setAccount, 'For the share count')}
        {field('risk', 'Risk per trade (%)', riskPct, setRiskPct, `Default ${DEFAULT_RISK_PCT}%`)}
      </form>

      {blank ? (
        <p className={shared.muted} data-testid="terminal-plan-prompt">Fill in the buy point and the stop to make a plan.</p>
      ) : !plan.ok ? (
        <p className={`${shared.note} ${styles.bad}`} role="alert" id={errorId} data-testid="terminal-plan-error">{plan.error}</p>
      ) : (
        <div data-testid="terminal-plan-summary">
          <ul className={styles.lines}>
            {planLines(plan).map((l) => <li key={l}>{l}</li>)}
          </ul>
          {plan.size && !plan.size.ok ? (
            <p className={shared.muted} data-testid="terminal-plan-size-note">No share count: {plan.size.error}</p>
          ) : null}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={onSetAlerts}
          disabled={!plan.ok || blank || alerts.busy || alertsSpent} data-testid="terminal-plan-set-alerts">
          {alerts.busy ? 'Setting alerts' : alertsSpent ? 'Alerts set' : 'Set alerts'}
        </button>
        <button type="button" className={styles.action} onClick={onLogJournal}
          disabled={!plan.ok || blank || journal.busy || journalSpent} data-testid="terminal-plan-log-journal">
          {journal.busy ? 'Saving' : journalSpent ? 'Logged' : 'Log to journal'}
        </button>
      </div>

      {alerts.text ? (
        <p className={alerts.ok ? styles.good : `${shared.note} ${styles.bad}`} role={alerts.ok ? 'status' : 'alert'}
          ref={alertsOutRef} tabIndex={-1} data-testid="terminal-plan-alerts-result">
          {alerts.text}{' '}
          <PanelCommand cmd={`${s} ALRT`} label={`See alerts for ${s}`} className={shared.linkBtn}>See alerts</PanelCommand>
        </p>
      ) : null}
      {journal.text ? (
        <p className={journal.ok ? styles.good : `${shared.note} ${styles.bad}`} role={journal.ok ? 'status' : 'alert'}
          ref={journalOutRef} tabIndex={-1} data-testid="terminal-plan-journal-result">
          {journal.text}
          {journal.noteId ? <> <Link className={shared.linkBtn} to={noteHref(journal.noteId)}>Open the note</Link></> : null}
        </p>
      ) : null}

      <p className={shared.muted} data-testid="terminal-plan-method">
        Nothing is saved until you press a button. Alerts use the same price alerts as ALRT and the alert bell.
        The journal entry is a notebook note tagged trade-plan. Account and risk come from SIZE in this browser.
      </p>
    </div>
  )
}
