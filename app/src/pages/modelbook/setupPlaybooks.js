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

  'Kicker Candle': {
    intro:
      'A two-day trap. The stock is already set up, in an uptrend or a clean base. The day ' +
      'before closes red and weak near its low, a real body that looks like a failed breakdown; ' +
      'the next day gaps up and follows through with a strong green candle that closes above ' +
      'that red day\'s high. The sellers from the red day are trapped.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Short-term positioning, not news: the kicker should rarely be an earnings day, and an ' +
          'earnings-day gap is an earnings gapper by default. The stock must already be in an ' +
          'uptrend or a base; a gap against an intermediate downtrend, a recovery into the ' +
          '200-day, is a different setup.',
      },
      {
        label: 'Chart Criteria',
        body:
          'The red day before has a real body, about 1 to 5 percent of price, closes near its ' +
          'low and at or under the recent lows of the base, like an almost-failed breakdown. A ' +
          'baby red candle traps nobody and the next day is just a breakout. The kicker day ' +
          'gaps up a decent amount, closes above the red day\'s high and near its own high, ' +
          'usually on a volume surge, and the base before it is clean and orderly.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'The kicker day itself, once it is holding above the red day\'s high; the best ones ' +
          'also clear the 20-day high out of a base that was already set up. Model: JBI ' +
          '2023-12-14, AMD 2023-12-07.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'The low of the kicker day. A kicker that holds its gap tends to resolve quickly, ' +
          'which is why the stop can be tight; a close back under the red day\'s high says the ' +
          'trap did not hold.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Expect a quick advance; the kept examples ran well over 10 percent. Trail under each ' +
          'higher low or the 10-day average, and size so the low-of-day stop is a routine loss.',
      },
    ],
    mistakes: [
      'Calling an earnings-day gap a kicker; by default that is an earnings gapper.',
      'Taking a gap up after a baby red candle; a doji before a gap traps nobody, it is just a breakout.',
      'Buying a gap against an intermediate downtrend, a recovery into the 200-day, and calling it a kicker.',
      'Accepting a crash of a red day before the gap; a 9 percent red bar is too dramatic, the setup wants a real but orderly red day.',
    ],
  },

  'Oops Reversal': {
    intro:
      'A trap at the open. The stock opens below the prior day\'s close, trades under the prior ' +
      'low so the breakdown sellers commit, then reverses and closes back above the prior close. ' +
      'A Williams Oops opens below the prior LOW and rallies back above it. A Super Oops closes ' +
      'above the prior day\'s HIGH, engulfing the whole day.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Location matters big time. The Oops comes at the end of an orderly drift lower, a ' +
          'flag, a wedge down, a double bottom or the end of a downtrend, into a buyable spot; ' +
          'the days before should steadily flag and drift with shrinking ranges, not one violent drop.',
      },
      {
        label: 'Chart Criteria',
        body:
          'The prior day is orderly: no news gap, which makes the next day a delayed reaction ' +
          'rather than an Oops, and no outsized red bar; a random big red day a few days earlier ' +
          'takes the stock off the radar. The Oops day itself looks technical, not news-sized. A ' +
          'red day before it is preferred but not required. Prefer visually clear examples over ' +
          'subtle ones.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'The reversal through the prior close on the Oops day, or the Super Oops close above ' +
          'the prior high. Model: SHOP 2026-09-28, ORIC 2024-01-17, CCJ 2023-05-31.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'The low of the Oops day, which is the precise point the trap was set and must never ' +
          'break afterwards; a routine loss, never widened.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Quick follow-through is the tell; the best ones are up double digits inside two ' +
          'weeks. An Oops on a Launchpad trigger day, as TEAM 2023-12-08, is great confluence.',
      },
    ],
    mistakes: [
      'Buying an Oops after a big news gap the day before; that is a delayed-reaction setup, not an Oops.',
      'Buying an Oops a few days after a nasty outsized red day; the stock is off the radar.',
      'Keeping a position after the Oops-day low breaks; the low must never break.',
      'Taking a subtle, hidden Oops in a random spot; location comes first.',
    ],
  },

  'Slingshot': {
    intro:
      'The first pause after a drive. An earnings gapper, or sometimes a strong rally, runs; ' +
      'then a tight pullback of three to seven sessions puts the closes under the 4-EMA of the ' +
      'highs; the trigger is the first close back above that average. It is mostly the way to ' +
      'enter a power earnings gap after its first pause, not exclusively.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Strength behind it: an earnings gapper, a strong stock, or a consolidation after a ' +
          'nice uptrend. The 200-day is not required; a recovery off a long downtrend can qualify ' +
          'when the drive and the pullback are right.',
      },
      {
        label: 'Chart Criteria',
        body:
          'The 4-period EMA of the daily highs is the line; it is drawn on every Slingshot chart. ' +
          'The drive comes first, then three to seven closes under the line, about 5 to 12 percent ' +
          'deep and orderly, no outsized red bar and no volume spike in the pullback. The gap day ' +
          'or rally day itself is never the trigger.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'The first close back above the 4-EMA of the highs: a decisive day, roughly 3 to 6 ' +
          'percent, closing near its high, on ordinary volume and without needing a gap. A 12 ' +
          'percent day on three times volume reads as a news day. Model: SMCI 2023-05-16, VRT ' +
          '2023-08-21, PLTR 2024-10-03, NVDA 2024-03-01.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'The trigger session\'s low. The gallery examples never came within two percent of it; ' +
          'a close back under the 4-EMA of the highs the next session weakens the setup.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Momentum resuming, not a bottom: expect new short-term highs within days, with volume ' +
          'expanding on up days. A trigger that fades to flat by day 20 was not a Slingshot worth ' +
          'keeping.',
      },
    ],
    mistakes: [
      'Buying the earnings gap day itself as the Slingshot; the gap day or rally day is never the trigger.',
      'Buying a trigger day that gaps up 2 or 3 percent; the best triggers need no gap.',
      'Mistaking a bear-market bounce under a falling 200-day for a Slingshot; it needs strength behind it.',
      'Taking it on a thin or sub-10-dollar stock; the examples come from names the owner would trade.',
    ],
  },

  'High Volume Edge': {
    intro:
      'A volume day that dwarfs everything before it, ten times normal and above the prior ' +
      'record, on an up close, often on a lesser-known name: the start of a new story. That ' +
      'day\'s close is a level to mark on the chart, the price the biggest participants ' +
      'committed at. It is not an HVC, any high-volume close, and not a PEG, an earnings gap on ' +
      'big but ordinary volume.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Usually a lesser-known stock where a new story arrives all at once; a mega-cap on a ' +
          'three-times day is a high-volume close, not an edge. An earnings day counts when the ' +
          'volume is truly massive.',
      },
      {
        label: 'Chart Criteria',
        body:
          'Volume ten times the 50-day average and well above the prior record, an up close, ' +
          'and a close in the upper part of the day\'s range; a day that closes in the lower part ' +
          'of a huge range is cut. OPEX (third Friday) and month-end sessions never count; their ' +
          'volume is mechanical.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'The edge is a level, not a buy signal: mark the HVE close with a ray and run an AVWAP ' +
          'from the edge day; trades are taken on the setups that form around that level later. ' +
          'Model: NAVN 2026-03-26, FSLY 2026-02-12, MRNA 2026-08-19.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'For a position taken on the edge day itself, the bar\'s low. The HVE close is not the ' +
          'stop: price may trade below it later and the level still stands.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'The level outlives any single trade: it is where the new story was priced, and later ' +
          'tests of it are where the next setups form. No must-work rule applies to the edge day.',
      },
    ],
    mistakes: [
      'Calling the highest volume of the year an HVE when it is three times normal on a mega-cap; that is an HVC.',
      'Calling an earnings gap on big but ordinary volume an HVE; that is a PEG.',
      'Marking an OPEX or month-end session as an HVE.',
      'Erasing the level because price traded below the HVE close; it is a level to mark, not a line that must hold.',
    ],
  },
}

