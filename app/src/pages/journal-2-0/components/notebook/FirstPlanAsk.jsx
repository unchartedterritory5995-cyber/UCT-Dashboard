// Audit 2026-11-05, S17 (M7), moved out of SetupsBoard.jsx for S15: the empty setups board's ask -- "Draw your first
// plan" -- shared by the board and the Today home's "Setups near entry" card. Small on purpose: the board's charts
// stay in the board's chunk. Nothing is written from here.
import { useId, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import styles from './SetupsBoard.module.css'

/** S17 (audit 2026-11-05, M7): the empty board ASKS -- "Draw your first plan", a short how-to (there is no demo
 *  video asset, so the steps stand in for it), a ticker to plan, and three suggestions. Each goes to that ticker's
 *  research page, whose "Plan this trade" opens a plan with its chart. Nothing is written from here. */
export const FIRST_PLAN = Object.freeze({
  title: 'Draw your first plan',
  steps: ['Open a ticker and press Plan this trade.', 'Draw entry, stop and target on its chart.',
    'Your plan shows up here, closest to its entry first.'],
})
const FIRST_PLAN_SUGGESTIONS = ['NVDA', 'SPY', 'QQQ']
const researchPath = (sym) => `/journal/notebook/research/${encodeURIComponent(sym)}`

export default function FirstPlanAsk() {
  const [value, setValue] = useState('')
  const [go, setGo] = useState(null)
  const inputId = `${useId()}-first-plan-ticker`
  if (go) return <Navigate to={researchPath(go)} />
  const submit = (e) => {
    e.preventDefault()
    const sym = value.trim().toUpperCase().replace(/^\$/, '')
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(sym)) setGo(sym)
  }
  return (
    <div className={styles.firstPlan} data-first-plan="">
      <p className={styles.firstPlanTitle}>{FIRST_PLAN.title}</p>
      <ol className={styles.firstPlanSteps}>
        {FIRST_PLAN.steps.map((t) => <li key={t}>{t}</li>)}
      </ol>
      <form className={styles.firstPlanForm} onSubmit={submit}>
        <label className="sr-only" htmlFor={inputId}>Ticker to plan</label>
        <input id={inputId} className={styles.firstPlanInput} value={value} placeholder="Ticker to plan"
          autoComplete="off" spellCheck={false} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className={styles.action} disabled={!value.trim()}>Plan it</button>
      </form>
      <div className={styles.firstPlanForm} role="group" aria-label="Suggestions">
        {FIRST_PLAN_SUGGESTIONS.map((sym) => (
          <Link key={sym} className={styles.action} to={researchPath(sym)} aria-label={`Plan ${sym}`}>{`+ ${sym}`}</Link>
        ))}
      </div>
    </div>
  )
}
