// Terminal data wave 7 — six LOCAL-ONLY capabilities over six model-isolated kinds (MD-1 §4.16):
//   stock.marketRegime ← market.regime · stock.setups ← stock.setups · stock.eventsTimeline ← stock.eventsTimeline ·
//   stock.uct20List ← uct20.list · stock.ivHistory ← options.ivHistory · stock.dilutionWatch ← dilution.watch.
// Each is registered ONLY while the server serves its own kind, makes ONE read of it, is shown to the member only, says the
// DATA'S OWN date (the time the server computed the regime read, the daily bar a setup was judged on, the newest event not
// in the future, the wire run's date, the newest logged session, the newest filing's day) with the time UCT computed or
// read it beside it, never calls a missing number 0, says when a list is cut and from which end, never calls "not held",
// "switched off" or a failed read "none", and never echoes an envelope note.
// Routing: the six share ONE words-only group of their own (`marketReads`, the 49th; the server's cap was raised from 48 to
// 56 by the integrator's wave 7 build on 2026-11-20, when the catalog reached 49: a builder's change, not an owner
// decision). Each capability's own words are armed only while it is registered, and they never name another capability's
// language: describing the chart in view, the UCT Intelligence layers and indicator templates, chart patterns, an event
// study ("how has X behaved after ..."), opening the UCT 20 page, a bare "IV" (the options chain), expected move, news of
// an offering, a stock's gamma regime, screens, alerts, watchlists, navigation, and what a term means.
// No model, no provider: /api/agent/config and /api/agent/data are stubbed with synthetic shapes (never market data).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getCapability, allCapabilityNames, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { GROUPS, groupOfAction, routeManifest, selectGroups, wordsSelect } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import { correctTypos, lexiconFor } from './nl/lexicon'
import { allPhrasings } from './qa/capabilityRegression/testing/corpus'
import collisions from './qa/capabilityRegression/baseline/routingCollisions.json'
import handshake from './__fixtures__/program/isolation.json'
import { SOURCE as DILU_SOURCE, SHELVES_SHOWN } from '../pages/terminal/panels/dilutionModel'
import { LIVE_WORDS } from './capabilities/terminalDataFormat'
import { hiddenPhraseIn } from './capabilities/scanHidden'
import { hiddenScreenRequest } from './capabilities/screener'
import { _resetCotForTest } from './capabilities/cot'
import { _resetHistoryForTest } from './capabilities/history'
import { _resetDescribeForTest } from './capabilities/chartDescribe'
import { _resetTerminalDataForTest } from './capabilities/terminalData'
import { _resetTerminalLocalForTest, TERMINAL_ROUTE_WORDS } from './capabilities/terminalDataLocal'
import { _resetTerminalWave2ForTest, WAVE2_ROUTE_WORDS } from './capabilities/terminalDataWave2'
import { _resetTerminalWave3ForTest, WAVE3_ROUTE_WORDS } from './capabilities/terminalDataWave3'
import { _resetTerminalWave4ForTest, WAVE4_ROUTE_WORDS, ROUTE_GROUP as WAVE4_GROUP } from './capabilities/terminalDataWave4'
import { _resetTerminalWave5ForTest, WAVE5_ROUTE_WORDS, ROUTE_GROUP as WAVE5_GROUP } from './capabilities/terminalDataWave5'
import { _resetTerminalWave6ForTest, WAVE6_ROUTE_WORDS, ROUTE_GROUP as WAVE6_GROUP } from './capabilities/terminalDataWave6'
import {
  KINDS, CAPABILITIES, NOT_ADVICE, REGIME_SIGNALS, REGIME_SIGNAL_KEYS, REGIME_RULES, SETUPS_DEFAULT_ROWS, SETUPS_MAX_ROWS, SETUPS_RECORD,
  EVENTS_DEFAULT_ROWS, EVENTS_MAX_ROWS, EVENT_SOURCE_WORDS, EVENT_SOURCE_KEYS, EVENTS_RECORD, UCT20_DEFAULT_ROWS, UCT20_MAX_ROWS, UCT20_STALE_WORDS, UCT20_SELECTION,
  IV_DEFAULT_ROWS, IV_MAX_ROWS, IV_RECORD, DILUTION_DEFAULT_ROWS, DILUTION_MAX_ROWS, DILUTION_HORIZONS, DILUTION_HORIZON_KEYS, DILUTION_NONE_WORDS, DILUTION_SHELF_STATES,
  DILUTION_RECORD, DILUTION_CLASSIFIED, answerFromRegime, answerFromSetups, answerFromEvents, answerFromUct20, answerFromIv, answerFromDilution,
  registerTerminalWave7Capabilities, _resetTerminalWave7ForTest, WAVE7_ROUTE_WORDS, ROUTE_GROUP,
} from './capabilities/terminalDataWave7'

registerBuiltins()

const REPO = path.resolve(__dirname, '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')
const adapter = (name) => py(`api/services/uct_agent/marketdata/${name}.py`)
const pyInt = (src, name) => Number(new RegExp(`^${name} = (\\d+)\\b`, 'm').exec(src)[1])
const pyTuple = (src, name) => new RegExp(`^${name} = \\(([\\s\\S]+?)\\)$`, 'm').exec(src)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1))
const pyDict = (src, name) => Object.fromEntries([...new RegExp(`^${name} = \\{([\\s\\S]+?)\\}$`, 'm').exec(src)[1].matchAll(/"(\w+)":\s+"([^"]+)"/g)].map(m => [m[1], m[2]]))
const pyKind = (src) => /^KIND = "([\w.]+)"/m.exec(src)[1]
const FETCHED = '2026-11-19T15:30:00Z'               // 10:30 AM ET, a Thursday: the day of the read
const READ_AT = '2026-11-19T14:05:00Z'               // 9:05 AM ET, the same day
const NOTE = 'a provider note that must never be echoed 987654'
const plain = (o) => Object.keys(o).filter(k => k !== 'isolated')
const envelope = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'historical', as_of: '2026-11-18T21:00:00Z', fetched_at: FETCHED, delay_s: null,
  stale: false, source: 'fixture', coverage: null, notes: [NOTE], provider_calls: 0, isolated: true, data: { ...data, isolated: true }, ...over,
})
const REFUSED = { status: 'refused', data: null, notes: ['this turn already made 8 data reads'] }
const UNAVAILABLE = { status: 'unavailable', data: null, notes: [NOTE] }
const REFUSED_WORDS = "that request wasn't allowed for this question, so nothing was read"
/** every answer of this wave: no live / now wording, never an envelope note, and never the day of the read as the data's date
 *  (the read time is printed as a time of day; the day of the read, Nov 19, appears nowhere) */
function honest(a) {
  expect(a.text).not.toMatch(LIVE_WORDS)
  expect(a.text).not.toContain('987654')
  expect(a.text).not.toContain('8 data reads')
  expect(a.text).not.toMatch(/\bas of today\b|\btoday's\b|Nov 19|2026-11-19/i)
  return a
}

// ── market.regime → stock.marketRegime ─────────────────────────────────────────────────────────────────────────────────
const SIGNALS = (over = {}) => ({ pct_above_50ma: 47.6, pct_above_200ma: 61.2, new_highs: 84, new_lows: 1203, distribution_days: 4, market_phase: 'Made-up phase', isolated: true, ...over })
const regimeEnv = (over = {}, envOver = {}) => envelope(KINDS.regime, {
  regime: 'bull_correction', label: 'Bull correction', band: 'YELLOW', confidence: 0.62, signals: SIGNALS(), reasons: ['a made-up reason line.', 'a second made-up reason'], reasons_left_out: 1,
  left_out: ['uct_exposure_rating', 'vix'], vocabulary_version: 'fixture', computed_at: READ_AT, ...over,
}, { freshness: 'periodic', as_of: READ_AT, ...envOver })
const REGIME_LEFT_OUT = 'The UCT Exposure Rating and the VIX level are not in this answer, with the 1 reason line that states them: the Market regime panel (REGM) in UCT shows them.'
const REGIME_COMPUTED = "Computed by UCT's server at 9:05 AM ET (UCT's own time). The server recomputes at most every 15 minutes, and this answer never recomputes. The breadth figures behind it carry no date of their own."
const REGIME_SOURCE = "Source: UCT's regime classifier, rules over market breadth and VIX. It is what UCT's rules read, not a forecast and not advice."

describe('stock.marketRegime — the answer', () => {
  it('the regime, its band, the classifier\'s confidence and the breadth figures, with the time the SERVER computed it', () => {
    const a = honest(answerFromRegime(regimeEnv()))
    expect(a.text.split('\n')).toEqual([
      "UCT's market regime read: Bull correction, sizing band YELLOW, confidence 62%.",
      '• Stocks above the 50-day average: 48%',
      '• Stocks above the 200-day average: 61%',
      '• New highs: 84',
      '• New lows: 1,203',
      '• Distribution days: 4',
      '• Market phase: Made-up phase',
      "Why, in the classifier's own words: a made-up reason line; a second made-up reason.",
      REGIME_LEFT_OUT,
      REGIME_COMPUTED,
      REGIME_SOURCE,
    ])
    expect(a.facts).toMatchObject({ regime: 'bull_correction', label: 'Bull correction', band: 'YELLOW', confidence: 0.62, confidence_pct: 62, market_phase: 'Made-up phase', missing: [], reasons_left_out: 1,
      left_out: ['uct_exposure_rating', 'vix'], computed_at: READ_AT, computed: '9:05 AM ET', stale: false })
    expect(a.facts.signals).toEqual({ pct_above_50ma: 47.6, pct_above_200ma: 61.2, new_highs: 84, new_lows: 1203, distribution_days: 4 })
    expect(a.table.rows.map(r => r.figure)).toEqual(['Regime', 'Confidence', ...REGIME_SIGNAL_KEYS.map(k => REGIME_SIGNALS[k].label)])
    expect(a.present).toMatchObject({ kind: 'metrics', short: 'Market regime' })
    expect(REGIME_RULES).toBe(`It is what UCT's rules read, ${NOT_ADVICE}.`)
  })
  it('a breadth figure the classifier did not have is said as missing and is never 0', () => {
    const a = honest(answerFromRegime(regimeEnv({ signals: SIGNALS({ new_lows: null, distribution_days: null }), reasons_left_out: 0, reasons: [] })))
    const lines = a.text.split('\n')
    expect(lines[4]).toBe('• New lows: not available to the classifier')
    expect(lines[5]).toBe('• Distribution days: not available to the classifier')
    expect(lines).toContain('2 breadth figures were not available to the classifier and are not stated: that is not a figure of 0.')
    expect(lines).toContain('The UCT Exposure Rating and the VIX level are not in this answer: the Market regime panel (REGM) in UCT shows them.')
    expect(a.text).not.toMatch(/New lows: 0|Distribution days: 0|Why, in the classifier/)
    expect(a.facts.signals).toMatchObject({ new_lows: null, distribution_days: null })
    expect(a.facts.missing).toEqual(['new_lows', 'distribution_days'])
    expect(a.table.rows.find(r => r.figure === 'New lows').value).toBe('not given')
    const one = answerFromRegime(regimeEnv({ signals: SIGNALS({ new_highs: undefined }) }))
    expect(one.text).toContain('1 breadth figure was not available to the classifier and is not stated: that is not a figure of 0.')
  })
  it('the date is the time the server computed the read: an earlier day is printed as that day, and no time is said as none', () => {
    const old = honest(answerFromRegime(regimeEnv({ computed_at: '2026-11-18T20:50:00Z' }, { as_of: '2026-11-18T20:50:00Z' })))
    expect(old.text).toContain("Computed by UCT's server at Wed, Nov 18, 3:50 PM ET (UCT's own time).")
    expect(old.facts.computed).toBe('Wed, Nov 18, 3:50 PM ET')
    const none = answerFromRegime(regimeEnv({ computed_at: null }, { as_of: null }))
    expect(none.text).toContain('The answer carries no computed time, so I cannot say how old it is.')
    expect(none.text).not.toMatch(/10:30 AM/)                            // never the time of the read in its place
    const noBand = answerFromRegime(regimeEnv({ band: null }))
    expect(noBand.text.split('\n')[0]).toBe("UCT's market regime read: Bull correction, no sizing band given, confidence 62%.")
  })
  it('not held, refused and an unclean answer are never "no regime"', () => {
    expect(answerFromRegime(UNAVAILABLE).text).toBe("I couldn't read UCT's market regime read: none is held on the server at the moment (this answer never computes one), or the read failed. Open the Market regime panel (REGM) in UCT, then ask again. No regime is stated. That is not the same as no regime.")
    expect(answerFromRegime(REFUSED).text).toBe(`I couldn't read UCT's market regime read: ${REFUSED_WORDS}. No regime is stated. That is not the same as no regime.`)
    for (const bad of [{ regime: null }, { label: '' }, { confidence: null }, { confidence: 'high' }, { signals: null }]) {
      const a = honest(answerFromRegime(regimeEnv(bad)))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read UCT's market regime read: UCT's data did not answer cleanly. No regime is stated. That is not the same as no regime.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the figures, what is left out and the recompute interval are the kind\'s own (read from the adapter and the classifier)', () => {
    const src = adapter('regime_read')
    expect(pyKind(src)).toBe(KINDS.regime)
    expect(pyTuple(src, 'SIGNALS')).toEqual(REGIME_SIGNAL_KEYS)
    expect(Object.keys(pyDict(src, 'SIGNAL_WORDS'))).toEqual(REGIME_SIGNAL_KEYS)
    expect(pyTuple(src, 'LEFT_OUT')).toEqual(regimeEnv().data.left_out)
    expect(pyInt(py('api/services/voice_regime_classifier.py'), '_TTL_SECONDS') / 60).toBe(15)       // "at most every 15 minutes"
    for (const key of [...plain(regimeEnv().data), ...plain(SIGNALS())]) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── stock.setups → stock.setups ────────────────────────────────────────────────────────────────────────────────────────
const setupRow = (setup, name, day, confidence, level, passed, made) => ({ setup, name, asof_date: day, confidence, key_level: level, checks_passed: passed, checks_made: made, isolated: true })
const SETUP_ROWS = () => [setupRow('made_up_base', 'Made-up base', '2026-11-18', 81.6, 142.5, 5, 6), setupRow('made_up_shelf', 'Made-up shelf', '2026-11-17', null, null, 0, 0)]
const setupsEnv = (over = {}, envOver = {}) => envelope(KINDS.setups, {
  symbol: 'NVDA', tf: 'D', rows: SETUP_ROWS(), count: 2, confirmed_total: 2, cut: false, evaluated: 7, window_days: 10, min_confidence: 50, as_of: '2026-11-18', judged_at: READ_AT,
  expected_session: '2026-11-18', left_out: ['rationale', 'checks'], ...over,
}, { as_of: '2026-11-18T05:00:00Z', ...envOver })
const SETUPS_WINDOW = 'Only verdicts on a daily bar from the last 10 days are read, and a setup rejected on a newer bar is not listed from an older one.'
const SETUPS_LEFT_OUT = "The judge's written reasons and its list of checks are not in this answer: the Technical read panel (TECH) in UCT shows them."
const SETUPS_JUDGED = "The judge last ran on NVDA at 9:05 AM ET (UCT's own time)."
const SETUPS_SOURCE = "Source: UCT's chart judge, stored verdicts on the daily chart. A record of what the judge confirmed, not a forecast and not advice."

describe('stock.setups — the answer', () => {
  it('each confirmed setup with the daily bar it was judged on; a level or a confidence nobody stored is never 0', () => {
    const a = honest(answerFromSetups(setupsEnv(), 'NVDA'))
    expect(a.text.split('\n')).toEqual([
      "Setups UCT's chart judge confirmed on NVDA's daily chart, newest bar first (7 setups judged in the last 10 days):",
      '• Made-up base: judged on the daily bar of Nov 18, 2026, confidence 82%, key level $142.50, 5 of 6 checks passed',
      '• Made-up shelf: judged on the daily bar of Nov 17, 2026, no confidence stored, no key level stored',
      SETUPS_WINDOW,
      SETUPS_LEFT_OUT,
      SETUPS_JUDGED,
      SETUPS_SOURCE,
    ])
    expect(a.facts).toMatchObject({ symbol: 'NVDA', count: 2, confirmed_total: 2, cut: false, evaluated: 7, window_days: 10, as_of: '2026-11-18', day: 'Wed, Nov 18, 2026', judged: '9:05 AM ET', stale: false,
      left_out: ['rationale', 'checks'] })
    expect(a.facts.rows[1]).toEqual({ setup: 'made_up_shelf', name: 'Made-up shelf', asof_date: '2026-11-17', confidence: null, key_level: null, checks_passed: 0, checks_made: 0 })
    expect(a.table.rows[1]).toEqual({ setup: 'Made-up shelf', bar: 'Nov 17, 2026', confidence: 'not given', level: 'not given', checks: 'not given' })
    expect(a.text).not.toMatch(/\$0\.00|confidence 0%/)
    expect(SETUPS_RECORD).toBe(`A record of what the judge confirmed, ${NOT_ADVICE}.`)
  })
  it('a cut list says so and from which end; more than five rows go to the table', () => {
    const rows = Array.from({ length: 7 }, (_, i) => setupRow(`made_up_${i}`, `Made-up ${i}`, `2026-11-${String(18 - i).padStart(2, '0')}`, 70 + i, 100 + i, 4, 5))
    const a = honest(answerFromSetups(setupsEnv({ rows, count: 7, confirmed_total: 9, cut: true, evaluated: 12 }), 'NVDA'))
    const lines = a.text.split('\n')
    expect(lines.filter(l => l.startsWith('• '))).toHaveLength(5)
    expect(lines).toContain('2 more are in the table.')
    expect(lines).toContain('9 setups are confirmed and the newest 7 are in this answer: the list is cut from the old end.')
    expect(a.facts).toMatchObject({ count: 7, confirmed_total: 9, cut: true })
    expect(a.table.rows).toHaveLength(7)
  })
  it('judged and none confirmed is said as that, with how many were judged; stale says the judge runs on its own schedule', () => {
    const none = honest(answerFromSetups(setupsEnv({ rows: [], count: 0, confirmed_total: 0, evaluated: 4 }), 'NVDA'))
    expect(none.text.split('\n')).toEqual(["UCT's chart judge judged 4 setups on NVDA's daily chart in the last 10 days and confirmed none.", SETUPS_WINDOW, SETUPS_JUDGED, SETUPS_SOURCE])
    expect(none.facts).toMatchObject({ count: 0, confirmed_total: 0, evaluated: 4 })
    expect(none.table).toBeUndefined()
    const stale = honest(answerFromSetups(setupsEnv({ as_of: '2026-11-13', expected_session: '2026-11-18', judged_at: '2026-11-13T21:40:00Z' }, { stale: true }), 'NVDA'))
    expect(stale.text).toContain('Stale: the newest bar judged is Nov 13, 2026, older than the newest completed session (Nov 18, 2026). This answer never runs the judge: it runs on UCT\'s own schedule.')
    expect(stale.text).toContain("The judge last ran on NVDA at Fri, Nov 13, 4:40 PM ET (UCT's own time).")
    expect(stale.facts).toMatchObject({ stale: true, expected_session: '2026-11-18' })
    expect(answerFromSetups(setupsEnv({ judged_at: null }), 'NVDA').text).toContain("The answer carries no time for the judge's last run, so I cannot say how old it is.")
  })
  it('not judged, no store, refused and an unclean answer are never "no setup"', () => {
    expect(answerFromSetups(UNAVAILABLE, 'NVDA').text).toBe("I couldn't read NVDA's confirmed setups: no verdict is stored for it on the server (nothing was judged on it lately, or the verdict store is not there), or the read failed. This answer never runs a detection and never reads a chart. No setup is stated. That is not the same as no setup.")
    expect(answerFromSetups(REFUSED, 'NVDA').text).toBe(`I couldn't read NVDA's confirmed setups: ${REFUSED_WORDS}. No setup is stated. That is not the same as no setup.`)
    for (const bad of [{ rows: null }, { evaluated: null }, { evaluated: 0 }, { window_days: null }]) {
      const a = honest(answerFromSetups(setupsEnv(bad), 'NVDA'))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read NVDA's confirmed setups: UCT's data did not answer cleanly. No setup is stated. That is not the same as no setup.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the row limits and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('setups_read')
    expect(pyKind(src)).toBe(KINDS.setups)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([SETUPS_DEFAULT_ROWS, SETUPS_MAX_ROWS])
    for (const key of [...plain(setupsEnv().data), ...plain(SETUP_ROWS()[0])]) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── stock.eventsTimeline → stock.eventsTimeline ────────────────────────────────────────────────────────────────────────
const eventRow = (date, kind, title, detail, source, offset, o = {}) => ({ date, kind, title, detail, source, print_date: '2026-11-24', print_label: 'Made-up Q3', print_state: 'scheduled', offset,
  stage: offset == null ? null : offset === 0 ? 'T' : `T${offset > 0 ? '+' : ''}${offset}`, isolated: true, ...o })
const EVENT_ROWS = () => [
  eventRow('2026-11-24', 'earnings', 'Scheduled Made-up Q3', null, 'earnings', 0),
  eventRow('2026-11-17', 'uct_catalyst', 'UCT catalyst engine: flagged', null, 'uct_catalyst', -5),
  eventRow('2026-11-10', 'filing', 'Filed 8-K', 'a made-up reference', 'filing', -10),
  eventRow('2026-08-26', 'earnings', 'Reported Made-up Q2', 'a made-up detail', 'earnings', 0, { print_date: '2026-08-26', print_label: 'Made-up Q2', print_state: 'reported' }),
]
const UNIT = 'weekdays (Mon-Fri; exchange holidays are not removed)'
const eventsEnv = (over = {}, envOver = {}) => envelope(KINDS.events, {
  symbol: 'NVDA', staged: true, reason: null, offset_unit: UNIT, prints: [{ date: '2026-11-24', label: 'Made-up Q3', state: 'scheduled', isolated: true }, { date: '2026-08-26', label: 'Made-up Q2', state: 'reported', isolated: true }],
  rows: EVENT_ROWS(), count: 4, total: 4, cut: false, sources: { earnings: 'ok', uct_catalyst: 'ok', filing: 'ok', room_spike: 'empty', isolated: true }, as_of: '2026-11-17', left_out: ['thesis', 'url'], ...over,
}, { as_of: '2026-11-17T05:00:00Z', ...envOver })
const EVENTS_LEFT_OUT = "The catalyst engine's written thesis and each filing's link are not in this answer: the Events timeline panel (EVTS) in UCT shows them."
const EVENTS_STORED = 'Stored events only: nothing is fetched for this answer, and a scheduled report is listed and is never the as-of date.'
const EVENTS_SOURCE = "Source: UCT's own stores (earnings history, catalyst flags, SEC filing index, room mentions). A record of stored events, not a forecast and not advice."

describe('stock.eventsTimeline — the answer', () => {
  it('the dated events newest first, each against the nearest report; the as-of date is the newest event NOT in the future', () => {
    const a = honest(answerFromEvents(eventsEnv(), 'NVDA'))
    expect(a.text.split('\n')).toEqual([
      "Dated events UCT's stores hold for NVDA, newest first; the newest that is not in the future is Tue, Nov 17, 2026:",
      '• Nov 24, 2026: Scheduled Made-up Q3',
      '• Nov 17, 2026: UCT catalyst engine: flagged, T-5 against the Nov 24, 2026 report',
      '• Nov 10, 2026: Filed 8-K (a made-up reference), T-10 against the Nov 24, 2026 report',
      '• Aug 26, 2026: Reported Made-up Q2 (a made-up detail)',
      `T-minus and T-plus count ${UNIT} from the nearest earnings report.`,
      EVENTS_LEFT_OUT,
      EVENTS_STORED,
      EVENTS_SOURCE,
    ])
    expect(a.facts).toMatchObject({ symbol: 'NVDA', count: 4, total: 4, cut: false, as_of: '2026-11-17', day: 'Tue, Nov 17, 2026', staged: true, offset_unit: UNIT, silent: [], partial: false, left_out: ['thesis', 'url'] })
    expect(a.facts.sources).toEqual({ earnings: 'ok', uct_catalyst: 'ok', filing: 'ok', room_spike: 'empty' })
    expect(a.facts.prints).toEqual([{ date: '2026-11-24', label: 'Made-up Q3', state: 'scheduled' }, { date: '2026-08-26', label: 'Made-up Q2', state: 'reported' }])
    expect(a.table.rows[1]).toEqual({ date: 'Nov 17, 2026', event: 'UCT catalyst engine: flagged', detail: 'not given', stage: 'T-5' })
    expect(EVENTS_RECORD).toBe(`A record of stored events, ${NOT_ADVICE}.`)
  })
  it('a source that did not answer is named, and its silence is never "no event"; an unplaced event has no offset, never 0', () => {
    const rows = [eventRow('2026-11-10', 'filing', 'Filed 8-K', null, 'filing', null, { print_date: null, print_label: null, print_state: null })]
    const a = honest(answerFromEvents(eventsEnv({ rows, count: 1, total: 1, staged: false, reason: 'the earnings history is not held on this server, so the events are not staged against a print', prints: [], as_of: '2026-11-10',
      sources: { earnings: 'not_held', uct_catalyst: 'empty', filing: 'ok', room_spike: 'error' } }, { status: 'partial' }), 'NVDA'))
    const lines = a.text.split('\n')
    expect(lines[1]).toBe('• Nov 10, 2026: Filed 8-K')
    expect(lines).toContain('The events are not placed against an earnings report: the earnings history is not held on this server, so the events are not staged against a print. That is not an offset of 0.')
    expect(lines).toContain("2 of the 4 sources did not answer, so events from there are missing here, which is not the same as no event there: the earnings history (not held on the server) and the room's mention counts (the read failed).")
    expect(a.text).not.toMatch(/T-minus and T-plus/)
    expect(a.facts).toMatchObject({ staged: false, silent: ['earnings', 'room_spike'], partial: true })
    expect(a.facts.rows[0]).toMatchObject({ offset: null, stage: null })
    expect(a.table.rows[0].stage).toBe('not placed')
  })
  it('a cut list says so and from which end; no event on or before the read has no as-of date; nothing stored is said as that', () => {
    const many = Array.from({ length: 8 }, (_, i) => eventRow(`2026-11-${String(17 - i).padStart(2, '0')}`, 'filing', `Filed made-up ${i}`, null, 'filing', -5 - i))
    const cut = honest(answerFromEvents(eventsEnv({ rows: many, count: 8, total: 31, cut: true }), 'NVDA'))
    expect(cut.text).toContain('3 more are in the table.')
    expect(cut.text).toContain('31 events are stored and the newest 8 are in this answer: the list is cut from the old end.')
    expect(cut.facts).toMatchObject({ count: 8, total: 31, cut: true })
    const future = honest(answerFromEvents(eventsEnv({ rows: [EVENT_ROWS()[0]], count: 1, total: 1, as_of: null }, { as_of: null }), 'NVDA'))
    expect(future.text.split('\n')[0]).toBe("Dated events UCT's stores hold for NVDA, newest first:")
    expect(future.text).toContain('No event here is dated on or before the day of the read, so the timeline has no as-of date.')
    expect(future.facts.as_of).toBeNull()
    const empty = honest(answerFromEvents(eventsEnv({ rows: [], count: 0, total: 0, as_of: null, sources: { earnings: 'empty', uct_catalyst: 'empty', filing: 'empty', room_spike: 'not_held' } }, { status: 'partial' }), 'NVDA'))
    expect(empty.text.split('\n')).toEqual(['No event is stored for NVDA in the sources that answered.',
      "1 of the 4 sources did not answer, so events from there are missing here, which is not the same as no event there: the room's mention counts (not held on the server).",
      'Stored events only: nothing is fetched for this answer.', EVENTS_SOURCE])
  })
  it('switched off, no source, refused and an unclean answer are never "no event"', () => {
    expect(answerFromEvents(UNAVAILABLE, 'NVDA').text).toBe("I couldn't read NVDA's events timeline: the events timeline is switched off on the server, none of its four sources answered, or the read failed. This answer reads stored events only and fetches nothing. No event is stated. That is not the same as no event.")
    expect(answerFromEvents(REFUSED, 'NVDA').text).toBe(`I couldn't read NVDA's events timeline: ${REFUSED_WORDS}. No event is stated. That is not the same as no event.`)
    for (const bad of [{ rows: null }, { sources: null }]) {
      const a = honest(answerFromEvents(eventsEnv(bad), 'NVDA'))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read NVDA's events timeline: UCT's data did not answer cleanly. No event is stated. That is not the same as no event.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the sources, their words, the row limits and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('events_timeline_read')
    expect(pyKind(src)).toBe(KINDS.events)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([EVENTS_DEFAULT_ROWS, EVENTS_MAX_ROWS])
    expect(pyTuple(src, 'SOURCE_NAMES')).toEqual(EVENT_SOURCE_KEYS)
    expect(pyDict(src, 'SOURCE_WORDS')).toEqual(EVENT_SOURCE_WORDS)
    expect(pyTuple(src, 'SOURCE_STATES')).toEqual(['ok', 'empty', 'error', 'not_held'])
    expect(/^OFFSET_UNIT = "([^"]+)"/m.exec(py('api/services/events_timeline.py'))[1]).toBe(UNIT)
    for (const key of [...plain(eventsEnv().data), ...plain(EVENT_ROWS()[0])]) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── uct20.list → stock.uct20List ───────────────────────────────────────────────────────────────────────────────────────
const u20Row = (rank, symbol, rs, score, m1, m3, earnings = null) => ({ rank, symbol, rs, score, ret_1m: m1, ret_3m: m3, earnings_date: earnings, isolated: true })
const U20_ROWS = () => [u20Row(1, 'AAA', 98, 91.4, 14.26, 55, '2026-12-03'), u20Row(2, 'BBB', 96, 88, -3.1, 22.04), u20Row(3, 'CCC', null, 85, null, 0)]
const U20_LEFT_OUT = ['entry', 'stop', 'target_1', 'target_2', 'portfolio', 'nav', 'price', 'change', 'thesis', 'company_desc']
const u20Env = (over = {}, envOver = {}) => envelope(KINDS.uct20, {
  rows: U20_ROWS(), count: 3, total: 3, cut: false, as_of: '2026-11-18', status: 'fresh', held_since: null, pending_removed: 0, left_out: U20_LEFT_OUT, ...over,
}, { as_of: '2026-11-18T05:00:00Z', ...envOver })
const U20_NOT_HERE = "The UCT 20 model portfolio and each name's entry, stop and targets are not in this answer, with the wire's price and written thesis: the UCT 20 page in UCT shows them."
const U20_DATE = "The date above is the wire run's own, never the time of this answer."
const U20_SOURCE = "Source: UCT's morning wire. UCT's own selection, not a forecast and not advice."

describe('stock.uct20List — the answer', () => {
  it('the list in its own order with the wire run\'s date; a figure the wire did not carry is never 0 (and a real 0 stays 0)', () => {
    const a = honest(answerFromUct20(u20Env()))
    expect(a.text.split('\n')).toEqual([
      "The UCT 20 leadership list from the morning wire run of Wed, Nov 18, 2026, in the list's own order:",
      '• 1. AAA: RS 98, rating 91.4, 1 month +14.3%, 3 months +55.0%, next earnings Dec 3, 2026',
      '• 2. BBB: RS 96, rating 88.0, 1 month -3.1%, 3 months +22.0%',
      '• 3. CCC: RS not given, rating 85.0, 1 month not given, 3 months 0.0%',
      '1 name has at least one figure the wire did not carry: it is not stated, and that is not a figure of 0.',
      U20_NOT_HERE,
      U20_DATE,
      U20_SOURCE,
    ])
    expect(a.facts).toMatchObject({ count: 3, total: 3, cut: false, as_of: '2026-11-18', day: 'Wed, Nov 18, 2026', status: 'fresh', pending_removed: 0, gaps: 1, stale: false, left_out: U20_LEFT_OUT })
    expect(a.facts.rows[2]).toEqual({ rank: 3, symbol: 'CCC', rs: null, score: 85, ret_1m: null, ret_3m: 0, earnings_date: null })
    expect(a.table.rows[2]).toEqual({ rank: '3', symbol: 'CCC', rs: 'not given', score: '85.0', m1: 'not given', m3: '0.0%', earnings: 'not given' })
    expect(a.text).not.toMatch(/\$\d/)                                   // no price and no level: the wire's are left out
    expect(UCT20_SELECTION).toBe(`UCT's own selection, ${NOT_ADVICE}.`)
  })
  it('a cut list says it is cut from the BOTTOM of the ranking; names left off for a pending acquisition are counted', () => {
    const rows = Array.from({ length: 5 }, (_, i) => u20Row(i + 1, `AA${'ABCDE'[i]}`, 99 - i, 90 - i, 5 + i, 20 + i))
    const a = honest(answerFromUct20(u20Env({ rows, count: 5, total: 19, cut: true, pending_removed: 1 })))
    const lines = a.text.split('\n')
    expect(lines).toContain('The list holds 19 names and the top 5 are in this answer: it is cut from the bottom of the ranking.')
    expect(lines).toContain('1 name with a pending acquisition is left off the list, as on the UCT 20 page.')
    expect(a.text).not.toMatch(/figure the wire did not carry/)
    expect(a.facts).toMatchObject({ count: 5, total: 19, cut: true, pending_removed: 1, gaps: 0 })
    const seven = answerFromUct20(u20Env({ rows: Array.from({ length: 7 }, (_, i) => u20Row(i + 1, `AB${'ABCDEFG'[i]}`, 90, 80, 1, 2)), count: 7, total: 7 }))
    expect(seven.text).toContain('2 more are in the table.')
    expect(seven.table.rows).toHaveLength(7)
  })
  it.each(Object.keys(UCT20_STALE_WORDS))('a %s wire is said in the wire\'s own words, and the answer never rebuilds the list', (status) => {
    const a = honest(answerFromUct20(u20Env({ status, held_since: status === 'held' ? '2026-11-17' : null, as_of: '2026-11-17' }, { stale: true, as_of: '2026-11-17T05:00:00Z' })))
    expect(a.text).toContain(`Stale: ${UCT20_STALE_WORDS[status]}. This answer never rebuilds the list.`)
    expect(a.text.split('\n')[0]).toBe("The UCT 20 leadership list from the morning wire run of Tue, Nov 17, 2026, in the list's own order:")
    expect(a.facts).toMatchObject({ status, stale: true, as_of: '2026-11-17' })
  })
  it('a list with no run date says so and never borrows the day of the read', () => {
    const a = honest(answerFromUct20(u20Env({ as_of: null }, { as_of: null })))
    expect(a.text.split('\n')[0]).toBe("The UCT 20 leadership list as the morning wire last pushed it, in the list's own order:")
    expect(a.text).toContain('The pushed list carries no run date, so I cannot say how old it is.')
    expect(a.text).not.toContain(U20_DATE)
    expect(a.facts.as_of).toBeNull()
  })
  it('not held, refused and an unclean answer are never "an empty list"', () => {
    expect(answerFromUct20(UNAVAILABLE).text).toBe("I couldn't read the UCT 20 list: none is held on the server at the moment (this answer never builds one), or the read failed. Open the UCT 20 page in UCT, then ask again. No list is stated. That is not the same as an empty list.")
    expect(answerFromUct20(REFUSED).text).toBe(`I couldn't read the UCT 20 list: ${REFUSED_WORDS}. No list is stated. That is not the same as an empty list.`)
    for (const bad of [{ rows: [] }, { rows: null }, { rows: [{ symbol: 'AAA' }] }]) {
      const a = honest(answerFromUct20(u20Env(bad)))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read the UCT 20 list: UCT's data did not answer cleanly. No list is stated. That is not the same as an empty list.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the stale words, what is left out, the row limits and every field the answer reads are the kind\'s own (read from the adapter)', () => {
    const src = adapter('uct20_read')
    expect(pyKind(src)).toBe(KINDS.uct20)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([UCT20_DEFAULT_ROWS, UCT20_MAX_ROWS])
    expect(pyDict(src, 'STALE_WORDS')).toEqual(UCT20_STALE_WORDS)
    expect(pyTuple(src, 'LEFT_OUT')).toEqual(U20_LEFT_OUT)
    expect(pyTuple(src, 'FIELDS')).toEqual(['rs', 'score', 'ret_1m', 'ret_3m'])
    for (const key of [...plain(u20Env().data), ...plain(U20_ROWS()[0])]) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── options.ivHistory → stock.ivHistory ────────────────────────────────────────────────────────────────────────────────
const ivRow = (date, iv, dte, o = {}) => ({ date, atm_iv: iv, atm_dte: dte, atm_expiration: iv == null ? null : '2026-12-18', rule: 'closest-30', complete: iv != null, isolated: true, ...o })
const IV_ROWS = () => [ivRow('2026-11-18', 0.4253, 30), ivRow('2026-11-17', null, null), ivRow('2026-11-16', 0.401, 32)]
const RANK = () => ({ current: 0.4253, iv_rank: 62.4, iv_percentile: 70.8, low: 0.31, high: 0.495, window_sessions: 24, isolated: true })
const ivEnv = (over = {}, envOver = {}) => envelope(KINDS.iv, {
  symbol: 'NVDA', rows: IV_ROWS(), count: 3, total: 25, cut: true, as_of: '2026-11-18', logging_began: '2026-10-14', covers_from: '2026-10-14', covers_to: '2026-11-18', sessions_logged: 25, sessions_with_iv: 24,
  missing_sessions: 1, rank: RANK(), rank_note: null, rank_min_sessions: 20, partial: false, partial_reasons: [], expected_session: '2026-11-18', source: 'fixture', ...over,
}, { as_of: '2026-11-18T05:00:00Z', ...envOver })
const IV_DATE = "The newest session in this answer is Wed, Nov 18, 2026: the log's own date, never the time of this answer and never a quote from a session still trading."
const IV_SOURCE = "Source: UCT's options log (the at-the-money implied volatility recorded once per session). A record of logged sessions, not a forecast and not advice."

describe('stock.ivHistory — the answer', () => {
  it('the logged sessions newest first with the rank over the log; a session with no implied volatility is never 0%', () => {
    const a = honest(answerFromIv(ivEnv(), 'NVDA'))
    expect(a.text.split('\n')).toEqual([
      "NVDA at-the-money implied volatility by logged session, newest first, from UCT's options log (25 sessions logged since Oct 14, 2026):",
      '• Nov 18, 2026: 42.5% at 30 days to expiry',
      '• Nov 17, 2026: no at-the-money implied volatility logged',
      '• Nov 16, 2026: 40.1% at 32 days to expiry',
      'IV rank 62 and IV percentile 71 over 24 logged sessions, between a low of 31.0% and a high of 49.5%: a rank over the log, not over a full year unless the log is that long.',
      '25 sessions are logged for NVDA and the newest 3 are in this answer: the list is cut from the old end.',
      '1 session here has no at-the-money implied volatility for NVDA: it is not stated, and that is not 0%.',
      '1 trading session since the log began is not in the log.',
      IV_DATE,
      IV_SOURCE,
    ])
    expect(a.facts).toMatchObject({ symbol: 'NVDA', count: 3, total: 25, cut: true, as_of: '2026-11-18', day: 'Wed, Nov 18, 2026', logging_began: '2026-10-14', sessions_logged: 25, sessions_with_iv: 24, missing_sessions: 1,
      rank_min_sessions: 20, partial: false, stale: false })
    expect(a.facts.rank).toEqual({ current: 0.4253, iv_rank: 62.4, iv_percentile: 70.8, low: 0.31, high: 0.495, window_sessions: 24 })
    expect(a.facts.rows[1]).toEqual({ date: '2026-11-17', atm_iv: null, atm_dte: null, rule: 'closest-30', complete: false })
    expect(a.table.rows[1]).toEqual({ session: 'Nov 17, 2026', iv: 'not given', dte: 'not given' })
    expect(a.text).not.toMatch(/\b0\.0%/)
    expect(IV_RECORD).toBe(`A record of logged sessions, ${NOT_ADVICE}.`)
  })
  it('no rank is said with the log\'s own reason and is never a rank of 0; a rank the log cannot define is said as that', () => {
    const none = honest(answerFromIv(ivEnv({ rank: null, rank_note: '12 sessions logged, rank needs 20.', sessions_logged: 12, total: 2, cut: false, missing_sessions: 0, rows: [IV_ROWS()[0], IV_ROWS()[2]], count: 2 }), 'NVDA'))
    expect(none.text).toContain('No IV rank is stated: 12 sessions logged, rank needs 20. That is not a rank of 0.')
    expect(none.text).not.toMatch(/IV rank \d|is cut from the old end|not in the log|has no at-the-money/)
    expect(none.facts).toMatchObject({ rank: null, rank_note: '12 sessions logged, rank needs 20.' })
    const bare = answerFromIv(ivEnv({ rank: null, rank_note: null }), 'NVDA')
    expect(bare.text).toContain('No IV rank is stated. That is not a rank of 0.')
    const flat = honest(answerFromIv(ivEnv({ rank: { ...RANK(), iv_rank: null, low: 0.4, high: 0.4 } }), 'NVDA'))
    expect(flat.text).toContain('IV rank is not defined (the highest and the lowest logged session are equal) and IV percentile 71 over 24 logged sessions, between a low of 40.0% and a high of 40.0%')
    expect(flat.facts.rank.iv_rank).toBeNull()
  })
  it('stale says a newer session may be logged and not on the server; the log\'s own remarks are passed on', () => {
    const a = honest(answerFromIv(ivEnv({ as_of: '2026-11-13', rows: [ivRow('2026-11-13', 0.39, 31)], count: 1, total: 1, cut: false, missing_sessions: 0, partial: true, partial_reasons: ['A made-up remark of the log.'] },
      { stale: true, as_of: '2026-11-13T05:00:00Z' }), 'NVDA'))
    expect(a.text).toContain('Stale: the newest session held for NVDA is Nov 13, 2026, older than the newest completed session (Nov 18, 2026). A newer session may be logged and not on this server: this answer never downloads one.')
    expect(a.text).toContain("The log's own remarks: A made-up remark of the log.")
    expect(a.text).toContain('The newest session in this answer is Fri, Nov 13, 2026:')
    expect(a.facts).toMatchObject({ stale: true, partial: true, partial_reasons: ['A made-up remark of the log.'], expected_session: '2026-11-18' })
  })
  it('switched off, no log on the disk, not in the log, refused and an unclean answer are never "no implied volatility"', () => {
    expect(answerFromIv(UNAVAILABLE, 'NVDA').text).toBe("I couldn't read NVDA's implied volatility history: the IV history is switched off on the server, no session of UCT's options log is on its disk, the log holds no at-the-money implied volatility for this stock, or the read failed. This answer never reads the options chain and never downloads a session. Open the IV history panel (IVH) in UCT, then ask again. No implied volatility is stated. That is not the same as no implied volatility.")
    expect(answerFromIv(REFUSED, 'NVDA').text).toBe(`I couldn't read NVDA's implied volatility history: ${REFUSED_WORDS}. No implied volatility is stated. That is not the same as no implied volatility.`)
    for (const bad of [{ rows: [] }, { rows: null }, { as_of: null }, { as_of: 'today' }, { sessions_logged: null }]) {
      const a = honest(answerFromIv(ivEnv(bad), 'NVDA'))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read NVDA's implied volatility history: UCT's data did not answer cleanly. No implied volatility is stated. That is not the same as no implied volatility.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the row limits, the rank\'s keys and every field the answer reads are the kind\'s own (read from the adapter and the service)', () => {
    const src = adapter('iv_history_read')
    expect(pyKind(src)).toBe(KINDS.iv)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([IV_DEFAULT_ROWS, IV_MAX_ROWS])
    expect(pyTuple(src, 'RANK_KEYS')).toEqual(plain(RANK()).filter(k => k !== 'window_sessions'))
    expect(/^CURRENT_RULE = "([^"]+)"/m.exec(py('api/services/research/iv_history.py'))[1]).toBe(IV_ROWS()[0].rule)
    for (const key of [...plain(ivEnv().data), ...plain(IV_ROWS()[0]), 'window_sessions']) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── dilution.watch → stock.dilutionWatch ───────────────────────────────────────────────────────────────────────────────
const filing = (date, form, kind, what, under = null) => ({ date, form, kind, what, under: under && { ...under, isolated: true }, isolated: true })
const DILU_ROWS = () => [
  filing('2026-10-21', '424B5', 'offering', 'Made-up prospectus supplement', { form: 'S-3', filed: '2026-06-02', shelf: true }),
  filing('2026-08-04', '8-K', 'unregistered', 'Made-up unregistered sale'),
  filing('2026-06-02', 'S-3', 'registration', 'Made-up shelf registration'),
]
const SHELF = (o = {}) => ({ form: 'S-3', filed: '2026-06-02', effective: '2026-06-20', expires_estimate: '2029-06-20', state: 'live', offerings: 2, latest_offering: '2026-10-21', isolated: true, ...o })
const SUMMARY = (o = {}) => ({ live_shelves: 1, pending_shelves: 0, offerings: { m12: 2, y3: 3, latest: '2026-10-21', isolated: true }, unregistered: { m12: 1, y3: null, latest: '2026-08-04', isolated: true },
  registrations: { m12: 1, y3: 2, latest: '2026-06-02', isolated: true }, isolated: true, ...o })
const diluEnv = (over = {}, envOver = {}) => envelope(KINDS.dilution, {
  symbol: 'ZZA', state: 'ok', company: 'Made-up Holdings Inc', fund_like: false, window: { years: 3, from: '2023-11-19', to: '2026-11-19', recent_months: 12, recent_from: '2025-11-19', isolated: true },
  coverage: { complete: false, from: '2025-03-01', pages_unread: 2, isolated: true }, newest_filing: '2026-11-16', summary: SUMMARY(), shelves: [SHELF()], rows: DILU_ROWS(), count: 3, total: 5, cut: true,
  as_of: '2026-11-16', read_at: READ_AT, last_good: false, ...over,
}, { as_of: '2026-11-16T05:00:00Z', ...envOver })
const DILU_SOURCE_LINE = 'Source: SEC EDGAR filings. A record of filings, not a forecast and not advice.'
const DILU_READ = "Read by UCT from the SEC's filing index at 9:05 AM ET (UCT's own time)."
const DILU_AS_OF = "The newest filing of any form in the SEC's index for ZZA is dated Mon, Nov 16, 2026: the filings' own date, never the time of this answer."

describe('stock.dilutionWatch — the answer', () => {
  it('the counts, the shelves and the newest filings; a count the index was not read back far enough for is never 0', () => {
    const a = honest(answerFromDilution(diluEnv(), 'ZZA'))
    expect(a.text.split('\n')).toEqual([
      "ZZA (Made-up Holdings Inc): share-issuance filings in the SEC's filing index over the last 3 years, as UCT classified them:",
      '• Offerings: 2 in the last 12 months, 3 in the last 3 years, the latest on Oct 21, 2026',
      '• Unregistered sales: 1 in the last 12 months, not counted for the last 3 years, the latest on Aug 4, 2026',
      '• Registrations: 1 in the last 12 months, 2 in the last 3 years, the latest on Jun 2, 2026',
      "• Shelf registrations: 1 in effect by UCT's estimate, 0 not yet effective",
      "• Shelf S-3 filed Jun 2, 2026: in effect by UCT's estimate, effective Jun 20, 2026, estimated to expire Jun 20, 2029, 2 offerings under it, the latest on Oct 21, 2026",
      'The newest filings in the window:',
      '• Oct 21, 2026: 424B5, Made-up prospectus supplement, under the shelf filed Jun 2, 2026',
      '• Aug 4, 2026: 8-K, Made-up unregistered sale',
      '• Jun 2, 2026: S-3, Made-up shelf registration',
      '5 filings are in the window and the newest 3 are in this answer: the list is cut from the old end. The counts above cover everything that was read.',
      "The SEC's index was read back to Mar 1, 2025 only, not the whole window: a count that needs older filings is not stated, and that is not a count of 0.",
      DILU_AS_OF,
      DILU_READ,
      DILUTION_CLASSIFIED,
      DILU_SOURCE_LINE,
    ])
    expect(a.facts).toMatchObject({ symbol: 'ZZA', state: 'ok', company: 'Made-up Holdings Inc', fund_like: false, count: 3, total: 5, cut: true, as_of: '2026-11-16', day: 'Mon, Nov 16, 2026', window_years: 3,
      coverage_complete: false, coverage_from: '2025-03-01', read: '9:05 AM ET', stale: false })
    expect(a.facts.summary).toEqual({ live_shelves: 1, pending_shelves: 0, offerings: { m12: 2, y3: 3, latest: '2026-10-21' }, unregistered: { m12: 1, y3: null, latest: '2026-08-04' },
      registrations: { m12: 1, y3: 2, latest: '2026-06-02' } })
    expect(a.facts.rows[0].under).toEqual({ form: 'S-3', filed: '2026-06-02', shelf: true })
    expect(a.present.items).toEqual(DILUTION_HORIZON_KEYS.map((k, i) => ({ label: DILUTION_HORIZONS[k], value: ['2', '1', '1'][i], note: 'last 12 months', aka: [k] })))
    expect(DILUTION_RECORD).toBe(`A record of filings, ${NOT_ADVICE}.`)
    expect(DILU_SOURCE_LINE).toBe(`Source: ${DILU_SOURCE}. ${DILUTION_RECORD}`)
  })
  it('a whole window, a registration that is not a shelf, every shelf state, and a fund said as a fund', () => {
    const rows = [filing('2026-10-21', '424B3', 'offering', 'Made-up prospectus', { form: 'S-1', filed: '2026-05-05', shelf: false })]
    const shelves = [SHELF({ state: 'expired' }), SHELF({ state: 'not_effective', effective: null, expires_estimate: null, offerings: 0, latest_offering: null }), SHELF({ state: 'withdrawal_requested', offerings: null }),
      SHELF({ state: 'something new' })]
    const a = honest(answerFromDilution(diluEnv({ rows, count: 1, total: 1, cut: false, shelves, fund_like: true, coverage: { complete: true, from: '2023-11-19', pages_unread: 0 },
      summary: SUMMARY({ live_shelves: null, pending_shelves: 1, unregistered: { m12: 0, y3: 0, latest: null } }) }), 'ZZA'))
    const lines = a.text.split('\n')
    expect(lines).toContain('• Unregistered sales: 0 in the last 12 months, 0 in the last 3 years')
    expect(lines).toContain('• Shelf registrations: the count in effect is not given, 1 not yet effective')
    expect(lines).toContain("• Shelf S-3 filed Jun 2, 2026: expired by UCT's estimate, effective Jun 20, 2026, estimated to expire Jun 20, 2029, 2 offerings under it, the latest on Oct 21, 2026")
    expect(lines).toContain('• Shelf S-3 filed Jun 2, 2026: not yet effective, 0 offerings under it')
    expect(lines).toContain('• Shelf S-3 filed Jun 2, 2026: withdrawal requested, effective Jun 20, 2026, estimated to expire Jun 20, 2029, the latest on Oct 21, 2026')
    expect(lines).toContain('• Shelf S-3 filed Jun 2, 2026: state not given, effective Jun 20, 2026, estimated to expire Jun 20, 2029, 2 offerings under it, the latest on Oct 21, 2026')
    expect(lines).toContain('• Oct 21, 2026: 424B3, Made-up prospectus, under the registration filed May 5, 2026')
    expect(lines).toContain("The SEC classes ZZA as a fund or its filings are a fund's: share issuance by a fund is routine, and these rows do not mean what they mean for a company.")
    expect(a.text).not.toMatch(/is cut from the old end|read back/)
    expect(a.facts).toMatchObject({ fund_like: true, coverage_complete: true, cut: false })
    expect(Object.keys(DILUTION_SHELF_STATES)).toEqual(['live', 'expired', 'not_effective', 'withdrawal_requested'])
  })
  it('the SEC knows no filer or no index: said in the kind\'s own words, with no date and no count', () => {
    for (const reason of Object.keys(DILUTION_NONE_WORDS)) {
      const a = honest(answerFromDilution(envelope(KINDS.dilution, { symbol: 'ZZA', state: 'none', none_reason: reason, rows: [], count: 0, total: 0, cut: false, as_of: null, read_at: null, http_status: 200 }, { as_of: null }), 'ZZA'))
      expect(a.text.split('\n')).toEqual([`No share-issuance filing is stated for ZZA: ${DILUTION_NONE_WORDS[reason]}.`, 'The answer carries no date.', DILU_SOURCE_LINE])
      expect(a.facts).toEqual({ symbol: 'ZZA', state: 'none', none_reason: reason, rows: [], as_of: null })
    }
    const odd = answerFromDilution(envelope(KINDS.dilution, { symbol: 'ZZA', state: 'none', none_reason: 'something new', rows: [] }), 'ZZA')
    expect(odd.text).toBe("I couldn't read ZZA's share-issuance filings: UCT's data did not answer cleanly. No filing is stated. That is not the same as no filings.")
  })
  it('a last good answer is said as stale and never refreshed; no filing in the window, no newest filing day and no read time are each said', () => {
    const stale = honest(answerFromDilution(diluEnv({ last_good: true, read_at: '2026-11-16T21:10:00Z' }, { stale: true }), 'ZZA'))
    expect(stale.text).toContain('Stale: this is the last good answer UCT holds for ZZA and its refresh is overdue. This answer never refreshes it: open the Dilution watch panel (DILU) in UCT, then ask again.')
    expect(stale.text).toContain("Read by UCT from the SEC's filing index at Mon, Nov 16, 4:10 PM ET (UCT's own time).")
    expect(stale.facts).toMatchObject({ stale: true })
    const bare = honest(answerFromDilution(diluEnv({ rows: [], count: 0, total: 0, cut: false, shelves: [], as_of: null, read_at: null, company: null, window: null,
      summary: SUMMARY({ live_shelves: 0, pending_shelves: 0, offerings: { m12: 0, y3: 0, latest: null }, unregistered: { m12: 0, y3: 0, latest: null }, registrations: { m12: 0, y3: 0, latest: null } }),
      coverage: { complete: true, from: '2023-11-19', pages_unread: 0 } }, { as_of: null }), 'ZZA'))
    const lines = bare.text.split('\n')
    expect(lines[0]).toBe("ZZA: share-issuance filings in the SEC's filing index over the window, as UCT classified them:")
    expect(lines).toContain('No share-issuance filing is in the window.')
    expect(lines).toContain("The held answer names no newest filing day for ZZA, so I cannot give the filings' own date.")
    expect(lines).toContain('The answer carries no read time, so I cannot say how old it is.')
    expect(bare.table.rows).toEqual([])
  })
  it('not held, a refresh that did not go well, refused and an unclean answer are never "no filings"', () => {
    expect(answerFromDilution(UNAVAILABLE, 'ZZA').text).toBe("I couldn't read ZZA's share-issuance filings: no filing answer is held for it on the server (this answer never requests one from the SEC), UCT's last read of the SEC's filing index did not go well, or the read failed. Open the Dilution watch panel (DILU) in UCT, then ask again. No filing is stated. That is not the same as no filings.")
    expect(answerFromDilution(REFUSED, 'ZZA').text).toBe(`I couldn't read ZZA's share-issuance filings: ${REFUSED_WORDS}. No filing is stated. That is not the same as no filings.`)
    for (const bad of [{ state: 'failed' }, { state: null }, { rows: null }, { summary: null }]) {
      const a = honest(answerFromDilution(diluEnv(bad), 'ZZA'))
      expect(a.text, JSON.stringify(bad)).toBe("I couldn't read ZZA's share-issuance filings: UCT's data did not answer cleanly. No filing is stated. That is not the same as no filings.")
      expect(a.facts).toBeUndefined()
    }
  })
  it('the counts, the shelf states, the reasons for none, the limits and every field the answer reads are the kind\'s own and the DILU panel\'s', () => {
    const src = adapter('dilution_read')
    expect(pyKind(src)).toBe(KINDS.dilution)
    expect([pyInt(src, 'DEFAULT_ROWS'), pyInt(src, 'MAX_ROWS')]).toEqual([DILUTION_DEFAULT_ROWS, DILUTION_MAX_ROWS])
    expect(pyInt(src, 'MAX_SHELVES')).toBe(SHELVES_SHOWN)
    expect(pyTuple(src, 'HORIZONS')).toEqual(DILUTION_HORIZON_KEYS)
    expect(pyTuple(src, 'SHELF_STATES')).toEqual(Object.keys(DILUTION_SHELF_STATES))
    expect(pyDict(src, 'NONE_WORDS')).toEqual(DILUTION_NONE_WORDS)
    for (const key of [...plain(diluEnv().data), ...plain(DILU_ROWS()[0]), ...plain(SHELF()), ...plain(SUMMARY()), 'm12', 'y3', 'latest', 'years', 'complete', 'none_reason']) expect(src.includes(`"${key}"`), key).toBe(true)
  })
})

// ── served vs dark, isolation on both sides, the manifest limits, the read each answer makes ───────────────────────────
let calls, ENVS
function wire(kinds) {
  calls = []; ENVS = {}
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    if (u === '/api/agent/data') { const e = ENVS[body.kind]; return json((typeof e === 'function' ? e(body.params) : e) || { status: 'refused', data: null, notes: ['refused'] }) }
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const KEYS = Object.keys(KINDS)
const ALL = Object.values(CAPABILITIES)
const PAIRS = KEYS.map(k => [KINDS[k], CAPABILITIES[k]])
const reset = () => { _resetAgentConfig(); _resetTurns(); _resetCotForTest(); _resetTerminalDataForTest(); _resetTerminalLocalForTest(); _resetTerminalWave2ForTest(); _resetTerminalWave3ForTest(); _resetTerminalWave4ForTest();
  _resetTerminalWave5ForTest(); _resetTerminalWave6ForTest(); _resetTerminalWave7ForTest(); _resetHistoryForTest(); _resetDescribeForTest() }

describe('served vs dark', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the six kinds and the six capabilities, by name', () => {
    expect(KINDS).toEqual({ regime: 'market.regime', setups: 'stock.setups', events: 'stock.eventsTimeline', uct20: 'uct20.list', iv: 'options.ivHistory', dilution: 'dilution.watch' })
    expect(CAPABILITIES).toEqual({ regime: 'stock.marketRegime', setups: 'stock.setups', events: 'stock.eventsTimeline', uct20: 'stock.uct20List', iv: 'stock.ivHistory', dilution: 'stock.dilutionWatch' })
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'earnings.season', 'short.interest', 'rates.treasury', 'options.oiChange', 'cot.positioning', 'rs.leadership', 'setup.playbook', 'setup.record'], 'other kinds only']])('dark (%j, %s): none of the six is registered', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    expect(registerTerminalWave7Capabilities()).toEqual([])
    registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames(), n).not.toContain(n)
  })

  it.each(PAIRS)('served %s alone: only %s is registered, once, and it unregisters cleanly', async (kind, capability) => {
    wire([kind])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([capability])
    expect(registerTerminalWave7Capabilities()).toEqual([])            // idempotent
    reset()
    expect(allCapabilityNames().filter(n => ALL.includes(n))).toEqual([])
  })

  it('all six served: local-only on BOTH sides, never a plain data read, inside the manifest text limits', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const turnPy = py('api/services/uct_agent/turn.py')
    const dataReads = /^DATA_READ_ACTIONS = frozenset\(\{([\s\S]*?)^\}\)/m.exec(turnPy)[1]
    for (const [kind, name] of PAIRS) {
      const cap = getCapability(name)
      expect(cap, name).toBeTruthy()
      expect(cap.query, name).toBe(true)
      expect(cap.localOnly, name).toBe(true)
      expect(groupOfAction(name), name).toBe(ROUTE_GROUP)            // the wave's own group, by action: never the stock data group
      expect(cap.summary.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxSummary)
      expect(cap.hints.length, name).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxHints)
      expect(cap.hints, name).toMatch(/The date is the [^.]*: never today/)                        // the planner is told what the date is
      expect(cap.hints, name).toMatch(/reply: one short line, no figures\.$/)
      expect(handshake.isolated_kinds, kind).toContain(kind)          // all six kinds of this wave are model-isolated
      expect(handshake.local_only_actions, name).toContain(name)      // turn.LOCAL_ONLY_ACTIONS, via the generated handshake
      expect(dataReads.includes(`"${name}"`), name).toBe(false)       // the two server sets are disjoint
    }
  })

  it('each answer makes ONE read of its own kind, with the member\'s arguments (rows clamped to the kind\'s own limits)', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    ENVS[KINDS.regime] = () => regimeEnv()
    ENVS[KINDS.setups] = (p) => setupsEnv({ symbol: p.symbol })
    ENVS[KINDS.events] = (p) => eventsEnv({ symbol: p.symbol })
    ENVS[KINDS.uct20] = () => u20Env()
    ENVS[KINDS.iv] = (p) => ivEnv({ symbol: p.symbol })
    ENVS[KINDS.dilution] = (p) => diluEnv({ symbol: p.symbol })
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    expect((await run(CAPABILITIES.regime, {})).text).toMatch(/^UCT's market regime read: Bull correction/)
    expect((await run(CAPABILITIES.setups, { symbol: '$nvda', rows: null })).text).toMatch(/^Setups UCT's chart judge confirmed on NVDA's daily chart/)
    expect((await run(CAPABILITIES.setups, { symbol: 'brk.b', rows: 999 })).text).toMatch(/^Setups UCT's chart judge confirmed on BRK-B's daily chart/)
    expect((await run(CAPABILITIES.events, { symbol: 'tsla', rows: null })).text).toMatch(/^Dated events UCT's stores hold for TSLA/)
    expect((await run(CAPABILITIES.events, { symbol: 'TSLA', rows: 500 })).text).toMatch(/^Dated events UCT's stores hold for TSLA/)
    expect((await run(CAPABILITIES.uct20, { rows: null })).text).toMatch(/^The UCT 20 leadership list from the morning wire run of Wed, Nov 18, 2026/)
    expect((await run(CAPABILITIES.uct20, { rows: 5 })).text).toMatch(/^The UCT 20 leadership list/)
    expect((await run(CAPABILITIES.uct20, { rows: 99 })).text).toMatch(/^The UCT 20 leadership list/)
    expect((await run(CAPABILITIES.iv, { symbol: 'amd', rows: null })).text).toMatch(/^AMD at-the-money implied volatility by logged session/)
    expect((await run(CAPABILITIES.iv, { symbol: 'AMD', rows: 0 })).text).toMatch(/^AMD at-the-money implied volatility/)
    expect((await run(CAPABILITIES.dilution, { symbol: 'zza', rows: null })).text).toMatch(/^ZZA \(Made-up Holdings Inc\): share-issuance filings/)
    expect((await run(CAPABILITIES.dilution, { symbol: 'ZZA', rows: 41 })).text).toMatch(/^ZZA \(Made-up Holdings Inc\)/)
    expect(reads().map(r => [r.kind, r.params, r.purpose])).toEqual([
      [KINDS.regime, {}, 'answer'],
      [KINDS.setups, { symbol: 'NVDA', rows: 10 }, 'answer'],
      [KINDS.setups, { symbol: 'BRK-B', rows: 25 }, 'answer'],
      [KINDS.events, { symbol: 'TSLA', rows: 20 }, 'answer'],
      [KINDS.events, { symbol: 'TSLA', rows: 40 }, 'answer'],
      [KINDS.uct20, { rows: 20 }, 'answer'],
      [KINDS.uct20, { rows: 5 }, 'answer'],
      [KINDS.uct20, { rows: 20 }, 'answer'],
      [KINDS.iv, { symbol: 'AMD', rows: 20 }, 'answer'],
      [KINDS.iv, { symbol: 'AMD', rows: 1 }, 'answer'],
      [KINDS.dilution, { symbol: 'ZZA', rows: 15 }, 'answer'],
      [KINDS.dilution, { symbol: 'ZZA', rows: 40 }, 'answer'],
    ])
  })

  it('no read without a turn or without a usable ticker, and a refusal is answered in fixed words', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const GOOD = { [CAPABILITIES.regime]: {}, [CAPABILITIES.setups]: { symbol: 'NVDA', rows: null }, [CAPABILITIES.events]: { symbol: 'NVDA', rows: null }, [CAPABILITIES.uct20]: { rows: null },
      [CAPABILITIES.iv]: { symbol: 'NVDA', rows: null }, [CAPABILITIES.dilution]: { symbol: 'NVDA', rows: null } }
    for (const name of ALL) expect((await getCapability(name).answer(null, GOOD[name], null)).text, name).toMatch(/needs the Agent's turn/)
    const run = (name, args) => inTurn(() => getCapability(name).answer(null, args, null))
    for (const symbol of ['', 'the market', 'I:SPX', 'TOOLONGX', null]) {
      expect((await run(CAPABILITIES.setups, { symbol, rows: null })).text, String(symbol)).toBe("Which stock's confirmed setups should I read? Give me one ticker. Nothing is stated.")
      expect((await run(CAPABILITIES.events, { symbol, rows: null })).text, String(symbol)).toBe("Which stock's events timeline should I read? Give me one ticker. Nothing is stated.")
      expect((await run(CAPABILITIES.iv, { symbol, rows: null })).text, String(symbol)).toBe("Which stock's implied volatility history should I read? Give me one ticker. Nothing is stated.")
      expect((await run(CAPABILITIES.dilution, { symbol, rows: null })).text, String(symbol)).toBe("Which company's share-issuance filings should I read? Give me one ticker. Nothing is stated.")
    }
    expect(reads()).toEqual([])
    for (const name of ALL) {                                           // the stub refuses every kind
      const a = await run(name, GOOD[name])
      expect(a.text, name).toMatch(/^I couldn't read .*: that request wasn't allowed for this question, so nothing was read\./)
      expect(a.facts, name).toBeUndefined()
    }
    expect(reads()).toHaveLength(ALL.length)
  })
})

// ── routing: the wave's own words-only group, armed only while a capability is registered ───────────────────────────────
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
const groupWords = (id) => GROUPS.find(g => g.id === id).words
const DATA_BASE = [...groupWords('data')]              // read before anything is served: routing.js's own lists
const SCREENER_BASE = [...groupWords('screener')]
const ROUTE_OPTS = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
const namedBy = (words) => (text) => Object.keys(words).filter(k => words[k].some(re => re.test(String(text).toLowerCase())))
const wordKeys = namedBy(WAVE7_ROUTE_WORDS)
/** plain member asks, by the capability whose words must name them */
const ASKS = {
  regime: ['what is the market regime', 'market regime', 'which regime are we in', 'UCT regime read', 'is the market in a bull trend regime', 'what regime is the market in', 'regime check', 'has the regime changed'],
  setups: ['confirmed setups on NVDA', 'which setups did the judge confirm for TSLA', 'any setups on AAPL', 'any confirmed setups for AMD', 'which setups are confirmed on NVDA', 'setup verdicts for MSFT',
    'did the chart judge confirm a setup on NVDA', 'any setup confirmed on TSLA today'],
  events: ['NVDA events timeline', 'events timeline for TSLA', 'timeline of events for AAPL', 'show me the event timeline on AMD', 'dated events on NVDA', 'stored events for MSFT', 'key events around NVDA earnings',
    'timeline of NVDA events'],
  uct20: ['the UCT 20', 'what is on the UCT 20 list', 'top five of the UCT 20', 'UCT 20 leaders', 'the UCT 20 leadership list', 'is NVDA on the UCT 20', 'uct-20 list', 'show me the UCT twenty'],
  iv: ['NVDA IV history', 'IV rank for TSLA', 'how has AAPL implied volatility trended', 'implied volatility history on AMD', 'NVDA iv percentile', 'iv by session for MSFT', 'TSLA implied vol over time', 'NVDA ivr'],
  dilution: ['NVDA dilution', 'does TSLA have a shelf registration', 'share offerings AAPL filed', 'dilution risk on AMC', 'has GME filed a stock offering', 'is PLTR diluting shareholders', 'share issuance filings for RIVN',
    'any shelf offerings from MARA'],
}
/** another capability's language: none of the six's words may name these */
const NOT_OURS = [
  'describe the setup on nvda', 'describe this setup', "what's the setup here", 'walk me through the setup on NVDA', 'summarize the NVDA setup', 'describe the chart setup for NVDA',            // chart.describeSetup
  'apply my Swing Setup indicator template to this chart', 'turn on the setups layer', 'enable the uct intelligence setups', 'switch on setups in uct intelligence', 'hide the setups layer',     // templates, the UCT Intelligence layers
  'turn off auto patterns', 'hide the chart patterns', 'turn on candlestick patterns', 'any patterns on TSLA', 'which pattern is forming on AAPL', 'patterns confirmed on NVDA', 'chart patterns for NVDA',  // "pattern" is never ours
  'what is the win rate of a flat base', 'best setups in a bull market', 'how do I trade a setup', 'setup', 'setups', 'my setups',                                                             // UCT's knowledge, a bare word
  'how has NVDA behaved after earnings', 'what happens after a gap up', 'how did TSLA perform following its last three reports', 'events this week', 'economic events today', 'what events are coming up',
  'earnings calendar', 'when does NVDA report', 'events', 'timeline',                                                                                                                         // an event study, the calendar, a bare word
  'open the UCT 20', 'go to the uct 20 page', 'take me to UCT 20', 'bring up the uct 20', 'UCT 20 portfolio performance', 'add the UCT 20 to my watchlist', 'show me the leaders', 'rs leaders', 'uct', // opening the page, the model portfolio
  'NVDA IV', 'what is the IV on TSLA', 'implied volatility on AAPL', 'iv', 'iv crush', 'expected move for NVDA earnings', 'options chain for NVDA', 'implied move on TSLA',                    // a bare IV is the chain's, expected move is wave 2's
  'any news on the TSLA offering', 'NVDA offering', 'offering', 'secondary offering news', 'ipo calendar', 'SEC filings for NVDA', 'insider selling on NVDA', 'top shelf', 'offerings this week', // news of an offering, a bare word
  'gamma regime for NVDA', 'what gamma regime is TSLA in', 'volatility regime', 'options regime on SPY',                                                                                     // wave 3's gamma regime
  'scan for stocks with confirmed setups', 'find stocks with iv rank above 50', 'screen for dilution', 'alert me when the regime changes', 'notify me if NVDA files a shelf registration',
  'open the market regime panel', 'add a dilution watch widget', 'go to the events timeline tab', 'dilution on my watchlist', 'iv rank over 80', 'iv percentile above 90',                  // screens, alerts, navigation, the member's lists
  'what is a regime', 'what is market regime', 'explain the market regime', 'what does regime mean', "what's a setup", 'what is iv rank', 'what is implied volatility', 'explain implied volatility history',
  'define dilution', 'what is dilution', 'what is a shelf registration', 'how is iv rank calculated', 'what does dilution mean',                                                              // what a term means: the guide
  'short interest on NVDA', 'most shorted stocks', 'dark pool levels on NVDA', 'gamma levels for NVDA', 'show me the top flow picks', 'earnings season today', 'treasury yields', 'NVDA seasonality',
  'market tide history', 'open interest change on NVDA', 'earnings reactions for yesterday',                                                                                                 // waves 1 to 6
  'any news on TSLA', 'switch to weekly', 'what got upgraded today', 'which stocks made new 52-week highs', 'top gainers today', 'compare nvda with amd', 'NVDA relative strength', 'NVDA earnings date',
]
/** asks the earlier waves' words name (their own tests hold the full lists): this wave's words must not */
const EARLIER_ASKS = ['what got upgraded today', 'new highs today', 'top gainers over 60 days', 'dark pool levels on NVDA', 'which stocks made new 52-week highs', 'which themes are rotating in',
  'what is on the confluence board', 'bearish confluence names', 'expected move for NVDA earnings', 'search earnings calls for pricing power', 'gamma levels for NVDA', 'show me the top flow picks',
  "what is the flow record's win rate", 'earnings reactions for yesterday', 'earnings season today', 'call themes this month', 'drill into XLK', 'stocks in the semiconductors industry',
  'short interest on NVDA', 'most shorted stocks', 'NVDA days to cover', 'NVDA seasonality', 'sector seasonality', 'market tide history', 'open interest change on NVDA', 'treasury yields']

describe('routing words', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { reset(); vi.restoreAllMocks() })
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('the group is words-only and never a filler, routing.js lists the six by action with no word of its own, and it is the 49th group', () => {
    const g = ownGroup()
    expect(g.wordsOnly && g.fillLast).toBe(true)
    expect(g.words).toEqual([])                                      // server-armed: empty until a capability registers
    expect([...g.actions].sort()).toEqual([...ALL].sort())
    expect(g.domains).toEqual([])
    expect(g.id).toMatch(/^[a-z][a-zA-Z]{1,23}$/)
    expect(g.title.length).toBeLessThanOrEqual(160)                  // the server cuts a group title at 160 characters (turn.py validate_routing)
    // the server keeps only MAX_GROUPS groups. It kept 48 and all 48 were taken; the integrator's wave 7 build raised it to 56
    // on 2026-11-20 for this group, the 49th (a builder's change, recorded in turn.py: not an owner decision). A later wave's
    // group comes after it (agentTerminalDataWave8.test.js pins how many are left)
    const max = Number(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m.exec(py('api/services/uct_agent/turn.py'))[1])
    expect([GROUPS.map(x => x.id).indexOf(ROUTE_GROUP) + 1, max, GROUPS.length <= max]).toEqual([49, 56, true])
    expect(GROUPS.map(x => x.id).slice(45, 49)).toEqual([WAVE4_GROUP, WAVE5_GROUP, WAVE6_GROUP, ROUTE_GROUP])
    expect(new Set(GROUPS.map(x => x.id)).size).toBe(GROUPS.length)
    // no action of this wave is in any other group's list
    for (const other of GROUPS.filter(x => x.id !== ROUTE_GROUP)) for (const n of ALL) expect(other.actions || [], `${other.id}: ${n}`).not.toContain(n)
  })

  it.each([[null, 'data off'], [[], 'nothing activated'], [['quote', 'themes', 'earnings', 'earnings.season', 'short.interest', 'rates.treasury', 'cot.positioning', 'rs.leadership', 'setup.playbook'], 'other kinds only']])('dark (%j, %s): the group has no words, and the data and screener groups keep exactly routing.js\'s', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual([])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('screener')).toEqual(SCREENER_BASE)
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it.each(KEYS)('served %s alone: only its own words are armed, no other group\'s words change, and they are taken back', async (key) => {
    wire([KINDS[key]])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(ownGroup().words).toEqual(WAVE7_ROUTE_WORDS[key])
    expect(groupWords('data')).toEqual(DATA_BASE)
    expect(groupWords('screener')).toEqual(SCREENER_BASE)
    expect([groupWords(WAVE4_GROUP), groupWords(WAVE5_GROUP), groupWords(WAVE6_GROUP), groupWords('cot')]).toEqual([[], [], [], []])
    // the OTHER five's asks are not sent to the group while only this one is served
    for (const [other, asks] of Object.entries(ASKS)) if (other !== key) for (const q of asks) expect(wordsSelect(ROUTE_GROUP, q), `${key} alone: ${q}`).toBe(false)
    registerTerminalWave7Capabilities()                                // idempotent: never armed twice
    expect(ownGroup().words).toHaveLength(WAVE7_ROUTE_WORDS[key].length)
    reset()
    expect(ownGroup().words).toEqual([])
  })

  it('every capability has words, and each ask is named by its own capability\'s words and by no other of this wave', () => {
    expect(Object.keys(WAVE7_ROUTE_WORDS).sort()).toEqual([...KEYS].sort())
    for (const [key, asks] of Object.entries(ASKS)) for (const q of asks) expect(wordKeys(q), q).toEqual([key])
  })

  it('served: each ask routes its capability under v1 and v2, and the budget never cuts the group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const [key, asks] of Object.entries(ASKS)) {
      for (const q of asks) {
        expect(wordsSelect(ROUTE_GROUP, q), q).toBe(true)
        expect(selectGroups(q).selected, q).toContain(ROUTE_GROUP)
        for (const route of [routeManifest, routeManifestV2]) {
          const r = route(full, q, ROUTE_OPTS())
          expect(r.manifest.map(c => c.name), `${route.name}: ${q}`).toContain(CAPABILITIES[key])
          expect(r.overBudget || [], `${route.name}: ${q}`).not.toContain(ROUTE_GROUP)
        }
      }
    }
  })

  it('served: the words never name another capability\'s language, and v1 does not send the group for it either', async () => {
    for (const q of NOT_OURS) expect(wordKeys(q), q).toEqual([])
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    for (const q of NOT_OURS) expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
  })

  it('the nearest neighbours keep their own asks: describing the chart in view, the UCT Intelligence layers, an event study, expected move, gamma levels, the playbook', async () => {
    wire([...PAIRS.map(p => p[0]), 'bars.daily', 'instrument.resolve', 'history.eventStudy', 'earnings.expectedMove', 'levels.gamma', 'setup.playbook', 'setup.record', 'rs.leadership'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    const NEIGHBOURS = ['chart.describeSetup', 'history.afterEvent', 'stock.expectedMove', 'stock.gammaLevels']
    expect(allCapabilityNames()).toEqual(expect.arrayContaining(NEIGHBOURS))            // non-vacuity: the neighbours are registered
    const routed = (q) => [routeManifest, routeManifestV2].map(route => [route.name, route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)])
    // "setup": describing the chart in view stays chart.describeSetup's, and the stored verdicts do not ride with it under v1
    for (const q of ['describe the setup on nvda', "what's the setup here", 'walk me through the setup on NVDA', 'summarize the NVDA setup']) {
      expect(selectGroups(q).selected, q).toContain(groupOfAction('chart.describeSetup'))
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain('chart.describeSetup')
      expect(routeManifest(full, q, ROUTE_OPTS()).manifest.map(c => c.name), q).not.toContain(CAPABILITIES.setups)
    }
    // "setup" and "pattern" as a layer of the UCT Intelligence indicator stay that group's
    for (const q of ['turn on the setups layer', 'turn off auto patterns', 'hide the chart patterns', 'turn on candlestick patterns']) {
      expect(selectGroups(q).selected, q).toContain('uctIntelligence')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // "events": an event study stays history.afterEvent's
    for (const q of ['how has NVDA behaved after earnings', 'what happens after a gap up']) {
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain('history.afterEvent')
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // "iv": expected / implied move stays wave 2's, and a stock's gamma regime stays wave 3's
    for (const [q, owner] of [['expected move for NVDA earnings', 'stock.expectedMove'], ['implied move on TSLA', 'stock.expectedMove'], ['gamma levels for NVDA', 'stock.gammaLevels']]) {
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain(owner)
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
    // the stored verdicts, the timeline, the IV log and the filings are this wave's, and the neighbours' groups do not ride under v1
    for (const [q, key, neighbour] of [['confirmed setups on NVDA', 'setups', 'chart.describeSetup'], ['NVDA events timeline', 'events', 'history.afterEvent'], ['IV rank for TSLA', 'iv', 'stock.expectedMove'],
      ['what is the market regime', 'regime', 'stock.gammaLevels']]) {
      expect(selectGroups(q).selected, q).toContain(ROUTE_GROUP)
      expect(selectGroups(q).selected, q).not.toContain(groupOfAction(neighbour))
      for (const [name, names] of routed(q)) expect(names, `${name}: ${q}`).toContain(CAPABILITIES[key])
    }
    // a bare "setup", "pattern", "events", "iv", "offering", "leaders" selects nothing of this wave under v1
    for (const q of ['setup', 'setups', 'pattern', 'patterns', 'events', 'event', 'timeline', 'iv', 'implied volatility', 'offering', 'offerings', 'shelf', 'filings', 'leaders', 'uct', 'the 20']) {
      expect(selectGroups(q).selected, q).not.toContain(ROUTE_GROUP)
    }
  })

  it('served: the fill for a message nothing recognised never carries the words-only group', async () => {
    wire(PAIRS.map(p => p[0]))
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
    for (const q of ['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'show me the leaders', 'both', 'hmm', 'setups', 'offering', 'iv']) {
      for (const route of [routeManifest, routeManifestV2]) {
        const names = route(full, q, ROUTE_OPTS()).manifest.map(c => c.name)
        for (const n of ALL) expect(names, `${route.name}: ${q}`).not.toContain(n)
      }
    }
  })

  const FIXED_WORDS = ['dilution', 'timeline']
  it('the typo lexicon: registering the six changes no correction of any OTHER capability\'s capreg corpus phrasing', async () => {
    // A summary's and a hint's lowercase words join the typo lexicon (nl/lexicon.js). This wave's own phrasings are left out.
    wire([])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const texts = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text)), 'walk me through the setup on NVDA', 'wipe the Momentum list', 'sort ascending by change', 'ascending order',
      'show me the leeders', 'chnage the theme', 'make it shorter', 'sorted results', 'hover over it', 'recover the layout', 'floating window', 'rank them', 'interesting names today', 'whats the reprot date',
      'the newst one', 'offen', 'the sme one', 'bset setups', 'frist one', 'munth view', 'each one', 'ago', 'weak names', 'the bord', 'regieme', 'regim', 'regimen', 'time line',
      'pollution', 'utc', 'cut', 'ucts', 'evnts', 'setps', 'offring', 'shelv', 'implyed', 'volatilty', 'histroy', 'percentle', 'fillings', 'registraton', 'judeg', 'confrimed']
    // A capability's NAME is fixed and its words join the lexicon, so a word one or two edits from "timeline" or "dilution"
    // gains that reading while the capability is registered. These are every such change found, stated so it is not a surprise;
    // a correction is USED only when the corrected sentence parses into a safe instant action (nl/lexicon.js), and none of
    // these six has an instant phrase.
    const OWN_NAME_NEIGHBOURS = { timelin: ['[]', '["timeline"]'], timelines: ['[]', '["timeline"]'], dilutoin: ['[]', '["dilution"]'], solution: ['[]', '["dilution"]'], delusion: ['["deletion"]', '["dilution","deletion"]'] }
    const fix = (t, lex) => JSON.stringify((correctTypos(t, lex) || []).map(v => v.text))
    const read = () => { const lex = lexiconFor(null); return texts.map(t => fix(t, lex)) }
    const before = read()
    const ownBefore = Object.keys(OWN_NAME_NEIGHBOURS).map(t => fix(t, lexiconFor(null)))
    const known = new Set(lexiconFor(null).words)
    _resetAgentConfig(); wire(PAIRS.map(p => p[0])); await loadAgentConfig(); registerServerGatedBuiltins()
    for (const n of ALL) expect(allCapabilityNames()).toContain(n)
    const after = read()
    expect(texts.length).toBeGreaterThan(500)
    expect(texts.map((t, i) => (before[i] !== after[i] ? `${t}: ${before[i]} -> ${after[i]}` : null)).filter(Boolean)).toEqual([])
    expect(Object.fromEntries(Object.keys(OWN_NAME_NEIGHBOURS).map((t, i) => [t, [ownBefore[i], fix(t, lexiconFor(null))]]))).toEqual(OWN_NAME_NEIGHBOURS)
    // the ONLY words the six add to the lexicon are words of their own NAMES: a name is fixed. A summary's and a hint's other
    // words are either already known or written in CAPITALS, which the lexicon skips
    expect([...lexiconFor(null).words].filter(w => !known.has(w)).sort()).toEqual(FIXED_WORDS)
  })

  it('no OTHER capability\'s capreg corpus phrasing is named by these words (armed, the group rides with none of them)', () => {
    // every corpus phrasing but this wave's own: production's and the dark ones (the corpus runs them with every kind on)
    const others = [...new Set(allPhrasings().filter(p => !ALL.includes(p.intent.id)).map(p => p.ph.text))]
    expect(others.length).toBeGreaterThan(500)
    expect(others.filter(t => wordKeys(t).length)).toEqual([])
  })

  it('this wave\'s own corpus phrasings are each named by their own capability\'s words (four dark phrasings each)', () => {
    for (const key of KEYS) {
      const mine = allPhrasings().filter(p => p.intent.id === CAPABILITIES[key]).map(p => p.ph.text)
      expect(mine.length, key).toBeGreaterThanOrEqual(4)
      for (const q of mine) expect(wordKeys(q), q).toEqual([key])
    }
  })

  it('a SCREEN-shaped ask that names the UCT 20 stays the Screener\'s: its fixed refusal claims it before any model call, and no ask or corpus phrasing of this wave is one', () => {
    // screener.js's fast path (W1.1 R-05) claims a screen-shaped message whose words name a Screener field the Agent never
    // reaches, and `in_uct20` is one of them (scanHidden.js, generated from the server's list). That rail is older than this
    // wave and this wave does not change it: "which stocks are in the UCT 20" is answered by the Screener's fixed refusal with
    // no model call, so stock.uct20List never sees it, served or not. Found by the dark corpus run, where that phrasing failed.
    const claimed = (q) => { const low = q.toLowerCase(); return !!hiddenPhraseIn(low) && hiddenScreenRequest(low) }
    for (const q of ['which stocks are in the UCT 20', 'which stocks are in the uct20', 'list the stocks in the UCT 20', 'show me the names on the UCT 20', 'top 5 stocks of the UCT 20']) {
      expect(hiddenPhraseIn(q.toLowerCase())?.key, q).toBe('in_uct20')
      expect(claimed(q), q).toBe(true)
    }
    const mine = allPhrasings().filter(p => ALL.includes(p.intent.id)).map(p => p.ph.text)
    expect(mine.length).toBeGreaterThanOrEqual(24)
    expect(mine.filter(claimed)).toEqual([])
    expect(Object.values(ASKS).flat().filter(claimed)).toEqual([])
  })

  it('the earlier waves\' words name none of this wave\'s asks, and these words name none of theirs', () => {
    const earlier = [namedBy(TERMINAL_ROUTE_WORDS), namedBy(WAVE2_ROUTE_WORDS), namedBy(WAVE3_ROUTE_WORDS), namedBy(WAVE4_ROUTE_WORDS), namedBy(WAVE5_ROUTE_WORDS), namedBy(WAVE6_ROUTE_WORDS)]
    for (const asks of Object.values(ASKS)) for (const q of asks) expect(earlier.flatMap(f => f(q)), q).toEqual([])
    for (const q of EARLIER_ASKS) {
      expect(earlier.flatMap(f => f(q)).length, q).toBeGreaterThan(0)    // non-vacuity: an earlier wave really names it
      expect(wordKeys(q), q).toEqual([])
    }
  })

  it('no row of the routing-collision table is named by these words (every row belongs to another group)', () => {
    // baseline/routingCollisions.json is asserted under production's kinds, where these words are not armed: this holds it armed
    expect(collisions.rows.length).toBeGreaterThan(10)
    const stolen = collisions.rows.filter(r => r.owner !== ROUTE_GROUP && !(r.also || []).includes(ROUTE_GROUP) && wordKeys(r.text).length).map(r => `${r.text} (${r.owner})`)
    expect(stolen).toEqual([])
  })
})
