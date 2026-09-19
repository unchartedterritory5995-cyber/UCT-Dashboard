---
id: WISDOM-METHODOLOGY-METRICS-V1
title: Wisdom Loop evaluation methodology — outcomes, context, CALL-REPLAY, metrics 6.1–6.5
status: current
versions: outcomes-v1 · context-v1 · replay-v1 · metrics-v1 (weight quality-v1) · grounding-v1
code: api/services/wisdom/evals/
owner: stream S-E (Wave 1)
---

# Evaluation methodology v1

Every number this program prints is `k/n`. A rate over zero is `0/0` and its stored `value` is NULL —
never a percentage. A record whose answer cannot be *proven* is named in the notes and kept out of
the denominator; it is never scored as a miss. This document is quote-free by rule (public repo).

Any change to a rule below bumps that component's version string, and old rows stay under their old
version (`wisdom_outcomes.methodology_version`, `wisdom_replay_checks.method_version`,
`wisdom_metrics.method_version`, `wisdom_context_snapshots.snapshot_version`). Rows are never
rewritten under a new rule.

---

## 1. Populations

| Population | Records |
|---|---|
| **See-rate calls** (6.1, 6.3) | `record_type = CALL`, `status ∈ {confirmed, provisional}`, `hindsight = 0` and `stance ≠ hindsight` (D8), ticker present. Every CALL author in `docs/wisdom/authors.json` (CONTRACTS ruling 3). No stance filter beyond hindsight: W1 §6.1 defines the population as all non-hindsight CALLs. |
| **Explicit passes** (6.2) | `record_type = NEGATIVE_CALL`, `stance ∈ {passed, avoid}`, ticker present. A no-view is a MENTION and can never enter. |
| **Outcomes** | every CALL (hindsight included — D8 keeps hindsight for outcomes), plus NEGATIVE_CALLs that carry a direction. |
| **Context snapshots** | every CALL (D11: "stored on the CALL"). |

`rejected` and `superseded` records are outside every population.

## 2. The session a call is judged against

The session of `stated_at`, or the **prior** session for a statement made before 09:30 ET or on a
non-trading day (`core.timeutil.session_for`). A day- or week-precision statement has no hour and is
judged against its own date when that date is a session, else the prior session.

The trading-day calendar comes from `bars_fetch`'s NYSE table (2025–2027). Outside that range it is
weekday-only; W1 data is inside it.

---

## 3. CALL-REPLAY (replay-v1)

Each source answers exactly one of three words for (ticker, session):

- **hit** — the ticker is in that source's output for that session;
- **miss** — the source provably ran for that session and the ticker is not in it;
- **unproven** — we cannot show what the source said that day: no rows for the date, file absent,
  outside retention, before the store's own floor, no coverage receipt, archive missing.

All reads are read-only (sqlite `mode=ro` or a JSON read).

| Source (check name) | Hit rule | Coverage (else unproven) | Rank / desk N | Setup list name |
|---|---|---|---|---|
| `leadership_snapshots:morning_wire` | symbol on `snapshot_date = D`, lane `morning_wire` | any row for D in that lane | rank ≤ 20 | `engine_leadership_setup_type` |
| `leadership_snapshots:autonomous_brain` | same, lane `autonomous_brain` (the two lanes are two sources and never double-count) | any row for D in that lane | rank ≤ 20 | `engine_leadership_setup_type` |
| `setup_triggers` | symbol on `trigger_date = D` | any trigger on D | unranked | `engine_setup_triggers` |
| `ep_candidates` | symbol on `date_flagged = D` | any candidate on D | unranked | `engine_ep_candidates` |
| `wire_universe` | ticker on `issue_id = D` with `dropped_at_stage IS NULL` (a dropped row is a miss) | any row for issue D | unranked | — |
| `catalysts` | ranked row (`rank IS NOT NULL`) on `market_date = D` | any ranked row on D | rank ≤ 20 | `catalysts_tag` |
| `pattern_verdicts` | `confirmed = 1` on `asof_date = D` | any verdict on D | unranked | `pv_FOCUSED_SETUPS` |
| `pattern_detections` (daily) | `end_t ≤ D` and `detected_at ≤ end of D` and `last_seen_at ≥ start of D` (detected_at keeps the first sighting and is wall clock, so it is never compared to D for equality) | D within 120 days of now (the prune) and not before the store's earliest `detected_at` | unranked | `pattern_engine` |
| `scan_hits` | a hit row whose definition has a `scan_coverage` receipt for (tf, as_of = D) | any coverage receipt for D | unranked | `screener_definitions` |
| `uct20_compositions` | ticker in the holdings list for date D | an entry for date D | list order ≤ 20 | — |
| `captured_candidates` | ticker in the Wisdom D12 capture archive's `candidates` family for D | archive object exists | unranked | `screener_candidates` |

The desk display count N = 20 is `LeadershipTile.jsx` / `UCT20.jsx` `slice(0,20)` and the catalysts
desk list. Where a source lists several setups for the ticker, all are kept.

### Strictness levels (one function: `replay.level_verdicts`)

- **(a) any** — hit if any source hits; else miss if any source is proven (hit or miss); else unproven.
- **(b) top-N** — only ranked sources take part: hit if a ranked source hits at `rank ≤ N`; else miss if
  any ranked source is proven; else unproven.
- **(c) setup** — the call's vocabulary id comes from `vocab_id`, else its raw setup name through the
  vocabulary (§3.1). No id: the call is **excluded** from level (c) (counted, never guessed). Hit if a
  source hits with a setup that maps to that same id; else miss if any source is proven *for setups*
  (a miss, or a hit whose setup maps to some id); else unproven.

### 3.1 Vocabulary lookup

1. `core.vocab.lookup_vocab_id(list_name, external_name)` when that module exists;
2. `wisdom_vocab_maps` row for (list, name), exact then case-insensitive;
3. a case-insensitive name that maps to exactly one id across every list;
4. for a call's own raw name, a `wisdom_vocab` name or alias.

Unmapped is NULL and reported. The six product lists never become a seventh list here.

### 3.2 Re-checks

A call is replayed once. It is replayed again only while one of its sources is `unproven` and its
session is within the last 5 days (the ENGINE copy on web lags up to one PC day plus six hours).

---

## 4. Metrics (metrics-v1)

Written to `wisdom_metrics` with `numerator`, `denominator`, `value` (NULL at 0/0), `method_version`,
`computed_at` and `notes` (JSON).

### 6.1 UCT-see rate — `uct_see_rate_any`, `uct_see_rate_topn`, `uct_see_rate_setup`

`numerator` = see-rate calls whose level verdict is hit; `denominator` = hit + miss at that level.
`notes`: `hits`, `misses`, `unproven`, `not_replayed`, `excluded`, `population`, `level`.

### 6.2 False-positive rate — `false_positive_rate`

`numerator` = explicit passes whose ticker was flagged **with the matching setup** that session
(level c hit); `denominator` = hit + miss at level c. Passes without a vocabulary id are `excluded`.
Recognition changes must raise 6.1 without raising 6.2.

### 6.3 Outcome-weighted see rate — `outcome_weighted_see_rate`

Over see-rate calls whose level (a) verdict is hit or miss and whose outcome weight is defined:

`value = Σ w·hit / Σ w`, `numerator` = hits, `denominator` = weighted calls. The raw rate over the
same calls is always beside it (`notes.raw`, `notes.raw_value`; the admin display prints both).
`value` is NULL when `Σ w = 0`. Calls with no matured outcome are counted in `notes.no_matured_outcome`.

**quality-v1 weight `w ∈ [0, 1]`:**
- 1.0 — the first target traded before the stop (daily bars; a shared bar only when 5-minute bars
  resolve it);
- 0.0 — the stop traded first;
- otherwise the return at 10 sessions (fallback 5, then 20): `clip(0.5 + R/4)` with
  `R = return% / stated risk%` when a stop is stated (`risk% = |anchor − stop| / anchor`), else
  `clip(0.5 + return%/20)`;
- undefined when nothing has matured.

### 6.5 Call track record — `call_track_record`

The question 6.1–6.3 do not answer: **did the call's own stated levels work**, never mind whether
UCT's own scanner already knew about the ticker. Over the outcomes-v1 population (§1: every CALL,
hindsight included per D8, plus a NEGATIVE_CALL that carries a direction) — no dependency on
CALL-REPLAY, so it is populated the moment outcomes-v1 has a matured row, with or without
`WISDOM_REPLAY_ENABLED`.

`numerator` = records whose `horizons_json.first_hit == "target"`; `denominator` = that plus
`first_hit == "stop"`. A record with neither a stated stop nor a stated target, or a same-bar hit
`resolved_with_intraday` could not settle (`first_hit == "ambiguous"`), is named in `notes` and kept
out of both — the same "never a miss without proof" discipline as 6.1–6.3. `notes.avg_ret_10` is the
mean `ret_10` over every record in the population with a matured 10-session return (its own count in
`notes.avg_ret_10_n`); it is reported beside the hit rate, never folded into it — a name can have a
high hit rate on tight targets and a mediocre `avg_ret_10`, and collapsing the two would hide that.

### Slices

One row per metric for the overall population and for each value of ONE dimension at a time —
`setup` (vocabulary id, else lower-cased raw name, else `(none)`), `author`, `stream`
(`wisdom_sources.stream`), `month` (`YYYY-MM` of `stated_at`) — each for `status` = confirmed,
provisional and combined. `slice_json` keys: `setup`, `author`, `stream`, `month`, `status`. A
dimension value with no record in either population is not emitted; the overall row always is.

### Rendering

`0/0` when the denominator is 0; otherwise `k/n (p%)`. The weighted metric renders
`p% weighted · raw k/n (q%)`.

---

## 5. Outcomes (outcomes-v1)

Bars: the web pod's `bars_sqlite.get_bars_before / get_bars_since`, read-only, split-adjusted; on the
PC an explicit bars.db opened `mode=ro`. A name that is not in the store is unverifiable with its
reason (CONTRACTS ruling 28). The session calendar is SPY's own daily bars: a session SPY has and the
ticker lacks is a missing bar; a session SPY does not have yet has not closed.

**Anchor session.** Minute precision before 16:00 ET on a session day → that session (pre-open
included). After 16:00, a non-session day, or day/week precision → the next session.

**Anchor price (`anchor_rule`).** `stated_entry_traded` — the stated entry (or the midpoint of a stated
zone) when the anchor session's range contains it; else `session_close` (same-session anchor) or
`next_open` (next-session anchor). Entries on open positions are never in wisdom.db, so those calls
anchor on the close/open.

**Window.** Session 0 is the anchor session. It counts toward MFE/MAE and level hits only for
`next_open` (the whole bar is after the anchor); for a close or an in-bar entry the daily bar cannot
say what traded before the anchor, so the window starts at session 1.

**Horizons** 1, 3, 5, 10, 20 sessions. `ret_N` = signed return from the anchor to the close of session
N (short calls flip the sign). Per horizon: MFE = best high (long) / low (short) in the window, MAE =
worst, both **including the bar that closes the horizon**. `mfe_pct` / `mae_pct` columns hold the
widest horizon that closed; `horizons_json` holds every horizon with its status: `ok`,
`immature` (not closed yet → NULL) or `unverifiable` (`missing_bar:<date>` → NULL, never 0).
`n_sessions_available` = consecutive forward sessions with a bar.

**Stop and first target.** Scanned over the available window: long stop hit when low ≤ stop, target
hit when high ≥ target (short: mirrored). `stop_hit` is NULL when no stop was stated, `target_hit`
NULL when no target. When both first trade on the same daily bar: `same_bar_ambiguity = 1`; the 5-minute
bars for that session decide which traded first (`resolved_with_intraday = 1`); a 5-minute bar that
itself spans both, or no 5-minute bars, leaves it unresolved (`first_hit = ambiguous`). Nothing is
booked as a loss by rule order.

**Reconciliation (content-stated only; W1 Part 10 — no fills, no Journal).** A stated outcome
describes the past, so it is checked against the 60 sessions up to the last session that had closed
when it was said — never against later bars:
- `stopped` / `breakeven` with a stated stop (breakeven: stop = entry) → `agrees` when price traded at
  that stop, `disagrees` when it never did (≥ 20 sessions of lookback), else `unverifiable`;
- `profit` / `loss` with a stated entry and return % → `agrees` when price traded at the entry and at
  the exit that return implies, else as above;
- anything the text does not pin to a number → `unverifiable` with the reason.

**Refresh.** A row is recomputed until 20 sessions have closed; an anchor-level failure (no ticker, no
direction, no time, no bar for the anchor session) is final. `pending` (the anchor session has not
closed) writes nothing.

---

## 6. Context snapshot (context-v1, D11)

Stored once per CALL (`INSERT OR IGNORE`), as of `stated_at`, never recomputed. `fields_json` holds
every field as `{value, source, retrieved_at}`; a field that cannot be read as of the statement is
`{value: null, source: null, retrieved_at: null, gap: "<reason>"}`. `completeness` = populated fields /
14.

"Closed before the statement" = the newest session at or before the last calendar day whose close was
known: that day for a minute-precision statement at/after 16:00 ET, else the day before.

| Field | As-of reader | Rule |
|---|---|---|
| `index_regime` | daily bars for SPY, QQQ, IWM | closes up to the last closed session; SMA 10/20/50/200; the Breadth monitor's MA-stack tier (g3…r3) |
| `uct_exposure` | ENGINE `market_regimes` (brain-pack copy) | newest row whose `created_at` precedes the statement |
| `breadth` | `breadth_monitor.get_history(end, anchor=le)` | row dated at or before the last closed session; flagship metrics only |
| `vix` | the same breadth row | bars.db holds no VIX series |
| `sector`, `rs_rank`, `days_to_earnings` | screener row (same-day only, `bars_asof` ≤ last closed session) or the D12 archive `screener` family | current-only store never used for an older date |
| `themes` | `theme_db.get_themes_for_ticker` (same-day only) or the D12 archive `themes` family | same |
| `catalysts` | `catalyst.store.get_for_date(session)` | a row written after the statement is `listed_later_same_session`, not listed |
| `news_24h` | D12 archive only | named gap in W1 |
| `tweets_24h` | official accounts in `tweets.db` inside its 7-day window, created in [stated − 24 h, stated]; else the D12 archive | ids and counts only, never text |
| `fundamentals` | D12 archive `street` family | named gap otherwise |
| `options_flow`, `dark_pool` | D12 archive only | flow-worker owns the data; no web-side as-of reader in W1 |

---

## 7. Ask-AI grounding (grounding-v1, 6.4)

**Question set** `askai-wisdom-v1`: exactly 30 questions, versioned, stored **gitignored** under
`data/wisdom/eval/` because the questions are written from paid content. Each question carries a
`qid`, a `shape` and `coverage.all_of` / `coverage.any_of` search terms. Absent or not 30 →
the run is `INCONCLUSIVE`, never a score.

Per question:
- **coverage** — answerable from the corpus at all: at least one stored segment contains every
  `all_of` term (and one `any_of` term when given). Keyword search over `wisdom_segments`; the FTS
  index replaces it once S-F's retrieval exists.
- **citation validity** — every `[S:<segment_id>]` cite in an answer resolves to a stored segment.
- **faithfulness** — per claim sentence (≥ 4 words): traceable when it carries at least one valid
  cite AND every number and every all-caps ticker token in it occurs in the cited segments' text AND
  at least half of its content words (≥ 4 letters, stop words removed) do.

Stored as `grounding_coverage` (covered / 30), `grounding_faithfulness` (traceable claims / claims),
`grounding_citation_validity` (valid cites / cites), each with `notes.arm` = `with_wisdom` |
`without_wisdom`, plus a `wisdom_eval_runs` row per run.

**Arms.** `with_wisdom` hands the answerer segments retrieved by S-F's retrieval
(`publish.retrieval.search`); `without_wisdom` hands it none. Answers cost money: they are generated
only when asked, never on a dry run, capped in dollars (≤ $5 for this stream), and usage is printed.

---

## 8. Known limits in W1 (stated so they are not mistaken for results)

- Level (c) needs S-B's `wisdom_vocab_maps` rows for the ENGINE setup strings; until they exist most
  ENGINE hits cannot count for setup and those calls read `excluded` or `unproven` there.
- ENGINE sources on web read the brain-pack copy (`BRAIN_PACK_ENABLED`); when it is off every ENGINE
  source is `unproven` (`source_file_missing`).
- Scanner candidates before the D12 capture started are unrecoverable (`unproven`).
- A day-precision call (a Sunday Scans issue, a transcript without a cue timestamp) anchors on the next
  open and is judged against its own date's session; minute precision needs the extractor's stamp.
- Faithfulness is mechanical and strict: a correct paraphrase that shares too few words with its cite
  reads untraceable. It measures grounding, not correctness.
