"""Historical backfills for the D12 archive — everything that still has history to read.

    catalysts_history(db_path, ...)          catalysts.db keeps every day
    vision_history(db_path, ...)             pattern_verdicts, per ET day judged (earlier REPLACEd verdicts are gone)
    detections_retention(db_path, ...)       pattern_detections still inside the 120-day retention, per ET day detected
    x_posts(handles, since, until, ...)      the official accounts' posts via the paid TwitterAPI.io search

Every function DEFAULTS TO A DRY RUN: it reads (read-only), sizes what it would
write and returns the plan with its cost; it writes nothing. Each takes an
EXPLICIT store path, so tools/wisdom/capture_backfill.py never resolves a
data-root default. A real run archives through ``runner.capture_result`` — the
daily layout, a run row per (day, dataset), never a page, never a watermark
move.

Costs: R2 list prices (Cloudflare, 2026) — storage $0.015 per GB-month, Class A
writes $4.50 per million; verify against the account before quoting a bill.
"""
from __future__ import annotations

import datetime as dt
import time
from typing import Iterable, Optional

from api.services.wisdom.capture import runner, x_backfill
from api.services.wisdom.capture.families import catalysts as f_catalysts
from api.services.wisdom.capture.families import detections as f_detections
from api.services.wisdom.capture.families import tweets as f_tweets
from api.services.wisdom.capture.families import vision as f_vision
from api.services.wisdom.capture.families._base import (
    RowStream, et_day_start_epoch, result, ro_connect, table_columns,
)
from api.services.wisdom.core import ids, timeutil

R2_STORAGE_USD_PER_GB_MONTH = 0.015
R2_CLASS_A_USD_PER_MILLION = 4.50
# Measured 2026-09-13 on the STALE local patterns.db mirror (5,000-row sample):
# tools/wisdom/capture_measure_sizes.py. Used only to size a dry-run plan.
DETECTION_GZ_BYTES_PER_ROW_MEASURED = 2169


def _day(epoch: int) -> dt.date:
    return dt.datetime.fromtimestamp(int(epoch), timeutil.ET).date()


def _run_id(kind: str, day: str) -> str:
    return ids.sha24("backfill", kind, day, time.time_ns())


def _cost(total_bytes: int, objects: int) -> dict:
    return {"bytes": int(total_bytes), "objects": int(objects),
            "storage_usd_per_month": round(total_bytes / 1e9 * R2_STORAGE_USD_PER_GB_MONTH, 6),
            "class_a_usd_once": round(objects / 1e6 * R2_CLASS_A_USD_PER_MILLION, 6)}


def _in_range(day: str, start: Optional[str], end: Optional[str]) -> bool:
    return (start is None or day >= start) and (end is None or day <= end)


def _compact(summary: dict) -> dict:
    return {k: summary.get(k) for k in ("session_date", "status", "health", "rows", "bytes", "r2_key", "created",
                                        "shards", "error") if summary.get(k) is not None}


def catalysts_history(db_path: str, *, start: Optional[str] = None, end: Optional[str] = None,
                      dry_run: bool = True) -> dict:
    from api.services.catalyst import store as catalyst_store

    conn = ro_connect(db_path)
    days: list[dict] = []
    total_bytes = objects = 0
    try:
        dates = [r[0] for r in conn.execute("SELECT DISTINCT market_date FROM catalysts ORDER BY market_date")]
        for day in dates:
            if not _in_range(day, start, end):
                continue
            rows = f_catalysts.order([catalyst_store._deserialize_row(dict(r)) for r in conn.execute(
                "SELECT * FROM catalysts WHERE market_date = ?", (day,))])
            out = result("catalysts", as_of=day, source=f"backfill:{f_catalysts.SOURCE}", rows=len(rows),
                         payload=rows, meta={"origin": "backfill",
                                             "ranked": sum(1 for r in rows if r.get("rank") is not None)})
            summary = runner.capture_result("catalysts", out, dry_run=dry_run, run_id=_run_id("catalysts", day))
            total_bytes += int(summary.get("bytes") or 0)
            objects += 1 if summary.get("r2_key") else 0
            days.append(_compact(summary))
    finally:
        conn.close()
    return {"kind": "catalysts", "dry_run": dry_run, "days": days, "cost": _cost(total_bytes, objects)}


def vision_history(db_path: str, *, start: Optional[str] = None, end: Optional[str] = None,
                   dry_run: bool = True) -> dict:
    conn = ro_connect(db_path)
    days: list[dict] = []
    total_bytes = objects = 0
    try:
        if not table_columns(conn, "pattern_verdicts"):
            return {"kind": "vision", "dry_run": dry_run, "days": [], "gap": "no pattern_verdicts table",
                    "cost": _cost(0, 0)}
        lo, hi = conn.execute("SELECT MIN(judged_at), MAX(judged_at) FROM pattern_verdicts").fetchone()
        if lo is None:
            return {"kind": "vision", "dry_run": dry_run, "days": [], "cost": _cost(0, 0)}
        day, last = _day(lo), _day(hi)
        while day <= last:
            iso = day.isoformat()
            if _in_range(iso, start, end):
                s, e = et_day_start_epoch(day), et_day_start_epoch(day + dt.timedelta(days=1))
                rows = [dict(r) for r in conn.execute(
                    "SELECT * FROM pattern_verdicts WHERE judged_at >= ? AND judged_at < ? "
                    "ORDER BY judged_at, ticker, tf, setup, asof_date", (s, e))]
                if rows:
                    out = result("vision", as_of=day, source=f"backfill:{f_vision.SOURCE}", rows=len(rows),
                                 payload=rows, meta={"origin": "backfill", "judged_day": iso},
                                 gaps={"replaced_verdicts": "verdicts REPLACEd before this backfill are not recoverable"})
                    summary = runner.capture_result("vision", out, dry_run=dry_run, run_id=_run_id("vision", iso))
                    total_bytes += int(summary.get("bytes") or 0)
                    objects += 1 if summary.get("r2_key") else 0
                    days.append(_compact(summary))
            day += dt.timedelta(days=1)
    finally:
        conn.close()
    return {"kind": "vision", "dry_run": dry_run, "days": days, "cost": _cost(total_bytes, objects)}


def detections_retention(db_path: str, *, start: Optional[str] = None, end: Optional[str] = None,
                         dry_run: bool = True, max_days: Optional[int] = None) -> dict:
    """Per ET day detected. A dry run COUNTS through the detected_at index and sizes
    from the measured bytes-per-row; it never encodes (a day is ~50k rows)."""
    conn = ro_connect(db_path)
    plan: list[dict] = []
    try:
        if not table_columns(conn, "pattern_detections"):
            return {"kind": "detections", "dry_run": dry_run, "days": [], "gap": "no pattern_detections table",
                    "cost": _cost(0, 0)}
        lo, hi = conn.execute("SELECT MIN(detected_at), MAX(detected_at) FROM pattern_detections").fetchone()
        if lo is None:
            return {"kind": "detections", "dry_run": dry_run, "days": [], "cost": _cost(0, 0)}
        day, last = _day(lo), _day(hi)
        while day <= last:
            iso = day.isoformat()
            if _in_range(iso, start, end):
                s, e = et_day_start_epoch(day), et_day_start_epoch(day + dt.timedelta(days=1))
                n = conn.execute("SELECT COUNT(*) FROM pattern_detections WHERE detected_at >= ? AND detected_at < ?",
                                 (s, e)).fetchone()[0]
                if n:
                    plan.append({"session_date": iso, "rows": n, "start": s, "end": e})
            day += dt.timedelta(days=1)
    finally:
        conn.close()
    if max_days is not None:
        plan = plan[: max(0, int(max_days))]
    shard = next(ds.shard_rows for ds in runner.families.DATASETS if ds.name == "detections")
    if dry_run:
        est_bytes = sum(p["rows"] for p in plan) * DETECTION_GZ_BYTES_PER_ROW_MEASURED
        est_objects = sum(-(-p["rows"] // shard) + 1 for p in plan)
        return {"kind": "detections", "dry_run": True, "days": [{k: p[k] for k in ("session_date", "rows")} for p in plan],
                "cost": {**_cost(est_bytes, est_objects), "basis": "estimated from the measured stale-mirror bytes/row"}}
    days: list[dict] = []
    total_bytes = objects = 0
    for p in plan:
        stream = RowStream(db_path, "SELECT * FROM pattern_detections WHERE detected_at >= ? AND detected_at < ? "
                                    "ORDER BY detected_at, rowid", (p["start"], p["end"]))
        out = result("detections", as_of=p["session_date"], source=f"backfill:{f_detections.SOURCE}", rows=None,
                     payload=stream, meta={"origin": "backfill", "detected_day": p["session_date"]})
        summary = runner.capture_result("detections", out, dry_run=False, run_id=_run_id("detections", p["session_date"]))
        total_bytes += int(summary.get("bytes") or 0)
        objects += (summary.get("shards") or 0) + 1
        days.append(_compact(summary))
    return {"kind": "detections", "dry_run": False, "days": days, "cost": _cost(total_bytes, objects)}


def x_posts(handles: Iterable[str], since_unix: int, until_unix: int, *, max_usd: float, dry_run: bool = True,
            max_pages_per_handle: int = 50, fetch=None) -> dict:
    cap = x_backfill.SpendCap(max_usd=max_usd)
    per_handle: list[dict] = []
    by_day: dict = {}
    kwargs = {"fetch": fetch} if fetch is not None else {}
    for handle in handles:
        walk = x_backfill.backfill_handle(handle, since_unix, until_unix, cap=cap, dry_run=dry_run,
                                          max_pages=max_pages_per_handle, **kwargs)
        per_handle.append({k: v for k, v in walk.items() if k != "posts"} | {"posts": len(walk["posts"])})
        for post in walk["posts"]:
            by_day.setdefault(_day(post["created_at"]).isoformat(), []).append(post)
        if walk.get("stopped") == "spend_cap":
            break
    days: list[dict] = []
    total_bytes = objects = 0
    if not dry_run:
        for iso in sorted(by_day):
            posts = sorted(by_day[iso], key=lambda t: (int(t["created_at"]), str(t["id"])))
            counts: dict = {}
            for post in posts:
                counts[post["author_handle"]] = counts.get(post["author_handle"], 0) + 1
            out = result("tweets", as_of=iso, source="backfill:twitterapi.io advanced_search", rows=len(posts),
                         payload=posts, meta={"origin": "x_backfill", "per_handle": dict(sorted(counts.items()))})
            summary = runner.capture_result("tweets", out, dry_run=False, run_id=_run_id("tweets", iso))
            total_bytes += int(summary.get("bytes") or 0)
            objects += 1 if summary.get("r2_key") else 0
            days.append(_compact(summary))
    return {"kind": "x_posts", "dry_run": dry_run, "handles": per_handle, "spend": cap.summary(), "days": days,
            "cost": _cost(total_bytes, objects), "feed_retention_days": f_tweets.RETENTION_DAYS}
