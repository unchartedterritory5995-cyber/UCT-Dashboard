// List alerts, the pure half (listAlertModel.js). Rails:
//   * the routes, and that only the three lists have a write URL;
//   * the answer is read FAIL CLOSED: only `available: true` with a readable switch is 'ok'; an
//     answer that does not say so is 'off' (draw nothing); anything else is 'failed';
//   * a switch is on, off or NOT IN THE ANSWER (null), never guessed;
//   * the one line beside a switch says how the member is told, in its own state, and says when
//     there is nothing to alert on;
//   * every write outcome has its sentence, and a write that did not answer says it cannot know;
//   * the read failures that mean "draw nothing" are exactly 404, 401 and 402.
// The fixtures are the routes' real shapes (api/routers/list_alerts.py, tests/test_list_alerts.py).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIST_ALERTS_URL, LIST_ALERT_KINDS, LIST_ALERT_LABEL, alertNotes, clockEt, howTold, listAlertWriteUrl, listAlertsRead, readIsQuiet,
  switchOf, writeFailureText, writeOutcome,
} from './listAlertModel'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const kindsBody = (on = {}) => [
  { kind: 'highs52', on: !!on.highs52, code: 'H52', command: 'H52 HIGHS', name: 'New 52-week highs' },
  { kind: 'confluence', on: !!on.confluence, code: 'CONFL', command: 'CONFL', name: 'Confluence board' },
  { kind: 'repeat_contracts', on: !!on.repeat_contracts, code: 'ACCUM', command: 'ACCUM', name: 'Repeat-hit option contracts' },
]
const body = (on = {}, over = {}) => ({
  available: true, follows: 37, rearm_sessions: 5, max_named: 12, checks_et: ['18:10', '21:50'], kinds: kindsBody(on), ...over,
})

describe('list alerts: the routes and the three lists', () => {
  it('reads one URL and writes one URL per list', () => {
    expect(LIST_ALERTS_URL).toBe('/api/alerts/lists')
    expect(listAlertWriteUrl('highs52')).toBe('/api/alerts/lists/highs52')
    expect(listAlertWriteUrl('confluence')).toBe('/api/alerts/lists/confluence')
    expect(listAlertWriteUrl('repeat_contracts')).toBe('/api/alerts/lists/repeat_contracts')
  })

  it('a word that is not one of the three has no write URL', () => {
    for (const bad of ['lows52', 'H52', '', null, undefined, 'toString', '__proto__', 'confluence/../x']) {
      expect(listAlertWriteUrl(bad)).toBeNull()
    }
  })

  it('the kinds and codes are the server\'s, read from its file', () => {
    const server = fs.readFileSync(path.resolve(HERE, '../../../../../api/services/list_alerts.py'), 'utf8')
    const kinds = /HIGHS52, CONFLUENCE, REPEAT = "(\w+)", "(\w+)", "(\w+)"/.exec(server)
    expect(kinds.slice(1)).toEqual(Object.keys(LIST_ALERT_KINDS))
    for (const [kind, info] of Object.entries(LIST_ALERT_KINDS)) {
      expect(server).toContain(`"code": "${info.code}"`)
      expect(server).toContain(`"name": "${info.name}"`)
      expect(kind).toMatch(/^[a-z0-9_]+$/)
    }
  })

  it('each code is a Terminal code', () => {
    const registry = fs.readFileSync(path.resolve(HERE, '../functions.js'), 'utf8')
    for (const info of Object.values(LIST_ALERT_KINDS)) expect(registry).toContain(`code: '${info.code}'`)
  })

  it('the label is one plain sentence without a full stop (the email quotes it)', () => {
    expect(LIST_ALERT_LABEL).toBe('Alert me when a stock I follow appears here')
  })
})

describe('list alerts: reading the answer', () => {
  it('a healthy answer: every switch, the follow count, the numbers and the check times', () => {
    expect(listAlertsRead(body({ confluence: true }))).toEqual({
      state: 'ok', on: { highs52: false, confluence: true, repeat_contracts: false }, follows: 37, rearm: 5, maxNamed: 12,
      checks: ['6:10 PM ET', '9:50 PM ET'],
    })
  })

  it('FAIL CLOSED: an answer that does not say available is off, whatever else it carries', () => {
    for (const available of [false, undefined, null, 'true', 1]) {
      const read = listAlertsRead(body({ highs52: true }, { available }))
      expect(read.state).toBe('off')
      expect(read.on).toEqual({})
    }
  })

  it('anything that is not this route\'s answer is failed, never off and never ok', () => {
    for (const bad of [null, undefined, '', 'ok', 7, [], {}, { available: true }, { available: true, kinds: 'x' }, { detail: 'Not Found' }]) {
      expect(listAlertsRead(bad).state).toBe('failed')
    }
    // kinds present, none readable
    expect(listAlertsRead(body({}, { kinds: [] })).state).toBe('failed')
    expect(listAlertsRead(body({}, { kinds: [{ kind: 'lows52', on: true }, { kind: 'highs52', on: 'yes' }, null] })).state).toBe('failed')
  })

  it('a kind the answer does not carry, or carries without a clear on or off, is not guessed', () => {
    const read = listAlertsRead(body({}, { kinds: [{ kind: 'confluence', on: true }, { kind: 'highs52', on: 1 }, { kind: 'made_up', on: true }] }))
    expect(read.state).toBe('ok')
    expect(read.on).toEqual({ confluence: true })
    expect(switchOf(read, 'confluence')).toBe(true)
    expect(switchOf(read, 'highs52')).toBeNull()
    expect(switchOf(read, 'repeat_contracts')).toBeNull()
    expect(switchOf(listAlertsRead(null), 'confluence')).toBeNull()
    expect(switchOf(null, 'confluence')).toBeNull()
  })

  it('a follow count that is missing or not a count is unknown, never 0', () => {
    for (const follows of [null, undefined, '3', -1, NaN]) expect(listAlertsRead(body({}, { follows })).follows).toBeNull()
    expect(listAlertsRead(body({}, { follows: 0 })).follows).toBe(0)
  })

  it('check times are words, and a time that is not a time is dropped', () => {
    expect(clockEt('18:10')).toBe('6:10 PM ET')
    expect(clockEt('21:50')).toBe('9:50 PM ET')
    expect(clockEt('00:05')).toBe('12:05 AM ET')
    expect(clockEt('12:00')).toBe('12:00 PM ET')
    expect(clockEt('9:30')).toBe('9:30 AM ET')
    for (const bad of ['24:00', '18:60', 'six', '', null, '18', 1810]) expect(clockEt(bad)).toBeNull()
    expect(listAlertsRead(body({}, { checks_et: ['18:10', 'later', '25:00'] })).checks).toEqual(['6:10 PM ET'])
    expect(listAlertsRead(body({}, { checks_et: 'evening' })).checks).toEqual([])
  })
})

describe('list alerts: the line beside a switch', () => {
  const read = (on, over) => listAlertsRead(body(on, over))

  it('off: says it is off and what switching it on would send', () => {
    expect(howTold(read(), 'confluence')).toBe(
      'Off. Switch it on for a note in the alert bell and one email, after the 6:10 PM ET check on trading days, when a stock on your watchlists or your Flagged list comes onto the confluence board.')
  })

  it('on: says what is sent and when', () => {
    expect(howTold(read({ repeat_contracts: true }), 'repeat_contracts')).toBe(
      'On: a note in the alert bell and one email, after the 6:10 PM ET check on trading days, when a stock on your watchlists or your Flagged list gets a new repeat-hit option contract.')
  })

  it('the highs list says it is highs only (the panel also lists lows)', () => {
    expect(howTold(read({ highs52: true }), 'highs52')).toBe(
      'On: a note in the alert bell and one email, after the 6:10 PM ET check on trading days, when a stock on your watchlists or your Flagged list makes a new 52-week high. New 52-week highs only, not lows.')
  })

  it('a member who follows nothing is told there is nothing to alert on, on or off', () => {
    expect(howTold(read({}, { follows: 0 }), 'confluence')).toBe('You have no stocks on a watchlist and none flagged yet, so there is nothing to alert on.')
    expect(howTold(read({ highs52: true }, { follows: 0 }), 'highs52'))
      .toBe('On, but you have no stocks on a watchlist and none flagged yet, so there is nothing to alert on. New 52-week highs only, not lows.')
  })

  it('an unknown follow count is not read as none, and a missing check time is not invented', () => {
    expect(howTold(read({}, { follows: null, checks_et: [] }), 'confluence')).toBe(
      'Off. Switch it on for a note in the alert bell and one email, after the close on trading days, when a stock on your watchlists or your Flagged list comes onto the confluence board.')
  })

  it('says nothing for a read that is not ok, or a list that is not one of the three', () => {
    expect(howTold(listAlertsRead(null), 'confluence')).toBe('')
    expect(howTold(listAlertsRead(body({}, { available: false })), 'confluence')).toBe('')
    expect(howTold(read(), 'lows52')).toBe('')
  })

  it('no sentence is advice', () => {
    const all = [...Object.keys(LIST_ALERT_KINDS).flatMap((k) => [howTold(read(), k), howTold(read({ [k]: true }), k)]), ...alertNotes(read())]
    for (const s of all) expect(s).not.toMatch(/\b(buy|sell|should|recommend|opportunit|target)\w*/i)
  })
})

describe('list alerts: the small print', () => {
  it('says what is said once, the cap and the second check, from the server\'s own numbers', () => {
    expect(alertNotes(listAlertsRead(body()))).toEqual([
      'A stock that is already on a list when you switch on is not announced; only a stock that comes onto it later is.',
      'A stock that stays on a list is said once, and again only after 5 sessions off it.',
      'At most one message per list each evening, naming up to 12 stocks.',
      'A second check at 9:50 PM ET sends only what the first could not.',
    ])
  })

  it('a number the server did not send is left out, never invented', () => {
    expect(alertNotes(listAlertsRead(body({}, { rearm_sessions: null, max_named: undefined, checks_et: ['18:10'] })))).toEqual([
      'A stock that is already on a list when you switch on is not announced; only a stock that comes onto it later is.',
    ])
    expect(alertNotes(listAlertsRead(null))).toEqual([])
    expect(alertNotes(listAlertsRead(body({}, { available: false })))).toEqual([])
  })
})

describe('list alerts: the answer to a write', () => {
  it('on and off, when the server put the switch where the member put it', () => {
    const on = writeOutcome(body({ confluence: true }), 'confluence', true)
    expect(on.kind).toBe('on')
    expect(on.text).toBe('Alert switched on for Confluence board.')
    expect(on.read.on.confluence).toBe(true)
    const off = writeOutcome(body(), 'confluence', false)
    expect([off.kind, off.text]).toEqual(['off', 'Alert switched off for Confluence board.'])
  })

  it('a switch the server left where it was is a mismatch, and says where it is', () => {
    const out = writeOutcome(body(), 'highs52', true)
    expect(out.kind).toBe('mismatch')
    expect(out.text).toBe('The server did not change the alert for New 52-week highs. It is still off.')
    expect(out.read.on.highs52).toBe(false)
    expect(writeOutcome(body({ highs52: true }), 'highs52', false).text).toBe('The server did not change the alert for New 52-week highs. It is still on.')
  })

  it('an answer that is not the switches is unreadable: it does not claim either way', () => {
    for (const res of [null, {}, { ok: true }, body({}, { available: false }), body({}, { kinds: [{ kind: 'confluence', on: true }] })]) {
      const out = writeOutcome(res, 'highs52', true)
      expect(out.kind).toBe('unreadable')
      expect(out.read).toBeNull()
      expect(out.text).toBe('The server answered in a way this control cannot read, so it cannot say whether the alert for New 52-week highs changed. Your switches are being read again.')
    }
  })

  it('a write that got no usable answer says what is known', () => {
    const f = (err, on = true) => writeFailureText(err, 'repeat_contracts', on)
    expect(f({ status: 401 })).toBe('You are signed out, so the alert for Repeat-hit option contracts was not switched on. Sign in again.')
    expect(f({ status: 402 }, false)).toBe('List alerts need a paid plan, so the alert for Repeat-hit option contracts was not switched off.')
    expect(f({ status: 404 })).toBe('List alerts are not switched on for this server, so the alert for Repeat-hit option contracts was not switched on.')
    expect(f({ status: 500 })).toBe('The alert for Repeat-hit option contracts could not be switched on just now. Nothing changed. Try again.')
    expect(f({ timedOut: true })).toBe('The server did not answer within 30 seconds, so this control cannot say whether the alert for Repeat-hit option contracts was switched on. Your switches are being read again. If nothing changed, try again.')
    expect(f(new TypeError('Failed to fetch'), false)).toBe('The server could not be reached, so this control cannot say whether the alert for Repeat-hit option contracts was switched off. Your switches are being read again. If nothing changed, try again.')
  })
})

describe('list alerts: which failed reads draw nothing', () => {
  it('a dark route, a signed-out member and a paywall are quiet; anything else is said', () => {
    for (const status of [404, 401, 402]) expect(readIsQuiet({ status })).toBe(true)
    for (const err of [{ status: 500 }, { status: 503 }, { status: 403 }, { timedOut: true }, new TypeError('x'), null, undefined]) {
      expect(readIsQuiet(err)).toBe(false)
    }
  })
})
