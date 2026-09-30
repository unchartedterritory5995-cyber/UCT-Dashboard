/**
 * Journal 2.0 — Notebook template library (V1 of the templates plan:
 * docs/superpowers/specs/2026-07-12-notebook-templates-plan.md).
 *
 * Eight firm-authored, data-aware TipTap scaffolds in three families
 * (Rituals / Around a trade / Mindset). Each `build(ctx)` returns a fresh,
 * valid TipTap doc; `ctx` comes from lib/templateContext.js and every field
 * is optional — a template must always produce a sane doc with a bare `{}`
 * (graceful blanks: no data ⇒ the prompt scaffold, never an error).
 *
 * ⚠️ Extension-set constraint (see lib/tiptap.js `buildExtensions`): the editor
 * runs StarterKit + Image + Link + Placeholder + SlashMenu + VideoTimestamp.
 * StarterKit does NOT include @tiptap/extension-table, so a template MUST NOT
 * contain table/tableRow/tableCell/tableHeader nodes — TipTap silently drops
 * unknown nodes on load, corrupting the doc. Structure is expressed with
 * headings + paragraphs + bullet lists + horizontal rules ONLY
 * (guarded by containsTableNode in the test suite).
 *
 * Keys are STABLE API: trade-review / weekly-plan / daily-prep predate this
 * catalog (P5-B3) and are deep-linkable via /journal/notebook?new=<key>.
 */

import { h, p, labeled, linkP, bullets, hr, doc } from '../../../lib/tiptapDocBuilders'

// ── Families (picker grouping) ────────────────────────────────────────────────

export const FAMILIES = [
  { key: 'rituals', label: 'Daily & weekly rituals' },
  { key: 'research', label: 'Thesis & research' },
  { key: 'trades', label: 'Around a trade' },
  { key: 'mind', label: 'Mindset' },
]

// ── The eight templates ───────────────────────────────────────────────────────

export const TEMPLATES = [
  {
    key: 'daily-prep',
    label: 'Daily Game Plan',
    family: 'rituals',
    when: 'Before the open',
    description: 'Regime, levels, scenarios, and your risk budget for the day.',
    tags: ['game-plan'],
    needs: { regime: true, positions: true },
    defaultTitle: (ctx = {}) => `Game Plan — ${ctx.dateShort || 'Today'}`,
    build: (ctx = {}) =>
      doc([
        labeled('Regime:', ctx.regimeLine || '—'),
        h(2, 'Overnight & premarket'),
        p('Index futures, notable gaps, news, and earnings that matter for today.'),
        h(2, 'Levels that matter'),
        bullets([
          'Index levels: support / resistance to watch',
          'Ticker + the price level that changes your plan',
        ]),
        ...(ctx.positionLines && ctx.positionLines.length
          ? [h(2, 'Open positions'), bullets(ctx.positionLines)]
          : []),
        hr(),
        h(2, 'My plan'),
        p('If X happens, I do Y. Spell out the scenarios you will actually trade.'),
        h(2, 'Risk budget'),
        bullets([
          'Max risk per trade (2% hard cap — under 1% preferred)',
          'Position size follows the regime, not the excitement',
          'Daily stop: the number where I walk away',
        ]),
        h(2, 'Discipline reminders'),
        bullets([
          'Trade the plan, not the P&L',
          'One good trade at a time',
          'Step away if you feel tilted',
        ]),
      ]),
  },
  {
    key: 'post-market-debrief',
    label: 'Post-Market Debrief',
    family: 'rituals',
    when: 'After the close',
    description: 'Grade the day against the morning plan in five minutes.',
    tags: ['debrief'],
    needs: { gamePlan: true },
    defaultTitle: (ctx = {}) => `Debrief — ${ctx.dateShort || 'Today'}`,
    build: (ctx = {}) => {
      const gp = ctx.gamePlanNote
      return doc([
        ...(gp
          ? [
              h(2, 'The morning plan said'),
              ...(gp.planBullets && gp.planBullets.length ? [bullets(gp.planBullets)] : []),
              linkP(`Open “${gp.title}” →`, `/journal/notebook?note=${gp.id}`),
            ]
          : [h(2, 'The morning plan said'), p('No game plan found for today — write one tomorrow before the open.')]),
        h(2, "Today's trades"),
        p('What did you take, and was each one on the plan?'),
        hr(),
        h(2, 'What I did great'),
        p('Process wins count even on red days.'),
        h(2, 'What leaked'),
        p('Where did process break down? Be specific and honest.'),
        h(2, 'One emotion, one lesson'),
        bullets(['Emotion of the day: —', 'Lesson to carry: —']),
        h(2, 'Tomorrow'),
        p('The one thing to do differently at the next open.'),
      ])
    },
  },
  {
    key: 'weekly-plan',
    label: 'Weekly Plan',
    family: 'rituals',
    when: 'Sunday or Monday premarket',
    description: 'Context, focus, A+ setups, and the risk plan for the week.',
    tags: ['weekly-plan'],
    needs: { regime: true },
    defaultTitle: (ctx = {}) => `Weekly Plan — wk of ${ctx.weekOfText || 'this week'}`,
    build: (ctx = {}) =>
      doc([
        labeled('Regime:', ctx.regimeLine || '—'),
        h(2, 'Market context'),
        p('Regime, breadth, leading themes, and the level of the major indexes going into the week.'),
        h(2, "This week's focus"),
        p('The one or two things you most want to get right this week.'),
        h(2, 'A+ setups to hunt'),
        bullets([
          'Setup / ticker and the trigger you are waiting for',
          'Setup / ticker and the trigger you are waiting for',
          'Setup / ticker and the trigger you are waiting for',
        ]),
        hr(),
        h(2, 'Risk plan'),
        bullets([
          'Max risk per trade',
          'Max open risk / daily loss limit',
          'Position sizing rules for this regime',
        ]),
        h(2, 'Rules I will follow'),
        bullets([
          'Only trade my A+ setups',
          'Wait for the trigger — no anticipating',
          'Honor the stop, every time',
        ]),
      ]),
  },
  {
    key: 'weekly-review',
    family: 'rituals',
    label: 'Weekly Review',
    when: 'The weekend look-back',
    description: 'Patterns, leaks, and the ONE commitment for next week.',
    tags: ['weekly-review'],
    needs: {},
    defaultTitle: (ctx = {}) => `Weekly Review — wk of ${ctx.weekOfText || 'this week'}`,
    build: () =>
      doc([
        h(2, 'The numbers'),
        bullets([
          'Trades / wins / losses: —',
          'Net R: —',
          'Best trade & why: —',
          'Worst trade & why: —',
        ]),
        h(2, 'Three strongest patterns'),
        bullets(['—', '—', '—']),
        h(2, 'Three biggest leaks'),
        bullets(['—', '—', '—']),
        hr(),
        h(2, 'ONE commitment'),
        p('The single rule next week will be judged against. One. Write it like a rule, not a wish.'),
      ]),
  },
  {
    key: 'monthly-review',
    label: 'Monthly Review',
    family: 'rituals',
    when: 'The first weekend after the month closes',
    description: 'Zoom out from week-to-week — what actually moved the account this month.',
    tags: ['monthly-review'],
    needs: {},
    defaultTitle: (ctx = {}) => `Monthly Review — ${ctx.dateShort || 'this month'}`,
    build: () =>
      doc([
        h(2, 'The month in numbers'),
        bullets([
          'Net P&L / R: —',
          'Win rate and average R per trade: —',
          'Best trade & why: —',
          'Worst trade & why: —',
        ]),
        h(2, 'What worked'),
        p('The setups, conditions, or habits that paid this month — keep doing these.'),
        h(2, 'What did not'),
        p('The recurring leak, if there is one. One month is a pattern; one trade is not.'),
        hr(),
        h(2, 'Regime check'),
        p('Did the market regime change during the month, and did your trading adapt with it?'),
        h(2, 'One change for next month'),
        p('The single adjustment you are committing to — sizing, setups, or process.'),
      ]),
  },
  {
    key: 'quarterly-review',
    label: 'Quarterly Review',
    family: 'rituals',
    when: 'End of quarter',
    description: 'The long view — equity curve, edge by setup, and whether the plan still fits.',
    tags: ['quarterly-review'],
    needs: {},
    defaultTitle: (ctx = {}) => `Quarterly Review — ${ctx.dateShort || 'this quarter'}`,
    build: () =>
      doc([
        h(2, 'The quarter in numbers'),
        bullets([
          'Net P&L / R for the quarter: —',
          'Best month & why: —',
          'Worst month & why: —',
          'Max drawdown, peak to trough: —',
        ]),
        h(2, 'Edge by setup'),
        p('Which setups carried the quarter, and which ones cost more than they earned?'),
        bullets(['Setup / edge: —', 'Setup / edge: —', 'Setup / edge: —']),
        hr(),
        h(2, 'Does the plan still fit?'),
        p('The regime, your capital, and your schedule all change. Does the trading plan you wrote still match the trader you are today?'),
        h(2, 'Goals for next quarter'),
        p('One or two concrete goals — process goals, not P&L targets.'),
      ]),
  },
  {
    key: 'thesis',
    label: 'Long/Short Thesis',
    family: 'research',
    when: 'Starting a new investment thesis',
    description: 'Bull case, bear case, catalysts, risks, and what would prove you wrong.',
    tags: ['thesis'],
    needs: {},
    // Direction (Long/Short) is NOT a body field here -- checkpoint §47:
    // set it once via the Research Type property (below the title, added
    // automatically by the editor's Properties section) rather than
    // duplicating it in prose. Evidence for/against is deliberately NOT a
    // heading in this template either -- it's a structured relationship
    // (supports/opposes another note or a captured fact), tracked in the
    // Thesis Evidence section, not written prose that would compete with it.
    defaultTitle: (ctx = {}) => (ctx.ticker ? `${ctx.ticker} Thesis` : 'Investment Thesis'),
    build: () =>
      doc([
        h(2, 'Bull case'),
        p('The strongest case for this thesis being right.'),
        h(2, 'Bear case'),
        p('The strongest case AGAINST it — steelman the other side, don’t strawman it.'),
        h(2, 'Key assumptions'),
        bullets(['—', '—', '—']),
        hr(),
        h(2, 'Catalysts'),
        p('What would move this thesis forward, and roughly when.'),
        h(2, 'Risks'),
        p('What could go wrong, independent of price action.'),
        h(2, 'What would prove me wrong'),
        p('The specific price, data point, or event that invalidates this thesis.'),
      ]),
  },
  {
    key: 'sector-theme-research',
    label: 'Sector / Theme Research',
    family: 'research',
    when: 'Digging into a sector or theme',
    description: 'Why the theme is moving, the names that lead it, and how to trade it.',
    tags: ['theme-research'],
    needs: {},
    defaultTitle: (ctx = {}) => (ctx.ticker ? `${ctx.ticker} Theme Notes` : 'Sector / Theme Research'),
    build: () =>
      doc([
        h(2, 'The theme'),
        p('What is the theme, and why is money rotating into — or out of — it right now?'),
        h(2, 'Leaders and laggards'),
        bullets(['Leader — why it leads: —', 'Laggard — why it lags: —', 'A name to watch for rotation: —']),
        hr(),
        h(2, 'What confirms this is real'),
        p('Breadth, relative strength, volume, news flow — what would tell you the theme has legs versus a one-day pop.'),
        h(2, 'How I would trade it'),
        p('The name(s) with the best structure, and the setup you are waiting for.'),
        h(2, 'What kills the thesis'),
        p('The event or price action that says the theme is over.'),
      ]),
  },
  {
    key: 'watchlist-thesis',
    label: 'Watchlist Thesis',
    family: 'research',
    when: 'Adding a name to the watchlist',
    description: 'Why it earned a spot on the list, and the trigger that promotes it to a trade.',
    tags: ['watchlist'],
    needs: {},
    defaultTitle: (ctx = {}) => (ctx.ticker ? `${ctx.ticker} — Watchlist Thesis` : 'Watchlist Thesis'),
    build: () =>
      doc([
        h(2, 'Why this name, why now'),
        p('The story, the chart, or the scan that put it in front of you.'),
        h(2, 'The setup forming'),
        bullets(['Pattern / structure: —', 'Key level: —', 'Volume behavior: —']),
        hr(),
        h(2, 'The trigger'),
        p('The exact price or event that promotes this from "watching" to "trading."'),
        h(2, 'Risk if I am wrong'),
        p('Where the setup fails, and what that says about the stock.'),
      ]),
  },
  {
    key: 'catalyst-tracker',
    label: 'Catalyst Tracker',
    family: 'research',
    when: 'A known event is coming for a name you follow',
    description: 'The date, the expectation, and what a beat or miss does to the chart.',
    tags: ['catalyst'],
    needs: {},
    defaultTitle: (ctx = {}) => (ctx.ticker ? `${ctx.ticker} — Catalyst Tracker` : 'Catalyst Tracker'),
    build: () =>
      doc([
        h(2, 'The catalyst'),
        bullets(['Event & date: —', 'What the market expects: —', 'Where the stock sits into it: —']),
        hr(),
        h(2, 'Scenarios'),
        bullets(['If it beats: —', 'If it misses: —', 'If it is in-line and the reaction is the story: —']),
        h(2, 'Position going in'),
        p('Are you holding through it, flat, or sized down? Say why.'),
        h(2, 'Update after the event'),
        p('What actually happened, and whether the reaction matched the setup.'),
      ]),
  },
  {
    key: 'ipo-notes',
    label: 'IPO / New Issue Notes',
    family: 'research',
    when: 'A new listing hits the tape',
    description: 'The business, the float, and whether it belongs on a fresh-issue watchlist.',
    tags: ['ipo'],
    needs: {},
    defaultTitle: (ctx = {}) => (ctx.ticker ? `${ctx.ticker} — IPO Notes` : 'IPO / New Issue Notes'),
    build: () =>
      doc([
        h(2, 'The business'),
        p('What does the company do, and why is it coming public now?'),
        h(2, 'The deal'),
        bullets(['Float / shares outstanding: —', 'Lockup expiration: —', 'Pricing vs. the range: —']),
        hr(),
        h(2, 'Early behavior'),
        p('How the stock traded in its first days — the base it built, or the failure to hold the open.'),
        h(2, 'When I would consider it'),
        p('New issues need their own base — the structure or the time that would make this tradeable.'),
      ]),
  },
  {
    key: 'meeting-notes',
    label: 'Meeting / Webinar Notes',
    family: 'research',
    when: 'During or right after a call, webinar, or earnings presentation',
    description: 'Capture it while it is fresh — the claims, the tone, and the one thing that mattered.',
    tags: ['meeting-notes'],
    needs: {},
    defaultTitle: (ctx = {}) => `Meeting Notes — ${ctx.dateShort || 'Today'}`,
    build: () =>
      doc([
        labeled('Who / what:', '—'),
        h(2, 'Key points'),
        bullets(['—', '—', '—']),
        h(2, 'Tone'),
        p('Confident, defensive, evasive — how did it feel, beyond what was said?'),
        hr(),
        h(2, 'The one thing that mattered'),
        p('If you forget everything else from this, what should you remember?'),
        h(2, 'Follow-up'),
        p('Anything to check, verify, or revisit later.'),
      ]),
  },
  {
    key: 'trade-review',
    label: 'Trade Post-Mortem',
    family: 'trades',
    when: 'After a trade closes',
    description: 'Setup, execution, and the lesson — while it’s fresh.',
    tags: ['trade-review'],
    needs: {},
    defaultTitle: (ctx = {}) =>
      ctx.ticker ? `Trade Post-Mortem — ${ctx.ticker}` : 'Trade Post-Mortem',
    build: () =>
      doc([
        h(2, 'What was the setup?'),
        p('Name the pattern and the market context. Why did this trade earn a place on the sheet?'),
        h(2, 'Entry & thesis'),
        bullets([
          'Entry trigger and price',
          'Stop placement and dollar risk',
          'Target(s) and the plan to manage the position',
        ]),
        hr(),
        h(2, 'What went right'),
        p('What did you execute well — regardless of the outcome?'),
        h(2, 'What went wrong'),
        p('Where did process break down? Be specific and honest.'),
        h(2, 'The lesson'),
        p('One sentence you can carry into the next trade.'),
      ]),
  },
  {
    key: 'swing-log',
    label: 'Swing Position Log',
    family: 'trades',
    when: 'While a position is open',
    description: 'A dated block per day the position is alive — thesis, stop, action.',
    tags: ['swing-log'],
    needs: { positions: true },
    defaultTitle: (ctx = {}) =>
      ctx.ticker ? `Swing Log — ${ctx.ticker}` : 'Swing Position Log',
    build: (ctx = {}) =>
      doc([
        ...(ctx.positionLines && ctx.positionLines.length
          ? [h(2, 'Open positions'), bullets(ctx.positionLines)]
          : [h(2, 'The position'), bullets(['Ticker / side / size: —', 'Entry: —', 'Stop: —', 'Target: —'])]),
        hr(),
        h(2, `Day 1 — ${ctx.dateShort || 'today'}`),
        bullets([
          'Thesis intact? —',
          'Stop stays / moves to: —',
          'Action: hold / add / trim',
        ]),
        p('Add a dated block like this each day the position is open — the log IS the trade.'),
      ]),
  },
  {
    key: 'earnings-play',
    label: 'Earnings Play Plan',
    family: 'trades',
    when: 'Before a report you care about',
    description: 'The report, the play, and sizing for binary risk.',
    tags: ['earnings'],
    needs: {},
    defaultTitle: (ctx = {}) =>
      ctx.ticker ? `Earnings Play — ${ctx.ticker}` : 'Earnings Play Plan',
    build: () =>
      doc([
        h(2, 'The report'),
        bullets([
          'Date / before or after the bell: —',
          'Expected move: —',
          'Last four quarters (beat / miss / reaction): —',
        ]),
        h(2, 'The play'),
        p('Hold through? Enter after the reaction? Sit it out? Say which and why.'),
        h(2, 'Size for binary risk'),
        p('Earnings gaps ignore stops — size so the worst gap is survivable, not just the stop distance.'),
        h(2, 'Invalidation'),
        p('The price or behavior that says the thesis is wrong, whatever the report said.'),
      ]),
  },
  {
    key: 'trade-plan',
    label: 'Trade Plan',
    family: 'trades',
    when: 'Before you place the trade',
    description: 'Entry, stop, target, size, and the line that invalidates it — written before you are in it.',
    tags: ['trade-plan'],
    needs: {},
    defaultTitle: (ctx = {}) => (ctx.ticker ? `Trade Plan — ${ctx.ticker}` : 'Trade Plan'),
    build: () =>
      doc([
        h(2, 'The setup'),
        p('Name the pattern and why it qualifies as an A+ setup today.'),
        h(2, 'Entry / Stop / Target / Size'),
        bullets(['Entry: —', 'Stop: —', 'Target(s): —', 'Size (shares / $ risk): —']),
        hr(),
        h(2, 'Invalidation'),
        p('The specific price or behavior that says this trade is wrong — not the stop, the THESIS.'),
        h(2, 'Management plan'),
        p('How you scale, trail, or add — decided now, not in the middle of the trade.'),
      ]),
  },
  {
    key: 'position-sizing-worksheet',
    label: 'Position Sizing Worksheet',
    family: 'trades',
    when: 'Sizing a position before you enter',
    description: 'Work the math once, in writing, instead of eyeballing it under pressure.',
    tags: ['sizing'],
    needs: {},
    defaultTitle: (ctx = {}) => (ctx.ticker ? `${ctx.ticker} — Position Size` : 'Position Sizing Worksheet'),
    build: () =>
      doc([
        h(2, 'The inputs'),
        bullets([
          'Account size: —',
          'Max risk per trade (%): —',
          'Entry price: —',
          'Stop price: —',
          'Risk per share (entry − stop): —',
        ]),
        hr(),
        h(2, 'The size'),
        p('Shares = (account × max risk %) ÷ risk per share. Do the arithmetic here, not in your head.'),
        h(2, 'Sanity check'),
        p('Does this size fit your total open risk across every position — not just this one?'),
      ]),
  },
  {
    key: 'setup-playbook-entry',
    label: 'Setup Playbook Entry',
    family: 'trades',
    when: 'Documenting a setup for your own playbook',
    description: 'The rules for one setup, written down so future-you trades it the same way every time.',
    tags: ['playbook'],
    needs: {},
    defaultTitle: () => 'Setup Playbook Entry',
    build: () =>
      doc([
        labeled('Setup name:', '—'),
        h(2, 'What it looks like'),
        p('The chart pattern or condition that defines this setup — specific enough that you would recognize it cold.'),
        h(2, 'Entry criteria'),
        bullets(['Trigger: —', 'Confirmation: —', 'What disqualifies it: —']),
        hr(),
        h(2, 'Risk & management'),
        bullets(['Typical stop placement: —', 'Typical target / how you scale out: —']),
        h(2, 'Track record'),
        p('Link a few trade reviews of this setup here as you take it, so the record grows with the setup.'),
      ]),
  },
  {
    key: 'options-trade-plan',
    label: 'Options Trade Plan',
    family: 'trades',
    when: 'Before placing an options trade',
    description: 'Strategy, strikes, and the greeks that matter — sized for defined risk.',
    tags: ['options'],
    needs: {},
    defaultTitle: (ctx = {}) => (ctx.ticker ? `Options Plan — ${ctx.ticker}` : 'Options Trade Plan'),
    build: () =>
      doc([
        h(2, 'The thesis'),
        p('The directional or volatility view driving this trade, and the timeframe it needs to play out in.'),
        h(2, 'The structure'),
        bullets([
          'Strategy (long call/put, spread, etc.): —',
          'Strikes & expiration: —',
          'Debit / credit: —',
          'Max risk / max reward: —',
        ]),
        hr(),
        h(2, 'What theta and IV do to this'),
        p('How time decay and an IV change — into or out of a catalyst — affect the position, independent of the stock moving.'),
        h(2, 'Exit plan'),
        p('The price, date, or P&L that gets you out — profit and loss both.'),
      ]),
  },
  {
    key: 'risk-checklist',
    label: 'Risk Checklist',
    family: 'trades',
    when: 'Before you size up, or once a week',
    description: 'A run through the portfolio-level questions a single-trade plan never asks.',
    tags: ['risk'],
    needs: { positions: true },
    defaultTitle: (ctx = {}) => `Risk Checklist — ${ctx.dateShort || 'Today'}`,
    build: (ctx = {}) =>
      doc([
        ...(ctx.positionLines && ctx.positionLines.length
          ? [h(2, 'Open positions'), bullets(ctx.positionLines)]
          : [h(2, 'Open positions'), p('List what is on, with entry and stop for each.')]),
        hr(),
        h(2, 'Portfolio-level questions'),
        bullets([
          'Total open risk across every position, as a % of the account: —',
          'Are two or more positions correlated (same sector / same trade)?: —',
          'What single event would hurt every position at once?: —',
          'Daily / weekly loss limit, and how far from it am I: —',
        ]),
        h(2, 'Action'),
        p('Anything to trim, hedge, or simply not add to today.'),
      ]),
  },
  {
    key: 'mistake-log',
    label: 'Mistake Log',
    family: 'mind',
    when: 'You broke a rule',
    description: 'Name the rule, name the cost, and say what stops it next time.',
    tags: ['mistake-log'],
    needs: {},
    defaultTitle: (ctx = {}) => `Mistake Log — ${ctx.dateShort || 'Today'}`,
    build: () =>
      doc([
        h(2, 'The rule that got broken'),
        p('Name it precisely — "sized too big" is not as useful as "sized 3x my normal without a reason."'),
        h(2, 'What happened'),
        p('The sequence of decisions, not just the outcome.'),
        h(2, 'What it cost'),
        p('In R, in dollars, or in the next few trades it affected.'),
        hr(),
        h(2, 'The pattern'),
        p('Has this rule been broken before? A mistake log only pays off once you can see the repeats.'),
        h(2, 'What stops it next time'),
        p('A concrete change — a checklist item, an alert, a person to text — not just "be more disciplined."'),
      ]),
  },
  {
    key: 'lessons-learned',
    label: 'Lessons Learned',
    family: 'mind',
    when: 'A lesson is worth keeping past one trade',
    description: 'The running list of rules you have actually earned the hard way.',
    tags: ['lessons'],
    needs: {},
    defaultTitle: () => 'Lessons Learned',
    build: () =>
      doc([
        p('One lesson per entry. Date it, and link back to the trade or note it came from.'),
        hr(),
        labeled('Lesson:', '—'),
        p('Where it came from, and what it would have changed if you had known it going in.'),
      ]),
  },
  {
    key: 'goals',
    label: 'Trading Goals',
    family: 'mind',
    when: 'Setting goals for a stretch of time',
    description: 'Process goals you can control, not P&L targets you cannot.',
    tags: ['goals'],
    needs: {},
    defaultTitle: (ctx = {}) => `Trading Goals — ${ctx.dateShort || 'Today'}`,
    build: () =>
      doc([
        h(2, 'Process goals'),
        p('What you will DO, not what the market will pay you. Examples: honor every stop, journal every trade, take only A+ setups.'),
        bullets(['—', '—', '—']),
        hr(),
        h(2, 'How I will know'),
        p('The evidence that tells you a goal was actually kept — a count, a streak, a review, not a feeling.'),
        h(2, 'Review date'),
        p('When you will come back to this and grade yourself honestly.'),
      ]),
  },
  {
    key: 'drawdown-recovery-plan',
    label: 'Drawdown Recovery Plan',
    family: 'mind',
    when: 'After a stretch of losses',
    description: 'Cut size, find the leak, and earn your way back up — written before the next trade, not during it.',
    tags: ['drawdown'],
    needs: {},
    defaultTitle: (ctx = {}) => `Drawdown Recovery Plan — ${ctx.dateShort || 'Today'}`,
    build: () =>
      doc([
        h(2, 'Where things stand'),
        bullets([
          'Drawdown from the peak: —',
          'How many of the last trades were losers: —',
          'What the losers have in common, if anything: —',
        ]),
        hr(),
        h(2, 'Size, cut first'),
        p('The reduced size you are trading at until you are back to even, written as a number, not a feeling.'),
        h(2, 'The one thing to fix'),
        p('If the drawdown has a single cause — oversizing, chasing, ignoring the regime — name it.'),
        h(2, 'What earns the size back'),
        p('The specific evidence — a win streak, a number of clean process trades — that graduates you back to normal size.'),
      ]),
  },
  {
    key: 'tilt-log',
    label: 'Tilt Log',
    family: 'mind',
    when: 'When it goes sideways',
    description: 'Three fields, sixty seconds. Naming it is the win.',
    tags: ['tilt'],
    needs: {},
    defaultTitle: (ctx = {}) => `Tilt Log — ${ctx.dateShort || 'Today'}`,
    build: () =>
      doc([
        h(2, 'What happened'),
        p(),
        h(2, 'The mistake, named'),
        p('FOMO · chased · oversized · moved the stop · revenge trade · early exit · other'),
        h(2, 'What it cost (R)'),
        p(),
        hr(),
        p('Close the laptop if you need to. Writing this note was the disciplined move.'),
      ]),
  },
]

/** Node types that the editor's extension set cannot render (no table ext). */
export const TABLE_NODE_TYPES = new Set([
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
])

/**
 * Recursively test whether a TipTap node (or doc) contains any table-family
 * node anywhere in its subtree. Used by tests to guarantee templates stay
 * within the editor's extension set.
 */
export function containsTableNode(node) {
  if (!node || typeof node !== 'object') return false
  if (TABLE_NODE_TYPES.has(node.type)) return true
  return (node.content || []).some(containsTableNode)
}

/** Lookup a template by its stable key. */
export function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null
}

/** Templates of one family, in catalog order. */
export function templatesByFamily(familyKey) {
  return TEMPLATES.filter((t) => t.family === familyKey)
}

// ── Gallery preview (wave 10 lane D2, design finding D-4) ─────────────────────

/** How many lines a template card previews, and how long one line may run. */
export const PREVIEW_LINES = 3
const PREVIEW_LINE_CHARS = 72

function nodeText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return node.text || ''
  return (node.content || []).map(nodeText).join('')
}

function clip(text) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > PREVIEW_LINE_CHARS ? `${t.slice(0, PREVIEW_LINE_CHARS - 1).trimEnd()}…` : t
}

/**
 * Fix round 1 (review M-2): a context in which EVERY data field a template can read
 * is present, each carrying a marker no template's own words contain. Its keys are
 * the keys `assembleTemplateContext` returns (lib/templateContext.js); the rail
 * (TemplatePicker.gallery.test.jsx) checks both that they match and that no
 * template reads a field this context lacks.
 */
const MARK = '\u2063' // an invisible separator: no template's own words contain it
export const STRUCTURE_PROBE_CONTEXT = Object.freeze({
  dateText: `${MARK}date`,
  dateShort: `${MARK}date`,
  weekOfText: `${MARK}week`,
  ticker: `${MARK}TICKER`,
  regimeLine: `${MARK}regime`,
  positionLines: [`${MARK}position`],
  gamePlanNote: { id: `${MARK}id`, title: `${MARK}plan`, planBullets: [`${MARK}plan bullet`] },
})

/**
 * A template's STRUCTURE: the top-level blocks it writes whatever the member's data
 * is -- the blocks of `build({})` that `build(STRUCTURE_PROBE_CONTEXT)` also writes,
 * identically, in `build({})`'s order. What only the no-data branch writes ("No game
 * plan found for today -- ...", "Regime: --", the placeholder position list) and what
 * only data writes are both left out: neither is the note the member will get.
 */
export function templateStructure(tpl) {
  if (!tpl || typeof tpl.build !== 'function') return []
  const withData = new Set((tpl.build(STRUCTURE_PROBE_CONTEXT)?.content || []).map((n) => JSON.stringify(n)))
  return (tpl.build({})?.content || []).filter((n) => withData.has(JSON.stringify(n)))
}

/**
 * The first lines of a template, from its STRUCTURE (templateStructure above): the
 * headings and prompts it writes for every member, never its no-data scaffold, and
 * never a second, hand-typed description. A line is
 * `{ kind: 'heading' | 'text' | 'bullet', text }`; empty paragraphs and rules are
 * skipped, a list contributes one line per item. A template whose structure yields
 * no line has no preview -- the card shows its description alone.
 */
export function templatePreview(tpl, maxLines = PREVIEW_LINES) {
  const lines = []
  const push = (kind, text) => {
    const t = clip(text)
    if (t && lines.length < maxLines) lines.push({ kind, text: t })
  }
  for (const node of templateStructure(tpl)) {
    if (lines.length >= maxLines) break
    if (node.type === 'heading') push('heading', nodeText(node))
    else if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
      for (const item of node.content || []) push('bullet', nodeText(item))
    } else if (node.type !== 'horizontalRule') push('text', nodeText(node))
  }
  return lines
}
