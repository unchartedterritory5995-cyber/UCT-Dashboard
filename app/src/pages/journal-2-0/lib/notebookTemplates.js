/**
 * Journal 2.0 — Notebook template library (first planned in
 * docs/superpowers/specs/2026-07-12-notebook-templates-plan.md; deepened in wave 12,
 * lane 12B, docs/notebook/WAVE-12-PLAN.md §2.3).
 *
 * The firm-authored, data-aware TipTap scaffolds, grouped by FAMILIES below (how many
 * there are is the length of TEMPLATES, never a number typed here -- this header said
 * "eight in three families" long after it stopped being true). Each `build(ctx)` returns
 * a fresh, valid TipTap doc; `ctx` comes from lib/templateContext.js and every field is
 * optional — a template must always produce a sane doc with a bare `{}` (graceful
 * blanks: no data ⇒ the prompt scaffold, never an error).
 *
 * Node types: ANY type in the Notebook's schema table (lib/notebookSchema.js) may be
 * used, and the rail derives the allowed set from that table rather than a typed list.
 * Wave 12 lifted the old "no tables" rule on purpose: the editor has registered
 * @tiptap/extension-table (and callout and toggle) since wave 6 (lib/tiptap.js), so a
 * table no longer drops on load. ⛔ No template may need a NEW node type — that is a
 * schema change with a never-revert rule (WAVE-12-PLAN.md §3), not a template change.
 * The Notebook-only builders for toggle / callout / table live in lib/templateBlocks.js;
 * the shared lib/tiptapDocBuilders.js stays as it is (the Model Book imports it too).
 *
 * Walkthroughs: every catalog entry carries `walkthrough` (3-5 short steps, data, so a
 * preview can show it), and `build` ends the body with it as a COLLAPSED toggle titled
 * "How to use this template". The gallery's card preview and `templateStructure` skip
 * that toggle (see `templateStructure`), or every card would preview the walkthrough.
 *
 * Keys are STABLE API: trade-review / weekly-plan / daily-prep predate this
 * catalog (P5-B3) and are deep-linkable via /journal/notebook?new=<key>. A key keeps
 * its meaning when its body is deepened (wave 12: trade-review, weekly-review,
 * monthly-review).
 */

import { h, p, labeled, linkP, bullets, hr, doc } from '../../../lib/tiptapDocBuilders'
import { PLAN_ROLES } from './planLevels'
import { callout, isWalkthroughNode, metricTable, table, walkthroughToggle } from './templateBlocks'
// Wave 13 lane 13C-2: the earnings-prep template is built from the SAME scaffold the one-click
// "Create prep note" door uses -- never a second, hand-typed one. See earningsPrepShared.js's
// own header for why this is the shared module and not `earningsPrep.js` itself (a cycle through
// `noteCreation.js` -> `templateContext.js`).
import { buildPrepDoc, prepTitle } from './earningsPrepShared'

// ── Families (picker grouping) ────────────────────────────────────────────────

export const FAMILIES = [
  { key: 'rituals', label: 'Daily & weekly rituals' },
  { key: 'research', label: 'Thesis & research' },
  { key: 'trades', label: 'Around a trade' },
  { key: 'mind', label: 'Mindset' },
]

// ── Trade plans by setup (wave 12) ───────────────────────────────────────────

/**
 * One body for every setup plan, so a member learns the shape once: the regime line,
 * what qualifies, a checklist, the numbers table, the setup's one rule, invalidation and
 * management. Only the words are the setup's own.
 */
function setupPlanBody({ setup, checklist, numbers, rule, invalidation, management }) {
  return (ctx = {}) =>
    doc([
      labeled('Regime:', ctx.regimeLine || '—'),
      h(2, 'The setup'),
      p(setup),
      h(2, 'Checklist'),
      bullets(checklist),
      h(2, 'The numbers'),
      table(['', 'Value', 'Why there'], numbers.map((label) => [label, '', ''])),
      callout('warning', rule),
      hr(),
      h(2, 'Invalidation'),
      p(invalidation),
      h(2, 'Management'),
      bullets(management),
      h(2, 'After the trade'),
      p('When it closes, write a Trade Post-Mortem and link it here.'),
    ])
}

const SETUP_PLANS = [
  {
    key: 'breakout-plan',
    label: 'Base Breakout Plan',
    family: 'trades',
    when: 'A leader is tightening up near a pivot',
    description: 'A base, a pivot, and the volume that proves the breakout is real.',
    tags: ['trade-plan', 'breakout'],
    needs: { regime: true },
    walkthrough: [
      'Check the Regime line first. Breakouts work best in a healthy market.',
      'Go down the checklist. A base that misses two items is not the setup.',
      'Fill the numbers before the open: the pivot, the stop, and the size.',
      'Buy only through the pivot on volume, and no more than a few percent above it.',
      'Write the management plan now, then follow it once you are in.',
    ],
    defaultTitle: (ctx = {}) => (ctx.ticker ? `Breakout Plan — ${ctx.ticker}` : 'Base Breakout Plan'),
    build: setupPlanBody({
      setup: 'A stock in a prior uptrend builds a base: a cup, a flat base, or a series of tighter pullbacks. The pivot is the high of the tightest area, and the trade is the move through it.',
      checklist: [
        'Prior uptrend into the base (a real advance, not a drift)',
        'The pullbacks get smaller from left to right',
        'Volume dries up in the tightest part of the base',
        'Relative strength line at or near new highs',
        'The group is acting well, not just this one name',
      ],
      numbers: ['Pivot (entry)', 'Stop', 'Risk per share', 'First target', 'Shares'],
      rule: 'Buy it at the pivot, not far above it. A late entry turns a normal pullback into a stop-out.',
      invalidation: 'It breaks out, then closes back inside the base on volume. A breakout that cannot hold the pivot is a failed breakout.',
      management: [
        'Stop under the low of the last tight area, or the breakout day low',
        'Sell a first piece into strength at two to three times your risk',
        'Raise the stop to breakeven once the trade has room under it',
        'Trail the rest with a short moving average, such as the 10-day',
      ],
    }),
  },
  {
    key: 'pullback-plan',
    label: 'Pullback / Flag Plan',
    family: 'trades',
    when: 'A leader pulls back to its moving average',
    description: 'An orderly pullback in an uptrend, and the bounce that resumes it.',
    tags: ['trade-plan', 'pullback'],
    needs: { regime: true },
    walkthrough: [
      'Confirm the uptrend before anything else: higher highs and rising averages.',
      'Judge the pullback: light volume and tight candles are what you want.',
      'Pick the trigger: the prior day\'s high, the flag high, or a reclaim of the average.',
      'Fill the numbers with the stop under the pullback low.',
      'If it closes through the average on heavy volume, the plan is off.',
    ],
    defaultTitle: (ctx = {}) => (ctx.ticker ? `Pullback Plan — ${ctx.ticker}` : 'Pullback / Flag Plan'),
    build: setupPlanBody({
      setup: 'A leader in a clear uptrend pulls back in an orderly way to a rising short moving average (the 10- or 21-day), or to the 50-day for the first time. The trade is the bounce that resumes the trend.',
      checklist: [
        'Established uptrend: higher highs, rising averages',
        'Pullback on lighter volume than the advance',
        'Tight, small-range candles near the average',
        'The average is rising, not flattening out',
        'The stock still leads its group',
      ],
      numbers: ['Trigger (entry)', 'Stop', 'Risk per share', 'Prior high (first target)', 'Shares'],
      rule: 'Buy strength off support, not weakness into it. Wait for the bounce to start.',
      invalidation: 'It closes decisively through the average on heavy volume, or undercuts the pullback low.',
      management: [
        'Stop under the pullback low or the average it bounced from',
        'Take a first piece as it retests the prior high',
        'Raise the stop as it makes a new higher low',
        'Exit the rest on a close below the average you used',
      ],
    }),
  },
  {
    key: 'episodic-pivot-plan',
    label: 'Episodic Pivot / Gap Plan',
    family: 'trades',
    when: 'A stock gaps up hard on a real catalyst',
    description: 'A big gap on news and volume, and the opening range that sets the trade.',
    tags: ['trade-plan', 'episodic-pivot'],
    needs: { regime: true },
    walkthrough: [
      'Name the catalyst first. No real news, no episodic pivot.',
      'Check the gap and the premarket volume against the stock\'s normal day.',
      'Let the opening range form, then fill the numbers from it.',
      'Enter on the break of the opening range high, with the stop at the low of the day.',
      'If it fills the gap, step aside. The story did not hold.',
    ],
    defaultTitle: (ctx = {}) => (ctx.ticker ? `Episodic Pivot Plan — ${ctx.ticker}` : 'Episodic Pivot / Gap Plan'),
    build: setupPlanBody({
      setup: 'A real catalyst (an earnings beat and raise, a new product, a big contract) gaps a stock up sharply on very heavy volume. The best ones were quiet or neglected before the news. The trade is the first push after the open.',
      checklist: [
        'A real, company-specific catalyst you can name',
        'A gap of roughly 10% or more',
        'Volume far above normal, already in the premarket',
        'The stock was not already extended before the news',
        'It holds the gap through the first minutes of trading',
      ],
      numbers: ['Opening range high (entry)', 'Low of day (stop)', 'Risk per share', 'Gap fill level', 'Shares'],
      rule: 'The gap is the signal. If it fills the gap, the story did not hold, and neither do you.',
      invalidation: 'It loses the low of the day, or trades back into the gap. Either says the buyers who drove the gap are gone.',
      management: [
        'Stop at the low of the day, or the opening range low',
        'Sell a first piece into the first strong extension',
        'Hold the rest while it stays above the gap-day low',
        'Expect a follow-through day; judge the trade again at the second close',
      ],
    }),
  },
  {
    key: 'undercut-rally-plan',
    label: 'Undercut & Rally Plan',
    family: 'trades',
    when: 'A stock dips under a key low and takes it back',
    description: 'A shakeout under an obvious level, and the reclaim that traps the sellers.',
    tags: ['trade-plan', 'undercut-rally'],
    needs: { regime: true },
    walkthrough: [
      'Name the level being undercut: a prior low, or a key moving average.',
      'Wait. The undercut alone is not the trade.',
      'Enter when the stock reclaims the level, same day or next.',
      'Put the stop just under the undercut low; that is where you are wrong.',
      'If it falls back below the level and stays there, you are out.',
    ],
    defaultTitle: (ctx = {}) => (ctx.ticker ? `Undercut & Rally Plan — ${ctx.ticker}` : 'Undercut & Rally Plan'),
    build: setupPlanBody({
      setup: 'A stock in a healthy uptrend drops under an obvious level, a prior swing low or the 50-day, shaking out the weak holders. Then it reclaims that level on the same or the next day. The trade is the reclaim.',
      checklist: [
        'The undercut level is obvious: everyone is watching it',
        'The stock was in an uptrend before the undercut',
        'The undercut is brief: a day or two, not a breakdown',
        'The reclaim comes on rising volume',
        'The market is not breaking down at the same time',
      ],
      numbers: ['Undercut level', 'Reclaim (entry)', 'Undercut low (stop)', 'Risk per share', 'Shares'],
      rule: 'Enter on the reclaim, never on the undercut. Until the level is back, it is just a breakdown.',
      invalidation: 'It reclaims the level, then closes back below it. The trap failed, and the sellers were right.',
      management: [
        'Stop just under the undercut low',
        'Sell a first piece into the prior high or resistance',
        'Raise the stop to the reclaimed level once it holds a day',
        'Trail the rest with the short moving average',
      ],
    }),
  },
  {
    key: 'parabolic-short-plan',
    label: 'Parabolic Short Plan',
    family: 'trades',
    when: 'A stock has gone vertical and starts to crack',
    description: 'A short against an exhausted run, entered only after the first crack.',
    tags: ['trade-plan', 'parabolic-short'],
    needs: { regime: true },
    walkthrough: [
      'Measure the run: how far, how fast, how far above the 10-day average.',
      'Look for exhaustion, such as a gap up that fades or climax volume.',
      'Wait for the crack: the first red day, or a failed opening range high.',
      'Size small. A short squeeze can run far past any stop you set.',
      'Cover into the first support, such as the 10- or 20-day average.',
    ],
    defaultTitle: (ctx = {}) => (ctx.ticker ? `Parabolic Short Plan — ${ctx.ticker}` : 'Parabolic Short Plan'),
    build: setupPlanBody({
      setup: 'A stock runs straight up for several days, far above its short moving averages, often on a story the market has fallen in love with. The trade is the short after the run shows its first real crack, not before.',
      checklist: [
        'Several up days in a row, far above the 10-day average',
        'Signs of exhaustion: a gap up that fades, or climax volume',
        'The first crack has happened: a red day, or a failed push higher',
        'Shares are available to borrow, and the cost is acceptable',
        'You can name the support it is likely to fall back to',
      ],
      numbers: ['Entry (after the crack)', 'High of day (stop)', 'Risk per share', 'First support (cover)', 'Shares (small)'],
      rule: 'Never short strength. Wait for the first crack, size small, and respect the high of the day.',
      invalidation: 'It reclaims the high of the day. A parabolic stock that makes a new high has not cracked yet.',
      management: [
        'Stop above the high of the day; never move it higher',
        'Cover a first piece at the first support, such as the 10-day average',
        'Cover the rest into the 20-day average or the gap fill',
        'Do not re-short the same run after you are stopped out',
      ],
    }),
  },
]

// ── Position tracker property definitions (wave 12, lane 12B-2) ──────────────

/**
 * The definitions the Position Tracker declares, as DATA. `key` is this template's own
 * handle; `name` is what the member sees and how an existing definition is reused (same
 * name, same type). A formula names its inputs `{Name}` by these canonical names, and
 * lib/templatePropertyDefs.js rewrites each to the id of the definition it resolved to
 * (`{@id}`), so a reused or renamed-on-conflict input can never be ambiguous.
 *
 * `starter` names one of the 11B trader starter formulas (lib/formula/computed.js
 * STARTER_FORMULAS) and takes its expression from there, never a copy typed here.
 * Position size has no starter over these inputs (the starter's reads `Account risk`),
 * so its expression is its own: the position's cost as a percent of the account.
 * ⛔ Not imported here: this module is bundled for the hub and for a plain-Node rail
 * (tests/test_notebook_builtin_templates_create.py), and stays free of the formula engine.
 */
const POSITION_TRACKER_PROPERTIES = Object.freeze([
  { key: 'entry', name: 'Entry', type: 'number' },
  { key: 'stop', name: 'Stop', type: 'number' },
  { key: 'exit', name: 'Exit', type: 'number' },
  { key: 'shares', name: 'Shares', type: 'number' },
  { key: 'account', name: 'Account size', type: 'number' },
  { key: 'r_multiple', name: 'R-multiple', type: 'formula', starter: 'r_multiple' },
  { key: 'risk_per_share', name: 'Risk per share', type: 'formula', starter: 'risk_per_share' },
  {
    key: 'position_size', name: 'Position size %', type: 'formula',
    expression: 'round({Shares} * {Entry} / {Account size} * 100, 2)',
  },
].map((d) => Object.freeze(d)))

/**
 * Wave 13 lane 13A: the Trade Plan's four plan levels as NUMBER properties, so a plan is read
 * by the grader (api/services/journal_two/plan_extract.py, the one reader) without parsing
 * prose. Named from the one role vocabulary (lib/planLevels.js, pinned to plan_extract's
 * PLAN_ROLES), so "Entry" here and "Entry" in the reader cannot drift. Same names and type as
 * the Position Tracker's, so the two templates share the member's definitions (reused by name).
 */
const TRADE_PLAN_PROPERTIES = Object.freeze(PLAN_ROLES.map((role) => Object.freeze({
  key: role, name: role[0].toUpperCase() + role.slice(1), type: 'number',
})))

// ── The catalog (TEMPLATES, below, is this with each walkthrough appended) ────

const CATALOG = [
  {
    key: 'daily-prep',
    label: 'Daily Game Plan',
    family: 'rituals',
    when: 'Before the open',
    description: 'Regime, levels, scenarios, and your risk budget for the day.',
    tags: ['game-plan'],
    needs: { regime: true, positions: true },
    walkthrough: [
      'Write it before the open, not after the first trade.',
      'The regime line and your open positions fill in from your data. Check they match what you see.',
      'Write each scenario as "if X happens, I do Y", with the price that sets it off.',
      'Set the daily stop as a number. When you hit it, you are done for the day.',
      'After the close, start a Post-Market Debrief. It quotes this plan back to you.',
    ],
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
    walkthrough: [
      'Write it the same day, within an hour of the close.',
      'The top section quotes today\'s Daily Game Plan when you wrote one. Grade each trade against it.',
      'Name the process wins even on a red day, and the leaks even on a green one.',
      'End with one thing to do differently at the next open, and put it in tomorrow\'s plan.',
    ],
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
    walkthrough: [
      'Write it over the weekend or before Monday\'s open.',
      'Start from the market: regime, breadth, and which groups are leading.',
      'List three A+ setups at most, each with the trigger you are waiting for.',
      'Fit the risk plan to the regime: smaller in a choppy tape, normal in a healthy one.',
      'At the end of the week, grade it in a Weekly Review.',
    ],
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
    walkthrough: [
      'Fill the numbers table first, straight from your journal, before any opinions.',
      'Check last week\'s ONE commitment honestly: kept or not.',
      'Count your plan adherence: trades on the plan, stops honored.',
      'Patterns and leaks come from several trades, never from one.',
      'Write next week\'s ONE commitment like a rule and carry it into the Weekly Plan.',
    ],
    defaultTitle: (ctx = {}) => `Weekly Review — wk of ${ctx.weekOfText || 'this week'}`,
    build: () =>
      doc([
        h(2, 'The numbers'),
        p('Straight from the journal, before any opinions.'),
        metricTable([
          'Trades taken',
          'Wins / losses',
          'Net R',
          'Average winner (R)',
          'Average loser (R)',
          'Largest loss (R)',
        ]),
        h(2, "Last week's commitment"),
        p('What did you commit to last week, and did you keep it? Yes or no, then one line on why.'),
        h(2, 'Plan adherence'),
        bullets([
          'Trades that were on the weekly plan: — of —',
          'Stops honored as planned: — of —',
          'Biggest rule break: —',
        ]),
        h(2, 'The market this week'),
        p('Regime, breadth, and which groups led. Did your trading fit the tape, or fight it?'),
        h(2, 'Best and worst trade'),
        bullets(['Best trade & why: —', 'Worst trade & why: —']),
        hr(),
        h(2, 'Three strongest patterns'),
        bullets(['—', '—', '—']),
        h(2, 'Three biggest leaks'),
        bullets(['—', '—', '—']),
        callout('note', 'A pattern needs at least two trades behind it. One trade is an anecdote.'),
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
    walkthrough: [
      'Do it after the month closes, with that month\'s weekly reviews open beside it.',
      'Fill the numbers table, then the edge-by-setup table: one row per setup you traded.',
      'Look for what repeated across the weeks, not the single best or worst trade.',
      'Check whether last month\'s change stuck before you choose a new one.',
      'Pick one change only: sizing, setups, or process.',
    ],
    defaultTitle: (ctx = {}) => `Monthly Review — ${ctx.dateShort || 'this month'}`,
    build: () =>
      doc([
        h(2, 'The month in numbers'),
        p('Fill these from the journal first; the opinions come after.'),
        metricTable([
          'Net P&L',
          'Net R',
          'Trades taken',
          'Win rate',
          'Average winner / average loser (R)',
          'Largest drawdown in the month',
        ]),
        h(2, 'Edge by setup'),
        table(['Setup', 'Trades', 'Win rate', 'Net R'], [['', '', '', ''], ['', '', '', ''], ['', '', '', '']]),
        h(2, "Last month's change"),
        p('Did the one change you committed to last month stick? What did it do to the numbers?'),
        h(2, 'Best and worst trade'),
        bullets(['Best trade & why: —', 'Worst trade & why: —']),
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
    walkthrough: [
      'Use the three monthly reviews as your source.',
      'Edge by setup: keep what carried the quarter, question what cost more than it earned.',
      'Reread your trading plan and ask whether it still fits your account and your schedule.',
      'Set process goals for next quarter, not P&L targets.',
    ],
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
    walkthrough: [
      'Set Long or Short in the Research Type property, not in the text.',
      'Write the bear case as strongly as the bull case.',
      'Name what would prove you wrong as a price, a number, or an event.',
      'Link supporting and opposing notes in the Thesis Evidence section as you find them.',
    ],
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
    walkthrough: [
      'Start with why money is moving into or out of the theme right now.',
      'Name the leaders and the laggards, and say why for each.',
      'Write down what would confirm the theme is real, so you can check it later.',
      'Finish with the trade: the name with the best structure and the setup you want.',
    ],
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
    key: 'sector-note',
    label: 'Sector Note',
    family: 'research',
    when: 'Your weekly or biweekly check on a group',
    description: 'Where a group stands, which names lead it, and where the money is moving.',
    tags: ['sector-note'],
    needs: {},
    walkthrough: [
      'Name the sector or its ETF at the top, and date the note.',
      'Read the group\'s trend against its 50- and 200-day lines, and its strength against SPY.',
      'Fill the leaders table with the strongest three to five names and the setup each is in.',
      'Write what would change your mind about the group.',
      'Write a new Sector Note every week or two and compare it with the last one.',
    ],
    defaultTitle: (ctx = {}) => `Sector Note — ${ctx.ticker || ctx.dateShort || 'this week'}`,
    build: () =>
      doc([
        labeled('Sector / ETF:', '—'),
        h(2, 'Where the group stands'),
        bullets([
          'Trend: above or below the 50- and 200-day lines: —',
          'Relative strength against SPY: rising, flat, or falling: —',
          'Breadth inside the group: how many names are acting well: —',
        ]),
        h(2, 'Leaders'),
        table(['Ticker', 'Setup', 'Relative strength', 'Level to watch'], [
          ['', '', '', ''],
          ['', '', '', ''],
          ['', '', '', ''],
        ]),
        h(2, 'Laggards'),
        p('The weakest names, and whether they are dragging the group or just left behind.'),
        hr(),
        h(2, 'Money flow'),
        p('Is money rotating into the group or out of it? Volume, gaps, and how the leaders react to news.'),
        h(2, 'What would change my mind'),
        p('The price action or event that would flip your read on the group.'),
        h(2, 'Names to act on'),
        p('The one or two names worth a Trade Plan this week, and the trigger for each.'),
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
    walkthrough: [
      'Write it the day the name goes on your list.',
      'Describe the setup forming and the level that matters.',
      'The trigger is the exact price or event that turns watching into trading.',
      'When it triggers, start a Trade Plan for it.',
    ],
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
    walkthrough: [
      'Record the event, its date, and what the market expects.',
      'Before the event, write what you do on a beat, a miss, and an in-line report.',
      'Decide your position going in, and say why.',
      'After the event, fill in the update and compare the reaction with your scenarios.',
    ],
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
    key: 'earnings-prep',
    label: 'Earnings Prep',
    family: 'research',
    when: 'The days before a company reports',
    description: 'The expectations, the reaction history, and what to listen for, before the report.',
    tags: ['earnings', 'earnings-prep'],
    // Wave 13 lane 13C-2: declares the SAME draft the one-click "Create prep note" door fetches
    // (earningsPrepShared.js::requestPrepDraft, through templateContext.js::
    // assembleTemplateContext) when a ticker is already known -- the same values, the same
    // "Source, as of" lines, the same cap. No ticker given ⇒ no fetch at all; `build` below
    // still renders the FULL scaffold, every cell an honest "not available" (never a second,
    // hand-typed placeholder body).
    needs: { earningsPrepDraft: true },
    walkthrough: [
      'Fill the report date and the expectations table from the consensus and last year\'s numbers.',
      'Fill the last four reactions: the gap, and where the stock closed that day.',
      'List the two or three things the market will listen for beyond the headline numbers.',
      'Note where the stock sits going in: in a base, extended, or broken.',
      'If you will trade the report, size it in an Earnings Play Plan.',
    ],
    // Bare / ticker-only (no draft fetched yet): the old static title, unchanged. A real draft
    // (fetched because a ticker was already known) gets the one-click door's own title --
    // symbol plus the report day, exactly as `earningsPrep.js::createEarningsPrepNote` titles it.
    defaultTitle: (ctx = {}) => (ctx.earningsPrepDraft
      ? prepTitle(ctx.earningsPrepDraft)
      : (ctx.ticker ? `Earnings Prep — ${ctx.ticker}` : 'Earnings Prep')),
    // `buildPrepDoc({})` is already proven to build a whole, valid, all-missing doc in the real
    // editor schema (earningsPrep.test.js) -- the exact doc a ticker-less pick renders here.
    build: (ctx = {}) => buildPrepDoc(ctx.earningsPrepDraft || {}),
  },
  {
    key: 'ipo-notes',
    label: 'IPO / New Issue Notes',
    family: 'research',
    when: 'A new listing hits the tape',
    description: 'The business, the float, and whether it belongs on a fresh-issue watchlist.',
    tags: ['ipo'],
    needs: {},
    walkthrough: [
      'Write down the business and why it is coming public now.',
      'Record the float, the lockup date, and the pricing against the range.',
      'Watch the first days and describe the base it builds, or fails to.',
      'Wait for a proper base, or enough time, before you consider a trade.',
    ],
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
    walkthrough: [
      'Fill in "Who / what" first.',
      'Capture the key points while you listen; tidy them afterward.',
      'Note the tone, not just the words.',
      'Before you close the note, write the one thing that mattered and any follow-up.',
    ],
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
    walkthrough: [
      'Write it right after the trade closes, while you still remember the decisions.',
      'Fill the plan-versus-actual table from your order history.',
      'Grade the setup, the entry, and the exit separately. A losing trade can be a good trade.',
      'Name what went right and what went wrong as decisions, not outcomes.',
      'End with one lesson you can carry into the next trade.',
    ],
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
        h(2, 'Plan versus what happened'),
        table(['', 'Plan', 'Actual'], [
          ['Entry', '', ''],
          ['Stop', '', ''],
          ['Exit', '', ''],
          ['Size', '', ''],
          ['Result (R)', '', ''],
        ]),
        h(2, 'Grade the trade'),
        bullets([
          'Setup quality (A / B / C): —',
          'Entry execution: —',
          'Exit execution: —',
          'Followed the plan? —',
        ]),
        callout('info', 'Grade the decisions, not the P&L. A well-run loser is a good trade; a lucky winner is not.'),
        hr(),
        h(2, 'What went right'),
        p('What did you execute well — regardless of the outcome?'),
        h(2, 'What went wrong'),
        p('Where did process break down? Be specific and honest.'),
        h(2, 'What the market was doing'),
        p('Index trend, the group the stock belongs to, and whether either helped or hurt the trade.'),
        h(2, 'Would I take it again?'),
        p('Same setup, same conditions: yes or no, and what you would change.'),
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
    walkthrough: [
      'Start it the day you enter.',
      'Your open positions fill in at the top when you have any. Otherwise, write the position in.',
      'Add a dated block each day the position is open: thesis, stop, action.',
      'When the trade closes, write a Trade Post-Mortem.',
    ],
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
    walkthrough: [
      'Fill in the report date, the expected move, and the last four reactions.',
      'Choose the play: hold through, enter after the reaction, or sit out.',
      'Size so the worst gap is survivable. A stop does not protect you overnight.',
      'Write the invalidation before the report, not after it.',
    ],
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
    propertyDefinitions: TRADE_PLAN_PROPERTIES,
    walkthrough: [
      'Write it before you place the order.',
      'Fill in entry, stop, target, and size as numbers.',
      'Invalidation is the thesis failing, which can come before the stop.',
      'Decide now how you will scale out, trail, or add.',
      'For a base breakout, a pullback, a gap, an undercut, or a parabolic short, that setup\'s own plan goes deeper.',
    ],
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
  ...SETUP_PLANS,
  {
    key: 'position-sizing-worksheet',
    label: 'Position Sizing Worksheet',
    family: 'trades',
    when: 'Sizing a position before you enter',
    description: 'Work the math once, in writing, instead of eyeballing it under pressure.',
    tags: ['sizing'],
    needs: {},
    walkthrough: [
      'Fill in account size, risk percent, entry, and stop.',
      'Risk per share is entry minus stop.',
      'Shares = account x risk percent / risk per share.',
      'Check the total open risk across every position before you enter.',
    ],
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
    // Wave 12, lane 12B-2: the one template that declares PROPERTY DEFINITIONS, so the
    // 11B formulas come wired in. Applying it (NotebookTab's createFromTemplate, through
    // lib/templatePropertyDefs.js) creates or reuses the member's definitions, then the
    // note. With NOTEBOOK_FORMULAS_ENABLED off the formulas are left out and the note is
    // still made. ⛔ The field is `propertyDefinitions`, never `properties`: `properties`
    // means VALUES and opens the guarded second write in noteCreation.js, which the hub's
    // write-path rails (hub/writePathsTransitive.test.js) forbid any template to declare.
    key: 'position-tracker',
    label: 'Position Tracker',
    family: 'trades',
    when: 'Holding a position, from entry to exit',
    description: 'Entry, stop, shares and exit as properties, with R-multiple, risk per share and position size worked out.',
    tags: ['position'],
    needs: {},
    propertyDefinitions: POSITION_TRACKER_PROPERTIES,
    walkthrough: [
      'Type Entry, Stop, Shares and Account size into the properties at the top of the note.',
      'Risk per share and Position size % work themselves out from those numbers.',
      'Log every add, trim and stop move in the management table, with the reason.',
      'When you close, type the Exit price. R-multiple fills in from Entry, Stop and Exit.',
      'Open the Table view and sort by R-multiple to compare your positions.',
    ],
    defaultTitle: (ctx = {}) => (ctx.ticker ? `Position — ${ctx.ticker}` : 'Position Tracker'),
    build: () =>
      doc([
        callout('info', 'The numbers live in this note\'s properties, above the body: Entry, Stop, Shares and Account size, and Exit once you close.'),
        h(2, 'Why I own it'),
        p('The setup, the catalyst, and what the market was doing when you bought.'),
        h(2, 'The plan'),
        bullets([
          'Where I add, and what has to be true first',
          'Where I take a first piece',
          'What makes me sell the rest',
        ]),
        h(2, 'Management log'),
        table(['Date', 'Action', 'Price', 'Why'], [['', '', '', '']]),
        hr(),
        h(2, 'The exit'),
        p('Type the Exit price above, then write a Trade Post-Mortem and link it here.'),
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
    walkthrough: [
      'Name the setup and describe it well enough to recognize it cold.',
      'Write the entry criteria, including what disqualifies it.',
      'Record the typical stop and how you take profits.',
      'Link trade reviews of this setup here as you take it.',
    ],
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
    walkthrough: [
      'Start with the view: direction or volatility, and the time it needs.',
      'Fill in the structure: strategy, strikes, expiration, debit or credit, max risk.',
      'Think through time decay and implied volatility before the trade, especially around a catalyst.',
      'Write the exit for both outcomes, profit and loss.',
    ],
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
    walkthrough: [
      'Use it before you size up, and once a week.',
      'Your open positions fill in at the top when you have any.',
      'Answer each portfolio question with a number.',
      'End with an action: trim, hedge, or do not add.',
    ],
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
    walkthrough: [
      'Write it the day it happens.',
      'Name the rule precisely.',
      'Record the sequence of decisions and what it cost.',
      'Search your earlier entries for the same rule.',
      'Write one concrete change that stops it next time.',
    ],
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
    walkthrough: [
      'Keep one running note for your lessons.',
      'Add one lesson per entry, and date it.',
      'Link back to the trade or note it came from.',
      'Reread it before each new week.',
    ],
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
    walkthrough: [
      'Write goals you control: actions, not P&L.',
      'For each goal, say how you will know it was kept.',
      'Set a review date, and grade yourself honestly on it.',
    ],
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
    walkthrough: [
      'Write it before your next trade, not during one.',
      'Fill in where things stand, with numbers.',
      'Cut size first, and write the reduced size as a number.',
      'Name the one thing to fix.',
      'Say exactly what earns the full size back.',
    ],
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
    walkthrough: [
      'Use it the moment a trade goes sideways.',
      'Three fields, sixty seconds: what happened, the mistake, the cost in R.',
      'Then step away. Writing this note was the disciplined move.',
    ],
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

/**
 * Every catalog entry, with its `build` ending the body in the walkthrough: a COLLAPSED
 * toggle titled "How to use this template" (lib/templateBlocks.js). The steps stay on the
 * entry as data (`walkthrough`), so a preview can show them without building a doc.
 */
function withWalkthrough(entry) {
  const body = entry.build
  const steps = entry.walkthrough
  if (!Array.isArray(steps) || steps.length === 0) return entry
  return {
    ...entry,
    build: (ctx = {}) => {
      const d = body(ctx)
      return doc([...((d && d.content) || []), walkthroughToggle(steps)])
    },
  }
}

export const TEMPLATES = CATALOG.map(withWalkthrough)

/** Lookup a template by its stable key. */
/**
 * Lane KEYS3 (Q2): does this template ask for a ticker? DERIVED from the template's own title:
 * it does when a known ticker changes the title ("Investment Thesis" becomes "NVDA Thesis").
 * No second list beside the catalog. A note made from such a template with no ticker known
 * opens with focus in its Ticker field (tabs/NotebookTab.jsx).
 */
export function templateWantsTicker(tpl) {
  if (!tpl || typeof tpl.defaultTitle !== 'function') return false
  try {
    return tpl.defaultTitle({ ticker: 'ZZZZ' }) !== tpl.defaultTitle({})
  } catch {
    return false
  }
}

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
  // Wave 13 lane 13C-2: left `null`, matching `emptyTemplateContext()`'s own default -- a draft
  // is either the real, fetched shape or absent, never a marked placeholder object (nothing in
  // `buildPrepDoc` reads a truthy-but-fake draft as "has data"; every cell checks `value`).
  earningsPrepDraft: null,
})

/**
 * A template's STRUCTURE: the top-level blocks it writes whatever the member's data
 * is -- the blocks of `build({})` that `build(STRUCTURE_PROBE_CONTEXT)` also writes,
 * identically, in `build({})`'s order. What only the no-data branch writes ("No game
 * plan found for today -- ...", "Regime: --", the placeholder position list) and what
 * only data writes are both left out: neither is the note the member will get.
 *
 * ⛔ The walkthrough toggle is left out too (wave 12, lane 12B). It is in every build,
 * data or not, so the comparison above would keep it -- and the gallery's preview, which
 * reads THIS, would then preview "How to use this template" instead of the template.
 * This is the ONE place it is skipped; `templatePreview` inherits it. The rail
 * (notebookTemplates.test.js, "the preview never shows the walkthrough") is
 * mutation-proved against removing this filter.
 */
export function templateStructure(tpl) {
  if (!tpl || typeof tpl.build !== 'function') return []
  const withData = new Set((tpl.build(STRUCTURE_PROBE_CONTEXT)?.content || []).map((n) => JSON.stringify(n)))
  return (tpl.build({})?.content || [])
    .filter((n) => !isWalkthroughNode(n))
    .filter((n) => withData.has(JSON.stringify(n)))
}

/**
 * The first lines of a template, from its STRUCTURE (templateStructure above): the
 * headings and prompts it writes for every member, never its no-data scaffold, and
 * never a second, hand-typed description. A line is
 * `{ kind: 'heading' | 'text' | 'bullet', text }`; empty paragraphs, rules and tables
 * are skipped (a table's text joined into one line reads as noise, "EntryPlanActual..."),
 * a list contributes one line per item. A template whose structure yields no line has
 * no preview -- the card shows its description alone.
 */
export function templatePreview(tpl, maxLines = PREVIEW_LINES) {
  const lines = []
  const push = (kind, text) => {
    const t = clip(text)
    if (t && lines.length < maxLines) lines.push({ kind, text: t })
  }
  for (const node of templateStructure(tpl)) {
    if (lines.length >= maxLines) break
    if (node.type === 'table') continue
    if (node.type === 'heading') push('heading', nodeText(node))
    else if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
      for (const item of node.content || []) push('bullet', nodeText(item))
    } else if (node.type !== 'horizontalRule') push('text', nodeText(node))
  }
  return lines
}
