// UNEWS, the pure half. Rails:
//   * the model is pure (no React) and does not fork the /charts widget's model: the category
//     list and the day arithmetic are the widget's own objects, imported;
//   * a switched-off wire is ONE sentence with no Retry; signed out and a failed read differ;
//   * the connection is said in words, and an earlier day never claims to be live;
//   * a row's time is UCT's receipt time: full stamp where days mix, never an invented one;
//   * a headline is cut into pieces without rewriting a letter of it;
//   * new headlines are held by sequence number; loading earlier rows is never counted as new;
//   * the one-stock view's "how far back" sentence, in each state the server can answer;
//   * day stepping is bounded by the archive's first day and by today.
// Every headline here is invented.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as widgetModel from '../../charts/widgets/tradeExchangeNewsModel'
import {
  FILTER_MAX, UCT_NEWS_CODE, UCT_NEWS_NAME, UCT_NEWS_SOURCE, canStep, cleanFilter, cleanTypes, connectionWords, emptyWords,
  feedOff, heldLabel, matchingSentence, newsView, offState, reachSentence, rowPieces, rowTime, splitHeld, toggleType, topSeq,
} from './uctNewsModel'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, 'uctNewsModel.js'), 'utf8')
// 2026-07-06 16:00:00 UTC = 12:00:00 PM in New York (EDT), a Monday.
const NOON = Date.UTC(2026, 6, 6, 16, 0, 0)

describe('UNEWS model: what it is', () => {
  it('is pure and reuses the widget model instead of copying it', () => {
    expect(SRC).not.toMatch(/from 'react'/)
    expect(SRC).toMatch(/from '\.\.\/\.\.\/charts\/widgets\/tradeExchangeNewsModel'/)
    expect(SRC).not.toMatch(/export function tokenize|export function visibleItems|export const CATEGORY_FILTERS/)
    expect(UCT_NEWS_CODE).toBe('UNEWS')
    expect(UCT_NEWS_NAME).toBe('UCT News')
    expect(UCT_NEWS_SOURCE).toBe('UCT News (powered by Trade Exchange)')
  })

  it('names the view from the symbol it is given', () => {
    expect(newsView(null)).toEqual({ mode: 'market', sym: null })
    expect(newsView('  ')).toEqual({ mode: 'market', sym: null })
    expect(newsView(' zzqa ')).toEqual({ mode: 'stock', sym: 'ZZQA' })
  })
})

describe('UNEWS model: filters', () => {
  it('a chip adds or removes one type, in the widget order, and every type is the same as none', () => {
    expect(toggleType([], 'Macro')).toEqual(['Macro'])
    expect(toggleType(['Macro'], 'News')).toEqual(['News', 'Macro'])
    expect(toggleType(['News', 'Macro'], 'Macro')).toEqual(['News'])
    expect(toggleType(widgetModel.CATEGORY_FILTERS.slice(1), widgetModel.CATEGORY_FILTERS[0])).toEqual([])
    expect(toggleType(['not a type'], 'Macro')).toEqual(['Macro'])
    expect(cleanTypes(['Macro', 'bogus'])).toEqual(['Macro'])
  })

  it('the text filter is trimmed and cut at what the server reads', () => {
    expect(cleanFilter('  rate cut  ')).toBe('rate cut')
    expect(cleanFilter(null)).toBe('')
    expect(cleanFilter('x'.repeat(200))).toHaveLength(FILTER_MAX)
    expect(FILTER_MAX).toBe(80)
  })
})

describe('UNEWS model: states in words', () => {
  it('a switched-off wire is one plain sentence with no Retry', () => {
    const off = offState('not_enabled')
    expect(off).toEqual({ kind: 'locked', title: 'The news wire is not switched on for this server.', retry: false })
    expect(off.title.match(/\./g)).toHaveLength(1)
  })

  it('signed out, a refused account and a failed read each say which', () => {
    expect(offState('signed_out')).toMatchObject({ kind: 'locked', retry: false })
    expect(offState('signed_out').title).toContain('signed out')
    expect(offState('admin_only')).toMatchObject({ kind: 'locked', retry: false })
    expect(offState('error')).toEqual({ kind: 'error', title: 'UCT News could not be read just now.', retry: true })
    expect(offState(undefined).retry).toBe(true)
  })

  it('only a refusal counts as off: a reconnecting or failed stream still shows the archive', () => {
    expect(feedOff({ status: 'unavailable' })).toBe(true)
    for (const status of ['connecting', 'live', 'reconnecting', 'dropped', 'failed']) expect(feedOff({ status })).toBe(false)
    expect(feedOff(null)).toBe(false)
  })

  it('says the connection in words', () => {
    expect(connectionWords({ status: 'live' })).toEqual({ tone: 'live', words: 'Live. New headlines appear at the top as they arrive.' })
    expect(connectionWords({ status: 'connecting' })).toEqual({ tone: 'warn', words: 'Connecting to the news stream.' })
    expect(connectionWords({ status: 'failed' }).words).toContain('could not be opened')
    expect(connectionWords({ status: 'failed' }).tone).toBe('off')
    expect(connectionWords({ status: 'reconnecting', reason: 'not_started' }).words).toContain('starting on the server')
    expect(connectionWords({ status: 'reconnecting' }).words).toMatch(/^Reconnecting\./)
    expect(connectionWords({ status: 'dropped' }).tone).toBe('warn')
  })

  it('an earlier day never claims to be live, whatever the connection does', () => {
    const past = connectionWords({ status: 'live' }, { live: false, mode: 'market', dayText: 'Fri, Jul 3' })
    expect(past).toEqual({ tone: 'off', words: 'Showing Fri, Jul 3. New headlines are not added to an earlier day.' })
    // the one-stock view has no earlier day: it reports the connection
    expect(connectionWords({ status: 'live' }, { live: false, mode: 'stock' }).tone).toBe('live')
  })
})

describe('UNEWS model: a row', () => {
  it('shows the receipt time, with the date where days mix, and never invents one', () => {
    expect(rowTime(NOON, 'market')).toBe('12:00:00 PM ET')
    expect(rowTime(NOON, 'stock')).toBe('07/06/2026 12:00:00 PM ET')
    expect(rowTime(null, 'market')).toBe('time not recorded')
    expect(rowTime(0, 'stock')).toBe('time not recorded')
  })

  it('cuts a headline into ticker and text pieces without rewriting it', () => {
    const item = { content: 'INVENTED: $ZZQA lifts guidance as ZZQB trails', tickers: ['ZZQA', 'ZZQB'] }
    const pieces = rowPieces(item)
    expect(pieces.map((p) => p.text).join('')).toBe(item.content)
    expect(pieces.filter((p) => p.sym).map((p) => [p.text, p.sym])).toEqual([['$ZZQA', 'ZZQA'], ['ZZQB', 'ZZQB']])
    expect(new Set(pieces.map((p) => p.key)).size).toBe(pieces.length)
  })

  it('a company name the server resolved is a ticker piece that keeps its own words', () => {
    const pieces = rowPieces({ content: 'INVENTED: Zzqa Holdings names a chair', tickers: ['ZZQA'], mentions: [['Zzqa Holdings', 'ZZQA']] })
    expect(pieces.find((p) => p.sym)).toMatchObject({ text: 'Zzqa Holdings', sym: 'ZZQA' })
  })

  it('marks the letters a text filter matched, capitals kept', () => {
    const pieces = rowPieces({ content: 'INVENTED: Guidance raised, guidance held', tickers: [] }, 'guidance')
    expect(pieces.filter((p) => p.hit).map((p) => p.text)).toEqual(['Guidance', 'guidance'])
    expect(pieces.map((p) => p.text).join('')).toBe('INVENTED: Guidance raised, guidance held')
    expect(rowPieces({ content: 'INVENTED: nothing marked', tickers: [] }).some((p) => p.hit)).toBe(false)
  })

  it('a headline with no text is no pieces, not a crash', () => {
    expect(rowPieces({ content: '', tickers: ['ZZQA'] })).toEqual([])
    expect(rowPieces(null)).toEqual([])
  })
})

describe('UNEWS model: holding new headlines', () => {
  const rows = [{ seq: 9 }, { seq: 8 }, { seq: 7 }, { seq: 3 }]

  it('nothing is held at the top of the list', () => {
    expect(splitHeld(rows, null)).toEqual({ shown: rows, held: 0 })
    expect(splitHeld(null, null)).toEqual({ shown: [], held: 0 })
  })

  it('headlines newer than the held one are counted and kept off the list', () => {
    const out = splitHeld(rows, 7)
    expect(out.shown.map((r) => r.seq)).toEqual([7, 3])
    expect(out.held).toBe(2)
  })

  it('an earlier row loaded at the bottom is never counted as new', () => {
    const more = [...rows.filter((r) => r.seq <= 7), { seq: 2 }, { seq: 1 }]
    expect(splitHeld(more, 7)).toEqual({ shown: more, held: 0 })
  })

  it('finds the newest sequence number whatever the order', () => {
    expect(topSeq([{ seq: 3 }, { seq: 11 }, { seq: 7 }])).toBe(11)
    expect(topSeq([])).toBeNull()
    expect(topSeq(null)).toBeNull()
  })

  it('counts in words', () => {
    expect(heldLabel(1)).toBe('1 new headline')
    expect(heldLabel(4)).toBe('4 new headlines')
  })
})

describe('UNEWS model: how far back the one-stock view looked', () => {
  const meta = { first_day: '2026-06-29', first_day_partial: false }

  it('every archived day searched: names the day the archive began', () => {
    expect(reachSentence({ hasOlder: false, meta, todayKey: '2026-07-06' }))
      .toBe('Searched every day UCT News has kept, back to Mon, Jun 29, when its archive began.')
    expect(reachSentence({ hasOlder: false, meta: { ...meta, first_day_partial: true }, todayKey: '2026-07-06' }))
      .toBe('Searched every day UCT News has kept, back to Mon, Jun 29, when its archive began partway through the day.')
  })

  it('every archived day searched, before the calendar has answered: says so without a date', () => {
    expect(reachSentence({ hasOlder: false, meta: null })).toBe('Searched every day UCT News has kept, back to the start of its archive.')
  })

  it('part searched: names the oldest day searched in full and says the rest is not searched', () => {
    expect(reachSentence({ hasOlder: true, searchedTo: '2026-07-02', meta, todayKey: '2026-07-06' }))
      .toBe('Searched back to Thu, Jul 2 so far. Earlier days have not been searched yet.')
  })

  it('a first page that filled inside the newest day: names the time of the oldest headline on screen', () => {
    expect(reachSentence({ hasOlder: true, searchedTo: null, oldestMs: NOON, meta, todayKey: '2026-07-06' }))
      .toBe('Searched back to 12:00 PM ET on Mon, Jul 6 so far. Earlier headlines have not been searched yet.')
  })

  it('nothing searched in full and nothing on screen: never claims a reach', () => {
    const s = reachSentence({ hasOlder: true })
    expect(s).toBe('The search has not finished its first step yet. Earlier days have not been searched.')
    expect(s).not.toMatch(/Searched every|back to/)
  })

  it('says that matching is automatic and can be wrong, for one stock and for the wire', () => {
    expect(matchingSentence('ZZQA')).toMatch(/matched to ZZQA automatically/)
    expect(matchingSentence('ZZQA')).toMatch(/can be missed/)
    expect(matchingSentence(null)).toMatch(/picked out of each headline automatically/)
    expect(matchingSentence(null)).toMatch(/missed or matched by mistake/)
  })
})

describe('UNEWS model: day stepping and empty days', () => {
  const meta = { today: '2026-07-06', first_day: '2026-06-29', days: [{ date: '2026-06-29', count: 3 }, { date: '2026-07-06', count: 5 }] }

  it('a step stops at the first archived day and at today', () => {
    expect(canStep('2026-07-05', meta, '2026-07-06')).toBe(true)
    expect(canStep('2026-06-29', meta, '2026-07-06')).toBe(true)
    expect(canStep('2026-06-28', meta, '2026-07-06')).toBe(false)
    expect(canStep('2026-07-07', meta, '2026-07-06')).toBe(false)
    expect(canStep(null, meta, '2026-07-06')).toBe(false)
    // before the calendar answers, only today bounds it
    expect(canStep('2026-06-01', null, '2026-07-06')).toBe(true)
  })

  it('an empty day says which kind of empty it is', () => {
    const base = { mode: 'market', sym: null, todayKey: '2026-07-06', meta }
    expect(emptyWords({ ...base, filtered: false, isToday: true, dateKey: '2026-07-06' }).title).toBe('No headlines yet today.')
    expect(emptyWords({ ...base, filtered: true, isToday: true, dateKey: '2026-07-06' }))
      .toEqual({ title: 'No headline on Mon, Jul 6 matches the filters above.', hint: 'That is the filter, not a quiet wire.' })
    expect(emptyWords({ ...base, filtered: false, isToday: false, dateKey: '2026-07-04' }).title).toBe('No headlines were kept for Sat, Jul 4.')
    expect(emptyWords({ ...base, filtered: false, isToday: false, dateKey: '2026-06-20' }).title)
      .toBe('Sat, Jun 20 is before the UCT News archive begins.')
  })

  it('one stock: still searching, nothing at all, and nothing through the filters are three sentences', () => {
    const base = { mode: 'stock', sym: 'ZZQA', reach: 'REACH.' }
    expect(emptyWords({ ...base, filtered: false, searching: true }).title).toBe('No headline naming ZZQA found yet.')
    expect(emptyWords({ ...base, filtered: false, searching: false }).title).toBe('No archived headline names ZZQA.')
    expect(emptyWords({ ...base, filtered: true, searching: false }).title).toBe('No archived headline naming ZZQA matches the filters above.')
  })
})
