import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import FlowTab from './FlowTab'
import styles from '../ResearchPage.module.css'

// Audit 2026-10-08 (FLOW P1, point 19): `NVDA FLOW` was refused outright ("not enabled for your
// account yet") while the per-ticker flow tab's switch (researchFlowTabEnabled) was off, though the
// Options Flow page itself was open to the member. The terminal now opens this gate instead: with
// the switch on it IS the flow tab; with it off it says so and offers the doors that do exist --
// the market Options Flow page and this ticker's gamma exposure view (both leave the terminal).
export default function FlowGate({ sym, ...rest }) {
  const { researchFlowTabEnabled } = useAuth() || {}
  const s = (sym || '').toUpperCase().trim()
  if (researchFlowTabEnabled) return <FlowTab sym={sym} {...rest} />
  return (
    <div className={styles.fnote} data-testid="flow-gate-off">
      <p>The per-ticker flow view for {s || 'this ticker'} isn&apos;t switched on for your account yet.</p>
      <p>
        <Link to="/options-flow">Open Options Flow</Link> (opens a page) for the whole market tape
        {s ? <>, or <Link to={`/options-flow?view=gex&ticker=${encodeURIComponent(s)}`}>{s} gamma exposure</Link> (opens a page)</> : null}.
      </p>
    </div>
  )
}
