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
 * catalog (P5-B3) and are deep-linkable via ?seg=notebook&new=<key>.
 */

import { h, p, labeled, linkP, bullets, hr, doc } from '../../../lib/tiptapDocBuilders'

// ── Families (picker grouping) ────────────────────────────────────────────────

export const FAMILIES = [
  { key: 'rituals', label: 'Daily & weekly rituals' },
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
              linkP(`Open “${gp.title}” →`, `/journal/journal?seg=notebook&note=${gp.id}`),
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
