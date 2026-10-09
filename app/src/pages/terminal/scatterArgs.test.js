// SCAT's arguments (wave 9, lane 2). Rails:
//   * the metric and universe tables MIRROR api/services/scatter.py, read from the file, so a key
//     the server stops serving (or starts serving) reds here instead of drawing an empty axis;
//   * every universe word round-trips: parse(word) gives the pick, token(pick) gives the word back;
//   * the command a view is written as leaves defaults out and writes the axes as a pair, Y then X;
//     a member's own list has no word and gives null (the panel keeps it, unsaved);
//   * through the registry: applied args become props, a junk word is echoed "not applied".
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SCAT_BREADTH, SCAT_DEFAULT, SCAT_ETFS, SCAT_INDEXES, SCAT_METRICS, SCAT_SCANNERS,
  parseScatMetric, parseScatUniverse, scatCommand, scatUniverseToken,
} from './scatterArgs'
import { applyArgs, argsEcho } from './args'
import { BY_CODE } from './functions'
import parseCommand from './parseCommand'
import { describeCommand } from './grammar'

const here = dirname(fileURLToPath(import.meta.url))
const PY = readFileSync(resolve(here, '../../../../api/services/scatter.py'), 'utf8')

/** The body of a top-level `NAME = [ ... ]` list in scatter.py. */
function pyList(name) {
  const m = PY.match(new RegExp(`^${name} = \\[([\\s\\S]*?)^\\]`, 'm'))
  if (!m) throw new Error(`${name} not found in scatter.py`)
  return m[1]
}
const pairs = (body) => [...body.matchAll(/\("([^"]+)",\s*"([^"]+)"/g)].map((x) => [x[1], x[2]])

describe('scatterArgs mirrors the server', () => {
  it('METRICS: the same keys and labels, in the same order', () => {
    const server = [...pyList('METRICS').matchAll(/"key":\s*"([a-z0-9_]+)",\s*"label":\s*"([^"]+)"/g)].map((x) => [x[1], x[2]])
    expect(server.length).toBeGreaterThan(20)                 // non-vacuity: the parse found the catalog
    expect(server).toContainEqual(['rs_rank', 'RS Rating'])
    expect(SCAT_METRICS.map(([k, l]) => [k, l])).toEqual(server)
  })

  it('the universe tables: indexes, ETFs, scanners and breadth sets', () => {
    const indexes = pairs(pyList('_INDEX_SETS'))
    expect(indexes).toContainEqual(['sp500', 'S&P 500'])
    expect(Object.entries(SCAT_INDEXES).map(([k, [label]]) => [k, label])).toEqual(indexes)
    const etfs = pairs(pyList('_ETF_SETS')).map(([t]) => t)
    expect(etfs).toContain('XLK')
    expect([...SCAT_ETFS]).toEqual(etfs)
    const scanners = pairs(pyList('_SCANNERS'))
    expect(scanners.length).toBeGreaterThan(2)
    expect(Object.entries(SCAT_SCANNERS)).toEqual(scanners)
    const breadth = pairs(pyList('_BREADTH_SETS'))
    expect(breadth).toContainEqual(['new_52w_highs', 'New 52w Highs'])
    expect(Object.entries(SCAT_BREADTH)).toEqual(breadth)
  })

  it('the default view is the panel default the server serves', () => {
    expect(SCAT_INDEXES[SCAT_DEFAULT.value]).toBeTruthy()
    expect(parseScatMetric(SCAT_DEFAULT.yKey)).toBe('rs_rank')
    expect(parseScatMetric(SCAT_DEFAULT.xKey)).toBe('dist_52w_high')
  })
})

describe('the universe word', () => {
  it('every offered universe round-trips through its word', () => {
    const picks = [
      ...Object.keys(SCAT_INDEXES).map((v) => ({ source: 'index', value: v })),
      ...SCAT_ETFS.map((v) => ({ source: 'etf', value: v })),
      ...Object.keys(SCAT_SCANNERS).map((v) => ({ source: 'scanner', value: v })),
      ...Object.keys(SCAT_BREADTH).map((v) => ({ source: 'breadth', value: v })),
      { source: 'market', value: '' }, { source: 'sectors', value: '' }, { source: 'flagged', value: '' }, { source: 'uct20', value: '' },
    ]
    for (const p of picks) {
      const word = scatUniverseToken(p)
      expect(word, `${p.source}:${p.value}`).toBeTruthy()
      expect(parseScatUniverse(word)).toMatchObject({ source: p.source, value: p.value, token: word })
      expect(parseScatUniverse(word.toLowerCase())).toMatchObject({ source: p.source, value: p.value })
    }
  })

  it('other spellings land on the same pick; junk and a member\'s own list do not', () => {
    expect(parseScatUniverse('SPX')).toMatchObject({ source: 'index', value: 'sp500', label: 'S&P 500', token: 'SP500' })
    expect(parseScatUniverse('qqq')).toMatchObject({ value: 'ndx', token: 'NDX' })
    expect(parseScatUniverse('ALL')).toMatchObject({ source: 'market', token: 'MARKET' })
    expect(parseScatUniverse('SCAN:VOLUME')).toMatchObject({ source: 'scanner', value: 'volume', label: 'Volume Surge' })
    for (const junk of ['', 'NVDA', 'SCAN:NOPE', 'BREADTH:', 'RS_RANK', 'W:abc']) expect(parseScatUniverse(junk)).toBeNull()
    expect(scatUniverseToken({ source: 'watchlist', value: 'ab12' })).toBeNull()
    expect(scatUniverseToken({ source: 'theme', value: '7' })).toBeNull()
    expect(scatUniverseToken({ source: 'industry', value: 'Semiconductors' })).toBeNull()
  })

  it('a metric word is a catalog key, any case', () => {
    expect(parseScatMetric('RS_RANK')).toBe('rs_rank')
    expect(parseScatMetric('chg_1m')).toBe('chg_1m')
    expect(parseScatMetric('RS')).toBeNull()
    expect(parseScatMetric('NDX')).toBeNull()
  })
})

describe('the command a view is written as', () => {
  const view = (o) => ({ source: 'index', value: 'sp500', yKey: 'rs_rank', xKey: 'dist_52w_high', ...o })
  it('defaults are left out; axes are written as a pair, Y then X', () => {
    expect(scatCommand(view())).toBe('SCAT')
    expect(scatCommand(view({ value: 'ndx' }))).toBe('SCAT NDX')
    expect(scatCommand(view({ xKey: 'chg_1m' }))).toBe('SCAT RS_RANK CHG_1M')
    expect(scatCommand(view({ source: 'etf', value: 'XLK', yKey: 'chg_1w' }))).toBe('SCAT XLK CHG_1W DIST_52W_HIGH')
    expect(scatCommand(view({ source: 'breadth', value: 'new_52w_highs' }))).toBe('SCAT BREADTH:NEW_52W_HIGHS')
  })
  it('a member\'s own list cannot be written', () => {
    expect(scatCommand(view({ source: 'watchlist', value: 'ab12' }))).toBeNull()
  })
})

describe('SCAT through the registry', () => {
  const v = BY_CODE.SCAT.market
  it('a written command parses back to the same view', () => {
    for (const line of ['SCAT', 'SCAT NDX', 'SCAT RS_RANK CHG_1M', 'SCAT XLK CHG_1W DIST_52W_HIGH', 'SCAT BREADTH:NEW_52W_HIGHS', 'SCAT SCAN:VOLUME', 'SCAT FLAGGED', 'SCAT DOW', 'SCAT MARKET']) {
      const cmd = parseCommand(line)
      expect(cmd, line).toMatchObject({ ok: true, type: 'function', code: 'SCAT' })
      expect(applyArgs(v, cmd.args).ignored, line).toEqual([])
      expect(describeCommand(cmd).tone, line).not.toBe('error')
    }
    const { props, applied } = applyArgs(v, parseCommand('scat ndx chg_1m rs_rank').args)
    expect(props).toMatchObject({ universe: { source: 'index', value: 'ndx' }, yKey: 'chg_1m', xKey: 'rs_rank' })
    expect(applied).toEqual(['universe Nasdaq 100', 'Y axis 1-Month %', 'X axis RS Rating'])
    expect(scatCommand({ ...props.universe, yKey: props.yKey, xKey: props.xKey })).toBe('SCAT NDX CHG_1M RS_RANK')
  })

  it('a word SCAT cannot use is echoed as not applied, never dropped', () => {
    const out = applyArgs(v, ['NDX', 'FOO', 'RS_RANK', 'CHG_1M', 'BETA'])
    expect(out.props).toMatchObject({ yKey: 'rs_rank', xKey: 'chg_1m' })
    expect(out.ignored).toEqual(['FOO', 'BETA'])           // a third metric has no axis left
    const echo = argsEcho('SCAT', out)
    expect(echo).toContain('Not applied: "FOO", "BETA"')
    expect(echo).toContain('a universe (SP500')
    expect(echo).toContain('two metrics, Y then X')
  })
})
