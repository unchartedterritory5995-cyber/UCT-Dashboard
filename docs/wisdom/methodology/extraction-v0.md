# Extraction v0: methodology

Wisdom Loop Wave 1, stream S-D. The code is `api/services/wisdom/extract/`, and it ships dark: nothing runs while `WISDOM_EXTRACT_ENABLED` is off.

This page is committed to a public repository. It holds no transcript text, no golden quote, no private size or entry, and no member data. Every number here is either a constant with its code name, or a measurement with its date.

## 1. The unit the model sees: a segment

Each Messages request carries exactly one segment (`segmenter.py`).

| Source | Segment | Constants |
|---|---|---|
| Transcripts (live sessions, workshops, education, interviews) | Cue windows, built per chapter. A cue that names a ticker gets a window of ±`TICKER_PAD_S` (60 s). Windows closer than `MIN_GAP_WINDOW_S` (60 s) merge. The rest is covered by `FALLBACK_WINDOW_S` (240 s) windows overlapping by `FALLBACK_OVERLAP_S` (30 s). Any span over `TILE_THRESHOLD_S` (300 s) is tiled. | `MAX_SEGMENT_CHARS` 12,000. A longer window is split at cue boundaries, with 30 s of overlap. |
| Sunday Scans | Sections. A section starts at a top heading (INTRO, Calendar, Breadth, Index & ETFs, an author's breakdown, Weekly Outlook, Closing Comments), a sub heading (Current Positions, Charts Covered, Honorable Mention, Positions) or a chart label of the form `TICKER (timeframe)`. Text before the first heading is its own section. Consecutive small labelled sections under one top heading are packed together. | `SECTION_PACK_CHARS` 2,500 |
| Discord | One message per segment | none |

**Ticker detection.** A ticker is a `$CASHTAG`, or an uppercase token that is in `api/data/cap_universe.json` and not on a stop list of common words.

**Edges overlap.** Every window edge overlaps its neighbour by 30 s, including a ticker window next to a gap, and a chapter's last window runs `CHAPTER_OVERLAP_S` (30 s) past the cut. So a sentence spoken across any edge lands whole in at least one segment.

This was measured, not assumed. One golden principle was spoken across a ticker-window edge, and no segment contained it until every edge overlapped. `tests/test_wisdom_extract_segmenter.py::test_every_golden_quote_lands_inside_a_segment` now places every golden-v1 record.

Records duplicated by the overlap are removed by the writer's dedupe key: source, normalised quote, record type and ticker.

**Normalisation** is byte-identical to `tools/wisdom_golden_verify.py`:
- a cue's leading `speaker: ` head (up to 40 chars) is stripped;
- cues are joined by one space;
- Sunday Scans HTML is reduced to block lines.

Every segment's text is an exact slice `[char_start:char_end]` of that normalised text. The segmenter test checks this parity against the tool itself.

**Authorship** comes from `authors.json` and the source metadata, never from voice or style:
- a signed Sunday Scans breakdown is credited to its author (high confidence);
- an unsigned section is credited to tsdr (medium confidence, D4);
- a Discord message is credited by Discord user id.

## 2. Prompt, schema and version

**Rules.** The system prompt states R1–R10 (manifest §4.11) and the W1 §4.5 field rules. It holds no quote from any paid source.

**Vocabulary.** It comes from `core.vocab.list_for_prompt` when that module exists, otherwise from `docs/wisdom/vocabulary/setup-vocabulary-v0.draft.json` (all 32 entries). The `GET /api/admin/wisdom/extract/gate` response says which source is in use.

**Output contract.** `docs/wisdom/contracts/extraction-output-v0.schema.json` is the authority. The transport form sent to the API differs from it in three ways:
- `$ref`s are inlined;
- keywords the structured-output grammar rejects are removed;
- nullable text fields travel as plain strings, with `""` meaning null.

The third change is forced by the API. It compiles at most `API_MAX_UNION_PARAMS` = 16 union-typed parameters. The contract has 22, and the first live call on 2026-09-13 was refused with a 400 citing "limit: 16 parameters with unions". The transport has 9: numbers, `entry_zone`, `principle` and `market_signal`. The writer maps `""` back to null. The batch tests' fake client now refuses a schema over the limit.

**Version.**

    extractor_version = "wx-v0-" + sha256(system prompt ‖ contract schema ‖ TRANSPORT_REVISION)[:8]

Because the vocabulary sits inside the system prompt, a vocabulary change is a new version and needs its own gate run.

**Request.**

| Setting | Value |
|---|---|
| model | `claude-opus-5` (`WISDOM_EXTRACT_MODEL`) |
| effort | `high` (`WISDOM_EXTRACT_EFFORT`) |
| max_tokens | 32,000 |
| system prompt | cached (ephemeral) |
| structured output | `output_config.format` = json_schema |
| sampling params, prefill, fallbacks | never sent |

## 3. Determinism

W1 §4.6 asks for temperature 0. `claude-opus-5` returns 400 for every sampling parameter, so none is sent.

What makes a run repeatable instead:
- a byte-stable prompt and schema (the version hash);
- schema-constrained JSON;
- a fixed effort;
- server-side quote verification against the stored segment text.

The drift that remains is measured, not assumed. The gate re-runs dev segments with the same model and effort, and records the agreement of record keys as `extractor_drift` (§8).

## 4. The Batch lifecycle (`batch.py`)

**Scope.**
- One request per segment.
- Only segments of complete sources are submitted.
- Daily caps are `DAILY_SEGMENT_LIMIT` 400 and `DAILY_SOURCE_LIMIT` 50.

**Identity.**
- `custom_id` is `wx_` + sha256(source id, source version, segment ids, extractor_version, salt)[:40], or `wa_` for the audit. It always matches `^[a-zA-Z0-9_-]{1,64}$`.
- The idempotency key is (source_id, source_version, extractor_version): a version submits each segment once.

**Checkpoints and failures.**
- Rows are written as `submitting` before `batches.create`.
- A timeout or connection failure leaves them `submitting`. After 15 minutes the reaper adopts the ended batch whose custom_id set matches exactly; after 6 hours without one, it requeues and pages.
- A permanent 400 fails the rows.
- `max_tokens`, a JSON decode failure, expiry, cancellation and a missing result are retried up to `MAX_ATTEMPTS` (3).
- A refusal fails the row.

**Reap.** Job `wisdom_extract_reap` runs at minute 16 and 46 behind `WISDOM_EXTRACT_ENABLED`. It commits one transaction per result, so a results stream that dies mid-way resumes without writing twice or counting cost twice. It reports progress, cost and ETA.

## 5. Budget (`budget.py`)

| Model | Input $/MTok | Output $/MTok |
|---|---|---|
| claude-opus-5 | 5 | 25 |
| claude-sonnet-5 | 2 | 10 |
| any other model | 10 | 50 (deliberately high) |

**Multipliers.** Batch is 0.5×. A cache read is 0.1× input; a cache write is 1.25× (5 min) or 2× (1 h).

**Estimates.** Input tokens come from `count_tokens`, or a character estimate when counting fails. Output tokens are the latest calibration p90 for the model and effort (§8), else 6,000.

**Hard stop.** Before each request is submitted, `actual spend + pending estimates + this request's estimate` must stay within `WISDOM_EXTRACT_BUDGET_USD` (default 120). Otherwise submission stops, pages once (`wisdom_extract_budget_stop:<version>`) and reports.

**Scope.** Spend is counted per extractor_version, extraction and audit together.

## 6. What the writer keeps (`writer.py`)

**Quote.** A record is kept only when its quote occurs exactly once in the segment text. Otherwise it is rejected and counted (`quote_absent`, `quote_ambiguous`).

**R1, CALL completeness.** A CALL with no direction, or with no level, trigger or position action, becomes a MENTION. A "pullback" with nothing else is not an observable trigger.

**R3, passes.** A no-view is never a NEGATIVE_CALL; a pass must name its ticker. CALL, NEGATIVE_CALL, MENTION and LEVEL all need a ticker.

**§2.1 and D14, authors.** Only the four call authors make calls. A guest's record becomes a MENTION, except a PRINCIPLE, which the guest keeps.

**W1 §4.2, entities.** A CALL needs an entity resolved by `core.entities`. Without the resolver it is stored as a MENTION and the downgrade is counted. The gate scores the type from before this step, because the resolver belongs to another stream.

**R4, hindsight.** Hindsight is tagged. It is excluded from the call-accuracy rate downstream.

**Vocabulary.** `setup_vocab` must be a vocabulary name. A new name becomes a vocabulary candidate through `core.vocab.record_candidate` when that exists.

**D16a, private values.**
- `size_shares`, and an entry on a position still open, are split out of the structured fields.
- They go to `core.private.put_private` when it exists; otherwise they are dropped and counted.
- They never reach a structured table.
- Segment text itself is the source text, and can contain what was said aloud.

**Provenance.** Field offsets are stored relative to the segment, with the cue time for transcripts.

**Uniqueness and versions.** `UNIQUE(segment_id, extractor_version, record_hash)`. A newer extractor_version supersedes provisional records; nothing is deleted, and confirmed records are untouched.

## 7. The golden gate (`golden.py`, `tools/wisdom/extract_golden_gate.py`)

**Labels.** The gate uses `data/wisdom/golden/golden-v1.jsonl` when it exists (it did for every run below), else `golden-v0.draft.jsonl`. Each record carries its own split: dev or test. The gate runs on dev only.

**Placement.** Each record goes to the smallest segment of its sample that contains its quote exactly once.

**Matching, per segment.**
- An expected (record type, ticker, stance, direction) matches one prediction of the same type from before the entity step, the same ticker, and the same stance and direction where the label sets them.
- A MARKET_SIGNAL without a ticker on either side matches on the rest.
- A PRINCIPLE matches the best-scoring predicted principle when the maximum of statement-token Jaccard, quote-token Jaccard and span overlap is at least `PRINCIPLE_SIMILARITY_MIN` (0.5).

**Scoped precision.** Golden labels are not exhaustive. Only predictions whose quote overlaps a labelled quote span are scored; the rest are counted as unscored, never as false positives.

**Metrics.** For each record type:
- precision, with n = scored predictions;
- recall, with n = expected records;
- a lenient type+ticker recall, reported beside them.

They are written to `wisdom_eval_runs` (kind `extractor_golden`) and to `wisdom_metrics` (`extractor_precision`, `extractor_recall`; the value is null when the denominator is 0).

**Decision.**
- The first evaluation for a golden version and split is accepted as the baseline.
- After that, a run is blocked on any per-type precision or recall below the last accepted run of a different version or model.
- A smaller model is accepted only on a tie or better, per type.
- `extract.gate_status(conn)` is what `run_daily` checks before it submits anything.

**PC to production.** The samples are gitignored, so the gate runs on the PC. Its receipt holds counts only. It is POSTed to `POST /api/internal/wisdom/extract/eval-runs` (the PUSH_SECRET bearer), which recomputes precision, recall and the decision against production's own history.

**Spend.** Gate, drift and trial calls are live, streaming Messages calls under a persisted TOTAL cap (`--max-usd`, $15 for Wave 1). Each call reserves its worst case (full `max_tokens`) before it is made. A phase that hits the cap, or any API or tool error, records no evaluation.

## 8. Measured

MEASURED_SECTION_PENDING

## 9. The weekly audit (`audit.py`, `tools/wisdom/extract_audit.py`)

- 50 segments extracted in the last 7 days are sampled with a seed of week and version; a segment is never re-audited.
- They are re-extracted one effort level deeper, through the same Batch path (`wa_` ids).
- At reap, the audit's record keys are compared with the stored ones.
- A disagreement becomes one review item (tab `extraction_audit`), with the two key sets side by side and no private value.
- The audit writes no record.
- It is gated by `WISDOM_EXTRACT_AUDIT_ENABLED`.

## 10. Known limits

- Until `core.entities` merges, every CALL is stored as a MENTION. The downgrade is counted, so this is visible, not silent.
- `wisdom_segments.text` is the source text. Private-value splitting applies to extracted fields, not to that text.
- Chart images are not read (D13). The vision trial below is an estimate; production vision stays behind `WISDOM_VISION_ENABLED`.
- Scoped precision means an extractor that invents records outside labelled spans is not penalised by the gate. The weekly audit, and review of provisional records, are the controls for that.
