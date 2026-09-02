---
id: D-13
title: Proprietary content and intelligence inventory (raw)
role: Proprietary content and intelligence inventory specialist
wave: 1
group: D
category: internal-system
scope: uct-dashboard (terminal-research worktree), uct-intelligence engine, morning-wire, uct_intelligence Discord bot, uct-sunday-scan
confidence: 🟡 medium-high on what exists and where; 🔴 on production volumes and consumption rates
evidence_ceiling: Every production SQLite DB lives on the Railway `/data` volume and is unreachable from this machine; the local `C:\data` mirror is contract-forbidden. All row counts below come from the LOCAL engine KB copy and from files checked into repositories. Nothing was measured on a running service.
sources: C:\Users\Patrick\uct-intelligence\data\uct_intelligence.db, C:\Users\Patrick\uct-intelligence\uct_intelligence\, C:\Users\Patrick\morning-wire\, C:\Users\Patrick\uct_intelligence\data\, C:\Users\Patrick\uct-sunday-scan\, terminal-research worktree api/services + docs/curriculum + docs/base_lift_ledger.json + themes_taxonomy.json
uct_relevance: high
status: draft
date: 2026-09-02
---

# Proprietary content and intelligence inventory — raw

This is the discovery pass that feeds the canonical `proprietary-advantage-inventory.md`
(gate item 11). It answers "what does UCT already own that a competitor cannot buy",
with the location, the measured volume, the permission tier, and how each asset is
consumed today. Everything here was measured on this machine unless labelled NOT
DETERMINED.

Structural repo mapping is D-14's; AI-lane internals are D-12's; the provider inventory
is D-03's. Where a structural fact was needed here it is cited to the file, not restated
as architecture. For repository structure, cite D-14's forthcoming file at
`docs/terminal-research/01-existing-system/` rather than this document.

---

## 0. METHOD AND THE EVIDENCE CEILING

### OBSERVATION
Five repositories were inspected read-only. Exactly ONE production-shaped database is
readable from this machine: the engine knowledge base at
`C:\Users\Patrick\uct-intelligence\data\uct_intelligence.db` (82,718,720 bytes,
2026-09-01 20:33). Every dashboard-owned store — 45 distinct SQLite files — resolves to
`/data/*.db` on the Railway volume.

### EVIDENCE
- `find` over the four non-dashboard repos returns three `.db` files:
  `uct-intelligence/data/uct_intelligence.db` (79 MB), `uct-intelligence/data/x_accounts.db`
  (12 KB), `uct-intelligence/uct_intelligence.db` (**0 bytes** — an empty stub at the repo
  root, not the KB; the KB is the one under `data/`).
- Dashboard DB literals, measured by `grep -rhno '"/data/[a-z_0-9]*\.db"' api/`:
  `auth.db` (14 refs), `flow.db` (31 refs), `catalysts.db`, `cot.db`, `community.db`,
  `buzz.db`, `desk.db`, `desk_announce.db`, `desk_session_jobs.db`, `education.db`,
  `modelbook.db`, `screener.db`, `screener_analyst.db`, `screener_insider.db`,
  `signal_ledger.db`, `notable_alerts.db`, `oi_snapshots.db`, `flow_explain.db`,
  `pattern_vision.db`, `research_ratings.db`, `industry_map.db`,
  `fundamentals_tables.db`, `fundamentals_estimates.db`, `breadth_monitor.db`,
  `breadth_intraday.db`, `breadth_daily_ohlc.db`, `breadth_dividends.db`,
  `breadth_sentiment_history.db`, `calendar_dates.db`, `charts_layouts.db`,
  `catalyst_metadata.db`, `discord_chart_prefs.db`, `earnings_wire.db`,
  `news_catalysts.db`, `single_stock_etfs.db`, `stock_brief.db`, `tweets.db`,
  `user_definitions.db`, `wire_feedback.db`, `ai_search_log.db`, `alert_shadow.db`,
  plus `bars.db` and the AI-search memory DB reached through `DATA_DIR` helpers.
- CONFIRMED that these are unreachable: the paths are Linux-absolute and this is a
  Windows box; the contract forbids the local `C:\data` mirror and any production probe.

### INTERPRETATION
The inventory below is therefore *complete on definition and schema* and *incomplete on
volume* for everything the dashboard owns. Where a table's row count matters commercially
(Desk video library, Buzz mention history, flow records, member notebooks), I state the
schema and the retention rule and mark the count NOT DETERMINED.

### RELEVANCE TO UCT
Terminal-Next planning that depends on "how much do we have" for any dashboard-owned
store needs one read-only production probe. That is a five-minute job for whoever holds
the Railway session and it unblocks the sizing of at least six asset classes.

### CONFIDENCE
🟢 on the reachability claim. **EVIDENCE CEILING:** production volumes. A single
`railway ssh` `SELECT COUNT(*)` sweep over `/data/*.db` would raise every 🔴 below to 🟢.

### RECOMMENDATION
Before the synthesis file is written, run one bounded read-only count sweep on the web
pod and paste the numbers into the canonical inventory. Nothing else in this report
needs production access.

### OPEN QUESTION
Is there an existing admin endpoint that already reports per-DB row counts (the pattern
exists for `/api/admin/reconciliation-status` and `/api/admin/fundamentals-health`)?

---

## 1. THE ENGINE KNOWLEDGE BASE — the single largest readable asset

### OBSERVATION
`uct-intelligence/data/uct_intelligence.db` holds 31 real tables. Measured row counts
(read-only `SELECT COUNT(*)`, 2026-09-02):

| Table | Rows | Span (measured) | What it is |
|---|---:|---|---|
| `knowledge_base` | **9,605** | created 2026-02-21 → 2026-09-02 | The trading KB. All 9,605 rows `active=1`. |
| `earnings_analytics` | 40,731 | report_date 2026-02-12 → 2026-11-30, 25,449 distinct symbols | EPS/rev actual+estimate+surprise, guidance flag, BMO/AMC |
| `news_archive` | 22,562 | — | symbol, title, content, source, sentiment, url |
| `wire_universe` | **19,050** | across 43 issues | (issue × ticker) with `feature_vector`, `dropped_at_stage`, `drop_reason` |
| `ep_follow_throughs` | 10,808 | — | Episodic-pivot follow-through outcomes |
| `ticker_metadata` | 5,969 | — | symbol reference |
| `leadership_snapshots` | **4,440** | 2026-02-19 → 2026-09-01, 134 dates, 1,038 symbols | Rank, setup_type, **thesis**, score, confidence_tier, regime_fit |
| `economic_events` | 2,092 | — | econ calendar |
| `earnings` | 1,601 | — | |
| `analyst_consensus` | 1,233 | — | |
| `analysis_log` | 621 | — | |
| `coaching_notes` | 527 | 2026-03-30 → 2026-09-01, all `note_type='pattern'` | AI self-review of the desk's own behaviour |
| `ep_candidates` | 447 | 2026-02-20 → 2026-09-01 | |
| `book_plans` | 420 | 2026-07-30 → 2026-09-01, 21 sessions | The published plan per session/symbol |
| `setup_triggers` | **243** | 2026-07-30 → 2026-09-01 | Published entry+stop with **resolved outcome** |
| `peg_list` | 182 | — | |
| `market_regimes` | 148 | 2026-02-20 → 2026-09-01 | phase, trend_score, dist days, exposure_pct, breadth, VIX |
| `market_breadth` | 125 | — | |
| `setup_templates` | **48** | — | The firm's setup grammar, with `origin_trader` |
| `wire_issues` | 43 | 2026-04-28 → 2026-09-01 | One row per published brief |
| `trigger_performance` | 33 | — | Per-setup expectancy in R |
| `book_ledgers` | 26 | — | Immutable Book ledgers (variant + control arms) |
| `wire_prompt_config` | 26 | — | Versioned learned prompt guidance |
| `setup_performance` | 21 | — | Per-setup × regime win-rate/expectancy |
| `model_examples` | 18 | — | Annotated model charts |
| `analyst_changes` | 1 | — | |
| `confidence_scores`, `psychology_events`, `skill_assessments`, `trade_journal`, `x_news_posts` | **0** | — | Declared, never populated |

`knowledge_base` composition (measured):

- **By category:** RULE 2,481 · SETUP 1,499 · CASE_STUDY 921 · PSYCHOLOGY 688 ·
  MACRO 670 · FRAMEWORK 567 · SECTOR 494 · EXECUTION 490 · SCREENING 326 · REGIME 301 ·
  SIZING 227 · JOURNAL 187 · DEFINITION 182 · TOOLS 142 · MOMENTUM 138 · SHORTING 102 ·
  EARNINGS 50 · BIOGRAPHY 49 · OPTIONS 25 · BOOK 24 · INSTITUTIONAL 19 · IPO 16 ·
  INTERVIEW 3 · TEST 3 · INSIGHT 1.
- **By source:** the single largest is `intake:substack_unchartedterritory_sunday_scans_2026-02-21`
  at **4,399 rows** — the firm's own published newsletter. Then `self_review` 1,423,
  `intake:discord_tsdr` **591**, `intake:substack_jeffsun_2026-02-21` 407, ~30 curated
  topic files (`01_methodology_bible` 166, `02_trade_log_vault` 137,
  `10_setup_failure_modes` 131, `17_sector_rotation_framework` 121, …), and **12
  Qullamaggie YouTube transcript intakes** (114 + 114 + 100 + 83 + 76 + 61 + 56 + 41 +
  38 + 37 + 31 …).
- **By attributed trader:** Bracco 2,122 · TSDR 1,856 · (blank) 1,414 · "UCT Brain" 1,411 ·
  Qullamaggie 876 · Bonde 504 · Jeff Sun 396 · Uncharted Territory 109 · Minervini 83 ·
  O'Neil 68 + William O'Neil 62 · Oliver Kell 63 · Martin Luk 62 + Luk 19 · Brandt 52 ·
  Morales 51 · Stamatoudis 50 · TSDR Trading 42 · Desjardins 28 · Darvas 27 ·
  Mark Minervini 26 · Richard Moglen 21 · David Ryan 19 · Leif Soreide 16 · Paul J Singh 15.
- **By epoch:** `2026` 7,238 · `2024` 2,367.

### EVIDENCE
Read-only `sqlite3`/`python` `SELECT COUNT(*)` and `GROUP BY` against
`file:uct_intelligence.db?mode=ro`. Schemas from `sqlite_master`. CONFIRMED by direct
measurement, 2026-09-02.

### INTERPRETATION
Summing the rows attributed to the firm's own people — Bracco 2,122 + TSDR 1,856 +
"UCT Brain" 1,411 + Uncharted Territory 109 + TSDR Trading 42 = **5,540 of 9,605 (57.7%)**
— the KB is *majority first-party*. That is the opposite of what a "we ingested trading
books" KB looks like, and it is the fact that makes this asset defensible: 4,399 rows are
the firm's own published Sunday Scans and 591 are its own Discord room. The
third-party half (Qullamaggie transcripts, Minervini/O'Neil/Brandt/Wyckoff frameworks) is
re-organized public material and is NOT defensible on its own.

Five declared tables are empty (`trade_journal`, `psychology_events`, `skill_assessments`,
`confidence_scores`, `x_news_posts`). Those are *designed* surfaces with no data — a
product decision waiting, not a leftover.

### RELEVANCE TO UCT
This DB is what the Compass Brain Pack ships to Railway
(`uct-intelligence/scripts/brain_pack_export.py` → R2 `brain/latest.txt` +
`brain/<ts>.tar.gz`, installed at `<DATA_DIR>/brain`). Any Terminal-Next feature that
wants "ask the house brain" is already fed by this file. It is also the only asset in this
report whose depth (9,605 curated rows, 57.7% first-party) can be stated with a measured
number today.

### CONFIDENCE
🟢 on counts and composition (direct measurement). 🟡 on the "57.7% first-party" reading —
1,414 rows carry a blank `trader` and could belong to either half.

### RECOMMENDATION
Treat the first-party slice as the moat and the third-party slice as commodity. If
Terminal-Next surfaces KB passages to members, the provenance field
(`source`, `trader`, `source_ref`) is already there — show it, because "Bracco, Sunday
Scans 2026-06-08" is worth more than an unattributed rule.

### OPEN QUESTION
`knowledge_epoch` splits 7,238 / 2,367 between `2026` and `2024`. Is the `2024` slice
deliberately retained as historical context, or is it stale material that should be
down-weighted in retrieval?

---

## 2. MORNING WIRE — archive, scores, critic, voice

### OBSERVATION
The wire is the paywalled member item and it leaves four separate durable trails.

**a) The daily payload archive.** `morning-wire/data/snapshots/wire_YYYY-MM-DD.json` —
**28 files, 2026-07-21 → 2026-09-01**, 246 KB–460 KB each. Each is the complete
`wire_data` push payload. Measured structure of the live one
(`morning-wire/data/wire_data.json`, 359,964 B): **31 top-level keys** — `date`,
`quote_of_the_day`, `rundown_html` (35,211 chars), `leadership` (20), `leadership_meta`,
`themes` (112), `earnings`, `movers`, `breadth` (14 fields), `exposure` (11 fields),
`ma_data`, `candidates` (11), `taxonomy_version`, `uct20_portfolio` (21),
`uct20_book` (15), `uct20_backtest` (11), `cap_universe` (3,721 symbols),
`analyst_actions` (130), `weekly_calendar`, `options_flow`, `game_plan` (12),
`index_levels`, `rotation`, `discipline` (7), `trade_idea` (10), `rs_leaders`,
`risk_calendar`, `watch_list`, `contract_warnings`, `sourced_symbols` (301).

**b) The sent letters.** `morning-wire/data/sent/letter_YYYY-MM-DD.html` — **10 files,
2026-08-19 → 2026-09-01**, 14–21 KB each. Shallower than the snapshots.

**c) The deeper index, in the KB.** `wire_issues` — 43 issues, **2026-04-28 → 2026-09-01**,
each with `regime_classification`, `regime_snapshot` JSON, `source_counts`, SPY/QQQ/VIX
opens, `todays_story`, `prompt_config_version`. Joined to `wire_universe` (19,050 rows) it
records not just what was published but **what was considered and why it was dropped**
(`dropped_at_stage` 1=universe / 2=gate / 3=lens, plus `drop_reason` and a
`feature_vector` snapshot).

**d) Segments.** `morning-wire/morning_wire_engine.py:5907 _SEG_LABELS` — the ONE
registry: `overall`, `tape` (THE TAPE), `macro` (WHAT'S DRIVING IT), `board` (THE BOARD),
`earn` (THE EARNINGS DESK), `analyst` (THE ANALYST DESK), `movers` (WHAT'S MOVING),
`setups` (THE SETUPS), `close` (THE CLOSE), `flow` (THE OPTIONS DESK). The per-segment
spec is `morning_wire_engine.py:8437ff`.

**e) The critic loop.** `morning-wire/wire_critic.py` pulls the owner's per-segment
👍/👎 and notes from `GET /api/wire-feedback/recent-internal` (PUSH_SECRET-bearer,
`api/routers/wire_feedback.py`, store `/data/wire_feedback.db`), runs an Opus critic per
qualifying segment, and writes distilled guidance + up to 3 few-shot exemplars into the
KB's `wire_prompt_config` — **26 versions recorded**. `generate_rundown` reads it back.

**f) The measured owner voice.** `morning-wire/data/voice/voice_profile.json` —
24 metrics mined offline from the published Substack archive: `posts_total` 88
(27 articles + 61 Sunday Scans), `tsdr_words` **120,055**, `tsdr_sentences` 9,016,
`tsdr_paragraphs` 2,665, `sentence_words_mean` 13.3 / `p50` 12.0,
`em_dash_per_1000` 0.23 with `em_dash_cap_per_1000` **1.0**, `allcaps_word_rate` 0.0282,
`first_person_per_1000` 26.8, plus `signature_phrases` (top: "sunday scans" 68/44 posts,
"right now" 76/43, "last week" 87/41, "higher low" 88/40, "inside day" 69/38) and
`style_rules`. Beside it, `voice_exemplars.json` — **120 verbatim exemplars** retrieved by
tape (strong/chop/defensive) × section. Runtime door: `morning-wire/owner_voice.py`.

**g) Other state trails:** `board_history.json` (28 entries), `title_history.json` (27),
`cover_history.json` (27), `wire_journal.json` (15), `open_book.json`,
`leadership_ab_log.json` (12), `flow_ledger.jsonl` (41,789 B),
`morning_wire_state.json` + 4 dated `.bak` restore points.

### EVIDENCE
Directory listings and `json.load` measurements of the files named above, 2026-09-02.
CONFIRMED (files on disk with dates). The critic's round trip is a CLAIM at the code level
(`wire_critic.py` + `wire_prompt_config` has 26 rows, which is consistent with it running,
but I did not observe a run).

### INTERPRETATION
The wire's proprietary content is not the HTML — it is (1) the 43-issue decision index
with 19,050 considered-and-dropped rows, and (2) the closed feedback loop that turns owner
taste into a versioned prompt config. A competitor can copy a newsletter. Nobody can copy
"here are the 19,050 names we looked at, the features they had, and the stage each one
died at."

The archive depth is uneven and that matters: the KB index reaches 2026-04-28 (43 issues)
while the on-disk payload snapshots only reach 2026-07-21 (28 files) and the sent HTML only
2026-08-19 (10 files). **The richest artifact has the shallowest history.**

### RELEVANCE TO UCT
Terminal-Next's "show me what the desk said about SYM on date X" depends on the snapshot
archive, which is 6 weeks deep. If that surface is planned, the archive needs a retention
decision NOW, before more days age out.

### CONFIDENCE
🟢 on file counts and structure. 🟡 on whether the snapshot directory is pruned or simply
started on 2026-07-21. **EVIDENCE CEILING:** the production `/data/wire_data.json` and
`wire_feedback.db` were not read.

### RECOMMENDATION
Decide whether `data/snapshots/` is an archive or a scratch buffer. If it is the archive,
back it up off this machine — it is the only place the full daily payload exists in a
form a future feature can replay.

### OPEN QUESTION
Are the wire snapshots pruned on a schedule, and is there an older archive (S3/R2) that
matches `wire_issues`' 2026-04-28 start?

---

## 3. UCT20 HARNESS AND THE BOOK — the measured track record

### OBSERVATION
Two authorities and one measured configuration.

- `uct-intelligence/uct_intelligence/api.py:784` — `UCT20_INCEPTION = "2026-08-27"`.
- `uct-intelligence/uct_intelligence/book/config.py` — `BOOK_RECORD_START = "2026-08-27"`,
  with the owner's 2026-08-27 note in-file explaining why the 2026-07-30→08-26 stretch is
  excluded (it mixed a 5% swing-stop ceiling with a per-ticker stale `bars.db`).
- `BOOK_DEFAULTS` (same file) is **the measured arm**, and it is the firm's risk doctrine
  as data: `size_basis="current_equity"`, `candidate_life=5`, `heat_budget_pct=5.0`,
  `max_position_pct=20.0`, `max_stop_pct=4.0`, `gap_guard_pct=2.0`,
  `breakeven_at_r=1.0`, `trail_atr_mult=3.0`, `target_slots=20` (**a risk DIVISOR, not a
  slot count** — stated in-file), `min_position_pct=2.0`, `regime_scalar=1.0`,
  `commission_bps=1.0`, `slippage_bps=4.0`, `BOOK_ACCOUNT_SIZE=50000.0`.
- `uct_intelligence/book/book.py` — "the only object in production that computes UCT20
  P&L", owns no trading rule, delegates every fill/stop/ratchet/size to
  `harness/rules.py` via `harness/replay.py`, and returns **both arms** (stopped ledger +
  no-stops control) from one pass. `ControlArmMissing` makes a control-less run an error.
- `uct_intelligence/book/wire.py` — the Book records the List and the Plan and derives
  neither; rank comes from the published leadership payload, levels from the trigger
  ledger reconciled through `wire_levels.canonical_levels`.
- KB tables: `book_plans` 420 rows / 21 sessions (2026-07-30 → 2026-09-01),
  `book_ledgers` 26 immutable ledgers keyed `(input_hash, config_hash, arm, revision)`
  with `trades_json`, `open_positions_json`, `equity_curve_json`, `stats_json`.

**Resolved outcomes exist and are honest.** `setup_triggers` (243 rows, 2026-07-30 →
2026-09-01) resolves to: **win 47 · loss 81 · never_triggered 57 · open 57 ·
unresolved 1**. `trigger_performance` aggregates it per setup — e.g. Tight Flag n=50,
18 wins / 32 losses, win rate 36.0%, expectancy **+0.08R**; 20EMA Hold n=12, 25.0%,
**−0.25R**; EP n=16, 31.25%, **−0.0625R**; HTF n=4, 0%, **−1.0R**.
`setup_performance` carries a longer sample by regime phase — EP in "Uptrend" n=106,
34.9% win rate, expectancy **−2.6**; EP in "Rally Attempt" n=86, 45.3%, **+3.08**.

### EVIDENCE
Direct reads of `book/config.py`, `book/book.py`, `book/wire.py`, `harness/rules.py`,
`api.py:784`, plus read-only KB queries. CONFIRMED by measurement.

### INTERPRETATION
This is the rarest asset in the whole inventory: **a track record with the losses in it.**
The Book publishes a stopped arm beside a no-stops control by construction, and the
trigger ledger publishes a 47-win / 81-loss record with negative expectancies on named
house setups. Almost nothing in retail fintech does this. It is also commercially
double-edged — a public scoreboard showing 20EMA Hold at −0.25R is a trust asset and a
marketing liability at the same time.

Note the sample is **young**: the published record starts 2026-08-27, and the trigger
ledger's whole span is five weeks.

### RELEVANCE TO UCT
The `flow_scoreboard.py` honesty rules (§7) and this Book are the same doctrine expressed
twice. If Terminal-Next has a "our record" surface, these two are the substrate and their
rules should be lifted verbatim rather than re-invented.

### CONFIDENCE
🟢 on the constants and the row counts. 🟡 on whether the published product currently
SHOWS the negative expectancies (that is a frontend question I did not chase).

### RECOMMENDATION
Ship the record with n beside every number. At n=4 (HTF) a −1.0R expectancy is noise, and
publishing it unqualified would be the same defect the base-lift ledger's gates exist to
prevent (§5).

### OPEN QUESTION
`book_ledgers` holds 26 rows across variant + control arms — how many are the LIVE
published record versus A/B experiments, and is the published one addressable by a stable
key?

---

## 4. SETUP GRAMMAR, MODEL BOOK, AND THE PATTERN ENGINE

### OBSERVATION
The firm's setup vocabulary exists in **four** places with four different populations.
This is worth stating plainly because a synthesis document that quotes one number will be
wrong.

| Artifact | Population | Measured how |
|---|---:|---|
| `uct_intelligence.db :: setup_templates` | **48** | `SELECT COUNT(*)` |
| `app/src/constants/setupGroups.js :: SETUP_GROUPS` | **32** (26 Swing + 6 Intraday) | regex over the file |
| `app/src/pages/modelbook/setupCatalog.js` | **26** across 5 families | `name:` count |
| `app/src/pages/modelbook/setupPlaybooks.js` | **9** authored playbooks | top-level key count |
| `api/services/pattern_engine/detectors/uct/` | **24** detector modules | file count |

`setup_templates` families: Classical Pattern 10 · Momentum Continuation 10 ·
Base Breakout 9 · Remount & Recovery 8 · Gap & Catalyst 6 · Short Setup 5. Each row
carries `origin_trader`, `aliases`, `ideal_regime`, `sector_conditions`, `liquidity_min`,
`float_requirements`, `catalyst_types`, `trend_requirements`, `ma_alignment`,
`rs_requirements`. **Eight are house-original** (`origin_trader='TSDR'`): 20EMA Hold,
Go Signal, HVC, Open Bull Gap Support, Red to Green, Remount, Tight Flag, U&R. The rest
attribute to O'Neil, Minervini, Qullamaggie, Weinstein, Brandt, Morales, Kell, Darvas,
Wyckoff, Dr. Wish.

`setupCatalog.js` families: Bases & Breakouts · Gaps & Catalysts · Momentum & Trend ·
Reversals & Reclaims · Intraday.

**Model Book examples.** `model_examples` — 18 rows (setup_type, symbol, chart_date,
timeframe, grade A+/A/B+, entry/stop/target, outcome_pct, `annotations` JSON,
`failure_analysis`, `chart_path`, `kb_entry_id`). Only 2 carry an `outcome_pct`
(NVDA VCP +19.3, OSCR U&R +12.14). Beside them, **21 annotated PNG charts** in
`uct-intelligence/data/charts/` whose filenames encode the teaching
(`SPY_D_2025-02-22_Follow through day .png`, `ALM_D_2026-01-20_GO SIGNAL and 20EMA Pullback.png`,
`GLW_30min_2026-02-20_HTF.png`). One more in `Setups/COIN_oops_reversal.png` and a worked
case study in `analysis/ASTS_EP_2024/`.

**The pattern engine.** `api/services/pattern_engine/detectors/` — **85 detector modules**
in four families: `candlestick` 17 · `classical` 36 · `structure` 8 · **`uct` 24**. The
`uct/` family is the proprietary one: `avwap_reclaim`, `can_slim_composite`,
`cup_handle_uct`, `episodic_pivot`, `flat_base`, `high_tight_flag`, `holy_grail`,
`kell_cycle`, `lance_opening_drive`, `liquid_leader_filter`, `opening_range_breakout`,
`opening_range_breakdown`, `parabolic_short`, `power_earnings_gap`, `pullback_to_10ema`,
`pullback_to_21ema`, `pullback_to_50sma`, `pullback_to_200sma`, `qullamaggie_setup`,
`remount`, `u_and_r`, `vcp`, `wyckoff_spring`.

**The candle library.** `api/services/screener/candle_catalog.py` — ONE grammar file
holding **66 patterns: 22 SHAPES + 44 RELATIONS**. Deliberate design calls documented
in-file: textbook bias only (Bulkowski contradicts the classical reading on 20 of 77
patterns; the owner's 2026-08-24 call was classic names, classic bias, **no scoring** —
no strength number, no measured direction, no probability reaches a member); `rank` is
ordering only. The match set is delimiter-wrapped (`MATCH_SEP = ","`) so a `LIKE %…%`
column filter is an exact-token test — the `candle_matches` idiom.

### EVIDENCE
File reads and regex counts, 2026-09-02, all paths above. CONFIRMED.

### INTERPRETATION
The house setup grammar is genuinely proprietary at the *definition* layer (48 templates
with regime/liquidity/float/RS conditions, 8 of them original, 24 as executable
detectors). The **teaching layer is thin**: 18 model examples, 9 authored playbooks,
21 annotated charts. That is the gap between "we have a setup library" and "we have the
ultimate setup library".

Four populations for one vocabulary is a live drift hazard, and the repo's own CLAUDE.md
records that only 15 names appear in both `setupGroups.js` and `setupCatalog.js`.

### RELEVANCE TO UCT
If Terminal-Next ships a setup library as a headline surface, the scarce input is
**annotated examples**, not definitions. 18 examples across 48 templates is under one
example per two setups.

### CONFIDENCE
🟢 on all five counts (measured this session). 🟡 on the "8 house-original" reading —
`origin_trader='TSDR'` is an attribution the firm made about itself.

### RECOMMENDATION
Pick ONE population as the authority (the DB `setup_templates`, which is the only one with
regime/liquidity conditions) and derive the other three. And treat example capture as a
content-production problem with a target, not a code problem.

### OPEN QUESTION
`model_examples.chart_path` points where? The 21 PNGs in `uct-intelligence/data/charts/`
are on this machine only; the dashboard's Model Book uses its own `/data/modelbook.db`
with `modelbook_setup_examples`. Are these two libraries the same content or two
independent efforts?

---

## 5. THE BASE-STRUCTURE LIFT LEDGER — the measurement discipline

### OBSERVATION
`docs/base_lift_ledger.json` (63,955 bytes, `measured_at: 2026-09-01`) holds **25
structures measured, 3 published**:

| Structure | Lift | 95% CI | n | Null max |
|---|---:|---|---:|---:|
| `darvas-box` | **+7.35pp** | [+6.78, +7.96] | 24,428 | +1.10pp |
| `parabolic-extension` | **+31.21pp** | [+29.14, +33.61] | 2,077 | +18.92pp |
| `ema-crossback` | **+12.94pp** | [+12.12, +13.72] | 18,705 | +9.65pp |

Unpublished but measured: green-line-breakout, pocket-pivot, power-play, stage-2-breakout,
stage-4-breakdown, flat-base, base-on-base, cup-with-handle, high-tight-flag,
double-bottom, vcp, ascending-base, square-box, buyable-gap-up, cheat-3c, low-cheat,
saucer, climax-top, wyckoff-spring, go-signal, three-weeks-tight, ugly-double-bottom.

The metric: `P(+10% before −8% within 20 sessions)`, with the unconditional universe
baseline measured independently over 3,705 names at **27.51% target-first / 33.41%
stop-first / 39.08% neither**. Lift = conditional − pattern-free, where the pattern-free
half is restricted to the **years the structure actually fired in** (target-first ran
17.1% in 2018 and 35.7% in 2020). CI is a **400-draw cluster bootstrap resampling
tickers**; the null re-runs the identical detector over **moving-block (21-bar) resampled
series** so volatility clustering survives.

**Six gates, all must pass or no number publishes** (from the ledger's own `gates` field):
(0) the lift must be POSITIVE — this gate was missing and it FIRED, `cheat-3c` measured
−1.10pp and published because its interval excluded zero on the negative side;
(1) the 95% CI excludes zero; (2) the CI's **lower bound** exceeds the random-data null's
**maximum** (not its point estimate — that let a +32.97pp lift on n=13 through on the
first run); (3) n is whatever (1) requires, derived not typed; plus a published row must
carry **30 null trials**, not the 5 used to screen.

Supporting artifacts, same directory: `expectancy.json` (5 structures),
`by_population.json` (3 structures × cap tiers), `base_lift_clustering.json` (7),
`noise_firing_rate.json`, `logspace_impact.json`.

Consumer: `api/services/screener/lift_ledger.py`, whose module docstring records the
reason the whole thing exists — head-and-shoulders measured 42.0% against a 42.0%
pattern-free baseline (n=2,795) and double bottom 56.9% against 57.8% (n=6,692);
publishing the raw rate would have shipped both as wins.

### EVIDENCE
`json.load` of the five artifacts + read of `lift_ledger.py`. CONFIRMED by measurement,
2026-09-02.

### INTERPRETATION
This is the highest-integrity asset in the inventory and probably the least
commercially obvious. Three published rows out of 25 measured is a **92% rejection rate**,
and a competitor marketing "40 proven patterns" is making claims this harness would kill.

**Discrepancy worth flagging:** project memory records "30 structures, 3 published"; the
ledger on disk holds **25**. Either five were measured elsewhere, or the memory line is
stale. The 3-published figure matches.

### RELEVANCE TO UCT
"Lift, never a hit rate" is a positioning weapon: it is a claim a competitor structurally
cannot match without rebuilding the harness, and it is legible to a sophisticated member
in one sentence.

### CONFIDENCE
🟢 (the artifact is a measurement record with its own method and gates written down).

### RECOMMENDATION
Make the rejection rate part of the pitch, not a footnote. "We measured 25 and published 3"
is the sentence.

### OPEN QUESTION
Is the ledger regenerable on demand (`tools/run_lift_ledger.py` is referenced in the
`sample` field), and what does a full re-run cost in wall-clock time? That decides whether
"measured this quarter" is a repeatable product promise.

---

## 6. THEMES, SCREENER, CATALYSTS, BREADTH, COT, INDICATORS

### OBSERVATION

**Theme taxonomy.** `themes_taxonomy.json` — measured 2026-09-02: **version 4.22.0,
112 themes, 12 sectors, 2,029 holdings**, each theme carrying `etf_ticker`, `etf_name`,
`sub_themes`, `holdings`. Described in-repo as the **inviolable owner baseline**; the
Theme Membership Engine writes only to an `engine_memberships` overlay in `auth.db` and
physically cannot edit the JSON.

**Screener.** `api/services/screener/` holds 41 modules including `finviz_universe.py`,
`base_catalog.py`, `base_count.py`, `bases.py`, `candles.py`, `candle_catalog.py`,
`candle_backtest.py`, `lift_ledger.py`, `pattern_join.py`, `setup_score.py`,
`scan_evaluator.py`, `saved_screens.py`, `methodology.py`, `distribution.py`,
`ranking.py`. The scanner that feeds the wire is
`uct-intelligence/scripts/scanner_candidates.py` (three Finviz scans, 7-criteria candle
score 0–110, `_detect_wedge_flag`); its live output is
`uct-intelligence/data/candidates.json` (47,289 B, 2026-09-01).

**Catalysts.** `api/services/catalyst/` — 8-source pull, composite score, deterministic
tagging, forced 10/5/3/2 quota, Opus synthesis with skip-if-stable hashing. Store
`/data/catalysts.db` (indefinite retention) + `/data/catalyst_metadata.db`.
**Volume NOT DETERMINED** (production).

**Twitter/X ingestion.** `api/services/tweet_store.py` → `/data/tweets.db`, **7-day
rolling retention** (`TWEET_RETENTION_DAYS`, default 7). This is deliberately NOT an
archive — nothing accretes. Curated accounts are admin-editable.

**Breadth.** `api/services/breadth_monitor.py` → `/data/breadth_monitor.db` plus
`breadth_intraday.db`, `breadth_daily_ohlc.db`, `breadth_dividends.db`,
`breadth_sentiment_history.db`. One checked-in seed exists locally:
`api/data/breadth_sentiment_history.csv` (465,648 bytes). The collector runs on this PC
(`uct-intelligence/scripts/breadth_collector.py`, `UNIVERSE_CAP_FLOOR = 300_000_000` at
line 67) with a 265,268-byte local log. The KB's own `market_breadth` table holds 125 rows.
Production breadth history depth: **NOT DETERMINED**.

**COT.** `api/services/cot_service.py` → `/data/cot.db`, seeded with **10 years** of CFTC
history, 62 symbols. Public source data; the proprietary layer is the **read**:
`app/src/pages/cot/` (`cotRead.js` 3Y + 26-week COT Index with 90/75/25/10 zones,
commercial-led bias, crowding, Movement Index; `cotAnalogs.js` forward returns 4/8/13
weeks with no lookahead; `cotDivergence.js` 5 price-vs-positioning tells;
`cotFacts.js` the ONLY numbers the LLM may cite) plus grounded narratives cached in
`cot.db :: cot_narratives`.

**Indicator / formula engine.** `docs/formulas/GRAMMAR.md` is **generated** from
`app/src/components/chart/engine/ast/closedTable.json` (manifest version 2). The grammar
is CLOSED — a formula must be decidable before it runs so one saved formula can sweep
thousands of symbols on a schedule. `nativeRegistry.js` ships **15 indicators, 14 of them
as engine definitions**. `conceptVocabulary.json` backs the English→formula door.

**UCT Signature indicators.** `api/services/signature/` — `flow_breakout` (ledger key
`fcb`, version `fcb-v2`), `gex_walls` (`gxw-v1`), `darkpool_levels`, `confluence`,
`sweep`, plus an `rsLine` fourth tenant added specifically to prove the lane is generic.
Signals accrue in an **append-only, INSERT-only** ledger (`/data/signal_ledger.db`,
`signature_signals`) keyed `(indicator, version, sym, tf, bar_time, direction)`, with
`first_seen_at` immutable. **Row count NOT DETERMINED.**

### EVIDENCE
`json.load` of `themes_taxonomy.json`; directory listings of `api/services/screener/` and
`api/services/signature/`; module docstring reads of `cot_service.py`, `tweet_store.py`,
`buzz_store.py`, `ledger.py`, `lift_ledger.py`, `discord_index_close.py`;
`docs/formulas/GRAMMAR.md` head. CONFIRMED where a file was read; production volumes are
NOT DETERMINED.

### INTERPRETATION
Three tiers are visible here. The **theme taxonomy** (112 × 2,029, hand-curated, version
4.22.0 after ~22 minor revisions) is a real curation asset. The **closed formula grammar**
and the **Signature append-only ledger** are architecture assets — they make claims
auditable, which is the same doctrine as §5. The **vendor-fed** stores (catalysts, tweets,
COT, breadth OHLC) are convenience: replaceable with money.

The tweet store's 7-day retention is the one place where a potentially valuable trail is
being deliberately discarded.

### RELEVANCE TO UCT
The Signature ledger is the only place in the product where an indicator's *historical
firings* accrete under an immutable key. That is the substrate for "this signal has fired
N times and here is what happened" — a Terminal-Next surface with no competitor analogue.

### CONFIDENCE
🟢 on taxonomy numbers and module inventories. 🔴 on every production row count.

### RECOMMENDATION
Decide whether `/data/tweets.db`'s 7-day window should become an archive. It is one env
var (`TWEET_RETENTION_DAYS`) and the cost is disk.

### OPEN QUESTION
How many rows does `signature_signals` hold, and how far back does `first_seen_at` reach?
That number decides whether the "signal track record" surface is shippable this quarter.

---

## 7. OPTIONS FLOW, DARK POOL, GEX — records and the honesty contract

### OBSERVATION
- `api/flow_scoreboard.py` — `GET /api/flow-scoreboard`, **public, no auth**: aggregate
  hit rates, a grade-calibration table, recent standouts, and an "honest tape" of the last
  picks including losers, computed over `api/top_flow_tracker.py`'s active + archived
  picks. Its docstring carries **LOCKED honesty rules**, described in-file as "a public
  trust asset": losers are NEVER excluded; picks with fewer than 2 daily snapshots are
  reported separately as "too new" and excluded from rates rather than silently dropped;
  all gains are **contract-price** gains, not underlying moves.
- `api/darkpool_records.py` — per-ticker biggest-ever dark-pool prints in a table that
  **only ever grows**, because `darkpool_trades` is pruned to ~120 trading days. A print
  beating a record and ≥ `DARKPOOL_RECORDS_ALERT_FLOOR` (default $100M) fires one Discord
  ping. Dark by default (`DARKPOOL_RECORDS_ENABLED=1` to arm).
- `api/notable_flow.py` — Flow Pulse + Hot Ticker Discord alerts, 24h per-ticker dedup,
  state in `/data/notable_alerts.db`; the frontend computes the payload so what members see
  and what Discord gets cannot drift.
- `api/services/signature/gex_walls.py` — GEX walls off a live Schwab `/chains` request,
  reachable only through the router's ServeStale slot.
- `api/oi_snapshots.py` / `oi_massive_snapshots.py` → `/data/oi_snapshots.db`.
- Partner-owned modules exist in this family (`OptionsFlow.jsx`, `live_massive_router.py`,
  `massive_ws_worker.py`, `massive_processor.py`, `schwab_router.py`). Noted and not
  described further.

### EVIDENCE
Module docstring reads of the four files above, 2026-09-02. CONFIRMED that the code and
its rules exist. That the scoreboard is currently serving is a CLAIM (route is declared;
I did not call it).

### INTERPRETATION
The flow scoreboard's honesty rules are the single most transferable piece of doctrine in
this inventory: they are three sentences, they are commercially costly, and they are
exactly what a member cannot verify about a competitor. Dark-pool all-time records are a
genuine accretive asset (they grow forever while the underlying trades are pruned) with
zero incremental cost.

### RELEVANCE TO UCT
"Every pick, including the losers, with contract-price gains" is a Terminal-Next
positioning line that is already implemented.

### CONFIDENCE
🟡 — code CONFIRMED, live behaviour and record volumes NOT DETERMINED.
**EVIDENCE CEILING:** `/data/flow.db`, `/data/notable_alerts.db`, `/data/oi_snapshots.db`
all on the Railway volume; the flow family additionally runs on the separate flow-worker
service.

### RECOMMENDATION
Count the dark-pool records table and the top-flow archive before treating either as a
headline asset.

### OPEN QUESTION
How many distinct tickers carry a dark-pool all-time record today, and how far back does
the oldest record reach?

---

## 8. CONTENT AND EDUCATION — the curriculum, the Desk, Sunday Scans

### OBSERVATION

**a) The curriculum — the largest single authoring asset found.**
`docs/curriculum/` (README calls itself "source of truth"; the product DB holds only what
members see):

| File | Bytes | What it holds |
|---|---:|---|
| `uct_method_scripts.json` | **695,131** | The recording bible: per chapter `marker`, `beat`, `speaker_notes`, `on_screen`, `example_spec`, `spec_verdict`. README states ~56k words of speaker notes. |
| `curriculum_final_v2.json` | 303,376 | **UCT Foundations** — 60-lesson hybrid (41 library videos + 19 gap recordings); measured: 33 units, 20 gaps, 20 briefs, 5 architecture keys |
| `uct_method_chapters.json` | 131,509 | 5 chapter markers per lesson (README: 395 total) |
| `uct_method_course.json` | 51,774 | **The UCT Method** — measured **16 modules / 79 lessons** |
| `curriculum_dossier.md` | 34,916 | Pedagogy research + firm methodology, 7 research lenses |
| `uct_method_toolkit.json` | 33,523 | **7 printable member artifacts**: The LOOP Card · Monday Max-Exposure Plan · R-Multiple Ledger · Placement Diagnostic (The Five Leaks) · Five-Field Setup Card · Sizing Gate (Module 5 Checkpoint) · Playbook Template + Defense Rubric |
| `uct_method_presenter_brief.json` | 16,530 | Presenter onboarding + 40-term glossary |
| `uct_method_recording_plan.md` | 2,251 | Phased order; Phase 1 = ~21 dual-use spine lessons |

Two things make this more than a syllabus. First, **chart examples are data-verified
against real historical bars and stated split-adjusted**, with `spec_verdict` recording
what happened per example: **verified 29 · corrected 138 · replaced 9** (the claimed
pattern did not exist in the data) · `no_data_needed` 5 — 181 examples checked, and 147 of
them were wrong on first pass. Second, the README records a **record-once contract** (~21
Method lessons double as Foundations gap recordings) and two deliberately-open owner
decisions (the setup-catalog count and the 0-150 regime band thresholds) that the
materials refuse to state.

**b) The Desk.** `api/services/education_service.py` → `/data/education.db`, one table
`edu_videos` (YouTube id + metadata; videos live unlisted on YouTube, embedded via
youtube-nocookie). Publishing is fully automated from Zoom
(`api/services/desk_daily_session.py`), with per-show privacy
(`privacy_for_section`, `DESK_PUBLIC_SHOWS` default `sunday scans`; **blank makes nothing
public**). Post-publish, `desk_session_insights.py` derives **chapters, ticker_moments,
recap poster** from the Zoom VTT transcript. `api/services/ticker_mentions.py` turns
`ticker_moments` into per-mention rows and states the library is **~300 rows**.
Announcements to the public TSDR channel are opt-IN per show
(`DESK_TSDR_ANNOUNCE_SHOWS`, default `evening update`; blank announces nothing).
**Actual video count and transcript volume: NOT DETERMINED.**

**c) The published Substack archive — the public content corpus.**
`uct-intelligence/data/intake/substack_uct_full_archive_2026-08-28.txt` — 1,549,159 bytes,
**92 posts (65 `[SUNDAY SCAN]` + 27 `[ARTICLE]`), 2025-06-01 → 2026-08-23**. Seven dated
snapshots exist (2026-07-24 through 2026-08-28), growing ~25 KB/week. An older, separately
scoped scrape sits beside it:
`substack_unchartedterritory_sunday_scans_2026-02-21.txt` (757,045 B, 39 posts) — the one
that produced the KB's 4,399-row intake.

**d) The Sunday Scans generator (`uct-sunday-scan`).** A standalone package that
pre-builds the weekly Substack draft from Friday-close data. Its proprietary content is
the **measured conformance to the owner's actual writing**:
- `sunday_scan/config.py:128-133` — roster carry aged off **published lists, never
  calendar weeks**; `ROSTER_CARRY_TARGET = 0.72` with the measurement written beside it
  ("CONFIRMED ~70%: 72.2% mean / 73.5% median"), band (0.50, 0.86), week-over-week 0.50.
- `sunday_scan/anchors.py` — the price model is **anchor confluence**, not entry/stop/target,
  because that vocabulary "appears essentially nowhere in **851 per-ticker notes**". Rules:
  ≥2 coincident anchors → a spot (`~$100 (20EMA + prior ATH + psyche)`); 1 anchor → a bare
  named level with no verdict; 0 → nothing. Band ±20% of last close, coincidence tolerance
  1.5%, min 60 bars, every anchor derived from the plotted series itself.
- `sunday_scan/bracco.py` — a second writer, measured: his section is **20.7% of the
  published body** across 58 sections, median 569w all-time / 618w current era (range
  353–959); sentences 19.7–20.0 words vs TSDR's 14.1–14.8; `$`-levels at 1.73 per 1k words
  vs TSDR's 13.14; "lol" appears **0 times in 211,539 characters** of his prose (TSDR: 29).
  His words render **verbatim** — the renderer asserts output word count equals input word
  count, so summarising him is structurally impossible.
- `sunday_scan/picks.py` — the owner's standing hand-picks are **additive**, never scored
  against the automated roster, and validated at add time.
- The package **never auto-publishes**; it creates a draft.
- `sunday_scan/corpus.py` — a fresh re-scrape is adopted only if `parse_agreement` passes
  (same symbol set as the audited reference on every shared date); disagreement keeps the
  old file, loudly.

### EVIDENCE
File sizes and `json.load` measurements of `docs/curriculum/*`; `grep -c` over the
Substack archive for `^=== \[`; `sed -n` reads of `config.py`, `anchors.py`, `bracco.py`,
`picks.py`, `corpus.py`, `education_service.py`, `ticker_mentions.py`. CONFIRMED.

### INTERPRETATION
The curriculum is months of authoring work sitting in git, and the `spec_verdict` counts
(138 corrected, 9 replaced out of 181) are evidence that the data-grounding pass was real
rather than ceremonial. It is the asset most ready to become a product and least dependent
on live data.

The Sunday Scans package is the most unusual thing in this inventory: it is not content,
it is **a measured model of a specific human's published writing**, encoded as thresholds
with the measurements written beside them. Combined with `morning-wire/owner_voice.py`'s
profile (§2f), UCT holds a quantified voice model for two named writers. That is not
buyable.

### RELEVANCE TO UCT
Three distinct Terminal-Next surfaces are already substrate-complete: a course product
(curriculum), a per-ticker "what the Desk said" timeline (`ticker_mentions`), and a
searchable published archive (the Substack corpus).

### CONFIDENCE
🟢 on curriculum and Sunday-Scan measurements (files read). 🔴 on Desk library volume.
**EVIDENCE CEILING:** `/data/education.db`.

### RECOMMENDATION
The 851-note conformance audit and the Bracco measurements should be preserved as a
document, not only as constants inside a package — they are the evidence for every
editorial rule the product enforces.

### OPEN QUESTION
`ticker_mentions.py` states "~300 rows" for the video library. Is that videos or mentions,
and how many distinct tickers does the Desk timeline actually cover?

---

## 9. COMMUNITY AND TRADING-ROOM DATA

### OBSERVATION

**a) The Discord room history — the deepest first-party record found.**
`C:\Users\Patrick\uct_intelligence\data\` (the Discord-bot repo, NOT a git repo):
- `raw/tsdr_export_20260221_154219.json` — 3,784,125 bytes, **7,780 records**.
- `processed/processed_messages.json` — 5,572,488 bytes, **7,766 classified messages**,
  each with `message_id`, `timestamp`, `author`, `content`, `tickers[]`, `message_type`,
  `has_attachment`, `attachment_urls`, `classification_confidence`.
- `processed/trader_profile.json` — derived: `date_range` **2024-03-11 → 2026-02-20**,
  `total_messages` 7,631, `tsdr_messages` 7,567; `message_types` = other 3,774 ·
  trade_entry 1,019 · trade_exit 821 · analysis 717 · watchlist 437 · alert 355 ·
  market_commentary 342 · educational 102; `win_language_count` 174 vs
  `loss_language_count` **644**; `top_tickers` QQQ 144, TSLA 110, NBIS 99, LOD 98, ALAB 94,
  SPY 76, COIN 73, ER 70, SNOW 60, RDDT 60, NVDA 57, HOOD 56, IWM 54, TEM 53, IREN 51;
  `setup_mentions` EP 270 · 20EMA Hold 262 · Inside Day 223 · Breakout 180 · Remount 133 ·
  Gap Up 111 · Undercut 105 · Options 103 · Cup-with-Handle 63 · GO SIGNAL 61 ·
  50 DMA 47 · Wedge Pop 45 · CSPs 42 · EMA Crossback 40 · Credit Spreads 36;
  `sector_focus` AI 1,395 · Options 556 · Technology 66 · Energy 61 · Biotech 23 ·
  Defense 14.
- `processed/trading_rules.json` — **50 extracted rules, 27 entry criteria, 30 exit
  criteria, 20 sizing rules, 20 process statements**, plus a 1,586-char rules summary.
- `data/chromadb/episodic_messages.lance` — 51 files; the vector index over the above.
- 591 of these messages were promoted into the engine KB (`intake:discord_tsdr`).

**b) `/buzz` — the live ticker-mention stream.** `api/services/buzz_store.py`, DB
`/data/buzz.db`. Schema is deliberately minimal: `mentions(message_id, channel_id,
author_id, ticker, ts, confidence)`, PK `(message_id, ticker)`.
**The docstring states it stores NO message text**, by design: `message_id` +
`channel_id` reconstruct a Discord jump link, which stays true when a member edits or
deletes; a stored copy would not. `buzz_ingest.py` polls
`#main-chat` (id `1216816863313657886`) via `GET /channels/{id}/messages` — no
MESSAGE_CONTENT privileged intent needed — and advances its cursor only AFTER commit.
Collisions are DERIVED, never typed: `api/data/buzz_collisions.json` (10,314 B, keys
`_comment`/`derived_from`/`measured_effect`/`tokens`), `buzz_aliases.json`, and a provably
narrow hand-curated acronym set in `buzz_universe.py` (RS, MA, PEG… — entries casing
analysis structurally cannot separate; EMA, GAP, LINE, BULL, GAIN were REMOVED on
2026-09-01 once the derived corpus covered them). **Mention volume NOT DETERMINED.**

**c) The Floor (in-product community).** `api/services/community_store.py` →
`/data/community.db`. Four board spaces (`mentor-desk` mentor-only, `trade-ideas`,
`questions`, `wins-lessons`), reaction kinds (fire/bullish/salute), plus code-defined live
chat channels (trading-floor, pre-market, after-hours, wins, …). **Volume NOT DETERMINED.**

**d) Member-generated journal + notebook — PRIVATE, not a firm asset.**
`api/services/journal_two/db.py` — `j2_notes` (+ `j2_note_folders`, `j2_positions`,
`j2_trades`, `j2_day_notes`, `j2_chat_messages`, the `j2_broker_*` family) all live in
`auth.db` and every index is `(user_id, …)`. `api/routers/journal_two.py:4` states every
route under `/api/j2/*` scopes by `user_id`. Broker-synced positions mirror the member's
brokerage exactly (a "dust filter" was explicitly rejected).

### EVIDENCE
`json.load` measurements of the bot's `processed/` and `raw/` files; schema reads of
`buzz_store.py`, `buzz_ingest.py`, `buzz_universe.py`, `community_store.py`; grep of
`journal_two/db.py` indexes and `journal_two.py`'s scoping docstring. CONFIRMED for the
local files; production volumes NOT DETERMINED.

### INTERPRETATION
The **7,766-message classified room record spanning 2024-03-11 → 2026-02-20** is the single
most irreplaceable data asset UCT holds. It is two years of a real trading room, tagged by
ticker and by message type, with entries and exits separated. Nobody can buy it, scrape it,
or reconstruct it.

It has one serious problem: **it stops on 2026-02-20.** The `/buzz` stream that continues
the story stores counts only, by deliberate privacy design. So the deep record is frozen
and the live record is thin. Those are two different assets, not one continuous one.

The privacy postures are consistent and defensible throughout — buzz stores no text,
journal is user-scoped, community mentor-desk is role-gated, Desk privacy defaults to
unlisted, TSDR announcements are opt-in with a fail-silent blank. That consistency is
itself an asset when a licensing or trust question is asked.

### RELEVANCE TO UCT
Any Terminal-Next feature phrased as "the room's view of SYM" has two possible substrates
with very different properties: the frozen 2024–2026 classified corpus (rich, private,
text-bearing) and the live buzz counts (thin, ongoing, text-free). Choosing between them
is a product AND a privacy decision.

### CONFIDENCE
🟢 on the bot corpus (measured). 🟡 on buzz (schema CONFIRMED, volume unknown).
🟢 on the privacy postures (each stated in the module that enforces it).

### RECOMMENDATION
Decide whether the #tsdr classified corpus gets refreshed past 2026-02-20. If yes, the
member-consent question needs answering first — that export contains message text and
author ids.

### OPEN QUESTION
What consent basis covers the 7,766-message export, and does it extend to using member
messages in a product surface rather than an internal RAG?

---

## 10. THE "UCT WAY" IN CODE — rule-by-rule, with path:line

### OBSERVATION
Every rule the seed facts call "the UCT way" resolves to a concrete constant.

| Rule | Where | The value |
|---|---|---|
| **Regime × grade position ceiling** | `uct-intelligence/uct_intelligence/api.py:2678` `_SIZING_TABLE` | GREEN A+ 25% / A 20% / B 10%; YELLOW 15/12/6; ORANGE 8/5/**0**; **RED 0/0/0** |
| **Position sizing** | `api.py:2694` `calculate_position_size()` | `dollar_risk = account × risk_pct/100`; `shares = dollar_risk / (price − stop)`; R1/R2/R3 at 1×/2×/3× stop distance; a 0% ceiling returns `recommendation: "SKIP"` |
| **House risk identity** | `uct_intelligence/harness/rules.py:193` `position_size_pct()` | `Account Risk % = Position Size % × Stop Distance %`; `budget = heat_budget_pct × regime_scalar`; `target_risk = budget / target_slots`; clamped to [min_position_pct, max_position_pct] |
| **Regime-adjusted caps** | `uct_intelligence/risk.py` `_REGIME_LIMITS` | Uptrend 100%/25%/12 · Pullback 70/15/8 · Recovery 70/15/8 · Rally Attempt 40/10/5 · Distribution 40/10/5 · Downtrend 15/5/2 |
| **Portfolio heat cap** | `risk.py::calculate_portfolio_heat` | warn above **5%** total heat; warn above **12** positions |
| **Sector concentration** | `risk.py::check_sector_concentration` | default max **40%** per sector |
| **Drawdown protocol** | `risk.py` `_DRAWDOWN_PROTOCOLS` | −5 CAUTION · −8 DEFENSIVE (cut exposure 50%, A+ only) · −10 MINIMAL (max 2 positions, half size) · −15 CASH · −20 BREAK |
| **Aggregate heat cap (Desjardins)** | `api/services/portfolio_heat.py` via `brain_service.aggregate_heat_cap_pct()` | **10%**, fail-soft to 10 |
| **Scanner market-cap floor** | `uct_intelligence/screener.py:470`; `scripts/breadth_collector.py:67` | **$300M** |
| **Leadership market-cap floor** | `uct_intelligence/harness/fundamentals.py:149` `MIN_MARKET_CAP` | **$500,000,000.0** |
| **Book stop ceiling** | `uct_intelligence/book/config.py` `max_stop_pct` | **4.0%** (tightened from 5.0 on 2026-08-20); applied upstream by `levels.py` / `trigger_quality.py`, never re-gated by the Book |
| **Stop ceiling exemption** | `uct_intelligence/levels.py:244` | a stop over the ceiling passes only when `stop_kind == "ema_21_buffer"` |
| **Trigger quality floor** | `uct_intelligence/trigger_quality.py:43` | `min_risk_pct_abs = 0.25` — an absolute backstop that applies ONLY when the ATR floor does not |
| **Exposure model** | `morning-wire/morning_wire_engine.py` MODULE 5 (~4686–4915) | base **100** above QQQ 50SMA / **40** above 200 only / **15** below both; ±10 phase adj; **score 0–150 IS the recommended exposure %**; legacy `exposure = min(score,100)` |
| **Exposure gates (IBD)** | same module | FTD → floor 40 · IBD Restraint Rule (pre-B4) → ceiling **65** · S2 below FTD low → ceiling **40** · B4 Power Trend → floor 30; `gate_levels.release = ftd_close × 1.0125`, `gate_levels.s2 = ftd_low`; the wire is the ONE authority, the dashboard reads and never re-derives |
| **Follow-through day** | `morning_wire_engine.py:3987` | Day **4+** of a rally attempt, **≥1.25%** gain, **QQQ volume > prior day** (IBD standard); the FTD intraday low becomes the S2 invalidation |
| **FTD landmine narration** | `morning-wire/game_plan.py:66-101` | derived FROM the phase so it can never contradict it; a close below the FTD low is a SELL SIGNAL, not a reset |
| **Discipline tiers** | `morning-wire/discipline.py` `_TIERS` | ≥100 Aggressive / full size / 3 new · ≥70 Constructive / standard / 2 · ≥50 Neutral / reduced / 2 · then Caution, Defensive |
| **Top 5 entry types** | `morning_wire_engine.py:9193-9202` (+ 9262) | **PREV DAY HIGH BREAK** (`prev_day_high`) · **PREV LOW RECLAIM** (`undercut_reclaim`) · **RED TO GREEN** (`prev_day_close_reclaim`) · **BASE BREAKOUT** (`base_high`); line 9262 also permits **EMA RECLAIM** |
| **Setup priority override** | `morning_wire_engine.py` editorial directives §1 | "A clean technical setup … gets featured with conviction regardless of regime score… Setups and catalysts override regime. Always." |
| **Grades** | `api.py:2678` + `modelbook.py` validation | A+ / A / B / C / F; the sizing table only pays A+, A, B |

### EVIDENCE
Direct `grep -n` + `sed -n` reads of every path above, 2026-09-02. CONFIRMED as code.
Whether each fires in production is a separate question and is NOT DETERMINED here.

### INTERPRETATION
The doctrine is unusually **complete and unusually consistent**: one risk identity
(`risk % = size % × stop distance %`) appears in three modules that all derive from it
rather than restating it; the exposure score has exactly one authority and the dashboard
is documented as a reader; the FTD narration is derived from the phase specifically so it
cannot contradict it. This is a codified method, not a collection of heuristics.

Two floors coexist deliberately ($300M scanner, $500M leadership) — noted because a
synthesis that collapses them to one number would be wrong.

### RELEVANCE TO UCT
This table is the answer to "what would we teach a Terminal-Next assistant to say".
It is also the specification for any sizing/exposure widget: the constants exist, they
have one home each, and they are already reachable from the dashboard through
`brain_service`.

### CONFIDENCE
🟢 on every constant (each read at its line). 🟡 on the ORANGE/B = 0 and RED = 0 rows
being live product behaviour rather than a brain-facade default.

### RECOMMENDATION
Publish this table to members as "the method", with the path-level provenance stripped.
A rule that a member can check against what the product does is a trust asset; a rule
that lives only in code is a liability the day the two disagree.

### OPEN QUESTION
`brain_service.size_a_trade` hard-caps account risk at 2% (per the dashboard CLAUDE.md).
Does that 2% cap and the `_SIZING_TABLE` ceiling ever disagree, and which wins?

---

## 11. HISTORICAL CALLS AND COMMENTARY — how searchable is "what did we say about SYM?"

### OBSERVATION
Four independent per-ticker histories exist. **No single surface unions them.**

| Trail | Rows | Span | Carries |
|---|---:|---|---|
| `leadership_snapshots` | 4,440 | 2026-02-19 → 2026-09-01, **134 dates, 1,038 symbols** | rank, setup_type, **thesis**, company, sector, score, confidence_tier, regime_fit |
| `wire_universe` | 19,050 | 43 issues from 2026-04-28 | `feature_vector`, `dropped_at_stage`, `drop_reason` — the names CONSIDERED and rejected |
| `setup_triggers` | 243 | 2026-07-30 → 2026-09-01 | entry, stop, quality components, `regime_at_publish`, resolved status |
| `ep_candidates` / `ep_follow_throughs` | 447 / 10,808 | 2026-02-20 → 2026-09-01 | thesis, entry, stop, targets, hold days, follow-through |

Plus:
- **Desk video mentions** — `api/services/ticker_mentions.py` produces one row per mention
  from `edu_videos.ticker_moments`, surfaced as StockChart markers and a TickerPopup
  "Desk" timeline tab. Library stated ~300 rows.
- **The published archive** — 92 Substack posts (65 Sunday Scans), machine-parsed by
  `uct-sunday-scan/sunday_scan/roster.py::parse_published_lists` into per-post symbol
  sets. This is a searchable record of what the firm published about a ticker, going back
  to 2025-06-01.
- **The Discord corpus** — 7,766 messages with `tickers[]`, 2024-03-11 → 2026-02-20 (§9a).
- **`news_archive`** (22,562) and `transcript_index.py` (FTS5 over FMP earnings
  transcripts) are third-party content, not firm commentary.

### EVIDENCE
Read-only KB queries plus module reads of `ticker_mentions.py`, `transcript_index.py`,
`corpus.py`, `roster.py`. CONFIRMED for existence and volume of the KB trails.

### INTERPRETATION
The material for a "UCT on $NVDA — everything we've said, since 2024" surface **already
exists** and reaches back further than any other asset in the inventory (2024-03-11 via
Discord, 2025-06-01 via Substack, 2026-02-19 via the KB). What does not exist is the join.
Each trail has a different key, a different permission tier and a different text policy
(buzz has no text at all).

`wire_universe`'s 19,050 considered-and-dropped rows are the unusual one. "We looked at
this name on 2026-06-12 and dropped it at the lens stage because X" is a claim no
competitor can make, and it is the kind of thing that reads as integrity rather than
marketing.

### RELEVANCE TO UCT
This is, in my reading, the single strongest Terminal-Next differentiator available from
existing assets — and it requires no new data collection, only a join and a permissions
model.

### CONFIDENCE
🟡 — the trails are CONFIRMED; the absence of a unifying surface is an inference from not
finding one, and AI Search may already do part of this. NOT DETERMINED.

### RECOMMENDATION
Scope a per-ticker history join as a Terminal-Next candidate feature. Its cost is
dominated by the permission model (Discord text is member-private, the wire is paywalled,
Sunday Scans are public), not by the data.

### OPEN QUESTION
Does AI Search (`api/services/ai_search_*`) already retrieve across the wire archive and
the Desk transcripts for a ticker query? That is D-12's territory and would change this
recommendation.

---

## 12. UNIQUENESS RANKING (🟡 — interpretation, not measurement)

### OBSERVATION

**Tier 1 — no competitor can replicate (the moat).**

1. **The trading-room record.** 7,766 classified #tsdr messages, 2024-03-11 → 2026-02-20,
   with per-message tickers and entry/exit classification, plus a derived rules corpus
   (50 rules / 27 entry / 30 exit / 20 sizing). Evidence: measured file counts, §9a.
   *Caveat: frozen since 2026-02-20.*
2. **The decision record.** `wire_issues` 43 × `wire_universe` 19,050 (considered AND
   dropped, with feature vectors) + `leadership_snapshots` 4,440 theses across 1,038
   symbols + `setup_triggers` 243 with resolved win/loss + `book_ledgers` 26 immutable
   both-arm ledgers. Nobody publishes their rejects.
3. **The quantified voice models.** `voice_profile.json` (88 posts / 120,055 words /
   9,016 sentences, em-dash cap 1.0 per 1k, median sentence 12 words) + 120 verbatim
   exemplars, plus the Bracco measurements (58 sections, 20.7% of body, "lol" 0/211,539
   chars) and the 851-note anchor-vocabulary audit. This is a model of two specific
   humans' writing, mined from their own archive.
4. **The curriculum.** 16 modules / 79 lessons / ~695 KB of scripts / 7 printable
   artifacts / 181 chart examples **verified against real bars** (138 corrected, 9
   replaced). Months of authoring, in git.
5. **The measurement discipline itself.** The six-gate lift ledger (25 measured, 3
   published), the flow scoreboard's locked honesty rules, the Book's mandatory control
   arm. A competitor can copy the words; copying the discipline means killing 92% of their
   own claims.

**Tier 2 — differentiated, reproducible with real effort.**

6. `setup_templates` 48 with regime/liquidity/float/RS conditions (8 house-original) and
   24 UCT detector modules.
7. The 66-pattern candle grammar with its no-scoring doctrine.
8. The closed formula grammar (`closedTable.json` manifest v2) + 15 native indicators.
9. `themes_taxonomy.json` v4.22.0 — 112 themes / 2,029 holdings, hand-curated.
10. The COT read layer (`cotRead.js` / `cotAnalogs.js` / `cotDivergence.js`) over public
    CFTC data.
11. The Signature append-only signal ledger.
12. The Zoom→YouTube→chapters→ticker-moments Desk pipeline.

**Tier 3 — merely convenient (buyable).**

13. `earnings_analytics` 40,731 · `news_archive` 22,562 · `ticker_metadata` 5,969 ·
    `cap_universe` 3,721 · COT raw · breadth OHLC · tweets (7-day) · logos · fundamentals.
    All vendor-derived. Their value is integration, not possession.

### EVIDENCE
Every count above is cited to its section. The RANKING is 🟡 interpretation.

### INTERPRETATION
The moat is **narrative + decision provenance**, not data volume. UCT's biggest tables
(earnings 40,731; news 22,562) are its least defensible, and its most defensible assets
(the room record, the reject log, the voice models) are measured in thousands of rows and
hundreds of thousands of words.

### RELEVANCE TO UCT
Terminal-Next should be built on Tier 1 and 2. Any surface whose value comes from Tier 3
is a surface a funded competitor ships in a quarter.

### CONFIDENCE
🟡 — the counts are 🟢, the ranking is judgement.

### RECOMMENDATION
Test the ranking against D-03's provider inventory and the competitor work (D group).
If a competitor already ships something in Tier 1, that is the finding that matters most.

### OPEN QUESTION
Is there a licensing constraint on using the Qullamaggie YouTube transcript intakes
(12 sources, 876 attributed rows) in a paid product? That is D-group licensing territory,
flagged here because the rows are in the shipping Brain Pack.

---

## 13. OBSERVATIONS ON SOURCE TEXT (per SOURCE HANDLING)

### OBSERVATION
Three pieces of text encountered read as instructions or as claims that a reader could
mistake for verified fact. None were acted on.

1. `api/earnings_router.py`'s docstring instructs "Mount in main.py:
   `app.include_router(earnings_router, prefix="/api/schwab")`". The router is unmounted
   and superseded; the dashboard CLAUDE.md already records this and says not to follow it.
   Recorded here as an observation only.
2. `C:\Users\Patrick\uct_intelligence\CLAUDE.md` opens with marketing-register claims —
   "deep and profound understanding of 100 Top Traders", "read and analyze 150 top trading
   books", "trained on the 200 top Trading Youtube channels". Measured against the KB, the
   YouTube intakes number **12** and the attributed traders **~25**. These are CLAIMS in a
   README, contradicted by the data, and must not be carried into any product copy.
3. `docs/curriculum/README.md` contains editing rules addressed to a future author
   ("Record-once contract", "re-sync them"). Read as documentation of an authoring
   process, not followed as instruction.

### EVIDENCE
Direct reads of the three files, 2026-09-02.

### INTERPRETATION
Only (2) is materially risky: it is the kind of sentence that ends up on a landing page.

### RELEVANCE TO UCT
Marketing copy for Terminal-Next should be derived from the measured numbers in this
report, not from repository READMEs.

### CONFIDENCE
🟢.

### RECOMMENDATION
Correct or delete the bot README's claim block, because it is the sort of statement that
gets quoted.

### OPEN QUESTION
None.

---

## GAPS — what my budget did not reach

- **Every production row count.** All 45 dashboard-owned SQLite DBs are on the Railway
  `/data` volume: Buzz mention history, Desk video/transcript library, flow + dark-pool
  records, catalysts history, breadth history depth, community forum volume, member
  notebook/journal volume, Signature signal ledger depth, AI-search memory. The schemas
  and retention rules are inventoried; the volumes are NOT DETERMINED.
- **Consumption rates.** I established how each asset is *wired* to a surface, not how
  often members actually open it. No analytics were consulted.
- **The Model Book's production content.** `/data/modelbook.db` holds
  `modelbook_stocks` / `modelbook_setups` / `modelbook_catalysts` /
  `modelbook_setup_examples` / `modelbook_year_recaps`. I read the schema and the service;
  the curated library's size (years covered, stocks per year, setups labelled) is unknown.
- **Whether the base-lift ledger's 25 vs memory's 30 structures is a real discrepancy.**
  I did not look for a second ledger file or a `tools/run_lift_ledger.py` window table.
- **`api/services/ai_search_*` (12 modules) and `voice_*` (60+ modules).** Deliberately
  left to D-12; they may already implement the per-ticker history join in §11.
- **The engine's `data/massive_cache/`, `data/audits/`, `analysis/`** were listed but not
  read for content.
- **The 46 wire review files** in `morning-wire/data/reviews/` were counted, not read;
  they contain the owner's per-issue critique and may hold editorial doctrine not captured
  elsewhere.
- **`x_accounts.db`** (12 KB, engine repo) was found but not opened.
- **Git history.** The contract permits read-only `git log` only where named; I did not
  run git at all, so "how fast is each asset growing" is unmeasured except where dated
  files allowed it.

## NOT INSPECTED — out of reach, and why

- **`C:\data`** — the live shared data root on this machine. Contract-forbidden. It is
  where every `/data/*.db` path resolves locally, so it is simultaneously the only local
  answer to the volume question and the one place I may not look.
- **The Railway `web`, `worker` and `flow-worker` pods** — no production probe permitted;
  no `railway ssh`, `run`, `up`, `redeploy`, or `variables --set`. I ran no railway
  command at all, read-only ones included, since the contract did not name them.
- **`https://uctintelligence.com`** — not called. No health probe was needed for this
  mission.
- **The local backend on port 8077** — preamble says it may hold stale data against the
  live `C:\data`; not probed.
- **Partner-owned modules** (`OptionsFlow.jsx`, `schwab_router.py`,
  `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) — noted as
  existing and mounted in the flow family; deliberately not described at depth.
- **`external/morning-wire` and `external/uct-intelligence` submodules** in the dashboard
  worktree — per the preamble, the standalone repos were used instead.
- **Discord, Substack, YouTube, Zoom as live services** — no API was called. Everything
  about published content came from checked-in scrapes and code.
- **`uct-intelligence/data/uct_intelligence.pre_tsdr_import.bak`** (79,540,224 bytes,
  2026-08-27) — a pre-import backup of the KB. Not opened; it would show what the TSDR
  import added, which is a useful measurement someone should take.
