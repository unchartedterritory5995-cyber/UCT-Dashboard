# The Desk → Courses → **Study**: interactive trading education — design

**Date:** 2026-10-17 · **Status:** owner decisions taken in chat 2026-10-17 (§11, two rounds: the Method drills, then the Foundations layer); spec updated to match; build not started
**Scope (two curricula, one engine):** **Foundations** — a full beginner-to-advanced "Duolingo for stocks" (market basics, chart reading, candlesticks, fundamentals, options, history, macro, psychology, risk, orders, styles, process) — and **The UCT Method** — the firm's own system drilled on its own charts and records.
**Owner intent (verbatim, 2026-10-17):** "a Duolingo for trading … interactive chart reading, pattern recognition, setups, trading concepts, everything … so users could spend months or years learning details and intricacies in a very interactive way." And: "I want to review everything here to build the full 5,000 or more test questions first … then want to make sure the system for establishing new questions is solid and strong."
**Companion docs:** `docs/curriculum/curriculum_dossier.md` (the pedagogy this spec implements), `docs/curriculum/HANDOFF.md` §6 (the "planned, not built" list this spec closes), `docs/terminal-research/02-data-providers/provider-ledger.md` (data sources).

> Reading guide. §1–§4 are plain-language. §5 onward is the construction plan for the build sessions: schemas, endpoints, file paths, phases, acceptance tests. Every count and file:line was read from the repo on 2026-10-17; re-measure before relying on one. §11 records the owner's decisions verbatim-in-spirit; where this spec and §11 disagree, §11 wins.

---

## 1. Why

The Desk's **Courses** tab is a syllabus for two courses nobody has recorded yet (UCT Foundations, 60 lessons; The UCT Method, 79 lessons; 0 videos attached). The text-lesson list under it (`CurriculumLessons.jsx`, flag `EDU_CURRICULUM_ENABLED`) shows chapter markers and tracks only a global view count. **A member cannot practise anything, be tested on anything, or see their own skill grow.** The curriculum dossier already specifies how that should work (80% mastery checkpoints, cover-and-predict chart reps, rep-counted setup drilling, a "Chart Arcade"), and the HANDOFF lists "persisted drill scores, completion badges, module drip, a capstone submission flow" as planned and unbuilt. No quiz, drill, streak, XP, or mastery code exists anywhere in `api/` or `app/src` (searched 2026-10-17).

Meanwhile the firm holds an unusually deep, mostly machine-readable library: 320 Desk videos with 20.3 M characters of transcript, 96 pattern detectors with written rules and a 1.5 M-row outcome ledger, 163 real-bar labelled setup cases, an 82-chart adjudicated VCP gold standard, 181 data-verified dated chart examples inside the lesson scripts, 2,953 Sunday Scans chart images, a team call archive with outcomes, 18 years of daily breadth, 9 dated market-bottom case studies, a 40-term glossary, 36 trading principles, and a sizing quiz with an answer key. **All of it is inert for teaching today.** This spec turns it into **Study**: a practice product inside Courses with a 5,000+ item bank built and reviewed by the owner first, and a generation system that keeps it growing.

## 2. Goals and success criteria

1. **A member can practise every station of the loop** (Regime → Scan → Setup → Size → Manage → Review) on real charts and real market history, with an answer and a short lesson after every item, on phone and desktop.
2. **Every item teaches.** No item is scored without a reveal: the answer, where the answer came from, what happened next, a brief lesson, and a link to the course lesson.
3. **A daily habit.** A 10-item "Today's Study" built from real market material, unlimited extra practice, streaks, XP, badges, a leaderboard, and an opt-in reminder.
4. **Never invents a chart.** Every chart item is generated from stored bars or a verified label. No model writes a market example. (The curriculum audit found 138 of 181 model-written examples needed correction and 9 described patterns that did not exist.)
5. **Zero API spend at runtime.** No live model calls in the product. Lessons and explanations are written in scheduled Claude Code sessions, reviewed by the owner, and imported. Nightly chart items use rule-filled templates.
6. **The owner reviews the bank.** The first 5,000+ items are built segment by segment in sessions with the owner reviewing each segment before import; every correction is stored as a labelled example.
7. **Content that does not run out.** A nightly generator mints chart items from the pattern engine's detections and outcomes into a review queue, so the bank grows every session.
8. **Live from day one.** The site has no live members yet (COMING_SOON_MODE); Study ships enabled, paid-gated like The Desk, with one kill switch (`STUDY_ENABLED`) for rollback without a deploy.

## 3. Non-goals (this spec)

- Recording or publishing course videos (the HANDOFF's job). Study links to lessons; it does not replace them.
- A paper-trading engine or order simulator. "What happens next" replay is a prediction drill, not a P&L game.
- A live AI tutor or AI grader **at launch** (owner decision 2026-10-17: no runtime API spend). AI inside the product is allowed later **only where it is clearly good and needed** (owner, review R1); the primitives are listed in §7.3.
- Rewriting the Journal, Compass, or the pattern engine. Study reads them.
- Public (logged-out) content or a free tier. There is no free tier (owner ruling 2026-10-02).
- Hard module locks (owner decision: the skill map is open).

## 4. The product, in plain language

### 4.1 Where it lives

**Inside the Courses tab**, as a section called **Study**. The Courses page gains a Study panel at the top (Today's Study, streak, XP, leaderboard rank) and a skill map below the course cards; every lesson row in a course gets a **"Study this"** button, and every drill's reveal names its lesson and chapter (two-way links).

Navigation: `?section=courses&study=map|today|skill&skill=…` on the existing Desk route. No new Desk tab.

**Simplicity rule (owner, review R2, R9):** one primary button on the panel ("Start today's Study"), at most three taps from opening Courses to answering a question, no settings required to begin, and every screen has one obvious next action. Anything that does not serve a typical member of the firm is left out.

### 4.2 The skill map (open, no locks)

The map mirrors the six stations and the dossier's 14-module arc. Each station holds skills; each skill holds levels; each level is a set of drill types with a target rep count. **Every skill is open from the start**; the map shows the recommended order and marks skills "recommended next", but nothing is locked.

| Station | Skills (v1) | Dossier modules |
|---|---|---|
| **Regime** | Read the dial · Stage the index · Distribution & follow-through days · Call the regime (historical turns) · Exposure ladder | M1, M3 |
| **Scan** | Breadth internals · Relative strength · Group before stock · Volume as witness · Daily scorecard | M4 |
| **Setup** | Chart literacy (candles, MA stack, gaps) · Family I bases & breakouts · Family II pullbacks · Family III episodic pivots · Family IV exhaustion & shorts · Four-family placement · Grade the setup · Mark the levels | M2, M6–M9 |
| **Size** | R and the 2% ceiling · The sizing formula · Regime-adjusted sizing · Portfolio heat · Correlation risk | M5, M11 |
| **Manage** | Selling because wrong · Selling because right · Partials & trailing · Time stops · What happens next (replay) | M10 |
| **Review** | Mistake taxonomy · Trade autopsy · Three-axis grading · The weekly review · Build and defend the plan | M12, M14 |
| **Calls** | Take the call (Sunday Scans) · Take the call (team archive) | cross-cutting |
| **Overlay** (later) | Options flow as confirmation · Dealer positioning | M13 |

The setup catalog is **28 setups** (the owner's 26 plus VCP and High Tight Flag, §13.9). Regime drills use the **firm's recorded tier word per date and never state a numeric cutoff** (owner decision; see §13.1 B2 for what "recorded" requires).

### 4.3 The drill types

| # | Drill | What the member does | How it is scored | Where the content comes from | Phase |
|---|---|---|---|---|---|
| 1 | **Recall** | Multiple choice, true/false, or fill-in on a term, rule, or formula | Exact | 40-term glossary, 36 trading principles, O'Neil 23 rules, 22 concept formulas, lesson notes, toolkit cards, playbooks | 1 |
| 2 | **Spot the pattern** | Real chart, ticker hidden. "Which setup is this, or none?" | Exact vs label | 163 real-bar fixtures, VCP gold standard (consensus-labelled), nightly detections, Model Book setups, curriculum examples | 1 |
| 3 | **Size it** | Account, chosen risk %, entry, stop → shares and dollar risk; the reverse (given a size and stop, what is the risk?); flat-risk vs quality-scaled variants | Numeric with rounding tolerance | Toolkit sizing gate (10 problems + key) regenerated under the house sizing rule (§4.11) | 1 |
| 14 | **Tap the chart** | Point at the wick, the pivot, the gap, the 50-day, the base low on a drawn or real chart | Hit region | Idealized SVG candle/chart drawings (the Setup Library glyph system) for teaching; stored bars for testing | 1 |
| 15 | **Scenario story** | A short narrative in the mentor's voice with a decision at the end ("You hold three names, the market just lost the 50-day…") | Exact vs the taught rule | Written in sessions; history stories use the firm's own index and breadth data | 1 |
| 4 | **Call the regime** | Breadth snapshot or index chart from a real past date: pick the tier the firm called | Exact vs recorded tier word | Wire archive (exposure tier per date), breadth history 2008+, 9 bottom case studies, 12 historical turns | 1 |
| 5 | **Take the call (Scans)** | A Sunday Scans chart from a past issue: take it, pass, or watch | Vs what price did 5/20/60 days later | 64 Sunday Scans issues, 2,953 chart images, with bars re-read for the forward window | 1 |
| 6 | **Grade the setup** | Walk the rubric: tick each must-have and disqualifier, then grade A+ to F | Per-check vs rubric, grade vs label | 14 vision rubrics, Model Book grades, gold-standard quality scores | 2 |
| 7 | **Mark the levels** | Tap entry, stop, target on the chart | Distance to the key within a tolerance band | Pattern detections (`levels_json`), Model Book setup rows, curriculum examples | 2 |
| 8 | **What happens next** | Chart cut at a date, predict (breaks out / fails / chops), then step forward bar by bar | Direction vs recorded outcome | Pattern outcomes ledger, fixtures with forward bars, Model Book result windows, catalysts table (EP family; owner reviews every item) | 2 |
| 9 | **Family placement** | 20 mixed charts, name the family first | Exact | Same sources as #2, stratified by family | 2 |
| 10 | **Take the call (archive)** | An archived team call with its chart: take it or not | Vs the call's recorded outcome (r5/r20/r60) | `wisdom_archive_calls` | 2 |
| 11 | **Listen & answer** | A 60–90 s clip from a Desk or #tsdr video, then a question quoting the transcript | Exact | 320 Desk videos (chapters, ticker_moments, transcript), `tsdr_lessons` recaps | 2 |
| 12 | **Trade autopsy** | A real trade with its timeline: name the mistake category and the rule broken | Tag match vs the 17-mistake taxonomy | Trade-log vault, team archive failures, the member's own journal (opt-in) | 3 |
| 13 | **Build the plan** | Build a plan from controls: tier, setup, entry, stop, size, first target, exit rule; a free "why" box | Rule-scored (regime first, stop before size, ≤2% and the regime ceiling, R:R ≥ 2); the "why" is saved to the Notebook, unscored | Any chart item; capstone sets | 3 |

### 4.4 The learning engine

- **Mastery score per skill**, 0–100, from the member's attempts weighted by recency and difficulty. Bands: Learning <50 · Practised 50–79 · **Mastered ≥80** · Gold ≥95 with 40 reps. (The 80% figure is the dossier's; **the owner will review pass bars** before launch, §11.)
- **No decay of earned badges; freshness instead.** A Mastered band is never removed. Each skill shows **Fresh** (practised in the last 30 days) or **Needs a refresh**; refresher reps on a stale skill pay bonus XP. This keeps the reward and keeps the nudge (owner: "encourage rewards but also encourage continued studying").
- **Checkpoints exist but do not lock.** Finishing a module's checkpoint earns its badge; a miss suggests a refresher on the missed sub-skill. Nothing is gated.
- **Item selection is a random mix of seen and unseen items** (owner decision), weighted toward the member's weakest skills and toward items they got wrong before. No formal spaced-repetition schedule.
- **Interleaving.** Late-course sets mix families and stations in one session.

### 4.5 The daily loop

- **Today's Study**: 10 items (1 regime call, 2–3 chart items, 1 sizing, 1 recall, the rest drawn from weak skills and past misses). Finishing it keeps the streak. **Unlimited extra practice** afterwards from the map.
- **Streak** counts **every calendar day**, with **one free miss per week** (owner decision).
- **XP** per correct item, scaled by difficulty; bonus for refreshers on stale skills and for streak days. Daily goal selectable (20 / 50 / 100).
- **Badges**, deliberately few and tiered so the system stays legible: 14 module badges (one per checkpoint), setup rep badges (20 and 40 reps on one setup), streak badges (7 / 30 / 100 days), and Gold skill badges. Each badge has one line of copy and a gold `UIcon`.
- **Leaderboard**: weekly XP, **on by default** (the site has no live members yet; owner: "only leaderboard yes"), with an opt-out in Study settings. No Discuss threads.
- **Reminder**: push notification plus the in-app bell, **opt-in**, at a member-chosen time, one per day. Web push is already armed (`WEB_PUSH_ENABLED`; Settings row `PushNotificationsRow.jsx`).

### 4.6 Explanations and lessons (no live AI)

Every item carries, written in advance: the answer, its **provenance** (fixture, gold-standard consensus, detector id and outcome, admin grade, archive outcome), **what happened next** (for chart items), a **mini-lesson** of 2–5 sentences in the firm's voice, and the **lesson link**. The reveal shows all of it, always, with the real ticker and dates.

Who writes the lesson text:
- **Owner-reviewed sessions** write the bank's lesson text (Claude Code on the subscription, no API). Each session produces one segment (a skill or a source), the owner reviews it in the session, and the approved segment is committed to `docs/study/bank/` and imported.
- **Nightly chart items** carry a **rule-filled template** with no model involved ("The engine called this a VCP: contractions 24% → 11% → 5%, pivot $41.20. Target hit in 14 bars."). They wait in the review queue until the owner (or a session) approves them; approved items may receive a hand-written lesson later.
- "Obscure" explanations and answer-pattern analysis are decided case by case in sessions as the bank grows (owner, 2026-10-17).

### 4.7 The review and training loop

The owner's reviews are the quality gate **and** training data:
- An in-app **Study Review** screen (modelled on `admin/GoldReview.jsx`): chart, label, answer, lesson, buttons approve / fix / reject, with a reason. Every fix and reject is stored as a correction row (`study_corrections`) with the before and after.
- The same corrections are exported to `docs/study/corrections/` so sessions that write new items can read what the owner changed last time, and so Compass's own grounding set can use them later.
- Session reviews (the first 5,000+) happen in chat; the approved JSON is the artifact.

### 4.8 Foundations — the beginner-to-advanced layer

**Audience:** has a brokerage account and has traded a little. Unit 1 still starts from first principles; an **optional placement test** (about 15 questions: the dossier's 10-question placement diagnostic plus chart questions) suggests a starting point, and **every unit has "Test out"** (one pass at the top rung skips it). Everyone is invited through all of it; nobody is forced.

**Tracks (v1), each a path of units on the map, Foundations recommended before the Method:**

| # | Track | What it covers | Primary sources already held |
|---|---|---|---|
| F1 | Market basics | shares, exchanges, bid/ask, volume, market vs extended hours, indexes, ETFs, float, market cap | reference texts; `cap_universe.json`; index data |
| F2 | Chart reading (the backbone) | price/volume, timeframes, the MA stack, trend, gaps, relative strength, multi-timeframe | 22 concept formulas; `bottomsCatalog`; stored bars; dossier M2 |
| F2b | Levels, lines and drawings | supply and demand, support and resistance, trendlines and channels, pivots, how to draw them and when a level is "real" | the chart's own drawing tools (trendline, horizontal, channel, AVWAP); support/resistance and swing-pivot detectors; stored bars |
| F3 | Candlesticks | every single-candle shape and candle pair, what each says about the auction, where they matter | `screener/candle_catalog.py` (22 shapes, 44 relations) + 17 candlestick detectors; stored bars |
| F4 | Patterns and bases | bases, flags, cups, wedges, triangles, tops and bottoms, with sourced criteria | `screener/base_catalog.py` (29 structures, 252 sourced criteria); 36 classical detectors; `research/bases/` |
| F5 | Fundamentals and earnings | EPS, revenue, margins, guidance, estimates, P/E, growth screens, reading a report, reacting to a print | FMP earnings tables (frozen snapshots), `earnings_estimates.py`, `setup_grade.py`, Methodology page |
| F6 | Options, beginner to advanced | calls/puts, premium, intrinsic vs time, Greeks, IV and expected move, every strategy the Journal models (18 types), then flow and dealer positioning | `journal-2-0/lib/optionCalcs.js`, `options.py`, GEX engine, the Options Flow pages |
| F7 | Market history and macro | 1929, 1973-74, 1987, 2000, 2008, 2020, 2022 computed from the firm's index and breadth data; the Fed, rates, CPI, the yield curve | S&P/Nasdaq bars to 1974, breadth 2008+, AAII 1987+, econ catalog (151 series) |
| F8 | Psychology and discipline | biases, FOMO, revenge, tilt, routines, the mental hand history | `06_psychology.txt`, interventions rules, journal mistake taxonomy, 674 cited quotes |
| F9 | Account and risk basics | risk per trade, drawdown math, heat, margin, PDT, settlement, cash management | §4.11, `portfolio_heat.py`, `03_risk_management.txt` |
| F10 | Orders and execution | market/limit/stop/stop-limit/trailing/bracket, slippage, partial fills, extended hours | reference texts |
| F11 | Styles | day, swing, position: holding periods, time cost, which setups fit which style, how the firm's method maps to each | dossier; `01_methodology_bible.txt` |
| F12 | Process | the written plan, routines, journaling, the review cadence (no taxes, by owner decision) | dossier M12; journal schema |

**Centre of gravity (owner, review R3):** technical analysis, pattern recognition, memory, setups and process carry most of the weight; F2, F2b, F3, F4 are the largest tracks and every unit in them is example-heavy. The other tracks are complete but lighter.

**Failure cases are required (owner, review R5):** every setup unit and every family includes real losing examples traded correctly, the common tricks and traps, and what a stop-out looks like, so members learn that nothing is perfect and that deliberate risk management and timing are the reason. The dossier already requires "a real winner AND a real loss traded correctly" per setup; Study enforces it as an authoring rule: no setup unit ships without at least one approved loss.

**Unit shape:** questions only, opened by a short, exciting **intro** (§4.10) with a line of text. No reading pages. Each question reveals its answer and a one-line lesson.

**Unit list:** the full list of units per track, each with what it teaches and how many examples it needs, is a **Phase 0 deliverable** (`docs/study/UNITS.md`) that the owner reviews before any question is written (owner, review R6: "what are they about").

**Levels:** every unit has **3 levels × 3 rungs** (Learn 1-3, Practise 1-3, Prove 1-3). Rung 1 recognises the idea, rung 9 applies it on a real chart or real numbers. Gold at rung 9.

**Formats:** multiple choice, true/false, fill in the blank, tap the chart, scenario stories. (Match-the-pairs and order-the-steps are not in v1.)

**Diagrams:** idealized drawings for teaching, real charts for testing.

**Volume target:** robust, detailed, and **never repetitive** — about 12 tracks, 100-120 units, 2,500+ questions at launch. Authoring rule: no two questions may test the same fact in the same way; each unit's question list is diffed against the bank for near-duplicates before review.

### 4.8b Vocabulary (owner request, 2026-10-17: "thousands of words and questions")

A cross-cutting **Vocabulary track (V)** on the map plus a quick-play mode, built on a term bank that every other track links into.

- **Term record:** term · short definition in the firm's voice · longer note · aliases (the wisdom vocabulary's `aliases` field is the seed) · category (chart, candle, pattern, setup, risk, order, options, fundamentals, macro, breadth, psychology, process, house word) · one **example sentence quoted from the owner's own prose** (transcripts, Substack, toolkit, wire) · optional chart example (a `study_bars` ref with the thing marked) · the units that teach it · difficulty.
- **Sources already held (≈2,000+ terms before any writing):** 40-term glossary · 36 principles · 22 concept formulas · 22 candle shapes + 44 pairs · 29 base structures · 28 setups + 89 pattern names · 17 mistake and 15 emotion tags · the Greeks + 18 option strategies · ~70 breadth metric keys · 151 economic series · order types · the 32-entry wisdom vocabulary with aliases · 112 theme names · Journal field names · house words (dial, band, heat, tape, the loop…).
- **Question styles (vocabulary only):** definition → term (MCQ) · term → definition (MCQ) · fill-in with a 4-6 chip word bank · **match five terms to five definitions** (the match format is allowed here even though it is not used elsewhere) · tap the thing on the chart · "which word is the desk using here" (a real sentence with the term blanked).
- **Modes:** units on the V track by category (Learn/Practise/Prove rungs like any unit) · **Vocab sprint** in the Practise sheet (20 terms, two minutes, no XP cap bypass) · vocabulary items are first in line for the 3 due slots (spacing pays most here).
- **Rules:** every definition cites its source; a term with a measured or sourced number follows C19/C20 (numbers tagged by system); the house-words unit ("How we talk at the desk", F1's first unit) draws from this bank; the near-duplicate diff runs per term so the same word is not asked three ways in one session.
- **Target:** 2,000+ terms, 4,000+ questions, reviewed under the graduated-trust rule (definition items reach auto-approve with sampling after 20-30 clean examples per category).
- **Store:** `study_terms(id, term, definition, note, aliases_json, category, example_quote, example_source, bars_ref, unit_ids_json, difficulty, review_status)`; vocabulary questions are ordinary `study_items` of type `recall`/`match`/`tap` with `skill_id='vocab.<category>'`.

### 4.9 Voice (applies to every word a member reads)

The owner's instruction: "make it sound like us — a person, a friend and a mentor teaching — vs AI slop." Rules for authoring sessions (`docs/study/VOICE.md`):
- Write as a trader talking to a friend across the desk. Short sentences. Say "the market", "the stock", "your stop", never product shorthand.
- Do not use the firm's internal shorthand ("regime", "the dial", "tape", "exposure rating") in a question until that term has been taught in a unit, and then only in plain words alongside it ("the firm's market-health score, the 0-150 number on the dashboard").
- Reveals speak in first person as the mentor: "Here is what I'd do." No character, no mascot.
- No filler, no hype words, no emoji, no "great job!". A correct answer gets a short, real line of why it is right.
- **Structured and easy to follow** (owner, review R7): one idea per question, the same sentence shapes throughout a unit, the question before the chart, the choices short enough to scan on a phone. Human, but never rambling.
- Every number in a reveal must be in the item's facts (importer check).

### 4.10 Intro videos (offline production pipeline, not a runtime cost)

- One intro per unit (about 100-120): 30-60 seconds, **AI-produced locally** in sessions, reviewed by the owner, uploaded to the site as a stored asset (not generated on the server).
- **Voice:** a cloned version of the owner's voice from the Desk recordings. Consent is recorded in `docs/study/VOICE_CONSENT.md` before any sample is used; every script is reviewed before render.
- **Visuals:** brand motion graphics (gold on dark, the compass mark, charts rendered from real bars by the app's own renderer), with a stylized animated host of the owner where it adds something. **Any chart shown is rendered from real bars.**
- **Process:** the build team proposes the toolchain; the owner approves it before the first render; the first three videos are approved before the rest are produced. Scripts live in `docs/study/intros/<unit>.md`.

### 4.11 House sizing rule (replaces "which grid" — owner workshop, 2026-10-17)

Sizing is taught as **dynamic**, derived from the stop:
- **Risk per trade: 0.25% to 2% of the account**, chosen by setup quality, recent performance, market conditions and the trader's edge. 2% is the hard ceiling. **Flat-risk sizing (the same % every trade) is taught as a legitimate alternative**, not a mistake.
- **Stop first:** the low of the day, or the prior day's low, as the default; the structure (pivot area, pullback low) and ATR as supporting methods. Stop distance decides size; if the honest stop does not fit the risk budget, **skip, never tighten the stop**.
- **Size from the stop:** position % = risk % ÷ stop distance %. A 1% stop at half size is 0.5% risk; a 10% stop at 10% size is 1% risk.
- **Portfolio layer:** total open risk (heat) ≤ 10% of the account; 5-10 positions for a momentum swing book; progressive exposure (pilot → half → full → add only after the last rung paid).
- The app's ceiling grid (`houseSizing.json`) becomes a **cap layer** the drills mention once the member is in the Method, not the lesson. The toolkit's printed sizing gate is regenerated from this rule.

---

## 5. What exists, and the gap each drill crosses

### 5.1 Content sources (all measured 2026-10-17)

| Source | Where | Volume | Feeds drills |
|---|---|---|---|
| Lesson scripts with dated chart examples | `docs/curriculum/uct_method_scripts.json` (`example_spec`, `spec_verdict`) | 395 chapters, 181 with examples: 29 verified, 138 corrected, 9 replaced, 5 no-data | 2, 7, 8, 1 |
| Glossary | `docs/curriculum/uct_method_presenter_brief.json:69` | 40 terms | 1 |
| Toolkit artifacts | `docs/curriculum/uct_method_toolkit.json` | 7, incl. sizing gate (10 problems + key) and placement diagnostic (10 Y/N) | 3, onboarding |
| Trading principles | `api/data/voice_kb/trading_principles.json` | 36 (10 setup, 8 bias, 6 microstructure, 5 sizing, 5 regime, 2 meta) | 1 |
| Concept formulas | `app/src/components/chart/engine/ast/conceptVocabulary.json` | 22 | 1 |
| Methodology bible | `uct-intelligence/prompts/01_methodology_bible.txt:23-45` | 23 rules + 12 sections | 1 |
| Trade-log vault | `uct-intelligence/prompts/02_trade_log_vault.txt` | 10 trader sections; named trades with setup/entry/stop/exit/R/lesson | 12 |
| Real-bar labelled fixtures | `tests/fixtures/uct_*/` (8 detectors) | 163 files, 120 bars each, `expected.fires`, named by ticker+date | 2, 6, 9 |
| VCP gold standard | `docs/uct-scanner-intelligence/vcp_gold_standard/data/{case_answer_key,adjudication}.json` | 82 cases, 4 reviewers each; consensus 8 YES / 40 NO / 34 unresolved; quality 0-100 and lifecycle per judgment | 2, 6 |
| Vision rubrics | `api/services/pattern_vision/rubrics.py` | 14 setups × (3–4 must-haves, 2–4 disqualifiers) + essence | 6 |
| Pattern catalog | `api/routers/patterns.py::_PATTERN_METADATA` | 89 public entries | 1, 2 |
| Pattern detections + outcomes | `patterns.db` (`pattern_engine/pattern_db.py`) | 1.54 M rows / 13.6 GB on 2026-08-26; 120-day retention; outcomes with entry/stop/target hits, MFE/MAE, bars_to_resolve | 2, 7, 8, 9 |
| Model Book | `/data/modelbook.db` | setups with label_date/entry/stop/target/grade/drawings; setup_examples with result windows; year recaps | 2, 6, 7, 8, 4 |
| Setup catalog + playbooks | `app/src/pages/modelbook/{setupCatalog,setupPlaybooks}.js` | 26 glyphs; 9 full playbooks | 1, 6 |
| Market bottoms | `app/src/pages/modelbook/bottomsCatalog.js` | 9 dated cases (1974–2022), 6 signposts | 4 |
| Breadth history | `/data/breadth_daily_ohlc.db` | ~40 metrics daily from 2008-01-02 (~4,530 sessions) | 4 |
| Sentiment | `api/data/breadth_sentiment_history.csv`, `naaim_history.csv` | AAII from 1987 (15,897 rows) | 4 |
| Wire archive | `/data/wire_archive/` | daily `rundown_html` only (**the tier word is NOT stored** — see §13.1 B2; it exists only in today's `wire_data.json` and the owner-PC snapshots) | 4 (after B2) |
| Sunday Scans | `/data/desk.db` (issues, tickers) + `wisdom_chart_images.public_url` (**hot-linked Substack URLs, no bytes stored** — see §13.1 B1) | 64 issues, 2,953 chart URLs | 5 (after B1) |
| Team call archive | `/data/wisdom.db` `wisdom_archive_calls` | ticker, setup, entry/stop/target, outcome_json (r1/r5/r20/r60, mfe20/mae20, sim_R, regime) | 10, 12 |
| Desk videos | `/data/education.db` `edu_videos` | 320 videos, 319 with transcripts (20.3 M chars), chapters, ticker_moments, setups, FTS5 | 11 |
| #tsdr videos | `/data/tsdr_lessons.db` | transcript, title, recap, takeaway, tickers, tags, section | 11 |
| Catalysts | `/data/catalysts.db` | top-20 per day since 2026-05-25 with thesis text | 8 (owner reviews each) |
| Member journal | `auth.db` `j2_trades` (+ reviews, mistake_tags, emotion_tags, regime) | per member | 12 (opt-in) |

### 5.2 Mechanics that exist

| Need | Exists | Gap |
|---|---|---|
| Chart from supplied bars, no fetch | `StockChart` prop `barsOverride` (`StockChart.jsx:2529`) | Some sym-keyed side fetches still run (ticker meta :3665, logo :3923, markers/news :3248, journal overlay, patterns) and the error string prints `sym` (:18802). Pass `sym` as the item id and gate them off with `hideWatermark`, `disablePatterns`, `hideJournalOverlay`, `liveUpdates={false}`, `settingsOverride` markers off |
| Hide the ticker | `hideWatermark` :2428, `watermark` :2373, `showBrandMark`; StockChart draws no symbol header | — |
| Replay cutoff | `replayCutoff` :2447; internal bar-by-bar replay driven only by the toolbar | Need a prop-driven step index, or use `BarReplay` |
| Bar-by-bar player | `journal-2-0/components/notebook/BarReplay.jsx` | Fetches by symbol (:114); needs a `bars` prop |
| User places levels | `annotations` + `annotationsEditable` + `onAnnotationsChange(drawings[])` (:2509-2516); `position` tool = entry/stop/target (`ChartDrawingOverlay.jsx:46-51`); precedent `admin/GoldReview.jsx:232-244` | — |
| Run a detector on any window | `pattern_engine.detect_all(bars, context, pattern_ids, sym)` + `primitives/context.build_context`; replay precedent `scripts/calibration_backtest.py:29-122` | — |
| Date-bounded bars in-process | `bars_sqlite.get_bars_before(ticker, tf, max_bars, to_key)` (:697) | — |
| Bars endpoint without the symbol | none | **Build** `GET /api/study/items/{id}/bars` |
| Server PNG without ticker | `pattern_vision/chart_render.render_chart` | Thumbnails only |
| Push reminders | `web_push.dispatch(user_id, title, body, url, tag)`; armed | — |
| Scheduler | APScheduler on `web`; `_dds_insights` shape (`api/main.py:7435`) registers with `max_instances=1, replace_existing=True` only; in-memory job store; **no boot catch-up exists** (see §13.2 T9: create Today's Study lazily, not by fan-out) | — |
| Per-user store pattern | `X_DB_PATH` env + `/data/x.db`, `_SCHEMA` executescript, `_WRITE_LOCK`; conftest census pins it | — |
| Paid gate | `require_paid` (402) per router | — |
| Flag ledger | `docs/feature_flags.json`; `tests/test_feature_flag_ledger.py` | Declare `STUDY_ENABLED` (default ON) + sub-flags |
| Leaderboard primitive | `journal_two/community.list_trader_summaries` (opt-in traders) | Study keeps its own weekly XP table |
| Review screen precedent | `app/src/pages/admin/GoldReview.jsx` + `gold_review_corrections` | Copy the shape |

---

## 6. Content engine

### 6.1 The item model

One row per drill item in `study.db`. Items are immutable once published; a correction creates a new version and retires the old id.

```
study_items
  id TEXT PK            -- 'si_' + 12 hex, stable
  version INTEGER
  type TEXT             -- recall | spot | size | regime | call_scan | grade | levels | next | family | call_archive | listen | autopsy | plan
  skill_id TEXT         -- e.g. 'setup.family1.vcp'
  module TEXT           -- 'M6'
  difficulty INTEGER    -- 1..5
  prompt_json TEXT      -- what the member sees (question, choices, rubric rows, chart framing, clip bounds)
  answer_json TEXT      -- the key (hidden until scored)
  reveal_json TEXT      -- ticker, dates, provenance, what happened next, mini-lesson, lesson_key
  source_kind TEXT      -- fixture | gold_standard | curriculum | detection | modelbook | glossary | principle | toolkit | vault | archive | scans | wire | bottoms | video | tsdr | catalyst
  source_ref TEXT       -- file path / detection id / lesson_key / youtube_id / issue+image
  bars_ref TEXT         -- FK study_bars.id when a chart is involved
  sym TEXT              -- REAL ticker, never served before scoring
  asof TEXT             -- YYYY-MM-DD cutoff for chart items
  lesson_text TEXT      -- the mini-lesson (hand-written or templated)
  lesson_origin TEXT    -- session | template
  review_status TEXT    -- draft | approved | retired
  reviewed_by, reviewed_at, created_at, retired_at

study_bars              -- hermetic bar snapshots so an item never changes under a member
  id TEXT PK
  tf TEXT
  bars_json TEXT        -- [{t,o,h,l,c,v}] through asof (visible window)
  forward_json TEXT     -- bars after asof, served only on reveal/step
  sha256 TEXT

study_corrections       -- the training loop
  id, item_id, item_version, action (fix|reject|approve), field, before_json, after_json, reason, by_user, at
```

Rules:
- `sym` and `forward_json` are never in a response until the attempt is scored. The bars endpoint serves `bars_json` with the symbol replaced by the item id.
- Dates are real. Famous charts are used everywhere (owner decision); the reveal always shows the ticker and dates.
- Every chart item records the exact bars it was built from, so a later bars correction cannot silently change an answer.

### 6.2 The bank on disk

`docs/study/bank/<segment>.json` — one file per segment (e.g. `recall.glossary.json`, `spot.fixtures.uct_kicker.json`, `regime.bottoms.json`, `call_scan.2025-06.json`), each an array of items in the schema above minus the member-state fields. The bank is **the authoring truth** (same principle as `docs/curriculum/README.md`), committed to git, and imported with `POST /api/study/import` (PUSH_SECRET). Chart bars are **not** committed; the importer resolves `bars_ref` by re-reading `bars_sqlite` on the server for the recorded `(sym, tf, asof, window)` and stores the snapshot, then checks the sha256 recorded at authoring time. A mismatch rejects the item (the bars changed; re-author).

Target: **5,000+ Method items and 2,500+ Foundations items before launch**, built in owner-reviewed sessions, **both curricula in parallel** (owner: "all of it"). Sessions follow a fixed shape: (1) a generator script produces the segment's draft items from the source (Method) or the session drafts the unit from cited references and the firm's data (Foundations); (2) the session writes question copy, distractors and reveal lessons under `VOICE.md`; (3) a near-duplicate diff against the bank; (4) the owner reviews **every item one by one** in chat; (5) corrections are applied and logged to `docs/study/corrections/`; (6) the segment is committed and imported.

Foundations items carry `source_ref` as a citation (reference title and section, or the dataset and date the number was computed from). **Sources are open** (owner, review R12): the firm's library first, then any reference the authoring session can reach (textbooks, exchange and regulator documents, filings, reputable educational material on the open web) for concepts and definitions, always cited; **charts and numbers come only from the firm's own data.**

### 6.2b Staying current (owner, review R14)

The bank must keep up with the market without new authoring every week. Automatic draft feeds, all into the review queue, none live until approved:

| Feed | Cadence | Produces |
|---|---|---|
| Pattern-engine detections with resolved outcomes | nightly | spot / levels / next / family drafts with templated lessons |
| Sunday Scans issue ingested into `desk.db` | weekly | take-the-call drafts for every chart in the issue, scored once the forward window closes |
| New Desk and #tsdr videos with chapters | as published | listen-and-answer drafts per chapter with a ticker moment |
| Morning Wire tier call (**once `wire_archive.record()` persists `exposure_tier`, §13.1 B2**) | daily | call-the-regime drafts for that date (eligible after 60 days so the outcome is known) |
| Catalysts top-20 with an EP-family detection | daily | what-happens-next drafts (owner reviews each) |
| Model Book additions | as curated | spot / grade / levels drafts |

A bank-health view (Phase 4) shows coverage per skill, items with a high miss rate (candidates for rewrite), and how many drafts are waiting. History and fundamentals numbers are computed from the firm's stored data wherever it exists (index bars to 1974, breadth 2008+, earnings tables) and frozen into the item.

### 6.3 Generators (`scripts/study/`)

| Generator | Input | Output | Verification |
|---|---|---|---|
| `gen_recall.py` | glossary, principles, bible rules, concept formulas, playbooks, toolkit cards | `recall` MCQ/TF/fill-in; distractors from sibling entries of the same category | Every answer string is a verbatim substring of its source entry |
| `gen_fixtures.py` | `tests/fixtures/uct_*` + VCP gold standard (consensus YES/NO; BORDERLINE become `grade` items) | `spot`, `grade`, `family` | Bars are the fixture's; label is `expected.fires` / consensus |
| `gen_curriculum.py` | scripted chapters with `spec_verdict ∈ {verified, corrected}` | `spot`, `levels`, `next`, `recall` tied to the lesson_key | Bars from `bars_sqlite` for the window; re-run the named detector; create only if it fires or the example states explicit levels |
| `gen_detections.py` (nightly on `web`) | `pattern_detections` ⋈ `pattern_outcomes`, `status ∈ {completed, failed}`, `confidence ≥ 70`, public ids | `spot` (+ a matched `none` negative), `levels`, `next`, `family` as **drafts** with templated lessons | Bars re-read with `get_bars_before`; outcome recomputed with the `memory._resolve_outcome` rule; discard on disagreement |
| `gen_modelbook.py` | `modelbook_setups`, `modelbook_setup_examples` | `spot`, `grade`, `levels`, `next` | Admin's grade and levels; bars from `bars_sqlite` or uploaded `example_bars` |
| `gen_regime.py` | wire archive tier per date, breadth_daily_ohlc, bottoms catalog, the 12 historical turns | `regime` | Answer is the recorded tier word or the signpost sequence; no cutoff stated |
| `gen_size.py` | toolkit sizing gate + the settled sizing grid | `size` with randomized realistic inputs | Answer computed by the house formula (grid pending §11) |
| `gen_scans.py` | Sunday Scans issues + images + the named tickers; bars for the forward window | `call_scan` | Forward returns computed from bars; image shown as-is |
| `gen_archive.py` | `wisdom_archive_calls` with outcomes | `call_archive`, `autopsy` | Only calls with explicit entry/stop/outcome |
| `gen_vault.py` | trade-log vault | `autopsy` | Only entries with explicit setup, R and lesson |
| `gen_video.py` | `edu_videos` chapters + ticker_moments + transcript; `tsdr_lessons` | `listen` | Question text must quote the transcript span; clip = chapter bounds |
| `gen_catalysts.py` | `catalysts.db` rows with an EP-family detection on the same name | `next` | Owner reviews every item; thesis text appears only in the reveal, labelled as the day's AI note |
| `gen_candles.py` | `screener/candle_catalog.py` shapes and relations; candlestick detectors on stored bars | Foundations F3 `recall`, `tap`, `spot` | Teaching items use the idealized glyph; test items use a real bar the detector fired on |
| `gen_history.py` | S&P/Nasdaq bars, breadth_daily_ohlc, AAII | Foundations F7 facts (drawdown %, dates, recovery length) frozen into items | Computed, not quoted; the computation is recorded in `source_ref` |
| `gen_fundamentals.py` | FMP earnings tables / `earnings_estimates` | Foundations F5 `recall`/`scenario` with real frozen quarters | Snapshot frozen into the item with the as-of date |
| `gen_size.py` | §4.11 rule | `size` with randomized realistic inputs, flat-risk and quality-scaled variants | Answer computed by the house formula; skip cases included |

### 6.4 Templated lessons (nightly items)

`study_templates.py` renders a lesson from facts only: pattern name and family, the geometry numbers the detector stored (contractions, pivot, base depth), the levels, the outcome (target/stop hit, bars to resolve, MFE/MAE), the regime bucket, and the matching rubric essence. No model. Items keep `lesson_origin='template'` until a session rewrites them.

---

## 7. Architecture

### 7.1 Backend

- **Store:** `api/services/study_store.py`, SQLite at `STUDY_DB_PATH` default `/data/study.db`, WAL, own `_WRITE_LOCK`, `_SCHEMA` via `executescript`, `init_db()` from the lifespan next to `education_service` (`api/main.py:3782`). Tables: `study_items`, `study_bars`, `study_corrections` (§6.1), plus:

```
study_attempts(id, user_id, item_id, item_version, started_at, answered_at, answer_json, correct INTEGER, score REAL, time_ms, session_id)
study_skill(user_id, skill_id PK, mastery REAL, reps, last_at, band, fresh INTEGER)
study_profile(user_id PK, xp, level, streak, streak_best, last_done_day, freeze_used_week, daily_goal, reminder_time, reminder_on, leaderboard_optout, journal_autopsy_optin, placement_json)
study_sessions(id, user_id, kind daily|skill|checkpoint|refresher|free, skill_id, created_at, finished_at, item_ids_json, result_json)
study_badges(user_id, badge_id, earned_at, PK(user_id,badge_id))
study_checkpoints(user_id, module, attempt_no, passed, score, missed_skills_json, at)
study_weekly_xp(user_id, week_et, xp, PK(user_id, week_et))
study_reminder_log(user_id, day_et, PK)       -- one reminder per member per day, claim row
```

- **Router:** `api/routers/study.py`, prefix `/api/study`, `require_paid` on member routes, `require_admin` on review routes, `require_push_secret` on import. The body of every route checks `STUDY_ENABLED` (default on; `0` hides the product and returns 404 like `_curriculum_armed`).

| Route | Purpose |
|---|---|
| `GET /map` | skill tree with the member's bands, freshness and recommended-next |
| `GET /today` | Today's Study (creates it if absent) |
| `POST /sessions` `{kind, skill_id}` | skill session / checkpoint / refresher / free practice |
| `GET /items/{id}` | prompt only (no answer, no sym) |
| `GET /items/{id}/bars` | visible bars; symbol field is the item id |
| `GET /items/{id}/image` | Sunday Scans image (proxy from R2, ticker-free) |
| `POST /attempts` `{item_id, answer}` | server-side scoring; returns `{correct, score, reveal}`; updates skill, XP, streak, weekly XP |
| `POST /attempts/{id}/step` `{n}` | next n forward bars for `next` items (only after an answer is recorded) |
| `GET /profile`, `PUT /profile` | goal, reminder, opt-outs, journal opt-in |
| `GET /leaderboard` | weekly XP, excluding opted-out members |
| `GET /admin/review`, `POST /admin/review/{id}` | approve / fix / reject with reason → `study_corrections` |
| `POST /import` | bulk upsert from `docs/study/bank/*.json` (PUSH_SECRET); queues bar resolution for the scheduler (`get_bars_before` only, never a provider fetch, §13.1 B3); reports misses; checks sha256 against the server's own bars |
| `GET /admin/corrections/export` | corrections as JSON for the next authoring session |

- **Scoring** is deterministic server code per type (`api/services/study_scoring.py`): exact match; rubric row match; levels within `max(0.75 × ATR14, 1.0%)` of the key, scored per level; `next` direction vs outcome; `size` within 1 share / $1 after rounding; `regime` exact tier; `call_*` vs recorded outcome with a "watch" neutral band; `plan` by rule checks.
- **Mastery** (`study_mastery.py`): `mastery = 100 × Σ w_i·s_i / Σ w_i` over the skill's attempts, `w_i = 2^(−age_days/30) × difficulty`; minimum 8 attempts to leave Learning; `fresh = last_at within 30 days`. Bands never move a badge once earned.
- **Selection** (`study_select.py`): random mix of seen and unseen, weighted 2× toward skills below Practised and 2× toward items previously missed; never the same item twice in one session; Today's Study enforces the type mix in §4.5.
- **Jobs on `web`** (registered like `_dds_insights`, gated by `STUDY_ENABLED`): `study_daily_sessions` 06:30 ET daily (per-member Today's Study, catch-up on boot); `study_reminders` every 15 min (push + bell for members whose reminder time passed and whose daily set is unfinished; claim row); `study_gen_detections` 23:30 ET weekdays (drafts into the review queue, `max_instances=1`, ≤200 candidates); `study_weekly_close` Sunday 23:59 ET (freeze the week's leaderboard).
- **Flags** (declared in `docs/feature_flags.json`): `STUDY_ENABLED` (default ON), `STUDY_GEN_ENABLED`, `STUDY_PUSH_ENABLED`, `STUDY_LEADERBOARD_ENABLED`. Server flags reach the client on the auth payload (`_access_payload`, `api/routers/auth.py:733`).

### 7.2 Frontend

- `app/src/pages/desk/CoursesSection.jsx` gains a `StudyPanel` at the top (Today's Study card, streak, XP, rank) and a `SkillMap` below the course cards; `?study=` selects `map | today | skill`.
- `app/src/pages/study/`: `StudyPanel.jsx`, `SkillMap.jsx`, `DrillPlayer.jsx` (session runner: progress, item host, answer bar, reveal card), `drills/` (`RecallDrill`, `SpotDrill`, `SizeDrill`, `RegimeDrill`, `CallDrill`, `GradeDrill`, `LevelsDrill`, `NextDrill`, `FamilyDrill`, `ListenDrill`, `AutopsyDrill`, `PlanDrill`), `RevealCard.jsx`, `BadgeToast.jsx`, `Leaderboard.jsx`, `StudySettings.jsx`, hooks `useStudyMap`, `useStudySession`, `useStudyProfile` (SWR via `useMobileSWR`).
- **Charts in drills** use the real `StockChart`, locked down: `barsOverride` from `/items/{id}/bars`, `sym={item.id}`, `hideWatermark`, `showBrandMark={false}`, `liveUpdates={false}`, `backgroundWarm={false}`, `disablePatterns`, `hideJournalOverlay`, `hideCompare`, `settingsOverride` with every marker/news feed off (memoized), `exactDateRange` to the visible window. `LevelsDrill` adds `annotations`/`annotationsEditable`/`mobileDrawBar` and reads `points[].price`. `NextDrill` renders `BarReplay` after it gains a `bars` prop (additive: `bars ?? fetch`).
- **Lesson rows** in `PathView.jsx` show "Study this" when the lesson_key maps to a skill (`docs/study/skill_map.json`, loaded server-side and returned in `/map`).
- **Admin:** `app/src/pages/admin/StudyReview.jsx`, copied from `GoldReview.jsx`: chart or image, prompt, answer, lesson, approve / fix (inline edit of answer and lesson) / reject with reason.
- **Mobile:** single-column cards; 44px controls; chart full width above the fold; level placement tap-tap with the existing coach chip; no horizontal scroll; breakpoints 640/1024 only.
- **Design:** tokens from `docs/brand-design-system.md`; gold for mastery and XP; `UIcon` only; CSS Modules; reduced motion respected.

### 7.3 No runtime AI

There is no model call in the product. The only places text is generated are (a) authoring sessions and (b) `study_templates.py`, which fills fixed strings from stored numbers. This removes the cost rails, the population cap, the meters, and the eval harness from scope. If a live tutor is ever wanted, the primitives are known (`compass_eval.judge.judge_answer(rubric=)`, `coach.AnthropicClient.write_review`, `daily_counters`, `narrative_cost_guard`) and this section is where it would be added.

---

## 8. Honesty and safety rules (load-bearing)

1. **No model writes a market fact.** Charts, labels, levels and outcomes come from stored bars, detector output, admin labels or the firm's own records. Session-written lessons may only cite numbers present in the item's facts; the importer rejects a lesson containing a number not in `answer_json`/`reveal_json` (the COT narrative's number-grounding rule, applied offline).
2. **The answer key is provenance-tagged.** The reveal names the source. A member can see why the key is the key.
3. **Unresolved is not wrong.** Gold-standard BORDERLINE cases and `expired` outcomes become grade/judgment items, never yes/no items.
4. **The ticker never leaves the server before scoring.** A test walks every study route's response for `sym` and forward bars.
5. **No sizing drill without a stop.** Every size item carries entry and stop; the key never exceeds the 2% ceiling or the regime × grade grid.
6. **Mastery is not P&L.** No drill scores a member on money; autopsies grade idea, execution, preparation.
7. **Member data stays with the member.** Journal-sourced autopsies are opt-in and never appear outside that member's view or in any leaderboard.
8. **Nothing goes live unreviewed.** `review_status='approved'` is the only state the member routes serve.

---

## 9. Phases

Two tracks run in parallel from the start: **Content** (the bank, built in owner-reviewed sessions) and **Product** (the app). Each product phase ships live behind the kill switch, one master merge at a time, scoped suites green, with a named acceptance test.

| Phase | Product | Content (sessions) | Acceptance |
|---|---|---|---|
| **0 · Settle** (all at once, owner: "do it all with no hold back") | — | `VOICE.md`; `UNITS.md` (every unit per track, what it teaches, example count); `skill_map.json`; `sizing_rule.md` from §4.11; proposed pass bars; intro-video toolchain proposal with per-video cost; voice-clone consent note | Owner signs off every file in one review session |
| **1 · Study, live** | `study.db` + store + router; Study panel + animated trail map inside Courses; `DrillPlayer` with Recall, Spot, Size, Regime, Take-the-call (Scans), Tap-the-chart, Scenario; unit intro card + video player; levels (3×3) and Test-out; optional placement test; bars-by-item + image endpoints; XP, calendar streaks with weekly freeze, session combos, end-of-session card, badges, weekly XP leaderboard with accuracy; sound/haptics toggle; Today's Study job; push reminders (opt-in); Study Review admin screen; import endpoint | **Both curricula, interleaved weekly.** Foundations: F1-F4, F9, F10 first (basics, chart reading, candles, patterns, risk, orders). Method: glossary, principles, bible, concepts, playbooks → recall; fixtures + gold standard → spot/family; bottoms + 12 turns + wire tiers → regime; sizing rule → size; Sunday Scans 2025-06 → 2026-09 → call_scan. First three intro videos approved. **Target ≥ 1,200 Foundations + ≥ 2,000 Method approved** | Owner completes Today's Study on phone and desktop; `tests/test_study_*.py` (store, scoring, no-sym-leak, import sha, reminder claim, test-out) + `StudyPanel.test.jsx`, `DrillPlayer.test.jsx`, `SpotDrill.test.jsx`, `TapDrill.test.jsx` green; mobile audit shows no overflow on `/desk?section=courses` |
| **2 · Chart Arcade** | Grade, Levels, Next (replay), Family, Take-the-call (archive), Listen drills; `BarReplay` bars prop; nightly `gen_detections` into the review queue with templated lessons; catalysts items (owner-reviewed) | Foundations: F5-F8, F11, F12 (fundamentals, options to advanced, history and macro, psychology, styles, process); all intro videos. Method: curriculum examples → spot/levels/next; Model Book; archive calls; Desk + #tsdr video chapters → listen; nightly detections reviewed weekly. **Target ≥ 2,500 Foundations + ≥ 5,000 Method approved** | 200 detection-sourced drafts reviewed; levels scoring validated against 20 Model Book rows; replay step never exposes forward bars before an answer (test); listen items quote the transcript (test) |
| **3 · Review station** | Trade autopsy (vault, archive, member journal opt-in), Build-the-plan with rule scoring and Notebook save, module checkpoints and badges, refresher suggestions, freshness | Segments: vault + archive failures → autopsy; capstone plan sets | Checkpoint badge awarded once (test); journal items invisible to other members (test); plan scoring rejects size-before-stop and >2% (tests) |
| **4 · Growth system** | Corrections export, session playbook for weekly batches, item retirement/versioning, bank health dashboard (coverage per skill, miss rates per item, items with high miss rate flagged for rewrite) | Weekly batch cadence established; bank ≥ 5,000 and growing | Two consecutive weekly batches imported with zero manual fixes to the pipeline |

Branches `feat/study-phase-N`; worktree with its own `node_modules`; frontend tests chunked, backend pytest by named files (CLAUDE.md resource rules). Deploys follow `docs/runbooks/deploy-windows.md`; nothing here touches flow-worker's watch list.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Pattern-engine labels are machine labels (`historical_score` is a hard-coded 50; `expectancy_R` assumes 2R) | Only `confidence ≥ 70`, public ids, resolved outcomes; drafts until reviewed; the reveal says "the firm's detector called this X and it resolved Y" |
| 13.6 GB `patterns.db` on the web pod | Nightly generator uses indexed queries on `status`, `confidence`, `last_seen_at`; ≤200 candidates; `max_instances=1`; off-hours |
| Single web process, shared event loop | Items are hermetic snapshots; generators run on the scheduler, never on a request |
| 5,000 items is months of review | Sessions are segment-sized and reviewed in chat; generators do the mechanical part; corrections feed the next session so review gets faster |
| Sizing grid unsettled | Phase 0 workshop; `gen_size.py` reads one grid file `docs/study/sizing_grid.json`; the toolkit card is regenerated from it |
| Famous charts recognisable | Accepted by the owner; the reveal is the lesson either way |
| Sunday Scans images show tickers | `call_scan` items show the image as-is (the owner keeps famous charts); the question is "take it or not", not "name it" |
| Leaderboard on by default | Opt-out in settings; no member data beyond XP and display name |
| Scope creep into a trading game | Non-goal; no P&L scoring anywhere |

---

## 11. Owner decisions (2026-10-17, in chat)

| Topic | Decision |
|---|---|
| Placement | **Inside the Courses tab** (not a new Desk tab) |
| Name | **Study** |
| Visibility | **Live from day one** for all paid members ("we still don't have users live yet, just put it on the site"); kill switch kept |
| Courses link | **Two-way links** (lesson → drills, drill → lesson) |
| Setup count | **26** (keep both Parabolic lessons) |
| Regime bands | **Use the firm's recorded tier word per date; never state cutoffs** |
| Sizing grid | **Open: owner and build team will work out better sizing rules together** before `gen_size.py` runs. The current app grid (`houseSizing.json`: GREEN A+25/A20/B10, YELLOW 15/12/6, ORANGE 8/5/0, RED 0) and the toolkit card (A+ only: 20–25 / 15 / 8; B "reduced"/SKIP) agree on A+; the card leaves A and B as words |
| Nightly detector items | **Admin review per batch** before members see them |
| Famous charts | **Keep them all**, everywhere, as-is |
| Own-journal autopsies | **Opt-in per member** |
| Video drills | **Yes, Desk videos and #tsdr Discord videos** |
| Sunday Scans + archive calls | **Yes, early** (Scans in Phase 1, archive in Phase 2) |
| Catalysts drills | **Yes, owner reviews every item** |
| Pass bars (80% / sizing 100%) | **Owner will review all of it**; course-building feedback should also train the system |
| Locks | **No locks; the skill map is open** |
| Fading | Owner wants rewards kept and continued study encouraged → **badges never removed; Fresh / Needs-a-refresh indicator; bonus XP for refreshers** |
| Item scheduling | **Random mix of old and new** (weighted toward weak skills and past misses) |
| Reminders | Owner: "whatever you think is best" → **push + in-app bell, opt-in, member-chosen time, once a day** |
| Streaks | **Every calendar day, one free miss per week** |
| Badges | **All four kinds, kept simple and exciting** (module, setup reps, streak, Gold) |
| Explanations | **After every question: the answer and a brief lesson** |
| Live AI tutor / API spend | **None.** New questions produced in scheduled Claude Code sessions (weekly or monthly), reviewed, imported |
| Free-text drills | Owner open; wants it valuable and hands-off → **rule-scored plan builder + unscored "why" saved to Notebook** |
| Drill charts | **Real interactive chart, locked down** |
| Daily length | **10 questions a day to encourage participation, plus unlimited extra practice** |
| Phase 1 scope | **Approved as proposed** (Study inside Courses, daily set, recall + spot + size + regime + Sunday Scans calls, XP/streaks/badges, review screen, ~500 reviewed items; owner raised the content target) |
| Review flow | **Review everything in sessions to build the full 5,000+ bank first, segment by segment; then prove the new-question system is solid** |
| Reveal | **Always reveal** ticker, dates, provenance, outcome, lesson |
| Social | **Leaderboard only** (no Discuss threads) |

### 11.2 Second round — the Foundations layer (2026-10-17)

| Topic | Decision |
|---|---|
| Scope | **A full "Duolingo for stocks" in front of the Method:** market basics, chart reading, candlesticks, fundamentals, options, history, macro, psychology, "anything else introductory and useful for a swing, day or position trader managing an account" |
| Audience | **Has a brokerage account, has traded a little** |
| Structure | Owner: "however you think is solid"; concern that some will be bored by easy units while others need them → **two curricula on one map, Foundations recommended first, everything open, Test-out on every unit, optional placement test** |
| Sources | **"From everywhere possible, built here"** → authored in sessions from cited references plus the firm's own data; every fact cited; numbers computed from stored data where it exists |
| Unit shape | **Questions only, opened by a short exciting intro (AI-produced video + text)**; no reading pages |
| Formats | **Multiple choice, true/false, fill-in, tap-the-chart, scenario stories.** Match/order not in v1 |
| Voice | **"Avoid AI shit like regime, dial, tape … make it sound like us, a person, a friend and mentor teaching"** → `VOICE.md` (§4.9) |
| Diagrams | **Idealized drawings for teaching, real charts for testing**; owner hands-on in review |
| Options depth | **Beginner to advanced, all of it, detailed** |
| Unit intros | **Auto-built high-quality AI videos plus text** |
| History verification | **Use the firm's own data** |
| Fundamentals | **Real company numbers from stored snapshots, frozen into the item** |
| Extra tracks | **Account and risk basics, order types and execution, styles (day/swing/position), process; mostly technical; no taxes** |
| Video voice | **Cloned version of the owner's voice** (consent recorded first) |
| Video style | Owner: "both, maybe an animated version of me, you decide" → **brand motion graphics with real-bar charts, plus a stylized animated host of the owner where useful** |
| Guide character | Owner: "idk" → **none; reveals speak as the mentor in first person** |
| Feel | **Subtle sound/haptics, session combos, end-of-session card, animated trail path; cool but not over the top; built for short attention spans without thinning the content** |
| Review depth | **Everything, one by one, fully** |
| Volume | **Robust and detailed, never lame or repetitive** → ~12 tracks, 100-120 units, 2,500+ questions, with an anti-repetition rule |
| Levels | **3 levels with 3 sub-levels each (9 rungs per unit)** |
| Placement test | Owner: "eh idk" → **optional, about 15 questions** |
| Sizing: risk per trade | **0.25% to 2% depending on quality, performance, market, setup, edge; flat-risk sizing also taught as valid** |
| Sizing: stop | **Low of day or prior low of day first; structure and ATR as supporting methods** |
| Sizing: size | **Dynamic from the stop (1% stop at 50% size = 0.5% risk); the grid is a cap layer, not the lesson** |
| Sizing: portfolio | **Heat ≤ 10%, 5-10 positions, progressive exposure** ("something like all of that") |
| Build order | **"All of it"** → both curricula authored in parallel, interleaved weekly |
| Video production | **Built locally in sessions, reviewed, then uploaded to the site** |
| Daily mix | Owner: "idk" → **follow the member's position on the map, with 2-3 items from elsewhere** |
| Leaderboard | **Weekly XP with accuracy shown beside it** |

### 11.3 Third round — section-by-section review of the plan page (2026-10-17)

| Section | Owner's note | Applied where |
|---|---|---|
| R1 Vision | AI may live in the product "if it is good and needed"; the goal is elite-trader education across simple and complex technical, fundamental, structural and process skills | §3 non-goals softened; §7.3 |
| R2 Placement | Confirmed; keep it simple and best for our kind of trader | §4.1 simplicity rule |
| R3 Tracks | Confirmed; weight toward technical, recognition, memory, setups, process, with tons of great examples | §4.8 centre of gravity |
| R4 Method | Confirmed; owner will review and train for accuracy; add supply/demand, support/resistance, trendlines, drawings, patterns | §4.8 F2b |
| R5 Drills | Confirmed; show tricks and failed examples so stop-outs are expected and risk/timing are the reason | §4.8 failure cases |
| R6 Unit | Confirmed; "what are they about" → unit list to review | §4.8 unit list, Phase 0 |
| R7 Voice | Confirmed; not too AI, but structured and easy to understand | §4.9 |
| R8 Videos | Confirmed; will take refinement; owner reviews in great detail | §4.10 |
| R9 Loop | Confirmed; simple and easy to navigate | §4.1 simplicity rule |
| R10 Sizing | Confirmed | — |
| R11 Pipeline | Confirmed; all real content and great examples | — |
| R12 Data | Confirmed; plus the open internet and anything accessible for concepts and robust answers | §6.2 sources |
| R13 Engine | Confirmed; owner asked for a thorough final sweep before finalising | §13 |
| R14 Phases | Confirmed; plus whatever keeps the bank up to date while relying on the library | §6.2b |
| R15 Open items | "Do it all with no hold back" → all Phase 0 files in one session | §9 Phase 0 |
| R16 Go | After one final sweep at the highest effort: access, detail, simplicity, fun, value | §13 |

**Still open:** the pass-bar numbers (proposed in Phase 0, owner decides), the intro-video toolchain and its per-video cost (proposal in Phase 0, owner approves before the first render), the voice-clone consent record, and per-segment "obscure explanation" needs (decided as the bank grows).

## 13. Final sweep (2026-10-17) — findings and the changes they force

Three independent reviews (technical feasibility against the code; content accuracy and pedagogy against the dossier, the course JSON, the bible and the labelled sources; product design against the best learning apps). **Where §13 contradicts an earlier section, §13 wins.** Items marked ⚑ need an owner decision (listed again in §13.7).

### 13.1 Blockers (must be fixed before Phase 1 content is authored)

| # | Finding | Evidence | Change |
|---|---|---|---|
| B1 | **Sunday Scans images are not stored anywhere the server can serve.** They are hot-linked Substack CDN URLs; `wisdom_chart_images` holds only `public_url` with `r2_key NULL`, `status='provisional'`, and a `label_ticker` *guessed* from nearby text. The `wisdom_archive_images` R2 store is the TSDR team-archive store, a different table. | `api/services/wisdom/sources/sunday_scans.py:24-27, 409-419`; `ArticleReader.jsx:122` | A one-time job downloads every `public_url` into R2 under `study/scans/<sha>.png` (sha-verified, `data_sync.put_bytes`), served by `302` to a presigned URL (the Desk-audio pattern, `education.py:397-419`). The image→ticker map is **owner-confirmed per item** in review; `label_ticker` is a hint, never a key. |
| B2 | **The "recorded tier word" does not exist in the wire archive.** `wire_archive.py` stores `{date, rundown_html, archived_at}` only. The tier lives in `wire_data["game_plan"]["exposure_tier"]` (overwritten every morning) with the vocabulary **Aggressive / Constructive / Neutral / Caution / Defensive**; the course and sizing use **GREEN / YELLOW / ORANGE / RED**; the dashboard colours the 0-150 score on seven thresholds; the score scale changed on 2026-03-22; no firm tier exists before early 2026. Full snapshots exist only on the owner's PC. | `wire_archive.py:13-14, 73-86`; `quote_of_the_day.py:13-15, 153`; CLAUDE.md "UCT Exposure Rating" | (a) `wire_archive.record()` persists `exposure_tier` and `score` beside `rundown_html` from now on. (b) History is backfilled from the PC snapshots as **authored facts** in the bank. (c) Every regime item carries `tier_scale_id` and the date range that scale was live. (d) The Method teaches **one mapping table: 5 wire words → 4 sizing bands**; the item key is the band. (e) Pre-2026 dates become **"which signposts had fired"** items keyed on computed breadth facts (distribution-day count, % above the 50-day, net new highs), never on a tier. (f) "Wire archive" is not a Phase-1 tier source until (a)+(b) exist. |
| B3 | **The import endpoint as written can trigger provider cold-fetches on the web request thread** (the 524 class), and web's `bars.db` (R2-merged) does not hold delisted/renamed names or decade-old windows; a sha recorded on the PC will not match web's bars. | `bars_fetch.py:2478-2543` (`_replay_cold_sem` 20 s); `main.py:5109-5110` (`USE_REMOTE_BARS=1`) | The importer calls `bars_sqlite.get_bars_before` **only**, never `bars_fetch`; returns the list of misses instead of fetching; runs **chunked under the scheduler**, not on the request. Authoring sessions fetch bars **through the production bars API** (`/api/bars/{t}?tf=D&to=<asof>` with PUSH_SECRET), so the sha is recorded against the same bars the server holds. A pre-import "warm these symbols" list goes to the worker. |

### 13.2 Technical corrections to earlier sections

| # | Correction | Applies to |
|---|---|---|
| T1 | **Hidden ticker:** `useTickerMeta(sym)` (:3665) and `useTickerIpo` (:3690) still fire for the item id and hit yfinance/FMP/Finnhub server-side per item per member; `useChartDrawings(sym)` (:6328) writes localStorage under the item id; `cs.markers.desk` (:3307) must also be in the off-list; `Loading {sym}…` / `Failed to load chart for {sym}` print the item id. **Add a `studyMode` prop** that nulls the three hooks when `barsOverride` is set, hides the loading/error text, and have `/api/ticker-meta` short-circuit non-universe symbols without a provider call. Confirmed: `barsOverride` does bypass all IndexedDB writes. | §5.2, §7.2 |
| T2 | `exactDateRange` does nothing without `entryDate`/`exitDate` (:2404, :8404-8508). Pass `entryDate` = first visible bar, `exitDate` = `asof`. | §7.2 |
| T3 | **Lock the chart with `frozen`** (:2412, stops touch pan/zoom; without it every chart-tap pans) and `showDrawingTools={false}` (:2389). | §7.2 |
| T4 | **One `StockChart` per session**, not per item: swap `barsOverride` + `sym={item.id}`; non-chart items hide it with `visibility:hidden`. Mounting the 20k-line chart ten times on a phone breaks the 5-minute target. | §7.2 |
| T5 | **Bars ship with the set:** `GET /today` returns all prompts and visible bars inline (≈150 KB gzipped for 10 items); `/items/{id}/bars` stays for practice sessions; forward bars still only after a scored attempt. The set composer never places two chart items back to back. | §7.1 |
| T6 | `BarReplay` + `bars` prop is feasible (symbol is used only in the fetch) but its chart is recreated on the `[bars]` dep (:128-166), so an array that grows per step remounts and resets the playhead. Specify the step contract: append-only bars + stable `startIdx` + `setData` on append (or `onNeedMore(idx)`), Phase 2. In Phase 1 the reveal appends forward bars to the **same** mounted chart (the signature moment), never a second chart instance. | §5.2, §7.2 |
| T7 | "Mark the levels": the annotations path works (no `sym` store), but the annotations branch has no undo/redo and the desktop `ChartToolbar` still renders. **New StockChart props needed: `armedTool="position"` + `toolsAllowlist`**, hide the toolbar, drill supplies its own Clear. HUD: "Entry · 1 of 3", "Stop · 2 of 3", "Target · 3 of 3". Tap/levels items frame **40-60 bars** so a target region is ≥24 px wide at 390 px (`handleGrabRadius`). | §4.3, §7.2 |
| T8 | `patterns.db` has indexes on `(sym,tf)`, `pattern_id`, `status`, `detected_at` only; **none on `confidence` or `last_seen_at`**; outcomes are a separate table joined on `detection_id`. It is web-owned (universe scan 01:00 ET, prune 00:40 ET, outcomes every 4 h, `busy_timeout` 5 s). Nightly generator: filter by `detected_at` window + `status` with a LIMIT, confidence in Python, run **after 02:00 ET**. | §7.1, §10 |
| T9 | The `_dds_insights` citation was wrong: it registers with `max_instances=1, replace_existing=True` only; there is no `misfire_grace_time`/`coalesce` and **no boot catch-up** anywhere. **Drop the 06:30 fan-out job**; Today's Study is created lazily on first `GET /today`. Keep `study_reminders` (claim row) and `study_weekly_close` with an explicit catch-up check. | §5.2, §7.1 |
| T10 | Flags: `STUDY_ENABLED` default ON needs **no** ledger entry; `STUDY_GEN/PUSH/LEADERBOARD_ENABLED` default off need entries with notes; reads must be string-constant `os.environ.get("STUDY_X_ENABLED", …)`; client polarity in `AuthContext.SERVER_FLAGS`; copy the hub-preview rails (`tests/test_hub_preview_flag.py`: per-request read + default-in-source). | §7.1 |
| T11 | `require_paid` is **defined locally per router with its own 402 sentence** (`tests/test_user_definitions_auth.py:275-280`). | §7.1 |
| T12 | `reachable.test.js` sweeps all of `app/src`: every new file must be imported from the live tree in the same commit. `GoldReview.jsx` has no route; it is mounted by `pages/admin/PatternReview.jsx:238`. `StudyReview` mounts the same way (a mode of the admin review page). | §7.2 |
| T13 | `CoursesSection.test.jsx` mocks only `/api/education/videos|paths`; `StudyPanel` must render a skeleton on `null` and the test must mock `/api/study/*`. | §9 acceptance |
| T14 | `lesson_key` exists only in `CurriculumLessons.jsx`; `PathView.jsx` rows are video steps keyed by `youtube_id`. The lesson→unit map keys on `lesson_key`; the "Study this" door is on the **module seam** in PathView ("Practise this module") and the reveal's "Read the lesson" link opens the lesson. The flat `CurriculumLessons` list is retired from the Courses page when Study ships (design finding D1). | §4.1, §7.2 |
| T15 | **Intro-video hosting:** R2 keys `study/intros/<unit>.<sha>.mp4` + `.vtt` + poster, a PUSH_SECRET upload door, `GET /api/study/intro/{unit}` → `302` presigned (1 h), native `<video playsinline>`; 720p H.264 ≤ 6 MB plus a 540p rendition. Never on the `/data` volume. | §4.10, §7.1 |
| T16 | Mobile: the joystick hub mounts on every page at ≤1023 px coarse pointer with no `/desk` mode and sits over a full-width drill chart. **The drill is a fullscreen `Sheet`** (design finding D5) and the hub must be suppressed while it is open (a small hub change: hide when a fullscreen Sheet is mounted). Add `/desk?section=courses` to `tools/mobile_audit.py`'s route list. `--tap-min` declared at base or ≤1024 px, never phone-only (`tapFloor.test.js`). | §7.2, §9 |
| T17 | `study.db`: literal `os.environ.get("STUDY_DB_PATH", "/data/study.db")` so the conftest census pins it; `POST /attempts` writes five tables → **one `BEGIN IMMEDIATE`** under the module `_WRITE_LOCK`; `init_db()` in the lifespan next to `education_service._init_db()` (`main.py:3783`). Bank ≈ 100-250 MB on the volume; back up with `VACUUM INTO`. | §7.1 |
| T18 | Reachability on web (verified): wisdom archive calls ✓ (`WISDOM_ARCHIVE_ENABLED` armed 2026-10-16), `desk.db` ✓, `breadth_daily_ohlc.db` ✓ (R2-pulled), `modelbook.db` ✓, `education.db` ✓ (the FTS index lives in `education_search.py`, not the service), `catalysts.db` ✓, FMP tables ✓ (`/data/fundamentals_tables.db`), push + bell ✓. **`tsdr_lessons.db` may not exist on web** (`TSDR_LESSONS_ENABLED` pending, set nowhere): #tsdr listen drills depend on that programme being armed. | §5.1 |
| T19 | Preference keys: Study keeps settings in `study_profile`; if any `setPref('…')` is added, the key goes into `_PREFERENCE_KEYS` (`auth.py:2807`). | §7.1 |

### 13.3 Content and accuracy corrections

| # | Finding | Change |
|---|---|---|
| C1 | **Module numbering is wrong.** The shipped course has **16 modules** (`uct_method_course.json`: M5 Risk, M6 Scan Engine, M7-M10 Families I-IV, M11 Intraday Toolkit, M12 Selling, M13 Portfolio, M14 Inner Game, M15 Options, M16 Capstone); the spec used the dossier's 14. | `skill_map.json` keys on the course JSON's 16 labels; **16 module badges**; dossier numbering removed from the spec. |
| C2 | **Course M6 (Scan Engine)** — nightly funnel, A/B watchlists, "from alert to fill", the premarket routine — is missing from the Scan station, although `scanner_candidates.py` computes every input (ADR%, pole%, EMA distance, vol_acc_ratio, close CV, 7-criterion score). | Add skill **"Run the funnel"** sourced from frozen scanner candidate rows and the M6 scripts. |
| C3 | **Course M11 (Intraday: ORB, 30-Minute Pivot, Go Signal)** is missing although those are 3 of the 26 setups; `setupCatalog.js` has five families (incl. Intraday) while the five-field card asks for one of four. ⚑ | Add an **"Intraday timers"** skill with the supply caveat (intraday bars exist for ~7% of symbols), or remove the three from the count and fix the card. Owner decides. |
| C4 | Dossier/course content with no skill: casino math + the marble game (6+ loss streak in 20 draws); the Five Leaks diagnostic; the **Winners Gallery** (label-free perception reps, the opposite of spot-the-pattern); "cash is a position"; drawdown arithmetic and the expectancy self-calc (R-ledger); the five-field card and the **four entry triggers** (BASE BREAKOUT / PREV DAY HIGH BREAK / PREV LOW RECLAIM / RED TO GREEN, the firm's own vocabulary); adding to winners (ADD vs new); catalyst taxonomy; the **Earnings Decision** (hold through / trim / step aside); the drawdown protocol (−5% halve, −10% pilot-only); per-emotion templates (the Method has no psychology drill); the specialization contract; primary vs secondary vs exit-side function of each play. | `UNITS.md` carries a column **"course lesson covered"**; every uncovered lesson is signed off by the owner explicitly. Add: a Winners Gallery unit (look, no label), an entry-triggers unit, an Earnings Decision unit, a Method psychology skill, a drawdown-protocol numeric unit. |
| C5 | Volume is one skill; elite coverage needs relative volume by time of day, up/down volume ratio, pocket pivot / VDU, volume at price (`volume_profile_nodes` detector exists), climax volume / largest-volume-down-day sell rules, VSA no-demand/no-supply (detectors exist). | Split Volume into **three skills** (confirmation · accumulation signatures · climax and sell signals), each with a detector-backed real-bar drill. |
| C6 | RS-line drills need a ratio series: "RS line new high before price" is the most drillable RS fact, but the drill chart hides compare and no item renders stock ÷ SPY. RS Rating (percentile) and RS line are different objects and the sources mix them. | Add a **two-series chart item** (stock + stock/SPY ratio from stored bars); teach rank vs line as two terms. |
| C7 | Gaps were dropped between dossier and course; gap types, fill-rate base rates by size and "gap-down-filled" (the strongest measured candle label) are all computable. | A **Gaps unit** in F2 with fill rates computed by script and frozen into items. |
| C8 | Sector/theme rotation has no source in §5.1 although the firm holds `themes_taxonomy.json` (112 themes), theme returns, 11-SPDR sector flow, RS rankings, `leading_sectors.json`. | Add frozen theme/sector snapshots as a Scan source ("which group led the last 4 weeks", "is this name in a leading group"). |
| C9 | Earnings-season tactics: implied move, 4-quarter beat history and reaction gaps exist in the calendar enrichment; nothing drills expected vs realized move or the hold-through decision. | A numeric F5/Method unit from frozen enrichment rows. |
| C10 | Short-selling mechanics absent from Foundations (locate/borrow, HTB fees, days-to-cover, squeeze risk, sized-down rule). | **F10b "Shorting mechanics"** before the Family IV mirror. |
| C11 | Position-management math missing as numeric drills (open R after partials, breakeven-rule stop moves, the 4-phase trail, R still at risk). | `manage.math` numeric items generated with `gen_size.py` machinery. |
| C12 | Three setup vocabularies coexist: the 26 catalog, `setupGroups.js` (32), the brain's 48 templates; VCP and High Tight Flag (the two best-supplied setups, with rubrics and the gold standard) are **not in the 26**; "Flat Base Breakout" carries a VCP essence. ⚑ | The 26 is canonical for Study; `skill_map.json` aliases every other name; the catalog header ("24") and the five-field card are fixed in Phase 0; no recall item asks "how many setups". **Owner says where VCP and HTF map.** |
| C13 | **F6 teaches dealer positioning to the advanced level while the dossier makes flow the capstone tool** (anti-pattern 1: flashy tool before chart reflexes). | F6 stops at defined-risk substitutes (single legs, verticals, covered calls); flow and dealer positioning live only in the Method Overlay. |
| C14 | **Machine labels as keys:** `historical_score` is hard-coded 50; `_resolve_outcome` fires entry on any high ≥ entry (a 15% gap-through "triggers"), checks stop before target on the same bar, and expires at 210 sessions while the comment says 30; the VCP gold standard has only **7 `both_agree_positive`** cases (25 detector-only, 25 vision-only); `cup_handle_uct` fires on 2 of 2,890 symbols. | A detection becomes a `spot` key only when confidence ≥ 70 **and** the outcome resolved inside a window the item states; the reveal names the detector and its geometry numbers; disagreement and unresolved cases become `grade` items with the reviewers' reasoning, never yes/no; `expired` is **"undecided"**, not "chops"; `next` items use one window (20 sessions) for all three answers. |
| C15 | **The 163 fixtures are detector unit tests, not teaching examples:** 8 tickers only (AAPL 66, MSFT 40, AMZN 19, NVDA 17 …), ≈6 positives per setup, several edge cases are real bars with a value edited. | Fixtures are **seed only**; only unmodified positive/negative files are eligible; edge files are reviewer-only. Supply comes from nightly detections, archive calls and Model Book. |
| C16 | **Split adjustment:** `bars.db` is split-adjusted; Scans images print the price of the day; scripted examples quote split-adjusted dollars. A dollar figure in a prompt or key is wrong after a split; the sha check cannot fix it. | Prompts and keys carry **percent-from-reference and bar index**, not dollars, wherever the question allows; every chart item records `adjustment_basis`; Scans returns are ratio returns from bars, never read off the image. |
| C17 | **Sunday Scans "take the call" is biased by construction:** the firm's annotation is drawn on the image, every pick was liked, 64 issues are one regime, and members know what the market did since. | Fair-scoring rule: ask only what the annotation does not answer (stop, grade, family) or crop it; score against the **issue's own base rate** and SPY over the window; forward window opens at the **next Monday open**; "take" is defined against a trigger and a stop (entered only if the trigger printed, stopped if the stop printed); "watch" is correct when neither printed within 5 sessions; the reveal shows the base rate. |
| C18 | **Candlestick direction is not a fact:** the measured-edge study shows hammer and shooting star flip sign at next-open entry; the largest surviving effect is 0.79%/5 sessions; Bulkowski contradicts the classic reading on 20 of 77. | F3 teaches **names and the auction reading** (where the close sat, who won the session), never direction as fact; any "what does it predict" item keys on the measured number and the reveal says "textbook says X; on our tape, measured from the next open, Y". `hammer`/`bullish_engulfing` are not spot-drill setups. |
| C19 | Base-catalog refusals and unsourced numbers: 65 `missing=` refusals; `trading_principles.json` carries numbers (e.g. "40-50%+ breakout volume" attributed to Minervini) that the catalog's own audit could not find in the source. | A numeric recall key comes only from a **`sourced` criterion** with the verbatim quote in the reveal; `origin="uct"` numbers are asked as "the firm's number"; nothing from `trading_principles.json` becomes a key until matched to a sourced criterion. |
| C20 | **MA-stack drift:** the firm's stack is 9/20/50/200 (dossier CORRECTIONS) but rubrics are 10/21/50, the bible mixes 150/200, 21/50/200, 10/21/50, 10-day; some catalog glyphs use a 4-EMA of highs. The "verbatim substring" rule would mint contradictory keys. | Every MA number in a key is **tagged by whose system**; "the firm's" questions use 9/20/50/200 only; a trader-attributed number appears only in a question that names the trader. Same rule for EP trailing (the firm: 10/20-day). |
| C21 | Hindsight: every "what happens next" on a famous ticker is answered by memory. | At least half of `next` items per skill come from non-famous names with the ticker hidden; `next` mastery counts hidden-ticker items only. |
| C22 | Curriculum examples are concentrated (NVDA 28, SMCI 10 of 167 usable) and only ~40 mention a loss. | `gen_curriculum.py` caps one ticker at 10% of a segment and rejects when the named detector does not fire (no fallback to "explicit levels"). |
| C23 | Detections carry 120-day retention, so the nightly feed is always one regime. | The bank-health view reports regime mix per skill; the generator back-fills from Model Book and the archive when a regime is missing. |

### 13.4 Example supply per setup (the honest table)

Legend: D public detector · d detector exists but **not public** (excluded by the "public ids" filter) · R rubric · P playbook · F fixtures.

| Setup | Supply | Verdict |
|---|---|---|
| Flat Base Breakout | D, R, P | medium (losses from outcomes only) |
| Bull Flag | D, R, P | medium |
| IPO Base | P only | **none** |
| Launchpad | d, P, F20 | medium if the id is made public |
| Cup & Handle | D (fires on 2 of 2,890), R | effectively none |
| 20 EMA Pullback | D (21-period, wrong for the firm), d, R, P | medium, MA-drift trap |
| EMA Crossback | base-catalog structure, P | thin |
| Wedge Pop / Wedge Drop | classical wedges only, P | thin |
| Episodic Pivot | D, d, R, P, catalysts.db | good |
| Power Earnings Gap | D, R | good |
| News/Earnings Gapper | — | **none** |
| High Volume Edge | D, F17 | medium |
| Gap Support | d, F22 | medium if public |
| Kicker Candle | D, F24 | medium |
| 2B Reversal | — | **none** |
| U&R | D, d, R | good |
| Slingshot | D, F20 | medium |
| Oops Reversal | D, F22 | medium |
| Remount | D, R | medium |
| Failed H&S / Rounded Top | only the pattern that is supposed to fail | thin |
| Parabolic Long | base-catalog only | **none** |
| Parabolic Short | D | medium |
| ORB | D; intraday bars for ~7% of symbols | thin |
| 30-Minute Pivot | — | **none** |
| Go Signal | d, F20 | medium if public |
| *(not in the 26)* VCP · High Tight Flag · Capitulation | D+R+82-case gold standard · D+R · F18 | better supplied than most of the 26 |

Rules that follow: (1) `UNITS.md` lists per setup the source and the count of **wins and losses** available; (2) setups with <10 labelled examples ship only after the owner labels them in `StudyReview` (a **labelling queue**, not a generator); (3) losses come first from archive calls with explicit entry/stop/outcome, second from `failed` detections whose stop was the detector's stop, never from "the stock went down" with no stated stop; (4) the seven non-public UCT detector ids get a `gen_detections.py` allowlist; (5) Phase 0 measures `modelbook_setup_examples` per setup on the server before promising it as a source.

### 13.5 Pedagogy corrections

| # | Finding | Change | ⚑ |
|---|---|---|---|
| P1 | "No spacing" contradicts the dossier's own standard (mastery is perishable; anti-pattern "cover it, quiz it, forget it"). Weighting toward past misses is massed, not spaced. | Keep the owner's random mix, but **reserve 3 of the 10 daily slots for a due queue** (items answered correctly 3, 10, 30 days ago); a stale skill's items count as due; every module checkpoint draws 30% from earlier modules. Add `due_at` to `study_attempts`. | ⚑ |
| P2 | "Questions only + intro video" skips guided practice (dossier §3: worked example → practice rep → feedback → graded check; "jumping content-to-quiz is the most common structural failure"). | **Learn-1 of every unit is 2-3 shown-answer items**: the mentor walks the chart and the member taps "next", unscored. Learn-2 onward is scored. Still no reading pages. | ⚑ |
| P3 | With no gates, Prove-3 is reachable before Learn-1 and mastery is miscalibrated. | Rung order is the default path; "Test out" is the only skip; mastery counts rung-appropriate difficulty; selection samples within the member's current rung unless they opted up. | |
| P4 | The 100% sizing-gate bar cannot be a mastery band. | The Size module badge requires a 10/10 checkpoint set, separate from the ≥80 band. | |
| P5 | Self-paced completion is 3-48% vs 60-95% with a cadence (dossier anti-pattern 15). | **"This week's set"**: a named weekly batch with a Sunday close, aligned with the weekly leaderboard freeze; "recommended next" visible on the trail. | |
| P6 | "Late-course interleaving" has no meaning without gates. | Interleave by mastery band: Practised and above get mixed sets. | |
| P7 | The rep-counted format (replay) is Phase 2, so the 20/40-rep badges mean nothing at launch. | Pull a bar-stepped replay for the **two flagship setups** into Phase 1. | |
| P8 | Register shift (dossier rule 15). | Prove-3 of "Grade the setup" hides the rubric rows and scores the grade alone. | |

### 13.6 Review load (the number nobody wrote down)

At 7,500 items reviewed one by one with the source and key on one screen: Foundations 2,500 ≈ 40-45 h; Method 5,000 ≈ 130-135 h; **pure review ≈ 175 h**. The last audit corrected 76% of model-written examples; if 30% of items need a fix at 2-5 min, add 75-180 h. **Realistic owner commitment: 250-350 hours** (6-9 weeks full time, or 6-9 months at 10 h/week). Phase 1 alone (≥3,200 approved) is 90-130 h. ⚑ The launch target is therefore a **schedule**, not a count.

What makes review fast without lowering accuracy (`StudyReview` is specified as this card, not "copied from GoldReview"): the chart with ticker and dates revealed and a marker for what the member will not see · the question and choices with the key highlighted · a provenance line with the verbatim source quote or the detector's geometry numbers · the forward strip with the outcome rule and window printed · the lesson text · two automatic checks already run (every number in the reveal is in the facts; near-duplicate score) · three keys **A** approve / **F** fix inline / **R** reject with one-tap reason chips (wrong label · bad chart · wrong number · voice · duplicate · split/adjustment · hindsight-obvious). Every reject reason becomes a generator filter the next night. Sessions capped at ≈150 items so corrections feed the next batch. ⚑ Optional **review lanes**: deterministic items (sizing arithmetic, verbatim glossary keys) auto-approved with a 10% sample; agreeing-signal items in a fast lane; disagreeing-signal items in a second-look lane first.

### 13.7 Product design corrections (from the UX review)

| # | Change |
|---|---|
| D1 | **One navigation axis: tracks → units**, for both curricula (the six stations become six tracks plus Calls; "station" survives as the unit's eyebrow). The UI never shows a skill tree; `skill_id` stays the data key. |
| D2 | **The two existing course cards are the two curriculum doors** (Foundations, Method): name, blurb, a 3 px gold bar of units mastered, meta "12 tracks · 110 units · 4 recorded lessons". Tapping opens that curriculum's trail as a **sub-view** (the existing `?path=` pattern). No extra cards; the flat `CurriculumLessons` list is retired from the page. |
| D3 | **First screen at 390 px** (≈560 px above the fold): "Courses" title · the Study panel (eyebrow STUDY + streak chip with seven week-dots · "Today's Study" + "10 questions · about 4 min" · **one gold button** Start / Continue / Practise · "Up next on the trail: …" row with a 24 px nine-rung ring · XP bar + "12th this week") · the Foundations card fully visible · the Method card just under the fold. Desktop: panel in a 340 px sticky column, cards and trail right. |
| D4 | **Trail sub-view:** vertical path, one curriculum per view, tracks as collapsed sections (PathView's seam register), only the current track open on arrival, auto-scroll to the recommended node which alone pulses gold; a sticky 44 px bar with the track name and a "Jump to" bottom sheet listing the tracks with a progress pill each. Nodes: 56 px circles, nine-rung ring, title under. Tapping a node opens a **bottom sheet** with the 3×3 rung grid, "Replay intro", one gold "Start rung N" and a ghost "Test out" (test-out lives here, never on the trail). Deep links `?section=courses&study=today|map|unit&unit=<id>&session=<id>`. |
| D5 | **The drill is a fullscreen `Sheet`** (MobileNav and Desk tabs leave the screen; focus trap and Escape come free). Closing mid-session asks once ("Leave? Your answers so far are saved."). |
| D6 | **Question screen at 390×844:** top bar 44 px (close · 10-segment progress strip · combo chip hidden until ×2) · question 16px/600, max 2 lines (importer caps at ~140 chars) · chart full width 390×240, price pane only, volume and MAs off unless the item is about them · choices as 2-4 full-width 52 px rows (≤40 chars) or a 2×2 grid when all ≤12 chars · a sticky bar with **one morphing button** Check → Continue. Time targets: recall 10 s · spot 18 s · regime 15 s · call 15 s · tap 12 s · size 30 s · scenario 20 s; reveal 6-8 s; a 10-item set ≈ 4 m 25 s. `POST /attempts` must answer in <300 ms. |
| D7 | **While a chart loads:** question text immediately + a chart-box skeleton; after 2 s "Still loading the chart"; after 6 s a ghost "Skip this one" that moves the item to the end, so a dead fetch never blocks the streak. |
| D8 | **Fill-in on a phone:** term fill-ins use a 4-6 chip word bank, never the keyboard; numeric fill-ins keep a real input (`inputmode="decimal"`, 16 px, prefix-wrapped), with a `visualViewport` guard so the Check button is never under the iOS keyboard. |
| D9 | **The reveal is a bottom panel**, not a modal: verdict line (gold `check` + "Correct" / muted `x` + "Not quite"; **never green/red**, which mean price direction to a trader) · ticker and dates · the one-line lesson · a "Why" disclosure (provenance, what happened next, "Read the lesson") · Continue. For chart items **the forward bars print in the same chart** (Study's signature moment). |
| D10 | **Tap the chart on touch** borrows the overlay's tap-tap model: dot + halo at the anchor, HUD chip bottom-centre ("Tap the pivot" → "Tap Check, or tap again to move"), one tap places, a second moves, never a drag; the accepted region is a dashed ring on reveal. |
| D11 | **Sound and haptics:** `haptics.tap()` on anchor placement, `success()`/`warn()` on the reveal only, nothing on choosing; Web Audio tones (`playDing` correct, a two-note descending tone wrong, `playTriplePop` at ×5/×10, `playChime` on the end card). Defaults: haptics on, sound **off** on iOS first run, on on desktop; one toggle. |
| D12 | **End card:** ring filling to n/10 (400 ms) · "8 of 10" · XP with up to two bonus rows · the week's seven dots · a badge if earned (36 px gold circle) · one gold "Done" · ghost "Keep practising". Nothing more. |
| D13 | **"Practise" opens a sheet with three rows:** "Review my misses (14)" · "Refresh a stale skill (3 need it)" · "Keep going on the trail". Review-my-misses is the single most valuable surface for adults and was hidden in the weighting. Practice XP capped per day (≈150) so the board is not a grind contest. |
| D14 | **Keep:** streak with one free day a week (copy: "a free day each week", never "streak freeze"; day = ET), XP against a silent default goal of 50 (the goal chooser lives in Settings only), 3×3 levels with one test-out attempt per unit per day, one weekly board "This week at the Desk" (top 10 + you, display names, one-tap "Hide me" on the board), combos, end card, trail. **Skip:** hearts, leagues and promotion/demotion, daily quests, monthly badges and collections, avatars, friend streaks, a second "legendary" tier, confetti, rank titles, mascots inside drills. **Reminder copy:** "Today's Study is ready — 10 questions, about 4 minutes." and nothing else, ever. |
| D15 | **Intros play as item 0 of a unit's first session only**, as a cover card inside the drill sheet (poster, 64 px play, title, one line, "Skip" from frame one); autoplay muted with captions and a "Tap for sound" pill; never in the daily set; replay from the node sheet; **captions are part of per-video acceptance**. Units without a video get the same card with the unit's idealized glyph and one "Start" button; never "coming soon". A docked Desk video is paused and hidden while the drill is open. |
| D16 | **First run:** land on Courses → zero-state panel → "Start today's Study" → question 1 within two seconds; the newcomer set is six rung-1 Foundations items, one regime call, one easy spot, one sizing, one scenario. The placement offer appears once on the end card of session 1; the reminder offer once on the end card of session 2 (7:00 AM ET default, browser permission asked only inside that tap, Home-Screen note on iPhone). No onboarding carousel. |
| D17 | **Design-system decisions where it is silent:** a nine-segment progress ring (24/40/56 px, 2 px stroke, gold fill, segments grouped 3-3-3); a dashed SVG trail path brightening between completed nodes with a 400 ms reveal; the compass mark gliding one segment on unit completion (the brand's own motion signature from the intro animation) as the "you are here" marker; celebration budget = ring 400 ms + combo chip 150 ms + badge toast 1.5 s and nothing else; selected choice = ghost + gold border + check glyph; type from the existing scale; no emoji anywhere. A Study toast host outlives the control that fires it. |
| D18 | **Accessibility and edge cases:** choices as a radiogroup with keys 1-4 and arrows, Enter = Check/Continue, Escape owned by the Sheet; a keyboard bar-cursor for chart-tap (Left/Right move one bar, a live region reads the bar, Enter places); text framing for every chart item; `aria-live` for verdicts; never colour alone. **Offline:** the whole daily set is on the device from `/today`; answers go to a ten-row localStorage outbox the instant Check is tapped and replay on `online`; reveals arrive on reconnect or on the end card. **Resume:** `session=<id>` in the URL, `/today` returns `answered_item_ids`, the panel reads "Continue · 6 left"; a set abandoned past midnight ET is retired without penalty beyond the streak rule. `time_ms` is analytics only. |

### 13.8 Owner decisions raised by the sweep (⚑)

1. **Worked examples (P2):** allow 2-3 shown-answer items at the start of every unit (unscored, the mentor walks it), inside the "questions only" rule?
2. **Due slots (P1):** reserve 3 of the 10 daily questions for items coming back from 3, 10 and 30 days ago, inside the "random mix" rule?
3. **Review lanes and schedule (13.6):** review every item one by one as decided (≈250-350 hours), or auto-approve deterministic items with a 10% sample and put your hours on charts and judgment?
4. **Intraday setups (C3):** keep ORB, 30-Minute Pivot and Go Signal in the 26 with an Intraday skill (thin data), or move them out of the count?
5. **VCP and High Tight Flag (C12):** where do they map in the 26 (Flat Base Breakout? their own names?).
6. **Options depth (C13):** F6 to defined-risk substitutes only, with flow and dealer positioning kept for the Method Overlay as the dossier orders it, or full depth in Foundations as decided earlier?
7. **Scans scoring (C17):** accept the fair-scoring rule (base rate, Monday open, trigger-and-stop, "watch")?
8. **House words (voice):** allow "dial, band, heat, the tape" in questions after an F1 unit "How we talk at the desk" teaches them in the first hour (the reviewers found the firm's own voice *is* that shorthand)?

### 13.9 Owner answers to §13.8 (2026-10-17, in chat)

| # | Decision |
|---|---|
| 1 | **Walk-throughs: yes.** Every unit opens with 2-3 unscored shown-answer items; still no reading pages. |
| 2 | **Due slots: yes.** 3 of the 10 daily questions are items coming back from 3, 10 and 30 days ago or from a skill that needs a refresh; the other 7 stay a random mix weighted to weak skills. |
| 3 | **Review: graduated trust per item type.** The owner reviews every item of a type until he has seen **20-30 clean examples** of it; the review screen then asks whether to switch that type to auto-approve with a random sample. A new generator, source or template resets the count for that type. `review_lane` and a per-type `trust_state` (manual / sampled) live in the store. |
| 4 | **Scans scoring: the fair-scoring rule** (C17) is adopted. |
| 5 | **Intraday setups stay** in the catalog with an Intraday skill and a hand-labelling queue. The owner may add a few more setups later ("maybe not needed"). |
| 6 | **VCP and High Tight Flag are added as their own setups → the catalog is 28.** `setupCatalog.js` header and the five-field card are corrected in Phase 0; `skill_map.json` aliases the other vocabularies to the 28. |
| 7 | **Options: full depth in Foundations**, overriding C13. F6 covers everything someone wanting to know options needs: calls, puts, premium, intrinsic vs time value, the Greeks, IV and expected move, **strike and expiry selection**, **directional trades** (long calls/puts, debit and credit verticals, covered calls and the rest of the Journal's 18 strategy types), assignment and exercise, then flow and dealer positioning. The dossier's capstone ordering is kept only as the trail's recommended order (the advanced units sit at the end of F6). |
| 8 | **Voice: the owner's own prose is the source.** The voice guide is **derived from the firm's existing writing and speech**, not invented: the 320 Desk transcripts (`edu_videos.transcript`), the toolkit cards, the Substack issues in `desk.db`, the morning-wire owner-voice exemplars (`morning-wire/data/voice/voice_exemplars.json`, `owner_voice.py`), the methodology bible and the playbooks. House words are allowed once taught; the "How we talk at the desk" unit is F1's first unit. `VOICE.md` quotes real sentences from that corpus as its do-examples. |

---

## 12. Appendix — file map for the build sessions

**Read first:** `docs/curriculum/curriculum_dossier.md` §3, `docs/curriculum/HANDOFF.md`, this spec, `docs/study/skill_map.json` (to be created in Phase 0).

**Backend to create:** `api/services/study_store.py`, `study_scoring.py`, `study_mastery.py`, `study_select.py`, `study_templates.py`, `study_import.py` (sha check, number-grounding check), `api/routers/study.py`, `scripts/study/gen_*.py`, `docs/study/{skill_map.json, sizing_grid.json, bank/, corrections/}`.

**Backend to touch (additive):** `api/main.py` (init + 4 jobs + router), `api/routers/auth.py::_access_payload` (flags), `docs/feature_flags.json`.

**Frontend to create:** `app/src/pages/study/**` (§7.2), `app/src/pages/admin/StudyReview.jsx`.

**Frontend to touch (additive):** `app/src/pages/desk/CoursesSection.jsx` (Study panel + map), `CoursesSection.test.jsx`, `PathView.jsx` ("Study this"), `journal-2-0/components/notebook/BarReplay.jsx` (`bars` prop), `AuthContext.jsx` (flags), Settings (Study row: reminder, leaderboard opt-out, journal opt-in), admin nav (Study Review).

**Existing primitives reused, unchanged:** `StockChart` (`barsOverride`, `annotations*`, `hideWatermark`), `BarReplay`, `pattern_engine.detect_all`, `bars_sqlite.get_bars_before`, `web_push.dispatch`, `alerts.add_alert`, `GoldReview.jsx` (pattern), `education_service` paths/lessons (for links).

**Counts worth re-measuring before each phase:** fixtures (163), gold standard (82), scripted examples with verdicts (181), rubric setups (14), public pattern ids (89 in metadata / 96 detectors / 7 internal), Desk videos with transcripts (319/320), Sunday Scans images (2,953), breadth sessions (≈4,530), pattern rows (1.54 M on 2026-08-26).
