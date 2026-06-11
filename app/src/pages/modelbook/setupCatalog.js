// Model Book → Setup Library catalog.
//
// One entry per playbook setup (names match SETUPS in constants/setupGroups.js,
// which stays the single source of truth for the taxonomy). Each entry adds the
// library-only presentation data:
//   direction — 'long' | 'short' | 'both'
//   essence   — one-line hook shown on the card (the detailed write-up that the
//               firm authors lives in the detail view, added separately)
//   candles   — hand-drawn idealized mini-chart of the pattern. Each candle is
//               either a number (close-to-close % body move, auto wicks) or
//               [body%, upperWick%, lowerWick%] when the wick IS the story
//               (e.g. Wick Play, U&R). Rendered by <SetupGlyph/>.
//   pivot     — optional { idx, side: 'h'|'l' }: dashed trigger line drawn at
//               that candle's high/low, extended to the right edge.

export const SETUP_CATALOG = [
  // ── Swing ──────────────────────────────────────────────────────────────────
  {
    name: 'High Tight Flag (Powerplay)',
    category: 'Swing',
    direction: 'long',
    essence: 'A near-vertical pole that barely pulls back — a tight sideways flag, then a breakout to new highs.',
    candles: [3.5, 9, 12, 8, -1.5, 1, -1.2, 0.8, -0.6, 10],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'Classic Flag/Pullback',
    category: 'Swing',
    direction: 'long',
    essence: 'An orderly drift back after a strong leg up; buy the reclaim as momentum resumes.',
    candles: [6, 7.5, 5, -2, -1.8, -1.4, -1, 8],
    pivot: { idx: 2, side: 'h' },
  },
  {
    name: 'VCP',
    category: 'Swing',
    direction: 'long',
    essence: 'Volatility contraction — each pullback shallower than the last, coiling under resistance until supply dries up.',
    candles: [9, -6, 7.5, -4, 5, -2.5, 3, -1.2, 0.6, 6.5],
    pivot: { idx: 2, side: 'h' },
  },
  {
    name: 'Flat Base Breakout',
    category: 'Swing',
    direction: 'long',
    essence: 'Weeks of quiet, range-bound trade under a flat ceiling; the break through it starts the next leg.',
    candles: [1.2, -0.8, 0.9, -0.7, 0.6, -0.9, 1.0, -0.5, 0.7, 7],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'IPO Base',
    category: 'Swing',
    direction: 'long',
    essence: 'A new issue’s first consolidation — short, often shallow, and explosive when it resolves higher.',
    candles: [12, -3, -2, 1.5, -1.5, 1, -0.8, 0.6, 8],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'Parabolic Short',
    category: 'Swing',
    direction: 'short',
    essence: 'A vertical blow-off stretched far above any support — shorted as the curve cracks and gravity takes over.',
    candles: [2, 3, 4.5, 7, 10, 13, [-3, 4, 1], -11, -7],
    pivot: { idx: 6, side: 'l' },
  },
  {
    name: 'Parabolic Long',
    category: 'Swing',
    direction: 'long',
    essence: 'Riding the steepening curve of a runaway move — managed bar by bar as the angle goes vertical.',
    candles: [1, 1.5, 2, 3, 4, 5.5, 7.5, 10, 13],
  },
  {
    name: 'Wedge Pop',
    category: 'Swing',
    direction: 'long',
    essence: 'A tightening downward drift on fading volume that suddenly pops out the top of the wedge.',
    candles: [-1.8, -1.5, -1.2, -1, -0.7, -0.5, -0.3, 6.5, 3],
  },
  {
    name: 'Wedge Drop',
    category: 'Swing',
    direction: 'short',
    essence: 'A weak, narrowing upward drift into resistance that rolls over and breaks down.',
    candles: [1.8, 1.5, 1.2, 1, 0.7, 0.5, 0.3, -6.5, -3],
  },
  {
    name: 'Episodic Pivot',
    category: 'Swing',
    direction: 'long',
    essence: 'A game-changing catalyst gaps the stock out of obscurity — day one of a brand-new trend.',
    candles: [0.5, -0.6, 0.4, -0.4, 0.3, [14, 2, 0.5], 3.5, 2.5],
  },
  {
    name: '2B Reversal',
    category: 'Swing',
    direction: 'both',
    essence: 'Price breaks a prior extreme, fails to follow through, and snaps back — trapping the late entries.',
    candles: [-4, -3, -2.5, [-1.2, 0.5, 3.2], 4.5, 5],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'Kicker Candle',
    category: 'Swing',
    direction: 'long',
    essence: 'A violent open against the prior trend — sentiment flips in a single bar.',
    candles: [-2.5, -3, -2, -2.8, [9, 1.5, 0.3], 4],
  },
  {
    name: 'Power Earnings Gap',
    category: 'Swing',
    direction: 'long',
    essence: 'Blowout numbers gap the stock above its base on huge volume — institutions repricing in real time.',
    candles: [0.8, -0.6, 0.7, -0.5, 0.6, [11, 1, 0.4], 2.5, 3],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'News Gappers',
    category: 'Swing',
    direction: 'long',
    essence: 'A headline-driven gap that holds its range — traded off the first pullback and reclaim.',
    candles: [0.4, -0.5, 0.5, [9, 2, 0.6], -1.5, -1, 1.2, 5],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: '4B Setup (Stan Weinstein)',
    category: 'Swing',
    direction: 'long',
    essence: 'The stage-two entry — a long dormant base that finally breaks out above a rising 30-week line.',
    candles: [-1, 0.8, -0.7, 0.9, -0.6, 0.7, -0.8, 1, 6, 5],
    pivot: { idx: 1, side: 'h' },
  },
  {
    name: 'Failed H&S/Rounded Top',
    category: 'Swing',
    direction: 'long',
    essence: 'Everyone sees the topping pattern — when the breakdown never comes, the squeeze fuels the next leg up.',
    candles: [3, -2.5, 4.5, -4, 2.5, -2, 1.5, 7],
  },
  {
    name: 'Classic U&R',
    category: 'Swing',
    direction: 'long',
    essence: 'An undercut of a key prior low that immediately rallies back through it — a spring off trapped supply.',
    candles: [-2, -1.5, -2.5, [-1, 0.4, 3], 5, 3.5],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'Launchpad',
    category: 'Swing',
    direction: 'long',
    essence: 'Price compressed flat on top of rising moving averages — everything aligned, waiting for ignition.',
    candles: [2, -0.8, 1.2, -0.5, 0.8, -0.4, 0.6, -0.3, 8],
  },
  {
    name: 'Go Signal',
    category: 'Swing',
    direction: 'long',
    essence: 'The first powerful thrust off a controlled pullback — the trend announcing it’s back in gear.',
    candles: [5, 4, -2, -1.5, -1, [6, 1, 0.3], 4],
  },
  {
    name: 'HVC',
    category: 'Swing',
    direction: 'long',
    essence: 'A massive-volume accumulation candle — its close becomes the level the stock must defend.',
    candles: [1, -0.8, 0.6, [9, 0.8, 0.5], -1, 0.8, -0.6, 5],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'Wick Play',
    category: 'Swing',
    direction: 'long',
    essence: 'After a huge candle with a long upper wick, price bases inside the wick — breaking its high resumes the move.',
    candles: [1, 1.5, [8, 5, 0.5], 0.6, -0.5, 0.4, -0.3, 6],
    pivot: { idx: 2, side: 'h' },
  },
  {
    name: 'Slingshot',
    category: 'Swing',
    direction: 'long',
    essence: 'A sharp flush through obvious support that instantly reverses — the failed breakdown becomes fuel.',
    candles: [1, -0.8, 0.7, -0.6, -3.5, [4.5, 0.6, 1.8], 5],
    pivot: { idx: 3, side: 'l' },
  },
  {
    name: 'Oops Reversal',
    category: 'Swing',
    direction: 'long',
    essence: 'A gap below the prior day’s low that reverses and closes the gap — the classic Larry Williams trap.',
    candles: [1.5, 1, -0.8, [-4, 3.2, 0.6], 4.5, 3],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'News Failure',
    category: 'Swing',
    direction: 'short',
    essence: 'Great news, no follow-through — when buyers can’t hold the gap, the fade becomes the trade.',
    candles: [0.6, 0.8, [10, 2.5, 0.4], -3, -4, -3.5, -2.5],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'Remount',
    category: 'Swing',
    direction: 'long',
    essence: 'A leader slips below its moving average, shakes out weak hands, then remounts it with authority.',
    candles: [3, 2.5, -2, -3, -1.5, 1, [5, 0.8, 0.4], 3.5],
  },
  {
    name: 'Red to Green',
    category: 'Swing',
    direction: 'long',
    essence: 'Opens deep red and grinds back through yesterday’s close — sellers exhausted, buyers in control.',
    candles: [-2, -2.5, -1.5, [6, 0.8, 2.8], 3, 2.5],
  },

  // ── Intraday ───────────────────────────────────────────────────────────────
  {
    name: 'Opening Range Breakout',
    category: 'Intraday',
    direction: 'long',
    essence: 'The first minutes set the range; the break above it puts the day’s trend on your side.',
    candles: [2.5, -1.8, 1.2, -0.8, 1, 6, 4],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'Opening Range Breakdown',
    category: 'Intraday',
    direction: 'short',
    essence: 'The low of the opening range gives way — momentum sellers press the breakdown.',
    candles: [-2.5, 1.8, -1.2, 0.8, -1, -6, -4],
    pivot: { idx: 0, side: 'l' },
  },
  {
    name: 'Red to Green (Intraday)',
    category: 'Intraday',
    direction: 'long',
    essence: 'An early flush that reclaims the prior close intraday — the day’s polarity flips long.',
    candles: [-2.5, -1.8, -0.8, [2, 0.5, 1.5], 3, 4.5],
  },
  {
    name: 'Green to Red',
    category: 'Intraday',
    direction: 'short',
    essence: 'An early pop that loses the prior close — longs trapped, momentum flips short.',
    candles: [2.5, 1.8, 0.8, [-2, 1.5, 0.5], -3, -4.5],
  },
  {
    name: '30min Pivot',
    category: 'Intraday',
    direction: 'long',
    essence: 'The first half-hour’s high becomes the trigger — consolidate under it, then break with volume.',
    candles: [3, -1, 0.5, -0.6, 0.4, -0.3, 5.5, 3],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'Mean Reversion L/S',
    category: 'Intraday',
    direction: 'both',
    essence: 'Price stretched far from its mean like a rubber band — fade the extreme, target the snap back.',
    candles: [-2.5, -3, -3.5, -4, [-1, 0.4, 2.5], 5, 3.5],
  },
]

export const SETUP_CATEGORIES = ['All', 'Swing', 'Intraday']

// Direction → display chip.
export const DIRECTION_META = {
  long: { label: 'LONG', cls: 'long' },
  short: { label: 'SHORT', cls: 'short' },
  both: { label: 'LONG / SHORT', cls: 'both' },
}
