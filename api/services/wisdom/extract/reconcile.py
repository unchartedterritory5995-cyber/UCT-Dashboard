"""Wave 1.5 item 2 — the N-pass reconciler. Turns persisted gate runs into a stability score.

**The owner's wording:** *"extract each segment N=3 times (Batch) … keep a record only if it
appears in >= 2 of 3, and store stability = runs_present / N"*.

⛔⛔ **MATCHING IS BY KEY, PER SEGMENT — NEVER BY TEXT AND NEVER BY SPAN.** That is the E5 lesson
paid for twice. `writer.Checked.key()` is the identity that survives paraphrase: for PRINCIPLE and
MARKET_SIGNAL it is `normalize_quote_key` over the statement/name, and for the four mechanical
types it is `(type, ticker, stance, direction)`. Char spans move between runs even when the
extractor found the same thing, so a span-based match would report disagreement that is really
re-wording — the exact confound that made a precision/recall delta unciteable in session 2.

⭐ **Per SEGMENT**, because that is what the measurement means: stability asks whether re-extracting
*the same paragraph* yields the same record. The group key is therefore `(segment_id, record key)`.

⛔ **The runs must agree on extractor_version AND on the segment set.** Mixing versions is the same
class of confound as E5 — two runs scored under different rules cannot be compared, and a
reconciler that silently averaged them would manufacture a stability number nobody could defend.
Both mismatches REFUSE, naming what differs.

⚠️ **MARKET_SIGNAL's identity is the newest and the least settled.** Session 3 recorded that
MARKET_SIGNAL has no id anywhere in the schema — it lives only as `wisdom_records.market_signal_json`
— so its key here is `(type, normalize_quote_key(name))`, the tuple session 4's persistence
adopted. **That is the first stable id MARKET_SIGNAL has had**, and it is name-based: a signal
renamed between runs reads as two different signals and scores 1/N twice instead of 2/N once.
Recorded as a question rather than presented as settled.

⛔ **Writers touch COLUMNS ONLY.** `stability` and `stability_runs` are written by `record_id` and
by `principle_key`; nothing that feeds `writer._canonical_hash` is read or written, so
`record_hash` and `record_id` are unchanged. A test pins that across a write.
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
from typing import Iterable, Optional

RECORDS_FILE = "records.jsonl"
MANIFEST_FILE = "manifest.json"
DEFAULT_ROOT = pathlib.Path("data") / "wisdom" / "gate-runs"

#: Written beside the runs it reconciles, in the same gitignored tree (§0.4f).
REPORT_FILE = "reconcile-report.json"


class ReconcileRefused(ValueError):
    """A reconciliation that cannot be defended is refused, never approximated."""


def _run_dir(root, run_id: str) -> pathlib.Path:
    return pathlib.Path(root) / run_id


def load_run(root, run_id: str, *, phase: str = "gate") -> dict:
    """One persisted run's records and its manifest. Raises if the run is not there."""
    d = _run_dir(root, run_id)
    records_path = d / RECORDS_FILE
    if not records_path.exists():
        raise ReconcileRefused(f"run {run_id!r} has no {RECORDS_FILE} at {d}")
    rows = []
    for line in records_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("phase") == phase:
            rows.append(row)
    manifest = {}
    if (d / MANIFEST_FILE).exists():
        manifest = json.loads((d / MANIFEST_FILE).read_text(encoding="utf-8"))
    versions = {r.get("extractor_version") for r in rows}
    return {"run_id": run_id, "rows": rows, "manifest": manifest,
            "extractor_version": versions.pop() if len(versions) == 1 else None,
            "segments": {r.get("segment_id") for r in rows}}


def group_key(row: dict) -> tuple:
    """The identity a record is matched on ACROSS runs. ⛔ Key only — never text, never span.

    PRINCIPLE uses its cross-segment `principle_key` where the run recorded one, because that is
    the identity the Brain KB lane itself keys on; everything else uses `record_key`, which is
    already `normalize_quote_key`-based for MARKET_SIGNAL and structured for the four mechanical
    types.
    """
    rtype = row.get("record_type")
    if rtype == "PRINCIPLE" and row.get("principle_key"):
        ident = ("PRINCIPLE", row["principle_key"])
    elif rtype == "MARKET_SIGNAL" and row.get("market_signal_key"):
        ident = tuple(row["market_signal_key"])
    else:
        ident = tuple(row.get("record_key") or (rtype,))
    return (row.get("segment_id"), ident)


def reconcile(runs: list) -> dict:
    """Fold N runs into one score per (segment, key). Refuses on a version or segment-set mismatch.

    ⛔ `N` is `len(runs)` — the number of passes actually reconciled — and is written alongside
    every score. A ratio without its denominator is not a measurement (Q17 then reads that
    denominator and blocks anything measured over too few passes).
    """
    if len(runs) < 2:
        raise ReconcileRefused(f"reconciliation needs at least 2 runs, got {len(runs)}")

    versions = {r["extractor_version"] for r in runs}
    if len(versions) != 1 or None in versions:
        detail = ", ".join(f"{r['run_id']}={r['extractor_version']}" for r in runs)
        raise ReconcileRefused(
            "refusing to reconcile runs with different extractor_version — two runs scored under "
            f"different rules cannot be compared (E5): {detail}")

    segment_sets = [r["segments"] for r in runs]
    if any(s != segment_sets[0] for s in segment_sets[1:]):
        base = segment_sets[0]
        diffs = []
        for r in runs[1:]:
            missing, extra = sorted(base - r["segments"]), sorted(r["segments"] - base)
            if missing or extra:
                diffs.append(f"{r['run_id']}: missing {len(missing)}, extra {len(extra)}")
        raise ReconcileRefused(
            "refusing to reconcile runs over different segment sets — a record absent because its "
            f"segment was never sent is not a record the extractor disagreed about: {'; '.join(diffs)}")

    n = len(runs)
    seen: dict = {}
    for run in runs:
        for key in {group_key(row) for row in run["rows"]}:      # a key counts ONCE per run
            slot = seen.setdefault(key, {"runs_present": 0, "record_ids": set(),
                                         "principle_keys": set(), "record_type": None})
            slot["runs_present"] += 1
        for row in run["rows"]:
            slot = seen[group_key(row)]
            slot["record_type"] = slot["record_type"] or row.get("record_type")
            if row.get("record_id"):
                slot["record_ids"].add(row["record_id"])
            if row.get("principle_key"):
                slot["principle_keys"].add(row["principle_key"])

    scores = []
    for (segment_id, ident), slot in sorted(seen.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))):
        scores.append({
            "segment_id": segment_id,
            "identity": list(ident),
            "record_type": slot["record_type"],
            "runs_present": slot["runs_present"],
            "n": n,
            "stability": slot["runs_present"] / n,
            "record_ids": sorted(slot["record_ids"]),
            "principle_keys": sorted(slot["principle_keys"]),
        })
    return {"n": n, "run_ids": [r["run_id"] for r in runs],
            "extractor_version": versions.pop(), "scores": scores}


def histogram(result: dict) -> dict:
    """Per-type counts by stability value, plus how many would clear the Q17 floor."""
    from api.services.wisdom.publish import floor

    out: dict = {}
    for s in result["scores"]:
        slot = out.setdefault(s["record_type"] or "UNKNOWN",
                              {"total": 0, "by_stability": {}, "clears_floor": 0})
        slot["total"] += 1
        bucket = f"{s['runs_present']}/{s['n']}"
        slot["by_stability"][bucket] = slot["by_stability"].get(bucket, 0) + 1
        if floor.passes(s["record_type"], s["stability"], s["n"]):
            slot["clears_floor"] += 1
    return out


def write_scores(conn: sqlite3.Connection, result: dict) -> dict:
    """Write stability + stability_runs as COLUMNS. ⛔ Never touches a hashed field.

    Returns counts of rows actually updated, so a write that matched nothing is visible rather
    than reported as success.
    """
    records = principles = 0
    for s in result["scores"]:
        if s["record_ids"]:
            cur = conn.execute(
                f"UPDATE wisdom_records SET stability = ?, stability_runs = ? "
                f"WHERE record_id IN ({','.join('?' * len(s['record_ids']))})",
                [s["stability"], s["n"], *s["record_ids"]])
            records += cur.rowcount or 0
        if s["principle_keys"]:
            cur = conn.execute(
                f"UPDATE wisdom_principles SET stability = ?, stability_runs = ? "
                f"WHERE principle_key IN ({','.join('?' * len(s['principle_keys']))})",
                [s["stability"], s["n"], *s["principle_keys"]])
            principles += cur.rowcount or 0
    return {"records_updated": records, "principles_updated": principles}


def write_report(root, result: dict, *, extra: Optional[dict] = None) -> pathlib.Path:
    """The reconciliation's own artifact, beside the runs, in the gitignored tree."""
    import os

    payload = {"n": result["n"], "run_ids": result["run_ids"],
               "extractor_version": result["extractor_version"],
               "keys": len(result["scores"]), "by_type": histogram(result)}
    payload.update(extra or {})
    d = _run_dir(root, result["run_ids"][-1])
    d.mkdir(parents=True, exist_ok=True)
    path = d / REPORT_FILE
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=1, sort_keys=True, default=str) + "\n",
                   encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return path


def discover(root) -> list:
    """Every persisted run id under `root`, oldest first by directory name (a UTC stamp)."""
    base = pathlib.Path(root)
    if not base.exists():
        return []
    return sorted(p.name for p in base.iterdir() if (p / RECORDS_FILE).exists())


def score_silently(ctx, *, root=DEFAULT_ROOT) -> dict:
    """Daily-chain entry point. A no-op unless enough compatible runs are persisted.

    ⛔ `N` comes from the number of runs actually reconciled, never from a literal — so a
    reconciliation over four passes stores 4, and Q17 reads that real denominator.
    """
    from api.services.wisdom.core import store
    from api.services.wisdom.publish import floor

    ids = discover(root)
    if len(ids) < floor.MIN_RUNS:
        return {"skipped": f"only {len(ids)} persisted run(s); need {floor.MIN_RUNS}",
                "runs": len(ids)}
    runs = [load_run(root, rid) for rid in ids[-floor.MIN_RUNS:]]
    try:
        result = reconcile(runs)
    except ReconcileRefused as exc:
        return {"skipped": f"refused: {exc}", "runs": len(runs)}
    with store.write() as conn:
        written = write_scores(conn, result)
    write_report(root, result, extra={"written": written})
    return {"n": result["n"], "run_ids": result["run_ids"], "keys": len(result["scores"]),
            "by_type": histogram(result), **written}
