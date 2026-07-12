# Notebook Templates — research + plan (2026-07-12)

**Status: PLAN — nothing new built yet.** A v0 already exists:
`app/src/pages/journal-2-0/lib/notebookTemplates.js` ships 3 static templates
(Trade review · Weekly plan · Daily prep) behind the Notebook's small
"New from template" split-button (P5-B3 of the Journal A+ push). This plan is
the v1→v3 roadmap for turning that stub into a flagship feature.

Sources: the 2026-07-11 15-agent journal competitive research
(`user-voice.md`, `tradezella.md`, `edgewonk.md`, `tradersync.md`,
`tradervue.md`, `panel-trader.md`, `uct-inventory.md`), Notion/Obsidian/
Evernote template-system research (2026-07-12), TradeZella notebook docs,
and the firm's own methodology (regime/exposure, sizing formula, entry
types, 26-setup taxonomy, mistake taxonomy).

---

## 1. What the market does (why templates matter)

| Product | Template story | Verdict |
|---|---|---|
| **TradeZella** (category leader, 4.8★) | Notebook with **25+ templates** (Pre-Market Game Plan, Intraday Check-In, post-session review, watchlists…), *pre-trade notes that auto-link to the trade once it syncs*, AI session summaries written INTO the notebook, playbook templates, Plan→Trade→Analyze daily loop | The benchmark. Templates are core to their retention story. |
| **Edgewonk** | Notebook/diary with categories, **no template library** — called out as a gap in reviews ("no strategy template library, users expected to arrive with a strategy in hand") | Gap we can exploit |
| **TraderSync** | **No template library** (explicit gap vs TradeZella in teardown) | Gap |
| **Tradervue** | Nothing — no templates, no playbooks | Gap |
| **Notion** | Page + **database templates** (new entry auto-opens pre-structured, can recur daily), 30k-template marketplace = a primary acquisition channel | The generic ceiling |
| **Obsidian** | Core Templates plugin + Templater (variables, prompts, folder-triggered auto-apply) | Power-user ceiling |
| **Evernote** | Template gallery + "Save as template" on any note | The simple baseline |

**Research throughlines that shape the design (from user-voice.md):**
- *The friction thesis*: journaling dies from friction, not laziness — every
  ritual must complete in ≤5 minutes; "start with 5 fields, not 25."
  Over-instrumented templates kill the habit they're meant to build.
- *No aha by week 3 → no week 4*: a template that just adds headings is
  furniture. A template that opens **already knowing your day** is an aha.
- *Swing traders are the underserved segment*: they need daily management
  notes on a live position — "single-row-per-trade schemas can't capture a
  3-12 day trade."
- *Psychology must produce numbers*: Edgewonk's tag→expectancy correlation is
  the benchmark; free-text feelings don't retain.
- *Panel-trader (our own review)*: "the premarket plan is not a first-class
  artifact… nothing pulls wire/calendar/regime INTO it, and nothing at 4 PM
  grades the day against the morning plan." Templates are half of closing
  that Plan→Trade→Analyze loop.

## 2. The one advantage nobody can copy

Every competitor's template is **static text**. The UCT Notebook lives inside
a platform that already knows the market (wire regime/exposure, calendar +
expected moves, catalysts, breadth, RS) and the member (j2 trades/positions,
setups, mistakes, watchlists, broker sync). **Data-aware templates** — notes
that open pre-filled with today's regime and *your* actual trades — are the
positioning line: *"TradeZella gives you a blank form. UCT fills it in."*
The video-note watch rails (2026-07-12) already prove the pattern.

## 3. The template lineup (proposed)

Nine firm-authored templates in three families. Quality over TradeZella's
25 — each encodes a UCT-methodology ritual, each ≤5-min to complete.
(Existing 3 get upgraded in place; keys stay stable.)

### A. Rituals — the daily/weekly loop
1. **Daily Game Plan** *(upgrade of `daily-prep`; the flagship)*
   Pre-fill: date · regime phase + exposure score (wire) · index levels ·
   today's earnings from MY tickers (calendar) · top catalysts · my open
   positions w/ distance-to-stop. Prompts: scenarios ("if X then Y"), A+
   setups hunted, risk budget (sizing-formula reminder for current regime),
   discipline reminders. *Data: `/api/breadth` or wire regime, `/api/calendar`,
   `/api/catalysts/today`, `/api/j2/positions`.*
2. **Post-Market Debrief** *(new)*
   Pre-fill: today's closed trades (ticker/side/R/P&L) · planned-vs-taken ·
   untagged-trade count. Prompts: what I did great / what leaked · one
   emotion + one lesson · tomorrow's carry. Feeds the panel-trader
   "Close-the-Day ritual" (#4 recommendation) — the EOD recap card can
   deep-link into this template. *Data: `/api/j2/trades?date=today`.*
3. **Weekly Review** *(new)*
   Pre-fill: week's W/L, net R, win rate, best/worst trade, per-setup table,
   top mistake tag + its R cost. Prompts: 3 strongest patterns / 3 leaks ·
   ONE commitment that becomes a rule (Edgewonk Edge-Finder pattern).
   *Data: `/api/j2/analytics` week slice.*
4. **Weekly Plan** *(exists — add regime/exposure + earnings-next-week pre-fill)*

### B. Per-event — created when something happens
5. **Trade Post-Mortem** *(upgrade of `trade-review`)*
   Created from a trade (TradeDrawer "Journal this trade" → `?template=
   trade-review&trade=<id>`): pre-fill ticker, side, entry/exit, R, setup,
   holding time; ticker field preset. Prompts: setup grade vs the playbook ·
   entry/exit quality · what right/wrong · the lesson. *Data: `/api/j2/trades/{id}`.*
6. **Swing Position Log** *(new — the underserved-segment play)*
   For an OPEN position: pre-fill entry/stop/size/current R:R. Body is a
   dated running log — one short block per day the position is alive
   (thesis intact? stop moved? add/trim?). Answers the multi-day-trade gap
   every competitor fails. *Data: `/api/j2/positions`.*
7. **Earnings Play Plan** *(new)*
   Ask for ticker → pre-fill report date/session, expected move, last-4-qtr
   beat history. Prompts: play (hold through? enter after?), size given
   binary risk, invalidation. *Data: `/api/calendar/enrichment`, `/api/fundamentals`.*
8. **Setup Study** *(new — Setup Library tie-in)*
   Pick a setup from the 26-name taxonomy (chips) → pre-fill its Library
   definition link + my win-rate/R on that setup if I've traded it. Prompts:
   annotated examples (paste charts), trigger checklist, where it fails.
   *Data: `setupCatalog.js`, `/api/j2/analytics` by-setup.*

### C. Psychology
9. **Tilt Log** *(new)*
   One-screen, 3 fields (friction thesis!): what happened · which mistake tag
   (chips from the taxonomy) · cost in R (pre-filled if launched from a
   trade). Tag prompts mirror the J1 mistake taxonomy so Compass can later
   correlate. *Data: mistake taxonomy, optional trade ref.*

**Deliberately NOT in v1:** monthly review (weekly must stick first),
generic meeting/idea notes (blank note is fine), backtest log (needs the
backtesting story), intraday check-in (Compass interventions already own
in-session nudges).

## 4. How data-awareness works (mechanics)

- Template shape today: `{key, label, defaultTitle, build()}` → TipTap doc.
  Evolve to `build(ctx)` where `ctx` is assembled **client-side at create
  time** from existing endpoints (all listed above already exist — zero new
  backend for v1/v2). Async: picker shows a 300ms "preparing…" state.
- **Graceful blanks**: any fetch that fails/empties renders the prompt line
  with an em-dash placeholder, never an error (honesty-states law). A
  template must always produce a valid doc offline.
- Presets beyond the body: `POST /api/j2/notes` already accepts `tags`,
  `ticker`, `folderId` — each template sets sensible defaults (e.g.
  Post-Market Debrief → tags:['debrief'], title "Debrief — Jul 12").
- **Hard constraint** (documented in notebookTemplates.js): the editor has NO
  table extension — structure via headings/bullets/hr only; `containsTableNode`
  test guards every template. Keep the guard green as the lineup grows.
- Deep links: `?seg=notebook&new=<key>[&ticker=][&trade=]` so Today page, EOD
  recap, TradeDrawer, and the Desk can open a pre-seeded template directly.

## 5. UX

- Replace the split-button menu with a **template picker** (Sheet on mobile):
  grid of cards — name, one-line "when to use", tiny skeleton preview, family
  grouping (Rituals / Trades / Mind). "Blank note" stays first.
- **Empty-notebook state** shows the picker inline (kill the blank-page
  moment for new members — the acquisition moment).
- Cross-links that close the loop: Today's premarket card → Daily Game Plan;
  EOD recap → Post-Market Debrief; TradeDrawer → Trade Post-Mortem; Sunday
  email → Weekly Review. (These four links ARE the Plan→Trade→Analyze
  answer to TradeZella.)
- Notebook stays in the FREE tier (per launch pricing) — templates are
  top-of-funnel; data-prefill depth is where paid shines (regime/calendar
  pulls can be trial-gated later if needed).

## 6. Phasing

- **V1 — lineup + picker (S/M, one session):** all 9 templates with
  light pre-fill (date, regime one-liner, positions list), picker UI +
  empty-state, preset tags/tickers, template tests. No backend.
- **V2 — deep data + loop links (M):** trade-ref/earnings/week-stats pulls,
  `?new=` deep links wired from Today/recap/TradeDrawer/email, "pre-trade
  note links to the trade once it syncs" (TradeZella's best notebook idea —
  match note ticker+date to an imported trade, offer the link).
- **V3 — user + community templates (M/L):** "Save this note as a template"
  (per-user, `j2_note_templates` table or preferences blob), then shared
  templates on The Floor (creator angle — Notion-marketplace dynamics inside
  the community), recurring auto-create (Daily Game Plan waiting each
  morning), Compass "draft my game plan" filling a template via AI.

## 7. Success signals

- % of new notes created from a template (target: >40% within a month)
- Ritual retention: members with ≥3 Daily Game Plans in week 1 who are still
  journaling in week 4 (the churn-thesis counter-metric)
- Template → trade linkage rate (v2), shared-template count (v3)
