// ⛔ TIMEFRAME WORDS (2026-11-14, owner live test BUG C) — every manifest arg whose enum is a chart-timeframe set carries the
// ONE shared map of timeframe words (capabilities/timeframeWords.js, attached BY SCHEMA in registerCapability), so the server's
// normalize_args (turn.py — the manifest's own coerce) and the browser's normalizeArgs read "1h" / "hourly" / "60m" / "weekly"
// on every such action, a new one included. A word that is not in the map is never coerced (the enum refuses it).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor, normalizeArgs, getCapability } from './capabilities'
import { TIMEFRAME_WORDS, isTimeframeEnum, MAX_COERCE_WORDS } from './capabilities/timeframeWords'

registerBuiltins()

// INDEPENDENT of the attacher's own detector: any enum arg holding a day bucket (D) and a week bucket (W)
function timeframeArgs(spec, path, out) {
  const vals = (spec?.enum || []).filter(v => typeof v === 'string')
  if (vals.includes('D') && vals.includes('W')) out.push({ path, vals })
  for (const [k, s] of Object.entries(spec?.properties || {})) timeframeArgs(s, path ? `${path}.${k}` : k, out)
  for (const s of spec?.anyOf || []) timeframeArgs(s, path, out)
  return out
}
const MANIFEST = manifestFor({ surface: 'charts' })
const ARGS = MANIFEST.flatMap(c => timeframeArgs(c.args, '', []).map(a => ({ action: c.name, ...a })))
const SAMPLE = { '1h': '60', hourly: '60', '60m': '60', '1hr': '60', daily: 'D', weekly: 'W', monthly: 'M', '5min': '5', '15m': '15' }

describe('every timeframe enum arg in the manifest carries the shared words', () => {
  it('finds the known timeframe args (the enumeration is not empty)', () => {
    expect(ARGS.map(a => `${a.action}:${a.path}`)).toEqual(expect.arrayContaining(['chart.setTimeframe:timeframe', 'widget.addCharts:timeframe', 'chartGrid.set:timeframe']))
  })
  it.each(ARGS.map(a => [`${a.action}:${a.path}`, a]))('%s', (_n, a) => {
    expect(isTimeframeEnum({ enum: a.vals }), 'the attacher must see it as a timeframe enum').toBe(true)
    const c = MANIFEST.find(x => x.name === a.action)
    for (const [w, v] of Object.entries(SAMPLE)) {
      if (!a.vals.includes(v)) continue
      expect(c.coerce?.[a.path]?.[w], `${a.action}.${a.path} has no word “${w}”`).toBe(v)
    }
    expect(Object.keys(c.coerce?.[a.path] || {}).length, 'the server keeps only MAX_COERCE_WORDS words per arg').toBeLessThanOrEqual(MAX_COERCE_WORDS)
    for (const v of Object.values(c.coerce?.[a.path] || {})) expect(v === null || a.vals.includes(v), `${a.action}.${a.path}: coerce value ${v} is not in its enum`).toBe(true)
  })
})

describe('the words read through normalizeArgs (the same rule the server applies), and nothing else is guessed', () => {
  it.each(['1h', '1H', 'Hourly', ' 60m ', '1hr', '1 hour'])('chart.setTimeframe %j → "60"', (w) => {
    expect(normalizeArgs('chart.setTimeframe', { timeframe: w }).args.timeframe).toBe('60')
  })
  it.each(['2h', '4h', 'fortnightly', 'banana', 'yearly', 'quarterly', 'intraday', 'short term'])('chart.setTimeframe %j is left as said (refused by the enum, never a default)', (w) => {
    expect(normalizeArgs('chart.setTimeframe', { timeframe: w }).args.timeframe).toBe(w)
    expect(TIMEFRAME_WORDS[w.toLowerCase()]).toBeUndefined()
  })
  it('an action\'s OWN words win over the shared ones (widget.addCharts "default" → null stays)', () => {
    expect(getCapability('widget.addCharts').coerce.timeframe.default).toBeNull()
    expect(getCapability('chart.setTimeframe').coerce.timeframe.default).toBeUndefined()
  })
})
