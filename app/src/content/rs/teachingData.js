// app/src/content/rs/teachingData.js
//
// THE RS TEACHING COPY, AS PLAIN DATA (Phase 4, unit 4-06 split it out of
// `teaching.js`, unit 4-02). The glossary, the misconceptions, the five tour cards
// and the tagline are authored HERE and nowhere else; `teaching.js` re-exports
// them unchanged, so every existing import keeps working and the export
// (`api/data/rs_teaching.json`) still comes from one source.
//
// ⛔ WHY A SEPARATE FILE: `teaching.js` reads the readout cards off the registered
// `rsLine` definition, so importing it pulls the whole chart engine into the
// bundle. The public glossary page (`pages/RsGlossary.jsx`) needs only these
// words, and a signed-out visitor should not download the chart engine to read
// them. ⛔ SO THIS FILE IMPORTS NOTHING. `teachingData.test.js` pins that, and
// pins the data equal to the committed export.
//
// Voice (plan v4 §3): declarative, present tense, no exclamation marks, no emoji,
// no "buy" or "sell", no "guarantee", none of the banned phrases. RS is the stock
// against the market. RSI is a different measure and appears only to say so.
//
// Evidence rule (D8): nothing tagged [S] or [U] in `03-evidence.md` is member copy.
// So the tour drops IBD's "87" (no published sample), the glossary drops the
// "3 to 5 points of MarketSurge" figure (v4 §18) and the clockwise-rotation claim,
// and "RS new high before price" carries IBD's own words, not a hit rate.

/** The tagline, unparaphrased. It appears exactly once: at the end of the last tour card. */
export const TAGLINE = 'Navigate the market, effectively.'

// ─── glossary: the 15 terms of 04 §c, in brand voice (v3 §18 wording, v4 §18 fix),
// plus the three RS indicators the split added (U9, 2026-11-09): 18 terms. ⛔ TRUE
// UNDER BOTH BUILD FLAGS: this file is static data (no `rsSplitEnabled()` here), so
// a term says what a thing IS and where UCT computes it (a screener column, the
// Terminal's rotation graph, an indicator's own pane), never which chart Reading
// shows it today. Mansfield, Rotation, Clenow, VARS, Agreement and Regime are no
// longer chart readings of UCT RS once the slim RS Line ships (map §(a) U7).
export const GLOSSARY = Object.freeze([
  { key: 'rsLine', term: 'RS line',
    definition: 'The stock\'s price divided by the benchmark\'s price, drawn as a line: up means the stock is beating the market, down means it is lagging. Only its direction and its own prior highs matter, not where it sits beside price.',
    aliases: ['relative strength line', 'price relative'] },
  { key: 'rsRating', term: 'RS Rating',
    // ⭐ MEASURED 2026-11-08 (design round; `tests/fixtures/indicators/rs_parity_deepvue.json`,
    // railed by `tests/test_rs_parity_deepvue.py`): 21 names, Spearman 1.00 against
    // Deepvue's 12M, mean |diff| 1.4 at 75 and above, ours 11.1 lower below 75.
    definition: 'A 1 to 99 rank of the stock\'s price change over roughly the past year against every other stock in the universe; 90 means it beat 90% of them. Ours is IBD-style and ranked against every stock we hold a recent price for, the way Deepvue\'s is: across 61 of its readings at 1, 3, 6, 9 and 12 months, ours sit about 3 points away on average with no lean either way; it has not been measured against MarketSurge.',
    aliases: ['relative strength rating', 'IBD-style rating'] },
  { key: 'rsNewHigh', term: 'RS new high',
    definition: 'The RS line closes higher than at any point in its lookback. The stock is outperforming the market by the most it has in that window.',
    aliases: ['RS line new high', 'blue dot'] },
  { key: 'rsNewHighBeforePrice', term: 'RS new high before price',
    definition: 'The RS line makes a new high while price is still below its own high. IBD calls it more bullish, and not a precondition.',
    aliases: ['RS high before price', 'gold dot'] },
  { key: 'benchmark', term: 'Benchmark',
    definition: 'What the stock is compared against: the S&P 500, the equal-weight S&P 500, the Nasdaq 100, the Russell 2000, or the stock\'s sector or industry group. Change it and the question changes.' },
  { key: 'mansfieldRs', term: 'Mansfield RS',
    // U9: where UCT computes it. The screener's Mansfield RS column (200 daily bars) is
    // the reading that stays once the slim RS Line ships; the sentence is true today too.
    definition: 'Weinstein\'s version: the RS ratio measured against its own long average (52 weeks on his weekly charts), so it swings around zero, and above zero and rising means the stock is outperforming its own trend against the benchmark. On UCT it is the screener\'s Mansfield RS column, read on 200 daily bars.',
    aliases: ['Mansfield relative strength'] },
  { key: 'rotationQuadrant', term: 'Rotation quadrant',
    // U9: where UCT computes it: the Terminal's rotation graph and the screener's weekly
    // Rotation Quadrant column, both UCT's RRG-style formula.
    definition: 'Leading (strong and gaining), Weakening (strong but fading), Lagging (weak and fading) or Improving (weak but gaining), read from the trend of the RS ratio and that trend\'s momentum on the Terminal\'s rotation graph and in the screener\'s weekly Rotation Quadrant column. A map, not a system.',
    aliases: ['RRG quadrant'] },
  { key: 'momentum', term: 'Momentum',
    definition: 'How fast a price, or an RS line, is moving. In academic research it is also the name for relative strength itself.' },
  { key: 'relativeWeakness', term: 'Relative weakness',
    definition: 'The stock is losing ground to the market, even while its price rises. On the chart, the RS line falls.' },
  { key: 'leaderLaggard', term: 'Leader and laggard',
    definition: 'A leader beats the market and its group; a laggard trails them.',
    aliases: ['leader', 'laggard', 'leadership'] },
  { key: 'defensiveRs', term: 'Defensive RS',
    definition: 'RS that rises only because the stock fell less than a falling market. It can fade when the market recovers.' },
  { key: 'lookback', term: 'Lookback',
    definition: 'The window used for a rating or a new high, such as 52 weeks or 3 months. A shorter window reacts faster and flips more often.' },
  { key: 'percentileRank', term: 'Percentile rank',
    definition: 'Where a value sits in its group, read as "beat X% of the group". An RS Rating of 80 beat 80% of the names rated.' },
  { key: 'divergence', term: 'Divergence',
    definition: 'Price and the RS line disagree. Price at a new high without the RS line is a warning; the RS line rising while price falls is hidden strength.' },
  { key: 'rotation', term: 'Rotation',
    definition: 'Money moving from one group of stocks to another. The RS lines of the new group turn up while the old group\'s turn down.',
    aliases: ['sector rotation'] },
  // ─── the three RS indicators the split added (U9): what each DRAWS, one or two
  // sentences from its `meta.description` and readout copy in `nativeRegistry.js`
  // (`RS_RATING_RAW`, `RS_PHASES_RAW`, `RS_VS_EMA_RAW`). The RS line itself is the
  // `rsLine` term above. Numbers: the rating average and guides (`rs_provider._RS_RATING_MA`,
  // the `ratingGuides` plot), the Phases smoothing (`relative_strength.DEFAULT_PHASES_*`)
  // and the 21 EMA with its 3 and 13 EMAs (`relative_strength.DEFAULT_VS_EMA_*`);
  // `RsGlossary.test.jsx` pins the glossary page's copies of them to the server.
  { key: 'uctRsRating', term: 'UCT RS Rating',
    definition: 'An indicator that draws the stock\'s RS Rating, 1 to 99, session by session on daily charts, with its 21-session average and guides at 80 and 90. The 1, 3, 6, 9 and 12-month ranks print in the corner of its pane.',
    aliases: ['RS Rating history', 'rating line'] },
  { key: 'uctRsPhases', term: 'UCT RS Phases',
    definition: 'An indicator that shades the bars where the RS line and the market pull apart: blue while RS rises as the market falls, red for the reverse, with a histogram of how unusual the split is for this stock. Both trends are a short average of the line against a longer one, 3 and 10 bars by default.',
    aliases: ['RS phases', 'RS divergence shading'] },
  { key: 'uctRsVsEma', term: 'UCT RS vs 21 EMA',
    definition: 'An indicator that draws how far the RS line sits above or below its 21 EMA, in percent, bar by bar, blue above and red below, with a 3 and a 13 EMA of that distance. It is the same number the RS line\'s readout prints as its distance from the average.',
    aliases: ['RS vs 21 EMA', 'Webby RS line'] },
].map((t) => Object.freeze(t)))

// ─── misconceptions: the 8 of 04 §e, each with its one-line correction ──────────
export const MISCONCEPTIONS = Object.freeze([
  { key: 'rsIsNotRsi', myth: 'RS is RSI.',
    truth: 'They are different things. RS compares a stock with the market and has no fixed bounds; RSI measures only the stock\'s own recent momentum on a 0 to 100 scale.' },
  { key: 'risingMeansUp', myth: 'A rising RS line means the price is going up.',
    truth: 'It means the stock is doing better than the market; both can be falling.' },
  { key: 'fallingMeansDown', myth: 'A falling RS line means the stock is going down.',
    truth: 'The stock can be rising while the market rises faster.' },
  { key: 'fellLessIsLeader', myth: 'RS rose while the market fell, so the stock is a leader.',
    truth: 'It may only have fallen less. Defensive names often give that back when growth returns.' },
  { key: 'rating99IsTiming', myth: 'An RS Rating of 99 means now is the time to get in.',
    truth: 'RS is a filter, not a timing signal; a 99 after a near-vertical run is often extended.' },
  { key: 'anyBenchmark', myth: 'Any benchmark will do.',
    truth: 'A small-cap read against the S&P 500, or a stock against the wrong sector, misleads. Say what you compare against.' },
  { key: 'rsExcusesChart', myth: 'Good RS excuses a bad chart.',
    truth: 'RS is one read, not the whole chart. A strong RS line does not repair a broken base, and a neat base with a falling RS line is a warning.' },
  { key: 'highRsLowRisk', myth: 'High RS means low risk.',
    truth: 'It means outperforming, not protected. In a falling market a leader can simply fall less.' },
].map((m) => Object.freeze(m)))

// ─── tour: five cards, shown on the first add of UCT RS (D12, v4 §6.11) ─────────
// Card 3 has no "87" (no published sample, v4 §1.7). Card 4 is v4 §6.11 verbatim,
// its forward claim removed. Card 5 ends with the tagline, once.
// ⭐ U9 (2026-11-09) re-read every card against the slim UCT RS Line: the line and
// its slope (cards 1, 2), the RS new high and the gold dot (card 3), the red-day
// dot (card 4, `showRedDay` stays a switch) and "where to look" (card 5) all ship
// under both build flags, and no card names a preset or a Reading. Unchanged.
export const TOUR = Object.freeze([
  { title: 'Beating the market, or just riding it?',
    body: 'RS compares your stock with the S&P 500. A stock can go up and still lose the race.' },
  { title: 'Read the slope, not the level',
    body: 'The RS line rises when the stock outperforms and falls when it lags. Where it sits beside price means nothing; it is not a moving average.' },
  { title: 'Watch for RS new highs',
    body: 'When the line tops its old high before price does, the stock is leading before the chart shows it.' },
  { title: 'Strong on a weak day',
    body: 'Stocks that close green while the market sells off are showing demand you can see.' },
  { title: 'RS says where to look, not when to act',
    body: `Combine it with a base, volume and your own stop. High RS after a long run can mean the stock is extended, not safe. ${TAGLINE}` },
].map((c) => Object.freeze(c)))
