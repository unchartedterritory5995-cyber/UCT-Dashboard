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
}
