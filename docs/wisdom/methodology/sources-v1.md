---
id: WISDOM-SOURCES-V1
title: Wisdom Loop sources v1 — Discord, transcripts, Sunday Scans (stream S-C)
status: built dark (W1); gates WISDOM_DISCORD_LISTENER_ENABLED, WISDOM_SOURCES_INGEST_ENABLED
generated: 2026-09-13
contract: docs/wisdom/CONTRACTS.md §3, §5, §6.3
code: api/services/wisdom/sources/ · api/routers/wisdom_sources.py · tools/wisdom/sources_*.py
---

# Sources v1

Everything here writes only to `wisdom.db` and R2 `wisdom/`. Nothing is member-visible.
No message text, transcript text or member data appears in this repo; locators only.

## 1. Identity and versioning (all three sources)

| Thing | Rule |
|---|---|
| lineage id | `sha24(stream \| external_ref)` — stable for the life of a source |
| `source_id` | lineage id for v1; `sha24(stream \| external_ref \| v<n>)` after (it is the PRIMARY KEY) |
| `segment_id` | `sha24(source_id \| version \| ordinal)` |
| raw text in R2 | `wisdom/sources/<stream>/<lineage id>/v<n>.txt.gz`, gzip `mtime=0` (byte-stable) via `core.r2.put_immutable` |
| change | a new `raw_sha256` → version n+1 with `supersedes_source_id`; same sha → no-op; a sha equal to an OLDER version is reported (`reverted`), never written (the contract's UNIQUE forbids a second row) |
| order of writes | R2 first, then one `BEGIN IMMEDIATE` for the source + segments; a failed R2 write leaves no row and the next run retries |

## 2. Discord (`sources/discord.py`)

- **Channels:** `docs/wisdom/discord-sources.json` rows with `in_scope: true` (#tsdr, #bracco,
  #1chartmaster, #manrav). App-authored channels are out of scope.
- **Authors:** `docs/wisdom/authors.json` by Discord **user id**. Everything else — members, bots,
  webhooks, system message types — is dropped **before any write** and only counted
  (`messages_seen` vs `messages_kept`).
- **Cleaning** (`normalizer_version = discord-clean-v1`): blockquote lines (`> `) and multi-line
  quotes (`>>> ` to the end) removed; `referenced_message` and `message_snapshots` never read (the
  reply keeps a `reply_to_message_id` pointer only); an author @mention becomes `@<author_id>`, any
  other user `@member`, a role `@role`. Attachments kept as pointers (id, filename, type, size,
  url) in `attachments_json` / `wisdom_sources.media_pointer`.
- **Rows per kept message:** `wisdom_sources` (`stream=discord`, `external_ref=discord:<channel>:<msg>`,
  no R2 object), one `wisdom_segments` row (`kind=message`, `speaker_confidence=high`), one
  `wisdom_discord_messages` row.
- **Transport:** REST only, `User-Agent: DiscordBot (https://uctintelligence.com, 1.0)`.
  `X-RateLimit-Remaining = 0` sleeps `X-RateLimit-Reset-After` (≤ 30 s) before the next request; a
  429 sleeps its `retry_after` once (≤ 30 s) and stops the channel for the tick; 401/403 sets
  `blocked_until = now + 1 h` and the channel is skipped until then.
- **Paging:** ≤ 5 pages per channel per tick. Forward pages (`after=forward_cursor`) first; the rest
  of the budget walks the backfill (`before=backfill_before`) until a short page sets
  `backfill_done`. Cursors move only in the transaction that commits their rows. The listener
  completes the full history on its own (~4 pages/channel/tick while new traffic is light).
- **Job:** `wisdom_sources_discord_listener`, cron minute 13,28,43,58 ET, durable claim per
  quarter-hour, `expected_every_s = 900` (the core watchdog pages after two missed beats). A tick
  that polled nothing — no token, or every channel failed/blocked — raises, so the run fails and
  pages instead of beating healthy.
- **Legacy reconcile:** the 7,766 pre-classified #tsdr messages (2024-03-11 → 2026-02-20,
  `uct_intelligence/data/processed/processed_messages.json`) are sent **by id only** through
  `tools/wisdom/sources_discord_legacy_ids.py` → `POST /api/internal/wisdom/sources/discord/legacy-ids`
  and marked `legacy_classified = 1`. The backfill completes those rows without clearing the flag,
  and the view **`wisdom_sources_extractable_segments`** excludes their segments — extraction must
  select from that view so nothing double-counts. The gap since 2026-02-20 is extractable.

Measured 2026-09-13 (read-only probe, latest 100 per channel, ids/counts only):

| Channel | HTTP | fetched | kept | dropped | kept by author | reply pointers | attachments |
|---|---|---|---|---|---|---|---|
| #tsdr | 200 | 100 | 90 | 10 | tsdr 90 | 9 | 41 |
| #bracco | 200 | 100 | 97 | 3 | bracco 97 | 50 | 40 |
| #1chartmaster | 200 | 100 | 98 | 2 | chartmaster 98 | 0 | 83 |
| #manrav | 200 | 100 | 99 | 1 | manrav 97, tsdr 2 | 41 | 64 |

## 3. Transcripts (`sources/transcripts.py`)

- **Read path:** `education_service.list_video_creative_stubs()` (lean roster),
  `get_video(id)` (scheduler thread only), `get_transcript_cues(id)` — the ONLY transcript parser
  (two stamp shapes exist; a hand regex manufactured 9 false zero-coverage rows once),
  `get_insights(id)` for chapters. Read-only on education.db.
- **Stream by category:** "interview" → `interview`; "workshop"/"fireside" → `workshop`; a
  `meeting_uuid` or a live-show category → `zoom_live`; otherwise `education`.
- **Settled gate for live sessions:** `insights_at` ≥ 3 h ago AND (`zoom_cleaned = 1` OR the 7-day
  pending window closed).
- **Coverage:** `last cue start / duration` (`edu_videos.duration`, `H:MM:SS`), NULL when unknown;
  `incomplete = 1` below 0.98.
- **Speakers** (`normalizer_version = transcript-speakers-v1`): labels are honoured only when ≥ 50 %
  of cues carry a `Label: ` prefix (Zoom labels all cues or none). A label resolves through
  `core.speakers` when that module exists, else `core.authors` aliases → author (`high`); the
  team non-author list (Ravi) → label kept, no author (`high`); a guest named in the
  title/description → `guest:<slug>` (`medium`); anything else is an **attendee: the name is
  dropped** — `speaker_label = NULL` in the segment and `Attendee:` in the R2 text. Unlabeled
  transcripts → no speaker, `low`.
- **Segments:** `kind=cue_window`, bounded by speaker change, chapter change, 90 s or 1,800 chars;
  `path` = the chapter title; `t_start_s`/`t_end_s`; char offsets into the normalised R2 text.
- **Guests:** heuristic from the title (`with X`, `featuring X`, `ft. X`, `w/ X`, `@handles`),
  never an author or team member; stored in `guest_names_json`.

## 4. Sunday Scans (`sources/sunday_scans.py`)

- **Selection:** a `mode=ro` SELECT on desk_store's own path that REQUIRES `published_at > 0`
  (`NULL > 0` and `0 > 0` both exclude); titled "Sunday Scans"; deduped by URL. Body through
  `desk_store.get_post_raw`. Railed against both draft shapes.
- **Rows:** `stream=sunday_scans`, `external_ref=substack:<canonical post url>`,
  `home_pointer=desk.db substack_posts.id=<id>`; one `kind=section` segment per heading with
  `path = "<known section> > <sub-heading>"`.
- **Attribution** (`wisdom_source_attributions`): signed sections (TSDR's Weekly Outlook &
  Watchlist, Bracco's Breakdown & Top Ideas) → their author, `signed section`; unsigned (preamble,
  INTRO, Earnings & Economic Calendar, Market Breadth Data, Index & ETFs) → `tsdr`, `D4 ruling`;
  sub-headings inherit.
- **Charts:** every `<img>` → `wisdom_chart_images` (`origin=sunday_scans`, `status=provisional`,
  no vision, no bytes fetched). Label = the nearest earlier line shaped like `TICKER (Timeframe)`
  in the same section, else the nearest short line; `label_ticker`/`label_timeframe` parsed from
  it. `public_url` = the canonical original image (the S3 URL inside the CDN URL / `data-attrs`).
  `image_id = url-sha256:<sha256(public_url)>` because no bytes are fetched in W1 (see report).
- **Verification** (`wisdom_sunday_scans_checks` + `wisdom_sources.published_check`):
  `substack_bodies.fetch_body(url)` (public, unauthenticated) → `public_api_match` when
  `audience == "everyone"` and similarity ≥ 0.98; `mismatch` for any other audience or lower
  similarity; `unchecked` when unreachable. Similarity = character-weighted share of matching
  lines (`difflib` on lines) of the normalised text of stored vs public HTML.

Measured 2026-09-13 (public fetch, numbers only):

| Issue | audience | similarity vs stored body | similarity vs scraped sample .txt |
|---|---|---|---|
| 2026-08-30 (`sunday-scans-d40`) | everyone | **1.0** | 0.948 |
| 2026-09-06 (`sunday-scans-fcd`) | everyone | **1.0** | 0.9812 |

The stored-body number is the `published_check` test; the sample `.txt` was produced by a
different scraper, so its lower number measures extractor differences, not the post.

## 5. Public step functions (called by the S-F chains)

| Function | Does | Gate |
|---|---|---|
| `sources.run_daily(ctx)` | Discord tick + new/changed transcripts; raises after both parts if either failed outright | discord listener / sources ingest |
| `sources.run_weekly_sunday_scans(ctx)` | ingest published issues + verify the newest two | sources ingest |
| `sources.discord_status(conn)` | cursors, back-off, stored/legacy counts per channel | — |
| `sources.transcript_coverage(conn)` | coverage by stream + the incomplete list (latest versions) | — |

`ctx.force` bypasses the gate; `ctx.dry_run` writes nothing (no rows, no R2, no cursor moves).

## 6. Routes

| Route | Gate | Notes |
|---|---|---|
| `GET /api/admin/wisdom/sources/discord/status` | require_admin | no text |
| `POST /api/admin/wisdom/sources/discord/backfill?max_pages=&force=` | require_admin | daemon thread; 409 when the gate is off or one is running |
| `GET /api/admin/wisdom/sources/sunday-scans/verify?limit=&force=` | require_admin | with `limit` starts a daemon-thread verification; always returns status |
| `GET /api/admin/wisdom/sources/transcripts/coverage` | require_admin | |
| `POST /api/internal/wisdom/sources/discord/legacy-ids` | require_push_secret | ids only, ≤ 2,000 per batch; blank PUSH_SECRET refuses all |
