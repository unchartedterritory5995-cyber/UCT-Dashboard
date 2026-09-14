"""Metrics 6.1-6.3 (W1 Part 6; docs/wisdom/methodology/metrics-v1.md; CONTRACTS §6.5).

Every row carries numerator and denominator; value is NULL at 0/0 and renders "0/0", never a
percentage. Unproven records are NOT in any denominator — they are counted by name in notes,
because a rate over "whatever we could prove" that hides how much could not be proven is the
flattering number this program must not print.

6.1 uct_see_rate_{any,topn,setup}  CALLs, hindsight excluded (D8), per replay level
6.2 false_positive_rate            explicit NEGATIVE_CALLs (passed | avoid; no-views are MENTIONs
                                   and never enter), flagged with the MATCHING setup that session
6.3 outcome_weighted_see_rate      the any-level see rate weighted by quality-v1 outcome weight;
                                   the raw rate over the same records sits beside it in notes

Slices: overall, and one dimension at a time (setup, author, stream, month), each for
status confirmed | provisional | combined.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import datetime
from typing import Iterable, Optional

from api.services.wisdom.core import ids, timeutil
from api.services.wisdom.evals import outcomes as outcomes_mod
from api.services.wisdom.evals import replay as replay_mod

METHOD_VERSION = "metrics-v1"
STATUSES = ("confirmed", "provisional", "combined")
DIMENSIONS = ("setup", "author", "stream", "month")
SEE_RATE_METRICS = {"any": "uct_see_rate_any", "topn": "uct_see_rate_topn", "setup": "uct_see_rate_setup"}
FALSE_POSITIVE = "false_positive_rate"
OUTCOME_WEIGHTED = "outcome_weighted_see_rate"
GROUNDING_METRICS = ("grounding_faithfulness", "grounding_citation_validity", "grounding_coverage")


def is_see_rate_call(r: dict) -> bool:
    return (r.get("record_type") == "CALL" and not int(r.get("hindsight") or 0)
            and (r.get("stance") or "") != "hindsight" and bool((r.get("ticker") or "").strip()))


def is_explicit_pass(r: dict) -> bool:
    return (r.get("record_type") == "NEGATIVE_CALL" and (r.get("stance") or "") in ("passed", "avoid")
            and bool((r.get("ticker") or "").strip()))


def load_records(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT r.record_id, r.record_type, r.author_id, r.stated_at_et, r.stated_at_precision, r.ticker, "
        "r.stance, r.direction, r.setup_name_raw, r.vocab_id, r.hindsight, r.status, r.source_id, s.stream "
        "FROM wisdom_records r LEFT JOIN wisdom_sources s ON s.source_id = r.source_id "
        "WHERE r.record_type IN ('CALL','NEGATIVE_CALL') AND r.status IN ('confirmed','provisional')").fetchall()
    return [dict(r) for r in rows]


def load_checks(conn: sqlite3.Connection, method_version: str = replay_mod.METHOD_VERSION) -> dict:
    out: dict = defaultdict(list)
    for row in conn.execute("SELECT * FROM wisdom_replay_checks WHERE method_version=?", (method_version,)):
        out[row["record_id"]].append(dict(row))
    return out


def load_outcomes(conn: sqlite3.Connection) -> dict:
    return {row["record_id"]: dict(row) for row in conn.execute(
        "SELECT * FROM wisdom_outcomes WHERE methodology_version=?", (outcomes_mod.METHODOLOGY_VERSION,))}


def _dim_value(r: dict, dim: str, record_vocab: Optional[str]) -> str:
    if dim == "setup":
        if record_vocab:
            return record_vocab
        raw = (r.get("setup_name_raw") or "").strip().lower()
        return raw or "(none)"
    if dim == "author":
        return r.get("author_id") or "(unknown)"
    if dim == "stream":
        return r.get("stream") or "(unknown)"
    if dim == "month":
        return (r.get("stated_at_et") or "")[:7] or "(unknown)"
    raise ValueError(dim)


def _rate(numerator: int, denominator: int) -> Optional[float]:
    return None if denominator == 0 else round(numerator / denominator, 6)


def render(row: dict) -> str:
    """'0/0' at zero denominator, else 'k/n (p%)'; the weighted metric shows its raw rate beside it."""
    num, den, value = int(row.get("numerator") or 0), int(row.get("denominator") or 0), row.get("value")
    if den == 0:
        return "0/0"
    notes = row.get("notes")
    if isinstance(notes, str):
        try:
            notes = json.loads(notes)
        except ValueError:
            notes = {}
    if row.get("metric") == OUTCOME_WEIGHTED:
        weighted = "n/a (weight sum 0)" if value is None else f"{value * 100:.1f}% weighted"
        return f"{weighted} · raw {num}/{den} ({num / den * 100:.1f}%)"
    shown = value if value is not None else num / den
    return f"{num}/{den} ({shown * 100:.1f}%)"


def compute(conn: sqlite3.Connection, *, vocab: Optional[replay_mod.VocabLookup] = None,
            now: Optional[datetime] = None) -> list[dict]:
    """Every 6.1-6.3 row for one metric run (not written; see write())."""
    computed_at = timeutil.iso_et(now or timeutil.now_et())
    run_id = ids.sha24("metrics", METHOD_VERSION, computed_at)
    vocab = vocab or replay_mod.VocabLookup(conn)
    records = load_records(conn)
    checks = load_checks(conn)
    outcome_rows = load_outcomes(conn)

    enriched = []
    for r in records:
        rv = vocab.for_record(r)
        record_checks = checks.get(r["record_id"], [])
        levels = replay_mod.level_verdicts(record_checks, rv)
        if not record_checks:
            for level in levels.values():
                if level["verdict"] != "excluded":
                    level["verdict"] = "unproven"
                    level["reason"] = "not_replayed"
        enriched.append((r, rv, levels))

    rows: list[dict] = []

    def emit(metric, slice_, numerator, denominator, value, notes):
        rows.append({"metric_run_id": run_id, "metric": metric, "slice_json": json.dumps(slice_, sort_keys=True),
                     "numerator": int(numerator), "denominator": int(denominator), "value": value,
                     "method_version": METHOD_VERSION, "computed_at": computed_at,
                     "notes": json.dumps(notes, sort_keys=True)})

    for status in STATUSES:
        in_status = [e for e in enriched if status == "combined" or e[0]["status"] == status]
        for dim in (None,) + DIMENSIONS:
            grouped: dict = defaultdict(list)
            for item in in_status:
                grouped[None if dim is None else _dim_value(item[0], dim, item[1])].append(item)
            if dim is None and not grouped:
                grouped[None] = []
            for value_key, items in grouped.items():
                slice_ = {"status": status}
                if dim is not None:
                    slice_[dim] = value_key
                calls = [e for e in items if is_see_rate_call(e[0])]
                passes = [e for e in items if is_explicit_pass(e[0])]
                if dim is not None and not calls and not passes:
                    continue
                for level, metric in SEE_RATE_METRICS.items():
                    tally = _tally(calls, level)
                    emit(metric, slice_, tally["hit"], tally["hit"] + tally["miss"],
                         _rate(tally["hit"], tally["hit"] + tally["miss"]), dict(tally, level=level,
                                                                                 population=len(calls)))
                tally = _tally(passes, "setup")
                emit(FALSE_POSITIVE, slice_, tally["hit"], tally["hit"] + tally["miss"],
                     _rate(tally["hit"], tally["hit"] + tally["miss"]), dict(tally, level="setup",
                                                                             population=len(passes)))
                emit(OUTCOME_WEIGHTED, slice_, *_weighted(calls, outcome_rows))
    return rows


def _tally(items: Iterable, level: str) -> dict:
    tally = {"hit": 0, "miss": 0, "unproven": 0, "not_replayed": 0, "excluded": 0}
    for _r, _rv, levels in items:
        verdict = levels[level]
        v = verdict["verdict"]
        if v in ("hit", "miss"):
            tally[v] += 1
        elif v == "excluded":
            tally["excluded"] += 1
        elif verdict.get("reason") == "not_replayed":
            tally["not_replayed"] += 1
        else:
            tally["unproven"] += 1
    return tally


def _weighted(calls: list, outcome_rows: dict) -> tuple:
    weight_sum = weighted_hits = 0.0
    numerator = denominator = no_outcome = 0
    unproven = 0
    for r, _rv, levels in calls:
        verdict = levels["any"]["verdict"]
        if verdict not in ("hit", "miss"):
            unproven += 1
            continue
        w = outcomes_mod.quality_weight(outcome_rows.get(r["record_id"]))
        if w is None:
            no_outcome += 1
            continue
        denominator += 1
        weight_sum += w
        if verdict == "hit":
            numerator += 1
            weighted_hits += w
    value = None if weight_sum == 0 else round(weighted_hits / weight_sum, 6)
    notes = {"level": "any", "weight_fn": "quality-v1", "weight_sum": round(weight_sum, 6),
             "weighted_hits": round(weighted_hits, 6), "raw_value": _rate(numerator, denominator),
             "raw": f"{numerator}/{denominator}", "no_matured_outcome": no_outcome,
             "unproven_or_not_replayed": unproven, "population": len(calls)}
    return numerator, denominator, value, notes


def write(conn: sqlite3.Connection, rows: list[dict]) -> int:
    conn.executemany(
        "INSERT INTO wisdom_metrics (metric_run_id, metric, slice_json, numerator, denominator, value, "
        "method_version, computed_at, notes) VALUES (:metric_run_id, :metric, :slice_json, :numerator, "
        ":denominator, :value, :method_version, :computed_at, :notes)", rows)
    return len(rows)


def latest_metrics(conn: sqlite3.Connection) -> list[dict]:
    """The latest run of every metric (grounding metrics: the latest run per retrieval arm), each
    row with its parsed slice, notes and a 'display' string that shows n."""
    runs = conn.execute(
        "SELECT metric, metric_run_id, MAX(computed_at) AS at, MAX(notes) AS notes FROM wisdom_metrics "
        "GROUP BY metric, metric_run_id ORDER BY at DESC").fetchall()
    chosen: dict = {}
    for run in runs:
        try:
            arm = (json.loads(run["notes"] or "{}") or {}).get("arm")
        except ValueError:
            arm = None
        key = (run["metric"], arm)
        if key not in chosen:
            chosen[key] = run["metric_run_id"]
    out = []
    for (metric, _arm), run_id in sorted(chosen.items(), key=lambda kv: (kv[0][0], str(kv[0][1]))):
        for row in conn.execute("SELECT * FROM wisdom_metrics WHERE metric=? AND metric_run_id=? "
                                "ORDER BY slice_json", (metric, run_id)):
            item = dict(row)
            item["slice"] = json.loads(item.pop("slice_json") or "{}")
            try:
                item["notes"] = json.loads(item.get("notes") or "{}")
            except ValueError:
                pass
            item["display"] = render(item)
            out.append(item)
    return out
