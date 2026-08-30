import useMarketOpen from './useMarketOpen'
import { expectedLatestDailySessionET } from '../utils/marketSession'
import { preferBrokerMarks } from '../lib/journal-2-0'

/**
 * Should this broker account's rows be valued at the BROKER's own marks?
 *
 * The two clocks this needs already exist and are NOT re-implemented here:
 * `useMarketOpen` owns the session state and `marketSession` owns "which
 * session is the most recent closed one". This hook only joins them to the
 * pure decision in `preferBrokerMarks` (whose Python mirror is
 * broker/composition.py :: prefer_broker_marks, held by parity fixtures).
 *
 * Every surface that prices a broker position must pass the SAME value —
 * the hero and the rows beneath it have to agree on which vendor's marks
 * they are showing, or the rows stop summing to the number above them.
 *
 * @param {{brokerBalanceSyncedAt?: string}} account
 * @returns {boolean}
 */
export default function useBrokerMarkPreference(account) {
  const { sessionClosed, lastClosedSessionET } = useMarkPreferenceContext()
  return preferBrokerMarks(account, sessionClosed, lastClosedSessionET)
}

/**
 * The two session primitives, for surfaces that must decide over SEVERAL
 * accounts (the dashboard tile sums every broker account into one figure).
 * Those must require the preference to hold for EVERY account — accounts sync
 * on their own schedules, and mixing one broker's marks with another's live
 * prices inside a single total is a number from neither.
 */
export function useMarkPreferenceContext() {
  const { isOpen, isPremarket, isExtended } = useMarketOpen()
  return {
    sessionClosed: !isOpen && !isPremarket && !isExtended,
    lastClosedSessionET: expectedLatestDailySessionET(),
  }
}
