// app/src/pages/terminal/panels/fundGrids.seedParity.test.js
//
// TERM-065, 2026-11-23: the OWN panel's two fund tables (13F holders, N-PORT funds) moved their header
// decisions onto the DataGrid seed and kept their comparators. This file holds the move to "no member sees a
// different order": the functions as they were before the move are copied below VERBATIM, and every column,
// both directions, an unknown direction and an unknown column are compared, row for row, on rows that hold
// missing figures, equal figures and several new positions (whose change is Infinity), in an order that is
// not the vendor's.
import { describe, it, expect } from 'vitest'
import { COLUMN_BY_KEY, DEFAULT_SORT, FUND_COLUMNS, nextSort, sortFundRows } from './fundHoldersModel'
import {
  DEFAULT_SORT as NPORT_DEFAULT, NPORT_COLUMNS, NPORT_COLUMN_BY_KEY, nextNportSort, sortNportRows,
} from './fundNportModel'

// ── before the move, verbatim ─────────────────────────────────────────────────
const sortKeyOf = (column, row) => {
  if (column.key === 'holder') return row.name ? row.name.toLowerCase() : null
  const v = column.value(row)
  return v == null ? null : v
}
function oldSortFundRows(rows, sort = DEFAULT_SORT) {
  const column = COLUMN_BY_KEY[sort?.key] || COLUMN_BY_KEY[DEFAULT_SORT.key]
  const dir = sort?.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = sortKeyOf(column, a)
    const y = sortKeyOf(column, b)
    if (x == null || y == null) return x == null && y == null ? a.rank - b.rank : x == null ? 1 : -1
    if (x < y) return -dir
    if (x > y) return dir
    return a.rank - b.rank
  })
}
function oldNextSort(current, key) {
  const column = COLUMN_BY_KEY[key]
  if (!column) return current || DEFAULT_SORT
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: column.kind === 'text' ? 'asc' : 'desc' }
}
const sortKey = (column, row) => {
  if (column.key === 'fund') return row.name ? row.name.toLowerCase() : null
  const v = column.value(row)
  return v == null ? null : v
}
function oldSortNportRows(rows, sort = NPORT_DEFAULT) {
  const column = NPORT_COLUMN_BY_KEY[sort?.key] || NPORT_COLUMN_BY_KEY[NPORT_DEFAULT.key]
  const dir = sort?.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = sortKey(column, a)
    const y = sortKey(column, b)
    if (x == null || y == null) return x == null && y == null ? a.rank - b.rank : x == null ? 1 : -1
    if (x < y) return -dir
    if (x > y) return dir
    return a.rank - b.rank
  })
}
function oldNextNportSort(current, key) {
  const column = NPORT_COLUMN_BY_KEY[key]
  if (!column) return current || NPORT_DEFAULT
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: column.kind === 'text' ? 'asc' : 'desc' }
}

// ── rows: deterministic, with blanks, ties and Infinity, shuffled away from the vendor's order ───────────────
function rand(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const STATES = ['new', 'sold_out', 'added', 'cut', 'held', null]
const NAMES = ['Vanguard', 'BlackRock', 'state street', 'Fidelity', 'vanguard', '', null, 'Ärzte Fund', 'zeta']
const NUMS = [null, 0, 5, 5, -3, 1200, 1e9, 0.5, -0.5, 42]
const DAYS = [null, '2026-09-30', '2026-06-30', '2026-09-30', '2025-12-31']

function rows(n, seed) {
  const r = rand(seed)
  const out = []
  for (let i = 0; i < n; i += 1) {
    out.push({
      key: `k${i}`, rank: i, name: pick(r, NAMES), state: pick(r, STATES),
      shares: pick(r, NUMS), changeShares: pick(r, NUMS), changePct: pick(r, NUMS), ownership: pick(r, NUMS),
      value: pick(r, NUMS), weight: pick(r, NUMS), priorShares: pick(r, NUMS), priorValue: pick(r, NUMS),
      changeOwnership: pick(r, NUMS), changeWeight: pick(r, NUMS), pct: pick(r, NUMS),
      filed: pick(r, DAYS), period: pick(r, DAYS), priorPeriod: pick(r, DAYS),
    })
  }
  for (let i = out.length - 1; i > 0; i -= 1) {           // not the vendor's order
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
const keys = (list) => list.map((x) => x.key)
const DIRS = ['asc', 'desc', undefined, 'sideways']

describe('TERM-065: the fund tables sort exactly as they did before the move onto the seed', () => {
  for (const [label, columns, sortNew, sortOld] of [
    ['13F holders', FUND_COLUMNS, sortFundRows, oldSortFundRows],
    ['N-PORT funds', NPORT_COLUMNS, sortNportRows, oldSortNportRows],
  ]) {
    it(`${label}: every column, every direction, an unknown column and no sort`, () => {
      let compared = 0
      for (const seed of [1, 7, 42, 2026]) {
        const data = rows(40, seed)
        for (const c of [...columns.map((x) => x.key), 'no-such-column']) {
          for (const dir of DIRS) {
            expect(keys(sortNew(data, { key: c, dir })), `${label} ${c} ${dir} seed ${seed}`)
              .toEqual(keys(sortOld(data, { key: c, dir })))
            compared += 1
          }
        }
        expect(keys(sortNew(data))).toEqual(keys(sortOld(data)))
        expect(keys(sortNew(data, null))).toEqual(keys(sortOld(data, null)))
      }
      expect(compared).toBeGreaterThan(100)
    })
  }

  it('the data is not vacuous: blanks, ties and several new positions (Infinity) are present', () => {
    const data = rows(40, 7)
    expect(data.filter((x) => x.state === 'new').length).toBeGreaterThan(1)
    expect(data.filter((x) => x.shares == null).length).toBeGreaterThan(0)
    expect(new Set(data.map((x) => x.shares)).size).toBeLessThan(data.length)
  })

  for (const [label, columns, nextNew, nextOld, dflt] of [
    ['13F holders', FUND_COLUMNS, nextSort, oldNextSort, DEFAULT_SORT],
    ['N-PORT funds', NPORT_COLUMNS, nextNportSort, oldNextNportSort, NPORT_DEFAULT],
  ]) {
    it(`${label}: the header press decides the same next sort from every state`, () => {
      const ks = [...columns.map((x) => x.key), 'no-such-column']
      const states = [undefined, null, dflt, ...ks.flatMap((k) => [{ key: k, dir: 'asc' }, { key: k, dir: 'desc' }])]
      for (const s of states) {
        for (const k of ks) expect(nextNew(s, k), `${label} ${JSON.stringify(s)} -> ${k}`).toEqual(nextOld(s, k))
      }
    })
  }
})
