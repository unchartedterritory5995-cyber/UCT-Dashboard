// THE SETUPS IN PLAIN WORDS (2026-11-08, drafts for the owner: "This content here needs significant improvement and
// simplification" · "simpler to read and more direct as a teacher and mentor" · "easier to read while getting a really good
// message across"). Each is the bank's own definition (study_hard.setup_rule, the owner's rulings) cut to three short steps
// and one "not it" line: the same facts, no new ones. A lesson shows a plain version ONLY once the owner approves it
// (`approved: true`, set from his ruling in owner_verdicts.jsonl); until then the bank's words stay.
export const PLAIN_RULES = {
  'setup.family3.kicker': { approved: false, name: 'Kicker', steps: [
    'The stock is already set up: an uptrend or a clean base.',
    'One red day closes weak, near its low, with a real body (about 1-5% of price).',
    "The next day gaps up and closes strong, above the red day's high and near its own high, usually on big volume. The red day's sellers are trapped.",
  ], notIt: 'Not a Kicker: an earnings-day gap (an earnings gapper), a tiny red candle before a gap (a breakout), or a gap in a downtrend.' },
  'setup.family4.oops': { approved: false, name: 'Oops Reversal', steps: [
    "It opens below yesterday's close and trades under yesterday's low.",
    "Then it turns and closes above yesterday's close.",
    'Where it happens matters most: after an orderly drift lower, a flag, a wedge or a double bottom, on a quiet day, not a news gap.',
  ], notIt: "Stronger versions: a Williams Oops opens below yesterday's low; a Super Oops closes above yesterday's high. The Oops day's low must never break afterwards." },
  'setup.family4.slingshot': { approved: false, name: 'Slingshot', steps: [
    'A strong drive first, usually an earnings gap.',
    'Then a tight, orderly pullback: three to seven days, about 5-12% deep, closing under the 4-day average of the highs.',
    "The trigger: the first strong close back above that average, near the day's high. No gap needed.",
  ], notIt: 'Not the trigger: the gap day or the rally day itself.' },
  'setup.family1.launchpad': { approved: false, name: 'Launchpad', steps: [
    'After a real correction, the 8, 21 and 50-day averages bunch together near the 200-day.',
    'Price sits under and around that bundle for weeks, in a long flat base.',
    'The launch: the first close above every average and the 200-day, as they line up 8 over 21 over 50.',
  ], notIt: 'Not a Launchpad: a stock already riding above its averages that breaks out (that is a base breakout).' },
  'setup.family3.hve': { approved: false, name: 'High Volume Edge', steps: [
    'An up day on huge volume: about ten times normal and a new record, often a lesser-known name starting a new story.',
    "Mark that day's close on the chart: it is where the biggest buyers committed.",
    'Price can trade under it later; the level still matters.',
  ], notIt: 'Not an Edge: an ordinary high-volume close, an earnings gap on big but ordinary volume, or an options-expiry or month-end day.' },
  'setup.family3.gap_support': { approved: false, name: 'Gap Support', steps: [
    'A stock that is not in a downtrend gaps up at least 4% on twice its normal volume and holds the gap.',
    "Days or weeks later it pulls back to the gap day's low.",
    'Buyers defend that low. Best: the low holds and the gap stays open; a small dip that closes back above it is still good.',
  ], notIt: 'Not Gap Support: the gap day itself, or a gap that is never revisited.' },
  'setup.family3.bear_gap': { approved: false, name: 'Bear gap', steps: [
    'A stock makes a recent top.',
    'It gaps down for the first time since that top.',
    'Mark it on the gap day itself.',
  ], notIt: 'Not a Bear gap: a gap up that is later tested (that is Gap Support), or a gap inside a downtrend.' },
}

export const approvedPlainRule = (skillId) => (PLAIN_RULES[skillId]?.approved ? PLAIN_RULES[skillId] : null)
