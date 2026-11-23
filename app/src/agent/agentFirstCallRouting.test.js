// FIRST-CALL ROUTING classes (2026-11-23, heldout-v2 exposed: 140/150 → 150/150 first call). Each block is a CLASS of
// phrasing the word router missed, held with general vocabulary — never the eval sets' own sentences:
//   A  a member's multi-word NAME is an entity, not vocabulary (its words never add their groups), and it is found with one
//      real-word typo, or a watchlist by its leading word after a container word
//   B  navigation verbs: every verb `breadth` hands to `settings` (app.open) is one `settings` takes
//   C  "what %" + above / below + a length is a breadth question (a symbol takes no closing word boundary)
//   D  ONE stock's 52-week / all-time / yearly high or low is the data group's (a universe or NEW highs are not)
//   E  KEEP the current view AND another one ("… but keep the 4h as well") is workspace's (a second chart / a tab)
//   F  a board thing (widget / panel / pane) is added to the board, not to a list; "a breadth widget" is a widget
//   G  a follow-up that names nothing itself is routed with the previous member message's groups (fallback fill, first)
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor } from './capabilities'
import { selectGroups } from './routing'
import { selectNl1, nl1GroupOf, NL1_LIMIT } from './nl1/selection'
import { previousMemberText } from './useAgent'

registerBuiltins()

const NAMES = { layouts: ['Swing Board', 'Momentum Week', 'Day Trading'], watchlists: ['Tech Leaders', 'Biotech Runners', 'Core'], screens: [] }
const sel = (t, names = NAMES) => selectGroups(t, { names })
const words = (t, names = NAMES) => { const s = sel(t, names); return s.matched ? s.selected : [] }

describe('A · member names are entities', () => {
  it('a multi-word name brings its group, and its words add nothing else', () => {
    // "momentum" alone is an indicators word; "leaders" a screener word: inside the member's own name they are neither
    expect(words('open momentum week')).toEqual(expect.arrayContaining(['layouts']))
    expect(words('open momentum week')).not.toContain('indicators')
    expect(words('add CRWD and NET to tech leaders')).toContain('lists')
    expect(words('add CRWD and NET to tech leaders')).not.toContain('screener')
    // the same words OUTSIDE a name still route as before
    expect(words('add a momentum indicator')).toContain('indicators')
    expect(words('show me the tech leaders screen')).toContain('screener')
  })
  it('one real-word typo in a longer word of a multi-word name still finds it', () => {
    for (const t of ['load momentum weak', 'open swing boad', 'switch to day tradin']) expect(words(t), t).toContain('layouts')
    expect(words('open momentum wake up')).not.toContain('layouts')          // two edits: not the name
    expect(words('open core')).not.toContain('layouts')                       // one-word names: exact only (unchanged)
  })
  it('a watchlist by its leading word right after a container word', () => {
    for (const t of ['throw SOFI in biotech', 'put XBI into my biotech', 'take MRNA off biotech']) expect(words(t), t).toContain('lists')
    expect(words('biotech is ripping today')).not.toContain('lists')         // no container word: not the list
  })
})

describe('B · navigation verbs', () => {
  for (const v of ['open', 'go to', 'take me to', 'pull up', 'bring up', 'navigate to', 'head to', 'jump to']) {
    it(`"${v} the breadth page" opens a page (settings), not a breadth reading`, () => {
      const w = words(`${v} the breadth page`, {})
      expect(w).toContain('settings')
      expect(w).not.toContain('breadth')
    })
  }
  it('a breadth question is still breadth', () => {
    expect(words('how is breadth looking', {})).toContain('breadth')
  })
})

describe('C · "what %" breadth questions', () => {
  for (const t of ['what % are over the 50 day', 'what% sit under the 200 sma', 'what % of the market is above the 10 dma'])
    it(t, () => expect(words(t, {})).toContain('breadth'))
})

describe('D · one stock\'s yearly high / low', () => {
  for (const t of ['where is the 52-week low for msft', 'tsla all time high?', 'whats the fifty two week high of nflx', 'amd year high'])
    it(t, () => expect(words(t, {})).toContain('data'))
  for (const t of ['stocks near their 52 week highs', 'how many new 52 week highs today', 'names making all time highs'])
    it(`not: ${t}`, () => expect(words(t, {})).not.toContain('data'))
})

describe('E · keep this view and add another', () => {
  for (const t of ['switch to the 4h but keep the hourly as well', 'show the monthly and keep the daily open too', 'weekly alongside the daily'])
    it(t, () => expect(words(t, {})).toContain('workspace'))
})

describe('F · board things are not list items', () => {
  for (const t of ['add a news panel to the board', 'put an options flow widget on the right', 'add a breadth widget here']) {
    it(t, () => {
      const w = words(t, {})
      expect(w).toContain('workspace')
      expect(w).not.toContain('lists')
      expect(w).not.toContain('breadth')
    })
  }
  it('symbols added to a list are still lists', () => {
    expect(words('add HOOD to my list', {})).toContain('lists')
    expect(words('put COIN into the momentum watchlist', {})).toContain('lists')
  })
})

describe('G · a follow-up that names nothing is routed with the previous message', () => {
  const full = () => manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const groupsOf = (s) => [...new Set(s.manifest.map(c => nl1GroupOf(c.name)))]
  it('an ordinal / pronoun follow-up keeps the previous request\'s group, within the limit', () => {
    for (const [prev, t, g] of [['which layouts have I saved', 'the second one', 'layouts'], ['add RIVN to tech leaders', 'never mind, pull it out', 'lists'],
      ['remove the AAPL chart widget', 'and the other one', 'workspace']]) {
      const s = selectNl1(full(), { text: t, names: NAMES, prevText: prev })
      expect(s.manifest.length).toBeLessThanOrEqual(NL1_LIMIT)
      expect(groupsOf(s), `${t} after ${prev}`).toContain(g)
      expect(s.carried).toContain(g)
    }
  })
  it('ignored when the message names something itself, or there is no previous message', () => {
    const own = selectNl1(full(), { text: 'add the 50 sma', names: NAMES, prevText: 'which layouts have I saved' })
    expect(own.carried).toEqual([])
    const none = selectNl1(full(), { text: 'the second one', names: NAMES })
    expect(none.carried).toEqual([])
    expect(selectNl1(full(), { text: 'the second one', names: NAMES, prevText: '' }).manifest).toEqual(none.manifest)
  })
  it('previousMemberText: the line before this one, while fresh', () => {
    const now = 1_000_000_000
    expect(previousMemberText([{ text: 'a', at: now }, { text: 'b', at: now }], 'b', now)).toBe('a')      // b already echoed
    expect(previousMemberText([{ text: 'a', at: now }], 'b', now)).toBe('a')                              // b not echoed
    expect(previousMemberText([{ text: 'a', at: now - 31 * 60 * 1000 }], 'b', now)).toBe('')              // stale
    expect(previousMemberText([], 'b', now)).toBe('')
  })
})
