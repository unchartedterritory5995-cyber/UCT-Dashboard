// ⭐⭐ U-DAILY (e96, part A) — THE BROWSER'S PATCH GATE ADMITS A DAILY READ ON A CHART BELOW A DAY, AND ONLY THERE.
// `tf(x, 'D')` shows the last finished day on each bar of a chart below a day (`engine/ast/interpret.js::DAILY_READ`).
// The server door builds it only where the chart (or the member's words) is below a day (`check_daily_reads`); the
// browser applies it only where THIS chart is (`gateCtx.tf`), from the same bounds file (`crossContext.json`).

import { describe, it, expect } from 'vitest'
import { gateTree, CROSS_CONTEXT } from './applyPatch'
import CROSS from './crossContext.json'

const S = (name) => ({ type: 'series', name })
const N = (value) => ({ type: 'num', value })
const C = (name, ...args) => ({ type: 'call', name, args })
const O = (name, ...args) => ({ type: 'op', name, args })
const DAILY = (child) => ({ type: 'tf', value: 'D', args: [child] })
const CROSS_50 = O('>', S('close'), DAILY(C('sma', S('close'), N(50))))

const codeOf = (fn) => { try { fn(); return null } catch (e) { return e && e.code } }

describe('U-DAILY — the patch gate', () => {
  it('⭐ admits a daily read on a chart below a day, and reads it back for the day it shows', () => {
    const g = gateTree(CROSS_50, {}, 'value', { tf: '5', symbol: 'NVDA' })
    expect(g.mode).toBe('non-repainting')
    expect(g.readback).toContain('as of the last finished day')
    expect(codeOf(() => gateTree(CROSS_50, {}, 'value', { tf: '60', symbol: 'NVDA' }))).toBe(null)
  })

  it('⛔ refuses it on a daily or higher chart, and where the chart is not said (as before)', () => {
    for (const ctx of [{ tf: 'D', symbol: 'NVDA' }, { tf: 'W' }, {}, null, undefined]) {
      expect(codeOf(() => gateTree(CROSS_50, {}, 'value', ctx))).toBe('tree:timeframe')
    }
    expect(() => gateTree(CROSS_50, {}, 'value', { tf: 'D' })).toThrow(/a daily read is for a chart below a day/)
  })

  it('⛔ CONTROL — the weekly and monthly reads it already admitted are unchanged, on every chart', () => {
    const weekly = O('>', S('close'), { type: 'tf', value: 'W', args: [S('close')] })
    for (const ctx of [{ tf: '5' }, { tf: 'D' }, null]) expect(codeOf(() => gateTree(weekly, {}, 'value', ctx))).toBe(null)
    expect(codeOf(() => gateTree({ type: 'tf', value: '60', args: [S('close')] }, {}, 'value', { tf: '5' }))).toBe('tree:timeframe')
  })

  it('reads its bounds from the shared file', () => {
    expect(CROSS_CONTEXT.tfBelowADayCodes).toEqual(['D'])
    expect(CROSS.tfBelowADayCodes).toEqual(['D'])
    expect(CROSS_CONTEXT.tfCodes).not.toContain('D')
  })
})
