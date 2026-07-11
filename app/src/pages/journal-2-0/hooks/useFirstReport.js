/**
 * useFirstReport — the First-Insight onboarding trigger (P0).
 *
 * Decides whether Today should lead with the celebratory "Your First Edge
 * Report" instead of the normal session lead. The rule is deliberately simple
 * and cheap — it reads ONLY the account-comparison payload the Today surface
 * already fetches (no new endpoint, no new poller):
 *
 *   show = firstInsight flag ON
 *        AND closed-trade count ≥ 10 (enough of a sample for the report's stats
 *            to mean something — the canonical confidence threshold)
 *        AND the report hasn't been dismissed yet (localStorage seen flag).
 *
 * The count mirrors `useTodayState`'s tradeCount derivation: a concrete account
 * uses that account's comparison row; All-Accounts sums every account's count.
 *
 * ── The trigger fires "naturally" ────────────────────────────────────────────
 * There is no bespoke event. A CSV import success / broker first-sync
 * revalidates the comparison key (`/api/j2/accounts/comparison`), so when the
 * closed-trade count crosses 10, SWR re-renders Today, this hook re-reads the
 * fresh count, and `show` flips true — the report appears with no extra wiring.
 *
 * ── Existing-users note ──────────────────────────────────────────────────────
 * An established user who already has ≥10 closed trades and has never seen the
 * report will see it ONCE on their next Today visit (seen is unset until they
 * dismiss). That's intentional — a nice "here's your edge" moment, not a bug.
 *
 * ── Persistence (v1) ─────────────────────────────────────────────────────────
 * The once-per gate is localStorage `uct.j2.firstReport.seen` ('1' once
 * dismissed). Per-browser, not per-account — a deliberate v1 simplification
 * (a server `calendar_seen`-style table is a possible future upgrade for
 * cross-device suppression). Storage-unavailable is guarded (never throws).
 */

import { useCallback, useState } from 'react'
import useJ2SelectedAccount from './useJ2SelectedAccount'
import useJ2AccountComparison from './useJ2AccountComparison'
import { useFeatureFlag } from '../featureFlags'

export const FIRST_REPORT_SEEN_KEY = 'uct.j2.firstReport.seen'
export const FIRST_REPORT_MIN_TRADES = 10
const ALL_ACCOUNTS = '_all_'

function readSeen() {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(FIRST_REPORT_SEEN_KEY) === '1'
    )
  } catch {
    return false
  }
}

function writeSeen() {
  try {
    localStorage.setItem(FIRST_REPORT_SEEN_KEY, '1')
  } catch {
    /* storage unavailable — in-memory state still hides the report this session */
  }
}

export default function useFirstReport() {
  const flagOn = useFeatureFlag('firstInsight')
  const { accountId } = useJ2SelectedAccount()
  const { accounts: comparison } = useJ2AccountComparison()
  const [seen, setSeen] = useState(readSeen)

  const allAccounts = accountId == null || accountId === ALL_ACCOUNTS
  const list = Array.isArray(comparison) ? comparison : []
  // Same derivation as useTodayState: concrete account → its row; All-Accounts →
  // the sum (there is no aggregate comparison row). A cold/loading cache defaults
  // to an empty list → count 0 → show false, so the report can never flash before
  // the count settles.
  const count = allAccounts
    ? list.reduce((sum, a) => sum + (a?.tradeCount || 0), 0)
    : list.find((a) => a?.id === accountId)?.tradeCount ?? 0

  const show = flagOn && !seen && count >= FIRST_REPORT_MIN_TRADES

  const dismiss = useCallback(() => {
    writeSeen()
    setSeen(true)
  }, [])

  return { show, dismiss, count }
}
