/**
 * Journal 2.0 — Deterministic Portfolio Attention fetch hook (SWR).
 *
 * Portfolio/Position Intelligence Convergence V1, Part B3. Mirrors
 * useJ2Positions.js's fetch conventions (credentials, account-scoped URL,
 * useMobileSWR for market-hours-aware polling) — GET /api/j2/positions/attention
 * is a thin new endpoint that reuses watchlist_intelligence.py verbatim, so
 * this hook just fetches and returns its shape unmodified: {SYM: {status,
 * notable, facts, context}}.
 */

import useMobileSWR from '../../../hooks/useMobileSWR'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2PositionsAttention() {
  const { accountId } = useJ2SelectedAccount()
  const url = accountId
    ? `/api/j2/positions/attention?account_id=${encodeURIComponent(accountId)}`
    : '/api/j2/positions/attention'
  // 60s cadence — these facts (analyst actions, filings, earnings proximity,
  // ratings context) don't move at live-price speed; marketHoursOnly slows it
  // 10x off-hours, mirroring useJ2Positions.js.
  const { data, error, isLoading } = useMobileSWR(url, fetcher, {
    refreshInterval: 60_000,
    marketHoursOnly: true,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    attention: data ?? {},
    isLoading,
    error,
  }
}
