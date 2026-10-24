// app/src/hooks/usePatternDetections.js — SWR-cached hook for engine-detected chart patterns.
//
// Fetches Detection records from GET /api/patterns/{sym}?tf={tf}&min_conf={n} and polls every 30s
// to keep the overlay fresh as new patterns emerge during the trading day.
//
// Returns { detections, count, isLoading, error }. When `enabled` is false (or sym/tf missing),
// the SWR key is null so the request is suppressed entirely — safe to mount before user toggles.
import { useMemo } from 'react'
import useSWR from 'swr'

const EMPTY = Object.freeze([])

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

export function usePatternDetections(sym, tf, enabled = true, minConf = 50, { includeStructures = false } = {}) {
  // confirmed_only=false: the on-chart overlay needs the full rule-engine detection
  // geometry to draw shapes. The confirmed-vision surface lives on /confirmed/{sym}.
  // includeStructures (AUTO_STRUCTURES_ENABLED, admins): the server adds the current
  // base boxes as `structures` and the learned auto-drawer's lines as `drawn`;
  // a paid member with AUTO_STRUCTURES_MEMBERS_ENABLED also sends it, and the server answers with
  // the member set only (registry.DISPLAY_MEMBER_SET rows; NO learned `drawn` block while
  // auto_structures.MEMBER_LEARNED_LINES_ROUND is None).
  const key =
    enabled && sym && tf
      ? `/api/patterns/${encodeURIComponent(sym)}?tf=${encodeURIComponent(tf)}&min_conf=${minConf}&confirmed_only=false${includeStructures ? '&include_structures=true' : ''}`
      : null

  const { data, error, isLoading } = useSWR(key, fetcher, {
    refreshInterval: 30_000, // poll every 30s for fresh detections
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
  })

  // Memoized on the response object so the merged list keeps its identity between renders.
  const detections = useMemo(() => {
    const base = data?.detections || EMPTY
    const structures = Array.isArray(data?.structures) ? data.structures : EMPTY
    return structures.length ? [...base, ...structures] : base
  }, [data])
  return {
    detections,
    // The learned auto-drawer (admin + AUTO_STRUCTURES_ENABLED, D/W/M): trendlines,
    // levels and the display rules that ride with them. null whenever absent.
    drawn: data?.drawn || null,
    // Deal status (DEAL_STATUS_ENABLED): the stock is pending acquisition, so the server sent
    // no drawings and this small marker instead. null whenever absent.
    dealStatus: data?.deal_status?.pending ? data.deal_status : null,
    // Gate SIGNALS for the UCT Intelligence panel's released-layer toggles (uctIntelligence.layerAvailability):
    // undefined while the server sends no such key (the layer is not released to this viewer), the payload
    // otherwise. `levels_sr` is the textbook support/resistance layer; `candle_marks` the candlestick markers.
    levelsSr: data && Object.prototype.hasOwnProperty.call(data, 'levels_sr') ? data.levels_sr : undefined,
    candleMarks: data && Object.prototype.hasOwnProperty.call(data, 'candle_marks') ? data.candle_marks : undefined,
    // `setup_draws` is the setup-drawing layer (remount / undercut & rally / donchian lines; server-gated by
    // AUTO_STRUCTURES_G4_SETUPS_ENABLED and, for a member, the released rounds). Present = released to this viewer.
    setupDraws: data && Object.prototype.hasOwnProperty.call(data, 'setup_draws') ? data.setup_draws : undefined,
    count: data?.count || 0,
    isLoading,
    error,
  }
}

export default usePatternDetections
