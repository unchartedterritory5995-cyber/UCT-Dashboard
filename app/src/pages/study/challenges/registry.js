// The challenge and game list (docs/study/GAMES.md): what the Study home shows and which ?challenge= links open a sheet.
// Kept apart from ChallengeSheet so the home can list every game without loading any game's code.

// THE GAMES (docs/study/GAMES.md, 2026-11-09). Each game file exports its own GAME meta. The copy here lets the Study
// home list a game without loading its code (each body loads when its sheet opens), and ChallengeSheet.test.jsx fails
// the moment a copy here drifts from the file's own GAME. group 'chart' joins the Challenges deck, 'skill' the Skill games.
export const GAME_LIST = [
  { kind: 'daily', title: 'Daily Chart', sub: 'Three real charts a day, the same for every member. Name what fired on each, then share your score.', icon: 'calendar', plate: 'Daily', accent: 'amber', group: 'chart', load: () => import('./DailyChartGame') },
  { kind: 'story', title: 'Trade Story', sub: 'A real setup fires. Take the trade on its own plan, then make the calls as the chart plays out.', icon: 'compass', plate: 'Story', accent: 'green', group: 'chart', load: () => import('./TradeStoryGame') },
  { kind: 'history', title: 'History Detective', sub: 'Case files from real market falls. Read the chart and the clues, then solve each case. Three hearts.', icon: 'search', plate: 'Detective', accent: 'red', group: 'chart', load: () => import('./HistoryDetectiveGame') },
  { kind: 'watchlist', title: 'Weekend Watchlist', sub: 'A Sunday scan: eight real charts, tickers hidden. Flag the ones where one of our setups fired on the last candle.', icon: 'bookmark', plate: 'Watchlist', accent: 'gold', group: 'chart', load: () => import('./WatchlistGame') },
  { kind: 'size', title: 'Size It', sub: 'Sixty seconds. Size every trade from its stop, rounded down.', icon: 'scale', plate: 'Size', accent: 'gold', group: 'skill', load: () => import('./SizeItGame') },
  { kind: 'ticket', title: 'Order Ticket', sub: 'Eight trade situations. Fill the ticket: the side, the order type and the price.', icon: 'document', plate: 'Ticket', accent: 'green', group: 'skill', load: () => import('./OrderTicketGame') },
  { kind: 'payoff', title: 'Options Payoff', sub: 'Six positions, three hearts. Price each one at expiry.', icon: 'dollar', plate: 'Payoff', accent: 'gold', group: 'skill', load: () => import('./OptionsPayoffGame') },
  { kind: 'greeks', title: 'Greeks Lab', sub: 'One option, three sliders, five challenges. Watch delta, theta and vega move.', icon: 'sliders', plate: 'Greeks', accent: 'amber', group: 'skill', load: () => import('./GreeksLabGame') },
  { kind: 'tf', title: 'True or False', sub: 'Forty-five seconds of statements from every course. Call each one true or false.', icon: 'check', plate: 'True/False', accent: 'green', group: 'skill', load: () => import('./TrueFalseGame') },
  { kind: 'match', title: 'Word Match', sub: 'Three rounds of five. Pair each word with its meaning against the clock.', icon: 'link', plate: 'Match', accent: 'amber', group: 'skill', load: () => import('./WordMatchGame') },
  { kind: 'sectors', title: 'Sector Race', sub: 'Which group led? Sixty seconds on the track: every right answer runs a leg.', icon: 'flag', plate: 'Sectors', accent: 'amber', group: 'skill', load: () => import('./SectorRaceGame') },
  { kind: 'survive', title: 'Survive the Drawdown', sub: 'Five risk sizes, the same 50 trades. See which account survives.', icon: 'equity', plate: 'Survive', accent: 'red', group: 'skill', load: () => import('./SurviveGame') },
  { kind: 'earnings', title: 'Earnings Desk', sub: 'Real quarters against the estimates. Beat, miss or in line, the surprise in percent, then what the stock did next. Three hearts.', icon: 'earnings', plate: 'Desk', accent: 'gold', group: 'skill', load: () => import('./EarningsDeskGame') },
  { kind: 'mistake', title: 'Spot the Mistake', sub: 'A four-line trade plan or journal entry. One line breaks a rule. Tap it.', icon: 'journal', plate: 'Mistake', accent: 'red', group: 'skill', load: () => import('./SpotMistakeGame') },
]

/** A game's listing without its loader. */
function metaOf(game) {
  const meta = { ...game }
  delete meta.load
  return meta
}

export const CHALLENGES = [
  { kind: 'blitz', title: 'Blitz', sub: 'Sixty seconds, no hearts, a quick read on every chart.', icon: 'bolt' },
  { kind: 'boss', title: 'Boss', sub: 'Ten charts, one heart. Miss once and it ends.', icon: 'star' },
  // the owner, 2026-11-08: "SPOT THE KICKER SHOULD be SPOT THE SETUP" (every setup, not only the Kicker)
  { kind: 'spot', title: 'Spot the Setup', sub: 'A few gold candles look alike. One is the real setup.', icon: 'eye' },
  // round 19 (owner, batch 19): only the ticker is hidden; the member's own averages and volume stay on the chart
  { kind: 'hard', title: 'Hard mode', sub: 'No ticker, on your own chart. Name what fired on the last candle, or say nothing did.', icon: 'eyeOff' },
  // the owner's draw game, in the product (2026-11-08): place the entry and the stop, scored against the setup's own plan
  { kind: 'draw', title: 'Draw it', sub: 'Place the entry and the stop on a real setup. The plan shows where they go.', icon: 'play' },
  ...GAME_LIST.map(metaOf),
]
// 'kicker' stays a door: a saved ?challenge=kicker link opens Spot the Setup
export const ALIASES = { kicker: 'spot' }
export const CHALLENGE_KINDS = new Set([...CHALLENGES.map((c) => c.kind), ...Object.keys(ALIASES)])
