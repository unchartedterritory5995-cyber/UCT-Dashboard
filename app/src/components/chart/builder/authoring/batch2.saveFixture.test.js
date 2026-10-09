// BATCH 2 — the definitions this batch's engine writes, frozen as a fixture the SERVER's
// save door is tested against (`tests/test_batch2_save_door.py`). This test holds the
// fixture equal to what the engine builds today, so the server is never tested against
// a shape the browser no longer produces. Regenerate with UPDATE_BATCH2_FIXTURE=1.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseFormula } from '../../engine/ast/parse'
import { applyPatch } from './index'
import { stampSemantics } from '../../engine/definitionSemantics'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const env = (ops) => ({ contract: 'uct.authoring.patch/1', baseRevision: 0, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }
const FIXTURE = path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json')

const CASES = {
  four_state_histogram: [
    { op: 'create', name: 'Momentum states', placement: 'pane', outputs: [{ key: 'hist', label: 'Momentum', tree: P('ema(close, 12) - ema(close, 26)') }] },
    { op: 'set_style', output: 'hist', style: 'histogram' },
    { op: 'set_color_states', output: 'hist', states: [
      { relation: 'positive_rising', color: '#00e676' }, { relation: 'positive_falling', color: '#1b5e20' },
      { relation: 'negative_falling', color: '#d50000' }, { relation: 'negative_rising', color: '#ff9800' }] },
  ],
  three_state_candles: [
    { op: 'create', name: 'Trend candles', placement: 'price', outputs: [{ key: 'fast', label: 'EMA 10', tree: P('ema(close, 10)') }] },
    { op: 'set_color_states', channel: 'barcolor', states: [
      { when: P('ema(close, 10) > ema(close, 30) * 1.01'), color: '#00c853' },
      { when: P('ema(close, 10) < ema(close, 30) * 0.99'), color: '#d50000' }], otherwise: '#ffd600' },
  ],
  conditional_table: [
    { op: 'create', name: 'Status board', placement: 'price', outputs: [
      { key: 'rsi', label: 'RSI 14', tree: P('rsi(close, 14)'), hidden: true },
      { key: 'bull', label: 'RSI bullish', tree: P('rsi(close, 14) > 50'), hidden: true },
      { key: 'trend', label: 'Uptrend', tree: P('ema(close, 20) > ema(close, 50)'), hidden: true }] },
    { op: 'set_table', position: 'top_right', cells: [
      { row: 0, col: 0, text: 'Market status', bold: true, size: 'large', span: 2 },
      { row: 1, col: 0, text: 'RSI' }, { row: 1, col: 1, output: 'rsi', format: 'decimal1', colorWhen: { output: 'bull', true: '#00c853', false: '#d50000' } },
      { row: 2, col: 0, text: 'Trend' }, { row: 2, col: 1, output: 'trend', labels: { true: 'Bullish', false: 'Bearish' }, backgroundWhen: { output: 'trend', true: '#1b5e20', false: '#b71c1c' } }] },
  ],
  styled_markers: [
    { op: 'create', name: 'Signals', placement: 'price', outputs: [{ key: 'buy', label: 'Buy', tree: P('crossOver(close, ema(close, 20))') }] },
    { op: 'set_marker', output: 'buy', shape: 'arrowUp', position: 'belowBar', size: 2, color: '#ff9800' },
  ],
  linreg_and_correlation: [
    { op: 'create', name: 'Regression vs SPY', placement: 'pane', outputs: [
      { key: 'reg', label: 'LinReg 50', tree: { type: 'call', name: 'linreg', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 50 }] } },
      { key: 'corr', label: 'Corr SPY', tree: P('correlation(close, sym("SPY", close), 20)') }] },
  ],
}

// ⚠️ A created definition's id is minted at random (`authoringState.js`); the fixture pins one
// per case so this comparison is deterministic (the save door re-mints nothing it is handed).
const IDS = {
  four_state_histogram: 'u_43810a3299e9',
  three_state_candles: 'u_9771893e0bb4',
  conditional_table: 'u_d56112b56121',
  styled_markers: 'u_a6bc3119d8cd',
  linreg_and_correlation: 'u_82b558054ee6',
}

function build() {
  const out = {}
  for (const [name, ops] of Object.entries(CASES)) {
    const r = applyPatch(null, env(ops), { gateCtx: GATE })
    if (r.status !== 'applied') throw new Error(`${name}: ${JSON.stringify(r.errors)}`)
    // as the save door receives it: a version, the conversation's semantics stamp
    out[name] = stampSemantics({ ...r.definition, id: IDS[name], version: 1 }, { prior: null })
  }
  return out
}

describe('the server-side fixture is what the engine writes today', () => {
  it('batch2_definitions.json', () => {
    const built = build()
    if (globalThis.process.env.UPDATE_BATCH2_FIXTURE === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
      fs.writeFileSync(FIXTURE, `${JSON.stringify(built, null, 2)}\n`)
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(built)))
  })
})
