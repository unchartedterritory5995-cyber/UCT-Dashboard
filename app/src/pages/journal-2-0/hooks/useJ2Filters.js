/**
 * Journal 2.0 — filter state + URL-state persistence + apply logic.
 * Spec §12 (Filters panel).
 *
 * Filter semantics:
 *   • AND across sections — a trade passes only if every active
 *     section matches.
 *   • OR within checkbox groups — sides={Long,Short} means either side.
 *   • Empty value = section is off.
 *   • Symbol match: starts-with, case-insensitive.
 *
 * URL state: the hook mirrors filter state to/from query-string via
 * react-router-dom's useSearchParams. The URL is the source of truth
 * on mount. Local changes write back.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/** @typedef {'Long'|'Short'} Side */

const EMPTY_FILTERS = {
  dateFrom: '',
  dateTo: '',
  symbol: '',
  sides: /** @type {Set<Side>} */ (new Set()),
  setups: /** @type {Set<string>} */ (new Set()),
}

const URL_KEYS = {
  dateFrom: 'from',
  dateTo: 'to',
  symbol: 'sym',
  sides: 'sides',
  setups: 'setups',
}

function parseSetFromParam(value) {
  if (!value) return new Set()
  return new Set(value.split(',').map(decodeURIComponent).filter(Boolean))
}

function encodeSet(set) {
  return Array.from(set).map(encodeURIComponent).join(',')
}

export function filtersFromSearchParams(searchParams) {
  return {
    dateFrom: searchParams.get(URL_KEYS.dateFrom) || '',
    dateTo: searchParams.get(URL_KEYS.dateTo) || '',
    symbol: searchParams.get(URL_KEYS.symbol) || '',
    sides: parseSetFromParam(searchParams.get(URL_KEYS.sides)),
    setups: parseSetFromParam(searchParams.get(URL_KEYS.setups)),
  }
}

export function writeFiltersToSearchParams(filters, current) {
  const next = new URLSearchParams(current)
  const scalars = ['dateFrom', 'dateTo', 'symbol']
  for (const key of scalars) {
    const urlKey = URL_KEYS[key]
    const v = filters[key]
    if (v === '' || v == null) next.delete(urlKey)
    else next.set(urlKey, String(v))
  }
  const sets = ['sides', 'setups']
  for (const key of sets) {
    const urlKey = URL_KEYS[key]
    const s = filters[key]
    if (!s || s.size === 0) next.delete(urlKey)
    else next.set(urlKey, encodeSet(s))
  }
  return next
}

export function isEmptyFilters(f) {
  return (
    f.dateFrom === '' &&
    f.dateTo === '' &&
    f.symbol === '' &&
    f.sides.size === 0 &&
    f.setups.size === 0
  )
}

export function countActiveSections(f) {
  let n = 0
  if (f.dateFrom || f.dateTo) n++
  if (f.symbol) n++
  if (f.sides.size > 0) n++
  if (f.setups.size > 0) n++
  return n
}

/**
 * Apply filters to a trades array. Returns a NEW filtered array.
 * Keep this pure — `useMemo` callers depend on it.
 */
export function applyFilters(trades, f) {
  if (isEmptyFilters(f)) return trades

  const symUpper = f.symbol ? f.symbol.toUpperCase() : null

  return trades.filter((t) => {
    if (f.dateFrom || f.dateTo) {
      const d = (t.entryDate || '').slice(0, 10)
      if (f.dateFrom && d < f.dateFrom) return false
      if (f.dateTo && d > f.dateTo) return false
    }

    if (symUpper) {
      if (!t.symbol || !t.symbol.toUpperCase().startsWith(symUpper)) return false
    }

    if (f.sides.size > 0) {
      if (!f.sides.has(t.side)) return false
    }

    if (f.setups.size > 0) {
      if (!t.setup) return false
      if (!f.setups.has(t.setup)) return false
    }

    return true
  })
}

export default function useJ2Filters() {
  const [searchParams, setSearchParams] = useSearchParams()

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
