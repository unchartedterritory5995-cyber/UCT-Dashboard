// app/src/components/chart/engine/__tests__/tier1Library.fixture.js
//
// ─── THE TECHNICAL LIBRARY'S TIER 1 (2026-10-01), WRITTEN DOWN BY HAND ──────
//
// The registry rails in this directory pin the shipped catalogue as LITERALS —
// a derived expectation agrees with the code by construction and can never fail.
// Thirty-three studies joined at once, so their ids, chips and columns live in
// this one hand-written fixture that each rail spreads into its own literal,
// instead of the same three lists pasted into six files. It imports nothing from
// the code it checks.

/** The thirty-three ids, in registration order. */
export const TIER1_IDS = Object.freeze([
  'superTrend', 'aroon', 'vortex', 'choppiness',
  'stochRsi', 'ppo', 'roc', 'momentum', 'tsi', 'cmo', 'trix', 'awesome', 'ultimate',
  'balanceOfPower', 'bullBearPower',
  'keltner', 'envelope', 'bbPercentB', 'bbWidth', 'atrPercent', 'adrPercent',
  'historicalVolatility', 'squeeze',
  'relativeVolume', 'accumDist', 'chaikinMoneyFlow', 'chaikinOscillator', 'forceIndex',
  'pvt', 'upDownVolume',
  'percentFromMa', 'fiftyTwoWeek',
  'standardDeviation',
])

/** Every column each study returns (`columnKeys`: data plots, hidden ones too). */
export const TIER1_COLUMNS = Object.freeze({
  superTrend: ['up', 'down'],
  aroon: ['up', 'down'],
  vortex: ['plus', 'minus'],
  choppiness: ['chop'],
  stochRsi: ['k', 'd'],
  ppo: ['ppo', 'signal', 'histogram'],
  roc: ['roc'],
  momentum: ['mom'],
  tsi: ['tsi', 'signal'],
  cmo: ['cmo'],
  trix: ['trix', 'signal'],
  awesome: ['ao', 'rising'],
  ultimate: ['uo'],
  balanceOfPower: ['bop'],
  bullBearPower: ['bull', 'bear'],
  keltner: ['upper', 'middle', 'lower'],
  envelope: ['upper', 'middle', 'lower'],
  bbPercentB: ['percentB'],
  bbWidth: ['bandwidth'],
  atrPercent: ['atrPct'],
  adrPercent: ['adrPct'],
  historicalVolatility: ['hv'],
  squeeze: ['momentum', 'state', 'on'],
  relativeVolume: ['rvol'],
  accumDist: ['ad'],
  chaikinMoneyFlow: ['cmf'],
  chaikinOscillator: ['osc'],
  forceIndex: ['efi'],
  pvt: ['pvt'],
  upDownVolume: ['ratio'],
  percentFromMa: ['pct'],
  fiftyTwoWeek: ['fromHigh', 'fromLow'],
  standardDeviation: ['stdev'],
})

/** The legend chips: each study's primary value, and the second line of the nine
 *  two-line studies. Band edges, a histogram beside a line and hidden colour
 *  columns carry none. */
export const TIER1_CHIPS = Object.freeze([
  'superTrend::up', 'superTrend::down', 'aroon::up', 'aroon::down', 'vortex::plus', 'vortex::minus',
  'choppiness::chop', 'stochRsi::k', 'stochRsi::d', 'ppo::ppo', 'ppo::signal', 'roc::roc',
  'momentum::mom', 'tsi::tsi', 'tsi::signal', 'cmo::cmo', 'trix::trix', 'trix::signal',
  'awesome::ao', 'ultimate::uo', 'balanceOfPower::bop', 'bullBearPower::bull', 'bullBearPower::bear',
  'keltner::middle', 'envelope::middle', 'bbPercentB::percentB', 'bbWidth::bandwidth',
  'atrPercent::atrPct', 'adrPercent::adrPct', 'historicalVolatility::hv', 'squeeze::momentum',
  'relativeVolume::rvol', 'accumDist::ad', 'chaikinMoneyFlow::cmf', 'chaikinOscillator::osc',
  'forceIndex::efi', 'pvt::pvt', 'upDownVolume::ratio', 'percentFromMa::pct',
  'fiftyTwoWeek::fromHigh', 'fiftyTwoWeek::fromLow', 'standardDeviation::stdev',
])
