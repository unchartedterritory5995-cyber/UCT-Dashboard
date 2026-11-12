// The rails on the RS teaching content (Phase 4, unit 4-02).
//
// ⭐ THE EXPORT DIFF: the export is regenerated IN MEMORY from `teaching.js` (and
// the registered `rsLine` readout) and compared with the committed
// `api/data/rs_teaching.json`. Editing a glossary term, a tour card or a readout
// card without running `node tools/export_rs_teaching.mjs` turns this red, so
// Python can never read copy the web app no longer shows.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as defSchema from '../../components/chart/engine/defSchema.js'
import { RS_LINE_SLIM_RAW, RS_LINE_V5_RAW, rsSplitEnabled } from '../../components/chart/engine/nativeRegistry.js'
import {
  CARD_FIELDS, CARD_KEYS, CARDS, GLOSSARY, MISCONCEPTIONS, RS_DEF_ID, TAGLINE, TEACHING_VERSION, TOUR,
  buildTeachingExport, cardsFromReadout, rsTeachingReadout, serializeTeachingExport,
} from './teaching.js'

// U9: 15 terms of 04 §c + the three RS indicators the split added (teachingData.js).
const GLOSSARY_COUNT = 18

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXPORT_PATH = path.resolve(HERE, '..', '..', '..', '..', 'api', 'data', 'rs_teaching.json')

// TODO(4-03): the engine's tour limits are being added to `defSchema` in a
// parallel unit (`meta.tour`: title <= 60, body <= 240). Read them from there once
// they land; until then the plan's numbers stand in. The candidates below cover
// the likely export names, so the rail picks the constants up without an edit.
const TOUR_TITLE_MAX = defSchema.TOUR_TITLE_MAX ?? defSchema.TOUR_TITLE_MAX_CHARS ?? 60
const TOUR_BODY_MAX = defSchema.TOUR_BODY_MAX ?? defSchema.TOUR_BODY_MAX_CHARS ?? 240

/** Plan v4 §3: the banned list, plus "buy", "sell" and "guarantee". Whole words, any case. */
const BANNED = ['elite', 'powerful', 'unlock alpha', 'institutional accumulation', 'leading indicator',
  'crystal ball', 'buy', 'sell', 'guarantee']
/** The one allowed use: the honest negation 03-evidence §(b) defends ("a tendency, not a
 *  guarantee", on the Regime card). Saying it is NOT a guarantee is the opposite of promising one. */
const ALLOWED_NEGATIONS = [/\bnot a guarantee\b/gi]

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out))
  return out
}

function sentenceCount(text) {
  return (text.trim().match(/[.!?]+(?=["')\]]*(\s|$))/g) || []).length
}

const ALL_TEXT = strings(buildTeachingExport())

describe('rs teaching export', () => {
  it('the committed api/data/rs_teaching.json equals a fresh in-memory export', () => {
    const committed = readFileSync(EXPORT_PATH, 'utf8').replace(/\r\n/g, '\n')
    expect(committed, 'stale export: run node tools/export_rs_teaching.mjs').toBe(serializeTeachingExport())
  })

  it('serialisation is deterministic: keys sorted at every level, LF, one trailing newline', () => {
    const text = serializeTeachingExport()
    expect(serializeTeachingExport()).toBe(text)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.includes('\r')).toBe(false)
    const reordered = { tour: [{ body: 'b', title: 't' }], version: 1, cards: { z: { what: 'w' }, a: { what: 'v' } } }
    expect(serializeTeachingExport(reordered))
      .toBe(serializeTeachingExport({ cards: { a: { what: 'v' }, z: { what: 'w' } }, tour: [{ title: 't', body: 'b' }], version: 1 }))
    const top = Object.keys(JSON.parse(text))
    expect(top).toEqual(['cards', 'glossary', 'misconceptions', 'tour', 'version'])
  })

  it('has the shape {version, glossary, misconceptions, tour, cards}', () => {
    const obj = buildTeachingExport()
    expect(obj.version).toBe(TEACHING_VERSION)
    expect(obj.glossary).toHaveLength(GLOSSARY_COUNT)
    expect(obj.misconceptions).toHaveLength(8)
    expect(obj.tour).toHaveLength(5)
    expect(Object.keys(obj.cards)).toEqual([...CARD_KEYS])
  })
})

describe('glossary', () => {
  it('18 unique keys and terms, each with a definition and optional string aliases', () => {
    expect(new Set(GLOSSARY.map((t) => t.key)).size).toBe(GLOSSARY_COUNT)
    expect(new Set(GLOSSARY.map((t) => t.term.toLowerCase())).size).toBe(GLOSSARY_COUNT)
    for (const t of GLOSSARY) {
      expect(Object.keys(t).every((k) => ['key', 'term', 'definition', 'aliases'].includes(k)), t.key).toBe(true)
      expect(typeof t.term).toBe('string')
      expect(t.definition.length).toBeGreaterThan(20)
      if (t.aliases !== undefined) {
        expect(Array.isArray(t.aliases) && t.aliases.length > 0, t.key).toBe(true)
        t.aliases.forEach((a) => expect(typeof a).toBe('string'))
      }
    }
  })

  it('every definition is at most two sentences', () => {
    for (const t of GLOSSARY) {
      const n = sentenceCount(t.definition)
      expect(n, `${t.key}: "${t.definition}"`).toBeGreaterThanOrEqual(1)
      expect(n, `${t.key}: "${t.definition}"`).toBeLessThanOrEqual(2)
    }
  })

  it('the sentence counter itself counts (a three-sentence text reads 3)', () => {
    expect(sentenceCount('One. Two. Three.')).toBe(3)
    expect(sentenceCount('Read as "beat X% of the group". Then this.')).toBe(2)
  })

  it('the RS Rating carries the MEASURED Deepvue comparison (2026-11-12), not the 3 to 5 point MarketSurge figure', () => {
    const rating = GLOSSARY.find((t) => t.key === 'rsRating')
    // the measurement `tests/test_rs_parity_deepvue.py` rails, in plain words: the wide-universe
    // fit of 2026-11-12 (the 2026-11-08 record, "about 11 points lower against a liquid
    // universe", described the cap universe the rating no longer ranks against)
    expect(rating.definition).toContain('ranked against every stock we hold a recent price for, the way Deepvue\'s is')
    expect(rating.definition).toContain('across 61 of its readings at 1, 3, 6, 9 and 12 months')
    expect(rating.definition).toContain('ours sit about 3 points away on average with no lean either way')
    expect(rating.definition).not.toContain('liquid universe')
    expect(rating.definition).not.toContain('11 points')
    expect(rating.definition).toContain('it has not been measured against MarketSurge')
    expect(rating.definition).not.toContain('has not been measured yet')
    expect(ALL_TEXT.join('\n')).not.toMatch(/3\s*[–-]\s*5 points|±/)
  })
})

describe('misconceptions', () => {
  it('8 unique keys, each a myth and a truth', () => {
    expect(new Set(MISCONCEPTIONS.map((m) => m.key)).size).toBe(8)
    for (const m of MISCONCEPTIONS) {
      expect(Object.keys(m).sort()).toEqual(['key', 'myth', 'truth'])
      expect(m.myth.length).toBeGreaterThan(5)
      expect(m.truth.length).toBeGreaterThan(5)
    }
  })

  it('RSI appears only in the misconception that says it is a different thing', () => {
    const exp = buildTeachingExport()
    const rsiFree = [...strings(exp.glossary), ...strings(exp.tour), ...strings(exp.cards),
      ...strings(exp.misconceptions.filter((m) => m.key !== 'rsIsNotRsi'))]
    rsiFree.forEach((s) => expect(s, s).not.toMatch(/\bRSI\b/))
    const rsi = MISCONCEPTIONS.find((m) => m.key === 'rsIsNotRsi')
    expect(rsi.truth).toMatch(/^They are different things\./)
  })
})

describe('tour (D12)', () => {
  it('five cards, each {title, body} within the engine limits', () => {
    expect(TOUR).toHaveLength(5)
    for (const c of TOUR) {
      expect(Object.keys(c).sort()).toEqual(['body', 'title'])
      expect(c.title.length, c.title).toBeLessThanOrEqual(TOUR_TITLE_MAX)
      expect(c.body.length, c.body).toBeLessThanOrEqual(TOUR_BODY_MAX)
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.body.length).toBeGreaterThan(0)
    }
  })

  it('card 3 drops the 87 figure and reads as D12 wrote it', () => {
    expect(`${TOUR[2].title}. ${TOUR[2].body}`).toBe('Watch for RS new highs. When the line tops its old high before price does, the stock is leading before the chart shows it.')
    ALL_TEXT.forEach((s) => expect(s, s).not.toMatch(/\b87\b/))
  })

  it('card 4 is v4 §6.11 verbatim', () => {
    expect(`${TOUR[3].title}. ${TOUR[3].body}`).toBe('Strong on a weak day. Stocks that close green while the market sells off are showing demand you can see.')
  })

  it('the tagline appears exactly once in all the content: at the end of card 5', () => {
    expect(TAGLINE).toBe('Navigate the market, effectively.')
    const all = serializeTeachingExport()
    expect(all.split(TAGLINE).length - 1).toBe(1)
    expect(TOUR[4].body.endsWith(` ${TAGLINE}`)).toBe(true)
    expect(all.toLowerCase().split('navigate the market').length - 1).toBe(1)
  })
})

describe('readout cards (read from the definition, never retyped)', () => {
  const readout = rsTeachingReadout()

  it('CARD_KEYS are the readout rows that carry a card, in reading order', () => {
    expect(CARD_KEYS.length).toBeGreaterThan(0)
    expect([...CARD_KEYS]).toEqual(readout.filter((r) => r.card).map((r) => r.key))
  })

  // U9: the export does not depend on which `rsLine` the build registered. The suite runs
  // with the flag OFF (test-setup.js), where the registered definition is V5 with its eight
  // extra cards; the export still carries the slim RS Line's seven, so the committed JSON is
  // the same file under either flag and names no Reading the slim chart does not draw.
  it('reads the SLIM UCT RS Line readout whichever rsLine the build registered (U9)', () => {
    expect(rsSplitEnabled()).toBe(false)
    expect(readout).toBe(RS_LINE_SLIM_RAW.readout)
    expect(RS_LINE_SLIM_RAW.id).toBe(RS_DEF_ID)
    const v5Cards = RS_LINE_V5_RAW.readout.filter((r) => r.card).map((r) => r.key)
    expect(v5Cards).toEqual(expect.arrayContaining([...CARD_KEYS]))
    for (const gone of ['mansfield', 'rotation', 'quality', 'vars', 'sensitivity', 'regime', 'fastRating', 'ratingView']) {
      expect(v5Cards, `${gone} is a V5 card`).toContain(gone)
      expect(CARD_KEYS, `${gone} must not be exported`).not.toContain(gone)
    }
    const text = serializeTeachingExport()
    for (const word of ['Mansfield Relative Strength', 'Clenow', 'UCT fast', 'RS-Ratio', 'Regime', 'Agreement']) {
      expect(JSON.stringify(buildTeachingExport().cards), word).not.toContain(word)
    }
    expect(text).toContain('"checks"')
  })

  it('each card is {label, what, origin, evidence} straight from its row', () => {
    for (const row of readout.filter((r) => r.card)) {
      const card = CARDS[row.key]
      expect(Object.keys(card)).toEqual([...CARD_FIELDS])
      expect(card.label).toBe(row.label)
      expect(card.what).toBe(row.card.what ?? null)
      expect(card.origin).toBe(row.card.origin ?? null)
      expect(card.evidence).toBe(row.card.evidence ?? null)
      expect(typeof card.what).toBe('string')
    }
  })

  it('cardsFromReadout is generic and refuses a duplicate key', () => {
    expect(cardsFromReadout([{ key: 'a', label: 'A', card: { what: 'w' } }, { key: 'b', label: 'B' }]))
      .toEqual({ a: { label: 'A', what: 'w', origin: null, evidence: null } })
    expect(() => cardsFromReadout([{ key: 'a', card: {} }, { key: 'a', card: {} }])).toThrow(/twice/)
  })
})

describe('voice (plan v4 §3)', () => {
  it('no banned word anywhere in the content', () => {
    for (const s of ALL_TEXT) {
      let text = s
      ALLOWED_NEGATIONS.forEach((re) => { text = text.replace(re, '') })
      for (const word of BANNED) {
        const re = new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'i')
        expect(re.test(text), `banned "${word}" in: ${s}`).toBe(false)
      }
    }
  })

  it('the banned-word check catches what it should (control)', () => {
    const hit = (t) => BANNED.some((w) => new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'i').test(t))
    expect(hit('A Leading Indicator of strength')).toBe(true)
    expect(hit('Time to buy.')).toBe(true)
    expect(hit('Stocks that close green while the market sells off')).toBe(false)
  })

  it('no exclamation marks and no emoji anywhere', () => {
    const all = serializeTeachingExport()
    expect(all.includes('!')).toBe(false)
    expect(/\p{Extended_Pictographic}/u.test(all)).toBe(false)
    expect(/\p{Extended_Pictographic}/u.test('a ⭐ star')).toBe(true)
  })
})
