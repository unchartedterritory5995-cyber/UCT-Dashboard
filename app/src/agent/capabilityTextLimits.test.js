// CAPABILITY TEXT LIMITS (AUDIT, #1189) — the server CUTS every capability's summary to turn.MAX_SUMMARY and its hints to
// turn.MAX_HINTS on EVERY request (turn.validate_manifest), with only a log line, so a rule written past either limit is
// silently never seen by the model. This rail reads both limits from api/services/uct_agent/turn.py (the source of truth,
// never a retyped number), registers the WHOLE catalog (every server-gated kind on, as the capreg inventory does), and:
//   - a capability over either limit that is not on the allowlist → FAIL, naming it, its lengths and the limits;
//   - an allowlisted capability that now fits → FAIL until it is removed (the allowlist only SHRINKS);
//   - an allowlisted name that is no longer registered → FAIL (remove it).
// The allowlist holds only offenders that predate this rail and that its PR did not touch; each is its own follow-up.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { registerCatalog, ALL_KINDS } from './qa/capabilityRegression/testing/registry'
import { getCapability } from './capabilities'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const TURN = fs.readFileSync(path.resolve(HERE, '..', '..', '..', 'api', 'services', 'uct_agent', 'turn.py'), 'utf8')
const limit = (name) => {
  const m = new RegExp(`^${name} = (\\d+)\\s*$`, 'm').exec(TURN)
  if (!m) throw new Error(`turn.py no longer declares ${name}`)
  return Number(m[1])
}
const MAX_SUMMARY = limit('MAX_SUMMARY')
const MAX_HINTS = limit('MAX_HINTS')

// pre-existing offenders (2026-11-13, measured over the max-armed catalog), not touched by #1189: SHRINK ONLY
const ALLOWED_OVER = {
  'chart.describeSetup': 'summary over MAX_SUMMARY (train2 #746); follow-up: move its tail into hints',
  'research.ask': 'summary over MAX_SUMMARY (W2-B1 RS-1); follow-up: move its tail into hints',
}

const catalog = await registerCatalog(ALL_KINDS)
const over = catalog.all.map((name) => {
  const c = getCapability(name)
  return { name, summary: String(c.summary || '').length, hints: String(c.hints || '').length }
}).filter(r => r.summary > MAX_SUMMARY || r.hints > MAX_HINTS)

describe('capability text fits what the server sends (turn.py MAX_SUMMARY / MAX_HINTS)', () => {
  it('the limits are the ones turn.validate_manifest cuts with', () => {
    expect(TURN).toMatch(/> MAX_HINTS or len\(str\(c\.get\("summary"\) or ""\)\) > MAX_SUMMARY:/)
    expect(TURN).toMatch(/"summary": str\(c\.get\("summary"\) or ""\)\[:MAX_SUMMARY\]/)
    expect(TURN).toMatch(/"hints": str\(c\.get\("hints"\)\)\[:MAX_HINTS\]/)
    expect(MAX_SUMMARY).toBeGreaterThan(0)
    expect(MAX_HINTS).toBeGreaterThan(0)
  })

  it('no capability outside the allowlist is over either limit (a new one fails by name)', () => {
    console.log(`[text limits] ${catalog.all.length} capabilities · MAX_SUMMARY ${MAX_SUMMARY} · MAX_HINTS ${MAX_HINTS} · over: ${over.map(r => `${r.name} (${r.summary}/${r.hints})`).join(', ') || 'none'}`)
    expect(over.filter(r => !ALLOWED_OVER[r.name]).map(r => `${r.name}: summary ${r.summary}/${MAX_SUMMARY}, hints ${r.hints}/${MAX_HINTS}`)).toEqual([])
  })

  it('the allowlist only shrinks: every entry is registered and still over a limit', () => {
    const names = new Set(catalog.all)
    expect(Object.keys(ALLOWED_OVER).filter(n => !names.has(n)).map(n => `${n} is no longer registered: remove it from ALLOWED_OVER`)).toEqual([])
    expect(Object.keys(ALLOWED_OVER).filter(n => names.has(n) && !over.some(r => r.name === n)).map(n => `${n} now fits: remove it from ALLOWED_OVER`)).toEqual([])
  })
})
