/**
 * Journal 2.0 — `useTodayState` (P4 B1).
 *
 * Derives the four booleans/enum the Today surface routes on, from the same
 * hooks the rest of J2 already uses (no new fetches beyond the account
 * comparison, which is a single cached call). Today IGNORES the global Scope,
 * so this hook never reads useScope — the surface handles the muted note.
 *
 * Returns `{ session, zeroData, noSync, allAccounts }`:
 *   - session:  'premarket' | 'market' | 'postclose'
 *       premarket = isPremarket · market = isOpen · postclose = the rest
 *       (weeknights, weekends, and the after-hours/extended window all read as
 *       post-close for the purpose of "lead with the EOD recap").
 *   - zeroData: no open share positions AND no open option strategies AND the
 *       account has logged zero closed trades — the fresh-account experience.
 *       For a concrete account the trade count comes from that account's
 *       comparison row; for All-Accounts it SUMS every account's count (so an
 *       all-accounts view with closed-but-no-open trades isn't mis-flagged
 *       fresh). Documented deviation from the spec's single-account phrasing.
 *   - noSync:   a concrete account whose balance isn't broker-synced (manual) —
 *       the "log today's trades" quick-entry experience replaces the live hero.
 *   - allAccounts: the "_all_"/null aggregate selection.
 */

import useMarketOpen from '../../../hooks/useMarketOpen'
import useJ2Positions from './useJ2Positions'
import useJ2OptionStrategies from './useJ2OptionStrategies'
import useJ2SelectedAccount from './useJ2SelectedAccount'
import useJ2AccountComparison from './useJ2AccountComparison'

const ALL_ACCOUNTS = '_all_'

export default function useTodayState() {
  const { isOpen, isPremarket } = useMarketOpen()
  // Map the three market-hours flags onto the three Today session states.
  // postclose = "not open and not pre-market" — nights, weekends, and the
  // extended/after-hours window all lead with the recap.
  const session = isPremarket ? 'premarket' : isOpen ? 'market' : 'postclose'

  const { accountId, account } = useJ2SelectedAccount()
  const { positions } = useJ2Positions()
  const { strategies: optionStrategies } = useJ2OptionStrategies({ status: 'open' })
  const { accounts: comparison } = useJ2AccountComparison()

  const allAccounts = accountId == null || accountId === ALL_ACCOUNTS

  // Closed-trade count for the current selection. Concrete account → that
  // account's row; All-Accounts → the sum across every account (there is no
  // aggregate row in the comparison payload).
  const tradeCount = allAccounts
    ? comparison.reduce((sum, a) => sum + (a?.tradeCount || 0), 0)
    : comparison.find((a) => a?.id === accountId)?.tradeCount ?? 0

  const zeroData =
    positions.length === 0 && optionStrategies.length === 0 && tradeCount === 0

  const noSync = !!(account && account.balanceSource !== 'broker')

  return { session, zeroData, noSync, allAccounts }
}
