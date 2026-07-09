// Model Book → Setup Library: the firm's full playbook write-ups, keyed by the
// setup's catalog name (setupCatalog.js). Content comes from the user's playbook
// docs — do not paraphrase it away; keep the trading specifics intact.
//
// Shape:
//   intro     — the lede paragraph (what the setup IS)
//   sections  — ordered [{ label, body, accent? }]; accent ∈ 'entry'|'stop'|'exit'
//               colors the row's diamond + label (green / red / gold)
//   mistakes  — array of common-mistake strings, rendered as a warning card
//
// Setups without an entry here show the "being authored" placeholder.

export const SETUP_PLAYBOOKS = {
  'Bull Flag': {
    intro:
      'The Bull Flag is one of the most reliable continuation patterns in a trending stock. ' +
      'A strong, near-vertical advance forms the flagpole; price then pauses in a brief, ' +
      'orderly pullback or sideways drift — the flag — on contracting volume, before breaking ' +
      'out to resume the move in the direction of the prior trend.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Best taken in a confirmed market uptrend with the stock already in a clear uptrend ' +
          'of its own. A genuine theme or catalyst behind the flagpole adds conviction. The ' +
          'pattern is a continuation play, so the underlying trend must be intact.',
      },
      {
        label: 'Chart Criteria',
        body:
          'A sharp flagpole advance, then a shallow consolidation that drifts slightly lower or ' +
          'sideways — typically retracing only one-third to one-half of the pole. The flag is ' +
          'orderly and tight, with volume drying up through the pause; deeper, sloppier pullbacks ' +
          'are not flags. Price ideally holds above a rising short-term moving average.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Breakout above the upper boundary (downtrend line) of the flag, ideally on a pickup in ' +
          'volume. Aggressive variant: an early entry off support inside the flag — a U&R or a ' +
          '30-minute pivot near the base of the range as the consolidation resolves.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'Below the low of the flag. Keep the stop tight — a clean flag should not give much ' +
          'back; a break below the flag low invalidates the continuation thesis.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Measured move: project the height of the flagpole up from the breakout point for a ' +
          'first target. Trim into strength and trail the remainder beneath a rising short-term ' +
          'moving average to ride the continuation.',
      },
      {
        label: 'Position Sizing',
        body:
          'Standard fixed-dollar risk ÷ stop distance. Because the flag keeps the stop close to ' +
          'entry, position size can be meaningful while staying within risk tolerance; if the ' +
          'stop is too wide at a sensible share count, the trade is passed.',
      },
    ],
    mistakes: [
      'Buying the flagpole instead of waiting for the flag and breakout.',
      'Tolerating a loose or deep “flag” that is really just a normal pullback or trend break.',
      'Chasing well past the breakout instead of entering near the pivot.',
    ],
  },

  'Flat Base Breakout': {
    intro:
      'One of the most common and effective continuation patterns the community trades. ' +
      'The shorthand is “1 tap, 2 tap, 3 tap, breakout” — price repeatedly tests a flat ' +
      'horizontal resistance while carving higher lows, until the sellers stacked at that ' +
      'level are exhausted.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Strongest with timeframe alignment — a bullish daily/weekly structure underneath ' +
          'the intraday flat top. Used as a continuation entry in an uptrend.',
      },
      {
        label: 'Chart Criteria',
        body:
          'A clearly defined horizontal resistance level tested multiple times (the “taps”) ' +
          'with continuous higher lows into it. Moving averages should tighten to price and to ' +
          'the breakout level with each test — the third test should be the tightest. ' +
          'Critically, the breakout level should be the high of the day when it breaks.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Breakout above the flat-top resistance, taken as a high-of-day break.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'Below the breakout candle low and the 9-EMA — on a strong breakout candle these ' +
          'coincide and give a tight stop.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Scale out into strength against 30-minute and intraday support/resistance levels ' +
          'and on 2:1+; trail the stop up behind the nearest support.',
      },
    ],
    mistakes: [
      'Impatience — entering before the moving averages have tightened to the breakout level.',
      'Taking the breakout when it is not also a high-of-day break.',
    ],
  },

  'IPO Base': {
    intro:
      'A newly public stock’s first real consolidation. With no prior price history there is no ' +
      'overhead supply to fight, so the cleanest of these can launch the biggest moves of the ' +
      'cycle — but they are wilder and looser than a normal base, so the rules bend to fit a ' +
      'stock that is still finding its feet.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Confirmed market uptrend with a genuine appetite for new issues — IPO bases fail in ' +
          'hostile tape. The strongest come from a leading, story stock in a hot group: real ' +
          'revenue growth, a new product or theme, and visible institutional sponsorship as the ' +
          'base builds.',
      },
      {
        label: 'Chart Criteria',
        body:
          'The stock’s first base, typically within the first 3–12 months of trading; the ' +
          'earliest bases tend to be the most powerful. These run shorter (often just a few ' +
          'weeks) and deeper (25–50%) than a classic base — tolerate the extra width as long as ' +
          'the action tightens toward the highs and up-days carry the heavier volume. The pivot ' +
          'is the high of the range; price should hold well above the IPO price.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Breakout above the base high + a small buffer on expanding volume. Faster variant: a ' +
          'break of the prior day’s high while price rides the 10/20-day SMA out of the ' +
          'consolidation — or an early entry off a U&R of support near the base low.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'Below the breakout day’s low or the most recent tight area; on the faster variant, ' +
          'below the 10/20-day SMA. Because the full base can be wide, anchor the stop to the ' +
          'last tight contraction rather than the deep base low so risk stays within a few ' +
          'percent of entry.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Trim into a 20–25% gain; invoke the 8-week hold rule when the breakout runs 20%+ ' +
          'within three weeks — these first bases are often the year’s big winners. Trail the ' +
          '10/20-day SMA for the swing and the 50-day for the larger trend.',
      },
      {
        label: 'Position Sizing',
        body:
          'Standard fixed-dollar risk ÷ stop distance. IPO bases are volatile, so the sensible ' +
          'share count is smaller; if anchoring to a tight low still leaves the stop too wide ' +
          'for the account’s risk tolerance, size down or pass the trade.',
      },
    ],
    mistakes: [
      'Buying the first wild swings before any real base has formed.',
      'Widening the stop to survive the base’s depth and blowing the risk budget.',
      'Forcing IPO breakouts in a weak market where new issues fail.',
    ],
  },

  'Launchpad': {
    intro:
      'The consolidation that follows a bear market or correction, when multiple moving ' +
      'averages converge into a tight bundle and the stock is coiled to break out in either ' +
      'direction. The MA convergence is the tell — it frequently precedes a strong, ' +
      'directional move.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Best at the transition out of a bear phase or correction — the broader market should ' +
          'be in a basing pattern, with the stock in its own basing pattern in front of it.',
      },
      {
        label: 'Chart Criteria',
        body:
          'The 8-EMA, 21-EMA, 30-SMA and 50-SMA bunched closely together and stacked in order, ' +
          'with price consolidating across them. This tight MA convergence frequently precedes ' +
          'a strong directional breakout.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Break of the consolidation in the direction of the trend resumption. On the daily, a ' +
          'high-of-base / high-of-consolidation break; intraday, the bull-flag breakout that ' +
          'forms as the 9-EMA crosses above the 20-EMA.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'Below the candle that held the moving averages (intraday version), or below the ' +
          'consolidation low / the MA stack (daily version).',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Trail the short-term moving averages as the new trend develops; scale into strength ' +
          'on reward-to-risk. A foundational setup worth mastering before moving on to others.',
      },
    ],
    mistakes: [
      'Forcing the trade before the moving averages have actually converged.',
      'Ignoring direction — the setup is symmetrical and can break long or short; the environment dictates which side to trade.',
    ],
  },

  '20 EMA Pullback': {
    intro:
      'A core continuation entry: a stock in a bullish daily trend, or gapping up on a ' +
      'catalyst, pulls back intraday to the 20-EMA, and is bought as it stabilises and turns ' +
      'back up. The community’s phrasing is “pullback to the 20 EMA and remount the 9 EMA.”',
    sections: [
      {
        label: 'Market Context',
        body:
          'On stocks with bullish daily charts or a fresh catalyst plus sector strength. On ' +
          'trend days there are often only a few entries available; this is one of the most ' +
          'reliable.',
      },
      {
        label: 'Chart Criteria',
        body:
          'The stock gaps up or thrusts, then retraces in an orderly way to the 20-EMA — often ' +
          'printing a clear lower wick that tags the 20-EMA — on diminishing momentum. Key ' +
          'reference spots for the pullback are the 9-EMA, the 20-EMA, and the gap fill.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'A green candle holds at the 20-EMA; entry is taken as the next candle breaks that ' +
          'holding candle’s high and price remounts the 9-EMA.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body: 'Below the lower wick / low of the candle that held the 20-EMA.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Scale into new highs or on reward-to-risk; a useful exit is into the 15-minute ' +
          'opening-range-breakout buyers who step in near the highs.',
      },
    ],
    mistakes: [
      'Buying the pullback before a candle actually holds the 20-EMA.',
      'Using the setup on a stock whose daily chart is not bullish.',
    ],
  },

  'EMA Crossback': {
    intro:
      'Another Oliver Kell cycle concept, traded both long and short. Long: after a stock has ' +
      'been extended, it pulls back into and crosses back to the 9/20-EMA, the averages cross, ' +
      'and price reclaims them — a low-risk re-entry into an ongoing trend (the community’s ' +
      '“Happy Panda” is a packaged version, combining a bottoming pattern, a 9/20-EMA crossover ' +
      'as a launch pad, and a tight flag). Short: price that has broken down rallies back up to ' +
      'the moving averages from below and rejects — one of the four climax-day entries listed ' +
      'for the Parabolic Short.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Long version: a stock resuming an uptrend after a pullback, or an early reversal ' +
          'starting a fresh trend. Short version: a stock in a confirmed downtrend or on the ' +
          'backside of a parabolic move, retesting the averages from below.',
      },
      {
        label: 'Chart Criteria',
        body:
          'Long: price crosses back down to the 9/20-EMA, the 9-EMA crosses the 20-EMA, price ' +
          'tightens and then remounts both. Short: price rallies into the underside of the ' +
          '9/20-EMA (or VWAP) and stalls, printing a rejection.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Long: as price holds and remounts the averages, or breaks the high of the candle ' +
          'that held them. Short: on the breakdown below the rejection candle’s low at the ' +
          'moving average.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'Long: below the candle that held the averages. Short: above the rejection candle’s ' +
          'high / above the moving average.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Long: trail the 9/20-EMA into the new trend. Short: on a parabolic backside, target ' +
          'the daily 9-EMA.',
      },
    ],
    mistakes: [
      'Long: anticipating the reclaim before price actually crosses back above the averages.',
      'Short: shorting into the averages before a rejection candle confirms.',
    ],
  },

  'Wedge Pop': {
    intro:
      'The cycle stage immediately following a reversal: after price has stopped going down, ' +
      'it coils into a wedge — often beneath the moving averages — and then “pops” out the ' +
      'top, reclaiming the averages and confirming a new up-cycle.',
    sections: [
      {
        label: 'Market Context',
        body:
          'At the transition from down-cycle to up-cycle — after a Reversal Extension, as the ' +
          'change of character is confirmed. Works intraday, daily, and weekly.',
      },
      {
        label: 'Chart Criteria',
        body:
          'Price tightens into a wedge (converging range, contracting volatility) after a ' +
          'reversal off lows, frequently still below the 9/20-EMA. Volume dries up through the ' +
          'wedge. The pop is a strong-range candle that breaks the upper boundary and reclaims ' +
          'the moving averages, ideally with a gap and a strong close.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Break of the wedge’s upper trendline together with the reclaim of the 9/20-EMA; on ' +
          'earnings, the gap-up that pops the wedge with a strong close.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body: 'Below the wedge / consolidation low.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Trail the 9/20-EMA as the new trend develops; scale into strength on reward-to-risk.',
      },
    ],
    mistakes: [
      'Entering inside the wedge before the pop confirms.',
      'Ignoring whether volume actually dried up through the coil.',
    ],
  },

  'Wedge Drop': {
    intro:
      'The short-side mirror of the Wedge Pop, and the cycle stage immediately following a ' +
      'top: after price has stopped going up, it bounces and coils into a rising wedge — often ' +
      'back up to the underside of the moving averages — and then “drops” out the bottom, ' +
      'losing the averages and confirming a new down-cycle.',
    sections: [
      {
        label: 'Market Context',
        body:
          'At the transition from up-cycle to down-cycle — after a topping move or Reversal ' +
          'Extension, as the change of character is confirmed. Works intraday, daily, and ' +
          'weekly.',
      },
      {
        label: 'Chart Criteria',
        body:
          'Price tightens into a rising wedge (converging range, contracting volatility) after ' +
          'a bounce off the highs, frequently stalling just below the 9/20-EMA. Volume dries up ' +
          'through the wedge. The drop is a strong-range down candle that breaks the lower ' +
          'boundary and loses the moving averages, ideally with a gap down and a weak close.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Break of the wedge’s lower trendline together with the loss of the 9/20-EMA; on ' +
          'earnings, the gap-down that breaks the wedge with a weak close.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body: 'Above the wedge / consolidation high.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Trail the 9/20-EMA as the new downtrend develops; cover into weakness on ' +
          'reward-to-risk.',
      },
    ],
    mistakes: [
      'Entering inside the wedge before the drop confirms.',
      'Ignoring whether volume actually dried up through the coil.',
    ],
  },

  'Episodic Pivot': {
    intro:
      'The Episodic Pivot (EP) is a neglected or forgotten stock that gaps up powerfully on a ' +
      'major catalyst — most often earnings — on massive volume, beginning a sustained new ' +
      'trend. The community’s worked example is a stock that gapped up 50% on earnings with ' +
      'massive volume, broke the earnings-day high the following day, and did not look back. ' +
      'This is the setup Pradeep Bonde named and Qullamaggie systematised.',
    sections: [
      {
        label: 'Market Context',
        body:
          'A confirmed market uptrend strongly preferred. The ideal candidate was previously ' +
          'neglected (little overhead supply) with a genuine surprising catalyst behind the gap.',
      },
      {
        label: 'Chart Criteria',
        body:
          'A significant gap up (community example ~50%; Qullamaggie’s qualifying gaps are ' +
          'large and on the highest volume) on volume far above average, ideally closing in the ' +
          'top 25% of the range. A previously quiet, forgotten chart is a feature — the gap ' +
          'resets the chart.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Two documented entries. Day 1: the earnings-day opening-range breakout — ' +
          'Qullamaggie’s version waits 30 minutes, then enters on the break above the 30-minute ' +
          'high with stop below the 30-minute low, holding overnight only if the close is in ' +
          'the top 25% of the range. Day 2+: a 15-minute volume-support zone from Day 1, or an ' +
          'inside bar that then breaks the Day 1 high.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'Below the 30-minute opening-range low (Day 1), or below the Day 2 volume-support ' +
          'level.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'EPs are meant to be held — trail the daily 9-EMA. The community treats these as ' +
          'priority focus for weeks and months, surfing the short-term daily moving averages.',
      },
    ],
    mistakes: [
      'Chasing when the opening-range high does not break (no edge — move on).',
      'Selling the entire position into the first day or two and missing the multi-week trend.',
    ],
  },
}
