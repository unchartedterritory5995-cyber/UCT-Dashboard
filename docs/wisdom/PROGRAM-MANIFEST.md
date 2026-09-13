---
id: WISDOM-LOOP-MANIFEST
title: UCT Wisdom Loop — Program Manifest
status: Session 0 complete · D1–D10 ANSWERED YES (owner, 2026-09-13) · D6 resolved as the MERGE MAP (§3) · D11–D20 open · nothing merged · no flag declared
branch: feat/wisdom-loop (cut from origin/master f4fc5d1c1, 2026-09-13)
owner: Patrick (TSDR) · decisions: §12 · owner-only tasks: §13
---

# UCT Wisdom Loop — Program Manifest

> **One sentence.** Everything UCT teaches — advice, lessons, calls, writing, charts, visuals,
> across Zoom sessions, workshops, interviews, Discord, X and the published Sunday Scans — becomes
> structured, provenance-carrying knowledge that is tied to what the market did next. That
> knowledge is **published into the systems that already recall and teach**: Ask-AI, Compass, the
> brain KB, Pattern Vision, the Model Book, the Desk and the owner's voice profile. It also
> *measures* whether the platform sees what Patrick sees, and it drives every recognition change.
> Dark, measured, owner-flipped.

Owner direction, 2026-09-13: *"I want the advice and lessons and thoughts and writing and charts
and visual and everything to just better inform and teach our system … We have full access to all
stocks price data, news, twitter/X, fundamentals, catalysts, etc. Use it to our advantage."*

Companion files:
- `LEDGER.md` (commit ledger)
- `vocabulary/setup-vocabulary-v0.draft.json` (Setup Vocabulary v0)
- `golden/golden-v0.provenance.json` (quote-free provenance of the 30 draft golden records)
- `tools/wisdom_golden_verify.py` (the verifier)

---

## 0. Standing rules for this program

1. **Repo rules first.** CLAUDE.md governs.
   - One master merge at a time, repo-wide, with Railway `web` SUCCESS observed before the next push.
   - `docs/runbooks/deploy-windows.md` is the only authority on push timing.
   - Backend pytest is always SCOPED to named files.
   - A test-runner exit code counts only when a totals line is present.
2. **Dark by default; Patrick alone flips.**
   - Every capability ships behind a flag where unset means OFF.
   - The flag is declared in `docs/feature_flags.json` in the **same commit** as its read site.
   - Nothing member-visible changes without an owner approval line in `LEDGER.md` §4.
3. **Ledger every commit** on program-created paths (`LEDGER.md`).
4. **Forbidden paths:**
   - `app/src/pages/journal-2-0/**`
   - `**/lib/offline/**`
   - `OptionsFlow.jsx`
   - every flow-worker watched file
   - partner-owned files such as `flow_db.py`, which may be opened read-only and never edited
5. **Consume, never fork.** §3 lists every existing system and how Wisdom merges into it. If a system lacks what this program needs, the gap goes to that system's owner. Wisdom never builds a parallel copy.
6. **Standing holds:**
   - The Pattern Intelligence Lab is **PAUSED** and the scanner release train is on **HARD HOLD**.
   - Replay and look-alike work *runs* detectors and charts read-only. It never edits, tunes or promotes a detector.
   - Recognition changes are **proposals**.
7. **Public repository** (`"visibility": "public"`, measured 2026-09-13; D1 = YES).
   - Committed: only quote-free artifacts, plus quotes from the free Sunday Scans.
   - Never committed: verbatim paid-session text, transcript samples, golden labels, owner position details, owner trades or owner notes.
8. **Every number carries its sample size. `0/0` prints as `0/0`.**
9. ⛔⛔ **Published Sunday Scans posts only — NEVER drafts** (owner ruling 2026-09-13, out of concern for accidental deletions). This is enforced by removing the capability, not by a flag:
   - Wisdom reads only `desk.db.substack_posts`. `substack_bodies.fetch_body` fills it from the public, unauthenticated `/api/v1/posts/{slug}` and RSS, and refuses anything not `audience=everyone`.
   - **Import ban for every Wisdom module:** morning-wire's `substack` package; `sunday_scan.publish`, `sunday_scan.run`, `sunday_scan.promo`. (`publish.py` creates and reads drafts with the saved login cookie, and morning-wire `publisher.send_draft` clicks "Send to everyone now".)
   - Wisdom never reads `%LOCALAPPDATA%\uct\substack\storage_state.json`.
   - W1 ships an AST rail that fails BY NAME on any such import or path. The six read-only libraries `prep_sheet`, `roster`, `boilerplate`, `corpus`, `etf_walk` and `facts` stay allowed. That rail must strip comments, and its self-check must show a banned name *inside a comment* is not a match.
   - Machine drafts (`%LOCALAPPDATA%\uct\sunday_scan\drafts\*.html`) are machine output, not his writing, and are never a source.
10. **Attribution is exact.**
    - A guest teacher's lesson (Oliver Kell, Stockbee, 1ChartMaster, Ameet Rai …) is recorded under the guest, never credited to TSDR.
    - Only TSDR and Bracco author CALLs (D3).
    - Unsigned Sunday Scans sections are TSDR (D4).
11. **Owner-private stays owner-private.** Share sizes, P&L, broker trades (D16) and Notebook notes (D16) are stored for the owner's own review surface. **No member-facing route may ever return them**, and a route test asserts that.

---

## 1. Surfaces this program consumes, feeds or merges into

| Surface | Path | Role for Wisdom Loop |
|---|---|---|
| **Brain KB** | `uct-intelligence/data/uct_intelligence.db` `knowledge_base` → `scripts/brain_pack_export.py` (Mon–Fri 21:00 CT) → `api/services/brain_sync.py` → `brain_kb_service.py` (`text-embedding-3-small`, `brain_index.db`) | **Primary recall door** (§3). Readers: Ask-AI "UCT PLAYBOOK" (`ai_search.py::_brain_context`), `ai_search_deep`, `ai_search_dossier`, Compass `ask_the_brain` (chat + voice), `community_ask`, and the Morning Wire engine via SQL |
| Ask-AI assembly | `api/routers/ai_search.py`: `_uct_context`, `_grounded_system`, `fast_lane_answer` | W4 insertion point. Retrieval that needs an embedding call goes in `_grounded_system` |
| Ask-AI memory / dossier | `api/services/ai_search_memory.py` (`/data/ai_search_memory.db`); `ai_search_dossier.py` ("UCT HOUSE VIEW") | ⚠ The dossier is a synthesized house view injected ahead of prior answers. Wisdom must **feed** it, or it becomes a second authority that contradicts what UCT said |
| Ask-AI exam | `api/services/ai_search_eval/` (`run_exam`, `run_grounding_audit`) | Home of the grounding eval |
| Voice principles | `api/services/voice_embeddings_service.py`, `voice_kb_service.py`, `api/data/voice_kb/trading_principles.json` (36 **unsourced** entries → `lookup_trading_principle`) | ⚠ A second authority on principles that Compass's mentor lane cites. Link each to a sourced Wisdom principle; retire only with owner approval (D18) |
| Desk ticker mentions | `api/services/ticker_mentions.py` | Declared **single authority** for Desk chart markers and the TickerPopup Desk tab. Wisdom CALL/MENTION join as a provider inside it |
| Desk transcripts | `/data/education.db` `edu_videos` (`transcript`, `chapters`, `ticker_moments`, `setups`, `media_started_at`); `education_search.py` FTS5 | Zoom/workshop/interview source of record; FTS is the W4 baseline |
| Desk insights | `api/services/desk_session_insights.py` (VTT → transcript; `setups` via Haiku mapped to `_SETUP_TAXONOMY`; `ticker_moments` via Sonnet 5; headline/summary polished by Opus) | Consumed as weak labels and segmentation hints, never re-extracted |
| Desk articles | `/data/desk.db` `substack_posts` (`body_raw` published HTML incl. `<img>`, `sections_json`) + FTS; `desk_article_anchors` (**publish-time close**); `desk_article_links` (letter ↔ video) | Sunday Scans source of record, chart-image source, call-date anchor price, cross-stream links |
| Tweets | `api/services/twitterapi_io.py` (`get_user_last_tweets`, `search_tweets`); `tweet_store.py` `/data/tweets.db` (**7-day retention**); `OFFICIAL_ACCOUNTS` = TSDR_Trading, Braczyy, 1ChartMaster | Wisdom persists official-account tweets before the sweep. No second poller |
| Chart vision | `api/services/pattern_vision/` (`vision_judge.build_messages` sends base64 PNGs; `pattern_exemplars` PNG store; `pattern_feedback` thumbs + notes by user; `pattern_verdicts`) | Owner chart evidence becomes `pattern_exemplars` rows with a Wisdom link. The owner's own `pattern_feedback` is golden labels |
| Model Book / Setup Library | `/data/modelbook.db` (`modelbook_setup_examples`, `modelbook_setups`); `app/src/pages/modelbook/setupPlaybooks.js` (owner playbooks, **9 of 26 written**), `setupCatalog.js` | Owner-curated examples are golden labels. Wisdom **drafts** examples and missing playbooks for approval (D19) |
| Owner voice | `morning-wire/owner_voice.py` + `data/voice/voice_profile.json` + `voice_exemplars.json` (120, **stale: built 2026-08-18 from the 07-24 archive**); dashboard `wire_feedback_store.py` owner notes; `desk_creative.py` register pattern (`desk_assets/qullamaggie_register.txt`, **no TSDR register exists**) | Wisdom supplies the author-filtered corpus; the voice builds stay where they are (D19) |
| Sunday Scans libraries | `uct-sunday-scan/sunday_scan/{prep_sheet,roster,boilerplate,corpus,etf_walk,facts}.py` | Imported read-only as parsers. ⛔ never `publish`/`run`/`promo` (§0.9) |
| Session recaps | `uct-recaps/daily_recap.py` (deep recap generated via `claude -p`, **then discarded**), `desk_insights_polish.py` | Proposal: keep the deep recap as a source instead of discarding it |
| Legacy #tsdr | `uct_intelligence/data/raw/tsdr_export_20260221_154219.json`, `processed/processed_messages.json` (7,766 msgs), `trader_profile.json`, `trading_rules.json` | Seed import (source version 0) |
| Owner trades / notes | J2 broker sync (`api/services/journal_two/broker/`); Ask Notebook `journal_two/ask_retrieval.retrieve(user_id, …)` (per-user FTS) | Read-only through existing services, owner only, D16 consent |
| Curriculum | `docs/curriculum/uct_method_scripts.json` (16 modules / 79 lessons / 395 chapters, AI-drafted, 40-term glossary) | **Not** owner speech. Reconcile its glossary with the vocabulary |
| S3 / S8 / D2 / S7 / S12 | `entity_master/api.py::resolve`; `components/provenance/`; `api/services/canonical/`; `alert_taxonomy/`; `rollout.py` | Consumed unchanged. S7 `price_level` is the D20 alert type. D2 `uctUri` is needed for `<Cited>` |
| Bars / replay | `bars_sqlite.py` (`get_bars_before`, `closes_asof`); `pattern_engine.detect_all`; `screener/backtest.py`; recorded outputs (`leadership_snapshots` from 2026-02-19, `setup_triggers` from 2026-07-30, `pattern_detections` 120-day, `catalysts.db`) | Outcomes, replay, look-alike |
| Clip pipeline | `uct-clips/media/{source.acquire, scan.sample_at, layout.decide, croptrim}`, `words.py`; `tools/heavy_lock.py` | Chart frames at call timestamps (D13), under the heavy lock |
| Flags | `docs/feature_flags.json` (+ `build_flags`), `tests/test_feature_flag_ledger.py`, `tools/flag_ledger_audit.py` | Declarations |

---

## 2. Findings (measured on production and this box, 2026-09-13)

### 2.1 Zoom live sessions — and the whole teaching back catalog

- **Recording pipeline:** Zoom Automatic Cloud Recording → `desk_session_jobs` → YouTube → `edu_videos`.
- **Transcripts:** Zoom's own VTT, stored as `[H:MM:SS] Name: text` with start times only. **The raw VTT and Zoom's cloud copy are discarded.**
- **Timestamp anchor, proven:** the job's `start_time` plus the cue offset gives the minute a call was made. On the 9/11 session, t0 = 08:51:59 ET against 08:51:08 ET inferred from the transcript itself.
- **⭐ The back catalog is already transcribed.**
  - Sweep of ids 1–370: **320 videos, 319 with transcripts, 20,334,779 characters (≈ 5.8M tokens).**

    | Category | Videos | Chars |
    |---|---|---|
    | Live Trading Sessions | 56 | 4.35M |
    | Interviews | 35 | 3.39M |
    | The Mental Game | 54 | 2.96M |
    | Setups & Strategies | 37 | 2.16M |
    | Workshops & Fireside Chats | 24 | 2.07M |
    | Options & Flow | 22 | 1.39M |
    | Risk & Trade Management | 18 | 0.89M |
    | Market Analysis & Breadth | 13 | 0.89M |
    | Scanning & Stock Selection | 16 | 0.68M |
    | Mindset & Psychology | 7 | 0.54M |
    | Short shows (Evening Update, Post-Market Recaps, Thoughts on the Market, Sunday Scans Zoom, Sharpen) | — | — |

  - No Whisper backfill is needed.
- **Speaker labels:** present in only **80 of 319** transcripts; 239 have none. Where present they are unstable: `Patrick (TSDR)` / `Patrick TSDR)` / `Uncharted Territory`; `Brac` / `Bracco`. 7 of 25 recent long sessions carry one label.
  ⇒ Authorship comes from the speaker table when labels exist, and otherwise from the show and host metadata plus content cues, with capped confidence.
- **Speech-to-text damage:** tickers and prices get mangled (`light` for LITE, `Soxel` for SOXL, `MBIS` for NBIS, `9.30` for $930, `chairs` for shares).
  ⇒ §4.8 ASR alias layer.
- **Coverage:** 33 of 34 measurable videos cover ≥ 98% of their YouTube length. **1 of 34 is truncated: 356 "Workshop with Stockbee" covers 5.1% (345 s of 6,830 s).**
  - It's a live Desk-pipeline defect, filed to the Desk owner (D10 = YES; recover from Zoom trash before ~2026-10-11).
  - ⚠️ A first coverage pass manufactured 9 false zero-coverage rows (a regex didn't match those rows' stamp format). The server-parsed `transcript-cues` endpoint is the authority.
- A stop/restart creates duplicate stub publishes (353/354), so sources de-duplicate by meeting and time window, never by title.

### 2.2 Workshops and interviews

- They share the pipeline, routed by webinar name.
- Guests teach on 35 interviews and 24 workshops. Their lessons are the richest PRINCIPLE yield in the corpus and must carry the guest's name (§0.10).

### 2.3 Sunday Scans — text AND charts

**Source:** the **published Substack post only** (§0.9), mirrored into `desk.db.substack_posts`.

**Local `desk.db`:**
- **64 published issues, 2025-06-08 → 2026-09-06** (the text archive counts 67).
- **2,953 chart images**, median 44 per issue, max 99.
- All on `substackcdn.com`, **publicly fetchable without login** (`206 image/jpeg`).

**Labeling charts:**
- Charts have **no figcaption**. A chart is labeled by the nearest *earlier* short line (`SPY (Daily)`), with the author's prose between the label and the image.
- `substack_article._emit_img`'s last-label guess must be verified. The draft-JSON "node after the label" rule from uct-sunday-scan does **not** hold on published HTML.

**Structure:**

| Section | Signed? |
|---|---|
| INTRO | unsigned → TSDR (D4) |
| Calendar | unsigned → TSDR (D4) |
| Breadth | unsigned → TSDR (D4) |
| Index & ETFs | unsigned → TSDR (D4) |
| Bracco's Breakdown & Top Ideas | Bracco |
| TSDR's Weekly Outlook & Watchlist (Current Positions, Charts Covered, Honorable Mention, per-chart notes) | TSDR |

**Anchor price:** `desk_article_anchors` already stores the publish-time close.

### 2.4 Discord

- The UCT Intelligence bot reads `#main-chat` (200) but gets **`#tsdr` → 403** (control-verified). D2 = YES: the grant is an owner task.
- The #tsdr corpus is frozen at 2024-03-11 → 2026-02-20: 7,766 messages, 7,567 by the owner, pre-classified. The listener is not running.

### 2.5 X / Twitter

- TSDR_Trading, Braczyy and 1ChartMaster are **already polled** as official accounts, and **deleted after 7 days** (`TWEET_RETENTION_DAYS=7`).
- `search_tweets` supports `from:` queries. TwitterAPI.io's `until_time` makes a paid historical backfill possible.

### 2.6 The systems that already recall the owner — and what is wrong with them

| System | State | Defect Wisdom can repair |
|---|---|---|
| Brain KB | 9,677 rows. Sunday Scans content = **one ingest on 2026-02-21** (4,399 rows), nothing since; `#tsdr` 591 day-logs; 1,495 machine `self_review` rows ("UCT Brain") in the same retrieval pool; no dedupe; no author field | **Misattribution:** 456 Sunday Scans rows labeled `trader='Bonde'` — **only 30 of 456** mention Pradeep/Bonde/Stockbee. Samples are TSDR/Bracco writing ("Long from $330"). Ask-AI and Compass can currently credit the owner's ideas to another trader. Also no dates/URLs for citation, and 7 months stale |
| Voice KB | 36 unsourced principles cited by Compass | No provenance |
| Morning Wire owner voice | Profile + 120 exemplars | Stale since 08-18. Wire critic logging "no qualifying segments": it is learning nothing now |
| Setup names | **Six** lists: `setupGroups.js` 32, `setupCatalog.js` 26, `_SETUP_TAXONOMY` 26, `FOCUSED_SETUPS` 14, `voice_chart_vision` list, curriculum glossary 40 | No single authority. D9 = YES makes the owner-named vocabulary the one, and the six map to it (never a seventh) |
| Desk dossier | AI house view | Not grounded in what UCT said |
| uct-recaps | Deep recap generated daily | Discarded after posting |

### 2.7 Bars, outcomes, replay

- **Daily bars:** split-adjusted, decades deep, survivorship-biased. Delisted names come from `uct-intelligence/data/massive_cache` flat files (2003+).
- **Intraday:** from 2026-02 (60-minute), 04-16 (5-minute), 06-08 (1-minute).
- Outcomes are computable from 2026 on. The same-bar stop/target order is resolvable only with intraday data.
- **Replayable:** 85 detectors (bars cut at the date); bar-only screener formulas; the leadership harness.
- **Recorded-only (cannot replay):** Finviz candidates, catalysts, Pattern Vision, theme engine.

### 2.8 CAPTURE-NOW RISKS — data a future replay or context read will need, being lost daily

Ranked by value. D7 and D12 capture them.

1. **Intraday tape:**
   - Breadth path (score, % above the 20/50-day, A/D, 4% movers, new highs) is kept **7 days** (`breadth_intraday.db`).
   - Intraday VIX lives only in yfinance's 7/60-day window.
2. **Narrative at the moment of a call:**
   - Tweets: **7 days**.
   - News-tile headlines: **never stored**.
   - `catalyst_news`: 48 hours.
   - Company news is pruned by relevance.
3. **What was on screen:**
   - `candidates.json` and `wire_data.json`: **overwritten**.
   - `screener_rows`, RS ranks, research ratings: **current-only**.
4. **Options positioning:**
   - GEX: **never stored**.
   - Open interest: 10 days (Massive) / 90 days (Schwab).
   - Dark pool: 120 days.
5. **Street and float, point-in-time:**
   - Short interest, float, price-target consensus: **current-only**.
   - `fund_snapshots`: overwritten.
   - Estimates snapshots exist only for viewed tickers.
6. **Classification:**
   - Theme memberships: **wiped on reseed**.
   - Sector/industry/cap: 24-hour overwrite.
   - Earnings-date store keeps only the previous date.
7. **Lower:** the transcript index (90 days, re-fetchable), company-news mentions (90 days).

**Durable history that exists:**
- `breadth_monitor.db` daily
- `breadth_sentiment_history` from 1987
- `market_regimes` (from 2026-02)
- `leadership_snapshots`, `wire_issues`, `uct20_compositions`
- `cot.db` (2017+; use the release date)
- `news_archive` (2021+, 24.5k rows)
- `catalysts.db` (indefinite)
- FMP earnings, estimates and SEC filings are rebuildable by date

---

## 3. D6 RESOLVED — the MERGE MAP (owner delegated the call, 2026-09-13)

> **Decision.** Wisdom does **not** build a parallel recall system. `wisdom.db` holds only what no
> existing system can hold: structured records, per-field provenance, outcomes, context snapshots,
> the vocabulary authority, golden labels and eval runs. **Text stays where it already lives**
> (referenced by pointer and sha256, with an immutable R2 snapshot, because every home is mutable
> or pruned). **Everything recall- or teaching-facing is published into the existing door.**

**Why:** the audit found the owner is already recalled by six systems. Four of them are stale, unsourced or misattributed. A seventh would compound the divergence; merging lets Wisdom's provenance *repair* them.

| Existing door | Wisdom publishes | Mechanism | Guard |
|---|---|---|---|
| **Brain KB** | Owner-confirmed PRINCIPLEs, lessons and guest teachings as KB rows. `source='wisdom'`, `source_ref='wisdom:<kind>:<key>'`, `trader` from the speaker table (TSDR / Bracco / guest), date and link in the title and content | PC-side `uct-intelligence/scripts/wisdom_kb_sync.py` pulls a PUSH_SECRET export from prod, upserts by `source_ref` (delete + insert, since the KB is insert-only), and runs **before** the 21:00 CT Brain Pack export. The pack contract between the two repos is unchanged | Admin-cohort flip first (D18); rows are superseded, never silently deleted |
| **Ask-AI** | Wisdom retrieval block beside `_brain_context` | `_grounded_system` (W4) | S8 `<Provenance>`; mechanical citation check (§7.4) |
| **AI dossier** | Per-ticker calls and principles as dossier inputs | Input feed to `ai_search_dossier` | The house view must agree with what UCT said |
| **Voice principles** (36) | A sourced principle link on each | Link table; retirement only by owner (D18) | — |
| **Desk ticker mentions** | CALL/MENTION with the source line | Provider inside `ticker_mentions.py` | Single authority preserved |
| **Pattern Vision** | Owner chart evidence → `pattern_exemplars` (+ `wisdom_record_id`) | Existing exemplar insert; `vision_judge.build_messages` reused for chart reading | Owner-confirmed only |
| **Model Book / Setup Library** | Drafted examples (call + chart + outcome) and drafted playbook text in his own words | Admin approval queue → `modelbook_setup_examples` / playbooks | Never auto-published (D19) |
| **Owner voice** (morning-wire) and **desk creative** register | Author-filtered corpus export; a TSDR register file | Export file consumed by `build_voice_profile.py`; a register `.txt` beside the Qullamaggie one | Builders stay with their owners (D19) |
| **Tweets** | Official-account tweets copied into Wisdom sources | Hook on the existing poll/cleanup cycle | No second poller |
| **Desk FTS** (videos, articles) | Nothing; reused as the W4 retrieval baseline | — | — |
| **desk_article_anchors / links** | Nothing; reused for the anchor price and cross-stream links | — | — |
| **Setup-name lists** (6) | The ONE vocabulary (D9), with `maps_to` for each list; lists derive from it in W6 | — | No seventh list |
| **Ask Notebook / J2 broker** | Nothing member-facing; owner-only reconciliation (D16) | Read-only service calls, owner `user_id` | Owner-private rule §0.11 |

**Storage (final):**

| Item | Where | Notes |
|---|---|---|
| Records | `/data/wisdom.db` on the `web` volume (`WISDOM_DB_PATH`) | |
| Text snapshots | R2 `uct-bars-snapshots`, prefix `wisdom/sources/<stream>/<source_id>/v<n>.txt.gz` | |
| Chart images | R2 `wisdom/charts/<sha256>.jpg`, fetched **PC-side** from the public CDN | No Railway egress |
| Daily context archive (D12) | R2 `wisdom/context/<YYYY-MM-DD>/<family>.json.gz`, plus an index table | |

- **Runtime:**
  - Light ingest, Batch submit/reap and outcomes run on `web` scheduler threads.
  - Replay, look-alike scans, video frame extraction and the KB sync run **PC-side** under `uct-clips/tools/heavy_lock.py`, never on the prod web pod.
- **Egress:** R2 charges no egress. Text uploads from `web` are about 100 KB/day; images are PC-side.

---

## 4. Schema v0

`/data/wisdom.db`, WAL mode. Times are ET ISO-8601 with an offset. **Every extracted field carries provenance** (§4.7).

### 4.1 `wisdom_sources` — immutable

**Columns:**
- `source_id` PK
- `stream`: `zoom_live | workshop | interview | education | discord | x | sunday_scans | sunday_scans_chart | owner_trade | owner_note | model_book | owner_feedback`
- `external_ref`, e.g. `edu_videos:<id>` · `substack:<post url>` · `substack_img:<post url>#<n>` · `discord:<channel>:<msg>` · `x:<handle>:<tweet id>`
- `home_pointer`, the row in its existing store
- `version`, `supersedes_source_id`
- `published_at_et`, `recording_started_at_et`
- `title`, `show`, `host_speaker_id`, `guest_names`
- `raw_pointer` (R2), `raw_sha256`, `media_pointer`
- `coverage_ratio`; a source is `incomplete` when below 0.8
- `ingested_at`, `ingest_version`

⛔ Re-ingestion writes a **new version row**. Unique key `(stream, external_ref, raw_sha256)`.

### 4.2 `wisdom_speakers` + `wisdom_speaker_aliases`

- **Roles:** `owner | team | guest | attendee`; plus `can_author_calls`.
- **Seeded aliases:**

| Alias | Maps to |
|---|---|
| `Patrick (TSDR)`, `Patrick TSDR)`, `Uncharted Territory`, `TSDR Trading`, `TSDR_Trading` | owner |
| `Brac`, `Bracco`, `Braczyy` | Bracco |
| `Ravi` | team (MENTION only, D3) |
| Guests | from the video title |

- Any label not in the table becomes `attendee` at ingest, and its name is not stored.

### 4.3 `wisdom_segments`

**Columns:** `segment_id`, `source_id`, `ordinal`, `kind` (`section|cue_window|message|image|frame`), `path`, `t_start_s`, `t_end_s`, `char_start`, `char_end`, `speaker_id`, `speaker_confidence`, `text`, `text_sha256`, `normalizer_version`.

**Segmentation:**

| Stream | Rule |
|---|---|
| Sunday Scans | by heading, with the author from the signed section |
| Chart image | one segment, labeled by the nearest earlier short line |
| Zoom / education | ticker-mention windows (±60 s) plus chapter boundaries |
| Discord / X | a message, or a 10-minute same-author chain |

**Normalization v0:** cue text with the `<speaker ≤40>: ` prefix stripped, cues joined by one space (implemented in `tools/wisdom_golden_verify.py`).

### 4.4 `wisdom_records` — CALL · NEGATIVE_CALL · MENTION · CHART_EVIDENCE

**Columns:**
- **Identity:** `record_id`, `record_type`, `segment_id`, `speaker_id`
- **Timing:** `stated_at_et`, `stated_at_precision` (`minute|day|week`), `event_at_text`
- **Instrument:** `entity_id`, `ticker_as_written`, `ticker_as_heard`
- **Setup:** `setup_vocab_id`, `setup_name_raw`, `direction`, `timeframe`, `trigger_timeframe`, `trigger`
- **Stance:** see the enum below
- **Levels:** `entry`, `entry_zone_lo`, `entry_zone_hi`, `stop`, `stop_text`, `targets`, `levels` (each `{type, price, price_as_heard}`), `size_shares` (owner-private)
- **Judgment:** `thesis`, `confidence_language`, `reason`, `reason_class` (`chart|liquidity|opportunity_cost|fundamental|none`), `stated_outcome`
- **Extraction:** `extraction_confidence`, `extractor_version`, `superseded_by`, `review_state`

**Stance enum:**

| Record type | Allowed stances |
|---|---|
| CALL | `watching`, `taking`, `in_it`, `added`, `trimmed`, `exited`, `stopped_out`, `hindsight` |
| NEGATIVE_CALL | `passed`, `avoid` |
| MENTION | `no_view` or NULL |

**CHART_EVIDENCE** (a chart image or video frame) adds `image_pointer`, `image_sha256` and `vision_reading`:
- `timeframe`
- `drawn_levels[]` `{price, kind: support|resistance|trendline|box|avwap|gap, as_drawn}`
- `ma_set`, `annotations_text`, `setup_seen`, `vision_confidence`

It links to the CALL/MENTION it illustrates. A drawn level is **as drawn**, never inferred.

### 4.5 `wisdom_principles` + `wisdom_principle_support` + `wisdom_principle_evidence`

- **Principle:** `principle_key`, `statement`, `category`, `author_speaker_id` (guest-attributable), `canonical` (owner), `first_seen_at`, `times_reinforced`, `empirical_claim`
- **Support:** `(principle_key, record_id, relation ∈ states|reinforces|qualifies|contradicts)`
- **Evidence (D15):** `(principle_key, test_id, methodology_version, universe, window, n, effect, ci_lo, ci_hi, verdict ∈ supported|not_supported|inconclusive, computed_at)`

### 4.6 `wisdom_outcomes` (computed) + `wisdom_context_snapshots` (D11)

- **Outcomes:** as in methodology §7.3.
- **Context snapshot** per record, as of `stated_at`:
  - `snapshot_id`, `record_id`, `as_of`, `methodology_version`
  - `market`: SPY/QQQ/IWM position vs 10/20/50/200 moving averages, UCT exposure/regime, breadth row, intraday breadth path if within 7 days, VIX
  - `sector_theme`: memberships as of date, theme momentum
  - `ticker_tech`: RS rank rebuilt from bars, relative volume, ATR extension, distance from moving averages, base/range stats
  - `event`: days to earnings, last earnings reaction, catalysts/news/tweets ±48h with pointers
  - `fundamental`: EPS/revenue growth from FMP history, estimate revision if a snapshot exists
  - `positioning`: flow and dark-pool summary, read-only; short interest/float **only if captured by D12 that day**
  - `unavailable[]`: families that were not recoverable, **named**, never zero-filled

### 4.7 `wisdom_field_provenance`

`(record_id, field, segment_id, char_start, char_end, t_start_s, t_end_s, bbox, extractor_version, confidence)`

- `bbox` is set for chart fields.
- Ask-AI citations resolve to a segment whose stored text or image contains the cited span.

### 4.8 `wisdom_ticker_aliases`

- **Columns:** `alias_as_heard`, `entity_id`, `scope` (`asr|company_name|slang`), `evidence_record`, `approved`.
- **Resolution order:**
  1. cashtag / exact symbol
  2. S3 `resolve(alias, as_of)`
  3. approved alias
  4. otherwise unresolved → MENTION with low confidence
- **Price scale:** rescale a spoken price only when the rescaled value falls inside that session's high/low.
- Approved aliases are proposed upstream to S3.

### 4.9 `wisdom_setup_vocab` + `wisdom_vocab_candidates` + `wisdom_vocab_maps`

- **The ONE vocabulary authority (D9).**
- `wisdom_vocab_maps(vocab_id, list_name, external_name)` covers all six existing lists plus pattern-engine IDs.

### 4.10 `wisdom_golden` + `wisdom_eval_runs` + `wisdom_context_archive_index` (D12)

### 4.11 Labeling rules R1–R10

- **R1 CALL.** Needs a resolvable instrument, a direction, and at least one of:
  - a stated price, zone or level;
  - a named observable trigger;
  - a position action.

  Otherwise it is a MENTION.
- **R2 Lists.** One MENTION per unique ticker; the reason comes from the author's own list definition.
- **R3 NEGATIVE_CALL.** Needs an explicit ticker and an explicit pass/avoid verb. "No thoughts on X" is `MENTION/no_view`.
- **R4 Hindsight / teaching examples.** Recorded as `CALL/hindsight`: excluded from replay, included in outcomes and clips.
- **R5 Levels as stated.** Textual derivations only when the text defines them (`breakeven` means stop = entry).
- **R6 Authorship.** Per §0.10, D3 and D4.
  - A transcript with no speaker labels: CALLs only when the show is single-host or the text self-identifies; otherwise PRINCIPLE/MENTION with `speaker_confidence=low`.
- **R7 Stated outcomes.** Captured and reconciled against computed outcomes, never overwritten.
- **R8 Principles.** A reinforcement attaches to an existing key; a contradiction links; canonical status is set by the owner only. Guest principles keep the guest as author.
- **R9 ASR.** Keep `*_as_heard`; plausibility-check the value or mark low confidence.
- **R10 Charts.** Drawn levels are recorded as drawn, and the label is the nearest earlier short line.
  - A chart whose label cannot be resolved is CHART_EVIDENCE with a null ticker, never guessed.
  - A vision reading that contradicts the author's text is flagged, never merged.

---

## 5. Ingestion plan (in value order)

Every job:
- runs on scheduler threads or PC-side, never in a request handler;
- is resumable, with a watermark on disk;
- fails closed and names what it skipped.

1. **Capture first (W1; D7 + D12).** Daily context archive of every family in §2.8, plus scanner candidates and `pattern_detections` before their prune.
2. **Zoom + back catalog (W1; D14).** All 319 transcripts, live ones after `insights_at` + 3 h.
   - Coverage gate: a transcript span under 0.8 of the YouTube `lengthSeconds` marks the source incomplete.
   - Show-aware authorship (R6).
3. **Sunday Scans text + charts (W2; D13).**
   - Text from `desk.db` published bodies.
   - Images fetched PC-side from the public CDN, stored by sha256, read with Opus vision (`vision_judge` message builder), linked to the call they illustrate.
   - `desk_article_anchors` gives the publish-time close.
4. **Discord (W3; D2).**
   - Poller mirrors `buzz_ingest`: allowlisted channels and authors only.
   - Backfill from 2026-02-20; the legacy corpus becomes version 0 (weak labels).
5. **X (W3; D17).**
   - Official-account tweets copied before the 7-day sweep.
   - Paid historical backfill via `search_tweets` `from:` + `until_time`.
6. **Video frames (W4; D13).** At each CALL timestamp:
   - `uct-clips` `source.acquire` (public YouTube) → `scan.sample_at` → `layout.decide` chart box → vision reading.
   - PC-side, under the heavy lock.
7. **Owner-authored product data (W2–W3; D17).**
   - Model Book setup examples and playbooks, owner `pattern_feedback`, `wire_feedback` owner notes.
   - All treated as labeled data.
8. **Owner trades / notes (W3; D16).** Read-only, owner-private reconciliation.

---

## 6. Extraction and costs (pricing verified against the Claude API reference, 2026-09-13)

**Model:** `claude-opus-5` via the **Message Batches API** (D5 = YES).

| Rate | Value |
|---|---|
| Opus 5 input | $5 / M tokens |
| Opus 5 output | $25 / M tokens |
| Batch discount | 50%, stacking with cache pricing |
| Cache read | 0.1× |
| Cache write | 1.25× (the cost guard must count both) |
| Images | up to 2576 px long edge / ≈ 4,800 tokens per image at full resolution |

**Ledger:** `api/services/llm_batch.py` (durable file ledger, keyed by `custom_id`).
**Budget rail:** `WISDOM_EXTRACT_DAILY_USD_CAP`, via a cost guard that counts cache tokens.

| Work | Volume (measured) | Estimate |
|---|---|---|
| Back-catalog transcripts (D14) | 20.3M chars ≈ 5.8–6.8M input tokens | **≈ $30–80 one-time** (output + thinking dominate the range) |
| Sunday Scans charts (D13) | 2,953 images | **≈ $15–50 one-time** (downsampled vs full resolution) |
| Ongoing (≈ 2 videos/day + weekly issue + Discord + X) | ≈ 1.2–1.5M input tokens/month | **< $15/month** |
| Video frames at calls (D13) | ≈ 20 frames/session | ≈ $2–5/month |
| X historical backfill (D17) | TwitterAPI.io ≈ $0.15 per 1k tweets | a few dollars |

- Every estimate is re-measured in W1 with `count_tokens` on real inputs and written to `LEDGER.md` before the first run.
- All items are below the owner's $100/month surface-before-building line.
- **Model routing:** the doctrine allows a cheaper model only if it **ties** Opus on the golden set.

---

## 7. Evaluation methodology v0

Every metric is a `tools/wisdom_*.py` script with a versioned `docs/wisdom/methodology/<metric>-vN.md`, and every figure prints as `k/n`.

### 7.1 CALL-REPLAY → UCT-see rate

- **Population:** CALLs with stance `watching | taking | in_it | added`, a resolved entity, minute or day precision, **author TSDR or Bracco**. Hindsight is excluded.
- **As-of rules:** pre-open calls are judged against the prior close. Intraday calls are judged against both pre-open and end-of-day output.
- **Hit levels:**

| Level | Meaning |
|---|---|
| H0 | the ticker is in any UCT output |
| H1 | in the top N |
| H2 | tagged with the matching setup (via `wisdom_vocab_maps`) |

- **Lead/lag** is reported as a distribution.
- **Breakdowns:** by setup, stream, month and **context regime (D11)**.

### 7.2 FALSE-POSITIVE eval

- **Population:** `NEGATIVE_CALL` with `reason_class=chart`.
- **Measured:** the share of those that UCT flagged with a setup.

### 7.3 OUTCOME-weighted eval

- **Anchor:** the stated entry if the session traded through it; else the anchor session close. After 16:00 or on a weekend, the next open.
- **Horizons:** 1, 3, 5, 10 and 20 sessions.
- **MFE/MAE** within the horizon.
- **Stop/target hits** from high/low. A same-bar ambiguity is resolved with intraday data only, else left unresolved.
- **Weighting:** capped `f(R at 10 sessions)`, always printed beside the raw rate.
- **Missing bars** are `unverifiable`, never 0.

### 7.4 ASK-AI grounding eval

- **Questions:** 20 fixed, across three shapes.
- **Runs:** with vs without, back to back in one session, median of 3.
- **Order:** the grounding audit runs first.
- **Citation check:** every citation must resolve to a segment whose stored text or image contains the span, or it fails.

### 7.5 Extractor golden gate

- **Minimum:** ≥ 50 owner-confirmed segments.
- **Label sources** for the extra ones: owner Model Book examples, owner `pattern_feedback`, and ≥ 10 Discord messages.
- **Metrics:** P/R/F1 per record type, plus exact-match on entry, stop, ticker and stance, with Wilson intervals.
- **Regression blocks shipping.**
- **Charts:** a separate chart golden set of ≥ 30 images (labels, drawn levels) gates the vision reader.

### 7.6 PRINCIPLE LAB (D15)

- Each empirical principle gets a pre-registered test (hypothesis, universe, window, statistic) on UCT bars and earnings data.
- It is run once. The result is written to `wisdom_principle_evidence` with n and a CI.
- **No post-hoc re-tuning of the test to the result.**
- Contradictions go back to the owner as questions, not verdicts.

### 7.7 LOOK-ALIKE eval (D20)

- The daily look-alike list is scored by CALL-REPLAY on the last 90 days of calls and by the false-positive eval.
- Its hit rate is shown **beside the base rate of a random liquid name** before any member sees it.

---

## 8. Flags (names reserved; none declared yet)

All are enablement gates, unset = OFF, each declared in the same commit as its read site.

| Flag | Gates | Wave |
|---|---|---|
| `WISDOM_INGEST_ENABLED` | master switch for scheduled jobs | W1 |
| `WISDOM_CAPTURE_SCANS_ENABLED` | candidates and `pattern_detections` capture (D7) | W1 |
| `WISDOM_CONTEXT_ARCHIVE_ENABLED` | daily capture-now archive (D12) | W1 |
| `WISDOM_ZOOM_INGEST_ENABLED` | Zoom / workshop / interview / back catalog (D14) | W1 |
| `WISDOM_EXTRACT_ENABLED` + `WISDOM_EXTRACT_DAILY_USD_CAP` | Batch extraction | W1 |
| `WISDOM_CONTEXT_SNAPSHOT_ENABLED` | per-call context fingerprint (D11) | W1 |
| `WISDOM_SUNDAY_SCANS_INGEST_ENABLED` | published text | W2 |
| `WISDOM_CHART_VISION_ENABLED` | Sunday Scans charts + video frames (D13) | W2/W4 |
| `WISDOM_OUTCOMES_ENABLED` | outcome engine | W2 |
| `WISDOM_PRINCIPLE_LAB_ENABLED` | principle tests (D15) | W2 |
| `WISDOM_WEEKLY_REPORT_ENABLED` | Sunday report | W2 |
| `WISDOM_KB_PUBLISH_ENABLED` | export feed consumed by `wisdom_kb_sync.py` (D6/D18) | W2 |
| `WISDOM_DISCORD_INGEST_ENABLED` | Discord | W3 |
| `WISDOM_X_INGEST_ENABLED` | official-account persistence + backfill (D17) | W3 |
| `WISDOM_OWNER_LEDGER_ENABLED` | owner trades/notes reconciliation (D16) | W3 |
| `WISDOM_REVIEW_UI_ENABLED` | admin review surface | W1/W3 |
| `ASKAI_WISDOM_RETRIEVAL_ENABLED` + cohort `rollout:wisdom-askai` | Ask-AI retrieval | W4 |
| `WISDOM_BADGES_ENABLED` + `VITE_WISDOM_BADGES_ENABLED` | badges via `ticker_mentions` | W5 |
| `WISDOM_CLIP_HANDOFF_ENABLED` | clip handoff | W5 |
| `WISDOM_TEACHING_DRAFTS_ENABLED` | Model Book / playbook / voice drafts (D19) | W5 |
| `WISDOM_LEVEL_ALERTS_ENABLED` | S7 stated-level alerts, admin (D20) | W6 |
| `WISDOM_LOOKALIKE_ENABLED` | look-alike list, admin (D20) | W6 |

---

## 9. Privacy, content and storage

- **Speakers:** unknown labels become `attendee` before the write; the name is never stored.
- **Discord:** allowlisted channel IDs **and** author IDs only; member messages are never stored.
- **Paid content:** `require_paid` plus S12 cohort during dark phases.
- **Owner-private:** trades, notes, share sizes and P&L go to the owner review surface only; a route test enforces it.
- **Public repo** (§0.7): samples, golden labels, owner data and chart readings with owner positions stay out of git.
- **Substack:** published posts only, with no credential and no write-capable import (§0.9).
- **Storage:** §3 table.

---

## 10. Golden set v0 and Setup Vocabulary v0

- **Golden set v0:** 30 records (CALL 14 · NEGATIVE_CALL 4 · MENTION 5 · PRINCIPLE 7), gitignored at `data/wisdom/golden/golden-v0.draft.jsonl`.
  - Verified: every quote occurs exactly once (`python tools/wisdom_golden_verify.py`; `--self-check` PASS).
  - Awaiting owner corrections.
  - **Added label sources for W1:** owner Model Book setup examples, owner `pattern_feedback`, ≥ 10 Discord messages, and a chart golden set of ≥ 30 images.
- **Setup Vocabulary v0:** 32 candidates (23 setup · 5 level · 4 market_signal), in `vocabulary/setup-vocabulary-v0.draft.json`.
  - D9 = YES: the owner's names are canonical.
  - W1 adds `wisdom_vocab_maps` rows for all six existing lists and the curriculum glossary.
  - Name conflicts to map: 20EMA vs `pullback_to_21ema`; HVC vs "High Volume Edge"; ER gap up vs PEG.

---

## 11. Wave order (updated for the expanded scope)

| Wave | Delivers (dark) | Exit criterion (measured) |
|---|---|---|
| **W1** | **Capture first** (D7 + D12 daily archive); schema + `wisdom.db`; the Substack import-ban rail (§0.9); speaker and ASR tables; **back catalog + Zoom ingestion** (D14) with the coverage gate; per-call context snapshot v0 (D11); golden set ≥ 50 plus minimal golden review; extractor v1 through the gate; CALL-REPLAY v0 on replayable detectors | Archive rows land daily with named gaps; the import-ban rail fails on a planted import; golden gate passes; 319 sources ingested with named `incomplete` ones; first UCT-see rate as `k/n` |
| **W2** | Sunday Scans text **and charts** (D13) with the chart golden gate; outcome engine; principle lab v0 (D15); **KB publish feed + `wisdom_kb_sync.py`** staged admin-only (D6/D18); weekly report | One Sunday cycle reconciled; ≥ 1 principle test pre-registered and run; KB rows for the admin cohort cite a dated, signed source |
| **W3** | Discord (D2); X persistence + backfill (D17); owner trades/notes reconciliation (D16); full admin review surface | A real #tsdr call extracted within one poll; official tweets survive past day 7; owner ledger visible only to the owner |
| **W4** | Ask-AI retrieval (FTS baseline → Wisdom block) with S8 citations; D18 supersede of the misattributed KB rows for the admin cohort; video frames at calls (D13) | Grounding eval with Wisdom beats without it (median of 3); 0 unresolvable citations; 0 "Bonde"-attributed TSDR rows in admin answers |
| **W5** | Badges via `ticker_mentions`; clip handoff; teaching drafts + voice refresh (D19) | Owner approves ≥ 1 drafted Setup Library example; `owner_voice` rebuilt from the current corpus |
| **W6** | Monthly recognition proposal; look-alike list + stated-level alerts, admin-only (D20); setup lists deriving from the vocabulary | Owner decision recorded; look-alike hit rate shown beside its base rate |

Members' "This week in UCT" stays out of scope until the admin loop has run for ≥ 4 weeks.

---

## 12. Decisions

### Answered — owner, 2026-09-13: **all YES**

| # | Decision | Answer |
|---|---|---|
| D1 | Keep paid text, golden labels and position details out of the public repo | **YES** |
| D2 | Grant the bot read on #tsdr; ingest only owner and team there | **YES** (grant pending: §13) |
| D3 | CALL authors = TSDR and Bracco; others MENTION | **YES** |
| D4 | Unsigned Sunday Scans sections = TSDR | **YES** |
| D5 | `claude-opus-5` via Batch; smaller models only on a golden-set tie | **YES** |
| D6 | Storage — owner: *"check everything first and merge with existing systems … your call"* | **YES → resolved as the MERGE MAP (§3)** |
| D7 | Capture scanner candidates and detections from W1 | **YES** |
| D8 | Hindsight examples excluded from UCT-see rate, used for outcomes and clips | **YES** |
| D9 | Owner's names canonical; code names map to them | **YES** |
| D10 | Recover the Stockbee workshop from Zoom trash; hand the defect to the Desk owner | **YES** (recovery pending: §13) |
| — | Sunday Scans: published posts only, never drafts | **RULE** (§0.9) |

### Open — D11–D20 (yes/no; recommendation stated)

| # | Decision | Rec. |
|---|---|---|
| **D11** | **Context fingerprint on every call.** Snapshot, as of the minute he said it: index position vs MAs, UCT exposure/regime, breadth, VIX, the name's theme/sector, RS rank, relative volume, extension, days to earnings and last reaction, catalysts/news/tweets ±48h, growth numbers, flow/dark pool — with named gaps. Result: learn *which conditions he acts in and which conditions made calls work*. | **YES** |
| **D12** | **Daily capture-now archive** of everything §2.8 shows being pruned or overwritten (intraday breadth path, intraday VIX, tweets, news-tile headlines, screener rows, RS ranks, wire payload, theme memberships, short interest/float/price targets, GEX, classification), to R2. Without it, context for today's calls is gone within 7 days. | **YES** |
| **D13** | **Learn from the visuals.** Read all 2,953 published Sunday Scans charts plus the screen-share frame at every call timestamp with Opus vision (timeframe, drawn levels/trendlines/boxes, MAs, setup). Link each chart to its call; confirmed ones feed Pattern Vision exemplars and Model Book examples. ≈ $15–50 once, ≈ $2–5/month. | **YES** |
| **D14** | **Ingest the whole back catalog**: all 319 transcripts (live sessions, Mental Game, Setups & Strategies, 35 interviews, 24 workshops, Options & Flow, Risk…), with guest teachings attributed to the guest. ≈ $30–80 once. | **YES** |
| **D15** | **Principle lab.** Test every principle that makes a factual claim ("ER gap-ups continue better than gap-downs", "mid-30s win rate", "20EMA tap after a wedge pop") on UCT data with n and confidence intervals, pre-registered, so Ask-AI can answer *"does it work?"* with numbers. Measurement only. | **YES** |
| **D16** | **Owner ground truth, private.** Reconcile your stated calls with your own broker-synced J2 trades (fills, exits, results) and let Wisdom search your own Notebook notes — read-only, owner-only, never shown to members. | **YES** |
| **D17** | **More streams.** Persist TSDR_Trading / Braczyy / 1ChartMaster tweets (already polled, deleted after 7 days) plus a paid X history backfill; team Discord channels; your Model Book examples, playbooks, pattern thumbs and wire-feedback notes as labeled data. | **YES** |
| **D18** | **Repair what the system already recalls.** Replace the 7-month-stale brain-KB Sunday Scans rows (456 credited to "Bonde", only 30 actually his) with dated, signed, linked Wisdom rows; source or retire the 36 unsourced voice principles; normalize trader names. Changes what Ask-AI and Compass cite: admin cohort first. | **YES** |
| **D19** | **Teach back in your voice — drafts only.** Refresh the Morning Wire owner-voice profile weekly from the full corpus; create a TSDR register for Desk titles; draft the 17 missing Setup Library playbooks and Model Book examples from your own words and best outcome-verified calls. Every draft owner-approved; never auto-published; never Substack. | **YES** |
| **D20** | **Live admin intelligence.** (a) An admin alert when price reaches a level you stated on an open call (S7 price-level); (b) a daily "looks like what TSDR buys" list from your outcome-verified calls plus context, scored against its base rate before any member sees it. No detector edits. | **YES** |

---

## 13. Owner-only tasks

1. **Answer D11–D20.**
2. **Discord (D2):** grant the bot's role *View Channel* + *Read Message History* on `#tsdr` and each trade-alert or team channel; reply with those channel IDs and the team members' Discord user IDs.
3. **Zoom (D10):** Recordings → Trash → recover "Workshop with Stockbee" (2026-09-11) before ~2026-10-11.
4. **Golden labels:** review the 30 draft records (Session 0 report); reply with corrections by `gid` or "confirmed".
5. **If D16 = YES:** confirm which J2 account(s) are yours to reconcile.
