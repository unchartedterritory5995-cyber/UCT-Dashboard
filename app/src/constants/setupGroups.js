// Playbook setup taxonomy — the firm's swing + intraday setups.
// Single source of truth for the Model Book "Add Setup" dropdown (and any
// future setup pickers). Lifted from the old ModelBook trade-log form.

export const SETUP_GROUPS = [
  {
    label: 'Swing',
    setups: [
      'High Tight Flag (Powerplay)', 'Classic Flag/Pullback', 'VCP',
      'Flat Base Breakout', 'IPO Base', 'Parabolic Short', 'Parabolic Long',
      'Wedge Pop', 'Wedge Drop', 'Episodic Pivot', '2B Reversal',
      'Kicker Candle', 'Power Earnings Gap', 'News Gappers',
      '4B Setup (Stan Weinstein)', 'Failed H&S/Rounded Top',
      'Classic U&R', 'Launchpad', 'Go Signal', 'HVC',
      'Wick Play', 'Slingshot', 'Oops Reversal', 'News Failure',
      'Remount', 'Red to Green',
    ],
  },
  {
    label: 'Intraday',
    setups: [
      'Opening Range Breakout', 'Opening Range Breakdown',
      'Red to Green (Intraday)', 'Green to Red',
      '30min Pivot', 'Mean Reversion L/S',
    ],
  },
]

export const SETUPS = SETUP_GROUPS.flatMap(g => g.setups)

export const GRADES = ['A+', 'A', 'B', 'C', 'F']
