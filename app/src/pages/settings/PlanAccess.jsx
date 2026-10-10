// X-17 (U-COPY-01), 2026-10-10: the Settings billing card for anyone who is NOT on a Pro
// subscription. It used to say "Free Plan" and list six pages "you have", which contradicts
// D-010 / TERM-081 ("Everything is paywall"): FREE_PAGES is [] (constants/freePages.js) and
// AuthGuard sends every member without paid access to UPGRADE_PATH, Settings included.
//
// So who actually reaches this card? Only someone AuthContext.isPaid admits without plan 'pro':
//   * an admin (role) with no subscription;
//   * a 'premium' or 'lifetime' plan;
//   * a member in the account-age full-access trial (`trial.active`, server `trial_status`).
// Each gets the true sentence for their case. The last branch (no access at all) cannot be
// reached through AuthGuard today; it still says the paid-only truth rather than "Free Plan".
import styles from '../Settings.module.css'

const PRO_PRICE = '$200/mo'

const PRO_INCLUDES = [
  'Morning Wire: the daily pre-market brief and top picks',
  'Screener and Patterns: the setup scanner and pattern engine',
  'UCT 20 leadership, Theme Tracker and the UCT Terminal',
  'Research dossiers: fundamentals, analyst and ownership depth',
  'Compass: AI coaching, voice and pre-trade verdicts',
]

/** Which honest state a non-Pro account is in. Exported for the rail. */
export function planAccessState({ user, plan, trial }) {
  if (trial?.active) return 'trial'
  if (plan === 'premium' || plan === 'lifetime') return plan
  if (user?.role === 'admin') return 'admin'
  return 'none'
}

export default function PlanAccess({ user, plan, trial, onSubscribe }) {
  const state = planAccessState({ user, plan, trial })
  const days = Math.max(0, Number(trial?.days_left) || 0)

  const head = {
    trial: 'Full-access trial',
    premium: 'Premium plan',
    lifetime: 'Lifetime plan',
    admin: 'Admin access',
    none: 'No active plan',
  }[state]

  const body = {
    trial: `Every page is open while your trial runs: ${days} day${days === 1 ? '' : 's'} left. `
      + `UCT Intelligence has no free tier, so access ends with the trial unless you subscribe to Pro (${PRO_PRICE}).`,
    premium: 'Your plan opens every page of UCT Intelligence.',
    lifetime: 'Your plan opens every page of UCT Intelligence, with nothing more to pay.',
    admin: `Admins see every page. Members reach them with a Pro subscription (${PRO_PRICE}); there is no free tier.`,
    none: `UCT Intelligence has no free tier: every page is part of Pro (${PRO_PRICE}).`,
  }[state]

  const offerPro = state === 'trial' || state === 'none'

  return (
    <div data-testid="settings-plan-access" data-state={state}>
      <div className={styles.planHeader}>
        <span className={state === 'none' ? styles.freeDot : styles.activeDot} />
        <span className={styles.planTitle}>{head}</span>
      </div>
      <p className={styles.hint} style={{ margin: '8px 0 10px' }}>{body}</p>
      {offerPro && (
        <>
          <p className={styles.hint} style={{ margin: '0 0 6px' }}>Pro includes:</p>
          <ul className={styles.proList}>
            {PRO_INCLUDES.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <button type="button" className={styles.btnPro} onClick={onSubscribe}>
            Subscribe to Pro ({PRO_PRICE})
          </button>
        </>
      )}
    </div>
  )
}
