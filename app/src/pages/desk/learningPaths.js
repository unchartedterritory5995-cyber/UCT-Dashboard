// Curated learning paths — hand-ordered sequences across categories that turn the
// library into a course. Opening a path plays its videos as a queue, so the
// in-app Up Next rail + autoplay + Continue Watching all work over the path.
// Each step is a youtube_id; unknown ids are skipped at render time.
export const LEARNING_PATHS = [
  {
    id: 'foundations',
    name: 'Start Here: New Trader Foundations',
    blurb: 'The essentials, in order — how to think, read a chart, scan, size, and review.',
    steps: [
      'ySRusUvxPTs', // Think Like A Trader: Probabilities, Risk to Reward, Win-Rate
      'YUlIdpgmjnA', // Basics of Technical Analysis: Keep It Simple
      'DhvMBF4Pd0E', // The Process of Scanning Stocks and Building a Watchlist
      'Y8bpRpKEMO8', // Position Sizing, Account Management, and Stop Losses
      'Cejpmc1O7KA', // Knowing Your Setup and Risk
      'Jk6vZuAUYRQ', // Identifying The Setups We Trade In Real Time
      'ET_yVMI9ssQ', // How to Manage Losing Trades
      'aSi_z8o6SLA', // Trade Reviews
    ],
  },
  {
    id: 'risk',
    name: 'Risk & Discipline',
    blurb: 'Protect capital first: sizing, stops, risk multiples, and the psychology of conviction.',
    steps: [
      'Y8bpRpKEMO8', // Position Sizing, Account Management, and Stop Losses
      'drwHWrpXWZw', // We Are Risk Takers: Knowing When To Put On Risk
      'gFva6wJ-s0c', // Risk Multiples in Your Trades & Account
      'Cq0Y7S16wAU', // Getting Your Stops to Breakeven
      'ET_yVMI9ssQ', // How to Manage Losing Trades
      'raW36vdl6uY', // Conviction vs Blind Hope vs Informed Bias
    ],
  },
  {
    id: 'reading-market',
    name: 'Reading the Market',
    blurb: 'Top-down market awareness — breadth, environment, leadership, and prepping the day.',
    steps: [
      'uetiKTsoscs', // Market Breadth
      'ICI016iDzA4', // Looking At the Market From a Top Down Approach
      'CRisHQsKQbY', // Market Environment Awareness
      'Vm8fiPKWsTQ', // Recognizing a Changing Market
      'BmRaRJhrvvM', // Characteristics of Market Leaders
      'tAN_xicKtF8', // Premarket Preparation — Framing the Scenarios for the Day
    ],
  },
]
