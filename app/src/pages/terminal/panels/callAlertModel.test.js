// TSRC call alerts, the pure half. Rails:
//   * a word is compared in the form the server stores it (trimmed, spaces collapsed, lower case);
//   * the route's own failure answer (max 0) is "unavailable", never "no alerts, and paused";
//   * a search an alert cannot hold (too short, too long, a NEAR search, a full list, alerts
//     switched off) is blocked with its reason, and a NEAR search is blocked even when its
//     lower-case twin is saved;
//   * every answer to a save and to a removal is its own outcome with its own sentence, and a write
//     that got no usable answer never claims the write did or did not land when it cannot know;
//   * how a member is told says only what the server does.
// The fixtures are the routes' real shapes (api/routers/earnings_intel.py keyword-alerts).
import { describe, it, expect } from 'vitest'
import {
  ALERT_MAX_LENGTH, ALERT_MIN_LENGTH, CALL_ALERTS_URL, HOW_PAUSED, HOW_TOLD, alertKeyword, alertNotes, alertsRead, callAlertRemoveUrl,
  countSentence, removeOutcome, saveOutcome, saveState, usesNear, writeFailureText,
} from './callAlertModel'

const LIST = { keywords: ['buyback', 'tariff'], max: 25, min_length: 3, enabled: true }
const READ = alertsRead(LIST)
const fail = (status) => Object.assign(new Error(`http ${status}`), { status })

describe('call alerts: the stored form and the routes', () => {
  it('the routes and the limits', () => {
    expect(CALL_ALERTS_URL).toBe('/api/earnings/keyword-alerts')
    expect([ALERT_MIN_LENGTH, ALERT_MAX_LENGTH]).toEqual([3, 60])
    expect(callAlertRemoveUrl('pricing power')).toBe('/api/earnings/keyword-alerts?keyword=pricing%20power')
    expect(callAlertRemoveUrl('"at&t"')).toBe('/api/earnings/keyword-alerts?keyword=%22at%26t%22')
  })

  it('a word is held the way the server stores it', () => {
    expect(alertKeyword('  Pricing   POWER ')).toBe('pricing power')
    expect(alertKeyword('"Pricing Power"')).toBe('"pricing power"')
    expect(alertKeyword(null)).toBe('')
  })

  it('NEAR is an operator only in capitals, at the start of a token, outside a phrase', () => {
    for (const q of ['tariff NEAR china', 'tariff NEAR/5 china', '(tariff)NEAR(china)', '"price cut" NEAR/3 margin', 'NEAR china']) {
      expect(usesNear(q), q).toBe(true)
    }
    for (const q of ['tariff near china', 'NEARBY stores', 'nearshoring', '"tariff NEAR china"', 'tariff OR duty', 'NEAR/x china', 'LINEAR growth', '']) {
      expect(usesNear(q), q).toBe(false)
    }
  })
})

describe('call alerts: the list read', () => {
  it('reads the member\'s words, the limit and the delivery switch', () => {
    expect(READ).toEqual({ state: 'ok', keywords: ['buyback', 'tariff'], max: 25, minLength: 3, sending: true })
    expect(alertsRead({ ...LIST, keywords: [], enabled: false })).toMatchObject({ state: 'ok', keywords: [], sending: false })
    // a switch the server did not send as true is off
    expect(alertsRead({ ...LIST, enabled: 1 }).sending).toBe(false)
    expect(alertsRead({ ...LIST, keywords: ['a', ' a ', '', null, 'b'] }).keywords).toEqual(['a', 'b'])
  })

  it('the route\'s own failure answer is unavailable, never an empty paused list', () => {
    expect(alertsRead({ keywords: [], max: 0, min_length: 0, enabled: false })).toMatchObject({ state: 'unavailable', keywords: [] })
    for (const body of [null, undefined, [], 'x', { detail: 'no' }, { keywords: 'tariff', max: 25 }]) {
      expect(alertsRead(body).state, JSON.stringify(body)).toBe('failed')
    }
  })
})

describe('call alerts: can this search be saved', () => {
  it('a search that is already an alert, whatever its capitals', () => {
    expect(saveState('Tariff', READ)).toEqual({ kind: 'saved', keyword: 'tariff' })
    expect(saveState('tariff', READ)).toEqual({ kind: 'saved', keyword: 'tariff' })
  })

  it('a search that can be saved, with the word that is sent', () => {
    expect(saveState('Pricing Power', READ)).toEqual({ kind: 'can-save', keyword: 'pricing power' })
    expect(saveState('x'.repeat(ALERT_MAX_LENGTH), READ).kind).toBe('can-save')
    expect(saveState('abc', READ).kind).toBe('can-save')
  })

  it('a search an alert cannot hold says why', () => {
    expect(saveState('AI', READ)).toMatchObject({ kind: 'blocked', problem: 'short', message: 'An alert needs at least 3 characters, because a shorter word is said on almost every call.' })
    expect(saveState('x'.repeat(61), READ)).toMatchObject({ kind: 'blocked', problem: 'long', message: 'An alert holds at most 60 characters, and this search has 61.' })
    expect(saveState('tariff NEAR/5 china', READ)).toMatchObject({ kind: 'blocked', problem: 'near' })
    expect(saveState('tariff NEAR/5 china', READ).message).toContain('It uses NEAR')
    const full = alertsRead({ ...LIST, keywords: Array.from({ length: 25 }, (_, i) => `word${i}`) })
    expect(saveState('margin', full)).toMatchObject({ kind: 'blocked', problem: 'full', message: 'You have 25 call alerts, the most allowed. Remove one first.' })
    // at the limit, a search that is already one of the 25 is still shown as saved (and removable)
    expect(saveState('WORD3', full).kind).toBe('saved')
    const paused = alertsRead({ ...LIST, enabled: false })
    expect(saveState('margin', paused)).toMatchObject({ kind: 'blocked', problem: 'paused' })
    expect(saveState('tariff', paused).kind).toBe('saved')
  })

  it('a NEAR search is blocked even when its lower-case twin is saved: they are different searches', () => {
    const read = alertsRead({ ...LIST, keywords: ['tariff near china'] })
    expect(saveState('tariff NEAR china', read)).toMatchObject({ kind: 'blocked', problem: 'near' })
    expect(saveState('tariff near china', read).kind).toBe('saved')
  })

  it('the server\'s own floor is used when it sends one', () => {
    expect(saveState('abcd', alertsRead({ ...LIST, min_length: 5 }))).toMatchObject({ kind: 'blocked', problem: 'short' })
    expect(saveState('abcd', alertsRead({ ...LIST, min_length: 5 })).message).toContain('at least 5 characters')
  })
})

describe('call alerts: the answer to a save', () => {
  it('saved, with the list the server sent back', () => {
    expect(saveOutcome({ ok: true, keyword: 'margin', keywords: ['buyback', 'margin', 'tariff'] }, 'margin', READ))
      .toEqual({ kind: 'saved', keywords: ['buyback', 'margin', 'tariff'], text: 'Saved as a call alert: margin.' })
  })

  it('refused, with the server\'s reason in plain words', () => {
    expect(saveOutcome({ ok: false, reason: 'limit_reached', max: 25 }, 'margin', READ))
      .toEqual({ kind: 'refused', keywords: null, text: 'Not saved. You already have 25 call alerts, the most call alerts allowed. Remove one first.' })
    expect(saveOutcome({ ok: false, reason: 'too_short_or_too_long', min_length: 3 }, 'ai', READ))
      .toEqual({ kind: 'refused', keywords: null, text: 'Not saved. The server takes an alert of 3 to 60 characters, and "ai" is outside that.' })
    expect(saveOutcome({ ok: false, reason: 'something_new' }, 'margin', READ))
      .toEqual({ kind: 'refused', keywords: null, text: 'Not saved. The server refused "margin" and gave no reason this panel knows.' })
  })

  it('an answer that is not this route\'s is unreadable, never "saved"', () => {
    for (const res of [null, [], 'ok', {}, { ok: true }, { ok: 'true', keywords: [] }, { keywords: ['margin'] }]) {
      const out = saveOutcome(res, 'margin', READ)
      expect(out.kind, JSON.stringify(res)).toBe('unreadable')
      expect(out.keywords).toBeNull()
      expect(out.text).toContain('cannot say whether "margin" was saved')
    }
  })
})

describe('call alerts: the answer to a removal', () => {
  it('removed, already gone, still there, unreadable', () => {
    expect(removeOutcome({ ok: true, keywords: ['buyback'] }, 'tariff')).toEqual({ kind: 'removed', keywords: ['buyback'], text: 'Removed the call alert: tariff.' })
    expect(removeOutcome({ ok: false, keywords: ['buyback'] }, 'tariff')).toEqual({ kind: 'gone', keywords: ['buyback'], text: 'The call alert was already gone: tariff.' })
    expect(removeOutcome({ ok: false, keywords: ['buyback', 'tariff'] }, 'tariff'))
      .toEqual({ kind: 'refused', keywords: ['buyback', 'tariff'], text: 'The server did not remove the call alert: tariff. It is still saved.' })
    for (const res of [null, {}, { ok: true }, { keywords: [] }]) expect(removeOutcome(res, 'tariff').kind, JSON.stringify(res)).toBe('unreadable')
  })
})

describe('call alerts: a write with no usable answer', () => {
  it('signed out, no paid plan, a server error, a timeout and no network are different sentences', () => {
    expect(writeFailureText(fail(401), 'save', 'margin')).toBe('You are signed out, so "margin" was not saved. Sign in again.')
    expect(writeFailureText(fail(402), 'remove', 'margin')).toBe('Call alerts need a paid plan, so "margin" was not removed.')
    expect(writeFailureText(fail(500), 'save', 'margin')).toBe('The call alert could not be saved just now: margin. Nothing changed. Try again.')
    expect(writeFailureText(fail(500), 'remove', 'margin')).toBe('The call alert could not be removed just now: margin. It is still saved. Try again.')
    // with no status the request may have landed: the sentence does not claim either way
    const timeout = writeFailureText(Object.assign(new Error('t'), { timedOut: true }), 'save', 'margin')
    expect(timeout).toContain('did not answer within 30 seconds')
    expect(timeout).toContain('cannot say whether "margin" was saved')
    const offline = writeFailureText(new TypeError('Failed to fetch'), 'remove', 'margin')
    expect(offline).toContain('The server could not be reached')
    expect(offline).toContain('cannot say whether "margin" was removed')
    expect(offline).not.toContain('It is still saved')
  })
})

describe('call alerts: how a member is told', () => {
  it('the count, and the line beside the control', () => {
    expect(countSentence(READ)).toBe('2 of 25 call alerts saved.')
    expect(countSentence(alertsRead(null))).toBe('')
    expect(HOW_TOLD).toBe('A match rings the alert bell and sends an email, after the 6:30 PM ET check on weekdays.')
    expect(HOW_PAUSED).toContain('switched off')
  })

  it('the small print says what a check does, and what it does not catch', () => {
    const notes = alertNotes(READ).join(' ')
    expect(notes).toContain('6:30 PM ET, Monday to Friday')
    expect(notes).toContain('rings the alert bell and sends one email to the address on your account, once per call')
    expect(notes).toContain('at most the 200 best matches per check')
    expect(notes).toContain('more than one business day after its call is missed')
    // nothing the server does not do
    expect(notes).not.toMatch(/discord|text message|push|instant|right away|every call that/i)
    expect(notes).not.toMatch(/[—–]/)
  })

  it('switched off says so and promises nothing; an unread list says nothing', () => {
    const paused = alertNotes(alertsRead({ ...LIST, enabled: false }))
    expect(paused).toEqual(['Call alerts are switched off on the server right now: saved searches are kept, but no check runs and nothing is sent.'])
    expect(alertNotes(alertsRead({ keywords: [], max: 0, min_length: 0, enabled: false }))).toEqual([])
    expect(alertNotes(null)).toEqual([])
  })
})
