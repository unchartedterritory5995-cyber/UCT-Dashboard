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
  'High Tight Flag (Powerplay)': {
    intro:
      'The High Tight Flag is the rarest and most explosive of O’Neil’s base patterns; ' +
      'Qullamaggie trades a faster version of the same idea. It marks a stock that has just ' +
      'made an extraordinary momentum move and then refuses to give any of it back, ' +
      'consolidating in an extremely tight range.',
    sections: [
      {
        label: 'Market Context',
        body:
          'Confirmed market uptrend only; the pattern is fragile and fails often, so it is ' +
          'taken only with the broader environment fully supportive and a genuine theme behind ' +
          'the move. Often forms after a catalyst has occurred, such as earnings or other ' +
          'relevant positive news.',
      },
      {
        label: 'Chart Criteria',
        body:
          'O’Neil: pole of +100–120% in 4–8 weeks, then a flag of 3–5 weeks correcting only ' +
          '10–25%. Qullamaggie’s faster variant: 300%+ in days, then 2–4 tiny candles riding ' +
          'the 10-day SMA. The defining feature in both is extreme tightness.',
      },
      {
        label: 'Entry Trigger',
        accent: 'entry',
        body:
          'Breakout above the high of the flag + $0.10 (O’Neil pivot). Intraday variant: break ' +
          'of the prior day’s high while price sits on the 10-day SMA. Additionally — entry off ' +
          'a U&R of support near the bottom of the range, or even a 30min pivot off support ' +
          'near the base of the range.',
      },
      {
        label: 'Stop',
        accent: 'stop',
        body:
          'Below the flag low; on the Qullamaggie variant, below the 10-SMA, and only if that ' +
          'stop is within 3% of entry.',
      },
      {
        label: 'Exit / Targets',
        accent: 'exit',
        body:
          'Trim into a 20–25% gain; invoke the 8-week hold rule if up 20%+ within three weeks. ' +
          'Qullamaggie’s variant trails the 10-SMA on a closing basis.',
      },
      {
        label: 'Position Sizing',
        body:
          'Standard fixed-dollar risk ÷ stop distance. Because the flagpole is so steep, valid ' +
          'stops can be wide in percentage terms; if the stop exceeds the account’s risk ' +
          'tolerance at a sensible share count, the trade is passed.',
      },
    ],
    mistakes: [
      'Buying the flagpole instead of the flag.',
      'Tolerating a loose or deep “flag” that is really just a normal pullback.',
      'Chasing past the +5% buy zone.',
    ],
  },

  'Flat Top Breakout (VCP)': {
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
}
