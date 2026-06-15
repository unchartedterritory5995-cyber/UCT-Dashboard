// Model Book → Bottoms.
//
// A field manual for how MAJOR MARKETS BOTTOM. Two halves:
//
//   1. BOTTOM_SIGNPOSTS — the firm's anatomy framework. The repeatable tells
//      that show up, in order, as a bear market exhausts itself and turns. This
//      is the "what to look for" teaching layer (shown on the landing screen).
//
//   2. BOTTOMS — a curated library of real historical major-market bottoms.
//      Each one is a case study: the drawdown, the character, which signposts
//      fired (and when), the leadership that emerged off the low, and how the
//      turn was executable via leveraged index ETFs + leadership stocks.
//
// Frontend-only (v1) — hand-authored case studies, charted live against the
// index via StockChart. Annotated chart examples / DB wiring can layer on later
// the same way the Setup Library grew its examples backend.

// ── Anatomy of a Bottom: the signposts, in the order they tend to appear ──────
// `phase` groups them into the arc (Exhaustion → Turn → Confirmation). `accent`
// drives the marker color (red = fear/selling, gold = the pivot, green = the
// thrust / new uptrend).
export const BOTTOM_SIGNPOSTS = [
  {
    key: 'capitulation',
    num: 1,
    phase: 'Exhaustion',
    accent: 'red',
    name: 'Capitulation',
    blurb: 'Climactic, high-volume selling — everyone who is going to sell, sells.',
    detail:
      'The flush. Volume spikes to multiples of average as the last holders give up and dump into the lows. ' +
      'Down 4% days cluster, gaps open red and accelerate. It feels like the market will never stop going down — ' +
      'which is exactly the point. Capitulation is the market running out of sellers, not the market finding buyers.',
  },
  {
    key: 'volatility',
    num: 2,
    phase: 'Exhaustion',
    accent: 'red',
    name: 'Volatility Peak',
    blurb: 'Fear gets priced to an extreme — the VIX spikes and then rolls over.',
    detail:
      'The VIX (and realized volatility) blows out to a panic reading, often a multi-year high. The TURN in volatility ' +
      'matters more than the level: a VIX that spikes and then starts falling — even with price still soft — says the ' +
      'pace of fear has peaked. Falling volatility off a blowoff is the market exhaling.',
  },
  {
    key: 'breadth_washout',
    num: 3,
    phase: 'Exhaustion',
    accent: 'red',
    name: 'Breadth Washout',
    blurb: 'New 52-week lows peak and percent-above-200dma bottoms out.',
    detail:
      'Internals reach a true washout: new 52-week lows expand to a crescendo, the percent of stocks above their 200-day ' +
      'collapses into single digits, advancers vanish. Paradoxically, the BEST breadth reading for a bottom is the worst ' +
      'one — peak destruction under the surface is what clears the deck for a durable low.',
  },
  {
    key: 'news_failure',
    num: 4,
    phase: 'Turn',
    accent: 'gold',
    name: 'News Failure',
    blurb: 'Awful headlines hit — and price refuses to make a new low.',
    detail:
      'The tell that selling is exhausted: terrible news lands (a bankruptcy, a downgrade, an ugly print) and the market ' +
      'gaps down, reverses, and closes green — or simply holds above the prior low. When bad news can no longer make ' +
      'price go down, the sellers are gone. Reactions, not headlines, mark the low.',
  },
  {
    key: 'follow_through',
    num: 5,
    phase: 'Confirmation',
    accent: 'green',
    name: 'The Follow-Through Day',
    blurb: 'A powerful, high-volume up day confirms the rally attempt.',
    detail:
      'After a low is set, count the rally attempt. A follow-through day — a major index up sharply on volume heavier ' +
      'than the prior session, several days into the bounce — is the green light that institutions are stepping back in. ' +
      'No bottom of consequence has ever happened without one. It can fail; you still wait for it.',
  },
  {
    key: 'leadership',
    num: 6,
    phase: 'Confirmation',
    accent: 'green',
    name: 'Leadership Emerges',
    blurb: 'Fresh leaders base and break out first, off the low.',
    detail:
      'The new bull market names you up before the indices do. While the averages chop near the lows, the next cycle’s ' +
      'leaders are quietly building the right side of bases — relative strength, tight action, big up-volume on the ' +
      'reclaim. They break out into the follow-through. What leads off the bottom tends to lead the whole advance.',
  },
]

// ── How to execute the turn (shown as the closing strip on the landing page) ──
export const EXECUTION = {
  title: 'Putting It to Work',
  blurb:
    'A confirmed bottom is one of the highest-reward, best-defined setups in markets. Two vehicles express it: ' +
    'leveraged index ETFs to capture the broad thrust, and leadership stocks for the asymmetric upside.',
  vehicles: [
    {
      name: 'Leveraged Index ETFs',
      tickers: ['TQQQ', 'SPXL', 'UPRO', 'SOXL'],
      note:
        'Capture the breadth thrust itself. Enter on the follow-through day with a stop under the bottom; the broad, ' +
        'fast move off a washed-out low is where 3× index exposure pays. Size for the decay — these are for the thrust, ' +
        'not for holding through chop.',
    },
    {
      name: 'Leadership Stocks',
      tickers: [],
      note:
        'The asymmetric upside. Buy the new leaders out of their first proper base as they clear the follow-through, ' +
        'add on strength, and let the winners run. The names that break out first and hardest off the low are the ' +
        'tells for the entire new cycle.',
    },
  ],
}

// Bottom "shapes" — used for the glyph + as filter pills, mirroring how the
// Setup Library groups by family.
export const BOTTOM_TYPES = ['All', 'V-Bottom', 'Double Bottom', 'Rounded Bottom']

// ── The library of historical major-market bottoms (newest → oldest) ──────────
// chartSym: '^GSPC' (S&P 500) or '^IXIC' (Nasdaq) — both have deep yfinance
// history, so every one of these charts live. frameStart/frameEnd frame the
// study window (descent → low → the recovery). signposts: the dated tells that
// fired, rendered as a timeline in the detail view.
export const BOTTOMS = [
  {
    id: '2022-bear',
    name: 'The 2022 Rate Bear',
    index: 'S&P 500',
    chartSym: '^GSPC',
    era: '2022',
    type: 'Double Bottom',
    legendary: false,
    peakDate: '2022-01-03',
    lowDate: '2022-10-13',
    frameStart: '2021-11-01',
    frameEnd: '2023-07-31',
    drawdownPct: -25,
    durationLabel: '~9 months',
    character:
      'A slow, grinding bear driven by the fastest rate-hike cycle in 40 years — no single crash, just relentless ' +
      'compression of valuations.',
    summary:
      'There was no panic crash; the 2022 bear ground lower for nine months as the Fed hiked into the highest inflation ' +
      'in a generation. The June low was retested in October, and on October 13th a brutal hot-CPI print gapped the ' +
      'market to new lows — then reversed for one of the largest intraday turns on record. That news failure marked it. ' +
      'The follow-through carried into a new bull led, eventually, by mega-cap AI.',
    signposts: [
      { key: 'breadth_washout', date: '2022-09-30', note: 'Percent of S&P stocks above their 200-day collapsed into single digits.' },
      { key: 'volatility', date: '2022-10-11', note: 'VIX pressed into the mid-30s as the second leg down accelerated.' },
      { key: 'news_failure', date: '2022-10-13', note: 'Hot CPI gapped the market to new lows, then reversed +5% intraday — sellers exhausted.' },
      { key: 'follow_through', date: '2022-11-10', note: 'A soft CPI print drove a thrust day on heavy volume confirming the turn.' },
      { key: 'leadership', date: '2023-01-15', note: 'Mega-cap tech (NVDA, META) reclaimed and led; AI became the new-cycle theme.' },
    ],
    leaders: ['NVDA', 'META', 'AMD', 'CRM', 'AVGO'],
    execution:
      'The October 13th reversal was the news failure; the November thrust was the confirmation. TQQQ and SOXL off the ' +
      'follow-through caught the early-2023 ramp, while NVDA and META out of their first bases carried the new cycle.',
  },
  {
    id: '2020-covid',
    name: 'The COVID Crash',
    index: 'S&P 500',
    chartSym: '^GSPC',
    era: '2020',
    type: 'V-Bottom',
    legendary: true,
    peakDate: '2020-02-19',
    lowDate: '2020-03-23',
    frameStart: '2020-01-02',
    frameEnd: '2020-09-30',
    drawdownPct: -34,
    durationLabel: '33 days',
    character:
      'The fastest bear market in history — a -34% exogenous shock crash in five weeks, and a V-recovery just as violent.',
    summary:
      'A pure exogenous shock. The market fell 34% in 33 days as the world shut down — circuit breakers tripped, the VIX ' +
      'hit 82, an all-time record. The low on March 23rd came the day before unprecedented Fed and fiscal backstops; ' +
      'price spiked into a climactic flush and reversed hard. The follow-through came within days, and a brand-new set ' +
      'of work-from-home and digital leaders exploded off the low.',
    signposts: [
      { key: 'capitulation', date: '2020-03-12', note: 'A -9.5% day; circuit breakers tripped repeatedly through mid-March on record volume.' },
      { key: 'volatility', date: '2020-03-16', note: 'VIX closed at 82.69 — an all-time record high, exceeding 2008.' },
      { key: 'news_failure', date: '2020-03-23', note: 'Climactic low printed into peak fear, the day before the Fed went "unlimited."' },
      { key: 'follow_through', date: '2020-03-26', note: 'Three powerful up days, the last on expanding volume, confirmed the rally.' },
      { key: 'leadership', date: '2020-04-06', note: 'ZM, NVDA, SHOP, DOCU, AMD broke out first — the digital / WFH cohort led.' },
    ],
    leaders: ['NVDA', 'AMD', 'SHOP', 'SE', 'TSLA'],
    execution:
      'The V left no time to dither — the follow-through fired six days off the low. TQQQ caught the broad ramp; the ' +
      'leadership (NVDA, AMD, SHOP, SE, TSLA) handed out generational moves for those who bought the first breakouts.',
  },
  {
    id: '2018-christmas',
    name: 'The Christmas Eve Low',
    index: 'S&P 500',
    chartSym: '^GSPC',
    era: '2018',
    type: 'V-Bottom',
    legendary: false,
    peakDate: '2018-09-20',
    lowDate: '2018-12-24',
    frameStart: '2018-09-01',
    frameEnd: '2019-05-31',
    drawdownPct: -20,
    durationLabel: '~3 months',
    character:
      'A Q4 waterfall on hawkish-Fed fear that bottomed in a thin holiday tape on Christmas Eve, then snapped back.',
    summary:
      'A sharp Q4 decline on fears the Fed would over-tighten into a slowdown. Selling accelerated into a thin holiday ' +
      'tape, bottoming -20% on Christmas Eve. The day after Christmas delivered a 1,000-point Dow reversal day on huge ' +
      'volume; a January Fed pivot ("patient") sealed it. Software and chip names led the recovery.',
    signposts: [
      { key: 'capitulation', date: '2018-12-21', note: 'Quad-witching dumped the market on record December volume.' },
      { key: 'breadth_washout', date: '2018-12-24', note: 'New 52-week lows surged; under-the-surface damage was far worse than the index -20%.' },
      { key: 'news_failure', date: '2018-12-26', note: 'A +5% reversal day — the largest Dow point gain ever at the time — off the low.' },
      { key: 'follow_through', date: '2019-01-04', note: 'A strong jobs number + Powell "patient" pivot drove a volume thrust.' },
      { key: 'leadership', date: '2019-01-15', note: 'Software (TTD, COUP, AYX) and chips led the new advance.' },
    ],
    leaders: ['AMD', 'TTD', 'ROKU', 'AYX', 'COUP'],
    execution:
      'The December 26th reversal was the news failure; the January 4th thrust confirmed. TQQQ off the follow-through, ' +
      'with high-RS software and chip leaders breaking out of short bases, captured the 2019 run.',
  },
  {
    id: '2016-feb',
    name: 'The 2016 Double Bottom',
    index: 'S&P 500',
    chartSym: '^GSPC',
    era: '2015–16',
    type: 'Double Bottom',
    legendary: false,
    peakDate: '2015-05-20',
    lowDate: '2016-02-11',
    frameStart: '2015-07-01',
    frameEnd: '2016-12-31',
    drawdownPct: -15,
    durationLabel: '~9 months',
    character:
      'Two washouts — the August 2015 flash-crash and the January–February 2016 oil/China scare — forged a double bottom.',
    summary:
      'A correction in two acts: the August 2015 China-devaluation flash crash, then a January–February 2016 plunge on ' +
      'collapsing oil and China fears. February 11th, 2016 marked the second low as crude bottomed near $26. The retest ' +
      'held above panic, breadth thrust off the low, and the FANG cohort plus semiconductors led for the next two years.',
    signposts: [
      { key: 'capitulation', date: '2016-01-20', note: 'A capitulation flush as WTI crude broke $27 and dragged risk assets down.' },
      { key: 'news_failure', date: '2016-02-11', note: 'Price undercut the January low intraday, reversed, and held — the double bottom completed.' },
      { key: 'breadth_washout', date: '2016-02-11', note: 'New lows peaked at the retest even as the index held above the August low.' },
      { key: 'follow_through', date: '2016-02-17', note: 'A breadth thrust off the low confirmed; the McClellan surged.' },
      { key: 'leadership', date: '2016-03-01', note: 'FANG (FB, AMZN, NFLX, GOOGL) and NVDA reasserted leadership.' },
    ],
    leaders: ['NVDA', 'AMZN', 'FB', 'NFLX', 'AMAT'],
    execution:
      'The Feb 11th undercut-and-rally was the tell; the breadth thrust confirmed. NVDA off the 2016 low was the trade ' +
      'of the era — a leadership name that broke out first and compounded for years.',
  },
  {
    id: '2011-summer',
    name: 'The 2011 Crisis Low',
    index: 'S&P 500',
    chartSym: '^GSPC',
    era: '2011',
    type: 'Double Bottom',
    legendary: false,
    peakDate: '2011-05-02',
    lowDate: '2011-10-03',
    frameStart: '2011-04-01',
    frameEnd: '2012-04-30',
    drawdownPct: -19,
    durationLabel: '~5 months',
    character:
      'A August debt-ceiling / US-downgrade panic, a choppy three-month base, and an October double bottom that launched.',
    summary:
      'The S&P plunged ~19% in August 2011 on the US credit downgrade and the European debt crisis. The market then ' +
      'built a violent, range-bound base for two months and retested the lows in early October. October 4th saw a ' +
      'sharp reversal off the retest; a powerful October follow-through (and the famous "Draghi/EU" relief) launched a ' +
      'multi-year advance led by Apple and consumer names.',
    signposts: [
      { key: 'capitulation', date: '2011-08-08', note: 'A -6.7% day after the S&P downgraded US debt; volume spiked to a climax.' },
      { key: 'volatility', date: '2011-08-08', note: 'VIX spiked above 48 as the August waterfall hit.' },
      { key: 'news_failure', date: '2011-10-04', note: 'Price undercut the August low intraday, then reversed +4% to close green.' },
      { key: 'follow_through', date: '2011-10-10', note: 'A thrust day on heavy volume confirmed the October double-bottom low.' },
      { key: 'leadership', date: '2011-10-20', note: 'AAPL and consumer leaders broke out to lead the 2012 advance.' },
    ],
    leaders: ['AAPL', 'SBUX', 'PCLN', 'MA', 'V'],
    execution:
      'The October 4th undercut-and-rally off the retest was the entry tell; the October 10th thrust confirmed. SPXL ' +
      'off the follow-through plus AAPL out of its base carried the move.',
  },
  {
    id: '2009-gfc',
    name: 'The Generational Low',
    index: 'S&P 500',
    chartSym: '^GSPC',
    era: '2009',
    type: 'Rounded Bottom',
    legendary: true,
    peakDate: '2007-10-09',
    lowDate: '2009-03-09',
    frameStart: '2008-06-01',
    frameEnd: '2009-12-31',
    drawdownPct: -57,
    durationLabel: '~17 months',
    character:
      'The Global Financial Crisis bear — a -57% collapse of the financial system, and the generational low it carved.',
    summary:
      'The deepest bear since the Depression: -57% peak to trough as the financial system seized. After the November ' +
      '2008 capitulation, the market made a lower low on March 6–9, 2009 — but with massive positive divergence under ' +
      'the surface. The March 12th follow-through launched one of the great bull markets. Leadership came from the ' +
      'wreckage — high-beta tech and consumer names that had been left for dead.',
    signposts: [
      { key: 'capitulation', date: '2008-11-20', note: 'A climactic November flush on record volume set the first low.' },
      { key: 'volatility', date: '2008-11-20', note: 'VIX closed near 81 — the credit-crisis panic peak.' },
      { key: 'breadth_washout', date: '2009-03-09', note: 'The March low came on POSITIVE breadth divergence — fewer new lows than November.' },
      { key: 'follow_through', date: '2009-03-12', note: 'A powerful thrust on expanding volume confirmed the rally attempt.' },
      { key: 'leadership', date: '2009-03-23', note: 'AMZN, AAPL, FFIV, GMCR and high-beta names broke out to lead.' },
    ],
    leaders: ['AMZN', 'AAPL', 'FFIV', 'GMCR', 'BIDU'],
    execution:
      'The March 9th positive-divergence low and the March 12th follow-through were the signal. The leaders — AMZN, ' +
      'AAPL, FFIV — that broke out first off the bottom delivered the defining moves of the decade-long bull.',
  },
  {
    id: '2002-dotcom',
    name: 'The Dot-Com Bottom',
    index: 'Nasdaq Composite',
    chartSym: '^IXIC',
    era: '2002',
    type: 'Double Bottom',
    legendary: true,
    peakDate: '2000-03-10',
    lowDate: '2002-10-09',
    frameStart: '2002-01-02',
    frameEnd: '2003-12-31',
    drawdownPct: -78,
    durationLabel: '~31 months',
    character:
      'The end of the dot-com bust — the Nasdaq -78% from its 2000 mania peak, bottoming in a July/October double low.',
    summary:
      'The unwind of the greatest bubble of its era. The Nasdaq lost 78% over 31 months. Capitulation came in July 2002, ' +
      'a retest in October 2002 carved a double bottom near 1,108. The October follow-through began the recovery; ' +
      'homebuilders, energy, and a re-emerging Apple led the next cycle as the speculative excess fully cleared.',
    signposts: [
      { key: 'capitulation', date: '2002-07-23', note: 'A washout flush set the first low on heavy capitulation volume.' },
      { key: 'news_failure', date: '2002-10-09', note: 'Price undercut the July low and reversed — the double bottom completed.' },
      { key: 'breadth_washout', date: '2002-10-09', note: 'New lows peaked at the October retest; the deck was finally cleared.' },
      { key: 'follow_through', date: '2002-10-15', note: 'A +4% thrust on heavy volume confirmed the rally attempt.' },
      { key: 'leadership', date: '2003-03-15', note: 'Homebuilders, energy, and a re-basing AAPL led the new cycle.' },
    ],
    leaders: ['AAPL', 'LEN', 'DHI', 'XOM'],
    execution:
      'The October undercut of the July low, then the October 15th thrust, marked the turn. The new leadership rotated ' +
      'away from the prior bubble — homebuilders and energy, not the busted dot-coms.',
  },
  {
    id: '1987-crash',
    name: 'Black Monday',
    index: 'S&P 500',
    chartSym: '^GSPC',
    era: '1987',
    type: 'V-Bottom',
    legendary: true,
    peakDate: '1987-08-25',
    lowDate: '1987-12-04',
    frameStart: '1987-06-01',
    frameEnd: '1988-08-31',
    drawdownPct: -34,
    durationLabel: '~3 months',
    character:
      'The largest one-day crash in history — -22.6% on October 19th, 1987 — and the fast base that followed it.',
    summary:
      'On October 19th, 1987, the market fell 22.6% in a single session, the worst day ever, as portfolio-insurance ' +
      'selling cascaded. The crash itself was the capitulation. Price retested into early December, held above the ' +
      'crash low, and based. With no recession to follow, the market recovered the entire decline within two years.',
    signposts: [
      { key: 'capitulation', date: '1987-10-19', note: 'Black Monday: -22.6% in one day — the climactic, all-at-once capitulation.' },
      { key: 'volatility', date: '1987-10-20', note: 'Volatility hit an extreme never seen before or matched until 2008/2020.' },
      { key: 'news_failure', date: '1987-12-04', note: 'A December retest held above the crash low — selling was spent.' },
      { key: 'follow_through', date: '1987-12-08', note: 'A thrust off the December low confirmed the base.' },
    ],
    leaders: [],
    execution:
      'The crash compressed the entire capitulation into one day. The December retest that held above the October low ' +
      'was the tradable bottom — the market round-tripped the crash within two years.',
  },
  {
    id: '1974-secular',
    name: 'The 1974 Secular Low',
    index: 'S&P 500',
    chartSym: '^GSPC',
    era: '1974',
    type: 'Rounded Bottom',
    legendary: true,
    peakDate: '1973-01-11',
    lowDate: '1974-10-03',
    frameStart: '1973-01-01',
    frameEnd: '1975-12-31',
    drawdownPct: -48,
    durationLabel: '~21 months',
    character:
      'The brutal 1973–74 bear — stagflation, oil shock, and Watergate — that carved a generational rounded bottom.',
    summary:
      'A -48% grind through stagflation, the OPEC oil embargo, and Watergate. The market bottomed in October–December ' +
      '1974 in a rounded, washed-out base near extreme pessimism and single-digit P/Es. It was the launchpad for the ' +
      'great 1975 rally and, ultimately, the secular bull that began in 1982.',
    signposts: [
      { key: 'capitulation', date: '1974-10-03', note: 'A final washout into deep-value territory; pessimism was total.' },
      { key: 'volatility', date: '1974-09-13', note: 'Fear and realized volatility peaked into the autumn lows.' },
      { key: 'news_failure', date: '1974-12-06', note: 'A December retest held; bad news could no longer push price to new lows.' },
      { key: 'follow_through', date: '1975-01-02', note: 'A powerful January thrust launched a +30% rally in months.' },
    ],
    leaders: [],
    execution:
      'A rounded, multi-month bottom rewarded patience over precision. The January 1975 thrust off the base was the ' +
      'confirmation that began one of the strongest recovery years on record.',
  },
]
