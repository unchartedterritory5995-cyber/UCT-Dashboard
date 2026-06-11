// Model Book → Setup Library catalog.
//
// The firm's curated setup list (v1 — 24 swing setups, provided 2026-06-10; more
// may be added later). Most names line up with the labeling taxonomy in
// constants/setupGroups.js (which feeds the Throughout the Years setup dropdown);
// a few use the library's fuller display name (e.g. 'U&R (Undercut & Rally)' vs
// the taxonomy's 'Classic U&R') — normalize when wiring examples to the DB.
//
// Each entry:
//   family    — field-guide grouping (one of SETUP_FAMILIES, drives pills/dividers)
//   direction — 'long' | 'short' | 'both'
//   essence   — one-line hook shown on the card (the detailed write-up the firm
//               authors lives in the detail view, added separately)
//   candles   — hand-drawn idealized mini-chart of the pattern. Each candle is
//               either a number (close-to-close % body move, auto wicks) or
//               [body%, upperWick%, lowerWick%] when the wick IS the story
//               (e.g. U&R, Slingshot). Rendered by <SetupGlyph/>.
//   pivot     — optional { idx, side: 'h'|'l' }: dashed trigger line drawn at
//               that candle's high/low, extended to the right edge.
//   ema       — optional EMA period: draws a smoothed moving-average curve under
//               the candles (for the setups defined by their relationship to it).

export const SETUP_FAMILIES = [
  'Bases & Breakouts',
  'Momentum & Trend',
  'Gaps & Catalysts',
  'Reversals & Reclaims',
  'Intraday',
]

// Short chip shown on cards (the full family name lives in the section divider).
export const FAMILY_CHIP = {
  'Bases & Breakouts': 'BASE',
  'Momentum & Trend': 'TREND',
  'Gaps & Catalysts': 'GAP',
  'Reversals & Reclaims': 'REVERSAL',
  'Intraday': 'INTRADAY',
}

export const SETUP_CATALOG = [
  // ── Bases & Breakouts ──────────────────────────────────────────────────────
  {
    name: 'High Tight Flag (Powerplay)',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: 'An extraordinary momentum move that refuses to give any back — a dead-tight flag near the highs, then breakout.',
    candles: [3.5, 9, 12, 8, -1.5, 1, -1.2, 0.8, -0.6, 10],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'Flat Top Breakout',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: '“1 tap, 2 tap, 3 tap, breakout” — repeated tests of a flat ceiling on rising lows until sellers there are exhausted.',
    candles: [[6, 0.3, 0.4], -4, [4.3, 0.3, 0.3], -2.6, [2.6, 0.4, 0.3], -1.3, [7, 0.5, 0.3]],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'VCP (Volatility Contraction Pattern)',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: 'Each pullback shallower than the last, coiling under resistance until supply dries up.',
    candles: [9, -6, 7.5, -4, 5, -2.5, 3, -1.2, 0.6, 6.5],
    pivot: { idx: 2, side: 'h' },
  },
  {
    name: 'IPO Base',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: 'A new issue’s first consolidation — short, often shallow, and explosive when it resolves higher.',
    candles: [12, -3, -2, 1.5, -1.5, 1, -0.8, 0.6, 8],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'Launchpad',
    family: 'Bases & Breakouts',
    direction: 'both',
    essence: 'Multiple moving averages converge into one tight bundle with price coiled across them — loaded to break hard either way.',
    candles: [1.5, -1.2, 1, -0.9, 0.7, -0.6, 0.4, -0.3, 7],
    ema: 5,
  },

  // ── Momentum & Trend ───────────────────────────────────────────────────────
  {
    name: '20 EMA Pullback',
    family: 'Momentum & Trend',
    direction: 'long',
    essence: 'A bullish trend pulls back to the rising 20 EMA; a candle holds it, and the remount of the 9 EMA is the buy.',
    candles: [3.5, 2.5, 3, -1.5, -1.8, -1.2, [1.2, 0.4, 1.8], 4.5, 3],
    ema: 4,
  },
  {
    name: 'EMA Crossback',
    family: 'Momentum & Trend',
    direction: 'both',
    essence: 'Kell’s re-entry: after an extension, price crosses back into the 9/20 EMAs and reclaims them — or rejects, for the short.',
    candles: [3, 2.5, -2.2, -2.8, -1, 0.8, [4.5, 0.6, 0.5], 3],
    ema: 4,
  },
  {
    name: 'Wedge Pop',
    family: 'Momentum & Trend',
    direction: 'long',
    essence: 'After the decline ends, price coils into a tightening wedge below the averages — the pop reclaims them and starts the up-cycle.',
    candles: [-1.8, -1.5, -1.2, -1, -0.7, -0.5, -0.3, 6.5, 3],
    ema: 5,
  },
  {
    name: 'Wedge Drop',
    family: 'Momentum & Trend',
    direction: 'short',
    essence: 'A weak, narrowing upward drift into resistance that rolls over and breaks down.',
    candles: [1.8, 1.5, 1.2, 1, 0.7, 0.5, 0.3, -6.5, -3],
  },

  // ── Gaps & Catalysts ───────────────────────────────────────────────────────
  {
    name: 'Episodic Pivot',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'A neglected stock gaps up powerfully on a major catalyst, on massive volume — day one of a sustained new trend.',
    candles: [0.5, -0.6, 0.4, -0.4, 0.3, [14, 2, 0.5], 3.5, 2.5],
  },
  {
    name: 'Delayed Episodic Pivot',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'The catalyst gap that digests sideways for days first — the delayed breakout is the entry the crowd misses.',
    candles: [0.5, -0.5, 0.4, [10, 1.5, 0.5], -1.2, 0.8, -0.6, 0.5, 7.5],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'News/Catalyst Gapper',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'A headline-driven gap that holds its range — traded off the first pullback and reclaim.',
    candles: [0.4, -0.5, 0.5, [9, 2, 0.6], -1.5, -1, 1.2, 5],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'Power Earnings Gap',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'Blowout numbers gap the stock above its base on huge volume — institutions repricing in real time.',
    candles: [0.8, -0.6, 0.7, -0.5, 0.6, [11, 1, 0.4], 2.5, 3],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'Gap Support',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'The first controlled pullback into a prior up-gap — a candle holds the gap zone, proving it as support; entry over its high.',
    candles: [0.6, -0.5, 0.5, [8, 1, 0.4], -2, -1.4, [1, 0.4, 1.8], 5],
    pivot: { idx: 3, side: 'l' },
  },
  {
    name: 'Kicker Candle',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'The prior day closes weak, looking broken — then a catalyst gaps it up to close above that day’s high, trapping shorts.',
    candles: [-2.5, -3, -2, -2.8, [9, 1.5, 0.3], 4],
  },
  {
    name: 'HVC (High Volume Close)',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'A surge on the highest volume in the lookback, closing strong — that day’s close becomes the pivot price must defend.',
    candles: [1, -0.8, 0.6, [9, 0.8, 0.5], -1, 0.8, -0.6, 5],
    pivot: { idx: 3, side: 'c' },
  },
  {
    name: 'Delayed Earnings Reaction',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'Strong earnings, but a muted first reaction — the real move arrives days later as institutions finish digesting the report.',
    candles: [0.5, -0.4, 0.4, [2.5, 1.5, 1], -0.6, 0.5, -0.4, 8, 3.5],
    pivot: { idx: 3, side: 'h' },
  },

  // ── Reversals & Reclaims ───────────────────────────────────────────────────
  {
    name: '2B Reversal',
    family: 'Reversals & Reclaims',
    direction: 'both',
    essence: 'Price breaks a prior extreme, fails to follow through, and snaps back — trapping the late entries.',
    candles: [-4, -3, -2.5, [-1.2, 0.5, 3.2], 4.5, 5],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'U&R (Undercut & Rally)',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'Price briefly undercuts a prominent prior low — stopping out weak holders, luring shorts — then reclaims it.',
    candles: [-2, -1.5, -2.5, [-1, 0.4, 3], 5, 3.5],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'Slingshot',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'A strong uptrend pulls back, stabilizes, then recaptures the 4-EMA of the highs — buy momentum resuming, not the low.',
    candles: [4, 3.5, 3, -2.5, -2, -1.2, 0.5, [5, 0.6, 0.4], 3],
    ema: 3,
  },
  {
    name: 'Oops Reversal',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'A gap below the prior day’s low that reverses and closes the gap — the classic Larry Williams trap for panicked sellers.',
    candles: [1.5, 1, -0.8, [-4, 3.2, 0.6], 4.5, 3],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'Remount',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'A leader slips below its moving average, shakes out weak hands, then remounts it with authority.',
    candles: [3, 2.5, -2, -3, -1.5, 1, [5, 0.8, 0.4], 3.5],
    ema: 4,
  },
  {
    name: 'Failed H&S / Rounded Top',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'Everyone sees the topping pattern — when the breakdown never comes, the squeeze fuels the next leg up.',
    candles: [3, -2.5, 4.5, -4, 2.5, -2, 1.5, 7],
  },
  {
    name: 'Parabolic Long',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'Riding the steepening curve of a runaway move — managed bar by bar as the angle goes vertical.',
    candles: [1, 1.5, 2, 3, 4, 5.5, 7.5, 10, 13],
  },
  {
    name: 'Parabolic Short',
    family: 'Reversals & Reclaims',
    direction: 'short',
    essence: 'A 3–5 day blow-off stretched miles above the averages — shorted as it cracks, targeting the snap back to the 9 EMA.',
    candles: [2, 3, 4.5, 7, 10, 13, [-3, 4, 1], -11, -7],
    pivot: { idx: 6, side: 'l' },
    ema: 5,
  },

  // ── Intraday ───────────────────────────────────────────────────────────────
  {
    name: 'ORB (Opening Range Break)',
    family: 'Intraday',
    direction: 'both',
    essence: 'The first candles define the opening range — breaking it with momentum puts the day’s trend behind the trade.',
    candles: [2.5, -1.8, 1.2, -0.8, 1, 6, 4],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: '30-Minute Pivot',
    family: 'Intraday',
    direction: 'long',
    essence: 'The first half-hour’s high becomes the trigger — consolidate under it, then break with volume.',
    candles: [3, -1, 0.5, -0.6, 0.4, -0.3, 5.5, 3],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'Go Signal',
    family: 'Intraday',
    direction: 'long',
    essence: 'A catalyst gap digests into the 9 EMA — then one wide candle engulfs the pullback and closes above the catalyst high.',
    candles: [0.5, [8, 1, 0.4], -1.5, -1.2, -1, [7.5, 0.6, 0.3], 3],
    ema: 4,
    pivot: { idx: 1, side: 'h' },
  },
]

export const SETUP_CATEGORIES = ['All', ...SETUP_FAMILIES]

// Direction → display chip.
export const DIRECTION_META = {
  long: { label: 'LONG', cls: 'long' },
  short: { label: 'SHORT', cls: 'short' },
  both: { label: 'LONG / SHORT', cls: 'both' },
}
