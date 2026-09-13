---
id: WISDOM-LOOP-MANIFEST
title: UCT Wisdom Loop — Program Manifest
status: Session 0 (discovery) complete · nothing merged · no flag declared
branch: feat/wisdom-loop (cut from origin/master f4fc5d1c1, 2026-09-13)
owner: Patrick (TSDR) · decisions: §11 · owner-only tasks: §12
---

# UCT Wisdom Loop — Program Manifest

> **One sentence.** Turn what UCT teaches and calls every day (Zoom live sessions, workshops,
> Discord, Sunday Scans) into structured, provenance-carrying records, tie every call to what the
> market did next, and use the result to ground Ask-AI, to *measure* whether the platform sees
> what Patrick sees, and to drive every recognition change — dark, measured, owner-flipped.

Companion files: `LEDGER.md` (commit ledger) · `vocabulary/setup-vocabulary-v0.draft.json`
(Setup Vocabulary v0) · `golden/golden-v0.provenance.json` (quote-free provenance of the 30
draft golden records) · `tools/wisdom_golden_verify.py` (the verifier).

---

## 0. Standing rules for this program (tightened charter)

1. **Repo rules first.** CLAUDE.md governs. One master merge at a time, repo-wide, and Railway
   `web` SUCCESS must be observed before the next push. `docs/runbooks/deploy-windows.md` is the
   only authority on push timing. Backend pytest is always SCOPED to named files. A test-runner
   exit code counts only with a totals line.
2. **Dark by default; Patrick alone flips.** Every capability ships behind a flag that is unset =
   OFF. Its flag is declared in `docs/feature_flags.json` in the **same commit** as its read site
   (`tests/test_feature_flag_ledger.py` fails on a declaration with no gate). Nothing
   member-visible changes without an owner approval line in `LEDGER.md` §4.
3. **Ledger every commit** on program-created paths (`LEDGER.md`).
4. **Forbidden paths:** `app/src/pages/journal-2-0/**`, `**/lib/offline/**`, `OptionsFlow.jsx`,
   and every flow-worker watched file (the list is in `deploy-windows.md`).
5. **Consume, never fork:** S3 Entity Master (`api/services/entity_master/api.py::resolve`), S8
   provenance (`app/src/components/provenance/`), D2 canonical addressing
   (`api/services/canonical/`), S12 cohorts (`api/services/rollout.py`), S7 alert taxonomy
   (`api/services/alert_taxonomy/`), and the Desk insights pipeline
   (`api/services/desk_session_insights.py`). Where one of them lacks what this program needs,
   the gap is written up for that program's owner. It is never re-implemented here.
6. **Standing holds this program must honour:**
   - The Pattern Intelligence Lab is **PAUSED** (owner, 2026-09-07). The scanner release train is
     on a **HARD HOLD**.
   - CALL-REPLAY may *run* detectors read-only to measure them. It never edits, tunes or promotes
     one.
   - Monthly recognition changes (W6) are **proposals**, measured and parked until the owner
     decides.
7. **Public repository.** `unchartedterritory5995-cyber/UCT-Dashboard` answers the anonymous
   GitHub API with `"visibility": "public"` (measured 2026-09-13).
   - **No verbatim paid-session text, transcript sample, golden label or owner position detail is
     ever committed.**
   - Samples and golden records live under the gitignored `data/wisdom/**`, and production records
     live in `/data/wisdom.db`.
   - Only quote-free artifacts reach git: schema, provenance hashes and spans, names, locators, and
     Sunday Scans quotes, since that newsletter is published free.
8. **Every number has its sample size printed beside it. `0/0` prints as `0/0`, never a
   percentage.**

---

## 1. What this program consumes or feeds — surfaces with file paths

| Surface | Path | Role for Wisdom Loop | On master? |
|---|---|---|---|
| Ask-AI context assembly | `api/routers/ai_search.py`: `_uct_context` (`_add`, `_INTENT_SPECS`, `_perticker`), `_grounded_system`, `_brain_context`, `fast_lane_answer` | **W4 insertion point.** Retrieval needs an embedding call, so it goes in `_grounded_system` beside `_brain_context` (which callers already run off the event loop), not in `_uct_context`. | yes |
| Ask-AI exam | `api/services/ai_search_eval/` (`golden_set_search.json`, `runner.py::run_exam`, `run_grounding_audit`) | Home of the ASK-AI GROUNDING EVAL. The free `--grounding-audit` runs first. | yes |
| Brain KB | `api/services/brain_kb_service.py` (includes 591 `discord:#tsdr:%` CASE_STUDY rows) | **De-duplication hazard:** Wisdom retrieval must not double-cite #tsdr rows the brain already serves. | yes |
| Desk transcript search | `api/services/education_search.py`: FTS5 `edu_search(video_id,title,headline,chapters_text,transcript)` | Cheap W4 retrieval baseline. **Ask-AI never calls it today.** | yes |
| S8 provenance UI | `app/src/components/provenance/{Provenance,Cited,FreshnessBadge,CoverageLine}.jsx`; `api/routers/provenance_bar.py` | Citation rendering. `AskAiTab.jsx` uses `<Provenance>`; the rail `research/i1S8Boundary.test.js` forbids hand-rolled provenance. | yes |
| D2 addressing | `api/services/canonical/` (CP2, one reader, dark) | `<Cited row={{uctUri}}>` waits on D2's recursive `uctUri`. A `uct://wisdom/segment/<id>` address must be coordinated with the D2 owner. | partial |
| S3 Entity Master | `api/services/entity_master/api.py::resolve(alias, as_of=None) -> ResolveResult{status,entity,candidates}` | Ticker resolution, never guessing between candidates. It does **not** cover ASR mishearings ("light" for LITE); that is §3.8. | yes |
| S7 alert taxonomy | `api/services/alert_taxonomy/registry.py::register_trigger_type`; durable fires in `alert_fires` | W6 proposal target for owner-coined signals ("Kill Bar", "Theme Hot Potato"). | yes |
| S12 cohorts | `api/services/rollout.py::cohort_user_ids`, `includes`; tags `rollout:*` in `user_tags` | Admin cohort for every dark consumer. An empty cohort means nobody. | yes |
| Desk recording pipeline | `api/routers/desk_zoom_webhook.py`, `api/services/{zoom_client,desk_session_jobs,desk_daily_session}.py` | Source of Zoom and workshop recordings. | yes |
| Desk insights extractor | `api/services/desk_session_insights.py` (VTT to `edu_videos.transcript`; Opus `setups` against `_SETUP_TAXONOMY` (26 names), `ticker_moments`, chapters) | **Existing precursor extractor. Consume its outputs; do not fork.** W6 proposes it read the Wisdom vocabulary. | yes |
| Education store | `/data/education.db` `edu_videos` (`transcript`, `chapters`, `ticker_moments`, `setups`, `meeting_uuid`, `media_started_at`, `insights_at`, `zoom_cleaned`) | Zoom and workshop SOURCE of record. | yes |
| Desk/Substack store | `/data/desk.db` `substack_posts` (`body_raw`, `body_html`, `sections_json`, `tickers_json`, `published_at`) + FTS; `api/services/substack_poller.py`; `desk_store.sunday_scans_posts` | Sunday Scans SOURCE of record. | yes |
| Discord reader | `api/services/buzz_ingest.py` (bot token, resumable backfill watermark, stores NO text) | The pattern to mirror for the Discord ingester. | yes |
| Bars | `api/services/bars_sqlite.py` (`get_bars_before`, `closes_asof`, `nth_recent_trading_date`); `/data/bars.db` `ohlcv(ticker,tf,ts,…)` | OUTCOME engine input. | yes |
| Pattern engine | `api/services/pattern_engine/__init__.py::detect_all`; 85 `_PATTERN_ID`s | CALL-REPLAY (cut bars at the call date, read-only). | yes |
| Screener backtest | `api/services/screener/backtest.py` (refuses fields with no history) | CALL-REPLAY for bar-only formulas. | yes |
| Recorded scan outputs | `patterns.db` `pattern_detections` (**120-day retention**), `pattern_vision.db` `pattern_verdicts`, `catalysts.db` `catalysts`, `screener.db` `scan_hits`; engine DB `leadership_snapshots` (from 2026-02-19), `setup_triggers` (from 2026-07-30, has `ret_3d..20d`) | CALL-REPLAY for families that cannot be replayed. | yes |
| Clip pipeline | `uct-clips` (faster-whisper large-v3 word timings; `speaker_allowlist`, `face_speakers`) | W5 handoff: segment boundaries and call timestamps. | separate repo |
| Flag ledger | `docs/feature_flags.json`, `tests/test_feature_flag_ledger.py`, `tools/flag_ledger_audit.py` | Flag declarations. There is no `docs/frontend_feature_flags.json` on master; frontend flags go in `feature_flags.json` → `build_flags` (`tests/test_vite_flag_ledger.py`). | yes |

---

## 2. Session 0 findings — what exists vs what is missing, per stream

### 2.1 Zoom live sessions — the highest value, and less clean than it looks

**Exists (measured on production, 2026-09-13):**
- **Pipeline:** Zoom Automatic Cloud Recording → `recording.completed` → `desk_session_jobs` → YouTube upload → `edu_videos` row.
- **Transcripts:** `desk_session_insights` fetches Zoom's own VTT, stores it as `[H:MM:SS] Name: text` (start times only, capped at 600,000 chars), then **trashes the Zoom cloud copy**. The raw VTT and AI-Companion summary are never kept.
- **Timestamp anchor:** `desk_session_jobs.start_time` / `edu_videos.media_started_at` plus the cue offset gives minute-precision wall-clock `stated_at`. Verified: the 9/11 session's job started 12:51:59 UTC = 08:51:59 ET, and the transcript's own "market opens in about 18 minutes" at t=00:20:52 puts t0 at 08:51:08 ET.
- **Read path:** `GET /api/desk/recap-source/{id}` and `GET /api/education/videos/{id}/transcript-cues` (PUSH_SECRET bearer plus a browser User-Agent).
- **Zoom for Claude MCP:** configured as a claude.ai connector (`~/.claude.json`; permission for `recordings_list` only) but **not loaded in this Claude Code session**. The repo's S2S app is the programmatic path.

**Measured problems** (39 videos, ids 318–356; stats only, no content):

| Finding | Evidence | Consequence |
|---|---|---|
| **Speaker names are unstable** | Owner appears as `Patrick (TSDR)`, `Patrick TSDR)` and `Uncharted Territory` (his own Zoom account); co-host as `Brac` and `Bracco`; plus `Ravi` | A speaker-alias table is required (§3.2). Never key on the raw label. |
| **One-label sessions are common** | 7 of 25 sessions of 60+ minutes carry a single speaker label (322, 323, 329, 332, 339, 352, 355). In 355, `Go ahead, Blake.` [00:52:02] is followed by no other speaker. | A CALL's author cannot be inferred from the label alone in those sessions. Extraction confidence is capped when `distinct_speakers == 1` and the text addresses a second host. |
| **ASR mangles tickers and prices** | `light` for LITE, `Soxel`/`Socksville`/`Toxel` for SOXL, `MBIS` for NBIS, `TQQ` for TQQQ, `FMGU` for FNGU, `Zebra` for ZBRA, `mRNA` for MRNA; `9.30` for $930, `$9.24` for $924; `chairs` for shares; "Brian Shannon" heard three different ways | S3 `resolve()` cannot fix these. A price-plausibility-checked ASR alias layer is required (§3.8). |
| **Truncated transcripts: a LIVE Desk-pipeline defect** | Video 356 "Workshop with Stockbee": the YouTube video `rKVAkk3811Q` is **6,830 s**; the stored transcript covers **288 s (4%)** of pre-roll chatter, and the interview itself is absent. Control: video 355 is 9,956 s against a 9,863 s transcript span (99%). **Coverage sweep across ids 318–356** (the last cue offset from `transcript-cues` divided by the public YouTube `lengthSeconds`): **33 of 34** measurable videos cover ≥ 98%, and **1 of 34 is truncated (356, 5.1%)**. Four lengths could not be read (324, 352, 353, 354) and 326 returns 404. ⚠️ A first pass parsed `recap-source.transcript` with an `[H:MM:SS]` regex and flagged nine short shows as 0% covered. That was an **instrument artifact**: those rows store their stamps in a form the regex does not match, and a layer that could not be read is not a layer that is empty. The server-parsed cue endpoint is the authority. | The Wisdom corpus silently loses exactly the long-form teaching it most needs. **Not this program's file to fix**; filed to the Desk owner (§11 D10, §12). Zoom trash keeps the copy about 30 days, so recovery closes around 2026-10-11. |
| **Stop/restart makes duplicate stub publishes** | Two "Evening Update" jobs 2 minutes apart on 2026-09-10 (videos 353: 2 cues; 354: 26 cues) | Wisdom de-duplicates sources by meeting and time window, never by title. |

**Missing:** raw VTT retention, a structured speaker field, speaker identity for one-label sessions, and ticker/price correction.

### 2.2 Workshops

**Exists:** the same pipeline. The topic route `Workshop*` goes to the "Workshops & Fireside Chats" section (`_HOST_AWARE` in `desk_daily_session.py`), and the public YouTube video exists.
**Missing:** a complete transcript for the one recent workshop (above); teaching-structure extraction; example-to-chart links.
**Note:** chapters come from Zoom AI Companion and were computed from the truncated transcript too, so they describe the pre-roll.

### 2.3 Sunday Scans

**Canonical source: the published Substack post** (`unchartedterritoryy.substack.com`), mirrored hourly into production `desk.db.substack_posts` with full `body_raw`/`body_html`.

The other artifacts are secondary:
- The local scrape `uct-intelligence/data/intake/substack_uct_full_archive_2026-09-11.txt` (94 posts, 67 Sunday Scans, newest 2026-09-06) is a lossy text copy with no headings, links or images.
- `uct-sunday-scan` produces **drafts**, which are not issues.

**Structure seen in both samples:**

| Section | Author |
|---|---|
| INTRO | unsigned |
| Earnings & Economic Calendar | unsigned |
| Market Breadth Data | unsigned |
| Index & ETFs (QQQ, SPY, IWM, SMH, XBI, IGV/CIBR, TLT) | unsigned |
| Bracco's Breakdown & Top Ideas | Bracco |
| TSDR's Weekly Outlook & Watchlist | TSDR |

The TSDR section contains **Current Positions**: bare tickers on 2026-09-06, `TICKER entry stop X` on 2026-08-30. It also has **Charts Covered**, **Honorable Mention**, and per-chart notes.

**Missing:**
- A PUSH_SECRET door to article bodies. `GET /api/desk/articles/{slug}` needs a paid member session, so W2 reads `desk.db` in-process rather than over HTTP.
- An authorship rule for unsigned sections (D4).

### 2.4 Discord

**Exists:**
- The **UCT Intelligence bot** (app `1474900505917653142`) has its token on Railway `web` and in `uct_intelligence/.env`. It is a member of the member guild and the dev guild.
- **Measured 2026-09-13, with a control:** it reads `#main-chat` (200) but gets **403 on `#tsdr`**.
- The Message Content intent is evidently on, since buzz extracts tickers from content.
- Frozen, pre-classified `#tsdr` corpus at `uct_intelligence/data/processed/processed_messages.json`:
  - 7,766 messages, **2024-03-11 → 2026-02-20**; 7,567 by the owner.
  - `message_type`: trade_entry 1,031 · trade_exit 824 · analysis 727 · watchlist 439 · alert 361 · market_commentary 346 · educational 102 · other 3,936.
  - The brain KB holds it as 591 day-grouped rows.

**Missing:**
- Read access to `#tsdr`.
- Any capture since 2026-02-20: the `uct_intelligence` listener is **not running**, with no process and no scheduled task.
- A trade-alert channel ID anywhere in code, and a team author allowlist.

**Owner setup (§12):** in `#tsdr` (and each trade-alert channel to include), grant the bot's role **View Channel + Read Message History**. Then name the channel IDs and the team members whose messages count. No new bot or token is needed.

### 2.5 Bars, outcomes, replay

- **Daily bars:** split-adjusted, not dividend-adjusted, going back decades (AAPL from 1980). They carry **survivorship bias**: 3,066 tickers today against 1,700 in 2004, because delisted names are absent. For dead names, the raw flat files in `uct-intelligence/data/massive_cache` go back to 2003.
- **Intraday is shallow:** 60/30/15-minute from 2026-02-27, 5-minute from 2026-04-16, 1-minute from 2026-06-08.
- **Prod web holds the recent tail only;** full depth is on the worker and `C:\data`.
- **Verdict on OUTCOMES:** computable from stored daily bars for every call from 2026 onward. Two exceptions:
  - A stop and target inside one daily bar can only be ordered with intraday bars (available from 2026-02).
  - A name with no bars is `unverifiable`, never zero.
- **Verdict on CALL-REPLAY:**
  - **Replayable** (cut bars at the call date): the 85 pattern-engine detectors; bar-only screener formulas; the leadership harness (engine repo, with a survivorship caveat).
  - **Not replayable, scored only from recorded output:** Finviz scanner candidates, catalysts, Pattern Vision, the theme engine.
- **Recorded output is being lost right now:**
  - `candidates.json` is overwritten daily with no archive.
  - `pattern_detections` prunes at 120 days.
  - Every day either goes uncaptured is permanently unscoreable. W1 starts capturing both (D7).
- **Replay cost:** about 3.7k symbols × sessions × detectors. Time one session before any full run, locally or on the worker, **never on the prod web pod** (OOM rule).

---

## 3. Schema v0

One SQLite database, `/data/wisdom.db` (env `WISDOM_DB_PATH`, default `/data/wisdom.db`; the
repo-root `conftest.py` census pins it automatically), WAL mode. Raw source text snapshots go to R2
(§8). All times are stored as ET ISO-8601 with the offset. **Every extracted field carries
provenance** (§3.7).

### 3.1 `wisdom_sources` — immutable

`source_id` PK · `stream` (`zoom_live|workshop|discord|sunday_scans`) · `external_ref`
(`edu_videos:<id>` · `substack:<post url>` · `discord:<channel_id>:<message_id>`) · `version` INT ·
`supersedes_source_id` · `published_at_et` · `recording_started_at_et` · `title` · `author_hint` ·
`raw_pointer` (R2 key) · `raw_sha256` · `media_pointer` (YouTube id) · `ingested_at` ·
`ingest_version`.

⛔ Re-ingestion writes a **new version row**; it never updates one. The `(stream, external_ref,
raw_sha256)` unique key makes an identical re-pull a no-op.

### 3.2 `wisdom_speakers` + `wisdom_speaker_aliases`

- `speaker_id` · `display_name` · `role` (`owner|team|guest|attendee`) · `can_author_calls` BOOL.
- Aliases: `alias` → `speaker_id`, seeded from the measured labels (`Patrick (TSDR)`, `Patrick
  TSDR)`, `Uncharted Territory` → owner; `Brac`, `Bracco` → Bracco; `Ravi` → team, pending D3).
- **Any label not in the table becomes `attendee` at ingest, and the name is not stored.**

### 3.3 `wisdom_segments`

`segment_id` PK · `source_id` FK · `ordinal` · `kind` (`section|cue_window|message|thread`) ·
`path` (e.g. `TSDR's Weekly Outlook & Watchlist > TWLO (Daily)`) · `t_start_s` · `t_end_s` ·
`char_start` · `char_end` · `speaker_id` · `distinct_speakers_in_source` · `text` · `text_sha256` ·
`normalizer_version`.

**Segmentation v0:**
- **Sunday Scans:** by heading, with author taken from the enclosing signed section.
- **Zoom/workshop:** ticker-mention windows of ±60 s around a resolved ticker, merged when they
  overlap, plus Zoom chapter boundaries as topic shifts. Clips reuse the same boundaries.
- **Discord:** one message, or a reply chain within 10 minutes by the same author.

**Normalisation v0** (the one definition; `tools/wisdom_golden_verify.py` already implements it):
- Transcript: cue text with a leading `<speaker ≤40 chars>: ` removed, cues joined by one space.
- Sunday Scans: text as-is.

### 3.4 `wisdom_records` — CALL · NEGATIVE_CALL · MENTION

**Columns:**
- Identity and source: `record_id` PK · `record_type` · `segment_id` · `speaker_id` · `stated_at_et` · `stated_at_precision` (`minute|day|week`) · `event_at_text` (e.g. "Friday").
- Instrument: `entity_id` (S3) · `ticker_as_written` · `ticker_as_heard`.
- Setup and direction: `setup_vocab_id` (NULL unless the entry is APPROVED) · `setup_name_raw` · `direction` (`long|short`) · `timeframe` · `trigger_timeframe` · `trigger`.
- Stance: see the enum below.
- Levels (JSON where plural): `entry` · `entry_zone_lo` · `entry_zone_hi` · `stop` · `stop_text` · `targets` · `levels` (each `{type, price, price_as_heard}`) · `size_shares` (owner-private).
- Narrative: `thesis` · `confidence_language` (verbatim phrases, never averaged) · `reason` · `reason_class` (`chart|liquidity|opportunity_cost|fundamental|none`) · `stated_outcome`.
- Extraction and review: `extraction_confidence` (`high|medium|low`) · `extractor_version` · `superseded_by` · `review_state` (`unreviewed|confirmed|corrected|rejected`).

**Stance enum:**

| record_type | allowed stances |
|---|---|
| CALL | `watching`, `taking`, `in_it`, `added`, `trimmed`, `exited`, `stopped_out`, `hindsight` |
| NEGATIVE_CALL | `passed`, `avoid` |
| MENTION | `no_view` or NULL |

### 3.5 `wisdom_principles` + `wisdom_principle_support`

- `principle_key` PK · `statement` · `category` (`risk|entry|exit|sizing|psychology|market_context|scanning`) · `canonical` (NULL until the owner rules) · `first_seen_at` · `times_reinforced` · `empirical_claim` BOOL.
- Support rows: `(principle_key, record_id, relation ∈ states|reinforces|qualifies|contradicts)`.
- A reinforcement attaches to the existing key; a contradiction links. Nothing is deleted.

### 3.6 `wisdom_outcomes` — computed, never extracted

`record_id` · `methodology_version` · `computed_at` · `bars_source` · `anchor_session` ·
`anchor_price` · `anchor_rule` · `ret_1` `ret_3` `ret_5` `ret_10` `ret_20` · `mfe_pct` · `mae_pct` ·
`stop_hit` (NULL when no stop) · `stop_hit_session` · `target_hit` · `target_hit_session` ·
`same_bar_ambiguity` · `resolved_with_intraday` · `n_sessions_available` · `stated_outcome_record_id`
· `reconciliation` (`agrees|disagrees|unverifiable`).

### 3.7 `wisdom_field_provenance` — the "why do you say that?" table

`(record_id, field, segment_id, char_start, char_end, t_start_s, t_end_s, extractor_version,
confidence)`: one row per extracted field. Ask-AI citations resolve to a `segment_id` whose text
contains the cited span, and that is checked mechanically (§6.4).

### 3.8 `wisdom_ticker_aliases` — the ASR layer S3 does not have

`alias_as_heard` · `entity_id` · `scope` (`asr|company_name|slang`) · `evidence_record` ·
`created_by` · `approved`.

**Resolution order:**
1. A cashtag or exact symbol.
2. S3 `resolve(alias, as_of)`.
3. An approved alias from this table.
4. Otherwise unresolved, and the record drops to MENTION with low confidence.

**Price-scale rule:** a transcribed price is rescaled (×10, ×100) only when the rescaled value falls
inside that session's high/low for the resolved ticker. Otherwise it stays unresolved.
Approved aliases are proposed upstream to S3; this table is a staging area, not a second authority.

### 3.9 `wisdom_setup_vocab` + `wisdom_vocab_candidates`

- `vocab_id` · `name` · `kind` (`setup|level|market_signal`) · `version` · `status` (`candidate|approved|retired`) · `definition` · `definition_record_id` · `aliases` · `maps_to` (desk taxonomy name, engine `_PATTERN_ID`) · `approved_by` · `approved_at`.
- Candidates: `(raw_name, first_seen_record_id, occurrences, status)`.

### 3.10 `wisdom_golden` + `wisdom_eval_runs`

- Golden: `gid` · `golden_version` · `segment_id` · expected record(s) as JSON · `label_status` (`claude_draft|owner_confirmed|owner_corrected`) · `labeled_by` · `labeled_at`.
- Eval runs: `run_id` · `kind` · `extractor_version` · `methodology_version` · `n` · `metrics` · `created_at`.

### 3.11 Labeling rules v0 (the golden set is labeled by these; extractors are graded by them)

- **R1 CALL.** Requires a resolvable instrument, a direction, and **at least one of:**
  - (a) a stated price, zone or level;
  - (b) a named, observable trigger event (e.g. "gap down and red to green");
  - (c) a position action (bought, holding, added, trimmed, sold, stopped).
  - Otherwise it is a MENTION. For example, "watching on the next pullback" is a MENTION (G-019).
- **R2 Lists.** Honorable Mention and Charts Covered produce one MENTION per **unique** ticker.
  The reason comes from the author's own definition of the list.
- **R3 NEGATIVE_CALL.** Needs an explicit ticker **and** an explicit pass, avoid or not-taking
  verb. Implied passes ("any of these") are not extracted. "No thoughts on X" is `MENTION/no_view`,
  never negative.
- **R4 Hindsight.** Teaching examples become `CALL/hindsight`. They are excluded from CALL-REPLAY
  and the UCT-see rate, but included in OUTCOME checks and the clip handoff.
- **R5 Levels as stated.** A level is never inferred from bars. Textual derivations are allowed
  only when the text defines them: `breakeven` means stop = entry; "yesterday's low" keeps
  `stop_text` and is resolved at OUTCOME time with `anchor_rule=prior_day_low`.
- **R6 Authorship.**
  - Author = speaker, or the owner of the signed section.
  - Unsigned Sunday Scans sections follow D4.
  - Only speakers with `can_author_calls` produce CALLs; everyone else's judgments are MENTIONs.
- **R7 Stated outcomes.** "Stopped", "closed at X from Y" are captured and linked to the computed
  OUTCOME. A disagreement is surfaced, never overwritten.
- **R8 Principles.** A reinforcement attaches to an existing key and a contradiction links.
  Canonical status is set by the owner only.
- **R9 ASR.** `*_as_heard` is always kept. A resolved value needs the §3.8 plausibility check;
  if it fails, `extraction_confidence=low`.

---

## 4. Ingestion plan per stream (in value order)

Every job runs on scheduler threads, never in a request handler. Every job is resumable (a
watermark on disk, as in `buzz_ingest`). Every job **fails closed** and **names what it skipped**.

### 4.1 Zoom live sessions (W1)

- **Read:** `edu_videos` rows where `insights_at` is set plus 3 h grace (the insights pass lands 2 min to 3 h after publish). In-process on web, the same pattern as `desk_session_insights`, whose outputs are consumed and not recomputed.
- **Backfill:** every stored transcript (id 318 onward has one; the earliest reachable is to be measured in W1).
- **Source row:** the transcript text snapshot, `raw_sha256`, and `recording_started_at_et` from `desk_session_jobs.start_time`.
- **Coverage gate:** a source whose transcript span is under 80% of the YouTube `lengthSeconds` is ingested but **marked `incomplete`**. Its absence of calls then never reads as "no calls" (the §2.1 defect).
- **Extraction:** Anthropic **Batch API** (§5) against labeling rules R1–R9. Nothing runs on the corpus until the extractor passes the golden gate (§6.5).
- **Owner prerequisites:** D3 (who authors calls), D5 (model), D10 (workshop recovery).

### 4.2 Sunday Scans (W2)

- **Read:** `desk.db.substack_posts` where the title matches the Sunday Scans series (`desk_store.sunday_scans_posts` already selects the series by title), in-process.
- **Segmentation:** by headings from `body_html`. The local `.txt` archive is only a W0 sample source.
- **Section mapping:**

| Section | Produces |
|---|---|
| Positions | CALL(`in_it`, levels as stated) |
| Per-chart notes | CALL / MENTION per R1 |
| Honorable Mention, Charts Covered | MENTION per R2 |
| INTRO, Breadth, Index & ETFs | PRINCIPLE and market-context records |

- **Weekly checkpoint:** reconcile last week's calls against stated outcomes in the new issue (e.g. "I closed MU at 930 this week from 784").
- **Owner prerequisites:** confirm the canonical source is the published post (§12), and D4 (authorship of unsigned sections).

### 4.3 Discord (W3)

- **Poller:** mirrors `buzz_ingest` (cursor plus a resumable backfill watermark, and `None` ≠ `[]` on failure).
- **Scope:** reads only allowlisted channel IDs. **Text is stored only for allowlisted author IDs;** every other author's message is dropped before any write.
- **Backfill:** from 2026-02-20 (where the frozen corpus ends) to now, through the history API. The frozen corpus is imported as source `version=0`. Its `message_type` is a **weak label**, never gold.
- **Treatment:** real-time CALLs here are the most timestamp-precise signal in the corpus, so `stated_at_precision=minute` and they are the entry-timing ground truth.
- **Owner prerequisites:** D2 and the channel grant (§12).

### 4.4 Workshops (W1 shares the pipeline; W5 adds structure)

- Same as 4.1, with `stream=workshop` set from the routed section.
- W5 adds teaching-structure extraction (topic → examples → rule, in order).
- **Example-to-chart links:** ticker plus date gives a replayable `/r/chart?sym=&tf=D&to=` URL.

---

## 5. Extraction

- **Model:** `claude-opus-5` through the **Message Batches API**, following the cost doctrine (right model per job, never downgraded for cost; background work runs on Batch at 50%). A smaller model is allowed only if it **ties** Opus on the golden set (D5).
- **Durable batch ledger:** reuse `api/services/llm_batch.py` (a file on the volume; results keyed by `custom_id`, never by position).
- **Budget rail:**
  - `WISDOM_EXTRACT_DAILY_USD_CAP` goes through the cost guard, which must count `cache_read_input_tokens` and `cache_creation_input_tokens`.
  - That was the 2026-08-28 cap-loosening trap; the guard is taught about cache tokens before caching is turned on.
- **Volume (measured):**
  - Live sessions carry ~50–105k characters of transcript each; ids 318–356 show 22k–106k.
  - Roughly two Desk videos per trading day comes to about 1–1.5M input tokens a month.
  - The one-time backfill is the ~40 stored transcripts plus 7,766 Discord messages.
  - **The dollar estimate is computed in W1 from the current price sheet and written into `LEDGER.md` before the first corpus run.** It is not quoted here from memory.
- **Output:** schema-constrained JSON validated against §3.4–3.5. A record that fails validation is dropped **and counted** (never silently).

---

## 6. Evaluation methodology v0

Every metric is produced by a script under `tools/wisdom_*.py` with a versioned methodology doc
(`docs/wisdom/methodology/<metric>-vN.md`), and every figure is printed as `k/n`.

### 6.1 CALL-REPLAY → UCT-see rate (headline)

- **Population:** CALLs with `stance ∈ {watching, taking, in_it, added}`, a resolved entity, and `stated_at_precision ∈ {minute, day}`. Hindsight is excluded.
- **As-of rule:** a call made before 09:30 ET is judged against UCT output as of the previous session's close. A call made intraday is judged against the same session's pre-open output **and** its end-of-day output, reported separately.

| Hit | Definition |
|---|---|
| **H0** | the ticker appears in ANY UCT output for that session |
| **H1** | in the top N of that output (N stated per surface) |
| **H2** | tagged with the matching setup, via vocabulary `maps_to` |

- **Lead/lag:** sessions between the first UCT flag and the call ("before he says it"), shown as a distribution, not a mean.
- **Surfaces:**
  - Replayable: pattern-engine detectors on bars cut at the call date, and bar-only screener formulas.
  - Recorded-only: leadership snapshots, setup triggers, catalysts, Pattern Vision, scanner candidates (only from the day W1 starts archiving them).
  - **Every row names which kind it used.**
- **Breakdowns:** by setup, stream and month. Rows with a small n are shown, not hidden.

### 6.2 FALSE-POSITIVE EVAL

- **Population:** `NEGATIVE_CALL` with `reason_class=chart`. Liquidity, opportunity-cost and no-reason passes are excluded because they say nothing about the chart (G-015, G-017).
- **Rate:** the share of those names UCT flagged with a setup on that session.
- **Rule:** a recognition change must raise H2 without raising this rate beyond its own confidence interval.

### 6.3 OUTCOME-WEIGHTED EVAL

- **Anchor:**
  - The stated entry, if that session traded through it.
  - Otherwise the anchor session's close. For a call after 16:00 ET or on a weekend, the next session's open.
- **Horizon returns:** close-to-close over 1, 3, 5, 10 and 20 sessions.
- **MFE/MAE:** from highs and lows within the horizon.
- **Stop and target hits:** from daily high and low. When both fall inside one bar, the order is resolved with intraday bars when they exist; otherwise `same_bar_ambiguity=true` and it stays unresolved.
- **Hit weight:** `f(R at 10 sessions)`, capped. **The raw unweighted rate is always printed beside the weighted one.**
- **Guards:**
  - A ticker with no bars is `unverifiable` (never 0).
  - A single-day move over 40% with a split-repair flag is excluded and counted.

### 6.4 ASK-AI GROUNDING EVAL

- **Question set:** 20 fixed questions in three shapes — craft ("how does UCT place stops on a breakout?"), dated recall ("what did Patrick say about SNDK last Tuesday?"), current issue ("what setups are in this week's Scans?").
- **Arms:** answered with and without Wisdom retrieval, back to back in one session. The fast lane's scores are not comparable across sessions (measured 2026-08-29).
- **Scoring:** a median of 3 runs, because the report card swings ±13 points at n=1.
- **Retrieval first:** `--grounding-audit` (no answer is generated) runs before the answer exam.
- **Citations are checked mechanically:** each citation must resolve to a `segment_id` whose stored text contains the quoted span. A citation that does not resolve fails the answer, whatever the judge said.

### 6.5 Extractor golden gate

- **Size:** ≥ 50 segments labeled `owner_confirmed` or `owner_corrected` before any extractor runs on the corpus. Session 0 drafted 30 (§9); W1 adds ≥ 20, including ≥ 10 Discord messages.
- **Report:** precision, recall and F1 per record type, plus exact-match rates on `entry`, `stop`, `ticker` and `stance`, each with a Wilson interval, per extractor version, recorded in `LEDGER.md`.
- **Regression rule:** a version whose F1 on any record type falls below the previous version's interval, or whose entry/stop exact-match drops, **does not ship**.
- **Corrections:** every owner correction becomes a golden example for the *next* version. Nothing retrains automatically.

---

## 7. Flags (names reserved; none declared in Session 0)

All are enablement gates: unset = OFF. Each is declared in `docs/feature_flags.json` in the commit
that adds its read site.

| Flag | Gates | Wave |
|---|---|---|
| `WISDOM_INGEST_ENABLED` | the master switch for every scheduled Wisdom job | W1 |
| `WISDOM_ZOOM_INGEST_ENABLED` | the Zoom/workshop ingester | W1 |
| `WISDOM_CAPTURE_SCANS_ENABLED` | daily snapshot of candidates and pattern detections (D7) | W1 |
| `WISDOM_EXTRACT_ENABLED` + `WISDOM_EXTRACT_DAILY_USD_CAP` | LLM extraction via Batch | W1 |
| `WISDOM_SUNDAY_SCANS_INGEST_ENABLED` | the Sunday Scans ingester | W2 |
| `WISDOM_OUTCOMES_ENABLED` | the outcome engine | W2 |
| `WISDOM_WEEKLY_REPORT_ENABLED` | the Sunday weekly report | W2 |
| `WISDOM_DISCORD_INGEST_ENABLED` | the Discord poller | W3 |
| `WISDOM_REVIEW_UI_ENABLED` | the admin review surface (a minimal golden-review page ships in W1) | W1/W3 |
| `ASKAI_WISDOM_RETRIEVAL_ENABLED` + cohort tag `rollout:wisdom-askai` | Ask-AI retrieval (admin cohort first) | W4 |
| `WISDOM_BADGES_ENABLED` + build flag `VITE_WISDOM_BADGES_ENABLED` | the "UCT said" badge | W5 |
| `WISDOM_CLIP_HANDOFF_ENABLED` | the segment/call export to uct-clips | W5 |

⚠️ `ASKAI_WISDOM_RETRIEVAL_ENABLED` is the charter's name. The existing family is `AI_SEARCH_*`.
The charter name is kept; the mismatch is recorded here so nobody greps only one prefix.

---

## 8. Privacy, content and storage

- **Speakers:** labels outside the alias table become `attendee` before any write, and the name is
  never stored.
- **Discord:** an allowlist of channel IDs **and** author IDs. Member messages are never stored,
  not even transiently in a table.
- **Paid content:**
  - Retrieval routes sit behind `require_paid` plus the S12 cohort during dark phases.
  - Workshop and live-session segments are served only to entitled members.
  - Sunday Scans is published free, but is served through the same gate for consistency.
- **Owner-private fields:** `size_shares` and personal P&L are stored for the owner's review
  surface and **never** returned by any member-facing route. A route test must assert that.
- **Storage (D6):**
  - Records go to `/data/wisdom.db` on the `web` volume. This follows the existing
    one-SQLite-per-domain pattern: `desk.db`, `education.db`, `catalysts.db`.
  - Raw source text snapshots go to R2 bucket `uct-bars-snapshots` under prefix
    `wisdom/sources/<stream>/<source_id>/v<n>.txt.gz`. The prefix-scoped pattern is already used
    by `brain/` and `clips/`; the pruners are prefix-scoped, and Wisdom never prunes other
    prefixes.
  - **No media is copied.** Video stays on YouTube, and the transcript is the artifact.
  - **Egress:** R2 charges no egress fee. Railway outbound for uploads is compressed text, about
    ~100 KB a day, which is negligible. The snapshots also give an **off-volume copy** of every
    source, which `/data/backups/` (same volume) does not.
- **No written storage ruling was found** beyond these established patterns; D6 makes it one.

---

## 9. Golden set v0 (draft) and Setup Vocabulary v0 (draft)

**Golden set v0:** 30 records.

| record_type | count |
|---|---|
| CALL | 14 |
| NEGATIVE_CALL | 4 |
| MENTION | 5 |
| PRINCIPLE | 7 |

- **Streams:** Sunday Scans ×17, Zoom live ×10, workshop ×2, plus one cross-stream pair.
- **Location:** `data/wisdom/golden/golden-v0.draft.jsonl` (gitignored).
- **Verified:** `python tools/wisdom_golden_verify.py` confirms every quote occurs **exactly once** in its sample, and writes quote-free provenance (sample sha256 plus char span) to `golden/golden-v0.provenance.json`. `--self-check` proves it fails on absent, ambiguous and speaker-prefixed quotes and on list-count mismatches, and returns INCONCLUSIVE when a sample is missing.
- **Boundary cases, each deliberate:**
  - G-003 / G-019: CALL vs MENTION by trigger.
  - G-013: hindsight.
  - G-015: liquidity pass.
  - G-017: one sentence, two negatives.
  - G-018: ticker by adjacency, low confidence.
  - G-020: crypto asset vs ETF vehicle, and the old `ETH` equity symbol.
  - G-021: no-view.
  - G-022: list dedupe (TEAM ×2) and single-letter tickers W and U.
  - G-026: reinforcement.
  - G-030: contradiction.

**Setup Vocabulary v0:** 32 candidates (23 setup · 5 level · 4 market_signal) in
`vocabulary/setup-vocabulary-v0.draft.json`.
- Built from the samples only. The names are the authors' own, and 26 verbatim definitions were verified against the samples.
- **Owner-coined:** Mid-Range Pivot, Theme Hot Potato.
- **Naming conflicts for D9:**
  - The authors say **20EMA**; the engine detector is `pullback_to_21ema`.
  - The authors say **HVC** (High Volume Close); the Desk taxonomy says "High Volume Edge".
  - The authors say **ER gap up**; the registries say PEG / Power Earnings Gap.
- **No existing detector or Desk-taxonomy entry at all:** Inside Day (as a setup), Breakout Retest, Failed Breakdown, Red to Green, Delayed Reaction, Shakeout, Mid-Range Pivot, Brian Shannon Special.

---

## 10. Wave order

| Wave | Delivers (dark) | Exit criterion (measured) |
|---|---|---|
| **W1** | Schema + `wisdom.db`; speaker and ASR alias tables; **daily capture of candidates and pattern detections (time-critical)**; Zoom/workshop ingestion with the coverage gate; golden set expanded to ≥ 50 plus a minimal admin golden-review page; extractor v1 through the golden gate; CALL-REPLAY v0 on replayable detectors | Golden gate passes; ingest of all stored transcripts reports `sources/incomplete/segments/records` with names; the first UCT-see rate is printed as `k/n` with its methodology doc |
| **W2** | Sunday Scans ingestion from `desk.db`; outcome engine v0 (§6.3); weekly reconciliation; the one-page WEEKLY WISDOM REPORT | One real Sunday cycle: last week's calls reconciled; report delivered to the owner |
| **W3** | Discord poller plus backfill from 2026-02-20; legacy corpus as version 0; the full admin review surface (fix a call in under 30 s; promote a vocabulary candidate; mark a principle canonical) | A real #tsdr call extracted within one poll cycle of posting; owner corrections land as golden examples |
| **W4** | Ask-AI retrieval (`_grounded_system`; FTS baseline, then embeddings) with S8 `<Provenance>` citations; admin cohort | Grounding eval with Wisdom beats without it (median of 3, same session); 0 unresolvable citations |
| **W5** | "UCT said" badges; clip-pipeline handoff of segment boundaries plus call-with-resolution timestamps; workshop teaching structure | Badge shows the source line on hover for the admin cohort; uct-clips consumes one handoff file |
| **W6** | First monthly recognition proposal: each candidate change measured on the last 90 days of calls (UCT-see rate and false-positive rate, with CIs) | Owner decision recorded; nothing member-visible without an approval line |

**Members' "This week in UCT" view:** out of scope until the admin loop has run for ≥ 4 weeks.

---

## 11. Decisions only Patrick can make

Answer as a block; each is yes/no, and the recommendation is stated.

| # | Decision | Recommendation |
|---|---|---|
| **D1** | The repo is **public**. Keep every verbatim transcript sample, golden label and position detail **out of git** (gitignored locally, `/data/wisdom.db` + R2 in prod)? *(If the repo is meant to be private, say so and this relaxes.)* | **YES** |
| **D2** | Grant the UCT Intelligence bot **View Channel + Read Message History** on `#tsdr` (403 today) and ingest only your and named team members' messages there? | **YES** |
| **D3** | CALL authors = **Patrick (TSDR) and Bracco only**; Ravi, manrav and guests (incl. Stockbee) produce MENTIONs until you promote them? | **YES** |
| **D4** | Attribute **unsigned** Sunday Scans sections (INTRO, Breadth, Index & ETFs) to **TSDR**? | **YES** |
| **D5** | Extract with **claude-opus-5 via the Batch API**, switching to a smaller model only if it *ties* Opus on the golden set? | **YES** |
| **D6** | Store records in a new **`/data/wisdom.db`** on the web volume and raw source text in **R2 `uct-bars-snapshots/wisdom/`**? | **YES** |
| **D7** | Start **capturing** scanner candidates and pattern detections daily in W1, before extraction exists, because every uncaptured day is permanently unscoreable? | **YES** |
| **D8** | Exclude **hindsight/teaching examples** from the UCT-see rate but use them for outcomes and clips? | **YES** |
| **D9** | Make the **authors' names canonical** (20EMA Tap, HVC, Earnings Gap Up …) and map the engine/Desk ids to them, rather than renaming your vocabulary to match the code? | **YES** |
| **D10** | Recover the **2026-09-11 "Workshop with Stockbee"** transcript from Zoom trash (about 30-day window, so before ~2026-10-11), and hand the truncated-transcript defect to the Desk pipeline owner rather than working around it in Wisdom? | **YES** |

---

## 12. Owner-only tasks

1. **Answer D1–D10** above.
2. **Discord:** grant the bot's role *View Channel* + *Read Message History* on `#tsdr` and on each
   trade-alert channel to include. Reply with those channel IDs and the Discord user IDs of team
   members whose calls count.
3. **Zoom:** Zoom web portal → Recordings → Trash → recover "Workshop with Stockbee"
   (2026-09-11) before ~2026-10-11.
4. **Sunday Scans:** confirm that the canonical issue is the **published Substack post**, not the
   Friday draft.
5. **Golden labels:** review the 30 draft records (listed in the Session 0 report). Reply with
   corrections by `gid`, or "confirmed".
