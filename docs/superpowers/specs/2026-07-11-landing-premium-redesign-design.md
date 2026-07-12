# Landing Page Premium Redesign — Design Spec

**Date:** 2026-07-11 · **Status:** approved by owner (conversation), building same-day
**Scope:** full redesign of `/landing`, pricing reposition to $200/mo everywhere, sitewide price-copy sweep.

## Positioning

- **One product, one price.** UCT Intelligence = the complete trading desk. $200/mo or
  $2,000/yr (two months free). 14-day full-access trial, **no credit card**, one-click
  cancel, 7-day refund.
- **No free tier on marketing pages.** Existing free accounts keep working in-app; the
  marketing story is trial → paid. (Owner decision.)
- **The agentic layer is the star.** Agents work overnight and while you trade; the
  classical manual toolkit (charts, breadth, flow, journal) is "your hands on the wheel."
- Sales-driven, clean, aesthetic direction — NOT technical/terminal. Benefit copy over
  stats dumps. Honest claims only (post legal-hardening posture). No invented
  testimonials, no fictional P&L curves.

## Page architecture (`/landing`)

1. **Hero** — "Wake up to a desk that already did the work." AI-desk promise, one gold
   CTA (Start your 14-day free trial → `/signup`), "No credit card · Cancel in one
   click," scroll cue to the day timeline. Market-status eyebrow stays (honest, live).
   The fictional $8K→$36K equity animation is REMOVED.
2. **The Shift** — short empathy block: "More information won't save you." Firehose vs
   a desk that reads, filters, decides-with-you.
3. **A Day at Your Desk** — the spine. Six moments on a scroll-drawn gold timeline
   (7:35a brief · 9:00a catalysts · 10:12a Compass verdict · all-day The Floor · 4:05p
   journal wrote itself · Sunday weekly review). Each: mono time marker, benefit
   headline, 2–3 sentences, faithful product vignette, small "agent" annotation
   (e.g. "written by the desk overnight"). Vignettes carry an "Illustrative example"
   caption.
4. **The Intelligence Layer** — agentic spotlight. The loop: reads overnight → briefs →
   flags catalysts → verdicts your trades → learns from your journal → coaches your
   week. "The more you trade with it, the more it knows you."
5. **Your hands on the wheel** — the manual desk: Charts Workspace (drag-resize tiles,
   4 link groups, 8 timeframes, direct-manipulation drawings), Breadth Monitor, LiveFlow
   options tape + dark pool + GEX, Theme Tracker, Calendar, The Desk, Journal — plus the
   "arrange it your way" customization story.
6. **Everything on the desk** — the complete feature inventory wall, 7 groups, EVERY
   shipped feature named (see inventory below). Nothing unshipped (no full-market
   screener — still on branch).
7. **Testimonials** — 3-quote band, renders ONLY when `TESTIMONIALS` array is non-empty.
   Owner supplies real quotes later.
8. **Pricing** — one plan card, annual/monthly toggle (annual default): $200/mo ·
   $2,000/yr ("two months free"). Trial promises row. Value frame: "One good decision a
   month covers it" + honest stack-replacement comparison.
9. **FAQ** — rewritten for trial model: not-advice, trial contents, after-trial,
   broker-optional, screener comparison, cancel/refund.
10. **Final close** — "Tomorrow at 7:35 AM, the first brief can be yours."
11. **Footer** — methodology lineage line kept, "Hand-built by a trader, for traders."
Sticky mobile CTA kept ("Start free trial · no card").

## Feature inventory (the wall — all shipped features)

- **Intelligence Layer:** Morning Wire (7:35 AM ET brief: regime, exposure, top-5 w/
  triggers/stops/invalidations) · Stock Catalysts (20 vetted picks / 8 sources) ·
  Compass AI coach (GO/HOLD/SKIP pre-trade verdicts, post-mortems, tilt detection,
  weekly reviews) · Voice Assistant (88 tools, read-aloud) · Pattern Engine (85
  detectors) · UCT Brain (7,800+ entries, 48 setup templates) · UCT-Mentor
- **Market Intelligence:** UCT 20 w/ live signals + P&L · Breadth Monitor (20+
  internals, 8-tier heatmap, industry groups, ATR extension, 500-day analogues) · COT ·
  Theme Tracker (99 themes / 12 sectors / 1,928 stocks) · LiveFlow tape + dark pool +
  GEX + flow scoreboard · earnings & economic Calendar w/ ratings percentiles ·
  fundamentals snapshots · news + curated tweet tape · live streaming, 3,685 tickers
- **Charts:** Workspace w/ drag-resize tiles, 4 link groups, 8 timeframes, streaming
  bars, deep history, direct-manipulation drawing, shortcuts, fundamentals widget,
  pattern callouts, mobile workspace
- **Journal 2.0:** broker auto-sync (verified) · CSV presets (TradeZella/Tradervue/
  TraderSync) · live pricing · MFE/MAE + exit quality · regime analytics · risk block ·
  equity curve + calendar heatmap · Notebook w/ video timestamps · PNG share cards
- **The Floor:** live chat · trade/chart/flow/poll/idea cards · boards · The Tape ·
  mentions + inbox · verified badges
- **The Desk:** daily session recordings w/ chapters + recaps · education library ·
  workshop · mini-player
- **Platform:** command-center dashboard · watchlists · Model Book catalogs · ⌘K
  support · keyboard shortcuts · composable workspaces

## Visual system

- **Type:** Fraunces (display serif, headlines — added to existing Google Fonts link) ·
  Inter (body) · JetBrains Mono (times/prices/tickers only — existing).
- **Color:** warm near-black ground (`#0a0604` family), gold `#c9a84c` sole accent,
  warm off-white text, muted green reserved for live/market-open. No new hues.
- **Layout:** ~1080px max, ~140px chapter rhythm, timeline = left time rail + right
  content/vignette.
- **Signature motion:** gold timeline thread draws with scroll through the Day chapter;
  moments light as they enter. Fade-rise entries. Everything honors
  `prefers-reduced-motion` (completed state).
- Product vignettes: styled mini-mocks, believable current data, soft gold edge, no
  screenshots/photography/3D.

## Pricing changes (everywhere)

| Surface | Change |
|---|---|
| `Landing.jsx` | full rewrite; $200/$2,000 |
| `Pricing.jsx` | $200/mo · $2,000/yr; free-forever card removed; subscribe button copy honest ($200/mo · $2,000/yr billed annually); annualFallback logic kept |
| `Compare.jsx` | "$20/mo" ×2 → $200/mo (comparison framing updated honestly) |
| `TrialBanner.jsx` | "$19/mo" → $200/mo |
| `Settings.jsx` | "Pro — $20/mo" ×2 → $200/mo |
| `Subscribe.jsx` | "Subscribe — $20/mo" → $200/mo |
| `Admin.jsx` | MRR popover label "× $20/mo subscribers" → $200 (verify calc source) |
| `app/index.html` | meta + og descriptions (drop "$20/month, free tier"), JSON-LD offers: remove free offer, monthly 200 P1M, annual 2000 P1Y |

CTAs all point to `/signup` (Signup.jsx ignores plan params; trial is default via
`trial.py`, fails closed). Analytics: keep existing `landingTrack` event names for
funnel continuity; add events for new sections only.

## Out of scope / owner punch list

- Stripe LIVE prices: create $200/mo + $2,000/yr live prices, set both PRICE_ID env
  vars (extends existing launch punch list; Stripe currently TEST mode).
- Real testimonial quotes (drop into `TESTIMONIALS` array to un-gate the band).
- Attorney review continues per existing punch list.

## Verification

Build (vite) · Playwright live pass at 1440/834/390 widths · reduced-motion check ·
analytics events fire · price-consistency grep returns only intended values · ship from
worktree via `push origin feat/landing-premium-redesign:master` after
`grep -c broker_sync api/main.py` ≥ 7 · Saturday = no deploy-window constraint ·
post-deploy Cloudflare verify playbook.
