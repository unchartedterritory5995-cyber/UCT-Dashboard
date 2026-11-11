// app/src/components/chart/engine/__tests__/readoutSchema.evidence.test.js
//
// ─── UCT Relative Strength · the evidence line reads the payload (unit 2b-09) ─
//
// Unit 2b-01 measures what the RS signals did next and publishes
// `rs/evidence.json`; unit 2b-03 pulls it and the provider writes ONE sentence
// per card into `payload.evidence.sentence.<key>` — the measured one when the
// signal clears the display floor, the honesty sentence otherwise. This unit is
// the copy: a card may declare `evidenceSource` (a `scalar:` path in the row
// grammar) and `cardEvidenceText` prints what the path holds, VERBATIM, or the
// static `card.evidence` when the envelope carries nothing there.
//
// Three things are pinned here:
//   1. THE VOCABULARY — `READOUT_CARD_FIELDS` admits `evidenceSource` and
//      `defSchema` (which delegates card-field NAMES to that list, and is not
//      edited by this unit) accepts it and still refuses an unknown field.
//   2. THE RESOLVER — `cardEvidenceText` resolves, falls back and never throws,
//      fail-closed like the rows: anything but a non-empty string at the path
//      leaves the static line standing.
//   3. THE REGISTERED COPY — `rsLine`'s cards: the five measured signals point
//      at `scalar:evidence.sentence.<key>` (the keys of
//      `rs_evidence_pull.CARD_SIGNALS`) and carry the honesty sentence as the
//      static line; the literature cards carry the defensible statements with
//      their sources (research base 03-evidence.md §b), each at most two
//      sentences, in operator voice, and none of the claims that list forbids.
//
// The provider side of the same contract is `tests/test_rs_columns_provider.py`,
// which parses `evidenceSource` out of this registry's source text and resolves
// every path against a real payload, with and without the artifact.
import { describe, it, expect } from 'vitest'
import { cardEvidenceText, parseReadoutSource, READOUT_CARD_FIELDS } from '../readoutSchema'
import { validateDefinition } from '../defSchema'
import { getDefinition } from '../nativeRegistry'

/** `rs_evidence_pull.HONESTY_SENTENCE`, verbatim (the Python rail pins the two equal). */
const HONESTY = 'No published hit rate exists for this signal and UCT has not measured one yet.'
/** The measured sentence as `rs_evidence_pull.sentence_for` builds it over the 2b-01 fixture. */
// The server's sentence (rs_evidence_pull.sentence_for): since owner decision N6
// (2026-11-07) the hit rate states its base, the next session's open.
const MEASURED = '1,284 RS new highs before price on 240 sessions, 2025-11-05 to 2026-11-04, daily bars: 58.3% beat SPY from the next session\'s open to the close 63 sessions later (about 3 months; median +2.1%), against 50.2% for all bars. Universe as held, survivorship not yet corrected.'
/** The keys of `rs_evidence_pull.CARD_SIGNALS`: the cards the v1 artifact measures. */
const SIGNAL_CARDS = ['rsHigh', 'beforePrice', 'redDay', 'phase', 'mansfield']
const EMOJI = /\p{Extended_Pictographic}/u
/** The must-not-claim list (03-evidence.md §b), as a rail over every evidence line. */
const FORBIDDEN = /\bpredicts?\b|leading indicator|\b(80|85|87|90)\b|validated threshold|win rate|\bguaranteed\b|institutional buying/i
const sentences = (s) => (String(s).match(/[.?!](?=\s|$)/g) || []).length

const RS = getDefinition('rsLine')
const cardOf = (key) => RS.readout.find((e) => e.key === key).card
const entry = (card) => ({ key: 'x', label: 'X', source: 'scalar:a.b', format: 'text', card })

describe('the vocabulary — `evidenceSource` is a card field the schema admits', () => {
  it('READOUT_CARD_FIELDS carries it as the fifth field', () => {
    expect(READOUT_CARD_FIELDS).toEqual(['what', 'origin', 'evidence', 'learn', 'evidenceSource'])
    expect(Object.isFrozen(READOUT_CARD_FIELDS)).toBe(true)
  })

  it('defSchema accepts a card with `evidenceSource` verbatim, and still refuses an unknown card field by name', () => {
    const base = { ...RS, readout: [{ key: 'rsHigh', label: 'RS high', source: 'scalar:lastRsHigh.barsAgo', format: 'barsAgo',
      card: { what: 'w', origin: 'o', evidence: HONESTY, evidenceSource: 'scalar:evidence.sentence.rsHigh' } }] }
    const ok = validateDefinition(base)
    expect(ok.ok, JSON.stringify(ok.errors)).toBe(true)
    expect(ok.def.readout[0].card.evidenceSource).toBe('scalar:evidence.sentence.rsHigh')
    const bad = validateDefinition({ ...base, readout: [{ ...base.readout[0], card: { what: 'w', origin: 'o', sauce: 'scalar:evidence.sentence.rsHigh' } }] })
    expect(bad.ok).toBe(false)
    const msg = bad.errors.join('\n')
    expect(msg).toMatch(/readout\[0\]\.card\.sauce[^\n]*unknown card field/)
    expect(msg, 'the refusal lists the admitted fields, evidenceSource among them').toMatch(/evidenceSource/)
  })

  it('defSchema refuses an evidenceSource that is not a scalar/payload path (a typo would read as "nothing measured" forever)', () => {
    const row = (src) => ({ ...RS, readout: [{ key: 'rsHigh', label: 'RS high', source: 'scalar:lastRsHigh.barsAgo', format: 'barsAgo',
      card: { what: 'w', origin: 'o', evidenceSource: src } }] })
    for (const bad of ['evidence.sentence.rsHigh', 'scalar:', 'input:benchmark', 42, '']) {
      const r = validateDefinition(row(bad))
      expect(r.ok, `accepted ${JSON.stringify(bad)}`).toBe(false)
      expect(r.errors.join('\n')).toMatch(/readout\[0\]\.card\.evidenceSource/)
    }
    for (const good of ['scalar:evidence.sentence.rsHigh', 'payload:evidence.sentence.rsHigh']) {
      const r = validateDefinition(row(good))
      expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    }
  })
})

describe('`cardEvidenceText` — the resolved sentence, else the static line, else nothing; never throws', () => {
  const payload = { evidence: { asof: '2026-11-04', horizon: 63, source: 'artifact',
    sentence: { beforePrice: MEASURED, rsHigh: HONESTY, redDay: '  padded  ', phase: '', mansfield: null },
    signals: { beforePrice: { n: 1284, hit_rate_pct: 58.3 } } } }

  it('prints the measured sentence VERBATIM when the path holds one, through either prefix', () => {
    const card = { what: 'w', origin: 'o', evidence: 'static line', evidenceSource: 'scalar:evidence.sentence.beforePrice' }
    expect(cardEvidenceText(entry(card), payload)).toBe(MEASURED)
    expect(cardEvidenceText(entry({ ...card, evidenceSource: 'payload:evidence.sentence.beforePrice' }), payload)).toBe(MEASURED)
    // the provider's no-artifact form is a sentence too: the honesty line, from the payload
    expect(cardEvidenceText(entry({ ...card, evidenceSource: 'scalar:evidence.sentence.rsHigh' }), payload)).toBe(HONESTY)
    // the surface joins the card onto the resolved row — the same object shape resolves
    expect(cardEvidenceText({ key: 'beforePrice', label: 'Before price', value: true, text: 'before price', muted: false, card }, payload)).toBe(MEASURED)
    // whitespace trimmed, the text otherwise untouched
    expect(cardEvidenceText(entry({ ...card, evidenceSource: 'scalar:evidence.sentence.redDay' }), payload)).toBe('padded')
  })

  it('⛔ fail closed: anything but a non-empty string at the path leaves the static line', () => {
    const card = { what: 'w', origin: 'o', evidence: 'static line' }
    const cases = {
      'no envelope': [{ ...card, evidenceSource: 'scalar:evidence.sentence.beforePrice' }, null],
      'an envelope with no evidence block': [{ ...card, evidenceSource: 'scalar:evidence.sentence.beforePrice' }, { benchmark: { resolved: 'SPY' } }],
      'a null at the path': [{ ...card, evidenceSource: 'scalar:evidence.sentence.mansfield' }, payload],
      'an empty string at the path': [{ ...card, evidenceSource: 'scalar:evidence.sentence.phase' }, payload],
      'a number at the path': [{ ...card, evidenceSource: 'scalar:evidence.signals.beforePrice.n' }, payload],
      'an object at the path': [{ ...card, evidenceSource: 'scalar:evidence.signals.beforePrice' }, payload],
      'a path off the payload': [{ ...card, evidenceSource: 'scalar:evidence.sentence.nope' }, payload],
      'a malformed source (no prefix)': [{ ...card, evidenceSource: 'evidence.sentence.beforePrice' }, payload],
      'a malformed source (empty path)': [{ ...card, evidenceSource: 'scalar:' }, payload],
      'an input: source — a card has no instance to read': [{ ...card, evidenceSource: 'input:benchmark' }, payload],
      'a non-string source': [{ ...card, evidenceSource: 7 }, payload],
      'a prototype key is not a scalar': [{ ...card, evidenceSource: 'scalar:constructor.name' }, {}],
      'scalars that are not a payload (array)': [{ ...card, evidenceSource: 'scalar:evidence.sentence.beforePrice' }, [payload]],
      'scalars that are not a payload (string)': [{ ...card, evidenceSource: 'scalar:evidence.sentence.beforePrice' }, 'junk'],
      'no evidenceSource at all': [card, payload],
    }
    for (const [name, [c, s]] of Object.entries(cases)) expect(cardEvidenceText(entry(c), s), name).toBe('static line')
  })

  it('null when neither resolves — never an empty string, never "undefined"', () => {
    expect(cardEvidenceText(entry({ what: 'w', origin: 'o' }), payload)).toBe(null)
    expect(cardEvidenceText(entry({ what: 'w', origin: 'o', evidence: '   ' }), null)).toBe(null)
    expect(cardEvidenceText(entry({ what: 'w', origin: 'o', evidence: 7, evidenceSource: 'scalar:evidence.sentence.phase' }), payload)).toBe(null)
    expect(cardEvidenceText(entry({ what: 'w', origin: 'o', evidenceSource: 'scalar:evidence.sentence.mansfield' }), payload)).toBe(null)
  })

  it('⛔ never throws on junk', () => {
    for (const junk of [null, undefined, 7, 'x', [], {}, { card: null }, { card: 'IBD' }, { card: [] }, { card: { evidenceSource: { toString() { throw new Error('boom') } } } }]) {
      expect(() => cardEvidenceText(junk, payload)).not.toThrow()
      expect(cardEvidenceText(junk, payload)).toBe(null)
    }
    const hostile = entry({ what: 'w', origin: 'o', evidence: 'static line', evidenceSource: 'scalar:evidence.sentence.beforePrice' })
    expect(() => cardEvidenceText(hostile, { get evidence() { throw new Error('boom') } })).not.toThrow()
  })
})

describe('the registered copy — UCT Relative Strength cards', () => {
  const cards = RS.readout.filter((e) => e.card).map((e) => [e.key, e.card])

  it('the five measured signals point at `scalar:evidence.sentence.<key>` — the keys of CARD_SIGNALS — and no other card does', () => {
    for (const key of SIGNAL_CARDS) {
      const card = cardOf(key)
      expect(card.evidenceSource, key).toBe(`scalar:evidence.sentence.${key}`)
      expect(parseReadoutSource(card.evidenceSource), key).toEqual({ kind: 'scalar', path: ['evidence', 'sentence', key] })
    }
    const sourced = cards.filter(([, c]) => c.evidenceSource !== undefined).map(([k]) => k)
    expect(sourced.sort()).toEqual([...SIGNAL_CARDS].sort())
    // the rating, checks and sensitivity cards have no signal in the v1 artifact
    for (const key of ['ratingSummary', 'checks', 'sensitivity', 'benchmarkName', 'regime']) expect(cardOf(key).evidenceSource).toBeUndefined()
  })

  it('their static line IS the honesty sentence (Bulkowski leads the before-price line, the honesty sentence closes it)', () => {
    for (const key of ['rsHigh', 'redDay', 'phase', 'mansfield']) expect(cardOf(key).evidence, key).toBe(HONESTY)
    const bp = cardOf('beforePrice').evidence
    expect(bp.startsWith('Bulkowski measured 15,763 chart patterns')).toBe(true)
    expect(bp.endsWith(' ' + HONESTY)).toBe(true)
    expect(bp).toContain('41% against 22%')
  })

  it('the literature statements sit on the cards they belong to, each naming its source', () => {
    expect(cardOf('ratingSummary').evidence).toMatch(/^The rating is a rank of past return, not a forecast\./)
    expect(cardOf('ratingSummary').evidence).toMatch(/Jegadeesh and Titman 1993; Asness, Frazzini, Israel and Moskowitz 2014/)
    expect(cardOf('ratingSummary').evidence).toMatch(/about 8% a year long-short and positive in roughly four years of five/)
    expect(cardOf('regime').evidence).toMatch(/^Relative strength is a tendency, not a guarantee/)
    expect(cardOf('regime').evidence).toMatch(/Daniel and Moskowitz 2016; Dorsey Wright 2016/)
    expect(cardOf('regime').evidence).toMatch(/2003 and 2009/)
    expect(cardOf('benchmarkName').evidence).toMatch(/^A rising RS line means the stock is beating this benchmark over the window/)
    expect(cardOf('benchmarkName').evidence).toMatch(/falls faster \(IBD\)/)
    expect(cardOf('sensitivity').evidence).toMatch(/^In 2023 and 2024, 78% of S&P 500 stocks underperformed the cap-weighted index \(Lyrical, 2024\)/)
    expect(cardOf('checks').evidence).toMatch(/No published hit rate exists for these checks and UCT has not measured them yet\.$/)
  })

  it('operator voice: every evidence line is at most two sentences, no emoji, and none of the forbidden claims', () => {
    expect(cards.length).toBeGreaterThanOrEqual(10)
    for (const [key, card] of cards) {
      if (card.evidence === undefined) continue
      expect(typeof card.evidence, key).toBe('string')
      expect(sentences(card.evidence), `${key}: "${card.evidence}"`).toBeLessThanOrEqual(2)
      expect(sentences(card.evidence), key).toBeGreaterThanOrEqual(1)
      expect(card.evidence, key).not.toMatch(EMOJI)
      expect(card.evidence, key).not.toMatch(FORBIDDEN)
      expect(card.evidence, key).not.toMatch(/!/)
    }
    expect(HONESTY).not.toMatch(FORBIDDEN)
  })

  it('the description says measured evidence reaches the cards once the nightly backtest reports', () => {
    expect(RS.meta.description).toMatch(/Once the nightly backtest reports, each card's evidence line carries our own measured number with its sample size and dates\.$/)
    expect(RS.meta.description).not.toMatch(EMOJI)
  })

  it('end to end on the registered cards: the payload sentence wins, the honesty form prints as the provider sends it, no envelope prints the static line', () => {
    const measured = { evidence: { sentence: Object.fromEntries(SIGNAL_CARDS.map((k) => [k, k === 'beforePrice' ? MEASURED : HONESTY])) } }
    const honest = { evidence: { source: 'none', sentence: Object.fromEntries(SIGNAL_CARDS.map((k) => [k, HONESTY])) } }
    // ⚰️ Moved 2026-11-07 (review finding #22): this pinned the Before-price card
    // printing the server sentence ALONE, which dropped its Bulkowski line on
    // every V2 envelope. The server sentence now replaces only the closing
    // honesty sentence, so Before price prints Bulkowski first; the other four
    // cards' static line is the honesty sentence alone and print as before.
    const lit = (key) => (key === 'beforePrice' ? cardOf('beforePrice').evidence.slice(0, -HONESTY.length) : '')
    for (const key of SIGNAL_CARDS) {
      const e = RS.readout.find((x) => x.key === key)
      expect(cardEvidenceText(e, measured), key).toBe(lit(key) + (key === 'beforePrice' ? MEASURED : HONESTY))
      expect(cardEvidenceText(e, honest), key).toBe(lit(key) + HONESTY)
      expect(cardEvidenceText(e, null), key).toBe(e.card.evidence)
      expect(cardEvidenceText(e, { benchmark: { resolved: 'SPY' } }), key).toBe(e.card.evidence)
    }
    // a literature card is untouched by any payload
    for (const key of ['ratingSummary', 'regime', 'benchmarkName', 'sensitivity', 'checks']) {
      const e = RS.readout.find((x) => x.key === key)
      expect(cardEvidenceText(e, measured), key).toBe(e.card.evidence)
    }
  })
})
