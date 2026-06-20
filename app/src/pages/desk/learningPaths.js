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
  {
    id: 'setups-playbook',
    name: 'The Setups Playbook',
    blurb: 'Work through the core setups — red-to-green, breakouts, gaps, parabolic shorts, failed breakdowns, ranges.',
    steps: [
      'vLcswAwW-sQ', // Using the Red to Green Setup
      'VICdrmMhMm0', // Characteristics of a Breakout/Breakdown
      'Nx36iNg22KQ', // Trading Gap Ups
      'Dh-yGrZrfwQ', // The Parabolic Short Setup: Walkthrough
      '9o0dwGrdQj8', // Failed Breakdown Setup
      'xYWEDyTRPuc', // Range Trading Workshop
    ],
  },
  {
    id: 'options-flow',
    name: 'Options & Flow',
    blurb: 'From credit spreads to reading the options flow and using puts as a hedge.',
    steps: [
      'Afp0-lewKJM', // Credit Spreads Simple
      'C8v7bsrfZL8', // Trading Earnings and The IV Flush
      'by2AS0tEvII', // Options Flow Workshop: How to Read the Flow
      'OKhv2WpNQ8E', // Options Strategy Workshop: Using Puts as a Hedge
    ],
  },
  {
    id: 'mental-game-s1',
    name: 'The Mental Game — Season 1',
    blurb: 'The firm’s psychology series in order — playbooks, finding your happy place, hesitation, and more.',
    steps: [
      'bocNEzFgUcg', // S1E1
      'VlJWAQmmi38', // S1E2 — The Power of Playbooks
      '_qLCngpJpig', // S1E3 — Find Your Happiness
      'IAUbzlbW_KU', // S1E4 — Reflecting On How…
      '_n33394a3EE', // S1E5 — Hesitation and Execution
    ],
  },
]
