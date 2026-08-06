// app/src/components/chart/engine/serverCompute.test.js
//
// The `compute.kind: 'server'` lane's contract, in the order it matters:
//   1. the WIRE FORMAT — arrays with `null`, never point objects,
//   2. the JOIN — by TIME onto the chart's own bars, never by index,
//   3. the CACHE — one request per (definition, symbol, timeframe, inputs),
//   4. GENERICITY — the lane names no tenant, asserted against its own source.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SERVER_COLUMNS_PATH,
  serverColumnsUrl,
  serverColumnsKey,
  serverInputsParam,
  columnsFromWire,
  alignColumns,
  cachedColumns,
  ensureColumns,
  fetchColumns,
  primeServerColumns,
  clearServerColumns,
  serverColumnsFor,
  subscribe,
} from './serverCompute'
import { listDefinitions, getDefinition, computeFor } from './nativeRegistry'

const bars = (times) => times.map((t, i) => ({ t, o: 1, h: 2, l: 0.5, c: 1 + i, v: 100 }))

beforeEach(() => { clearServerColumns() })

// ─── the URL and the key ─────────────────────────────────────────────────────

describe('the address of a server-lane column set', () => {
  it('is ONE path with a defId, for every tenant', () => {
    expect(serverColumnsUrl('rsLine', 'NVDA', '5', { benchmark: 'QQQ' }))
      .toBe(`${SERVER_COLUMNS_PATH}?defId=rsLine&sym=NVDA&tf=5&inputs=%7B%22benchmark%22%3A%22QQQ%22%7D`)
    expect(serverColumnsUrl('uct-flow-breakout', 'BRK-B', 'D', null))
      .toBe(`${SERVER_COLUMNS_PATH}?defId=uct-flow-breakout&sym=BRK-B&tf=D`)
  })

  it('is null when there is nothing to ask for', () => {
    expect(serverColumnsUrl('', 'NVDA', 'D', null)).toBeNull()
    expect(serverColumnsUrl('rsLine', '  ', 'D', null)).toBeNull()
    expect(serverColumnsUrl('rsLine', null, 'D', null)).toBeNull()
  })

  it('SORTS the inputs, so one instance is one cache entry', () => {
    // ⛔ Without the sort, `{a,b}` and `{b,a}` are two keys, two in-flight
    // requests and two answers for one chart — and which one wins depends on
    // React's render order, which is the least debuggable class of bug there is.
    expect(serverInputsParam({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(serverColumnsKey('rsLine', 'X', 'D', { b: 2, a: 1 }))
      .toBe(serverColumnsKey('rsLine', 'X', 'D', { a: 1, b: 2 }))
    // …and an empty input map is not a different key from no input map.
    expect(serverColumnsKey('rsLine', 'X', 'D', {})).toBe(serverColumnsKey('rsLine', 'X', 'D', null))
  })
})

// ─── the wire format ─────────────────────────────────────────────────────────

describe('the wire format — arrays with null, never points', () => {
  it('maps null ⇄ NaN AT THIS BOUNDARY', () => {
    const { columns } = columnsFromWire({ times: [1, 2, 3], columns: { rsLine: [null, 0.5, null] } })
    expect(columns.rsLine).toBeInstanceOf(Float64Array)
    expect(Number.isNaN(columns.rsLine[0])).toBe(true)
    expect(columns.rsLine[1]).toBe(0.5)
    expect(Number.isNaN(columns.rsLine[2])).toBe(true)
  })

  it('⛔ REFUSES point objects, by name', () => {
    // The mutation this exists for: a server emitting `[{time, value}]` puts the
    // column→points conversion in a second place with nothing keeping the two
    // equal, and the first divergence is a line drawn on the wrong bars.
    expect(() => columnsFromWire({
      times: [1, 2],
      columns: { rsLine: [{ time: 1, value: 0.5 }, { time: 2, value: 0.6 }] },
    })).toThrow(/point objects/)
  })

  it('refuses a non-array column and a non-mapping `columns`', () => {
    expect(() => columnsFromWire({ columns: { rsLine: 'nope' } })).toThrow(/not an array/)
    expect(() => columnsFromWire({ columns: [1, 2, 3] })).toThrow(/mapping of key to array/)
    expect(() => columnsFromWire(null)).toThrow(/not an object/)
  })

  it('refuses a column whose length disagrees with `times`', () => {
    expect(() => columnsFromWire({ times: [1, 2, 3], columns: { rsLine: [1, 2] } }))
      .toThrow(/positional/)
  })

  it('accepts an envelope with NO columns — that is a real answer, not a failure', () => {
    // Dark-pool levels and GEX walls draw horizontal LEVELS, which v1's plot
    // vocabulary cannot express as a column. `{}` is the honest declaration.
    expect(columnsFromWire({ levels: [{ price: 1 }] })).toEqual({ times: [], columns: {} })
  })
})

// ─── the join ────────────────────────────────────────────────────────────────

describe('the join is BY TIME, never by index', () => {
  const parsed = { times: [10, 20, 40], columns: { rsLine: new Float64Array([1, 2, 4]) } }

  it('places each value on the bar with its own time', () => {
    const out = alignColumns(parsed, bars([10, 20, 30, 40]))
    expect([...out.rsLine].map(v => (Number.isNaN(v) ? 'NaN' : v))).toEqual([1, 2, 'NaN', 4])
  })

  it('⛔ and the index join is a DIFFERENT answer — the control', () => {
    // The bar at t=30 has no server value. Under an index join the value for
    // t=40 would land on it and every later bar would be shifted: plausible, and
    // wrong for the whole history rather than absent for one bar.
    const out = alignColumns(parsed, bars([10, 20, 30, 40]))
    expect(out.rsLine[2]).not.toBe(4)
    expect(Number.isNaN(out.rsLine[2])).toBe(true)
  })

  it('yields {} for a non-positional envelope', () => {
    expect(alignColumns({ times: [], columns: { levels: new Float64Array([1]) } }, bars([1]))).toEqual({})
    expect(alignColumns({ times: [1], columns: {} }, bars([1]))).toEqual({})
  })
})

// ─── the cache ───────────────────────────────────────────────────────────────

describe('the cache — one request per (definition, symbol, timeframe, inputs)', () => {
  const wire = { times: [1, 2], columns: { rsLine: [0.5, null] } }

  it('dedupes concurrent asks and serves the landed entry synchronously', async () => {
    const fetcher = vi.fn().mockResolvedValue(wire)
    expect(cachedColumns('rsLine', 'NVDA', 'D', null)).toBeNull()
    const a = fetchColumns('rsLine', 'NVDA', 'D', null, fetcher)
    const b = fetchColumns('rsLine', 'NVDA', 'D', null, fetcher)
    expect(a).toBe(b)
    await a
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cachedColumns('rsLine', 'NVDA', 'D', null).columns.rsLine[0]).toBe(0.5)
    // …and a DIFFERENT symbol is a different entry, or sixteen grid cells would
    // all read the first one's numbers.
    expect(cachedColumns('rsLine', 'AAPL', 'D', null)).toBeNull()
  })

  it('⛔ does NOT cache a failure — an absent entry retries, a cached one never does', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('HTTP 402'))
    await fetchColumns('rsLine', 'NVDA', 'D', null, fetcher)
    expect(cachedColumns('rsLine', 'NVDA', 'D', null)).toBeNull()
    // lesson_market_cap_cache_poison: a cached empty answer is remembered as
    // "no data" for the life of the chart.
    await fetchColumns('rsLine', 'NVDA', 'D', null, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('notifies subscribers when an entry lands, and a bad subscriber cannot break the lane', async () => {
    const seen = []
    const off = subscribe((k) => seen.push(k))
    subscribe(() => { throw new Error('a bad subscriber') })
    await fetchColumns('rsLine', 'NVDA', 'D', null, vi.fn().mockResolvedValue(wire))
    expect(seen).toEqual([serverColumnsKey('rsLine', 'NVDA', 'D', null)])
    off()
  })

  it('`ensureColumns` answers now and asks for next time; `cachedColumns` never asks', async () => {
    const fetcher = vi.fn().mockResolvedValue(wire)
    expect(cachedColumns('rsLine', 'NVDA', 'D', null)).toBeNull()
    expect(ensureColumns('rsLine', 'NVDA', 'D', null, fetcher)).toBeNull()
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1)
    // …and a plain READ costs NOTHING, which is what lets a probe, a test or a
    // second lane ask the cache without paying for a request.
    clearServerColumns()
    const quiet = vi.fn().mockResolvedValue(wire)
    expect(cachedColumns('rsLine', 'NVDA', 'D', null, quiet)).toBeNull()
    await Promise.resolve()
    expect(quiet).not.toHaveBeenCalled()
  })

  it('`primeServerColumns` fills the entry from a payload somebody else fetched', () => {
    expect(primeServerColumns('uct-flow-breakout', 'NVDA', 'D', null,
      { times: [1, 2], columns: { bull: [0, 1], bear: [0, 0] } })).toBeTruthy()
    expect(cachedColumns('uct-flow-breakout', 'NVDA', 'D', null).columns.bull[1]).toBe(1)
    // …and a MALFORMED envelope is not primed, so a defect is never remembered
    // as an answer.
    expect(primeServerColumns('rsLine', 'NVDA', 'D', null,
      { times: [1], columns: { rsLine: [{ time: 1, value: 2 }] } })).toBeNull()
    expect(cachedColumns('rsLine', 'NVDA', 'D', null)).toBeNull()
  })
})

// ─── computeFor, through the real registry ──────────────────────────────────

describe('the registry resolves a server definition through this lane', () => {
  const def = () => getDefinition('rsLine')

  it('rsLine IS registered, and it is the SERVER lane', () => {
    expect(listDefinitions().map(d => d.id)).toContain('rsLine')
    expect(def().compute.kind).toBe('server')
  })

  it('returns {} while nothing has landed — it does NOT throw', () => {
    // ⛔ THE PROPERTY THAT MADE REGISTERING IT SAFE. Task 14 kept `rsLine` out of
    // `listDefinitions()` because *"registering it would publish an indicator the
    // binder throws on"*. `{}` is what `hasData` reads as "draw nothing this
    // paint", the same answer a native's warmup pad gives.
    expect(computeFor(def(), bars([1, 2]), {})).toEqual({})
    expect(computeFor(def(), bars([1, 2]), {}, { sym: '', tf: 'D' })).toEqual({})
  })

  it('draws the fetched column, joined to the chart\'s OWN bars', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      times: [10, 20, 40], columns: { rsLine: [0.1, 0.2, 0.4] },
    })
    const ctx = { sym: 'NVDA', tf: 'D', fetcher }
    // First paint: nothing yet, and the fetch is in flight.
    expect(serverColumnsFor(def(), bars([10, 20, 30, 40]), { benchmark: 'SPY' }, ctx)).toEqual({})
    await fetchColumns('rsLine', 'NVDA', 'D', { benchmark: 'SPY' }, fetcher)
    // Second paint: the column, on the right bars.
    const out = serverColumnsFor(def(), bars([10, 20, 30, 40]), { benchmark: 'SPY' }, ctx)
    expect([...out.rsLine].map(v => (Number.isNaN(v) ? 'NaN' : v))).toEqual([0.1, 0.2, 'NaN', 0.4])
  })

  it('keys the request on the RESOLVED inputs, so a default and an explicit default agree', async () => {
    // ⭐ THROUGH `computeFor`, NOT `serverColumnsFor`: resolving the declared
    // defaults is `computeFor`'s job on BOTH lanes, so an instance that stored
    // nothing and one that stored the default must be ONE cache entry. Asking the
    // lane directly with a raw `{}` would key an inputs-free request and the two
    // would silently be two.
    const fetcher = vi.fn().mockResolvedValue({ times: [1], columns: { rsLine: [1] } })
    const ctx = { sym: 'NVDA', tf: 'D', fetcher }
    computeFor(def(), bars([1]), {}, ctx)                       // no benchmark given
    await Promise.resolve()
    computeFor(def(), bars([1]), { benchmark: 'SPY' }, ctx)     // the SAME benchmark, stated
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(fetcher.mock.calls[0][0])).toContain('"benchmark":"SPY"')
    // …and a DIFFERENT benchmark really is a second request, or the line above
    // would hold for a key that ignored inputs entirely.
    computeFor(def(), bars([1]), { benchmark: 'QQQ' }, ctx)
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

// ─── genericity, asserted against the source ────────────────────────────────

describe('⭐ the lane is GENERIC — a fourth tenant needs no code in it', () => {
  const SRC = readFileSync(
    resolve(process.cwd(), 'src/components/chart/engine/serverCompute.js'), 'utf8')

  it('names no tenant anywhere in its own source', () => {
    // ⛔ THE CLAIM SPEC §10 ASKED FOR, MEASURED. "Three definitions that each know
    // their own endpoint is not a lane." Comments are stripped first — this file
    // NAMES its tenants in prose deliberately, and a rail that could not tell a
    // sentence from a branch would force the prose out.
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const id of listDefinitions().map(d => d.id)) {
      expect(code.includes(`'${id}'`), `serverCompute.js hardcodes the definition id ${id}`).toBe(false)
      expect(code.includes(`"${id}"`), `serverCompute.js hardcodes the definition id ${id}`).toBe(false)
    }
    // ⛔ AND THE STRIPPER IS WHAT MAKES THE ZEROES MEAN SOMETHING: the RAW source
    // really does contain a tenant's name, so a probe without it would report a
    // hardcode forever and a broken stripper would report none.
    expect(SRC.includes('rsLine') || SRC.includes('RS line')).toBe(true)
    expect(code.length).toBeLessThan(SRC.length)
  })

  it('and it holds no entitlement logic — the gate is the handler', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const word of ['isPaid', 'require_paid', 'paid', 'plan', '402']) {
      expect(code.includes(word), `serverCompute.js decides entitlement (${word})`).toBe(false)
    }
  })
})
