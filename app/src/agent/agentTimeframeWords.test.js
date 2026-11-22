// ⛔ TIMEFRAME WORDS — a STRUCTURAL reading (2026-11-14, owner live test BUG C; AUDIT T2 on #1289, held-out probe 45). Every
// manifest arg whose enum is a chart-timeframe set reads its value BY GRAMMAR ([number][ -|space ]unit — capabilities/
// timeframeWords.js parseTimeframe), in the browser's normalizeArgs and, mirrored, in the server's normalize_args (turn.py
// _parse_timeframe). Only a value the arg's own enum offers; anything else is left as said and refused. PARITY: the generated
// table contract/timeframe.parity.json (UPDATE_TF_PARITY=1 rewrites it) is this module's reading, and
// tests/test_uct_agent_args_schema_honest.py holds the server to every row of it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { manifestFor, normalizeArgs } from './capabilities'
import { isTimeframeEnum, parseTimeframe, parityInputs, MAX_COERCE_WORDS } from './capabilities/timeframeWords'

registerBuiltins()

// INDEPENDENT of the parser's own detector: any enum arg holding a day bucket (D) and a week bucket (W)
function timeframeArgs(spec, p, out) {
  const vals = (spec?.enum || []).filter(v => typeof v === 'string')
  if (vals.includes('D') && vals.includes('W')) out.push({ path: p, vals })
  for (const [k, s] of Object.entries(spec?.properties || {})) timeframeArgs(s, p ? `${p}.${k}` : k, out)
  for (const s of spec?.anyOf || []) timeframeArgs(s, p, out)
  return out
}
const MANIFEST = manifestFor({ surface: 'charts' })
const ARGS = MANIFEST.flatMap(c => timeframeArgs(c.args, '', []).map(a => ({ action: c.name, ...a })))
const setPath = (p, v) => p.split('.').reduceRight((acc, k) => ({ [k]: acc }), v)
const getPath = (o, p) => p.split('.').reduce((x, k) => x?.[k], o)

describe('every timeframe enum arg in the manifest reads timeframes by grammar', () => {
  it('finds the known timeframe args (the enumeration is not empty)', () => {
    expect(ARGS.map(a => `${a.action}:${a.path}`)).toEqual(expect.arrayContaining(['chart.setTimeframe:timeframe', 'widget.addCharts:timeframe', 'chartGrid.set:timeframe', 'chart.addTab:timeframe', 'settings.setDefaultTimeframe:timeframe']))
  })
  const SPELLINGS = { '15 minutes': '15', '15 min': '15', '5 minutes': '5', '30 minutes': '30', '15mins': '15', '1-hour': '60', '1 hour': '60', '1h': '60', '60 minutes': '60', hourly: '60', '60m': '60', daily: 'D', '1 day': 'D', weekly: 'W', '1wk': 'W', monthly: 'M', '1 month': 'M' }
  it.each(ARGS.map(a => [`${a.action}:${a.path}`, a]))('%s', (_n, a) => {
    expect(isTimeframeEnum({ enum: a.vals }), 'the parser must see it as a timeframe enum').toBe(true)
    for (const [w, v] of Object.entries(SPELLINGS)) {
      const out = getPath(normalizeArgs(a.action, setPath(a.path, w)).args, a.path)
      expect(out, `${a.action}.${a.path} “${w}”`).toBe(a.vals.includes(v) ? v : w)        // offered → read; else left as said
    }
    const c = MANIFEST.find(x => x.name === a.action)
    expect(Object.keys(c.coerce?.[a.path] || {}).length, 'the server keeps only MAX_COERCE_WORDS words per arg').toBeLessThanOrEqual(MAX_COERCE_WORDS)
  })
})

describe('refused, never guessed', () => {
  const TF = MANIFEST.find(c => c.name === 'chart.setTimeframe').args.properties.timeframe.enum
  it.each(['1m', '1M', '4 hours', '240', '2 weeks', '13min', '2 daily', 'h', 'mo', 'd1', 'banana', 'intraday', '1.5h', '-1h', '0m', '1 hour chart', 'one hour'])('chart.setTimeframe %j is left as said', (w) => {
    expect(parseTimeframe(w, TF)).toBeNull()
    expect(normalizeArgs('chart.setTimeframe', { timeframe: w }).args.timeframe).toBe(w)
  })
  it('a bare "m" is not read by the grammar (the enum case-folding, unchanged, maps it to M)', () => { expect(parseTimeframe('m', TF)).toBeNull() })
  it('settings.setDefaultTimeframe offers no monthly: "monthly" is refused there, read on chart.setTimeframe', () => {
    expect(normalizeArgs('settings.setDefaultTimeframe', { timeframe: 'monthly' }).args.timeframe).toBe('monthly')
    expect(normalizeArgs('chart.setTimeframe', { timeframe: 'monthly' }).args.timeframe).toBe('M')
  })
})

// ── PARITY with the server: the generated table ──
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PARITY = path.join(HERE, 'contract', 'timeframe.parity.json')
const ENUMS = [...new Map(ARGS.map(a => [JSON.stringify(a.vals), a.vals])).values()]
const TABLE = { enums: ENUMS, rows: parityInputs().flatMap(input => ENUMS.map((vals, e) => [input, e, parseTimeframe(input, vals)])) }

describe('client ⇄ server parity table (contract/timeframe.parity.json)', () => {
  it(`🔴 the table equals this module's reading (UPDATE_TF_PARITY=1 to rewrite it) — ${TABLE.rows.length} rows`, () => {
    const text = `${JSON.stringify(TABLE)}\n`
    if (process.env.UPDATE_TF_PARITY === '1') fs.writeFileSync(PARITY, text)
    const have = fs.existsSync(PARITY) ? fs.readFileSync(PARITY, 'utf8').replace(/\r\n/g, '\n') : ''
    expect(have === text, 'the parity table moved: review, then rerun with UPDATE_TF_PARITY=1').toBe(true)
    expect(TABLE.rows.length).toBeGreaterThan(1000)
    expect(TABLE.rows.some(r => r[2] != null) && TABLE.rows.some(r => r[2] == null)).toBe(true)
  })
})
