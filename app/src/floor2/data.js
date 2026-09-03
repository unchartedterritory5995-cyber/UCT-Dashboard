// Mock dataset for the prototype. Realistic UCT trading-community conversations
// with nested replies and a wide spread of ages so we can show that old threads
// stay alive and searchable. No backend — this is the seed the UI mutates.

export const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// ---- People -----------------------------------------------------------------
export const USERS = {
  mentor: { id: 'mentor', name: 'UCT Mentor', handle: 'uct', role: 'mentor', color: '#c9a84c', initials: 'UT' },
  blake: { id: 'blake', name: 'Blake', handle: 'blake', role: 'mentor', color: '#6ea8fe', initials: 'BL' },
  dana: { id: 'dana', name: 'Dana R.', handle: 'danaR', role: 'member', color: '#4ade80', initials: 'DR' },
  marcus: { id: 'marcus', name: 'Marcus', handle: 'mvols', role: 'member', color: '#f472b6', initials: 'MK' },
  priya: { id: 'priya', name: 'Priya', handle: 'priyaT', role: 'member', color: '#22d3ee', initials: 'PT' },
  sam: { id: 'sam', name: 'Sam', handle: 'swings_sam', role: 'member', color: '#fb923c', initials: 'SM' },
  leo: { id: 'leo', name: 'Leo', handle: 'leo_charts', role: 'member', color: '#a78bfa', initials: 'LO' },
  nina: { id: 'nina', name: 'Nina', handle: 'ninaK', role: 'member', color: '#f87171', initials: 'NK' },
  you: { id: 'you', name: 'You', handle: 'you', role: 'member', color: '#94a3b8', initials: 'ME' },
}

// ---- Categories (the ONE simple axis of organization) -----------------------
export const CATEGORIES = [
  { key: 'all', label: 'Home', icon: 'home' },
  { key: 'questions', label: 'Questions', icon: 'help', flair: 'Question' },
  { key: 'discussion', label: 'Discussion', icon: 'chat', flair: 'Discussion' },
  { key: 'ideas', label: 'Trade Ideas', icon: 'bulb', flair: 'Trade Idea' },
  { key: 'wins', label: 'Wins & Lessons', icon: 'trophy', flair: 'Lesson' },
  { key: 'education', label: 'Deep Dives', icon: 'book', flair: 'Deep Dive' },
]

// Flair colors use the app's semantic tokens so they blend with the rest of the
// site (info/gain/gold + neutral), not an off-palette rainbow.
export const FLAIR = {
  Question: { color: 'var(--info)', bg: 'var(--info-bg)', border: 'var(--info-border)' },
  Discussion: { color: 'var(--text-muted)', bg: 'var(--bg-hover)', border: 'var(--border-accent)' },
  'Trade Idea': { color: 'var(--gain)', bg: 'var(--gain-bg)', border: 'var(--gain-border)' },
  Lesson: { color: 'var(--ut-gold-bright)', bg: 'var(--ut-gold-dim)', border: 'var(--ut-gold-glow)' },
  'Deep Dive': { color: 'var(--ut-cream)', bg: 'var(--ut-gold-dim)', border: 'var(--ut-gold-glow)' },
  Answered: { color: 'var(--gain)', bg: 'var(--gain-bg)', border: 'var(--gain-border)' },
}

let _c = 0
const cid = () => `c${++_c}`
// comment(author, ago, body, votes, reactions, replies, chart)
const cm = (author, ago, body, votes = 0, reactions = [], replies = [], chart = null) => ({
  id: cid(), author, createdAt: NOW - ago, body, votes, myVote: 0,
  reactions: reactions.map((r) => ({ ...r, reacted: false })), replies, chart,
})
const rx = (emoji, count) => ({ emoji, count })

// A tiny inline-SVG "screenshot" so image attachments have an example to render.
export const SAMPLE_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='560' height='300' viewBox='0 0 560 300'%3E%3Crect width='560' height='300' fill='%23101012'/%3E%3Cg stroke='%232a2c31'%3E%3Cline x1='0' y1='75' x2='560' y2='75'/%3E%3Cline x1='0' y1='150' x2='560' y2='150'/%3E%3Cline x1='0' y1='225' x2='560' y2='225'/%3E%3C/g%3E%3Cpolyline fill='none' stroke='%2334d17c' stroke-width='2.5' points='20,240 90,210 160,222 230,168 300,182 370,120 440,92 520,52'/%3E%3Ctext x='20' y='34' fill='%23dcbb5e' font-family='sans-serif' font-size='18' font-weight='700'%3E%24AMD 1D%3C/text%3E%3Ctext x='20' y='286' fill='%236b7280' font-family='sans-serif' font-size='12'%3Emy annotated screenshot%3C/text%3E%3C/svg%3E"

// ---- Posts ------------------------------------------------------------------
let _p = 0
const pid = () => `p${++_p}`

export const SEED_POSTS = [
  {
    id: pid(), author: 'dana', category: 'questions', flair: 'Question',
    title: 'How do you handle a gap-up on a swing you already own — trim, hold, or add?',
    body: [
      'Woke up to $NVDA gapping +6% on a position I entered last week near the 10-EMA. My rules say let winners run, but a 6% gap into resistance makes me want to trim half.',
      'For those of you who trade the UCT style — do you have a mechanical rule for gap-ups, or is it discretionary? Trying to stop leaving money on the table by panic-trimming.',
    ],
    tickers: ['NVDA'], createdAt: NOW - 3 * HOUR, votes: 47, myVote: 0, saved: false, pinned: false,
    reactions: [rx('🔥', 12), rx('🧠', 5)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('mentor', 2.5 * HOUR,
        ['Great question — this is a discipline problem disguised as a tactics problem. Rule of thumb we teach: a gap in your favor is not a signal to act, it is a signal to REVISIT your stop.',
          'If the gap holds above the prior day high through the first 30 min, trail your stop up to breakeven+ and let it work. If it fills back into the range, THAT is your trim. Never trim into strength on the open — you are paying the spread and fighting the trend you already got right.'],
        63, [rx('💯', 21), rx('🙌', 8)], [
          cm('dana', 2.2 * HOUR, ['This reframes it completely — I keep treating the gap as the event when the real event is whether it holds. Trailing to BE+ on the 30-min hold makes total sense.'], 18, [rx('🔥', 3)]),
          cm('marcus', 2 * HOUR, ['Adding to this: I bracket the first 5-min bar. Break of the 5-min low = trim signal, break of the 5-min high = add-back. Keeps me from freelancing on the open.'], 24, [rx('🧠', 9)], [
            cm('mentor', 1.8 * HOUR, ['Exactly right. The opening range is doing the thinking for you. The only thing I would add — size the add-back smaller than the original. You are adding to a winner, not starting a new trade.'], 15, [rx('💯', 6)]),
            cm('priya', 1.1 * HOUR, ['Do you use the 5-min OR even on a slow name, or only on high-ADR movers? On low-ADR stuff the 5-min range is so tight it whipsaws me.'], 6, [], [
              cm('marcus', 55 * MIN, ['Only on movers. On low-ADR I widen to the 15-min bar. ADR is the whole game here — the tool has to match the vehicle.'], 9, [rx('👀', 2)]),
            ]),
          ], { ticker: 'NVDA', tf: '5m', caption: 'First 5-min bar bracketed — a break of its low is my trim signal.' }),
        ]),
      cm('sam', 1.9 * HOUR, ['Contrarian take: on a parabolic 3rd-day gap I DO trim into it, because the odds of a red-day reversal are high and I would rather book the gift. Context matters — day 1 gap vs day 3 gap are different animals.'], 31, [rx('👀', 7), rx('🔥', 4)], [
        cm('dana', 1.5 * HOUR, ['Fair — this is day 2 of the move so probably still fine to hold. The day-count framing is helpful.'], 8, []),
      ]),
    ],
  },
  {
    id: pid(), author: 'leo', category: 'ideas', flair: 'Trade Idea',
    title: '$PLTR high-tight-flag setting up — levels + invalidation inside',
    body: [
      'Textbook HTF forming on $PLTR daily. 3 weeks of orderly consolidation after a ~55% pole, volume drying up beautifully.',
      'Entry: over 84.20 (prior day high) on volume. Stop: 79.80 (below the flag low). First target: measured move ~96. Invalidation: any close back below the 20-EMA.',
      'Not advice, just how I am framing it. Curious if anyone sees the same or if I am forcing it.',
    ],
    tickers: ['PLTR'], createdAt: NOW - 9 * HOUR, votes: 38, myVote: 0, saved: true, pinned: false,
    chart: { ticker: 'PLTR', tf: '1D', caption: 'Daily — 3 weeks of contraction after a ~55% pole. Trigger over 84.20, stop 79.80.' },
    reactions: [rx('🚀', 14), rx('💎', 6)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('priya', 8 * HOUR, ['Volume contraction is clean. Only thing I would watch — market regime. HTFs fail a lot when breadth is rolling over. What is the UCT exposure read right now?'], 22, [rx('🧠', 5)], [
        cm('blake', 7.5 * HOUR, ['Exposure is constructive but not aggressive as of this morning. I would take the breakout but at 2/3 size until we see follow-through. The setup is A-grade, the environment is B.'], 19, [rx('💯', 7)]),
      ]),
      cm('nina', 6 * HOUR, ['In at 84.35, stop set. Thanks for the clean writeup Leo.'], 11, [rx('🙌', 4)], [], { ticker: 'PLTR', tf: '1D', caption: 'Filled 84.35 on the break — stop parked under the flag low.' }),
    ],
  },
  {
    id: pid(), author: 'mentor', category: 'education', flair: 'Deep Dive',
    title: 'Position sizing is the only edge most traders never actually tighten',
    body: [
      'A thread on the thing that quietly separates the consistently profitable from the perpetually break-even: sizing to a FIXED risk, not a fixed share count or fixed dollar amount.',
      'If your stop is 4% away, your position is smaller than when your stop is 2% away — so that every trade risks the SAME slice of your account (we cap at 2%). This is what lets you take a string of losers without flinching and press winners without blowing up.',
      'Reply with your current sizing rule and I will tell you where it leaks.',
    ],
    tickers: [], createdAt: NOW - 2 * DAY, votes: 121, myVote: 0, saved: false, pinned: true,
    reactions: [rx('🔥', 41), rx('🧠', 28), rx('💯', 19)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('sam', 1.9 * DAY, ['I risk a flat $500 per trade regardless of stop distance. Where does that leak?'], 14, [], [
        cm('mentor', 1.8 * DAY, ['It leaks on your TIGHT-stop trades — the ones with the best R:R. A flat $500 means your best setups (tight stops) get the same risk as your sloppy ones, so you are UNDER-betting your edge. Convert $500 into "2% of account" and your share count moves with the stop. Same dollars at risk, more shares on the A+ setups.'], 33, [rx('🤯', 11), rx('💯', 6)]),
      ]),
      cm('priya', 1.6 * DAY, ['This is the post that changed my year. Went from fixed-shares to fixed-risk in March and my drawdowns got half as deep even with the same win rate.'], 27, [rx('🙌', 9)]),
    ],
  },
  {
    id: pid(), author: 'marcus', category: 'discussion', flair: 'Discussion',
    title: 'Anyone else find the first 15 minutes are where they do the most damage?',
    body: [
      'Reviewed 3 months of my journal this weekend. 80% of my losing trades were entered in the first 15 minutes. My afternoon trades are net green.',
      'Thinking about a hard rule: no new entries before 9:45. Anyone run something like this? Did it help or did you just find new ways to lose money at 10am?',
    ],
    tickers: [], createdAt: NOW - 5 * DAY, votes: 64, myVote: 0, saved: false, pinned: false,
    reactions: [rx('😂', 18), rx('🧠', 12)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('dana', 4.8 * DAY, ['"or did you just find new ways to lose money at 10am" — felt that in my soul. I did the no-entry-before-9:45 rule for a month. Helped a lot, but honestly the real fix was smaller size on opens, not banning them.'], 29, [rx('😂', 14), rx('💯', 5)]),
      cm('leo', 4.5 * DAY, ['The open is not the problem, chasing extended opens is. I let the OR set for 5 min, then only take pullbacks to the rising VWAP. Cut my morning losers by more than half.'], 21, [rx('🧠', 8)], [
        cm('marcus', 4.4 * DAY, ['VWAP pullback vs OR breakout — I keep taking the breakout and getting the fade. Going to flip to pullbacks-only for two weeks and journal it. Thanks Leo.'], 12, []),
      ]),
      cm('blake', 4.2 * DAY, ['This is the single most common leak we see. It is almost never the strategy — it is the clock plus size. Great self-review Marcus, this is exactly the work.'], 18, [rx('🙌', 6)]),
    ],
  },
  {
    id: pid(), author: 'nina', category: 'wins', flair: 'Lesson',
    title: 'Took a full stop-out today and felt totally fine about it — small win worth sharing',
    body: [
      'A month ago a clean 1R stop would have ruined my afternoon and led to revenge trades. Today $SOFI hit my stop, I closed it, logged it, and moved on. No revenge trade.',
      'The trade was a loser but the PROCESS was an A. Wanted to post it because we celebrate green P&L here but almost never celebrate discipline. This felt bigger than the loss.',
    ],
    tickers: ['SOFI'], createdAt: NOW - 6 * DAY, votes: 88, myVote: 0, saved: false, pinned: false,
    reactions: [rx('🙌', 33), rx('💯', 15), rx('🫡', 9)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('mentor', 5.9 * DAY, ['THIS is the win. A clean 1R stop taken without drama is a professional act. The P&L of any single trade is noise; the P&L of your discipline compounds for a career. Framed and pinned in spirit.'], 41, [rx('🫡', 12), rx('🔥', 8)]),
      cm('priya', 5.5 * DAY, ['Needed to read this today, thank you for posting the loss. We hide those and they are the most useful ones.'], 16, [rx('🙌', 5)]),
    ],
  },
  {
    id: pid(), author: 'priya', category: 'questions', flair: 'Question',
    title: 'What is the actual difference between a VCP and a plain flag? Keep mixing them up',
    body: [
      'I understand both are consolidations after a move, but I keep labeling flags as VCPs. Is it just the number of contractions, or is there something structural I am missing?',
      'Examples welcome if anyone has clean charts of each side by side.',
    ],
    tickers: [], createdAt: NOW - 3 * 30 * DAY, votes: 52, myVote: 0, saved: false, pinned: false,
    reactions: [rx('🧠', 9)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('leo', 2.98 * 30 * DAY, ['Simplest way I think about it: a flag is ONE tight pullback. A VCP is a SERIES of pullbacks, each shallower than the last, with volume drying up into the apex. VCP = flag that keeps tightening. If you can only draw one contraction, it is a flag.'], 44, [rx('💯', 16), rx('🧠', 7)], [
        cm('priya', 2.97 * 30 * DAY, ['The "each pullback shallower than the last" is the click for me. So a flag that has a second, tighter pullback is basically becoming a VCP. Got it.'], 12, [], [
          cm('mentor', 2.96 * 30 * DAY, ['Correct. And the WHY matters: successive shallower pullbacks mean supply is being absorbed at higher and higher lows. That is the tell that the breakout has fuel. The pattern is just the fingerprint of that absorption.'], 20, [rx('🔥', 6)]),
        ]),
      ]),
      // A brand-new reply on a 3-month-old thread — demonstrates reviving old posts.
      cm('sam', 2 * HOUR, ['Reviving this because I just linked it to a new member — still the clearest explanation of VCP vs flag on the whole floor. Bumping it back up.'], 7, [rx('🙌', 2)]),
    ],
  },
  {
    id: pid(), author: 'blake', category: 'education', flair: 'Deep Dive',
    title: 'Reading market breadth before you take ANY setup — a 5-minute pre-trade checklist',
    body: [
      'Your setup can be perfect and still fail if the tape is against you. Before I take anything, I run a 5-point breadth read: exposure score, % above the 50-day, new highs vs new lows, the McClellan, and where SPY/QQQ sit relative to their own 20/50.',
      'Green across the board = press. Mixed = half size, best setups only. Red = sit on your hands or hunt shorts. Full walkthrough in the replies — ask anything.',
    ],
    tickers: ['SPY', 'QQQ'], createdAt: NOW - 12 * DAY, votes: 96, myVote: 0, saved: true, pinned: false,
    reactions: [rx('🧠', 24), rx('🔥', 11)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('dana', 11 * DAY, ['Do you weight any of the 5 more than the others, or is it a gestalt read?'], 13, [], [
        cm('blake', 11 * DAY, ['Exposure score and % above 50-day carry the most weight for swing timeframes — they are the slow, honest ones. New highs/lows and McClellan are the fast confirmation. If the slow two disagree with the fast two, I trust the slow two and size down.'], 17, [rx('💯', 5)]),
      ]),
    ],
  },
  {
    id: pid(), author: 'sam', category: 'discussion', flair: 'Discussion',
    title: 'Unpopular opinion: watching level 2 all day made me a worse swing trader',
    body: [
      'I spent a year glued to the tape and order book. For scalping maybe it helps. For swings it just gave me a thousand reasons to exit good trades early on noise.',
      'Since I turned it off and started managing off the daily chart and my stop, my hold times doubled and so did my average winner. Anyone else find less screen data = better swing results?',
    ],
    tickers: [], createdAt: NOW - 20 * DAY, votes: 71, myVote: 0, saved: false, pinned: false,
    reactions: [rx('👀', 15), rx('💯', 10)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('marcus', 19 * DAY, ['100%. More information is not more edge past a point. For a swing, the daily close is the only tick that matters. Everything intraday is a temptation to break your own plan.'], 28, [rx('💯', 11)]),
      cm('nina', 18 * DAY, ['I still keep it up but I moved my charts to daily/weekly and shrunk the L2 to a corner. Compromise but the timeframe change did most of the work.'], 9, []),
    ],
  },
  // ---- posts authored by the current user (for "My Posts" + notifications) ----
  {
    id: 'p-me-1', author: 'you', category: 'questions', flair: 'Question',
    title: 'Anyone else struggle to hold winners past the first target? Need a mechanical rule',
    body: [
      'I keep nailing the entry and then dumping the whole position at +1R out of fear. My winners would be 3-4x bigger if I just let a runner work.',
      'Looking for a MECHANICAL rule — trail under the 10-EMA? Sell half at the first target and trail the rest? What actually works for you and why?',
    ],
    tickers: [], createdAt: NOW - 5 * HOUR, votes: 12, myVote: 0, saved: false, pinned: false,
    images: [SAMPLE_IMG],
    reactions: [rx('🔥', 5), rx('🧠', 3)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('mentor', 4 * HOUR, ['Sell a third at the first target to pay yourself, then trail the rest under the rising 10-EMA on the daily. The partial removes the fear; the trail lets the runner run. Mechanical, repeatable, survives a bad week.'], 21, [rx('💯', 7)]),
      cm('dana', 3 * HOUR, ['Same boat — the "sell a third, trail the rest" framing finally got me holding. The partial is what kills the fear.'], 8, []),
    ],
  },
  {
    id: 'p-me-2', author: 'you', category: 'ideas', flair: 'Trade Idea',
    title: '$AMD flat base breakout watch — my levels + invalidation',
    body: [
      'AMD tightening into a 5-week flat base right under 178. Volume drying up, higher lows into the pivot.',
      'Trigger: over 178.20 on volume. Stop: 169.50 (below the base). First target: measured move ~192. Invalidation: a daily close back below the 50-day.',
    ],
    tickers: ['AMD'], createdAt: NOW - 1 * DAY, votes: 27, myVote: 0, saved: true, pinned: false,
    chart: { ticker: 'AMD', tf: '1D', caption: 'Flat base under 178 — trigger over 178.20, stop 169.50.' },
    reactions: [rx('🚀', 9), rx('👀', 4)].map((r) => ({ ...r, reacted: false })),
    comments: [
      cm('marcus', 22 * HOUR, ['Clean base. Watching this one with you — the volume contraction is textbook.'], 6, [rx('🔥', 2)]),
    ],
  },
]

// Pre-mark one Question as Answered (accepted answer = the expert reply); the
// rest stay open so the "Needs an Answer" rail has something to show.
SEED_POSTS[0].answerId = SEED_POSTS[0].comments[0].id  // gap-up → UCT Mentor's answer

// ---- Notifications: activity on the current user's posts/comments ------------
export const SEED_NOTIFICATIONS = [
  { id: 'n1', kind: 'reaction', actor: 'dana', emoji: '🔥', postId: 'p-me-1', postTitle: 'Anyone else struggle to hold winners past the first target?', ago: 30 * MIN, seen: false },
  { id: 'n2', kind: 'comment', actor: 'mentor', postId: 'p-me-1', postTitle: 'Anyone else struggle to hold winners past the first target?', ago: 4 * HOUR, seen: false },
  { id: 'n3', kind: 'reaction', actor: 'priya', emoji: '🧠', postId: 'p-me-1', postTitle: 'Anyone else struggle to hold winners past the first target?', ago: 5 * HOUR, seen: false },
  { id: 'n4', kind: 'reaction', actor: 'marcus', emoji: '🚀', postId: 'p-me-2', postTitle: '$AMD flat base breakout watch', ago: 20 * HOUR, seen: true },
  { id: 'n5', kind: 'comment', actor: 'marcus', postId: 'p-me-2', postTitle: '$AMD flat base breakout watch', ago: 22 * HOUR, seen: true },
  { id: 'n6', kind: 'reaction', actor: 'leo', emoji: '💯', postId: 'p-me-2', postTitle: '$AMD flat base breakout watch', ago: 1 * DAY, seen: true },
]
