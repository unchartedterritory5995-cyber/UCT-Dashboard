# Zoom-Native Session Insights — Chapters/Summaries Without LLM Dependency

**Date:** 2026-07-02
**Status:** Approved (owner picked Zoom-first with LLM fallback + LLM-only tickers)
**Context:** The Anthropic account ran out of credits, revealing that chapters
were hard-coupled to Opus. Meanwhile every Zoom cloud recording ALREADY carries
an AI Companion `SUMMARY` file with timestamped topical sections — chapters,
pre-built, free. Verified against the real workshop recording
(`OHO+z39hTGCghEXubNcNcA==`).

## Real Zoom SUMMARY schema (verified on prod, 2026-07-02)

`recording_files[]` entry with `file_type: "SUMMARY"`, `recording_type:
"summary"` (a SECOND summary file has `recording_type: "summary_next_steps"` —
action items, NOT wanted). `download_text` of its `download_url` yields JSON:

```json
{
  "overall_summary": "Joe and Patrick conducted a trading education session…",
  "items": [
    {"label": "Trading Strategies and Momentum Flags",
     "start_time": "00:00:00.000", "end_time": "00:09:13.190",
     "summary": "Joe discussed the importance of momentum flags…",
     "short_summary": ""},
    … ~10 items …
  ]
}
```

## Behavior change in `desk_session_insights.process_pending_session_insights`

Per pending video, after `get_recording_files`:

1. **Zoom-first (free):** locate the summary file
   (`_find_summary_file(rec)` — `file_type SUMMARY` AND `recording_type ==
   "summary"` AND `download_url`; never `summary_next_steps`). Parse via
   `parse_zoom_summary(raw) -> {headline, summary, chapters}`:
   - `chapters` = `[{t: _hms_to_secs(item.start_time), title: item.label}]`,
     items lacking label/start skipped, sorted by t, titles capped 80 chars
     (reuse the existing cleaning idiom).
   - `headline` = `overall_summary` trimmed to 200 chars.
   - `summary` = up to 6 item summaries (each trimmed to 300 chars).
   If ≥1 chapter results: store insights with these + ticker_moments from
   step 3 + transcript from the VTT (transcript fetch/parse unchanged), render
   the recap poster, trash the recording — the existing success path, minus
   any required LLM.
2. **LLM fallback (unchanged shape, cheaper default):** only when no usable
   summary file exists, keep the existing transcript→`generate_insights` path.
   `_MODEL` default flips `claude-opus-4-8` → `claude-haiku-4-5`
   (`DESK_CHAPTERS_MODEL` env still overrides).
3. **Ticker moments = LLM-only, best-effort, never blocking:** with the
   Zoom-first path, attempt a SMALL LLM call for ticker_moments only
   (`generate_ticker_moments(title, cues)` — same client/timeout override as
   `generate_insights`, Haiku default, prompt asks ONLY for
   `{"ticker_moments": [{"t": secs, "ticker": "NVDA"}]}`); ANY failure →
   store empty ticker_moments and proceed (publish is never blocked on
   billing).
4. **Ticker backfill loop:** videos already carrying chapters + a stored
   transcript but EMPTY ticker_moments get a bounded (≤3/pass) best-effort
   retry from the STORED transcript (no Zoom dependency — recordings are
   already trashed). Needs a service query
   `education_service.videos_missing_ticker_moments(window_secs, limit)`; a
   failed attempt just waits for the next pass. Guard: skip this loop entirely
   with `DESK_CHAPTERS_TICKER_BACKFILL=0`.

## Untouched

Scheduling (`7/15` job), scope handling, trash/give-up semantics
(`has_chapters or age >= max_wait`), `_llm_timeout_secs` override, poster
rendering, education.db schema (all fields already exist).

## Tests (extend `tests/test_desk_session_insights.py`)

- `parse_zoom_summary`: happy (schema above), malformed JSON, missing items,
  items missing label/start_time, cap/sort behavior, headline/summary trims.
- `_hms_to_secs`: "00:00:00.000"→0, "00:09:13.190"→553, "01:02:03.000"→3723,
  junk→None.
- `_find_summary_file`: picks `summary`, ignores `summary_next_steps`, None
  when absent.
- Orchestration (stubbed zoom + education): summary file present → insights
  stored WITHOUT any LLM client construction (stub `_get_anthropic_client` to
  raise if the chapters path touches it; the tickers attempt is separately
  stubbed); no summary file → falls back to `generate_insights`.
- Tickers best-effort: LLM raises → insights still stored, empty tickers.

## Rollout

Ship on `feat/thumbnail-glow-up` → master (auto-deploy). The 5-video backlog
processes credit-free on the first tick. Ticker chips appear automatically
once the Anthropic account is topped up (backfill loop).
