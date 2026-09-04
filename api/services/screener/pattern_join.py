"""Pattern-engine join — active 7-day detections, regime-blind expectancy.

ONE bulk read per build. This module never loops the universe against
patterns.db; it reads once, groups in Python. (K4's original rationale —
"no index on detected_at and no prune job" — was fixed 2026-08-26:
`idx_pd_detected` exists and a nightly prune caps retention. The bulk-read
shape stays; one query is still cheaper than 3,700.)

**"Active" mirrors the shared window definition** — `ACTIVE_WINDOW_SECS`
in `api/services/pattern_engine/memory.py` (the `/scan` endpoint this
originally copied verbatim was removed 2026-08-26 with the Patterns page):

    tf = 'D' AND status IN ('forming', 'ready', 'triggered')
      AND detected_at >= now - 7*86400

with ONE deliberate deviation from the old endpoint: no `confidence >= min_conf`
floor (ruling D5) — the screener column reports every active detection, not
just the ones above some arbitrary UI default. The window is on
`detected_at` (first sighting), never `last_seen_at`, matching the reader
precedent (`_scan_active_patterns` in `voice_tool_impls.py`) — using the
looser `last_seen_at` would be a second authority over "active".

**Two confidence scales collide by design (D6).** This module's
`pattern_engine_conf` is the raw pattern-engine confidence, 0-100 (most
detectors floor at 50). The screener ALSO carries a much cheaper, always-on
`patterns` column (`api/services/screener/patterns.py`) with its own
`pattern_conf_max` on a 0-1 scale. Five key strings are shared between the
two vocabularies on purpose — `golden_cross`, `death_cross`, `flat_base`,
`vcp`, `bull_flag` are both a cheap heuristic hit AND a real pattern-engine
detector id. A formula author comparing `pattern_conf_max` (0-1) against
`pattern_engine_conf` (0-100) is comparing two different instruments that
happen to share some names — the manifest description for both columns
must say so; this module never merges the two key sets.

**`pattern_expectancy_r` joins `pattern_stats` at `regime_bucket='unknown'`
— always, not "the current regime" (ruling D3, supersession #4).** Every
production caller of `build_context()` (the hourly universe scan,
`api/main.py:397,477`; `pattern_vision/orchestrator.py:77`) passes no
`regime_hint`, so `context.regime` — and therefore every
`pattern_stats.regime_bucket` row `recompute_stats()` has ever written — is
the literal string `"unknown"`. The platform's actual regime vocabulary
(`bull_trend|bull_correction|distribution|chop|bear_trend`,
`voice_regime_classifier.py`) exists in zero stats rows. Joining on the
current regime label would silently match nothing; joining on `'unknown'`
is the honest, regime-blind read of what has actually been measured.

**`expectancy_R` itself is SYNTHETIC, not measured R.** `memory.py:376-379`
computes it as `hit_rate * 2.0 - (1 - hit_rate) * 1.0` — a fixed
2R-win/1R-loss assumption applied to the pattern's historical hit rate, not
an average of realized R from `mfe_pct`/`mae_pct`.

🔴 **AND IT IS ABSENT WHEN NOTHING HAS RESOLVED — which is most of the time.**
This paragraph used to say the field was *"absent (never `0.0`) when no
`(pattern_id, 'D', 'unknown')` row exists yet"*. True as written, and the
protection never engaged: `recompute_stats()` writes the row as soon as a
pattern is SEEN, carrying `n_resolved = 0` and `expectancy_R = 0.0`. So the
`is not None` guard passed and a synthetic breakeven shipped to members as if
it were a measurement — measured 2026-08-23, **46 of 79 regime-blind stats
rows**, covering `cup_handle`, `ascending_triangle`, `bear_flag`,
`avwap_reclaim` and every other structural setup that has never resolved.
`0.0` and *"we have never measured this"* are different facts, and publishing
the first for the second is this repo's honest-None rule running backwards on
a member-facing column. **`n_resolved` is the gate, not `expectancy_R IS NOT
NULL`** — a row with nothing resolved contributes no key at all.

**Direction encoding — this reader owns it (ruling D4).** The store keeps
`direction` as TEXT (`bullish|bearish|neutral`); declaring that raw string
as a `num` scalar would re-mint the `patterns`/`candle_type` TEXT-as-scalar
defect. The encoding, applied here and nowhere else:

    bullish -> +1
    bearish -> -1
    neutral ->  0

**"Best detection"** (ruling D5, K5) = the active detection with the
highest confidence among those carrying a non-null `entry` AND a non-null
`stop` in `levels_json` (either, or both, may be absent — K5); ties break to
the newest `detected_at`. `pattern_engine_dir` and the two carrier keys
below are read off the BEST detection only; a ticker whose active
detections all lack levels has `pattern_engine_ids`/`pattern_engine_conf`
but no direction, no carriers, no expectancy.

**Two NON-COLUMN carrier keys** ride this reader's per-ticker dict:
`pattern_entry_px` / `pattern_stop_px` — the best detection's raw entry/stop
prices. They are named so they can never collide with a `snapshot_db`
column; Task A6's builder derives `pattern_entry_dist_pct` /
`pattern_stop_dist_pct` from them against the row's own price and then
discards them (they never reach `screener_rows`).

**PER-PATTERN 0/1 FLAGS — this module is their ONE writer.** `pattern_engine_ids`
is TEXT and permanently excluded from the closed table by shape, and
`pattern_engine_conf` carries a confidence with no NAME attached, so a formula
could not ask *"is this a VCP?"*. `_PATTERN_FLAG_COLUMNS` below maps a snapshot
column to the detector id that sets it — the SET is deliberately tiny and each
entry earns its place by clearing a named refusal in
`app/src/components/chart/engine/ast/starterScans.json::_ungrounded`; see
`.superpowers/sdd/2026-08-22-screener-wave5-patterns-flow/lane-b-pattern-flags-report.md`
for the measurement and the unlock table. ⛔ This is NOT one column per
detector: 85 detectors are registered and 78 of them fired in the last seven
days, and a column named for a setup nothing refuses is nightly compute nobody
asked for.

⛔⛔ **0 AND NULL ARE DIFFERENT FACTS AND THIS IS THE WHOLE HONESTY OF THE
COLUMN.** A ticker with active detections and no `vcp` among them gets `0` —
the engine looked and the answer is no. A ticker with NO active detection at
all is absent from this reader's output entirely (the `if not dets: continue`
below), so every flag reads NULL downstream — the engine has told us nothing
about that symbol, which is not the same as telling us "no". Writing a 0 there
would turn "we have no data" into a confident negative, and a member screening
`pattern_engine_vcp == 0` would be handed ~700 symbols the engine never
scanned. The evidence that a symbol WAS scanned is the presence of at least one
active detection; there is no scan ledger to consult, so the conservative
direction (NULL, not 0) is the honest one.

⭐ **The flags read the UNCAPPED id set, and that is why they are not derivable
from `pattern_engine_ids`.** That column is capped at `_MAX_IDS` by confidence
desc for display; a `vcp` sitting eleventh on a busy symbol falls off the TEXT
list while the flag still says 1. `seen_set` below is the uncapped set and is
what the flags read — never `seen[:_MAX_IDS]`.

**as-of family: `snapshot_date`, for every column this reader persists (K6).**
A detection's `detected_at`/expectancy age independently of the bar series
this build ran against — `bars_asof` would falsely claim "the newest bar the
math saw."

Failure contract: any exception or an empty active-detection set for the
whole universe returns `{}` (every column stays not-computable) plus a
`_note(failures, "pattern_join", ...)` census entry — never a partial guess.
A target ticker with no active detection is simply absent from the output
dict (not an error) so its columns read None downstream, same as every
other context-join reader in this package.
"""
from __future__ import annotations

import contextlib
import json
import time

_ACTIVE_STATUSES = ("forming", "ready", "triggered")

#: ⛔⛔ THE CANDLE/ENGINE BOUNDARY, ENFORCED HERE BECAUSE THIS IS WHERE IT IS
#: CROSSED. The owner ruled 2026-08-30 that the 18 `detectors/candlestick/*`
#: stay, on the grounds that the chart overlay `GET /api/patterns/{sym}`
#: consumes them and the candle library does not serve that endpoint. That
#: ruling is sound — and it is only SAFE if the boundary is actually enforced,
#: which it was not.
#:
#: Measured over the 7-day active window: SIXTEEN candlestick detector ids were
#: reaching `pattern_engine_ids`, on 1,987 of 2,890 covered symbols (68.8%),
#: from 3,285 detections. So the screener carried TWO authorities on "what
#: candle is this" — `candle_matches`, which names 62 structures at 100%
#: coverage with sourced precedence rules, and this, which names 16 at 68.8%
#: with none. A member could screen both and get different answers about the
#: same bar.
#:
#: The split is therefore: THE CANDLE LIBRARY OWNS SCREENER COLUMNS, THE ENGINE
#: OWNS THE CHART OVERLAY, AND NEITHER CROSSES. Excluded by the store's own
#: `category` column rather than by a typed id list, so a candlestick detector
#: added tomorrow is excluded the day it ships.
_SCREENER_EXCLUDED_CATEGORIES = ("candlestick",)
_WINDOW_SECS = 7 * 24 * 3600
#: ⭐ RAISED 10 -> 20, MEASURED. With the eight near-universal detectors gone
#: (see UNINFORMATIVE_SHARE) the id counts collapse: median 6, p90 10, p99 13,
#: MAX 17 across 2,890 covered symbols. At the old cap of 10, 202 symbols
#: (7.0%) were still truncated; at 20 it is ZERO, with three ids of headroom
#: over the observed maximum. The cap stays — an unbounded TEXT list in a
#: nightly column is not something to leave open-ended — but it no longer cuts.
_MAX_IDS = 20

#: ⛔ DELIMITER-WRAPPED, AND THIS ONE IS A CORRECTNESS FIX, NOT TIDINESS.
#: Detector ids collide as substrings: `head_shoulders` is inside
#: `inverse_head_shoulders`, and `cup_handle` is inside BOTH `cup_handle_uct`
#: and `inverse_cup_handle`. `contains` compiles to `LIKE %v%` in `query.py`,
#: so a member screening for a head-and-shoulders would silently also match
#: every inverse one — the opposite pattern. Wrapping every id in the
#: separator makes the test exact, exactly as `candle_matches` and
#: `base_matches` already do.
MATCH_SEP = ","

#: ⛔⛔ A DETECTOR THAT FIRES ON NEARLY EVERY SYMBOL CARRIES NO INFORMATION, and
#: ranking it last was not enough — it still occupied a slot in a 10-wide list.
#: Measured 2026-08-30 over the 7-day active window (2,890 covered symbols, 78
#: detectors that fired): EIGHT fire on >=95% of them — `stage_analysis`,
#: `52w_proximity`, `can_slim_composite`, `kell_cycle`, `volume_profile_nodes`
#: and `accumulation_distribution` at exactly 100%, `swing_pivots` at 99.8%,
#: `support_resistance` at 97.3%.
#:
#: Their effect on the column was severe: the median symbol carried 14 distinct
#: ids against a cap of 10, so **2,624 of 2,890 (90.8%)** were truncated and
#: `pattern_engine_ids CONTAINS '…'` was silently wrong for most of the
#: universe. Dropping these eight takes the median to 6 and truncation to
#: **202 of 2,890 (7.0%)**.
#:
#: ⭐ THE SET IS DERIVED, NEVER TYPED. The share is computed from `by_ticker`,
#: which this reader already builds for the rarity ordering — so it is measured
#: over exactly the population being served and cannot disagree with a second
#: window, and a detector whose behaviour changes moves in or out on its own.
#: A hand-listed set here would go stale the first time a detector was retuned.
UNINFORMATIVE_SHARE = 0.95

#: ⛔ AND A FLOOR UNDER THE POPULATION, BECAUSE A SHARE IS NOT ESTIMABLE ON A
#: HANDFUL OF SYMBOLS. Caught by `test_the_flag_reads_the_UNCAPPED_id_set`:
#: with ONE covered ticker, 0.95 x 1 = 0.95, so EVERY detector clears the bar
#: and the display list empties entirely. That is not a measurement of
#: informativeness — it is a measurement of "there is only one symbol here".
#: Below this floor the rate is not computed from a population worth trusting,
#: so nothing is excluded and the column behaves exactly as it did before.
#: origin: uct — a real universe read covers ~2,890 symbols; a unit fixture
#: covers a handful, and 100 separates them by two orders of magnitude.
MIN_POPULATION_FOR_EXCLUSION = 100

#: snapshot column -> pattern-engine detector id. See the docstring: each entry
#: exists to clear a NAMED refusal in the formula library's `_ungrounded` set,
#: and the detector id on the right is a real registered id (the rail derives
#: the check from `detectors.registry.list_pattern_ids()`, never a typed list).
_PATTERN_FLAG_COLUMNS = {
    "pattern_engine_vcp": "vcp",
    "pattern_engine_flat_base": "flat_base",
}


def _note(failures, source, outcome) -> None:
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _direction_num(direction) -> int:
    # The store's Direction is Literal["bullish","bearish","neutral"] with no
    # DB-level CHECK, so an unrecognized value here would be a data-integrity
    # breach one layer up — it reads as 0 (neutral) by this fallthrough, the
    # least-claiming encoding. If corruption is ever suspected, this is the
    # seam to instrument.
    if direction == "bullish":
        return 1
    if direction == "bearish":
        return -1
    return 0


def _levels(levels_json):
    """Best-effort parse of `levels_json`; a malformed blob reads as
    "no levels" (entry/stop both absent) rather than raising."""
    try:
        parsed = json.loads(levels_json) if levels_json else {}
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def read_pattern_fields(targets, failures=None) -> dict:
    """One bulk read of active 7-day daily detections + a second bulk read
    of their regime-blind expectancy, grouped in Python per ticker.

    See the module docstring for the WHERE-shape citation, the two
    confidence scales, the regime-blind join, the direction encoding, and
    the "best detection" rule.
    """
    try:
        from api.services.pattern_engine import pattern_db

        cutoff = int(time.time()) - _WINDOW_SECS
        placeholders = ",".join("?" * len(_ACTIVE_STATUSES))
        cat_ph = ",".join("?" * len(_SCREENER_EXCLUDED_CATEGORIES))
        sql = f"""
            SELECT sym, pattern_id, direction, confidence, levels_json, detected_at
            FROM pattern_detections
            WHERE tf = 'D'
              AND status IN ({placeholders})
              AND detected_at >= ?
              AND (category IS NULL OR category NOT IN ({cat_ph}))
        """
        with contextlib.closing(pattern_db.get_connection()) as conn:
            rows = conn.execute(
                sql, (*_ACTIVE_STATUSES, cutoff,
                      *_SCREENER_EXCLUDED_CATEGORIES)).fetchall()
    except Exception as e:
        _note(failures, "pattern_join", e)
        return {}

    if not rows:
        _note(failures, "pattern_join", "empty")
        return {}

    by_ticker: dict = {}
    for r in rows:
        by_ticker.setdefault(r["sym"], []).append(r)

    # "Best" per ticker: highest confidence among rows with non-null
    # entry AND stop; tie -> newest detected_at (ruling D5, K5).
    best_by_ticker: dict = {}
    for sym, dets in by_ticker.items():
        best_row = None
        best_levels = None
        for d in dets:
            levels = _levels(d["levels_json"])
            if levels.get("entry") is None or levels.get("stop") is None:
                continue
            if best_row is None:
                best_row, best_levels = d, levels
                continue
            if (d["confidence"], d["detected_at"]) > (best_row["confidence"], best_row["detected_at"]):
                best_row, best_levels = d, levels
        if best_row is not None:
            best_by_ticker[sym] = (best_row, best_levels)

    # Second bulk query (never per-ticker): regime-blind expectancy for the
    # distinct set of best pattern_ids actually in play (ruling D3).
    expectancy_by_pattern: dict = {}
    pattern_ids = sorted({row["pattern_id"] for row, _ in best_by_ticker.values()})
    if pattern_ids:
        try:
            placeholders2 = ",".join("?" * len(pattern_ids))
            sql2 = f"""
                SELECT pattern_id, n_resolved, expectancy_R FROM pattern_stats
                WHERE tf = 'D' AND regime_bucket = 'unknown'
                  AND pattern_id IN ({placeholders2})
            """
            with contextlib.closing(pattern_db.get_connection()) as conn:
                exp_rows = conn.execute(sql2, pattern_ids).fetchall()
            for er in exp_rows:
                # ⛔ `n_resolved` is the gate. The row exists from the moment a
                # pattern is first SEEN, carrying n_resolved=0 and a synthetic
                # expectancy_R of 0.0 — so an `is not None` check publishes
                # "breakeven" for a pattern that has never had one outcome
                # resolve. Absent, not zero: the caller renders a missing key
                # as "not computable" and a 0.0 as a measurement.
                if not er["n_resolved"]:
                    continue
                if er["expectancy_R"] is not None:
                    expectancy_by_pattern[er["pattern_id"]] = er["expectancy_R"]
        except Exception as e:
            # Expectancy is a bonus field on top of an already-answered
            # active-detection read; a broken stats table degrades that one
            # field, not the whole source.
            _note(failures, "pattern_join_expectancy", e)

    out = {}
    # 🔴 THE CAP USED TO EVICT EXACTLY THE INFORMATIVE IDS. Ordering by
    # confidence and keeping the first `_MAX_IDS` sounds neutral and is not:
    # measured 2026-08-23, the median covered symbol carries **14** distinct
    # active ids against a cap of 10, so **2,675 of 2,890 (92.6%)** are
    # truncated — and eight detectors (`kell_cycle`, `can_slim_composite`,
    # `stage_analysis`, `52w_proximity`, …) fire on ~100% of the universe.
    # Firing on everything, they carry NO information, and being high-confidence
    # they sorted to the FRONT and consumed the slots. `cup_handle` (96 symbols)
    # or `high_tight_flag` (8) — the ones a member actually screens for — were
    # cut. So `pattern_engine_ids CONTAINS '…'` was silently wrong for most of
    # the universe, which is an accuracy defect wearing a truncation's clothes.
    #
    # ⭐ ORDER BY RARITY, RAREST FIRST — a detector's symbol count IS its
    # informativeness, inverted. Derived from `by_ticker`, which is already in
    # hand: no extra query, and the rate is measured over exactly the population
    # being served, so it cannot disagree with a second window.
    # ⚠️ The cap still truncates. The flags below are the complete answer and
    # are built from the UNCAPPED set; this column is "the most distinctive
    # ids", and its `desc` has to say so.
    pid_symbols: dict = {}
    for _tu, _dets in by_ticker.items():
        for _pid in {d["pattern_id"] for d in _dets}:
            pid_symbols[_pid] = pid_symbols.get(_pid, 0) + 1

    # The count of symbols above which a detector is treated as uninformative,
    # derived from the population actually covered by this read.
    covered = len(by_ticker)
    uninformative_floor = (UNINFORMATIVE_SHARE * covered
                           if covered >= MIN_POPULATION_FOR_EXCLUSION
                           else float("inf"))

    for t in targets:
        tu = str(t).upper()
        dets = by_ticker.get(tu)
        if not dets:
            continue
        row = {}
        # DISTINCT ids, RAREST-FIRST then confidence-desc, capped `_MAX_IDS`.
        ordered = sorted(dets, key=lambda d: (pid_symbols.get(d["pattern_id"], 0),
                                              -d["confidence"], -d["detected_at"]))
        seen: list = []
        seen_set: set = set()
        for d in ordered:
            pid = d["pattern_id"]
            if pid not in seen_set:
                seen_set.add(pid)
                seen.append(pid)
        # ⛔ EXCLUDED FROM THE DISPLAY LIST, NOT FROM `seen_set`. The flags below
        # must still be able to answer "is this a VCP?" over the complete set;
        # what the near-universal ids cost is a SLOT in a 10-wide column, and
        # that is what this removes.
        shown = [pid for pid in seen
                 if pid_symbols.get(pid, 0) < uninformative_floor]
        row["pattern_engine_ids"] = (MATCH_SEP + MATCH_SEP.join(shown[:_MAX_IDS])
                                     + MATCH_SEP) if shown else None
        row["pattern_engine_conf"] = max(d["confidence"] for d in dets)

        # Per-pattern flags, from the UNCAPPED id set (`seen_set`, never
        # `seen[:_MAX_IDS]` — see the docstring). We only reach this line
        # because `dets` is non-empty, which IS the evidence that the engine
        # has an answer for this symbol; a symbol it has said nothing about
        # never gets a `row` at all and reads NULL, not 0.
        for col, pid in _PATTERN_FLAG_COLUMNS.items():
            row[col] = 1 if pid in seen_set else 0

        best = best_by_ticker.get(tu)
        if best is not None:
            best_row, best_levels = best
            row["pattern_engine_dir"] = _direction_num(best_row["direction"])
            entry_px = best_levels.get("entry")
            stop_px = best_levels.get("stop")
            if entry_px is not None:
                row["pattern_entry_px"] = entry_px
            if stop_px is not None:
                row["pattern_stop_px"] = stop_px
            exp = expectancy_by_pattern.get(best_row["pattern_id"])
            if exp is not None:
                row["pattern_expectancy_r"] = exp
        out[tu] = row
    return out


def read_pattern_fields_canonical_shadow(targets) -> dict:
    """Phase 8, Package 8C — SHADOW-ONLY. Proves the canonical scanner
    contract (types.py's ScannerSummary, canonical_adapter.build_scanner_
    summary) against the SAME real query shape and the SAME real
    pattern_detections table `read_pattern_fields` above reads — without
    touching that function or anything it feeds (snapshot_builder.py,
    screener_rows, the live nightly cron, or any member-facing output).

    NOT called by snapshot_builder.py or any scheduled job. Its only caller
    is the Package-8C shadow-parity test, which compares this function's
    output against read_pattern_fields()'s real output for the same
    targets to prove the canonical read adds evidence without changing
    detector-level facts (identity, direction, best-detection selection).

    Additive over read_pattern_fields's own SELECT: eligibility_json (the
    one new column this package added), plus geometry_json/quality_json/
    narrative_json/status — all FOUR of the latter already existed as
    columns before this package; read_pattern_fields simply never SELECTed
    them (Phase-7 spec's persistence addendum). No schema change was needed
    for those four.
    """
    from api.services.pattern_engine import pattern_db
    from api.services.pattern_engine.canonical_adapter import build_scanner_summary

    cutoff = int(time.time()) - _WINDOW_SECS
    placeholders = ",".join("?" * len(_ACTIVE_STATUSES))
    cat_ph = ",".join("?" * len(_SCREENER_EXCLUDED_CATEGORIES))
    sql = f"""
        SELECT sym, pattern_id, direction, confidence, levels_json, detected_at,
               status, geometry_json, quality_json, narrative_json, eligibility_json
        FROM pattern_detections
        WHERE tf = 'D'
          AND status IN ({placeholders})
          AND detected_at >= ?
          AND (category IS NULL OR category NOT IN ({cat_ph}))
    """
    with contextlib.closing(pattern_db.get_connection()) as conn:
        rows = conn.execute(
            sql, (*_ACTIVE_STATUSES, cutoff, *_SCREENER_EXCLUDED_CATEGORIES)).fetchall()

    by_ticker: dict = {}
    for r in rows:
        by_ticker.setdefault(r["sym"], []).append(r)

    out: dict = {}
    for t in targets:
        tu = str(t).upper()
        dets = by_ticker.get(tu)
        if not dets:
            continue
        # Same "best" rule as read_pattern_fields: highest confidence among
        # rows with both entry AND stop; tie -> newest detected_at.
        best_row, best_levels = None, None
        for d in dets:
            levels = _levels(d["levels_json"])
            if levels.get("entry") is None or levels.get("stop") is None:
                continue
            if best_row is None or (d["confidence"], d["detected_at"]) > (
                best_row["confidence"], best_row["detected_at"]
            ):
                best_row, best_levels = d, levels
        if best_row is None:
            continue

        reconstructed = {
            "pattern_id": best_row["pattern_id"],
            "pattern_name": best_row["pattern_id"].replace("_", " ").title(),
            "direction": best_row["direction"],
            "status": best_row["status"],
            "confidence": best_row["confidence"],
            "geometry": json.loads(best_row["geometry_json"]),
            "quality_components": json.loads(best_row["quality_json"]),
            "narrative": json.loads(best_row["narrative_json"]),
        }
        eligibility_json = best_row["eligibility_json"]
        if eligibility_json is not None:
            reconstructed["eligibility"] = json.loads(eligibility_json)
        # Transitional storage mapping, not native canonical persistence
        # (ChatGPT relay review, 2026-09-04): PEG's event data has no column
        # of its own -- it is reconstructed from the pre-existing
        # geometry_json.extras fields the same way canonical_adapter.
        # adapt_power_earnings_gap does in memory. The canonical model is
        # cleaner than this legacy physical layout; this mapping exists only
        # to prove the shadow contract against real persisted rows.
        extras = reconstructed["geometry"].get("extras", {})
        days = extras.get("days_to_earnings")
        if days is not None or "earnings_linkage_verified" in extras:
            verified = extras.get("earnings_linkage_verified")
            status_ = (
                "unavailable" if days is None
                else "verified" if verified
                else "contradicted"
            )
            reconstructed["event"] = {"event_type": "earnings", "verification_status": status_,
                                       "days_from_event": days}

        out[tu] = build_scanner_summary(reconstructed)
    return out
