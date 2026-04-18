/**
 * Journal 2.0 — filter state + URL-state persistence + apply logic.
 * Spec §12 (Filters panel) + §15.5 (<100ms recompute on 1,000 trades).
 *
 * Filter semantics:
 *   • AND across sections — a trade passes only if every active
 *     section matches.
 *   • OR within checkbox groups — sides={Long,Short} means either side.
 *   • Empty value = section is off.
 *   • Null-context handling: context-targeted filters (RS, NASI/breadth,
 *     Nav Count, Power Trend, Rally Day) EXCLUDE trades with null for
 *     the filtered field. Matches spec §12.1 RS rule; applied
 *     consistently.
 *   • Symbol match: starts-with, case-insensitive.
 *
 * URL state: the hook mirrors filter state to/from query-string via
 * react-router-dom's useSearchParams. The URL is the source of truth
 * on mount. Local changes write back.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/** @typedef {'Long'|'Short'} Side */
/** @typedef {'light'|'moderate'|'heavy'} NavBucket */
/** @typedef {'On'|'Off'} PowerTrend */

const EMPTY_FILTERS = {
  dateFrom: '',
  dateTo: '',
  symbol: '',
  rsMin: '',
  nasiDir: '',   // '' | 'Above' | 'Below'
  nasiThreshold: '',
  sides: /** @type {Set<Side>} */ (new Set()),
  setups: /** @type {Set<string>} */ (new Set()),
  navBuckets: /** @type {Set<NavBucket>} */ (new Set()),
  powerTrends: /** @type {Set<PowerTrend>} */ (new Set()),
  rallyDay: '',
}

// URL-param keys (short for readable URLs). Stable — don't rename
// without a migration path.
const URL_KEYS = {
  dateFrom: 'from',
  dateTo: 'to',
  symbol: 'sym',
  rsMin: 'rs',
  nasiDir: 'ndir',
  nasiThreshold: 'nth',
  sides: 'sides',
  setups: 'setups',
  navBuckets: 'nav',
  powerTrends: 'pt',
  rallyDay: 'rd',
}

function parseSetFromParam(value) {
  if (!value) return new Set()
  return new Set(value.split(',').map(decodeURIComponent).filter(Boolean))
}

function encodeSet(set) {
  return Array.from(set).map(encodeURIComponent).join(',')
}

/**
 * Read filter state out of URLSearchParams. Unknown params are ignored.
 */
export function filtersFromSearchParams(searchParams) {
  return {
    dateFrom: searchParams.get(URL_KEYS.dateFrom) || '',
    dateTo: searchParams.get(URL_KEYS.dateTo) || '',
    symbol: searchParams.get(URL_KEYS.symbol) || '',
    rsMin: searchParams.get(URL_KEYS.rsMin) || '',
    nasiDir: searchParams.get(URL_KEYS.nasiDir) || '',
    nasiThreshold: searchParams.get(URL_KEYS.nasiThreshold) || '',
    sides: parseSetFromParam(searchParams.get(URL_KEYS.sides)),
    setups: parseSetFromParam(searchParams.get(URL_KEYS.setups)),
    navBuckets: parseSetFromParam(searchParams.get(URL_KEYS.navBuckets)),
    powerTrends: parseSetFromParam(searchParams.get(URL_KEYS.powerTrends)),
    rallyDay: searchParams.get(URL_KEYS.rallyDay) || '',
  }
}

/**
 * Write filter state back into a URLSearchParams instance. Non-filter
 * params are preserved (e.g. `?view=j2`).
 */
export function writeFiltersToSearchParams(filters, current) {
  const next = new URLSearchParams(current)
  const scalars = [
    'dateFrom', 'dateTo', 'symbol', 'rsMin',
    'nasiDir', 'nasiThreshold', 'rallyDay',
  ]
  for (const key of scalars) {
    const urlKey = URL_KEYS[key]
    const v = filters[key]
    if (v === '' || v == null) next.delete(urlKey)
    else next.set(urlKey, String(v))
  }
  const sets = ['sides', 'setups', 'navBuckets', 'powerTrends']
  for (const key of sets) {
    const urlKey = URL_KEYS[key]
    const s = filters[key]
    if (!s || s.size === 0) next.delete(urlKey)
    else next.set(urlKey, encodeSet(s))
  }
  return next
}

/**
 * Is this filter object "empty" (no sections active)?
 */
export function isEmptyFilters(f) {
  return (
    f.dateFrom === '' &&
    f.dateTo === '' &&
    f.symbol === '' &&
    f.rsMin === '' &&
    f.nasiDir === '' &&
    f.nasiThreshold === '' &&
    f.sides.size === 0 &&
    f.setups.size === 0 &&
    f.navBuckets.size === 0 &&
    f.powerTrends.size === 0 &&
    f.rallyDay === ''
  )
}

/**
 * Count of active sections (§12.2 badge). A section with ≥ 1
 * non-empty value counts as 1.
 */
export function countActiveSections(f) {
  let n = 0
  if (f.dateFrom || f.dateTo) n++
  if (f.symbol) n++
  if (f.rsMin !== '' && f.rsMin != null) n++
  if (f.nasiDir && f.nasiThreshold !== '' && f.nasiThreshold != null) n++
  if (f.sides.size > 0) n++
  if (f.setups.size > 0) n++
  if (f.navBuckets.size > 0) n++
  if (f.powerTrends.size > 0) n++
  if (f.rallyDay) n++
  return n
}

/**
 * Nav Count bucket membership.
 */
function navBucketOf(n) {
  if (n == null || !Number.isFinite(n)) return null
  if (n <= 2) return 'light'
  if (n <= 4) return 'moderate'
  return 'heavy'
}

/**
 * Apply filters to a trades array. Returns a NEW filtered array.
 * Keep this pure — `useMemo` callers depend on it.
 *
 * @param {Array<any>} trades
 * @param {typeof EMPTY_FILTERS} f
 */
export function applyFilters(trades, f) {
  if (isEmptyFilters(f)) return trades

  const symUpper = f.symbol ? f.symbol.toUpperCase() : null
  const rsMinNum =
    f.rsMin !== '' && f.rsMin != null ? Number(f.rsMin) : null
  const nasiThresholdNum =
    f.nasiThreshold !== '' && f.nasiThreshold != null
      ? Number(f.nasiThreshold)
      : null
  const rallyQuery = f.rallyDay
    ? f.rallyDay.trim().toUpperCase()
    : null

  return trades.filter((t) => {
    const ctx = t.contextAtEntry || {}

    // Date range — inclusive. entryDate is ISO; compare YYYY-MM-DD prefix.
    if (f.dateFrom || f.dateTo) {
      const d = (t.entryDate || '').slice(0, 10)
      if (f.dateFrom && d < f.dateFrom) return false
      if (f.dateTo && d > f.dateTo) return false
    }

    // Symbol — starts-with, case-insensitive
    if (symUpper) {
      if (!t.symbol || !t.symbol.toUpperCase().startsWith(symUpper)) return false
    }

    // RS minimum — null rsRating excluded when set
    if (rsMinNum != null) {
      if (ctx.rsRating == null) return false
      if (ctx.rsRating < rsMinNum) return false
    }

    // NASI / breadth dir + threshold — null breadthValue excluded
    if (f.nasiDir && nasiThresholdNum != null) {
      if (ctx.breadthValue == null) return false
      if (f.nasiDir === 'Above' && !(ctx.breadthValue > nasiThresholdNum))
        return false
      if (f.nasiDir === 'Below' && !(ctx.breadthValue < nasiThresholdNum))
        return false
    }

    // Side
    if (f.sides.size > 0) {
      if (!f.sides.has(t.side)) return false
    }

    // Setup — null setup excluded when set filter is active
    if (f.setups.size > 0) {
      if (!t.setup) return false
      if (!f.setups.has(t.setup)) return false
    }

    // Nav Count bucket
    if (f.navBuckets.size > 0) {
      const bucket = navBucketOf(ctx.navCount)
      if (bucket == null) return false
      if (!f.navBuckets.has(bucket)) return false
    }

    // Power Trend
    if (f.powerTrends.size > 0) {
      if (ctx.powerTrend == null) return false
      if (!f.powerTrends.has(ctx.powerTrend)) return false
    }

    // Rally Day — exact case-insensitive match after trim
    if (rallyQuery) {
      if (ctx.rallyDay == null) return false
      if (ctx.rallyDay.trim().toUpperCase() !== rallyQuery) return false
    }

    return true
  })
}

/**
 * The hook React components consume. Returns stable setters and
 * derived values. URL is source of truth.
 */
export default function useJ2Filters() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Filters come from the URL directly — re-derived on every render.
  // React memoization below keeps `applyFilters` cheap.
  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  )

  const setFilter = useCallback(
    (key, value) => {
      setSearchParams(
        (prev) => {
          const current = filtersFromSearchParams(prev)
          const next = { ...current, [key]: value }
          return writeFiltersToSearchParams(next, prev)
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const toggleSetMember = useCallback(
    (key, member) => {
      setSearchParams(
        (prev) => {
          const current = filtersFromSearchParams(prev)
          const set = new Set(current[key])
          if (set.has(member)) set.delete(member)
          else set.add(member)
          return writeFiltersToSearchParams(
            { ...current, [key]: set },
            prev,
          )
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const resetFilters = useCallback(() => {
    setSearchParams(
      (prev) => writeFiltersToSearchParams(EMPTY_FILTERS, prev),
      { replace: true },
    )
  }, [setSearchParams])

  const activeCount = useMemo(() => countActiveSections(filters), [filters])

  return {
    filters,
    setFilter,
    toggleSetMember,
    resetFilters,
    activeCount,
  }
}

export { EMPTY_FILTERS, URL_KEYS }
