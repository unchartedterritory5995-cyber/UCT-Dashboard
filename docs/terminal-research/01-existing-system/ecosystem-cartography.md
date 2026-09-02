---
id: D-14
title: Ecosystem cartography — repositories, scheduled jobs, Railway topology, external surfaces
role: Multi-repository cartographer and scheduled-jobs mapper (both machines)
wave: 1
group: D
category: internal-system
scope: uct-intelligence · uct_intelligence (Discord bot) · morning-wire · uct-sunday-scan · services/chart_renderer · Windows Task Scheduler (owner PC) · Railway
confidence: 🟡 medium-high (scheduler + repo facts 🟢; Railway topology 🔴 — CLI unlinked)
evidence_ceiling: Railway CLI is not linked from the research worktree, so live service names, counts, variables and logs were NOT inspected; every Railway statement is derived from railway.json, code entrypoints and repo docs (CLAIM). No production endpoint was called.
sources: C:\Users\Patrick\uct-intelligence, C:\Users\Patrick\uct_intelligence, C:\Users\Patrick\morning-wire, C:\Users\Patrick\uct-sunday-scan, C:\Users\Patrick\uct-worktrees\terminal-research (railway.json, services/chart_renderer, api/routers/render_panels.py), Get-ScheduledTask/Get-ScheduledTaskInfo on the owner PC, C:\Users\Patrick\uct-worktrees\breadth-live\data\breadth_live_open_check.log, C:\Users\Patrick\uct-intelligence\logs\scanner_2026-09-01.log, C:\Users\Patrick\uct-intelligence\data\breadth_collector.log, C:\Users\Patrick\uct-recaps\insights_polish.log, C:\Users\Patrick\uct-intelligence\data\naaim_settle.log, C:\Users\Patrick\morning-wire\lab\flow_corpus
uct_relevance: high
status: draft
date: 2026-09-02
---

# Ecosystem cartography — beyond the dashboard

**Vocabulary reminder.** TERMINAL-CURRENT = the existing `/calendar` surface, display-named
"UCT Terminal" since 2026-09-01. TERMINAL-NEXT = the product this program designs. Nothing in
this report is about TERMINAL-CURRENT's internals (D-01..D-12 own those); this is the map of
everything *around* the dashboard that TERMINAL-NEXT would inherit.

## Method and evidence basis

* Repository facts come from reading the working trees directly, plus read-only
  `git -C <repo> log -3` / `git remote -v`. No repository was modified.
* Scheduler facts are **CONFIRMED** by `Get-ScheduledTask` + `Get-ScheduledTaskInfo` on the
  owner PC on 2026-09-02, including `Actions` (Execute/Arguments/WorkingDirectory), `Triggers`
  (StartBoundary/DaysOfWeek/Repetition), `LastRunTime`, `LastTaskResult`, `NextRunTime`, and
  `Settings` (ExecutionTimeLimit, battery flags). No task was started, stopped, registered,
  unregistered or modified.
* Where a scheduled job writes a log or an artifact, the log/artifact was read and is cited —
  that is what turns "a job is scheduled" (a CLAIM about behaviour) into "a job ran, and what it
  did" (**CONFIRMED**).
* **No production endpoint was called** and the Railway CLI was not linked. Every statement
  about the live Railway estate is a CLAIM derived from files.
* Secrets: only variable **names** appear below. No key, token or connection-string value was
  read into this report.

---

# §1 · Repository inventory

## 1.1 At a glance

| Repo (path) | Purpose | Git | Remote | HEAD (read-only `log -3`) | Tests | Reaches the dashboard by |
|---|---|---|---|---|---|---|
| `C:\Users\Patrick\uct-intelligence` | Trading **engine / knowledge base**: scanner, breadth collector, brain modes, UCT20 book, KB SQLite | repo, branch `master` | `github.com/unchartedterritory5995-cyber/uct-intelligence` | `7a99d0e` 2026-08-31 "feat(uct20): expose what the Book did with each NAME…" | 90 files in `tests/` | `POST /api/breadth-monitor/push`, `POST /api/push/intraday`, `POST /api/push/journal-export`; R2 brain pack |
| `C:\Users\Patrick\uct_intelligence` | **Discord bot** — RAG over #tsdr history, 7 slash commands | **NOT a git repo** (`.git` absent) | none | n/a | `tests/` holds only `__init__.py` | **No dashboard edge at all**; imports the engine by `sys.path` |
| `C:\Users\Patrick\morning-wire` | **Pre-market pipeline** — wire engine, Substack channel, wire critic, flow corpus, UCT20 refresh | repo, branch `master` | `github.com/unchartedterritory5995-cyber/morning-wire` | `7a597f4` 2026-08-31 "fix(tests): the suite was red every weekend…" | 127 files in `tests/` | `POST /api/push` + ~14 read endpoints; local Playwright against `/r/*` |
| `C:\Users\Patrick\uct-sunday-scan` | **Sunday Scan** Substack draft builder + watchdog | repo, branch `master`, **NO REMOTE CONFIGURED** | *(none — `git remote -v` is empty)* | `c3efb4d` 2026-08-18 "fix(promo): the $7 offer is one WEEK…" | 43 files in `tests/` | HTTP reads (`/api/bars`, `/api/calendar*`, `/api/breadth-monitor`) + local Playwright against `/r/chart`, `/r/breadth`, `/r/calendar`, `/r/internals` |
| `services/chart_renderer` (inside the dashboard worktree) | **Headless-Chromium screenshot service** (3 files) | tracked in the dashboard repo | dashboard remote | n/a | none in-service | It is *called by* the Railway `web` pod; it calls back to `CHART_RENDER_BASE_URL` |

**⚠️ Two repositories have no off-machine copy.** The Discord bot is not a git repository at all,
and `uct-sunday-scan` is a git repository with **no remote** — its history exists only on this
PC. Both CONFIRMED (`.git` absent for the bot; `git remote -v` returns nothing for sunday-scan).

## 1.2 `uct-intelligence` — the engine

**OBSERVATION.** Top level: `uct_intelligence/` (the importable package), `scripts/` (≈60 CLIs —
this is the real surface), `data/` (KB SQLite + JSON caches + logs), `tests/`, `prompts/`,
`analysis/`, `docs/`, `server/`, `Setups/`.

Package modules: `api.py`, `db.py`, `screener.py`, `scoring.py`, `risk.py`, `resolver.py`,
`levels.py`, `pattern_detector.py`, `ohlc_fetcher.py`, `massive_data.py`, `fmp_data.py`,
`ai_analysis.py`, `llm_models.py`, `psychology.py`, `sector_tiers.py`, `trigger_quality.py`,
`prose_lint.py`, `context.py`, `models.py`, plus `book/` and `harness/` subpackages.

Scheduled entry points (all CONFIRMED by scheduler actions, §2):
`scripts/autonomous_brain.py --mode {premarket,open,midday,preclose,postmarket}`,
`scripts/breadth_collector.py`, `scripts/market_ingest.py`, `scripts/market_monitor.py`,
`scripts/eod_updater.py`, `scripts/buyout_sweep.py`, `scripts/x_news_feed.py`,
`scripts/sync_book_bars.py`, `scripts/run_brain_pack_export.ps1` (wrapping
`scripts/brain_pack_export.py`), `scripts/run_naaim_settle.bat`.
Un-scheduled but load-bearing: **`scripts/scanner_candidates.py` is invoked in-process by the
morning-wire engine, not by a scheduled task** (see §2.4).

**Databases.** `data/uct_intelligence.db` — 82.7 MB, WAL, **32 tables**: `analysis_log,
analyst_changes, analyst_consensus, book_ledgers, book_plans, coaching_notes, confidence_scores,
earnings, earnings_analytics, economic_events, ep_candidates, ep_follow_throughs,
knowledge_base, leadership_snapshots, market_breadth, market_regimes, model_examples,
news_archive, peg_list, psychology_events, setup_performance, setup_templates, setup_triggers,
skill_assessments, ticker_metadata, trade_journal, trigger_performance, wire_issues,
wire_prompt_config, wire_universe, x_news_posts` (+ `sqlite_sequence`).
Second DB: `data/x_accounts.db` (1 table, `accounts`).
⚠️ There is also a **0-byte `uct_intelligence.db` at the repo root** (dated 2026-03-25) beside
the real 82.7 MB copy in `data/` — a decoy path for anyone who resolves the DB from the repo
root.

**Providers (CODE-REFERENCED; env var NAMES only).** `MASSIVE_API_KEY` / `MASSIVE_SECRET_KEY` /
`MASSIVE_ACCESS_KEY` (`uct_intelligence/massive_data.py`, `scripts/massive_flatfile_backfill.py`),
`FMP_API_KEY` (`uct_intelligence/fmp_data.py`), `FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`
(`uct_intelligence/ai_analysis.py`, `llm_models.py`), `PERPLEXITY_API_KEY`
(`scripts/buyout_sources.py`, `scripts/naaim_chatter.py`), `TWITTERAPI_IO_API_KEY`
(`scripts/x_news_feed.py`), `DATA_SYNC_REGION` (R2, `scripts/brain_pack_export.py`),
`DISCORD_SYSTEM_ALERTS_WEBHOOK_URL`, `PUSH_SECRET`, `DASHBOARD_URL`.
Unauthenticated/scraped sources reached directly: `cdn.cboe.com`, `www.cboe.com`,
`www.naaim.org` + `index.naaim.org`, `www.aaii.com`, `sec.gov`, `www.macrotrends.net`,
`www.barchart.com`, `edition.cnn.com` + `production.dataviz.cnn.io` (fear & greed),
`ycharts.com`, `www.youtube.com` (`scripts/youtube_scraper.py`), `x.com`
(`scripts/x_scraper.py`), Substack (`scripts/substack_scraper.py`).

**Outputs.** Writes the KB SQLite; `data/candidates.json` (atomic tmp→rename); pushes to the
dashboard at `POST /api/breadth-monitor/push` (`scripts/breadth_collector.py:48`),
`POST /api/push/intraday` (`scripts/autonomous_brain.py:137`), `POST /api/push/journal-export`;
uploads a **brain-pack tarball to R2** (`scripts/brain_pack_export.py`); posts to Discord via
`DISCORD_SYSTEM_ALERTS_WEBHOOK_URL` (`scripts/buyout_sweep.py`).

**⚠️ Cross-repo credential borrow.** `scripts/breadth_collector.py:40` calls
`load_dotenv(ROOT.parent / "morning-wire" / ".env")` — the engine reads the *morning-wire*
repo's `.env` for `PUSH_SECRET`. The two repos are coupled by a filesystem path, not by
configuration.

**EVIDENCE.** Paths above; `git -C uct-intelligence log -3` (CONFIRMED); table list read via
`sqlite3` in read-only immutable mode (CONFIRMED); `data/breadth_collector.log` last lines
`2026-09-01 15:39:52 INFO Push result: True (date=2026-09-01, keys=92)` /
`=== Breadth collector finished OK ===` (**CONFIRMED** — this repo pushed to production on
2026-09-01).
**INTERPRETATION.** The widest provider surface of the four repos, and the only one that scrapes
unauthenticated public sites at scale. Active production code, not dormant.
**RELEVANCE TO UCT.** Any TERMINAL-NEXT that wants regime, breadth, setup templates, book
ledgers or the KB inherits *this* database and *these* scrapers — the dashboard only ever sees
what this repo chooses to push.
**CONFIDENCE.** 🟢 for structure, DB and env names. 🟡 for provider *usage*: Massive/FMP/Finviz
are OBSERVED-CALLED via the 2026-09-01 scanner and breadth logs; the rest are CODE-REFERENCED
only. **EVIDENCE CEILING:** no provider dashboards or billing were reachable.
**RECOMMENDATION.** Treat the 32-table KB as a first-class asset with its own migration story
before TERMINAL-NEXT depends on it. Delete the 0-byte root-level decoy DB.
**OPEN QUESTION.** Which scraped public sites (CBOE, NAAIM, AAII, CNN, Barchart, Macrotrends,
YCharts) are load-bearing for a member-visible number today, and which are legacy?

## 1.3 `uct_intelligence` (underscore) — the Discord bot

**OBSERVATION.** ~3,770 lines across `bot/` (commands, listener, responder), `brain/`
(intelligence, retrieval, profile_builder, llm_models), `ingestion/` (parser, embedder,
message_classifier, ticker_extractor), `memory/` (episodic, semantic, procedural), `config/`
(settings + `config/prompts/`), `scripts/` (run_bot, ingest_history, build_profile, setup_db +
four ad-hoc `_test_phase*.py` scripts).

**Slash commands (7, CODE-REFERENCED, `bot/commands.py`):** `/recall` (:35), `/watchlist` (:55),
`/summary` (:76), `/ask` (:110), `/compare` (:130), `/status` (:150), `/save` (:214).
**`/buzz` and `/chart` are NOT here.** They are served by the **dashboard** at
`api/routers/discord_interactions.py` (Railway `web`), backed by `api/services/buzz_*.py`
(boards, extract, image, ingest, reply, store, universe) and `api/services/discord_chart_*.py`
(cache, context, hotset, house, prefs, render). Two Discord applications, two codebases — which
matches the standing note that registering `/buzz` needs the *other* app's token.

**Data store.** `lancedb` — 8 imports (`brain/intelligence.py:12`, `brain/retrieval.py:17`,
`ingestion/embedder.py:13`, `memory/episodic.py:13`, `scripts/ingest_history.py:32`,
`bot/commands.py:158`). `requirements.txt` pins `lancedb>=0.8.0`; **`chromadb` appears in no
import and in no requirement.** The on-disk store is `data/chromadb/episodic_messages.lance`.

**⚠️ CLAUDE.md CLAIM WORTH FLAGGING.** `uct_intelligence/CLAUDE.md` says *"`memory/` — Three-tier
memory system (episodic=ChromaDB, …)"*, and the settings key is `CHROMA_PERSIST_DIR`
(`config/settings.py:87,121`). The code is LanceDB. The **name survived a store migration in
three places** (doc, env var, directory name) while the implementation moved — the same
stale-name defect class the dashboard's own CLAUDE.md records for "ON THE TAPE". Anyone
provisioning this bot from its doc would install the wrong database.

**Providers.** `ANTHROPIC_API_KEY` is the only env var read in code. `.env` key names:
`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_TSDR`, `DISCORD_CHANNEL_INTELLIGENCE`,
`CHROMA_PERSIST_DIR`, `RAW_EXPORT_PATH`, `PROCESSED_DATA_PATH`. Embeddings run locally
(`sentence-transformers`), so there is no embedding-provider cost edge.

**How it reaches the dashboard: it does not.** No `/api/` call, no `DASHBOARD_URL`, no
`PUSH_SECRET`. Its only cross-system edge is
`sys.path.insert(0, r"C:\Users\Patrick\uct-intelligence")` + `import uct_intelligence.api as
uct_engine` — a **hard-coded absolute Windows path into a sibling repo**, documented in its own
CLAUDE.md under "Critical: Two Separate Projects".

**Is it running?** No `run_bot.py` process was present in the process table during this survey
(what *was* present: a stale local dashboard backend `python -m uvicorn api.main:app --port
8077`, and eleven orphaned `python -m http.server` processes on ports 8777/8099). There is **no
scheduled task for the bot** (§2) and no Railway entrypoint for it. **NOT DETERMINED** whether
it runs elsewhere.

**EVIDENCE.** Paths + line numbers above (CONFIRMED by reading); absence of `.git` (CONFIRMED);
absence from the scheduler listing (CONFIRMED); point-in-time process table (CONFIRMED).
**INTERPRETATION.** The **highest-risk component in the ecosystem**: unversioned, un-backed-up,
path-coupled to a sibling repo, documented against the wrong database, with no visible runner
and an effectively empty test directory.
**RELEVANCE TO UCT.** If TERMINAL-NEXT is to have a conversational or Discord-side surface, the
existing RAG-over-#tsdr work lives here and is currently unprotected. Losing this directory
loses the ingest pipeline, the trader-profile builder and the prompt corpus.
**CONFIDENCE.** 🟢 that it is not a git repo, uses LanceDB, and has no dashboard edge. 🟡 on its
runtime status. **EVIDENCE CEILING:** I cannot see other hosts; a `git init` + remote, or a
hosting record, would settle it.
**RECOMMENDATION.** `git init` + private remote before anything in this program touches it;
correct the ChromaDB→LanceDB claim in its CLAUDE.md at the same time; decide deliberately
whether its 7 commands are superseded by the dashboard-side Discord app.
**OPEN QUESTION.** Is this bot still serving members, or has the dashboard-side Discord
application (`/buzz`, `/chart`) superseded it entirely?

## 1.4 `morning-wire` — the pre-market pipeline

**OBSERVATION.** 52 Python modules at the repo root, plus `substack/` (44 modules — a complete
newsletter production system), `lab/` (backtest, flow-corpus export, snapshot), `api/` (four
`.js` files — legacy Vercel functions: `earnings.js`, `futures.js`, `quotes.js`, `snapshot.js`),
`parity/`, `tools/`, `ut/` (the HTML template), `scripts/`, and 127 test files.

**Entry points.**
* `run_morning_wire.bat` → `python -u pipeline.py`. `pipeline.py` retries
  `morning_wire_engine.py` up to `ENGINE_RETRIES=3` with `BACKOFF_SECONDS=180`, then runs
  `-m lab.snapshot` → `-m substack.run` → `-m substack.review`, each best-effort. The `.bat`
  sets `UCT20_BOOK_ENABLED=1` and its own comment names that line as the **rollback lever** for
  the UCT20 Book ledger.
* `run_wire_critic.bat` → `python -m wire_critic --run` (appends `logs/wire_critic.log`).
* `run_flow_corpus_snapshot.bat` → `python -u -m lab.export_flow_corpus --limit 5`.
* `scripts/refresh_uct20_portfolio_live.py` (scheduled directly; WD = repo root).
* Diagnostics/ad-hoc: `diag_earnings.py`, `diag_scorecard*.py`, `cockpit.py`, and **eight
  root-level `patch*.py` files** (`patch2.py`, `patch3.py`, `patch3 - Copy.py`, `patch_engine.py`,
  `patch_template.py`, `patch_layout.py`, `patch_calendar.py`, `patch_leadership2.py`) — one-shot
  migrations left in place. Deprecated clutter, not entry points.

**How it reaches the dashboard.** `morning_wire_engine.py:12425-12441` —
`POST {DASHBOARD_URL}/api/push` with a bearer `PUSH_SECRET`; skipped with a printed notice when
either is unset. It also **reads** the dashboard: `/api/r/catalysts`, `/api/r/earnings-history`,
`/api/catalysts/today-internal`, `/api/flow/data`, `/api/flow/top-conviction`, `/api/flow/dates`,
`/api/screener/analysts`, `/api/quote-of-the-day`, `/api/calendar`, `/api/caldata/{yyyymmdd}`,
`/api/ticker-search`, `/api/bars/{sym}`, `/api/wire-feedback/recent-internal`.
Two `DASHBOARD_URL` defaults coexist: `https://web-production-05cb6.up.railway.app`
(`scripts/patch_theses.py:13`) and `https://uctintelligence.com`
(`scripts/refresh_exposure_live.py:35-37`).

**Outputs.** `data/wire_data.json` + `morning_wire_state.json` (with four dated `.bak` copies);
Discord embeds (`send_discord.py`, `substack/alerts.py`; `DISCORD_WEBHOOK_URL`,
`DISCORD_SYSTEM_ALERTS_WEBHOOK_URL`, `DISCORD_ALERT_MENTION`); a **Substack draft** via
`substack/publisher.py` (`WIRE_SUBSTACK_PUBLISH_MODE` defaults to `"draft"`, `publisher.py:425`)
gated by `WIRE_SUBSTACK_ENABLED` (`substack/run.py:308`) and reviewed under
`WIRE_SUBSTACK_GATE_MODE` (default `"strict"`, `substack/review.py:521,592`); Whop promo links;
`lab/flow_corpus/*.csv.gz` archives.

**Providers (env NAMES).** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (cover art:
`substack/cover_art.py`, `cover_image.py`, `earnings_growth.py`), `PERPLEXITY_API_KEY`
(`perplexity_research.py`, `analyst_feed.py`, `wire_claims.py`, `news_aggregator.py`),
`FINNHUB_API_KEY`, `FINVIZ_API_KEY` (`finviz_client.py` → `elite.finviz.com`), `FMP_API_KEY`,
`MASSIVE_API_KEY`, `ALPHAVANTAGE_API_KEY`, `TWITTERAPI_IO_API_KEY`, `UW_API_KEY`,
`CHART_RENDER_TOKEN`, `SUBSTACK_PUBLICATION_URL`, `PUSH_SECRET`, `DASHBOARD_URL`, `UCT_BARS_DB`,
`UCT_INTELLIGENCE_PATH`, plus **legacy `VERCEL_TOKEN` / `VERCEL_PROJECT_NAME` /
`VERCEL_SITE_URL`** — the four `api/*.js` files are the matching artefact, while
`morning_wire_engine.py:12443` states deployment is Railway-only.
Hosts reached: `elite.finviz.com`, `finviz.com`, `finnhub.io`, `financialmodelingprep.com`,
`api.anthropic.com`, `www.earningswhispers.com`, `finance.yahoo.com`, `www.alphavantage.co`,
`seekingalpha.com`, `www.benzinga.com`, `feeds.marketwatch.com`, `search.cnbc.com`,
`www.prnewswire.com`, `www.fool.com`, `discord.com`, `substack.com`, `whop.com`,
`www.tradingview.com`, `x.com`.

**⚠️ CLAUDE.md CLAIMS WORTH FLAGGING** (`morning-wire/CLAUDE.md`):
* *"Each weekday at **7:35 AM ET**"* — the registered trigger is **06:35 local CT** (§2), which
  is 07:35 ET *in daylight time only*. The doc states the ET intent; the task stores a CT clock.
* *"Target: ~7.7 minutes from trigger to Discord delivery (as of 2026-03-09)"* — on 2026-09-01
  the inline scanner block alone took **211.6 s** (`logs/scanner_2026-09-01.log`) and the run
  finished at 06:45 (log mtimes) — ~10 minutes. The 7.7-minute figure predates the inline
  scanner and should not be used for headroom planning.
* *"Known Limitations"* (CBOE 403, Finnhub economic calendar 403, AAII/NAAIM scrape failures)
  remains consistent with what the engine repo scrapes.

**EVIDENCE.** File paths and line numbers above (CONFIRMED by reading);
`logs/{run,snapshot,substack,review}.log` all mtime 2026-09-01 06:45–06:49 → the whole pipeline,
including the Substack step, **ran on 2026-09-01** (CONFIRMED).
**INTERPRETATION.** Active production code, the busiest integration surface in the ecosystem,
and the only repo that both pushes to and reads from the dashboard.
**RELEVANCE TO UCT.** TERMINAL-NEXT inherits `/api/push` as a contract — the dashboard's wire
data is a whole-payload replace from this repo — and ~14 dashboard read endpoints are
effectively a private API for it. Any route rename breaks an unattended 06:35 pre-market
pipeline.
**CONFIDENCE.** 🟢.
**RECOMMENDATION.** Treat the 14 read endpoints + `/api/push` as a versioned internal contract
before TERMINAL-NEXT reshapes routes. Move the eight root `patch*.py` files and the four Vercel
`api/*.js` files into `legacy/` so the entry-point surface is legible.
**OPEN QUESTION.** Is `WIRE_SUBSTACK_ENABLED` set in the environment the scheduled task runs
under? The `.bat` does not set it and the code default is off, yet `logs/substack.log` was
written on 2026-09-01 — so either it is set at user/machine scope, or the module ran and exited
at its gate.

## 1.5 `uct-sunday-scan`

**OBSERVATION.** One package, `sunday_scan/`, 25 modules: `run.py` (`--phase A`), `watchdog.py`,
`compose.py`, `panels.py`, `charts.py`, `picks.py`, `breadth_data.py`, `calendar_data.py`,
`session_calendar.py`, `corpus.py`, `facts.py`, `roster.py`, `anchors.py`, `etf_walk.py`,
`bars.py`, `prep_sheet.py`, `promo.py`, `publish.py`, `preflight.py`, `state.py`, `config.py`,
`contracts.py`, `bracco.py`, `boilerplate.py`, `assets/`. Plus `register_sunday_scan_task.ps1`,
`run_sunday_scan.bat`, `docs/{plans,specs}`, 43 test files, `pytest.ini`.

**Entry points.** `run_sunday_scan.bat` → `python -m sunday_scan.run --phase A`, logging to
`%LOCALAPPDATA%\uct\sunday_scan\logs\run_last.log` (overwritten each run — per-week history
lives in `state.json` / `heartbeat.json`). Watchdog: `python -m sunday_scan.watchdog`.

**How it reaches the dashboard.** Read-only HTTP plus a **local** headless browser against the
dashboard's token-gated render routes: `/r/chart` (`sunday_scan/charts.py::chart_url`),
`/r/breadth`, `/r/calendar`, `/r/internals`, `/api/r/breadth-monitor`, `/api/r/calendar-week`,
and data endpoints `/api/bars`, `/api/calendar`, `/api/calendar/month`, `/api/ticker-meta/{sym}`,
`/api/breadth-monitor`. Auth is `CHART_RENDER_TOKEN` as a **query parameter** (`config.py:47`;
`charts.py:103-104`; `panels.py:255,319`; `breadth_data.py:102`).
⭐ `charts.py:66-70` encodes a rail worth copying: `"unauthorized"` is classified as a **global**
fault (a property of the run, not the symbol), so a bad token stops the pass instead of failing
33 symbols identically.

**Outputs.** A **Substack DRAFT** (never an auto-publish — a hard rule in its CLAUDE.md); Discord
posts via `SUNDAY_SCAN_WEBHOOK_URL` and `SUNDAY_SCAN_BRACCO_WEBHOOK_URL` (+
`BRACCO_DISCORD_USER_ID`); Whop promo copy; local state under `SUNDAY_SCAN_STATE_DIR`. It
**imports morning-wire read-only** (`MORNING_WIRE_ROOT` →
`substack/{publisher,session,alerts,config}`).

**⚠️ CLAUDE.md CLAIMS WORTH FLAGGING — unusually good; preserve them verbatim into any
TERMINAL-NEXT rewrite:**
* *"Never edit `C:\Users\Patrick\morning-wire`."* — a cross-repo ownership rule enforced socially,
  not mechanically.
* *"This package never auto-publishes. It creates a DRAFT. The owner publishes."*
* *"The sibling scanner emitted 100% NO_DATA for five weeks while its health check read green.
  Every serious bug found here has been the same shape: reports success, ships nothing."*
* *"Bracco's words are verbatim — `bracco.render()` asserts word-count-out == word-count-in."*
* *"Price model is ANCHOR CONFLUENCE, never entry/stop/target."*

**EVIDENCE.** Paths/line numbers above; `git remote -v` empty (CONFIRMED); scheduler entries (§2)
CONFIRM the Friday/Saturday cadence and exit 0 on 2026-08-28 / 2026-08-29.
**INTERPRETATION.** Active, weekly, well-railed, and the only repo whose entire design centre is
"do not report success while shipping nothing."
**RELEVANCE TO UCT.** It is the best existing evidence of what the `/r/*` render routes are
worth: an external producer consuming the dashboard as an image API. TERMINAL-NEXT must assume
the `/r/*` contract has out-of-repo consumers.
**CONFIDENCE.** 🟢.
**RECOMMENDATION.** Add a git remote. Consider moving `CHART_RENDER_TOKEN` out of the query
string (it lands in access logs) if `/r/*` survives into TERMINAL-NEXT.
**OPEN QUESTION.** The task named "Sunday Scan" fires **Friday 17:30** (§2). Almost certainly by
design — build Friday, publish Sunday — but name and schedule disagree, which is the exact drift
class this program audits.

## 1.6 `services/chart_renderer`

See §5 — it is a Railway service, not a standalone repo.

## 1.7 Submodules

`.gitmodules` declares `external/morning-wire` and `external/uct-intelligence`, both pointing at
the GitHub remotes above. **In this worktree both directories are EMPTY (0 entries)** —
CONFIRMED. The dashboard's own CLAUDE.md states the submodule path is not used at runtime
(`api/services/engine.py` resolves morning-wire as `../../../morning-wire`, outside the repo, and
uses `UCT_INTEL_PATH` for the engine). The submodules are therefore a Claude-visibility
convenience that is currently **unpopulated** — do not read them, and do not assume a downstream
synthesis agent can.

## 1.8 Auxiliary code the scheduler depends on (outside this contract's repo list, but load-bearing)

| Path | Git | What the scheduler runs from it | Risk |
|---|---|---|---|
| `C:\Users\Patrick\uct-clips` | repo, `master`, `9f05bfc` 2026-08-28 | `run_clips_daily.bat`, `run_clips_poll.bat` via `wscript run_hidden.vbs` | own `clips.db`, `config.json`; remote NOT checked |
| `C:\Users\Patrick\uct-recaps` | **not a git repo** | `run_daily.ps1` (Live Recap ×3/day), `run_insights_polish.ps1` (every 20 min, 16 h/day) | **third unversioned codebase**; holds `posted.json`, `polished.json` |
| `C:\Users\Patrick\uct-worktrees\breadth-live` | dashboard worktree, `feat/breadth-live`, HEAD `7df8d6d1c` **2026-08-08** | 4 monitor tasks run `tools/breadth_live_*_check.py` | monitors production from a branch ~3.5 weeks stale; reads `C:\Users\Patrick\uct-dashboard\.env` |
| `C:\Users\Patrick\uct-worktrees\desk-creative` | dashboard worktree, `feat/desk-creative`, HEAD `1f648578f` **2026-08-20** | `UCT Desk Creative Watch` runs `tools/desk_creative_watch.py` weekdays | monitors production from a stale feature branch |
| `C:\Users\Patrick\uct-dashboard` (the **parked/stale** default checkout) | present | `UCT Warm Bars Universe` runs `scripts/trigger_warm_universe.py --poll` **daily 01:00** | a live daily job executes from the checkout everyone is told never to use |
| `C:\Users\Patrick\uct-dashboard\.worktrees\coverage-blanks` | dashboard worktree | `UCT Post-Close Check` (one-shot 2026-08-10, no next run) | leftover |

**OBSERVATION.** **Nine of the 34 UCT scheduled tasks execute code that lives outside the four
repositories this contract names** — in two unversioned directories, two stale feature worktrees,
and the parked checkout.
**EVIDENCE.** Scheduler `Actions` (CONFIRMED) plus `git rev-parse --abbrev-ref HEAD` / `log -1`
per path (CONFIRMED).
**INTERPRETATION.** The system map is not four repos; it is **six code locations plus three
worktrees**, and the scheduler is the only artefact that records which is which.
**RELEVANCE TO UCT.** A TERMINAL-NEXT system map (gate item 2) listing four repos would be wrong
by nine jobs. Worse: a monitor pinned to a stale branch keeps asserting a shape the product no
longer has — and three of these four monitors are currently failing (§2.5).
**CONFIDENCE.** 🟢.
**RECOMMENDATION.** Promote the `breadth-live` / `desk-creative` monitor tooling to `master` and
repoint the tasks, or retire the tasks. Put `uct-recaps` under version control.
**OPEN QUESTION.** Does `uct-clips` have a remote (not checked), and does `uct-recaps` hold state
that is not reproducible?

---

# §2 · Windows Task Scheduler on the owner PC (CONFIRMED)

## 2.1 Headline numbers

* **233 scheduled tasks total** on the machine; **34** have names beginning `UCT`. Every other
  root-path task is vendor noise (NVIDIA ×10, OneDrive ×3, Zoom updater ×1).
* All 34 UCT tasks are **enabled**; all report `State = 3` (Ready).
* **All Start Times are LOCAL = Central Time.** Market-relative reasoning must add one hour for
  ET (during daylight time).
* Full table in **Appendix A**.

## 2.2 Producers vs monitors

| Class | Count | Tasks |
|---|---|---|
| **Producers** (write data, publish, or push) | 21 | 5× Brain modes, Brain Pack Export, Breadth Collector, Buyout Sweep, Clips daily build, Clips approval poll, Desk Insights Polish, EOD Updater, Flow Corpus Snapshot ×2, Live Recap, Market Ingest, Market Monitor, Morning Wire, NAAIM Settle, Sunday Scan, Warm Bars Universe, Wire Critic, X News Feed, UCT20 Book Bars Sync, UCT20 Portfolio EOD Refresh |
| **Monitors / checks / watchdogs** | 7 | Breadth Live PreOpen/Open/Session/Visual Check, Desk Creative Watch, Sunday Scan Watchdog, (+ Post-Close Check, expired) |
| **Expired one-shots** (no `NextRunTime`) | 3 | Breadth PostShip Check OPEN, Breadth PostShip Check OPEN+20, Post-Close Check |

## 2.3 Task → repository map

| Repository / location | Tasks |
|---|---|
| `uct-intelligence` | Brain Pre-Market, Brain Open, Brain Midday, Brain Pre-Close, Brain Post-Market, Brain Pack Export, Breadth Collector, Buyout Sweep, EOD Updater, Market Ingest, Market Monitor, NAAIM Settle, X News Feed, UCT20 Book Bars Sync — **14** |
| `morning-wire` | Morning Wire, Wire Critic, Flow Corpus Snapshot, Flow Corpus Snapshot AM, UCT20 Portfolio EOD Refresh — **5** |
| `uct-sunday-scan` | Sunday Scan, Sunday Scan Watchdog — **2** |
| `uct-clips` | Clips approval poll, Clips daily build and queue — **2** |
| `uct-recaps` | Live Recap, Desk Insights Polish — **2** |
| `uct-worktrees\breadth-live` (stale branch) | Breadth Live PreOpen/Open/Session/Visual Check, Breadth PostShip Check OPEN, OPEN+20 — **6** |
| `uct-worktrees\desk-creative` (stale branch) | Desk Creative Watch — **1** |
| `uct-dashboard` (parked checkout) | Warm Bars Universe, Post-Close Check — **2** |
| **Discord bot (`uct_intelligence`)** | **0 — the bot has no scheduled task at all** |

## 2.4 Delta against OWNER_SEED_FACTS §2

The seed facts list ~10 jobs. Measured against the scheduler:

| Seed fact | Verdict | Evidence |
|---|---|---|
| morning_wire 6:35a CT | ✅ CONFIRMED | `UCT Morning Wire`, Mon–Fri 06:35, `cmd /c …\run_morning_wire.bat`, last 2026-09-01 rc 0 |
| wire_critic 5:00a | ✅ CONFIRMED | `UCT Wire Critic`, Mon–Fri 05:00, rc 0 |
| breadth_collector 3:15p (=4:15 ET) | ✅ CONFIRMED | `UCT Breadth Collector`, Mon–Fri 15:15; log shows finish 15:39:52, push OK, 92 keys |
| UCT20 EOD 3:20p | ✅ CONFIRMED | `UCT20 Portfolio EOD Refresh`, Mon–Fri 15:20, rc 0 |
| brain pre-close 3:30p | ✅ CONFIRMED | `UCT Brain Pre-Close`, Mon–Fri 15:30 trigger, rc 0 |
| eod_updater 4:05p | ✅ CONFIRMED | `UCT EOD Updater`, Mon–Fri 16:05, rc 0 |
| market_ingest 8:05p | ✅ CONFIRMED | `UCT Market Ingest`, Mon–Fri 20:05, rc 0 |
| 5×/day brain | ✅ CONFIRMED | exactly five `autonomous_brain.py --mode` tasks (premarket/open/midday/preclose/postmarket). A sixth `UCT Brain *` task exists but is the **pack exporter**, a different script |
| **scanner 7:00a** | ❌ **MISMATCH** | **There is no scanner task.** The 07:00 CT slot belongs to `UCT Market Monitor` (`scripts/market_monitor.py`). The scanner runs **in-process inside the morning wire**: `logs/scanner_2026-09-01.log` records `06:42:03 candidates.json written atomically` and `Scanner complete … runtime=211.6s`, and `data/candidates.json` has mtime 2026-09-01 06:42 — inside the 06:35 wire window, not at 07:00 |

**Delta:** 8 of 9 seed items confirmed, 1 misattributed, and **26 scheduled tasks are not in the
seed list at all** — including everything driving Clips, Live Recap, Desk Insights Polish, the
flow corpus archive, NAAIM settlement, buyout sweeps, X news, the UCT20 book bars sync, and all
seven monitors.

**RELEVANCE TO UCT.** The owner's mental model of the scheduler is ~30% of what is registered.
Any TERMINAL-NEXT plan that assumes "about ten nightly jobs" is sizing against a third of the
real surface, and the un-listed two-thirds includes every monitor.

## 2.5 🔴 Four scheduled jobs are failing, and the failures are silent

These are the highest-value findings in this report. All four are **CONFIRMED by artifacts**, not
by exit codes alone.

### (a) Flow Corpus Snapshot — producing nothing since 2026-08-09

**OBSERVATION.** `UCT Flow Corpus Snapshot` (daily 20:15) and `UCT Flow Corpus Snapshot AM`
(daily 06:00) both report `LastTaskResult = 1` on their 2026-09-01 runs. The output directory
`C:\Users\Patrick\morning-wire\lab\flow_corpus\` holds 192 files, but the **newest session file
is `flow_2026-08-07.csv.gz` (written 2026-08-07 20:15)** and `manifest.json` was last written
**2026-08-09 06:00**.
**EVIDENCE.** Scheduler `LastTaskResult` (CONFIRMED); directory listing with mtimes (CONFIRMED);
`run_flow_corpus_snapshot.bat` comment header (CLAIM, but a precise one): *"Massive OPRA does not
replay… History is unrecoverable once gone — this job is the only thing standing between us and a
permanently un-backtestable dataset."*
**INTERPRETATION.** ~17 trading sessions of full options-flow tape (2026-08-10 → 2026-09-01) have
been **permanently lost**, and the job has announced that loss twice a day for three weeks with
nothing reading the exit code. This is the repo's own documented failure shape — *reports
success, ships nothing* — inverted: it reports failure, and nobody is listening.
**RELEVANCE TO UCT.** If TERMINAL-NEXT includes any flow-based product (scoreboard, backtest,
conviction ranking), its training/validation corpus has a three-week hole that cannot be
backfilled.
**CONFIDENCE.** 🟢 that nothing has been written since 2026-08-09. 🟡 on the cause — the exit code
is 1 but the `.bat` writes no log file and Task Scheduler captures no console output.
**EVIDENCE CEILING:** running the exporter would determine the cause; the contract forbids
touching production, and this exporter calls `https://uctintelligence.com`, so it was not run.
**RECOMMENDATION.** Highest-priority operational fix in this report. Add a log redirect to the
`.bat` (the sunday-scan `.bat` already shows the pattern) and an alert on nonzero exit.
**OPEN QUESTION.** Did the flow-worker cutover, an auth change, or a `FLOW_CSV_CAP_*` change
break the single-date export path on ~2026-08-08?

### (b) Breadth Live checks — a monitor that has been unable to check for 23 days

**OBSERVATION.** `UCT Breadth Live PreOpen/Open/Session Check` all report `LastTaskResult = 2`.
The tool's own docstring defines the contract: *"Exit code is the verdict: 0 clean, 1 problems
found, **2 could not check**."* Its log
(`uct-worktrees\breadth-live\data\breadth_live_open_check.log`) contains **52 occurrences of
`✗ check itself failed: HTTPError: HTTP Error 401: Unauthorized`**, the first on **2026-08-10
09:08 ET**, the most recent on **2026-09-01 10:34 ET**, across 96 recorded runs since 2026-08-05.
**EVIDENCE.** Log lines quoted above (CONFIRMED); exit-code semantics from the tool's own module
docstring (`tools/breadth_live_open_check.py:1-27`).
**INTERPRETATION.** The monitor built specifically so that *"the durable half runs from Task
Scheduler and shouts on Discord only when something is actually wrong"* has been unable to
authenticate since 2026-08-10 — so it can shout about nothing. Note the credential path: it loads
`.env` from `C:\Users\Patrick\uct-dashboard\.env`, i.e. the **parked checkout**.
**RELEVANCE TO UCT.** This is `lesson_gate_that_cannot_fail` in the field: a green-by-absence
monitor. Any TERMINAL-NEXT monitoring design must distinguish "checked and clean" from "could not
check" **in the alerting channel**, not merely in the exit code.
**CONFIDENCE.** 🟢.
**RECOMMENDATION.** Make "could not check" (exit 2) alert as loudly as "problem found" (exit 1),
and repoint the credential to a maintained location.
**OPEN QUESTION.** Is the 401 a stale token in the parked checkout's `.env`, or did the endpoint's
auth requirement change on ~2026-08-10?

### (c) Breadth Live Visual Check — reporting a real defect 30 times, unheard

**OBSERVATION.** `UCT Breadth Live Visual Check` reports `LastTaskResult = 1` ("problems found").
Its log records, on 2026-09-01 and on 29 earlier runs:
`FAIL [phone390] Data Charts never mounted a chart` and `FAIL [desktop] Data Charts never mounted
a chart`, with `charts: {'mounted': False, 'size': None, 'canvas': 0}` on both viewports.
**EVIDENCE.** Log lines (CONFIRMED); 30 occurrences of the string counted.
**INTERPRETATION.** Unlike (b), this check *can* run and *is* finding something: the Breadth Data
Charts tab renders no chart at either viewport under the harness. Whether that is a product defect
or a harness artifact (a stale `feat/breadth-live` branch driving a moved selector) is
**NOT DETERMINED** — and that ambiguity is itself the finding: a monitor pinned to a 3.5-week-old
branch cannot distinguish "the product broke" from "my selector moved."
**RELEVANCE TO UCT.** Directly relevant to the mobile/touch-tier work already in flight — this may
be an existing, unnoticed member-visible defect on the Breadth Data Charts tab.
**CONFIDENCE.** 🟡 (the failure is confirmed; its cause is not).
**RECOMMENDATION.** Hand this to whichever agent owns Breadth/Data Charts: open
`/breadth` → Data Charts at 390 px and 1200 px and count canvases. That single check settles it.
**OPEN QUESTION.** Product defect or stale-branch selector drift?

### (d) NAAIM Settle — crashing on an unexpected response shape

**OBSERVATION.** `UCT NAAIM Settle` (Thu+Fri, from 14:00, repeating every 2 h for 20 h) reports
`LastTaskResult = 1`, last run 2026-08-29. Its log ends:
`NAAIM public feed: 130 readings, newest 2026-05-20 (82.02) … 101d behind today` followed by
`Traceback … scripts/naaim_backfill.py line 184 … requests.get(f"{BASE}/api/breadth-monitor?days=…").json()["rows"]` →
`KeyError: 'rows'`.
**EVIDENCE.** `data/naaim_settle.log` tail (CONFIRMED).
**INTERPRETATION.** Two distinct problems stacked: the public NAAIM feed is ~101 days stale, and
the settle script assumes `/api/breadth-monitor` returns a `rows` key, then dies on
`KeyError` when it does not (an error page, an auth failure, or a shape change would all present
identically). `.json()["rows"]` with no guard is the same class as
`.catch(() => null)` rendering failure as fact.
**RELEVANCE TO UCT.** A dashboard read contract (`/api/breadth-monitor` → `rows`) has an
out-of-repo consumer that crashes on drift. Add it to the internal-contract list from §1.4.
**CONFIDENCE.** 🟢 on the crash; 🟡 on which of the three causes produced the missing key.
**RECOMMENDATION.** Guard the response shape and report the status code; separately, decide
whether the NAAIM public feed is still a viable source at 101 days stale.
**OPEN QUESTION.** Is the NAAIM sentiment column on the breadth monitor currently carrying a
stale-but-unlabelled value as a result?

### (e) Two jobs terminated rather than failed

`UCT Market Monitor` and `UCT Brain Pack Export` both report `LastTaskResult = 3221225786`
(`0xC000013A`, STATUS_CONTROL_C_EXIT) — the code Windows records when a task is **terminated**
rather than exiting on its own. Both are plausible battery/idle terminations:
`UCT Brain Pack Export` has `DisallowStartIfOnBatteries = True` **and**
`StopIfGoingOnBatteries = True` — the exact setting pair this ecosystem's own notes record as
having silently killed the breadth collector for weeks. `UCT Flow Corpus Snapshot` (both copies)
carries the same battery pair.
**CONFIDENCE.** 🟡 — the exit code is confirmed; attributing it to battery specifically is
inference. **RECOMMENDATION.** Clear both battery flags on all producer jobs, as
`register_sunday_scan_task.ps1` already does deliberately (`-AllowStartIfOnBatteries
-DontStopIfGoingOnBatteries`, with a comment naming the past incident).

## 2.6 Trigger-boundary convention is mixed (observation, not yet a defect)

Some tasks carry a **fixed UTC offset** in `StartBoundary` (e.g. `UCT Brain Midday`
`2026-02-23T13:00:00-05:00`); others are **floating local** (e.g. `UCT Breadth Collector`
`2026-03-16T15:15:00`, `UCT Brain Pack Export` `2026-07-02T21:00:00`, `UCT EOD Updater`,
`UCT Market Ingest`, `UCT Wire Critic`). `register_sunday_scan_task.ps1` states the intended
convention explicitly: *"StartBoundary is LOCAL and floating: it follows DST rather than drifting
an hour twice a year."*

A correlated artefact: every fixed-offset task reports a `LastRunTime` exactly **one hour before**
its `NextRunTime` clock time (Brain Midday last 12:00 / next 13:00; Brain Open 09:45 / 10:45;
Brain Pre-Close 14:30 / 15:30; Brain Post-Market 20:30 / 21:30; Brain Pre-Market 07:30 / 08:30;
Market Monitor 06:00 / 07:00), while every floating-boundary task reports last == next
(Breadth Collector 15:15 / 15:15; EOD Updater 16:05 / 16:05; Market Ingest 20:05 / 20:05;
Wire Critic 05:00 / 05:00).

**INTERPRETATION.** Two candidate explanations: (i) a DST/offset reporting artifact in
`Get-ScheduledTaskInfo.LastRunTime` — the likelier reading, since `NextRunTime` is computed by
the scheduler itself and says 13:00; or (ii) the fixed-offset jobs genuinely fired an hour early
relative to the market. **NOT DETERMINED.**
**What would determine it:** a timestamped line from any `autonomous_brain.py` run.
`scripts/autonomous_brain.py` writes no dated log I could find; the breadth collector (floating
boundary) *does* log timestamps and shows no discrepancy, which is consistent with (i) but does
not prove it. The dashboard's receipt for `POST /api/push/intraday` would settle it in one read.
**CONFIDENCE.** 🟡 on the pattern (measured), 🔴 on the cause.
**RECOMMENDATION.** Regardless of cause, standardise on floating local boundaries (the
sunday-scan convention), and give `autonomous_brain.py` a timestamped log line — five brain
modes/day currently produce no local evidence that they ran.

---

# §3 · Railway topology

**OBSERVATION — from `railway.json` (the one file all services share).** The `startCommand` is a
**four-way dispatcher**:

```
BARS_API_ENABLED=1   -> exec python -m api.bars_api_main
FLOW_WORKER_ENABLED=1 -> exec python -m api.flow_worker_main
WORKER_ENABLED=1      -> exec python -m api.worker_main
else                  -> exec uvicorn api.main:app … --timeout-graceful-shutdown 5
```
with `healthcheckPath: /api/health`, `healthcheckTimeout: 600`, `drainingSeconds: 30`,
`restartPolicyType: ALWAYS`.

All four entrypoints exist: `api/main.py`, `api/worker_main.py`, `api/flow_worker_main.py`,
`api/bars_api_main.py`. Plus `services/chart_renderer` deploys from its **own Dockerfile**, so it
is a fifth Railway service.

| Service (inferred) | Selector | Role | Evidence |
|---|---|---|---|
| `web` | default branch | uvicorn `api.main:app`; serves the SPA, all `/api/*`, the scheduler, Discord interactions, buzz, all member traffic | `railway.json`; 54 `--service web` references in dashboard docs |
| `worker` | `WORKER_ENABLED=1` | bars pre-warmer + periodic R2 `/data` snapshot uploader; exposes `/internal/health` + an `/api/health` alias so the shared healthcheck path works; **never serves user requests** | `api/worker_main.py:1-18` |
| `flow-worker` | `FLOW_WORKER_ENABLED=1` | Massive OPRA WS consumer + `flow.db` + T+1 flat-file ingest, gap-fill, R2 backup, nightly prune | `railway.json`; 11 `--service flow-worker` doc references |
| **`bars-api`** | `BARS_API_ENABLED=1` | **NEW, dated 2026-09-02 in its own docstring** — a dedicated bars-SERVING tier so app/partner deploys can never restart chart serving. Serves only `/api/bars` + `/api/bars-history` from an R2-synced `bars.db`; runs no warmers, no Massive WS, no reconciliation | `api/bars_api_main.py:1-25` |
| `chart-renderer` | own Dockerfile | Playwright screenshot service (§5) | `services/chart_renderer/Dockerfile` |

**⚠️ The program's own framing says "three services."** Code says **four dispatcher branches plus
a Dockerfile service = five**. `bars-api` is one day old (2026-09-02) and its docstring says its
Railway watch paths still need narrowing ("once its Railway watch paths are narrowed"), which
reads as *not yet fully provisioned*.

**Which PC jobs call which Railway endpoints** (all CODE-REFERENCED; §2 CONFIRMS the jobs run):

| PC job | Railway endpoint(s) | Direction |
|---|---|---|
| `UCT Morning Wire` | `POST /api/push` (write); `/api/r/catalysts`, `/api/r/earnings-history`, `/api/catalysts/today-internal`, `/api/flow/{data,top-conviction,dates}`, `/api/screener/analysts`, `/api/quote-of-the-day`, `/api/calendar`, `/api/caldata/{ymd}`, `/api/ticker-search`, `/api/bars/{sym}`, `/api/wire-feedback/recent-internal` (read) | both |
| `UCT Breadth Collector` | `POST /api/breadth-monitor/push` | write |
| `UCT Brain *` (5 modes) | `POST /api/push/intraday` | write |
| `UCT Brain Pack Export` | R2 (`brain/latest.txt` + `brain/<ts>.tar.gz`), consumed by web at boot | write (via R2) |
| `UCT Flow Corpus Snapshot ×2` | `GET /api/flow/data?…` single-date | read |
| `UCT Sunday Scan` | `/r/chart`, `/r/breadth`, `/r/calendar`, `/r/internals`, `/api/r/*`, `/api/bars`, `/api/calendar*`, `/api/breadth-monitor`, `/api/ticker-meta/{sym}` | read |
| `UCT Breadth Live *Check` | dashboard breadth/live endpoints (currently 401) | read |
| `UCT Desk Insights Polish` | `GET /api/desk/insights-status` (+ polish writes) | both |
| `UCT Warm Bars Universe` | `scripts/trigger_warm_universe.py --poll` against the dashboard | write-trigger |
| `UCT NAAIM Settle` | `GET /api/breadth-monitor?days=N` | read |
| `UCT20 Portfolio EOD Refresh` | dashboard push path via morning-wire helpers | write |

**EVIDENCE.** `railway.json` (CONFIRMED, read); entrypoint docstrings (CONFIRMED, read);
`railway status` / `railway service` from the research worktree both return
**"No linked project found. Run railway link to connect to a project"** (CONFIRMED) — and the
contract forbids `railway link`.
**INTERPRETATION.** The deployment estate is one repo → four runtime personalities selected by
env var, plus one Dockerfile service. That single shared `railway.json` is why the notes warn
that watch patterns must be set per-service in the dashboard.
**RELEVANCE TO UCT.** TERMINAL-NEXT would be the **sixth** thing deployed from this arrangement,
or would need its own. The `bars-api` split is direct evidence of the pressure TERMINAL-NEXT will
face: chart serving already had to be pulled out of `web` to survive deploys.
**CONFIDENCE.** 🟢 on the file-level topology; **🔴 on the live estate**.
**EVIDENCE CEILING:** service names, replica counts, live variables, healthcheck wiring, deploy
history and logs are all **NOT INSPECTED** — the CLI is unlinked and linking is forbidden. A
single `railway status` from an already-linked shell (or `railway variables --json` piped to
print key names only, in a contract that permits it) would raise this to 🟢.
**RECOMMENDATION.** Do not let a synthesis document state "three Railway services"; state five,
with `bars-api` marked *new / provisioning*.
**OPEN QUESTION.** Is `bars-api` actually deployed and serving, or is it code-complete and
awaiting its own watch paths?

---

# §4 · External surfaces and integrations

| Surface | Driven from (repo · path) | Credential NAME(s) | Status |
|---|---|---|---|
| **Discord — bot app (7 commands)** | `uct_intelligence` · `bot/commands.py`, `bot/listener.py`, `scripts/run_bot.py` | `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_TSDR`, `DISCORD_CHANNEL_INTELLIGENCE` | CODE-REFERENCED. **No scheduled task, no Railway entrypoint, no process observed** — runtime NOT DETERMINED |
| **Discord — dashboard app (`/chart`, `/buzz`)** | dashboard · `api/routers/discord_interactions.py`, `api/services/buzz_*.py`, `api/services/discord_chart_*.py` | (dashboard-side) | CODE-REFERENCED here; D-01..D-12 own the depth. `docs/runbooks/buzz-activation.md` exists |
| **Discord — webhooks (alerts, system, TSDR, Sunday Scan, Bracco, COT weekly)** | `morning-wire` (`send_discord.py`, `substack/alerts.py`), `uct-intelligence` (`scripts/buyout_sweep.py`), `uct-sunday-scan` (`sunday_scan/bracco.py`, `publish.py`), dashboard (`discord_notify.py`, `discord_relay.py`, `discord_index_close.py`, `discord_close_note.py`) | `DISCORD_WEBHOOK_URL`, `DISCORD_SYSTEM_ALERTS_WEBHOOK_URL`, `DISCORD_ALERT_MENTION`, `SUNDAY_SCAN_WEBHOOK_URL`, `SUNDAY_SCAN_BRACCO_WEBHOOK_URL`, `BRACCO_DISCORD_USER_ID`, `DISCORD_TSDR_WEBHOOK_URL`, `COT_WEEKLY_DISCORD_WEBHOOK_URL` | CODE-REFERENCED; morning-wire alerting is OBSERVED-CALLED via `pipeline.py`'s alert path on failure |
| **Substack** | `morning-wire` · `substack/` (44 modules; `publisher.py`, `run.py`, `review.py`, `send_gate.py`), `uct-sunday-scan` · `publish.py`, `compose.py` | `SUBSTACK_PUBLICATION_URL`; gates `WIRE_SUBSTACK_ENABLED`, `WIRE_SUBSTACK_PUBLISH_MODE` (default `draft`), `WIRE_SUBSTACK_GATE_MODE` (default `strict`) | CODE-REFERENCED. **Both channels are draft-first by construction**; sunday-scan's CLAUDE.md states it *never* auto-publishes |
| **YouTube** | dashboard (`api/services/youtube_client.py`, `desk_daily_session.py`) — **not** in the four repos. `uct-intelligence/scripts/youtube_scraper.py` only *reads* YouTube | dashboard-side `YT_OAUTH_*` | Out of this contract's repos; noted for the map |
| **Zoom** | dashboard (`api/routers/desk_zoom_webhook.py`, `api/services/zoom_client.py`); `uct-sunday-scan` references Zoom only in `boilerplate.py`/`run.py` **copy text** (a session link), not as an API | dashboard-side `ZOOM_*` | Out of this contract's repos |
| **Buffer** | **No reference in any of the four repos.** Verified across `*.py`/`*.md`/`*.bat`/`*.ps1`/`*.json` (excluding `data/`, `logs/`, `lab/`) for `buffer.com`, `bufferapp`, `BUFFER_ACCESS_TOKEN`, `BUFFER_PROFILE` — zero hits | — | **NOT FOUND here.** If it is live it is dashboard- or `uct-clips`-side (the clips pipeline is the plausible owner) |
| **R2 / object storage** | `uct-intelligence` · `scripts/brain_pack_export.py`, `scripts/massive_flatfile_backfill.py`, `uct_intelligence/massive_data.py` | `DATA_SYNC_*` family (same names as the dashboard bars rail) | CODE-REFERENCED; the brain-pack keys are `brain/latest.txt` + `brain/<ts>.tar.gz` per the dashboard's own contract note |
| **Email (Resend)** | Not referenced in the four repos (only `send_discord.py` matched the search). Resend is dashboard-side | — | Out of this contract's repos |
| **Stripe** | Referenced only as **copy/config strings** in `morning-wire/flow_publish.py` and `uct-sunday-scan/sunday_scan/config.py`; the payments integration itself is dashboard-side | — | Out of this contract's repos |
| **Whop (membership/promo)** | `morning-wire` · `substack/{promo,render,lint,formats}.py`; `uct-sunday-scan` · `promo.py`, `boilerplate.py`, `config.py`, `run.py` | promo env family (`WIRE_PROMO_*`) | CODE-REFERENCED. **Whop is a real member-facing commerce surface in both newsletter channels** and is easy to miss because it appears as promo copy, not as an API client |

**INTERPRETATION.** The external surface splits cleanly: **the four PC repos own Discord webhooks,
Substack, Whop promos and R2**; **the dashboard owns YouTube, Zoom, Resend, Stripe and the second
Discord application**. Buffer appears in none of the four.
**CONFIDENCE.** 🟢 for presence/absence in the four repos (grep-verified across `*.py`); 🟡 for
"is it live" — none of these were observed firing except morning-wire's own pipeline logs.
**RECOMMENDATION.** The Whop edge deserves an explicit owner in the system map; it is the only
one of these that touches money and currently lives as prose inside two newsletter builders.
**OPEN QUESTION.** Where is Buffer driven from — dashboard, `uct-clips`, or has it been retired?

---

# §5 · The chart renderer

**OBSERVATION.** `services/chart_renderer` is **three files**: `app.py` (183 lines),
`Dockerfile`, `requirements.txt` (fastapi 0.115.6, uvicorn 0.32.1, pydantic ≥2.5,
playwright 1.47.0).

* **What it is:** a headless-Chromium screenshot service. `POST /render` (`app.py:151`) takes a
  URL, screenshots it, returns a PNG; `GET /health` (`app.py:146`). Guards:
  `check_url` (:72) against an `ALLOWED_HOSTS` allowlist, `check_secret` (:84) against
  `CHART_RENDERER_SECRET` (:40), and `RENDER_MAX_CONCURRENT` (:43, default 2).
* **How it is deployed:** its own `Dockerfile` (`FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy`),
  `CMD exec uvicorn app:app --host :: --port ${PORT}`. The `::` bind carries an in-file comment:
  *"Railway's private network is IPv6-only; binding 0.0.0.0 is unreachable from web."* The
  standing claim that it is deployed by `railway up` from its subdirectory and is not
  git-connected is **NOT VERIFIABLE from here** (CLI unlinked) — it remains a CLAIM.
* **Who calls it — CONFIRMED by code, all inside the Railway `web` pod:**
  - `api/services/discord_chart_house.py:265-270` — the Discord `/chart` house image;
  - `api/services/buzz_image.py:184-189` — the `/buzz` board image (with a 4-slot valve, per its
    own comment, because "25 members running /buzz" would otherwise stampede it);
  - `api/main.py:820-841, 2795` — `_start_chart_renderer_warm_background()`, a boot warm at
    +40 s, "inert without `CHART_RENDERER_URL`".
* **What it renders:** the dashboard's own token-gated render routes. `api/routers/render_panels.py`
  (prefix `/api`) declares **12**: `/r/catalysts`, `/r/buzz`, `/r/earnings-history`, `/r/flow`,
  `/r/book`, `/r/econ`, `/r/themes`, `/r/tweets`, `/r/chart-settings`, `/r/breadth-monitor`,
  `/r/breadth`, `/r/calendar-week.png`. Its own header warns that `CHART_RENDER_TOKEN`
  *"is inlined into the frontend JS bundle"*.

**⭐ A distinction the map must not blur.** There are **two different render paths and two
different credentials**:

1. **The Railway service path** — `web` → `CHART_RENDERER_URL` (+ `CHART_RENDERER_SECRET`) →
   chart-renderer → back to `CHART_RENDER_BASE_URL` (default `https://uctintelligence.com`) with
   `CHART_RENDER_TOKEN`. Used by Discord `/chart` and `/buzz`.
2. **The local-browser path** — `morning-wire` (`substack/panelshot.py`, `chartwidget.py`) and
   `uct-sunday-scan` (`sunday_scan/charts.py`, `panels.py`, `breadth_data.py`) each launch **their
   own Playwright on the owner's PC** and navigate to `DASHBOARD_URL/r/*` with
   `CHART_RENDER_TOKEN`. **They never touch the chart-renderer service.**

`panelshot.py` documents the design reasoning in-file (render at Substack's 728 px content column
so text is not downscaled; grid panels keep 900–1200 px; `device_scale_factor 3`).

**EVIDENCE.** All file paths and line numbers above (CONFIRMED by reading).
**INTERPRETATION.** The chart-renderer is a *Discord-surface* dependency, not a newsletter one.
The newsletter pipelines' dependency is on the **`/r/*` routes and the token**, which they reach
with their own browser. Three independent consumers therefore depend on `/r/*` staying stable:
the Railway renderer, morning-wire, and sunday-scan.
**RELEVANCE TO UCT.** If TERMINAL-NEXT changes `/r/*` markup, selectors or the token gate, it
breaks the Monday-morning newsletter and the Friday Sunday-Scan draft **on the owner's PC**,
where no deploy rollback helps. The screenshot contract is effectively public API.
**CONFIDENCE.** 🟢 on code paths; 🟡 on the deployment claim (`railway up`, not git-connected) —
**EVIDENCE CEILING:** unverifiable without a linked CLI.
**RECOMMENDATION.** Give `/r/*` an explicit stability contract (selectors `#panel-export`,
`#chart-export`, `window.__panelReady` are already load-bearing for two out-of-repo consumers).
**OPEN QUESTION.** Is the chart-renderer service genuinely not git-connected? If so, who can
redeploy it, and from which working tree?

---

# §6 · Dependency graph and single points of failure

## 6.1 The map

```
                          ┌──────────────────────── OWNER'S PC (Windows, Central Time) ─────────────────────────┐
                          │                                                                                     │
  PROVIDERS               │  TASK SCHEDULER — 34 UCT jobs, 6 code locations                                     │
  ─────────               │                                                                                     │
  Massive (REST+WS+flat) ─┼─► uct-intelligence ──► uct_intelligence.db (32 tables, 82.7MB)                       │
  FMP                    ─┤     · scanner (in-process, called BY the wire)                                       │
  Finnhub                ─┤     · breadth_collector ─────────────────► POST /api/breadth-monitor/push ──┐        │
  Finviz Elite           ─┤     · autonomous_brain ×5 ───────────────► POST /api/push/intraday ─────────┤        │
  AlphaVantage           ─┤     · brain_pack_export ──► R2 brain/*.tar.gz ─────────────────────────────┐│        │
  EarningsWhispers       ─┤     · market_ingest / eod_updater / buyout_sweep / x_news_feed             ││        │
  Perplexity             ─┤     · sync_book_bars                                                        ││       │
  Anthropic              ─┤                                                                             ││       │
  OpenAI (cover art)     ─┤  morning-wire ──► wire_data.json ─────────► POST /api/push ─────────────────┤│       │
  TwitterAPI.io          ─┤     · pipeline.py: engine ×3 retry → snapshot → substack → review           ││       │
  UnusualWhales (UW_*)   ─┤     · wire_critic (reads /api/wire-feedback/recent-internal)                ││       │
  CFTC / CBOE / NAAIM    ─┤     · export_flow_corpus (reads /api/flow/data)  🔴 FAILING since 8/09      ││       │
  AAII / SEC / CNN       ─┤     · local Playwright ──► GET /r/* (CHART_RENDER_TOKEN) ───────────────────┤│       │
  Yahoo / RSS feeds      ─┤     · Substack draft · Discord webhooks · Whop promo                        ││       │
  Macrotrends/Barchart   ─┤                                                                             ││       │
  X / YouTube (scrape)   ─┘  uct-sunday-scan ──► Substack DRAFT · Discord (Bracco)                      ││       │
                          │     · local Playwright ──► GET /r/chart|/r/breadth|... ─────────────────────┤│       │
                          │                                                                             ││       │
                          │  uct_intelligence (BOT, no git) ──► Discord app #1 ── sys.path ──► engine    ││       │
                          │  uct-clips (git) · uct-recaps (NO git) · breadth-live wt · desk-creative wt  ││       │
                          └─────────────────────────────────────────────────────────────────────────────┼┼───────┘
                                                                                                        ││
                          ┌──────────────────── RAILWAY (project luminous-recreation) ───────────────────▼▼───────┐
                          │  web (uvicorn api.main:app)  ── SPA + all /api/* + APScheduler + Discord app #2       │
                          │    │        · /r/* render routes  · /api/push  · /api/breadth-monitor/*               │
                          │    ├──► chart-renderer (Playwright, own Dockerfile, IPv6 ::) ──┐                      │
                          │    │        ▲ CHART_RENDERER_URL + _SECRET                     │ CHART_RENDER_TOKEN   │
                          │    └────────┴────────────────────────────────────────◄─────────┘ back to /r/*         │
                          │  worker (WORKER_ENABLED)      ── bars prewarm + R2 /data snapshots                    │
                          │  flow-worker (FLOW_WORKER_ENABLED) ── Massive OPRA WS + flow.db + T+1 flat files      │
                          │  bars-api (BARS_API_ENABLED)  ── NEW 2026-09-02, serves /api/bars only from R2 sync   │
                          │  20+ SQLite DBs on the web volume · Cloudflare DNS · uctintelligence.com              │
                          └───────────────────────────────────────────────────────────────────────────────────────┘
```

## 6.2 Edge table

| # | Edge | Criticality | Replaceability | Failure mode | Cost-bearing |
|---|---|---|---|---|---|
| 1 | **Owner's PC → everything scheduled** | **Critical** | None today | PC asleep/off/on-battery ⇒ 34 jobs silently skip; no wire, no breadth push, no book | No (sunk hardware) |
| 2 | morning-wire → `POST /api/push` | Critical | Low (whole-payload replace; partial push clobbers cache) | Dashboard shows yesterday's wire; members see stale exposure/leadership | No |
| 3 | uct-intelligence → `POST /api/breadth-monitor/push` | Critical | Low | Breadth monitor loses the day; live row never superseded | No |
| 4 | Massive (REST + WS + flat files) | **Critical** | Low — bars, movers, snapshots, OPRA all ride it; yfinance is a partial fallback only | Charts, movers, flow all degrade together; ~1 conn/key means a second consumer kicks prod off | **Yes** |
| 5 | Anthropic | **Critical** | Medium (model swap, not provider swap) | Wire prose, catalysts, COT narrative, Compass all stop | **Yes** |
| 6 | Finviz Elite | High | Low for the scanner's three scans | Scanner emits 0 candidates (observed 2026-08-31 dry run: *"no results from Finviz"* ×3) | **Yes** |
| 7 | FMP | High | Medium (AV/Finnhub partial) | Earnings tables + fundamentals go blank | **Yes** |
| 8 | Finnhub | Medium | Medium | Earnings calendar/intel + insider data degrade | **Yes** |
| 9 | Perplexity | Medium | Medium | Catalyst enrichment/discovery thins | **Yes** |
| 10 | OpenAI | Low-Medium | High (cover art only, in these repos) | Newsletter cover falls back to themed card | **Yes** |
| 11 | TwitterAPI.io | Medium | Low | Tape/news signal stops | **Yes** |
| 12 | **UnusualWhales** (`UW_API_KEY`) | Medium | Medium (FMP is a ranked alternative) | Analyst-rating feed thins; `analyst_feed._SRC_RANK` ranks sources `fmp` → `unusualwhales` → `x`, so FMP already precedes it | **Yes** |
| 13 | R2 (brain pack, bars snapshots, flow backup) | High | Medium (S3-compatible) | Brain pack stops installing; worker→web freshness bridge breaks | **Yes** |
| 14 | Railway (5 services, single web replica) | **Critical** | Medium (containerised, but 20+ SQLite DBs are volume-bound) | Total member-facing outage | **Yes** |
| 15 | Cloudflare (DNS + registrar) | **Critical** | Medium | Domain unreachable; 1010-blocks non-browser UAs | **Yes** |
| 16 | Discord (webhooks + 2 apps) | High | Low | Every alert channel goes quiet — including the ones that would report the other failures | No (free tier) |
| 17 | Substack | High | Low | Newsletter channel stops; both builders produce drafts only | Partial |
| 18 | Whop | High (commerce) | Low | Promo/membership links dead | **Yes** |
| 19 | chart-renderer service | Medium | Medium | Discord `/chart` + `/buzz` images stop; newsletters unaffected (own browser) | **Yes** |
| 20 | `/r/*` routes + `CHART_RENDER_TOKEN` | High | Low | **Three** consumers break at once (renderer, morning-wire, sunday-scan) | No |
| 21 | uct-intelligence ← morning-wire `.env` (filesystem) | Medium | High (one config line) | Breadth push loses `PUSH_SECRET` if the wire repo moves | No |
| 22 | Discord bot ← engine via `sys.path` absolute path | Medium | High | Bot breaks if the engine directory is renamed | No |
| 23 | CFTC / CBOE / NAAIM / AAII / CNN / SEC scrapes | Low-Medium each | Low individually | Single columns go stale, often **unlabelled** (NAAIM is 101 days stale today) | No |

## 6.3 Single points of failure

1. **The owner's PC is the scheduler host, and there is no second host.** 34 jobs, 21 of them
   producers, all bound to one Windows machine's power state. Several tasks carry
   `DisallowStartIfOnBatteries=True` + `StopIfGoingOnBatteries=True`, which converts "unplugged"
   into "silently skipped." **The highest-leverage structural risk in the ecosystem.**
2. **Two codebases exist only on that PC** — the Discord bot (no git) and `uct-recaps` (no git) —
   plus one with **git but no remote** (`uct-sunday-scan`). A disk failure loses all three.
3. **Massive is a near-monopoly data provider** across bars, movers, snapshots and OPRA flow, with
   a documented ~1-connection-per-key constraint.
4. **Anthropic is a single AI provider** across wire prose, catalysts, COT narrative, Compass and
   the Model Book.
5. **The Railway `web` pod is a single replica** running one uvicorn process, and it owns 20+
   SQLite databases on its volume — jobs cannot move off it, and it cannot scale out.
6. **`/r/*` + `CHART_RENDER_TOKEN` is an unversioned three-consumer contract.**
7. **The alerting channel is Discord, which is also the thing that goes quiet first.** Every
   failure in §2.5 is *supposed* to surface on Discord; four have not surfaced for weeks.
8. **The monitors are not monitored.** Three of seven monitor tasks are failing; nothing watches
   `LastTaskResult`.

**RECOMMENDATION (ordered by leverage).**
1. One artifact — a daily digest that reads `Get-ScheduledTaskInfo` for all 34 UCT tasks and posts
   **names, last result and last run** to Discord. It would have caught all four §2.5 failures on
   day one and costs a single script. *Read the artifact, not a proxy: read `LastTaskResult` and
   the output files, not an in-process counter.*
2. `git init` + remotes for the bot and `uct-recaps`; a remote for `uct-sunday-scan`.
3. Clear the battery flags on every producer task.
4. Fix the flow corpus export (irreplaceable data, still being lost daily).
5. Decide whether the PC-as-scheduler is TERMINAL-NEXT's architecture or a migration target.

**CONFIDENCE.** 🟢 for the edges inside this machine and the four repos; 🟡 for the Railway half
(file-derived); 🔴 for cost attribution — no billing or provider console was reachable, so
"cost-bearing" is inferred from whether a credential implies a paid plan.

---

# §7 · Desk tools and external sites the pipelines depend on or link to

For Executive Q8 and the fourth desk-tool benchmark slot.

| Tool / site | How it is used | Where (CODE-REFERENCED) | Dependency or link? |
|---|---|---|---|
| **Finviz / Finviz Elite** | **Hard dependency.** The scanner's three screens (PULLBACK_MA, REMOUNT, GAPPER_NEWS) are Finviz queries; the wire has a dedicated client. Also static chart PNGs (`chart.ashx`) on dashboard drill surfaces | `morning-wire/finviz_client.py` (20 `elite.finviz.com` refs); `uct-intelligence/scripts/scanner_candidates.py`; dashboard DrillModal / ThemeTracker | **Dependency** — a Finviz outage empties the scan (observed: `logs/scanner_2026-08-31.log` — *"PULLBACK_MA — no results from Finviz"* ×3 → `SCAN HEALTH FAILED`) |
| **TradingView** | **Link + embed only**, never a data source. `tradingview.com/chart/?symbol=`, `/widgetembed/?frame` | `morning-wire`, dashboard TickerPopup / DrillModal | **Link** — and a direct competitor for the charting surface TERMINAL-NEXT would ship |
| **thinkorswim** | **No reference in any of the four repos** (searched `thinkorswim`, `toslc`, `tos_`) | — | Neither. If it is a desk tool, it is used by hand |
| **Yahoo Finance** | `yfinance` as a fallback for bars/fundamentals/dividends; `finance.yahoo.com` RSS | `morning-wire/news_aggregator.py`; `uct-intelligence` fetchers; dashboard fallbacks | **Dependency (fallback tier)** |
| **X / Twitter** | Two paths: paid TwitterAPI.io for the curated account feed, and direct `x.com` scraping | `uct-intelligence/scripts/x_news_feed.py`, `x_scraper.py`; `morning-wire`; dashboard tweet pipeline | **Dependency** for the tape/news signal |
| **EarningsWhispers** | Forward earnings schedule + BMO/AMC session + anticipation rank | `morning-wire/earnings_calendar.py` | **Dependency** |
| **Substack** | Publishing destination for two channels; also scraped for corpus | `morning-wire/substack/*`; `uct-sunday-scan/publish.py`; `uct-intelligence/scripts/substack_scraper.py` | **Dependency (distribution)** |
| **Whop** | Membership/promo destination in both newsletters | `morning-wire/substack/promo.py`; `uct-sunday-scan/promo.py` | **Dependency (commerce)** |
| **Discord** | Alerting, community, and two product surfaces | all four repos + dashboard | **Dependency** |
| **CFTC · CBOE · NAAIM · AAII · SEC/EDGAR · CNN Fear&Greed · Macrotrends · Barchart · YCharts** | Public-data scrapes feeding breadth/positioning/sentiment columns | `uct-intelligence` (`cdn.cboe.com`, `index.naaim.org`, `www.aaii.com`, `sec.gov`, `production.dataviz.cnn.io`, `www.macrotrends.net`, `www.barchart.com`, `ycharts.com`) | **Dependency (fragile)** — CBOE already returns 403 to Python per morning-wire's own Known Limitations; NAAIM is 101 days stale |
| **YouTube** | Read (transcript/knowledge scraping) in `uct-intelligence`; write (desk uploads) is dashboard-side | `uct-intelligence/scripts/youtube_scraper.py` | Both, split across systems |

**INTERPRETATION for the benchmark slot.** The only *desk tool* that is a hard operational
dependency is **Finviz Elite** — it is the scanner's screening engine, and its failure is
observable in the logs. **TradingView** is the true competitive benchmark: the product links to it
and embeds it, meaning members currently leave the surface to use it. **thinkorswim** is absent
from the code entirely, so any claim about it must come from the owner, not the repos.
**CONFIDENCE.** 🟢 for presence/absence in the four repos; 🟡 for "what the owner actually uses at
the desk" — code cannot answer that.
**RECOMMENDATION.** Use **TradingView** for the fourth desk-tool benchmark slot: it is the only
external tool the product itself links members out to, which makes the gap measurable.
**OPEN QUESTION.** Does the owner use thinkorswim (or another broker platform) at the desk in a
way no repo records?

---

# Appendix A — Full UCT scheduled-task table (CONFIRMED, 2026-09-02)

All times **LOCAL = Central**. `DaysOfWeek` bitmask: 1=Sun, 2=Mon, 4=Tue, 8=Wed, 16=Thu, 32=Fri,
64=Sat; **62 = Mon–Fri**, 127 = daily. `Result` = `LastTaskResult`. All tasks `State=3` (Ready)
and enabled.

| # | Task | Execute + Arguments | WorkingDirectory | Trigger (StartBoundary · Days · Repetition) | Last run | Result | Next run |
|---|---|---|---|---|---|---|---|
| 1 | UCT Brain Pre-Market | `python …\uct-intelligence\scripts\autonomous_brain.py --mode premarket` | uct-intelligence | `2026-02-23T08:30:00-05:00` · 62 | 2026-09-01 07:30 | 0 | 2026-09-02 08:30 |
| 2 | UCT Brain Open | `… autonomous_brain.py --mode open` | uct-intelligence | `2026-02-23T10:45:00-05:00` · 62 | 2026-09-01 09:45 | 0 | 2026-09-02 10:45 |
| 3 | UCT Brain Midday | `… autonomous_brain.py --mode midday` | uct-intelligence | `2026-02-23T13:00:00-05:00` · 62 | 2026-09-01 12:00 | 0 | 2026-09-02 13:00 |
| 4 | UCT Brain Pre-Close | `… autonomous_brain.py --mode preclose` | uct-intelligence | `2026-02-23T15:30:00-05:00` · 62 | 2026-09-01 14:30 | 0 | 2026-09-02 15:30 |
| 5 | UCT Brain Post-Market | `… autonomous_brain.py --mode postmarket` | uct-intelligence | `2026-02-23T21:30:00-05:00` · 62 | 2026-09-01 20:30 | 0 | 2026-09-02 21:30 |
| 6 | UCT Brain Pack Export | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File …\uct-intelligence\scripts\run_brain_pack_export.ps1` | *(none)* | `2026-07-02T21:00:00` (floating) · 62 | 2026-09-01 21:00 | **3221225786** | 2026-09-02 21:00 |
| 7 | UCT Breadth Collector | `python …\uct-intelligence\scripts\breadth_collector.py` | uct-intelligence | `2026-03-16T15:15:00` (floating) · 62 | 2026-09-01 15:15 | 0 | 2026-09-02 15:15 |
| 8 | UCT Breadth Live PreOpen Check | `C:\Python314\python.exe "…\uct-worktrees\breadth-live\tools\breadth_live_open_check.py" --phase preopen` | *(none)* | `2026-08-06T08:08:00-05:00` · 62 | 2026-09-01 08:08 | **2** | 2026-09-02 08:08 |
| 9 | UCT Breadth Live Open Check | `… breadth_live_open_check.py --phase open` | *(none)* | `2026-08-06T08:38:00-05:00` · 62 | 2026-09-01 08:38 | **2** | 2026-09-02 08:38 |
| 10 | UCT Breadth Live Visual Check | `… breadth_live_visual_check.py` | *(none)* | `2026-08-06T08:44:00-05:00` · 62 | 2026-09-01 08:44 | **1** | 2026-09-02 08:44 |
| 11 | UCT Breadth Live Session Check | `… breadth_live_open_check.py --phase session` | *(none)* | `2026-08-06T09:34:00-05:00` · 62 | 2026-09-01 09:34 | **2** | 2026-09-02 09:34 |
| 12 | UCT Breadth PostShip Check OPEN | `… breadth_live_open_check.py --phase open` | uct-worktrees\breadth-live | one-shot `2026-08-10T08:30:00-05:00` | 2026-08-10 08:30 | **2** | *(none — expired)* |
| 13 | UCT Breadth PostShip Check OPEN+20 | `… breadth_live_open_check.py --phase session` | uct-worktrees\breadth-live | one-shot `2026-08-10T08:50:00-05:00` | 2026-08-10 08:50 | **2** | *(none — expired)* |
| 14 | UCT Buyout Sweep | `python …\uct-intelligence\scripts\buyout_sweep.py` | uct-intelligence | `2026-08-07T15:45:00-05:00` · 62 | 2026-09-01 15:45 | 0 | 2026-09-02 15:45 |
| 15 | UCT Clips - approval poll | `wscript.exe "…\uct-clips\run_hidden.vbs" "…\uct-clips\run_clips_poll.bat"` | *(none)* | `2026-08-26T07:06:00` · one-time + **repeat PT20M** | 2026-09-02 01:06 | 0 | 2026-09-02 01:26 |
| 16 | UCT Clips - daily build and queue | `wscript.exe "…\run_hidden.vbs" "…\run_clips_daily.bat"` | *(none)* | daily `2026-08-26T18:30:00` | 2026-09-01 18:30 | 0 | 2026-09-02 18:30 |
| 17 | UCT Desk Creative Watch | `C:\Python314\python.exe "…\uct-worktrees\desk-creative\tools\desk_creative_watch.py"` | *(none)* | `2026-08-19T13:47:00-05:00` · 62 | 2026-09-01 13:47 | 0 | 2026-09-02 13:47 |
| 18 | UCT Desk Insights Polish | `powershell.exe … -File "…\uct-recaps\run_insights_polish.ps1"` | *(none)* | daily `2026-08-28T06:00:00-05:00` · **repeat PT20M for PT16H** | 2026-09-01 22:00 | 0 | 2026-09-02 06:00 |
| 19 | UCT EOD Updater | `python …\uct-intelligence\scripts\eod_updater.py` | uct-intelligence | `2026-02-23T16:05:00` (floating) · 62 | 2026-09-01 16:05 | 0 | 2026-09-02 16:05 |
| 20 | UCT Flow Corpus Snapshot | `…\morning-wire\run_flow_corpus_snapshot.bat` | *(none)* | daily `2026-07-28T20:15:00` | 2026-09-01 20:15 | **1** | 2026-09-02 20:15 |
| 21 | UCT Flow Corpus Snapshot AM | `…\morning-wire\run_flow_corpus_snapshot.bat` | *(none)* | daily `2026-07-28T06:00:00` | 2026-09-01 06:00 | **1** | 2026-09-02 06:00 |
| 22 | UCT Live Recap | `powershell.exe … -File "…\uct-recaps\run_daily.ps1"` | *(none)* | **three** weekly triggers · 62 · 15:00, 17:00, 13:00 | 2026-09-01 17:00 | 0 | 2026-09-02 13:00 |
| 23 | UCT Market Ingest | `python …\uct-intelligence\scripts\market_ingest.py` | uct-intelligence | `2026-02-23T20:05:00` (floating) · 62 | 2026-09-01 20:05 | 0 | 2026-09-02 20:05 |
| 24 | UCT Market Monitor | `python …\uct-intelligence\scripts\market_monitor.py` | *(none)* | `2026-02-21T07:00:00-05:00` · 62 | 2026-09-01 06:00 | **3221225786** | 2026-09-02 07:00 |
| 25 | UCT Morning Wire | `C:\Windows\System32\cmd.exe /c …\morning-wire\run_morning_wire.bat` | *(none)* | `2026-07-19T06:35:00-05:00` · 62 | 2026-09-01 06:35 | 0 | 2026-09-02 06:35 |
| 26 | UCT NAAIM Settle | `cmd /c "…\uct-intelligence\scripts\run_naaim_settle.bat"` | *(none)* | `2026-08-05T14:00:00` (floating) · **48 = Thu+Fri** · repeat PT2H for PT20H | 2026-08-29 10:00 | **1** | 2026-09-03 14:00 |
| 27 | UCT Post-Close Check | `Git\bin\bash.exe -lc "cd …\uct-dashboard\.worktrees\coverage-blanks && bash post-close-check.sh > …\post-close-check.log 2>&1"` | *(none)* | one-shot `2026-08-10T15:44:00-05:00` | 2026-08-10 15:44 | 0 | *(none — expired)* |
| 28 | UCT Sunday Scan | `…\uct-sunday-scan\run_sunday_scan.bat` | uct-sunday-scan | `2026-07-25T17:30:00-05:00` · **32 = FRIDAY** | 2026-08-28 17:30 | 0 | 2026-09-04 17:30 |
| 29 | UCT Sunday Scan Watchdog | `cmd.exe /c cd /d "…\uct-sunday-scan" && set PYTHONIOENCODING=utf-8 && python -m sunday_scan.watchdog` | uct-sunday-scan | `2026-07-25T09:00:00-05:00` · **64 = SATURDAY** | 2026-08-29 09:00 | 0 | 2026-09-05 09:00 |
| 30 | UCT Warm Bars Universe | `C:\Python314\python.exe …\uct-dashboard\scripts\trigger_warm_universe.py --poll` | **uct-dashboard (parked)** | `2026-04-26T01:00:00-05:00` · **127 = daily** | 2026-09-02 01:00 | 0 | 2026-09-03 01:00 |
| 31 | UCT Wire Critic | `…\morning-wire\run_wire_critic.bat` | *(none)* | `2026-06-19T05:00:00` (floating) · 62 | 2026-09-01 05:00 | 0 | 2026-09-02 05:00 |
| 32 | UCT X News Feed | `python …\uct-intelligence\scripts\x_news_feed.py` | uct-intelligence | `2026-03-08T05:30:00-05:00` · 62 | 2026-09-01 05:30 | 0 | 2026-09-02 05:30 |
| 33 | UCT20 Book Bars Sync | `python …\uct-intelligence\scripts\sync_book_bars.py` | uct-intelligence | `2026-08-26T06:00:00-05:00` · 62 | 2026-09-01 06:00 | 0 | 2026-09-02 06:00 |
| 34 | UCT20 Portfolio EOD Refresh | `python scripts\refresh_uct20_portfolio_live.py` | **morning-wire** | `2026-07-19T15:20:00-05:00` · 62 | 2026-09-01 15:20 | 0 | 2026-09-02 15:20 |

**Notes.** No argument in any task contains a secret — all are file paths and mode flags, so
nothing required redaction. Six tasks have an empty `WorkingDirectory`, which makes them
sensitive to the scheduler's default CWD (`C:\Windows\System32`); all six use absolute script
paths, so this is currently harmless but is a latent trap for any script that resolves a relative
path.

**Selected `Settings` (read-only):**

| Task | ExecutionTimeLimit | StartWhenAvailable | DisallowStartIfOnBatteries | StopIfGoingOnBatteries | WakeToRun |
|---|---|---|---|---|---|
| UCT Morning Wire | PT1H | False | False | False | True |
| UCT Market Monitor | PT16H | False | False | False | True |
| UCT Brain Pack Export | PT72H | False | **True** | **True** | False |
| UCT Flow Corpus Snapshot (+AM) | PT72H | False | **True** | **True** | False |
| UCT NAAIM Settle | PT15M | True | False | False | False |
| UCT Breadth Live Open Check | PT15M | True | False | False | True |
| UCT Warm Bars Universe | PT2H | True | False | False | True |

⚠️ `UCT Morning Wire` has a **1-hour execution limit** while `pipeline.py` allows 3 engine attempts
with 180 s backoff plus three downstream steps. A worst-case retry path (≈3×10 min + 2×3 min +
snapshot/substack/review) approaches that ceiling. Not currently breached (2026-09-01 finished in
~14 min), but the headroom is thinner than the "7.7 minutes" doc implies.

---

# Appendix B — Provider / credential-name matrix (NAMES ONLY)

| Credential NAME | uct-intelligence | uct_intelligence (bot) | morning-wire | uct-sunday-scan |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ code + .env | ✅ code + .env | ✅ code + .env | — |
| `OPENAI_API_KEY` | — | — | ✅ .env (`substack/cover_*`) | — |
| `PERPLEXITY_API_KEY` | ✅ code | — | ✅ code + .env | — |
| `MASSIVE_API_KEY` / `_SECRET_KEY` / `_ACCESS_KEY` | ✅ code + .env | — | ✅ code + .env | — |
| `FMP_API_KEY` | ✅ code + .env | — | ✅ .env | — |
| `FINNHUB_API_KEY` | ✅ code | — | ✅ .env | — |
| `FINVIZ_API_KEY` | — | — | ✅ code + .env | — |
| `ALPHAVANTAGE_API_KEY` | — | — | ✅ .env | — |
| `TWITTERAPI_IO_API_KEY` | ✅ code | — | ✅ .env | — |
| `UW_API_KEY` | — | — | ✅ code + .env — `morning_wire_engine.py:131` (`UW_KEY`), consumed by `analyst_feed.py:261` → `api.unusualwhales.com/api/screener/analysts` (bearer) | — |
| `HF_TOKEN` | ✅ .env | — | — | — |
| `PUSH_SECRET` | ✅ code | — | ✅ code + .env | — |
| `DASHBOARD_URL` | ✅ code | — | ✅ code + .env | ✅ code |
| `CHART_RENDER_TOKEN` | — | — | ✅ code + .env | ✅ code |
| `DATA_SYNC_REGION` (R2) | ✅ code | — | — | — |
| `SUBSTACK_PUBLICATION_URL` | — | — | ✅ .env | ✅ code |
| `DISCORD_WEBHOOK_URL` | — | — | ✅ code + .env | ✅ code |
| `DISCORD_SYSTEM_ALERTS_WEBHOOK_URL` | ✅ code | — | ✅ code + .env | — |
| `DISCORD_ALERT_MENTION` | — | — | ✅ code | — |
| `SUNDAY_SCAN_WEBHOOK_URL` / `_BRACCO_WEBHOOK_URL` / `BRACCO_DISCORD_USER_ID` | — | — | — | ✅ code |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `DISCORD_CHANNEL_TSDR` / `DISCORD_CHANNEL_INTELLIGENCE` | — | ✅ .env | — | — |
| `CHROMA_PERSIST_DIR` (points at a **LanceDB** store) | — | ✅ .env + code | — | — |
| `VERCEL_TOKEN` / `VERCEL_PROJECT_NAME` / `VERCEL_SITE_URL` (**legacy**) | — | — | ✅ .env | — |
| `MORNING_WIRE_ROOT` / `SUNDAY_SCAN_{CORPUS,STATE_DIR,SESSION_PATH}` | — | — | — | ✅ code |
| `UCT_BARS_DB` / `UCT_INTELLIGENCE_PATH` | — | — | ✅ code | — |
| Feature flags | `UCT_ALLOW_TEST_LEDGER_WRITES` | — | `WIRE_CRITIC_ENABLED`, `WIRE_CRITIC_{LOOKBACK_DAYS,MIN_VOTES}`, `WIRE_OPTIONS_DESK_ENABLED`, `WIRE_CORE_LEADERS`, `LEADERSHIP_HYSTERESIS_EXIT_RANK`, `WIRE_SUBSTACK_{ENABLED,PUBLISH_MODE,GATE_MODE}`, `WIRE_PROMO_*`, `UCT20_BOOK_ENABLED` (set in the `.bat`) | `CTA_DISCORD_ACCESS`, `TSDR_DISCORD_BLURB` |

Legend: "code" = read via `os.getenv`/`os.environ` in a `.py` file; ".env" = the key name appears
in the repo's `.env` (name only — **no value was read**). A key present in `.env` but absent from
code is **KEY-PRESENT**, not evidence of use (`VERCEL_*` and `UW_API_KEY` are the clearest
examples).

---

# GAPS — what this budget did not reach

* **`railway logs`, `railway variables --json`, `railway status`** — the CLI is unlinked from the
  research worktree and `railway link` is forbidden by contract. Consequently **no** Railway
  statement here is OBSERVED-CALLED: I could not confirm which services exist, how many replicas,
  which flags are set, or whether `bars-api` is deployed.
* **Provider status above CODE-REFERENCED for most providers.** Massive, FMP and Finviz reach
  OBSERVED-CALLED via the 2026-09-01 scanner/breadth logs. Perplexity, OpenAI, AlphaVantage,
  TwitterAPI.io, UnusualWhales and the R2 rail are CODE-REFERENCED only.
* ~~`UW_API_KEY` call site~~ — **resolved during final verification**: `morning_wire_engine.py:131`
  reads it as `UW_KEY` and `analyst_feed.py:261` calls
  `https://api.unusualwhales.com/api/screener/analysts`. Recorded here because the first pass got
  it wrong: a `.env`-only match looked like a dead key until the consumer was found under a
  *different local name*. **Grep the module, not the env-var spelling.**
* **`uct-clips` internals** — mapped only to the depth the scheduler required (entry `.bat`s, git
  branch, `clips.db` presence). Its providers, quota behaviour and outputs were not enumerated.
* **`uct-recaps` internals** — same; I read `insights_polish.log` only.
* **Cause of the flow-corpus exit 1** — determinable only by running the exporter, which calls
  production; not run.
* **Whether the Discord bot runs anywhere** — no scheduled task, no Railway entrypoint, no process
  at survey time. Not settled.
* **The DST/offset question in §2.6** — the pattern is measured, the cause is not.
* **`morning-wire/parity/`, `lab/tools/`, `Post/`, `Setups/`, `analysis/`, `server/`** — noted as
  present, not opened.
* **Test suites** — counted by file, never run (correctly: the contract forbids it, and `C:\data`
  is live on this box).
* **`uct-clips` remote** — not checked.

# NOT INSPECTED — out of reach and why

* **The Railway production estate** (services, variables, logs, deploy history, volumes) — CLI
  unlinked; `railway link` / `ssh` / `run` / `up` / `redeploy` / `--set` all forbidden.
* **Production endpoints on `uctintelligence.com`** — the contract forbids running anything
  against production services; no request was made, including `/api/health`.
* **The local backend on port 8077** — observed running in the process table, deliberately **not
  probed**: it serves stale data against live `C:\data` and is never truth.
* **`C:\data`** — the shared production data root on this box; not read, not written.
* **The web pod's 20+ SQLite databases** — they live on the Railway volume, not here.
* **Partner-owned files** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`,
  `massive_ws_worker.py`, `massive_processor.py`) — noted as existing and, per `railway.json`,
  `massive_ws_worker` is the flow-worker's OPRA consumer. Not described further by design.
* **A second machine.** The contract says "both machines"; the two I can evidence are **the
  owner's Windows PC** (34 scheduled tasks, six code locations) and **Railway** (four dispatcher
  entrypoints + chart-renderer). If a third host exists — e.g. wherever the Discord bot runs —
  **I found no evidence of it on this box**, and that absence is itself a finding.
* **Provider billing/consoles** — not reachable; all cost-bearing judgements in §6.2 are inferred
  from whether a credential implies a paid plan.
