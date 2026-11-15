/**
 * Spot the Mistake, the pure half (docs/study/GAMES.md §1 rule 6): the story split into its four numbered lines
 * (robust to spacing and to numbers inside a line, honest when it cannot find exactly four), the pool shaped from a
 * skill session (scenario items with the four Line choices, once each, no chart), the deal from a seed (the same seed,
 * the same run; easier entries first), the reveal read into the broken line, why, the lesson line and why each other
 * line was fine, the hearts and the end of a run, and the end screen's words. Every F12.07 story in the repo splits.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  EMPTY_LINE, MISTAKE_HEARTS, MISTAKE_TOTAL, choiceFor, deckOf, endNote, endTitle, fineOf, heartsLeft, heartsLine, keyLine,
  lessonLineOf, lineOf, mistakeOf, parseLines, questionsOf, rowOf, runOver, thinLine, truthOf, verdictOf, verdictTitle, whyOf,
} from './mistake'

const STORY = "1. Setup: a tight flag near the highs. 2. Risk: 1% of the account. 3. Entry: over yesterday's high. 4. Stop: none, I'll watch it and decide."
const LINES = ['Setup: a tight flag near the highs.', 'Risk: 1% of the account.', "Entry: over yesterday's high.", "Stop: none, I'll watch it and decide."]
const CHOICES = ['Line 1', 'Line 2', 'Line 3', 'Line 4']
const item = (id, story, extra = {}, prompt = {}) => ({
  id, version: 1, type: 'scenario', skill_id: 'process.mistakes', module: 'F12', difficulty: 2,
  prompt_json: { q: 'Which line breaks the plan?', kind: 'mcq', story, choices: CHOICES, ...prompt }, tier_scale_id: null, has_chart: false, ...extra,
})
const SET = (items) => ({ session_id: 'sess-9', kind: 'skill', day_et: null, items, answered_item_ids: [], finished_at: null })
const REVEAL = {
  unit: 'F12.07', why: "Line 4. A plan says where you get out with a loss before you get in. With no stop, the 1% in Line 2 can't be measured or held.",
  lesson_line: "No stop, no plan. Decide where you're wrong before you buy.", facts: {},
  depth: { summary: '', sources: [{ name: 'SEC, Investor.gov: Trading Basics (Investor Bulletin, 2024)', url: 'https://www.investor.gov/x', quote: 'q' }] },
  wrong: { 'Line 1': "Line 1 is fine. It names the setup you're trading.", 'Line 2': 'Line 2 is fine. Risking 1% is sound; a common guide is up to 1% to 2% a trade. It just needs a stop to mean anything.', 'Line 3': 'Line 3 is fine. A clear entry rule, set before you buy.' },
  answer: { answer: 'Line 4' }, lesson: 'Line 4. A plan says where you get out ... No stop, no plan.', ref: 'abc123',
}

describe('parseLines', () => {
  it('splits a numbered story into its four lines, whatever the spacing', () => {
    expect(parseLines(STORY)).toEqual(LINES)
    expect(parseLines('  1. Setup: a flag.   2.   Risk: 1%.\n3. Entry: over the high.\n\n4.\tStop: none.  ')).toEqual(['Setup: a flag.', 'Risk: 1%.', 'Entry: over the high.', 'Stop: none.'])
    expect(parseLines('1) Setup: a flag. 2) Risk: 1%. 3) Entry: over the high. 4) Stop: none.')).toEqual(['Setup: a flag.', 'Risk: 1%.', 'Entry: over the high.', 'Stop: none.'])
  })

  it('never reads a number inside a line as a marker', () => {
    const s = '1. Bad news hit after the close on a stock I own. 2. My reason for owning it was gone, so I chose to sell. 3. At 7:15 a.m. I sent a market order to sell, premarket. 4. Logged the news and my exit in my journal.'
    expect(parseLines(s)).toEqual(['Bad news hit after the close on a stock I own.', 'My reason for owning it was gone, so I chose to sell.', 'At 7:15 a.m. I sent a market order to sell, premarket.', 'Logged the news and my exit in my journal.'])
    const prices = '1. Bought at $41.50 on 3. 2. Stop at $39.25, 2.5% away. 3. Size: 1.5% risk, 400 shares. 4. Added 2 more lots at $40 as it fell.'
    expect(parseLines(prices)).toEqual(['Bought at $41.50 on 3.', 'Stop at $39.25, 2.5% away.', 'Size: 1.5% risk, 400 shares.', 'Added 2 more lots at $40 as it fell.'])
  })

  it('gives null unless exactly four lines with words are found, so the game falls back to the whole story', () => {
    expect(parseLines('')).toBeNull()
    expect(parseLines(null)).toBeNull()
    expect(parseLines('1. Setup: a flag. 2. Risk: 1%. 3. Entry: over the high.')).toBeNull()                       // three
    expect(parseLines('1. Setup: a flag. 2. Risk: 1%. 3. Entry: over the high. 4. Stop: none. 5. Size: 400.')).toBeNull()  // five
    expect(parseLines('My plan: 1. Setup: a flag. 2. Risk: 1%. 3. Entry: over the high. 4. Stop: none.')).toBeNull()      // words before 1.
    expect(parseLines('1. 2. 3. Entry: over the high. 4. Stop: none.')).toBeNull()                                  // empty lines
    expect(parseLines('1. Lost on trade 2. 2. Then sized up. 3. Stopped out. 4. Logged it.')).toBeNull()             // "trade 2." read as the marker: garbled
    expect(parseLines('A plan with no numbers at all, just a sentence.')).toBeNull()
  })

  it('splits every scenario story of the F12.07 unit in the repo into four lines', () => {
    const doc = JSON.parse(readFileSync(resolve(globalThis.process.cwd(), '..', 'docs/study/courses/F12/F12.07.json'), 'utf8'))
    const stories = doc.questions.filter((q) => q.format === 'scenario')
    expect(stories.length).toBeGreaterThanOrEqual(10)
    for (const q of stories) {
      const lines = parseLines(q.story)
      expect(lines, q.key).toHaveLength(4)
      expect(q.choices).toEqual(CHOICES)
      expect(lineOf(q.answer), q.key).toBeGreaterThan(0)
      expect(Object.keys(q.wrong).map(lineOf).sort(), q.key).toEqual([1, 2, 3, 4].filter((n) => n !== lineOf(q.answer)))
    }
  })
})

describe('lineOf and keyLine', () => {
  it('read a choice or a key as a line number', () => {
    expect(['Line 1', 'line 2', ' LINE 3 ', 'Line4'].map(lineOf)).toEqual([1, 2, 3, 4])
    expect(['Line 5', 'Line', '2', 'Line 2 is fine', null].map(lineOf)).toEqual([null, null, null, null, null])
    expect(['1', '4'].map(keyLine)).toEqual([1, 4])
    expect(['5', '0', 'a', 'Enter', ''].map(keyLine)).toEqual([null, null, null, null, null])
  })
})

describe('questionsOf', () => {
  it('keeps scenario entries with a story and the four Line choices, once each, with the session id', () => {
    const q1 = item('si_1', STORY)
    const q2 = item('si_2', '1. One. 2. Two. 3. Three. 4. Four.', { difficulty: 3 }, { choices: ['Line 4', 'Line 3', 'Line 2', 'Line 1'] })
    const rows = questionsOf(SET([
      q1,
      item('si_1', STORY),                                                                     // the same id twice
      item('si_1b', STORY),                                                                    // the same story twice
      item('si_3', 'No numbered lines here at all.', {}, { choices: ['Line 1', 'Line 2', 'Line 3', 'Line 4'] }),
      item('si_4', STORY, {}, { choices: ['Yes', 'No', 'Maybe', 'Never'] }),                  // not the four lines
      item('si_5', STORY, {}, { choices: ['Line 1', 'Line 2', 'Line 3'] }),                    // three choices
      item('si_6', STORY, {}, { choices: ['Line 1', 'Line 1', 'Line 3', 'Line 4'] }),          // a line twice
      item('si_7', STORY, { has_chart: true }),                                                // a chart under it
      item('si_8', STORY, {}, { kind: 'tf' }),
      item('si_9', '', {}, { story: undefined }),
      { id: 'si_w', type: 'walkthrough', prompt_json: { steps: ['a'], story: STORY, choices: CHOICES }, has_chart: false },
      null, 'junk', { id: 7, prompt_json: {} },
      q2,
    ]))
    expect(rows.map((r) => r.id)).toEqual(['si_1', 'si_3', 'si_2'])
    expect(rows[0]).toEqual({ id: 'si_1', sessionId: 'sess-9', q: 'Which line breaks the plan?', story: STORY, lines: LINES, choices: [null, 'Line 1', 'Line 2', 'Line 3', 'Line 4'], difficulty: 2, skill: 'process.mistakes' })
    expect(rows[1].lines).toBeNull()                                                         // the plain fallback
    expect(rows[2].choices).toEqual([null, 'Line 1', 'Line 2', 'Line 3', 'Line 4'])          // by line, whatever the order sent
    expect(rows[2].difficulty).toBe(3)
    expect(choiceFor(rows[2], 3)).toBe('Line 3')
    expect(choiceFor(null, 2)).toBe('Line 2')
  })

  it('reads our name, never "the firm", and no dashes, into the story and the question', () => {
    const [row] = questionsOf(SET([item('si_1', "1. The firm's rule: stop first. 2. Risk — 1%. 3. Entry: 40–42. 4. Stop: none.", {}, { q: "Which line breaks the firm's plan?" })]))
    expect(row.story).toBe("1. UCT's rule: stop first. 2. Risk, 1%. 3. Entry: 40-42. 4. Stop: none.")
    expect(row.lines).toEqual(["UCT's rule: stop first.", 'Risk, 1%.', 'Entry: 40-42.', 'Stop: none.'])
    expect(row.q).not.toMatch(/firm|[–—]/)
  })

  it('gives nothing for an empty, missing or malformed set', () => {
    expect(questionsOf(null)).toEqual([])
    expect(questionsOf({})).toEqual([])
    expect(questionsOf({ items: 'nope' })).toEqual([])
    expect(questionsOf({ session_id: '', items: [item('si_1', STORY)] })[0].sessionId).toBeNull()
  })
})

describe('deckOf', () => {
  const qs = [5, 1, 3, 2, 4, 6, 7, 8, 9, 10].map((n) => ({ id: `q${n}`, difficulty: n <= 3 ? 1 : n <= 7 ? 2 : 3 }))
  it('deals the same run for the same seed, easier entries first, at most the run length', () => {
    const a = deckOf(qs, 1731100000000)
    const b = deckOf(qs, 1731100000000)
    expect(a).toEqual(b)
    expect(a).toHaveLength(MISTAKE_TOTAL)
    expect(a.map((q) => q.difficulty)).toEqual([1, 1, 1, 2, 2, 2, 2, 3])
    const c = deckOf(qs, 1731100007777)
    expect(c.map((q) => q.difficulty)).toEqual([1, 1, 1, 2, 2, 2, 2, 3])
    expect(c.map((q) => q.id)).not.toEqual(a.map((q) => q.id))                                // another seed, another order
    expect(new Set(a.map((q) => q.id)).size).toBe(8)
    expect(deckOf(qs.slice(0, 3), 5)).toHaveLength(3)
    expect(deckOf([], 5)).toEqual([])
    expect(deckOf(null, 5)).toEqual([])
  })
})

describe('the reveal', () => {
  it('reads the verdict, the broken line, why, the lesson line and why each other line was fine', () => {
    expect(verdictOf({ correct: true })).toBe(true)
    expect(verdictOf({ correct: false })).toBe(false)
    expect(verdictOf({ correct: 'yes' })).toBeNull()
    expect(verdictOf({})).toBeNull()
    expect(verdictOf(null)).toBeNull()
    expect(truthOf(REVEAL, 4, true)).toBe(4)
    expect(truthOf(REVEAL, 2, false)).toBe(4)
    expect(truthOf({ answer: 'Line 3' }, 1, false)).toBe(3)
    expect(truthOf({ answer: { choice: 'line 2' } }, 1, false)).toBe(2)
    expect(truthOf({}, 1, false)).toBeNull()
    expect(truthOf(null, 1, false)).toBeNull()
    expect(whyOf(REVEAL)).toBe("A plan says where you get out with a loss before you get in. With no stop, the 1% in Line 2 can't be measured or held.")
    expect(whyOf({ lesson: 'Line 2: the firm sizes on the stop.' })).toBe('UCT sizes on the stop.')
    expect(whyOf({ why: 'no verdict opener here' })).toBe('No verdict opener here')
    expect(whyOf({})).toBe('')
    expect(lessonLineOf(REVEAL)).toBe("No stop, no plan. Decide where you're wrong before you buy.")
    expect(lessonLineOf({ why: 'Line 1. The reason stands alone.' })).toBe('The reason stands alone.')
    expect(fineOf(REVEAL, 4)).toEqual({
      1: "It names the setup you're trading.",
      2: 'Risking 1% is sound; a common guide is up to 1% to 2% a trade. It just needs a stop to mean anything.',
      3: 'A clear entry rule, set before you buy.',
    })
    expect(fineOf({ wrong: { 'Line 1': 'Line 1 is fine.', 'Line 3': 'Kept the rule.' } }, 2)).toEqual({ 1: 'Line 1 is fine.', 3: 'Kept the rule.', 4: '' })
    expect(fineOf({}, 1)).toEqual({ 2: '', 3: '', 4: '' })
    expect(fineOf(null, null)).toEqual({ 1: '', 2: '', 3: '', 4: '' })
  })

  it('keeps one entry as the run log does', () => {
    const qn = questionsOf(SET([item('si_1', STORY)]))[0]
    const miss = rowOf({ question: qn, said: 2, correct: false, reveal: REVEAL })
    expect(miss).toMatchObject({ id: 'si_1', q: 'Which line breaks the plan?', story: STORY, lines: LINES, said: 2, truth: 4, ok: false, unit: 'F12.07' })
    expect(miss.why).toMatch(/^A plan says where you get out/)
    expect(miss.line).toBe("No stop, no plan. Decide where you're wrong before you buy.")
    expect(miss.fine[2]).toMatch(/^Risking 1% is sound/)
    expect(miss.source).toEqual({ name: 'SEC, Investor.gov: Trading Basics', full: 'SEC, Investor.gov: Trading Basics (Investor Bulletin, 2024)', url: 'https://www.investor.gov/x' })
    expect(mistakeOf(miss)).toBe("Stop: none, I'll watch it and decide.")
    const hit = rowOf({ question: qn, said: 4, correct: true, reveal: REVEAL })
    expect(hit).toMatchObject({ said: 4, truth: 4, ok: true })
    expect(mistakeOf({ ...hit, lines: null })).toBe('Line 4')
    expect(mistakeOf(rowOf({ question: qn, said: 1, correct: false, reveal: {} }))).toBe('The line that broke the plan')
    expect(rowOf({ question: null, said: 1, correct: false, reveal: null })).toMatchObject({ id: '', q: '', story: '', lines: null, truth: null, why: '', line: '', source: null })
  })

  it('says the verdict first', () => {
    expect(verdictTitle(true, 4)).toBe('Spotted it.')
    expect(verdictTitle(false, 3)).toBe('It was line 3.')
    expect(verdictTitle(false, null)).toBe('Not that line.')
  })
})

describe('the hearts and the run', () => {
  it('counts the hearts and knows when the run is over', () => {
    expect(heartsLeft([])).toBe(MISTAKE_HEARTS)
    expect(heartsLeft([true, true])).toBe(3)
    expect(heartsLeft([true, false, true, false])).toBe(1)
    expect(heartsLeft([false, false, false, false])).toBe(0)
    expect(heartsLeft(null)).toBe(3)
    expect(runOver([], 8)).toBe(false)
    expect(runOver([true, false, true], 8)).toBe(false)
    expect(runOver([false, true, false, false], 8)).toBe(true)
    expect(runOver([true, true, true, true, true, true, true, true], 8)).toBe(true)
    expect(runOver([true, true, true], 3)).toBe(true)
    expect(heartsLine(3)).toBe('3 hearts left')
    expect(heartsLine(1)).toBe('1 heart left')
    expect(heartsLine(0)).toBe('Out of hearts')
  })

  it('names the end of a run', () => {
    expect(endTitle(0, 0)).toBe('No entries this run')
    expect(endTitle(3, 6, true)).toBe('Out of hearts')
    expect(endTitle(8, 8)).toBe('Every mistake spotted')
    expect(endTitle(5, 5)).toBe('Sharp eye')                      // a short deck, every entry right, is not a full run
    expect(endTitle(6, 8)).toBe('Sharp eye')
    expect(endTitle(4, 8)).toBe('Solid review')
    expect(endTitle(2, 8)).toBe('Tough review')
    expect(endNote([])).toBe('')
    expect(endNote([{ ok: true }, { ok: true }])).toMatch(/^No misses\./)
    expect(endNote([{ ok: true }, { ok: false }])).toBe('The miss below shows the line that broke the plan, and why.')
    expect(endNote([{ ok: false }, { ok: false }, { ok: true }])).toBe('Each of the 2 misses below shows the line that broke the plan, and why.')
    expect(EMPTY_LINE).toBe('No questions in this game yet. They arrive as the courses are approved.')
    expect(thinLine(1)).toBe('Only 1 entry is approved so far. The game opens at 3.')
    expect(thinLine(2)).toBe('Only 2 entries are approved so far. The game opens at 3.')
  })
})
