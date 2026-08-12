"""
darkpool_massive_ingest.py — nightly dark-pool ingest from Massive.

Replaces the manual loop (download BBS CSV -> drop in app/public -> redeploy)
with a scheduled job that writes straight into darkpool.db.

VALIDATED 7/23/2026 against a BBS reference export (12 tickers, 7/23):
  * Off-exchange venues are exchange 4 (TRF, trf_id 201/202/203) AND
    exchange 9 (trf_id None). Filtering on 4 alone reproduced only 88.3% of
    BBS rows — five of six misses, including a 1,000,000-sh SPY block worth
    $736.5M, were sitting on exchange 9. With both: 97.8%.
  * Notional floor $4.0M — exactly BBS's observed minimum. This does ~99.99%
    of the volume reduction and is what makes the job tractable at all.
  * Window 07:00-19:00 ET, NOT regular hours. 42.3% of BBS rows and 50.9% of
    its notional print at/after 16:00 (the closing cross). An RTH-only window
    silently drops half the data.
  * Massive returns ~2.8x more qualifying prints than BBS at the same floor,
    concentrated at the close — a genuine coverage gain, not noise.

RUNS ON: the **web** service only. It owns /data/darkpool.db and is the only
service that serves /api/darkpool/*. Running it on flow-worker would write to
that pod's separate volume and recreate the two-per-pod divergence that caused
the long-running "works in my shell, not on the site" bug.

COST: this is the whole tape, filtered client-side — Massive has no
server-side notional filter. NVDA alone is ~43 pages / 2.1M prints per
session. So the job is bounded three ways: a ticker cap, a per-ticker page
cap, and a wall-clock budget. Tickers are processed in descending recent
dark-pool notional, so if the budget runs out the *least* important names are
the ones dropped.

GATED OFF BY DEFAULT: set DARKPOOL_MASSIVE_INGEST_ENABLED=1 to arm it. A
deploy alone will not start pulling.
"""

import os
import csv
import io
import json
import time
import logging
import datetime
import urllib.request
import urllib.parse
from typing import Optional, List

logger = logging.getLogger("darkpool_ingest")

BASE = os.environ.get("MASSIVE_REST_BASE", "https://api.massive.com")
API_KEY = os.environ.get("MASSIVE_API_KEY", "")
# Cloudflare 1010s a plain urllib UA — must match the rest of the codebase.
UA = {"User-Agent": "UCT-Massive/1.0 (+https://uctintelligence.com)"}

ET = None
try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    pass

ENABLED = os.environ.get("DARKPOOL_MASSIVE_INGEST_ENABLED", "0") == "1"

# Off-exchange venues — see the module docstring. Overridable for testing.
OFFEXCHANGE = {
    int(x) for x in os.environ.get("DARKPOOL_OFFEXCHANGE_IDS", "4,9").split(",") if x.strip()
}
MIN_NOTIONAL = float(os.environ.get("DARKPOOL_MIN_NOTIONAL", "4000000"))
WINDOW_START = os.environ.get("DARKPOOL_WINDOW_START", "07:00:00")
WINDOW_END = os.environ.get("DARKPOOL_WINDOW_END", "19:00:00")

TOP_N_TICKERS = int(os.environ.get("DARKPOOL_TOP_N_TICKERS", "150"))
UNIVERSE_LOOKBACK_DAYS = int(os.environ.get("DARKPOOL_UNIVERSE_DAYS", "10"))
PAGE_CAP = int(os.environ.get("DARKPOOL_PAGE_CAP", "60"))
TIME_BUDGET_SEC = float(os.environ.get("DARKPOOL_TIME_BUDGET_SEC", "3600"))

# ── Base universe — ALWAYS pulled, regardless of recent darkpool.db activity ──
# resolve_universe() ranks tickers by recent notional in our OWN db, a
# self-referential trap: a liquid name that goes quiet for UNIVERSE_LOOKBACK_DAYS
# drops out of the ranking and is then NEVER pulled again, so a later big block on
# it is invisible. (Exactly how USO went dark: last data BBS-era 7/22 -> aged out
# of the 10-day window -> the Massive ingest stopped asking Massive about it -> a
# $446M 8/11 block never landed.) The base list breaks the loop: these names are
# unioned in and placed FIRST, so the time budget can never truncate them — a
# major ETF / megacap is always monitored even after a quiet stretch. Extend at
# runtime via DARKPOOL_BASE_UNIVERSE_EXTRA (comma-separated).
def _dedup_upper(seq) -> List[str]:
    seen: set = set()
    out: List[str] = []
    for x in seq:
        u = (x or "").strip().upper()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out

_BASE_EXTRA = _dedup_upper(os.environ.get("DARKPOOL_BASE_UNIVERSE_EXTRA", "").split(","))
# Full base for the NIGHTLY run (~110 names). Core subset for the intraday poller
# (kept small so the every-few-minutes REST load stays light).
BASE_UNIVERSE = _dedup_upper([
    # broad index
    "SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "RSP", "MDY",
    # sector SPDRs
    "XLE", "XLF", "XLK", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
    # commodity / energy / metals
    "USO", "UNG", "GLD", "SLV", "GDX", "GDXJ", "XOP", "OIH",
    # rates / credit / vol
    "TLT", "IEF", "SHY", "AGG", "BND", "HYG", "LQD", "TIP", "VXX", "UVXY",
    # thematic / intl / leveraged / crypto-proxy
    "SMH", "SOXX", "SOXL", "TQQQ", "SQQQ", "ARKK", "KWEB", "FXI", "EEM", "EFA",
    "IBIT", "GBTC",
    # megacaps
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO",
    "JPM", "LLY", "V", "MA", "UNH", "XOM", "JNJ", "WMT", "PG", "HD", "COST",
    "ORCL", "NFLX", "AMD", "CRM", "BAC", "KO", "PEP", "ADBE", "CVX", "MRK",
    "TMO", "ABBV", "CSCO", "MCD", "WFC", "DIS", "INTC", "QCOM", "TXN", "IBM",
    "GE", "CAT", "BA", "PLTR", "SMCI", "MU", "MRVL", "CRWD", "COIN", "MSTR",
] + _BASE_EXTRA)
BASE_UNIVERSE_CORE = _dedup_upper([
    "SPY", "QQQ", "IWM", "DIA", "USO", "UNG", "GLD", "SLV", "GDX", "XOP",
    "XLE", "XLF", "SMH", "TLT", "HYG", "TQQQ", "SQQQ", "VXX", "ARKK", "FXI",
] + _BASE_EXTRA)

CSV_COLUMNS = [
    "Date", "Timestamp", "Ticker", "Volume", "Price", "Pct_of_Avg30Day",
    "Notional", "Message", "Type", "SecurityType", "Industry", "Sector",
    "Avg30Day", "Float", "EarningsDate",
]


# ── helpers ──────────────────────────────────────────────────────────────────

def _today_mdyyyy() -> str:
    now = datetime.datetime.now(ET) if ET else datetime.datetime.now()
    return f"{now.month}/{now.day}/{now.year}"


def _et_ns(mdyyyy: str, hms: str) -> int:
    m, d, y = [int(x) for x in mdyyyy.split("/")]
    t = datetime.datetime.strptime(hms, "%H:%M:%S").time()
    dt = datetime.datetime(y, m, d, t.hour, t.minute, t.second, tzinfo=ET)
    return int(dt.timestamp() * 1e9)


def _get(url: str, timeout: int = 60) -> dict:
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    return {}


def resolve_universe(top_n: int = TOP_N_TICKERS,
                     lookback_days: int = UNIVERSE_LOOKBACK_DAYS,
                     base: Optional[List[str]] = None) -> List[str]:
    """Tickers to pull: `base` (always-covered majors) FIRST, then the tickers
    ranked by recent dark-pool notional in our own DB.

    The self-ranked list keeps continuity with what the page shows and drifts
    with the market, but on its own it is a self-referential trap — a name that
    goes quiet for `lookback_days` drops out and is never pulled again (see
    BASE_UNIVERSE for the USO incident). `base` is unioned in FIRST (dedup,
    order-preserving) so a major ETF/megacap is always monitored and can never be
    starved by the time budget; pass None to recover the pure self-ranked list.
    """
    try:
        from api import darkpool_db
    except Exception:
        import darkpool_db  # type: ignore

    conn = darkpool_db.get_conn()
    try:
        dates = [r["date"] for r in conn.execute(
            "SELECT DISTINCT date FROM darkpool_trades").fetchall()]
        dates.sort(key=darkpool_db.parse_date_to_sortable, reverse=True)
        recent = dates[:lookback_days]
        if not recent:
            return _dedup_upper(list(base)) if base else []
        ph = ",".join("?" * len(recent))
        rows = conn.execute(
            f"""SELECT ticker, SUM(COALESCE(notional,0)) AS n
                  FROM darkpool_trades
                 WHERE date IN ({ph}) AND notional IS NOT NULL
                 GROUP BY ticker ORDER BY n DESC LIMIT ?""",
            (*recent, top_n)).fetchall()
        ranked = [r["ticker"] for r in rows]
        # base FIRST so the time budget can never truncate the must-cover names;
        # the self-ranked recent-activity names fill the remainder.
        return _dedup_upper(list(base) + ranked) if base else ranked
    finally:
        conn.close()


def fetch_offexchange(ticker: str, date_mdyyyy: str,
                      page_cap: int = PAGE_CAP) -> dict:
    """Off-exchange prints above the floor for one ticker on one date."""
    lo = _et_ns(date_mdyyyy, WINDOW_START)
    hi = _et_ns(date_mdyyyy, WINDOW_END)
    params = {
        "timestamp.gte": lo, "timestamp.lte": hi, "order": "asc",
        "sort": "timestamp", "limit": 50000, "apiKey": API_KEY,
    }
    url = f"{BASE}/v3/trades/{urllib.parse.quote(ticker)}?" + urllib.parse.urlencode(params)
    kept, scanned, pages = [], 0, 0
    truncated = False
    for _ in range(page_cap):
        data = _get(url)
        for t in (data.get("results") or []):
            scanned += 1
            if t.get("exchange") not in OFFEXCHANGE:
                continue
            px, sz = t.get("price"), t.get("size")
            if not px or not sz:
                continue
            if px * sz >= MIN_NOTIONAL:
                kept.append(t)
        pages += 1
        nxt = data.get("next_url")
        if not nxt:
            break
        url = nxt + (("&" if "?" in nxt else "?") + "apiKey=" + urllib.parse.quote(API_KEY))
    else:
        truncated = True
    return {"prints": kept, "scanned": scanned, "pages": pages, "truncated": truncated}


def _rows_to_csv(rows: List[dict]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_COLUMNS)
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def _print_to_row(ticker: str, date_mdyyyy: str, t: dict) -> dict:
    """One Massive trade -> one BBS-schema CSV row.

    Timestamp format must match BBS ('H:MM:SS AM') because darkpool_db dedups
    on UNIQUE(date, timestamp, ticker, price, notional, message) — a different
    format would let the same print insert twice across sources.
    """
    ts = datetime.datetime.fromtimestamp(
        (t.get("sip_timestamp") or t.get("participant_timestamp") or 0) / 1e9, ET)
    notional = float(t["price"]) * float(t["size"])
    return {
        "Date": date_mdyyyy,
        "Timestamp": ts.strftime("%-I:%M:%S %p"),
        "Ticker": ticker,
        "Volume": int(t["size"]),
        "Price": t["price"],
        "Pct_of_Avg30Day": "",
        "Notional": round(notional, 2),
        "Message": "DARK BLOCK  $%.1fM" % (notional / 1e6),
        "Type": "Block",
        "SecurityType": "",
        "Industry": "",
        "Sector": "",
        "Avg30Day": "",
        "Float": "",
        "EarningsDate": "",
    }


# ── background run-state (Cloudflare 524 workaround) ─────────────────────────
# A full ingest takes minutes; Cloudflare cuts the origin off at ~100s and
# returns its own HTML error page (observed 7/24: POST -> 524 + "<!DOCTYPE"
# JSON parse error). So the HTTP path can't be synchronous. The router starts
# `run_ingest_background` and polls `get_run_state`, mirroring the
# dealer_positioning backfill pattern. The SCHEDULED job is unaffected — it
# runs on the scheduler thread with no HTTP in the way.
import threading

_run_lock = threading.Lock()
_run_state: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "phase": None,          # e.g. "SPY (3/150)"
    "last_result": None,
    "last_error": None,
}


def get_run_state() -> dict:
    with _run_lock:
        return dict(_run_state)


def _set_phase(phase: str) -> None:
    with _run_lock:
        _run_state["phase"] = phase


def run_ingest_background(**kwargs) -> dict:
    """Start an ingest in a daemon thread. Returns immediately.

    Refuses to start a second concurrent run — the job is REST-heavy and two
    overlapping passes would double the request load for no benefit.
    """
    with _run_lock:
        if _run_state["running"]:
            return {"started": False, "reason": "already running",
                    "state": dict(_run_state)}
        _run_state.update({
            "running": True,
            "started_at": datetime.datetime.now(ET).isoformat() if ET
                          else datetime.datetime.now().isoformat(),
            "finished_at": None, "phase": "starting",
            "last_result": None, "last_error": None,
        })

    def _worker():
        try:
            result = run_ingest(**kwargs)
            with _run_lock:
                _run_state["last_result"] = result
        except Exception as e:
            logger.exception("[darkpool_ingest] background run failed")
            with _run_lock:
                _run_state["last_error"] = str(e)
        finally:
            with _run_lock:
                _run_state["running"] = False
                _run_state["phase"] = None
                _run_state["finished_at"] = (
                    datetime.datetime.now(ET).isoformat() if ET
                    else datetime.datetime.now().isoformat())

    threading.Thread(target=_worker, daemon=True,
                     name="darkpool-massive-ingest").start()
    return {"started": True, "poll": "GET /api/darkpool/massive-ingest/status"}


# ── main entry ───────────────────────────────────────────────────────────────

def run_ingest(date_mdyyyy: Optional[str] = None,
               tickers: Optional[List[str]] = None,
               top_n: int = TOP_N_TICKERS,
               time_budget_sec: float = TIME_BUDGET_SEC,
               dry_run: bool = False) -> dict:
    """Pull one session of dark-pool prints and merge them into darkpool.db.

    Returns a summary dict. Safe to re-run for the same date: darkpool_db
    dedups on (date, timestamp, ticker, price, notional, message), so a second
    pass inserts only genuinely new rows.
    """
    started = time.time()
    date_mdyyyy = date_mdyyyy or _today_mdyyyy()

    if not API_KEY:
        return {"ok": False, "error": "MASSIVE_API_KEY not set"}

    universe = tickers if tickers else resolve_universe(top_n, base=BASE_UNIVERSE)
    if not universe:
        return {"ok": False, "error": "empty universe — darkpool.db has no rows to rank"}

    rows: List[dict] = []
    stats = {"tickers_done": 0, "tickers_skipped": 0, "prints": 0,
             "scanned": 0, "truncated": [], "failed": []}

    for idx, tk in enumerate(universe, 1):
        _set_phase("%s (%d/%d)" % (tk, idx, len(universe)))
        if time.time() - started > time_budget_sec:
            stats["tickers_skipped"] = len(universe) - stats["tickers_done"]
            logger.warning("[darkpool_ingest] time budget %.0fs exhausted — %d tickers skipped",
                           time_budget_sec, stats["tickers_skipped"])
            break
        try:
            res = fetch_offexchange(tk, date_mdyyyy)
        except Exception as e:
            stats["failed"].append(tk)
            logger.warning("[darkpool_ingest] %s fetch failed: %s", tk, e)
            continue
        stats["tickers_done"] += 1
        stats["scanned"] += res["scanned"]
        if res["truncated"]:
            stats["truncated"].append(tk)
        for t in res["prints"]:
            try:
                rows.append(_print_to_row(tk, date_mdyyyy, t))
            except Exception:
                continue
        stats["prints"] += len(res["prints"])

    out = {"ok": True, "date": date_mdyyyy, "universe": len(universe),
           "elapsed_sec": round(time.time() - started, 1), **stats}

    if dry_run:
        out["dry_run"] = True
        return out
    if not rows:
        out["inserted"] = 0
        out["note"] = "no qualifying prints — check the date is a session day"
        return out

    try:
        from api.darkpool_db import insert_csv_rows
    except Exception:
        from darkpool_db import insert_csv_rows  # type: ignore
    result = insert_csv_rows(_rows_to_csv(rows))
    out.update(result)

    # Same invalidation sequence the /upload endpoint runs. Without this the
    # disk-cached per-window JSON stays keyed to the old DB signature and the
    # new day never appears on the page.
    try:
        from api.darkpool_router import _RESPONSE_CACHE
        _RESPONSE_CACHE.clear()
    except Exception as e:
        logger.warning("[darkpool_ingest] response cache clear skipped: %s", e)
    try:
        from api.darkpool_aggregator import (
            invalidate_cache, prebuild_all_windows_background)
        invalidate_cache()
        prebuild_all_windows_background()
    except Exception as e:
        logger.warning("[darkpool_ingest] aggregate invalidate/prebuild skipped: %s", e)

    # Update per-ticker biggest-ever records from the authoritative session +
    # alert on new records (self-gated on DARKPOOL_RECORDS_ENABLED; fail-soft —
    # a records error must never break the ingest).
    try:
        from api.darkpool_records import refresh_from_trades
        _rec = refresh_from_trades(date_mdyyyy)
        if _rec.get("ok") and (_rec.get("new_records") or _rec.get("seeded")):
            logger.info("[darkpool_ingest] records: %s", _rec)
    except Exception as e:
        logger.warning("[darkpool_ingest] records refresh skipped: %s", e)

    logger.info("[darkpool_ingest] %s: +%d new / %d prints from %d tickers in %.0fs",
                date_mdyyyy, result.get("inserted", 0), len(rows),
                stats["tickers_done"], out["elapsed_sec"])
    return out


def scheduled_run() -> None:
    """APScheduler entry point. No-op unless explicitly enabled.

    Routes through run_ingest_background() rather than calling run_ingest()
    directly. A direct call left the shared _run_state untouched, which caused
    two problems on the first live night (7/24):

      * `last_result`/`last_error`/`finished_at` were never recorded, so the
        summary reached ONLY the Railway log and the status endpoint returned
        null — the morning check needed log access. Now the endpoint carries it.
      * `running` was never set True, so the concurrency guard in
        run_ingest_background only ever blocked manual-vs-manual overlaps; a
        manual POST during the 19:20 window would collide with the nightly job
        and double the REST load. Going through the wrapper closes that hole —
        the guard now covers the nightly slot too.

    The wrapper spawns a daemon thread and returns immediately, so the
    scheduler worker is freed at once instead of being held for up to an hour;
    run_ingest still logs its own one-line completion summary (see the
    logger.info near the end of run_ingest), which is the grep target for a
    log-based check.
    """
    if not ENABLED:
        logger.info("[darkpool_ingest] disabled "
                    "(set DARKPOOL_MASSIVE_INGEST_ENABLED=1 to arm)")
        return
    started = run_ingest_background()
    if started.get("started"):
        logger.info("[darkpool_ingest] nightly run started in background thread")
    else:
        # The only way start is refused is the concurrency guard: a manual run
        # was already in flight at fire time. Skipping is correct (don't double
        # the REST load) but must be visible, or the night silently ingests
        # nothing while the endpoint shows the manual run's result.
        logger.warning("[darkpool_ingest] nightly run SKIPPED — %s (state=%s)",
                       started.get("reason"), started.get("state"))
