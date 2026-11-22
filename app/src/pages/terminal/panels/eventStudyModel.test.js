// EVST's pure half: the study's address, the spec from storage, the menu, the form checks and the words.
// Every value is invented (__fixtures__/eventStudyFixture.js) in the routes' real shapes.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SPEC, EVST_CODE, EVST_SERIES_URL, EVST_STORE_KEY, EVST_STUDY_PATH, MAX_HORIZONS, baselineRow, checkSpec, conditionText,
  countText, coverageText, episodeCell, episodesHeading, leadText, loadStoredSpec, noEpisodesText, normSpec, normWindows, pollFor,
  notesBesideCaveats, readMenu, readStudy, readySpec, returnText, saveStoredSpec, startSpec, studyUrl, switchKind, thresholdHint, valueText, windowRow,
} from './eventStudyModel'
import { menuAnswer, noEpisodesAnswer, studyAnswer, tooShortAnswer } from './__fixtures__/eventStudyFixture'

describe('EVST: the address of a study', () => {
  it('names the code and the two routes', () => {
    expect(EVST_CODE).toBe('EVST')
    expect(EVST_SERIES_URL).toBe('/api/research/event-study/series')
    expect(EVST_STUDY_PATH).toBe('/api/research/event-study')
  })

  it('carries only the kind\'s own fields, in a fixed order, so one spec is one key', () => {
    expect(studyUrl(DEFAULT_SPEC)).toBe('/api/research/event-study?kind=breadth&universe=nasdaq&metric=pct_above_50sma&op=below'
      + '&threshold=10&symbol=SPY&horizons=1mo%2C3mo%2C6mo&episodes=first&entry=event_close')
    const tech = { kind: 'technical', series: 'zzqa', indicator: 'rsi', period: '14', universe: 'us', op: 'cross_above', threshold: '30.0',
      symbol: 'zzqb', horizons: ['3mo', '1w'], episodes: 'all', entry: 'next_close' }
    expect(studyUrl(tech)).toBe('/api/research/event-study?kind=technical&series=ZZQA&indicator=rsi&period=14&op=cross_above'
      + '&threshold=30&symbol=ZZQB&horizons=1w%2C3mo&episodes=all&entry=next_close')
    const cot = { kind: 'cot', market: 'gc', group: 'large_spec', op: 'below', threshold: '0', symbol: 'GLD', horizons: ['1mo'] }
    expect(studyUrl(cot)).toContain('kind=cot&market=GC&group=large_spec&op=below&threshold=0&symbol=GLD&horizons=1mo')
    expect(studyUrl({ kind: 'econ' })).toBeNull()
  })
})

describe('EVST: the spec kept in the browser', () => {
  it('a stored spec is cleaned, an unknown one is not used, and the shell\'s ticker is the symbol measured', () => {
    expect(normSpec(null)).toBeNull()
    expect(normSpec({ kind: 'econ', symbol: 'SPY' })).toBeNull()
    const s = normSpec({ kind: 'breadth', universe: 'us', metric: 'pct_above_20sma', op: 'nonsense', threshold: 25, symbol: '$$',
      horizons: ['24mo', '1d', '1w', '2w', '1mo', 'x'], episodes: 'every', entry: 'open' })
    expect(s).toEqual({ kind: 'breadth', universe: 'us', metric: 'pct_above_20sma', op: 'below', threshold: '25', symbol: 'SPY',
      horizons: ['1d', '1w', '2w', '1mo'], episodes: 'first', entry: 'event_close' })
    expect(startSpec(null, null)).toEqual(normSpec(DEFAULT_SPEC))
    expect(startSpec(null, null).symbol).toBe('SPY')
    expect(startSpec(s, 'nvda').symbol).toBe('NVDA')
    expect(startSpec(s, null).metric).toBe('pct_above_20sma')
    expect(normWindows('3mo,1d,bogus,1d')).toEqual(['1d', '3mo'])
  })

  it('the browser copy round-trips; a broken value or a storage that throws is null, never an error', () => {
    const box = new Map()
    const storage = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v) }
    saveStoredSpec(normSpec(DEFAULT_SPEC), storage)
    expect(loadStoredSpec(storage)).toEqual(normSpec(DEFAULT_SPEC))
    box.set(EVST_STORE_KEY, '{not json')
    expect(loadStoredSpec(storage)).toBeNull()
    box.set(EVST_STORE_KEY, JSON.stringify({ kind: 'econ' }))
    expect(loadStoredSpec(storage)).toBeNull()
    const denied = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadStoredSpec(denied)).toBeNull()
    expect(() => saveStoredSpec(normSpec(DEFAULT_SPEC), denied)).not.toThrow()
    expect(loadStoredSpec(null)).toBeNull()
  })

  it('a category switch starts the series over and keeps the rest', () => {
    const t = switchKind(normSpec(DEFAULT_SPEC), 'technical')
    expect(t).toMatchObject({ kind: 'technical', series: 'SPY', indicator: 'rsi', period: '14', op: 'below', threshold: '10', symbol: 'SPY' })
    expect(t.universe).toBeUndefined()
    expect(switchKind(t, 'cot')).toMatchObject({ kind: 'cot', market: 'ES', group: 'large_spec', horizons: ['1mo', '3mo', '6mo'] })
    expect(switchKind(t, 'technical')).toBe(t)
  })
})

describe('EVST: the menu and the form checks', () => {
  const menu = readMenu(menuAnswer())

  it('reads the categories, options, windows and examples the server sends; anything else is a failed read', () => {
    expect(menu.state).toBe('ok')
    expect(menu.kinds.map((k) => k.value)).toEqual(['breadth', 'technical', 'cot'])
    expect(menu.kinds[2].label).toBe('Futures positioning (COT)')
    expect(menu.indicators.find((i) => i.value === 'rsi').period).toEqual({ min: 2, max: 200, def: 14 })
    expect(menu.indicators.find((i) => i.value === 'day_pct').period).toBeNull()
    expect(menu.windows).toEqual(['1d', '1w', '2w', '1mo', '3mo', '6mo', '12mo', '24mo'])
    expect(menu.maxWindows).toBe(MAX_HORIZONS)
    expect(menu.examples.map((e) => e.id)).toEqual(['nasdaq-washout', 'spy-3pct-drop', 'gold-specs-short'])
    expect(menu.examples[0].spec.horizons).toEqual(['1mo', '3mo', '6mo'])
    expect(menu.notOffered.map((x) => x.kind)).toEqual(['econ', 'fundamental', 'market_cap'])
    for (const bad of [null, [], { status: 'ok' }, { status: 'ok', categories: [{ kind: 'econ' }] }, { status: 'computing' }]) {
      expect(readMenu(bad).state).toBe('failed')
    }
  })

  it('says what a threshold means for the series picked', () => {
    expect(thresholdHint({ unit: 'percent', domain: 'pct_0_100' })).toBe('A share of stocks, from 0 to 100.')
    expect(thresholdHint({ unit: 'percent_change', domain: 'signed' })).toMatch(/-3 is a 3% fall/)
    expect(thresholdHint({ unit: 'count', domain: 'signed' })).toMatch(/above or below 0/)
    expect(thresholdHint(null)).toBe('A number.')
  })

  it('catches what the server would refuse before it is sent, each as a sentence', () => {
    expect(checkSpec(normSpec(DEFAULT_SPEC), menu)).toEqual({})
    expect(checkSpec({ ...normSpec(DEFAULT_SPEC), threshold: '150' }, menu)).toEqual({ threshold: 'This measure runs from 0 to 100.' })
    expect(checkSpec({ ...normSpec(DEFAULT_SPEC), threshold: 'ten' }, menu).threshold).toMatch(/as a number/)
    expect(checkSpec({ ...normSpec(DEFAULT_SPEC), threshold: '' }, menu).threshold).toMatch(/as a number/)
    expect(checkSpec({ ...normSpec(DEFAULT_SPEC), metric: 'new_52w_highs', threshold: '-1' }, menu)).toEqual({ threshold: 'This measure is 0 or more.' })
    expect(checkSpec({ ...normSpec(DEFAULT_SPEC), symbol: '' }, menu).symbol).toBe('Type a ticker, for example SPY.')
    expect(checkSpec({ ...normSpec(DEFAULT_SPEC), horizons: [] }, menu).horizons).toBe('Pick at least one window.')
    expect(checkSpec({ ...normSpec(DEFAULT_SPEC), horizons: ['1d', '1w', '2w', '1mo', '3mo'] }, menu).horizons).toBe('Pick at most 4 windows.')
    const tech = switchKind(normSpec(DEFAULT_SPEC), 'technical')
    expect(checkSpec({ ...tech, period: '1' }, menu)).toEqual({ period: 'A whole number from 2 to 200.' })
    expect(checkSpec({ ...tech, series: '' }, menu).series).toMatch(/whose indicator/)
    expect(checkSpec({ ...tech, indicator: 'day_pct', period: '', threshold: '-3' }, menu)).toEqual({})
  })

  it('an indicator with no period sends none, and an empty period box sends the default', () => {
    const tech = switchKind(normSpec(DEFAULT_SPEC), 'technical')
    expect(readySpec({ ...tech, indicator: 'day_pct', period: '14' }, menu).period).toBe('')
    expect(readySpec({ ...tech, period: '' }, menu).period).toBe('14')
  })
})

describe('EVST: the study answer in words', () => {
  const view = readStudy(studyAnswer())

  it('reads every state; an answer that is not the route\'s shape is a failed read', () => {
    expect(readStudy({ status: 'computing' }).state).toBe('computing')
    expect(readStudy({ status: 'busy', detail: 'Invented busy.' })).toEqual({ state: 'busy', detail: 'Invented busy.' })
    expect(readStudy({ status: 'unavailable', reason: 'no_price_history', detail: 'Invented.' }))
      .toEqual({ state: 'unavailable', reason: 'no_price_history', detail: 'Invented.' })
    for (const bad of [null, [], { status: 'ok' }, { status: 'ok', horizons: [] }]) expect(readStudy(bad).state).toBe('failed')
    expect(pollFor({ state: 'computing' })).toBe(2500)
    expect(pollFor({ state: 'busy' })).toBe(6000)
    expect(pollFor(view)).toBe(0)
  })

  it('the lead names the condition, the episodes and the span; the counting is said when a run counts once', () => {
    expect(view.state).toBe('ok')
    expect(conditionText(view)).toBe('NASDAQ · % of Stocks Above 50-Day MA below 10.0%')
    expect(leadText(view)).toBe('NASDAQ · % of Stocks Above 50-Day MA below 10.0%: 3 episodes between Jan 3, 2011 and Sep 30, 2024. '
      + "ZZQA afterwards, from the event session's close.")
    expect(countText(view)).toBe('The condition held on 9 sessions in 3 runs; each run counts once, on its first session.')
    expect(coverageText(view)).toBe('The condition series runs from Jan 3, 2011 to Sep 30, 2024; ZZQA closes from Jan 3, 2011 to Sep 30, 2024.')
  })

  it('each window: the episodes, the share up, the average and median, the worst and best, never a zero for a gap', () => {
    const [w1, w3] = view.horizons.map((h) => windowRow(view, h))
    expect(w1).toMatchObject({ kind: 'value', name: '1 month', episodes: '3 episodes', rate: '67%', upOf: '2 of 3',
      mean: '+1.5%', median: '+2.0%', worst: '-4.0%', best: '+6.5%', worstSign: 'down', bestSign: 'up', worstDate: '2018-02-08' })
    expect(w3).toMatchObject({ kind: 'value', open: 1 })
    expect(baselineRow(view, '1mo')).toEqual({ sessions: '5,000 sessions', rate: '58%', mean: '+0.8%', meanSign: 'up', median: '+1.0%', medianSign: 'up' })
    expect(baselineRow(view, '24mo')).toBeNull()
  })

  it('too little history for a window and no episodes are said in words', () => {
    const short = readStudy(tooShortAnswer())
    const row = windowRow(short, short.horizons[1])
    expect(row).toEqual({ kind: 'open', token: '24mo', name: '24 months', text: 'Too little history after the episodes for 24 months: 2 episodes are still open.' })
    const none = readStudy(noEpisodesAnswer())
    expect(noEpisodesText(none)).toBe('No episodes: NASDAQ · % of Stocks Above 50-Day MA was never below 1.0% between Jan 3, 2011 and Sep 30, 2024.')
    expect(windowRow(none, none.horizons[0])).toEqual({ kind: 'none', token: '1mo', name: '1 month', text: 'No episodes.' })
    const crossed = readStudy(noEpisodesAnswer({ op: 'cross_below' }))
    expect(noEpisodesText(crossed)).toMatch(/never crossed below 1\.0%/)
  })

  it('every episode newest first, each window\'s return, "open" before a window ends, "no close" without an exit close', () => {
    expect(view.events.map((e) => e.date)).toEqual(['2024-08-05', '2020-03-16', '2018-02-08'])
    expect(episodesHeading(view)).toBe('Every episode, newest first (3 episodes)')
    expect(episodeCell(view.events[0], '1mo')).toEqual({ kind: 'value', text: '+6.5%', sign: 'up', exit: '2024-09-05' })
    expect(episodeCell(view.events[0], '3mo')).toEqual({ kind: 'open', text: 'open', title: 'The window has not ended yet' })
    expect(episodeCell(view.events[1], '3mo').kind).toBe('missing')
    expect(episodesHeading({ ...view, truncated: true, events: view.events.slice(0, 2) })).toBe('The newest 2 of 3 episodes, newest first')
  })

  it('numbers through the shared formatters, in the series\' own unit', () => {
    expect(returnText(0.0123)).toBe('+1.2%')
    expect(returnText(-0.5)).toBe('-50.0%')
    expect(returnText(null)).toBe('n/a')
    expect(valueText(8.44, 'percent')).toBe('8.4%')
    expect(valueText(-3.21, 'percent_change')).toBe('-3.2%')
    expect(valueText(-12345, 'count')).toBe('-12,345')
    expect(valueText(28.14, 'index')).toBe('28.1')
    expect(valueText(-0.523, 'price_units')).toBe('-0.52')
    expect(valueText(null, 'percent')).toBe('n/a')
  })

  it('the method is the engine\'s own lines', () => {
    expect(view.method[0]).toMatch(/^Episodes: the first session of each run/)
    expect(view.method.some((m) => /split-adjusted, not dividend-adjusted/.test(m))).toBe(true)
  })
})

describe('EVST: each warning once', () => {
  it('a warning the engine gives twice (a caveat and a note) is shown once, as the caveat', () => {
    const view = readStudy(studyAnswer())
    expect(view.caveats).toEqual(['Small sample: fewer than 10 completed outcomes in at least one window.'])
    expect(view.notes).toEqual([])
    const kept = readStudy(studyAnswer({ caveats: [], notes: ['Invented note one.', 'Small sample: invented.'] }))
    expect(kept.notes).toEqual(['Invented note one.', 'Small sample: invented.'])
    expect(notesBesideCaveats(['3 event(s) began while an earlier window was open, so their outcomes overlap.', 'Kept.'],
      ['3 event(s) overlap an earlier window.'])).toEqual(['Kept.'])
  })
})
