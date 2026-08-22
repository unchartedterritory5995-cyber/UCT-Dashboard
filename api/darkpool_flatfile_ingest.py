"""
darkpool_flatfile_ingest.py — ALL-SYMBOLS dark-pool ingest from Massive's daily
US-stocks flat file (T+1).

The per-ticker `/v3/trades/{ticker}` ingest (darkpool_massive_ingest) can only
ever cover a ticker *universe*. This module scans the WHOLE day's equity tape
once — `us_stocks_sip/trades_v1/YYYY/MM/YYYY-MM-DD.csv.gz` (~3.5 GB gzipped) — and
keeps EVERY ticker's off-exchange prints (exchange in {4,9}) at/above the $4M
notional floor. No universe. Dark-pool prints matter MOST on off-radar names the
universe can't see, which is the whole point of going all-symbols.

Design:
- STREAMS the gzip straight off S3 (bounded memory — a day yields only a few
  thousand kept prints regardless of the ~50-100M rows scanned).
- REUSES the per-ticker path's row builder (`_print_to_row`) + window/floor
  constants + `darkpool_db.insert_csv_rows` dedup, so filled rows are
  byte-identical to the per-ticker ingest (same UNIQUE(date,timestamp,ticker,
  price,notional,message) key → the two paths never double-insert a print).
- Enrichment (sector / %ADV / security type) is left to display-time (the EOD
  card already FMP-enriches its top-N); enriching thousands of tickers at ingest
  would be prohibitive. v1 captures ticker / notional / price / size / time.

Flat files are T+1 (published ~11 AM ET), so the scheduled job runs mid-morning
and ingests the prior trading day; the per-ticker 19:20 nightly + the intraday
poller stay as the real-time / same-day paths (there is no cheap real-time
all-symbols source).

Gated by DARKPOOL_FLATFILE_ENABLED (default 0 — ships dark). Uses the same
MASSIVE_S3_* creds as the OPRA gap-fill.
"""
import datetime
import gzip
import io
import logging
import os
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Reuse the per-ticker path's constants + primitives so the two ingests stay
# byte-identical (window, floor, off-exchange set, row builder, CSV schema).
from api.darkpool_massive_ingest import (
    ET,
    OFFEXCHANGE,
    MIN_NOTIONAL,
    WINDOW_START,
    WINDOW_END,
    _et_ns,
    _print_to_row,
    _rows_to_csv,
)

ENABLED = os.environ.get("DARKPOOL_FLATFILE_ENABLED", "0") == "1"

# S3 (same creds/bucket as massive_flatfiles_worker — the OPRA gap-fill rail).
S3_ENDPOINT = os.environ.get("MASSIVE_S3_ENDPOINT", "https://files.massive.com").strip()
S3_BUCKET = os.environ.get("MASSIVE_S3_BUCKET", "flatfiles").strip()
S3_ACCESS_KEY = os.environ.get("MASSIVE_S3_ACCESS_KEY", "").strip()
S3_SECRET = os.environ.get("MASSIVE_S3_SECRET", "").strip()
# us_stocks_sip/trades_v1/YYYY/MM/YYYY-MM-DD.csv.gz  (verified 2026-08).
S3_KEY_TEMPLATE = "us_stocks_sip/trades_v1/{yyyy}/{mm}/{yyyy}-{mm}-{dd}.csv.gz"

# Insert kept rows in batches so a big day doesn't hold everything before the
# first write (kept rows are few thousand, but this bounds worst-case memory and
# lets a crash keep partial progress — dedup makes re-runs safe).
INSERT_BATCH = int(os.environ.get("DARKPOOL_FLATFILE_INSERT_BATCH", "5000"))
PROGRESS_EVERY = 10_000_000    # log every N scanned rows


def _s3_key(d: datetime.date) -> str:
    return S3_KEY_TEMPLATE.format(yyyy=f"{d.year:04d}", mm=f"{d.month:02d}", dd=f"{d.day:02d}")


def _parse_mdyyyy(s: str) -> datetime.date:
    m, dd, y = [int(x) for x in s.split("/")]
    return datetime.date(y, m, dd)


def _latest_trading_day(today: Optional[datetime.date] = None) -> datetime.date:
    """Most recent weekday strictly before `today` (holidays not modelled — a
    holiday just 404s the flat file and the run reports no_file, harmlessly)."""
    d = (today or (datetime.datetime.now(ET).date() if ET else datetime.date.today()))
    d -= datetime.timedelta(days=1)
    while d.weekday() >= 5:            # 5=Sat, 6=Sun
        d -= datetime.timedelta(days=1)
    return d


def _last_n_trading_days(n: int, today: Optional[datetime.date] = None) -> list:
    """The last `n` completed trading days, OLDEST first (so a backfill runs
    forward). Weekday-only (holidays 404 harmlessly)."""
    out = []
    d = _latest_trading_day(today)
    for _ in range(max(1, n)):
        out.append(f"{d.month}/{d.day}/{d.year}")
        d -= datetime.timedelta(days=1)
        while d.weekday() >= 5:
            d -= datetime.timedelta(days=1)
    return list(reversed(out))


def _open_stream(d: datetime.date):
    """Return a streaming, decompressed, text file-like over the day's flat file,
    or None if the file isn't published (404/403 — T+1 not ready / weekend)."""
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    if not S3_ACCESS_KEY or not S3_SECRET:
        raise RuntimeError("MASSIVE_S3_ACCESS_KEY / MASSIVE_S3_SECRET not set")
    key = _s3_key(d)
    s3 = boto3.client(
        "s3", endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY, aws_secret_access_key=S3_SECRET,
        config=Config(retries={"max_attempts": 3, "mode": "standard"}),
    )
    logger.info("[darkpool-ff] opening s3://%s/%s", S3_BUCKET, key)
    try:
        resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchKey", "404", "403", "AccessDenied", "Forbidden"):
            logger.info("[darkpool-ff] no flat file at %s yet (%s)", key, code)
            return None, key
        raise
    body = resp["Body"]                       # botocore StreamingBody (.read)
    gz = gzip.GzipFile(fileobj=body)          # incremental decompress
    return io.TextIOWrapper(gz, encoding="utf-8", errors="replace"), key


# ── background run-state (mirrors darkpool_massive_ingest) ────────────────────
_run_lock = threading.Lock()
_run_state: dict = {"running": False, "started_at": None, "finished_at": None,
                    "phase": None, "last_result": None, "last_error": None}


def get_run_state() -> dict:
    with _run_lock:
        return dict(_run_state)


def run_flatfile_ingest(date_mdyyyy: Optional[str] = None,
                        dry_run: bool = False) -> dict:
    """Scan the whole day's stocks flat file, keep every ticker's off-exchange
    prints >= $4M in the 07:00-19:00 ET window, and merge them into darkpool.db.

    ALL SYMBOLS — no universe. Safe to re-run (darkpool_db dedups). Returns a
    summary dict; never raises out (errors captured in the return)."""
    import csv as _csv
    started = time.time()
    try:
        d = _parse_mdyyyy(date_mdyyyy) if date_mdyyyy else _latest_trading_day()
    except (ValueError, TypeError):
        return {"ok": False, "error": "date must be M/D/YYYY"}
    dstr = f"{d.month}/{d.day}/{d.year}"
    lo_ns, hi_ns = _et_ns(dstr, WINDOW_START), _et_ns(dstr, WINDOW_END)

    try:
        stream, key = _open_stream(d)
    except Exception as e:  # noqa: BLE001
        logger.exception("[darkpool-ff] open failed")
        return {"ok": False, "date": dstr, "error": f"open failed: {e}"}
    if stream is None:
        return {"ok": True, "date": dstr, "status": "no_file",
                "detail": "flat file not published yet (T+1)"}

    rows: list = []
    scanned = kept = inserted = duplicates = 0
    tickers: set = set()
    off = OFFEXCHANGE

    def _flush():
        nonlocal inserted, duplicates, rows
        if not rows or dry_run:
            rows = []
            return
        try:
            from api.darkpool_db import insert_csv_rows
        except Exception:
            from darkpool_db import insert_csv_rows  # type: ignore
        res = insert_csv_rows(_rows_to_csv(rows))
        inserted += res.get("inserted", 0)
        duplicates += res.get("duplicates", 0) + res.get("skipped", 0)
        rows = []

    try:
        reader = _csv.DictReader(stream)
        for r in reader:
            scanned += 1
            if scanned % PROGRESS_EVERY == 0:
                with _run_lock:
                    _run_state["phase"] = f"{scanned//1_000_000}M scanned, {kept} kept"
            # off-exchange (dark) only
            ex = r.get("exchange")
            try:
                if int(ex) not in off:
                    continue
            except (TypeError, ValueError):
                continue
            if (r.get("correction") or "0") != "0":     # skip corrected/cancelled
                continue
            # session window
            try:
                ts = int(r.get("sip_timestamp") or r.get("participant_timestamp") or 0)
            except (TypeError, ValueError):
                continue
            if ts < lo_ns or ts > hi_ns:
                continue
            # notional floor
            try:
                px = float(r["price"]); sz = float(r["size"])
            except (TypeError, ValueError, KeyError):
                continue
            if px <= 0 or sz <= 0 or px * sz < MIN_NOTIONAL:
                continue
            tk = (r.get("ticker") or "").strip().upper()
            if not tk:
                continue
            kept += 1
            tickers.add(tk)
            rows.append(_print_to_row(tk, dstr,
                        {"sip_timestamp": ts, "price": px, "size": int(sz)}))
            if len(rows) >= INSERT_BATCH:
                _flush()
        _flush()
    except Exception as e:  # noqa: BLE001
        logger.exception("[darkpool-ff] stream failed after %d scanned", scanned)
        return {"ok": False, "date": dstr, "error": f"stream failed: {e}",
                "scanned": scanned, "kept": kept, "inserted": inserted}
    finally:
        try:
            stream.close()
        except Exception:
            pass

    out = {"ok": True, "date": dstr, "key": key, "all_symbols": True,
           "scanned": scanned, "kept": kept, "unique_tickers": len(tickers),
           "inserted": inserted, "duplicates": duplicates, "dry_run": dry_run,
           "elapsed_sec": round(time.time() - started, 1)}
    logger.info("[darkpool-ff] done: %s", out)
    return out


def run_flatfile_ingest_background(date_mdyyyy: Optional[str] = None,
                                   dry_run: bool = False,
                                   dates: Optional[list] = None) -> dict:
    """Fire-and-forget (a full scan takes minutes; Cloudflare kills the origin at
    ~100s, and a client `!` shell caps at ~2 min — far short of a multi-day
    backfill). Start a daemon thread and poll get_run_state().

    `dates` (a list of M/D/YYYY) runs a MULTI-DAY backfill sequentially inside the
    ONE background job (the single run-lock forces sequential anyway); last_result
    becomes the list of per-day summaries. Otherwise a single `date_mdyyyy` runs."""
    plan = list(dates) if dates else [date_mdyyyy]
    with _run_lock:
        if _run_state["running"]:
            return {"started": False, "reason": "already running", "state": dict(_run_state)}
        _run_state.update({"running": True, "phase": "starting", "last_result": None,
                           "last_error": None, "finished_at": None,
                           "started_at": (datetime.datetime.now(ET).isoformat()
                                          if ET else datetime.datetime.now().isoformat())})

    def _worker():
        try:
            results = []
            multi = len(plan) > 1
            for i, dstr in enumerate(plan, 1):
                if multi:
                    with _run_lock:
                        _run_state["phase"] = f"day {i}/{len(plan)} ({dstr}) starting"
                res = run_flatfile_ingest(date_mdyyyy=dstr, dry_run=dry_run)
                results.append(res)
                with _run_lock:
                    _run_state["last_result"] = results if multi else res
        except Exception as e:  # noqa: BLE001
            logger.exception("[darkpool-ff] background run failed")
            with _run_lock:
                _run_state["last_error"] = str(e)
        finally:
            with _run_lock:
                _run_state["running"] = False
                _run_state["phase"] = None
                _run_state["finished_at"] = (datetime.datetime.now(ET).isoformat()
                                             if ET else datetime.datetime.now().isoformat())

    threading.Thread(target=_worker, daemon=True, name="darkpool-flatfile-ingest").start()
    return {"started": True, "days": len(plan),
            "poll": "GET /api/darkpool/flatfile-ingest/status"}


def scheduled_run() -> None:
    """Scheduler entry — ingest the prior trading day's flat file. No-op unless
    DARKPOOL_FLATFILE_ENABLED=1. Runs on the scheduler thread (no HTTP timeout)."""
    if not ENABLED:
        return
    try:
        run_flatfile_ingest()          # defaults to latest completed trading day
    except Exception:
        logger.exception("[darkpool-ff] scheduled run failed")
