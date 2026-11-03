// Wave 3 W3-2 (w3-a, 2026-11-03): the browser MIRROR of the coach guard runs the SAME fixture as the server suite
// (tests/test_uct_agent_coach_guard.py): every violating phrasing trips exactly its codes, every clean one none.
// Mutation note: see the server suite's docstring — the fixture's `why` names the regex each case exists for.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, enforce, figures, untraceableFigures, unsupported, orderLanguage, hasHedge, ensureFooter, FIXED, FOOTER, CODES } from './coach/guard'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FX = JSON.parse(fs.readFileSync(path.join(HERE, '__fixtures__', 'coachGuardCases.json'), 'utf8'))
const VIOLATING = FX.cases.filter(c => c.codes.length)
const CLEAN = FX.cases.filter(c => !c.codes.length)

describe('coach guard (browser mirror) — the shared adversarial fixture', () => {
  it('is adversarial enough in both directions, and every code is exercised', () => {
    expect(VIOLATING.length).toBeGreaterThanOrEqual(20)
    expect(CLEAN.length).toBeGreaterThanOrEqual(10)
    expect(new Set(VIOLATING.flatMap(c => c.codes))).toEqual(new Set(CODES))
  })
  it.each(VIOLATING.map(c => [c.text, c.codes, c.why]))('🔴 trips exactly its codes: %s', (text, codes, why) => {
    expect(check(text, FX.inputs), why).toEqual(codes)
    const out = enforce(text, FX.inputs)
    expect(out.text).toBe(FIXED)
    expect(out.violations).toEqual(codes)
  })
  it.each(CLEAN.map(c => [c.text, c.why]))('🔴 clean: %s', (text, why) => {
    expect(check(text, FX.inputs), why).toEqual([])
    const out = enforce(text, FX.inputs)
    expect(out.violations).toEqual([])
    expect(out.text.toLowerCase().split('educational').length - 1).toBe(1)
  })
  it('the fixed sentence is itself clean and carries the footer', () => {
    expect(check(FIXED, [])).toEqual([])
    expect(FIXED).toContain(FOOTER)
  })
})

describe('coach guard (browser mirror) — the parts', () => {
  it('figures are canonical and a letter before a digit is not a figure', () => {
    expect(figures('the 20-day, $1,000 risk, 15%, 0.80 R, -3 sessions, 2R')).toEqual(new Set(['20', '1000', '15', '0.8', '3', '2']))
    expect(figures('v2 and c1 on 2026-10-30')).toEqual(new Set(['2026', '10', '30']))
    expect(untraceableFigures('win rate 60% over 10 trades', ['Review: 10 trades, win rate 60%'])).toEqual([])
    expect(untraceableFigures('win rate 65% over 10 trades', 'Review: 10 trades, win rate 60%')).toEqual(['65'])
  })
  it('a negated guarantee is a hedge, not a claim', () => {
    expect(unsupported('There is no guarantee this holds.')).toEqual([])
    expect(unsupported('This is guaranteed to hold.')).toEqual(['guarantee'])
    expect(hasHedge('no guarantee')).toBe(true)
  })
  it('order language catches commands, not descriptions', () => {
    expect(orderLanguage('Buy 100 shares at the open.')).toEqual(['trade-now', 'shares'])
    expect(orderLanguage('You should sell here.')).toEqual(['trade-now', 'you-should'])
    expect(orderLanguage("I can't tell you whether to buy or sell.")).toEqual([])
  })
  it('uncertainty is required only for outcome talk', () => {
    expect(check('A stop is where the idea is wrong.', [])).toEqual([])
    expect(check('This should hold and rally next week.', [])).toEqual(['uncertainty'])
    expect(check('This may hold and rally next week, or it may not.', [])).toEqual([])
  })
  it('enforce replaces, never edits; the footer is added once', () => {
    const out = enforce("Buy now, it's guaranteed. Also the 20-day is rising.", ['20-day'])
    expect(out.text).toBe(FIXED)
    expect(out.text).not.toContain('20-day')
    expect(ensureFooter('Hello.')).toBe(`Hello.\n\n${FOOTER}`)
    expect(ensureFooter('Hello. Educational, not advice.')).toBe('Hello. Educational, not advice.')
  })
})
