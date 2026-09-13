"""Run D12 capture datasets: read → archive to R2 → one run row → health → page.

    run_family(name, *, as_of=None, dry_run=False) -> dict     one dataset, now
    run_job(job_id, ctx) -> dict                                every dataset in a §5 slot
    run_all(ctx) -> dict                                        the daily chain's capture step

One ``wisdom_capture_runs`` row per (run, dataset), always — a skipped holiday,
an unreachable source and a failed R2 write each leave a row, because a capture
that leaves no trace cannot be told apart from one that never ran.

DRY RUN writes nothing anywhere: no R2 object, no run row, no registry state, no
page. It still reads, encodes and sizes everything, and returns what it would
have written.

Nothing here raises into a scheduler thread; a dataset's failure is recorded on
its row and the job moves to the next dataset.
"""
from __future__ import annotations

import datetime as dt
import logging
import sqlite3
import threading
import time
from typing import Optional

from api.services.wisdom.capture import archive, families, health
from api.services.wisdom.capture.families._base import RowStream, to_date
from api.services.wisdom.core import ids, store, timeutil

log = logging.getLogger(__name__)

# Gaps that describe the RUN (when and how it was asked), not the data. They go
# in the run summary but never inside the archived object, or a re-run on a
# different day would produce different bytes for identical data.
RUN_CONTEXT_GAPS = frozenset({"stale", "as_of_requested", "retention", "registry_state", "trailing_median"})
RUN_CONTEXT_META = frozenset({"stale_session"})
_ERROR_MAX = 2000


def _new_run_id(tag: str) -> str:
    return ids.sha24("capture", tag, timeutil.now_et().isoformat(), time.time_ns(), threading.get_ident())


def _gap_text(gaps: dict) -> str:
    return "; ".join(f"{k}: {v}" for k, v in sorted(gaps.items()))[:_ERROR_MAX]


def _load_state(dataset: str) -> tuple[dict, Optional[str]]:
    try:
        with store.read() as conn:
            row = conn.execute("SELECT * FROM wisdom_capture_datasets WHERE dataset = ?", (dataset,)).fetchone()
        return (dict(row) if row else {}), None
    except sqlite3.Error as exc:
        return {}, f"{type(exc).__name__}: {exc}"


# ── archiving ───────────────────────────────────────────────────────────────

def _header(ds: families.Dataset, out: dict) -> dict:
    return {
        "schema": archive.SCHEMA,
        "dataset": ds.name,
        "family": ds.family,
        "as_of": out["as_of"],
        "source": out.get("source"),
        "gaps": {k: v for k, v in (out.get("gaps") or {}).items() if k not in RUN_CONTEXT_GAPS},
        "meta": {k: v for k, v in (out.get("meta") or {}).items() if k not in RUN_CONTEXT_META},
    }


def _archive_stream_shards(ds: families.Dataset, header: dict, stream: RowStream, *, dry_run: bool) -> dict:
    as_of = header["as_of"]
    shards: list[dict] = []
    total = 0
    shard_bytes = 0
    current: Optional[archive.StreamedObject] = None
    number = 0

    def flush() -> None:
        nonlocal current, shard_bytes
        data = current.finish({"rows": current.rows})
        n = number
        res = archive.put_versioned(lambda sha: archive.object_key(as_of, ds.name, shard=n, sha=sha), data,
                                    dry_run=dry_run)
        shards.append({"shard": n, "key": res["key"], "sha256": res["sha256"], "bytes": res["bytes"],
                       "rows": current.rows})
        shard_bytes += res["bytes"]
        current = None

    for row in stream:
        if current is None:
            number += 1
            current = archive.StreamedObject({**header, "shard": number})
        current.add(row)
        total += 1
        if current.rows >= ds.shard_rows:
            flush()
    if current is not None:
        flush()
    manifest = {**header, "rows": total, "shards": shards}
    res = archive.put_versioned(lambda sha: archive.object_key(as_of, ds.name, sha=sha),
                                archive.encode(manifest), dry_run=dry_run)
    return {"key": res["key"], "sha256": res["sha256"], "bytes": shard_bytes + res["bytes"],
            "created": res.get("created"), "versioned": res.get("versioned"), "rows": total,
            "shards": len(shards)}


def _archive(ds: families.Dataset, out: dict, *, state: dict, dry_run: bool) -> dict:
    header = _header(ds, out)
    as_of = out["as_of"]
    payload = out["payload"]
    if isinstance(payload, RowStream):
        if ds.shard_rows > 0:
            return _archive_stream_shards(ds, header, payload, dry_run=dry_run)
        obj = archive.StreamedObject(header)
        for row in payload:
            obj.add(row)
        data = obj.finish({"rows": obj.rows})
        res = archive.put_versioned(lambda sha: archive.object_key(as_of, ds.name, sha=sha), data, dry_run=dry_run)
        res["rows"] = obj.rows
        return res

    content_sha = archive.content_sha256(payload) if ds.hash_on_change else None
    if content_sha and content_sha == state.get("last_sha256") and state.get("last_r2_key"):
        return {"key": state["last_r2_key"], "sha256": None, "content_sha256": content_sha, "bytes": 0,
                "created": False, "unchanged": True, "rows": out.get("rows")}
    body = {**header, "rows": out.get("rows"), "payload": payload}
    res = archive.put_versioned(lambda sha: archive.object_key(as_of, ds.name, sha=sha),
                                archive.encode(body), dry_run=dry_run)
    res["rows"] = out.get("rows")
    if content_sha:
        res["content_sha256"] = content_sha
    return res


# ── recording ───────────────────────────────────────────────────────────────

def _record(ds: families.Dataset, summary: dict, meta: dict, arch: Optional[dict]) -> None:
    finished = timeutil.iso_et(timeutil.now_et())
    with store.write() as conn:
        conn.execute(
            "INSERT INTO wisdom_capture_runs (run_id, dataset, session_date, started_at, finished_at, status, "
            "row_count, bytes, r2_key, trailing_median, health, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (summary["run_id"], ds.name, summary["session_date"], summary["started_at"], finished,
             summary["status"], summary["rows"], summary["bytes"], summary["r2_key"],
             summary["trailing_median"], summary["health"], summary["error"]),
        )
        conn.execute(
            "INSERT INTO wisdom_capture_datasets (dataset, family, job_id, cadence, as_of_rule, r2_prefix, "
            "session_shaped, pages_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(dataset) DO UPDATE SET family = excluded.family, job_id = excluded.job_id, "
            "cadence = excluded.cadence, as_of_rule = excluded.as_of_rule, r2_prefix = excluded.r2_prefix, "
            "session_shaped = excluded.session_shaped, pages_on = excluded.pages_on, "
            "updated_at = excluded.updated_at",
            (ds.name, ds.family, ds.job_id, ds.cadence, ds.as_of_rule, ds.r2_prefix, int(ds.session_shaped),
             ",".join(sorted(ds.pages)), finished),
        )
        if summary["status"] != "ok" or arch is None:
            return
        last_sha = arch.get("content_sha256") if ds.hash_on_change else arch.get("sha256")
        conn.execute(
            "UPDATE wisdom_capture_datasets SET last_as_of = ?, last_r2_key = ?, "
            "last_sha256 = COALESCE(?, last_sha256) WHERE dataset = ?",
            (summary["as_of"], arch.get("key"), last_sha, ds.name),
        )
        nxt = meta.get("watermark_next")
        if nxt is not None:
            row = conn.execute("SELECT watermark FROM wisdom_capture_datasets WHERE dataset = ?", (ds.name,)).fetchone()
            current = row["watermark"] if row else None
            if current is None or int(nxt) >= int(current):
                conn.execute(
                    "UPDATE wisdom_capture_datasets SET watermark = ?, window_lo = ?, window_as_of = ? "
                    "WHERE dataset = ?",
                    (int(nxt), meta.get("window_lo"), meta.get("window_as_of"), ds.name),
                )


# ── running ─────────────────────────────────────────────────────────────────

def _run_one(ds: families.Dataset, *, as_of, dry_run: bool, now_et: dt.datetime, run_id: str,
             page: bool = True, out: Optional[dict] = None) -> dict:
    started = timeutil.iso_et(timeutil.now_et())
    state, state_err = _load_state(ds.name)
    requested = to_date(as_of)
    if out is None:
        try:
            out = ds.read(as_of=requested, now_et=now_et, state=state)
        except Exception as exc:  # noqa: BLE001 — readers are wrapped, but a row is owed even if one is not
            log.exception("[wisdom capture] reader %s raised past its wrapper", ds.name)
            out = {"family": ds.name, "as_of": None, "source": None, "rows": None, "payload": None,
                   "gaps": {"reader_exception": f"{type(exc).__name__}: {exc}"[:500]}, "meta": {}}
    gaps = dict(out.get("gaps") or {})
    meta = dict(out.get("meta") or {})
    if state_err:
        gaps["registry_state"] = state_err
    out["as_of"] = out.get("as_of") or (requested or now_et.date()).isoformat()
    stale = meta.get("stale_session") if requested is None else None
    session_date = stale or out["as_of"]
    holiday = ds.session_shaped and not health.is_trading_session(session_date)

    status, error, arch = "ok", None, None
    rows = out.get("rows")
    if out.get("payload") is None:
        if holiday:
            status = "skipped_holiday"
        else:
            status, error = "unreachable", _gap_text(gaps) or "source unreadable"
    elif holiday and rows == 0:
        # an expected absence: nothing to keep. Rows that DO exist on a holiday
        # (catalysts can) are archived below and still read "holiday".
        status = "skipped_holiday"
    else:
        try:
            arch = _archive(ds, out, state=state, dry_run=dry_run)
            rows = arch.get("rows", rows)
        except Exception as exc:  # noqa: BLE001 — recorded on the row, never raised
            log.exception("[wisdom capture] archive failed for %s", ds.name)
            status, error = "failed", f"{type(exc).__name__}: {exc}"[:_ERROR_MAX]
        if status == "ok" and stale:
            status, error = "unreachable", _gap_text({"stale": gaps.get("stale", "stale source")})

    median, samples = None, 0
    try:
        with store.read() as conn:
            median, samples = health.trailing_median(conn, ds.name, session_date)
    except sqlite3.Error as exc:
        gaps["trailing_median"] = f"{type(exc).__name__}: {exc}"
    verdict = health.classify(status=status, row_count=rows, median=median, samples=samples, holiday=holiday)

    summary = {
        "dataset": ds.name, "run_id": run_id, "session_date": session_date, "as_of": out["as_of"],
        "status": status, "health": verdict, "rows": rows,
        "bytes": (arch or {}).get("bytes"), "r2_key": (arch or {}).get("key"),
        "created": (arch or {}).get("created"), "versioned": (arch or {}).get("versioned"),
        "unchanged": bool((arch or {}).get("unchanged")), "shards": (arch or {}).get("shards"),
        "trailing_median": median, "median_samples": samples, "gaps": gaps, "error": error,
        "dry_run": dry_run, "started_at": started, "source": out.get("source"), "paged": False,
    }
    if dry_run:
        return summary
    try:
        _record(ds, summary, meta, arch)
    except sqlite3.Error as exc:
        log.exception("[wisdom capture] could not record %s", ds.name)
        summary["record_error"] = f"{type(exc).__name__}: {exc}"
    if page and health.should_page(ds.pages, verdict, session_date):
        summary["paged"] = health.page(ds.name, verdict, summary)
    return summary


def run_family(name: str, *, as_of=None, dry_run: bool = False, now: Optional[dt.datetime] = None,
               run_id: Optional[str] = None, page: bool = True) -> dict:
    """Capture one dataset now. Never raises."""
    ds = families.by_name(name)
    if ds is None:
        return {"dataset": name, "status": "unknown_dataset"}
    now_et = timeutil.to_et(now) if now is not None else timeutil.now_et()
    rid = run_id or _new_run_id(name)
    try:
        return _run_one(ds, as_of=as_of, dry_run=dry_run, now_et=now_et, run_id=rid, page=page)
    except Exception as exc:  # noqa: BLE001
        log.exception("[wisdom capture] run_family(%s) failed", name)
        return {"dataset": name, "run_id": rid, "status": "failed", "error": f"{type(exc).__name__}: {exc}",
                "dry_run": dry_run}


def capture_result(name: str, out: dict, *, dry_run: bool = False, run_id: Optional[str] = None,
                   now: Optional[dt.datetime] = None) -> dict:
    """Archive and record a result built outside the scheduled readers — a backfill.

    Same layout, same run row, same health verdict; it NEVER pages (a backfill
    describes the past, and a quiet past day is not today's outage) and it never
    moves a watermark (the backfill result carries no ``watermark_next``)."""
    ds = families.by_name(name)
    if ds is None:
        return {"dataset": name, "status": "unknown_dataset"}
    now_et = timeutil.to_et(now) if now is not None else timeutil.now_et()
    rid = run_id or _new_run_id(f"backfill-{name}-{out.get('as_of')}")
    payload = dict(out)
    payload["meta"] = {k: v for k, v in (out.get("meta") or {}).items()
                       if k not in ("watermark_next", "window_lo", "window_as_of")}
    try:
        return _run_one(ds, as_of=out.get("as_of"), dry_run=dry_run, now_et=now_et, run_id=rid, page=False,
                        out=payload)
    except Exception as exc:  # noqa: BLE001
        log.exception("[wisdom capture] capture_result(%s) failed", name)
        return {"dataset": name, "run_id": rid, "status": "failed", "error": f"{type(exc).__name__}: {exc}",
                "dry_run": dry_run}


def _compact(summary: dict) -> dict:
    keep = ("dataset", "session_date", "status", "health", "rows", "bytes", "r2_key", "created", "unchanged",
            "shards", "trailing_median", "paged", "error", "record_error")
    out = {k: summary.get(k) for k in keep if summary.get(k) is not None}
    if summary.get("gaps"):
        out["gaps"] = sorted(summary["gaps"].keys())
    return out


def _finish(label: str, results: list[dict], ctx) -> dict:
    for r in results:
        ctx.log(f"{r.get('dataset')}: {r.get('status')} {r.get('health')} rows={r.get('rows')}")
    unrecorded = [r["dataset"] for r in results if r.get("record_error") or r.get("status") == "unknown_dataset"]
    summary = {"step": label, "dry_run": bool(ctx.dry_run), "datasets": [_compact(r) for r in results]}
    if results and len(unrecorded) == len(results) and not ctx.dry_run:
        raise RuntimeError(f"capture could not record any dataset for {label}: {unrecorded}")
    return summary


def run_job(job_id: str, ctx) -> dict:
    """Every dataset in one §5 slot, in registry order, each isolated from the others."""
    results = [run_family(ds.name, dry_run=ctx.dry_run, now=ctx.now_et, run_id=ctx.run_id)
               for ds in families.for_job(job_id)]
    return _finish(job_id, results, ctx)


def run_all(ctx) -> dict:
    """The daily chain's D12 step: every dataset not already captured OK (or
    skipped as a holiday) today, ET. ``ctx.force`` re-captures everything; the
    archive's immutability makes that a no-op for unchanged data."""
    today = timeutil.to_et(ctx.now_et).date().isoformat()
    done: set = set()
    if not ctx.force:
        try:
            with store.read() as conn:
                done = {r[0] for r in conn.execute(
                    "SELECT DISTINCT dataset FROM wisdom_capture_runs "
                    "WHERE status IN ('ok', 'skipped_holiday') AND substr(started_at, 1, 10) = ?", (today,))}
        except sqlite3.Error as exc:
            ctx.log(f"could not read today's runs, capturing everything: {exc}")
    results, skipped = [], []
    for ds in families.DATASETS:
        if ds.name in done:
            skipped.append(ds.name)
            continue
        results.append(run_family(ds.name, dry_run=ctx.dry_run, now=ctx.now_et, run_id=ctx.run_id))
    summary = _finish("capture.run_all", results, ctx)
    summary["already_captured_today"] = skipped
    return summary
