"""SHINT and SHRTS, the Terminal's short interest screens: FINRA short interest and daily short
volume, read through Massive (the stock-data vendor the site already holds a plan with).

Two datasets, both read through the house adapter (`api/services/massive_adapter.py`: one client,
one budget, one error model) and nowhere else:

  short interest   GET /stocks/v1/short-interest. What broker-dealers report to FINRA twice a
                   month: shares sold short and not yet covered, per ticker, per settlement date,
                   with the average daily volume and the days to cover the vendor works out from
                   them. History from 2017-12-29.
                     filters   ticker, settlement_date, days_to_cover, avg_daily_volume, each with
                               .any_of .gt .gte .lt .lte; sort (column.asc | column.desc, default
                               ticker.asc); limit (default 10, at most 50,000); next_url pages.
                     results[] ticker, settlement_date (YYYY-MM-DD), short_interest (shares),
                               avg_daily_volume (shares), days_to_cover (days).
  short volume     GET /stocks/v1/short-volume. DAILY short sale volume reported to FINRA from
                   off-exchange venues and alternative trading systems, per ticker. History from
                   2024-02-06. It is NOT short interest: it counts shares sold short in one day's
                   off-exchange trades, most of them bought back the same day by market makers.
                     filters   ticker, date, short_volume_ratio (same comparison forms); sort;
                               limit (default 10, at most 50,000); next_url pages.
                     results[] ticker, date (YYYY-MM-DD), short_volume, total_volume,
                               short_volume_ratio (short_volume / total_volume x 100, a percent),
                               exempt_volume, non_exempt_volume and a per-venue split (not read).

Both shapes are as the vendor's documentation pages gave them on 2026-11-18. NOBODY HAS CALLED
EITHER ROUTE WITH THIS SITE'S KEY: the code could not be run against the vendor when it was
written. So:

  * a refusal (401, 403, 404, or no key at all) is a first-class answer, `unavailable`, in plain
    words on the panel. It is REMEMBERED in this module (`REFUSED_HOLD_S`), per dataset, so a
    refused route is not asked again by every stock a member opens;
  * every build writes ONE log line, prefix `[short-data]`, with the status code and the count of
    rows parsed; an answer with no rows, or with rows that lack a required field, says
    `shape mismatch` (or `no rows`) on that line. The key and the request URL are never logged;
  * parsing is tolerant: a missing optional field is None, never 0. A row without its ticker, its
    date or its headline number is dropped and counted.

NOTHING IS BUILT ON A MEMBER'S REQUEST (the house pattern, `api/services/scan_period.py`): a
request returns what this module holds at once; with nothing held it starts ONE background build,
waits a few seconds for it and otherwise answers `computing`, and the panel asks again.

  one stock      `get_stock(sym)`: its whole short interest history with the change from each
                 previous report, the last `SV_DAYS` trading days of short volume, and short
                 interest as a percent of float. Two vendor requests per build, held per ticker
                 for `STOCK_FRESH_S`; the last good answer is served, marked `refreshing`, while
                 its replacement is built.
  the market     `get_market(rank, limit)`: the newest settlement date's short interest for every
                 stock in the site's universe (`api/data/cap_universe.json`; every other row is
                 dropped), each beside its previous report. ONE build (four to six vendor
                 requests), held in this module AND on disk under the data directory, so a restart
                 does not start cold. A request more than `CHECK_EVERY_S` after the last look
                 starts one cheap check (the newest settlement date, one row); the list is rebuilt
                 only when that date is newer than the one held.

PERCENT OF FLOAT is short interest divided by the float the nightly screener export already keeps
(`screener.finviz_universe`, "Shares Float"). No third vendor request is made for it. Where the
export has no float for a stock the percent is None; where short interest is more than
`PCT_FLOAT_MAX` of the float the two figures do not describe the same share count (a split or an
offering since the settlement date) and the percent is withheld and counted.

WHEN FINRA PUBLISHED A REPORT is not in the vendor's answer, so `published` is always None. The
`publication_estimate` beside it is worked out from FINRA's schedule (after the close on the 7th
business day after the settlement date) and says so.

Reused by the Terminal panels (app/src/pages/terminal/panels/shortInterestModel.js and
shortListModel.js); `held_stock` and `held_market` are read-only for a caller that must not cause
work.
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
import time
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional

_log = logging.getLogger(__name__)

SI_PATH = "/stocks/v1/short-interest"
SV_PATH = "/stocks/v1/short-volume"
#: the two datasets, by the name each one has in an answer and in the log
INTEREST = "interest"
VOLUME = "volume"
_LOG_NAME = {INTEREST: "short-interest", VOLUME: "short-volume"}
_DATA_CLASS = {INTEREST: "short_interest", VOLUME: "short_volume"}
SOURCE = "FINRA, through Massive"
FLOAT_SOURCE = "nightly screener export (Finviz), today's float"
PUBLISHED_BASIS = ("FINRA's publication day is not in the vendor's answer. The estimate is FINRA's schedule: "
                   "after the close on the 7th business day after the settlement date.")

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
SI_HISTORY_LIMIT = 500        # reports read for one stock (two a month since 2017-12-29 is about 215)
SV_DAYS = 60                  # trading days of short volume read for one stock
PAGE_LIMIT = 50_000           # the vendor's own maximum page
MARKET_MAX_PAGES = 4          # a whole report is one page today; more than this is refused, never cut
VENDOR_TIMEOUT_S = 30.0
MARKET_LIMIT = 100            # rows a ranked answer carries unless asked
MARKET_LIMIT_MAX = 250
FLOOR_SHARES = 500_000        # a percent change is ranked only when the PREVIOUS report was at least this
PCT_FLOAT_MAX = 150.0         # short interest above this percent of float is a mismatch, withheld
MIN_UNIVERSE_ROWS = 500       # fewer universe names than this in a report is not a market
PARTIAL_RATIO = 0.8           # a newest report this far below the one before it is still landing

STOCK_FRESH_S = 4 * 3600.0    # one stock's answer
STOCK_STALE_EXTRA_S = 20 * 3600.0   # the last good answer may be served this long past its freshness
STOCK_KEEP = 400              # stocks held
MAX_STOCK_BUILDS = 4          # stocks being read from the vendor at once
CHECK_EVERY_S = 6 * 3600.0    # how often a request may start the cheap "is there a newer report" check
REFUSED_HOLD_S = 6 * 3600.0   # a 401 / 403 / 404 is not asked again for this long
NOT_CONFIGURED_HOLD_S = 900.0  # no key on this server
FAILED_S = 60.0               # a failed build is said briefly, then tried again
UNAVAILABLE_S = 900.0         # one stock's "unavailable" answer (rebuilding it asks the vendor nothing)
WAIT_S = 3.0                  # the longest a request waits on the build it started
DISK_VERSION = 1

#: the ranks of the market list, in the order the panel offers them
RANKS = ("dtc", "up", "down", "float")
DEFAULT_RANK = "dtc"

_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SYMBOL = re.compile(r"^[A-Z]{1,5}(?:[.\-][A-Z]{1,2})?$")

_lock = threading.Lock()
_refused: dict[str, tuple[float, Optional[int], str]] = {}     # dataset -> (until, http status, reason)

_stock_done: dict[str, tuple[float, dict]] = {}                # sym -> (fresh until, answer)
_stock_old: dict[str, tuple[float, dict]] = {}                 # sym -> (servable until, last GOOD answer)
_stock_inflight: dict[str, threading.Event] = {}               # sym -> set when its build finishes

_market: dict[str, Any] = {
    "held": None,          # the built list (see `assemble_market`), or None
    "loaded": False,       # the disk copy has been looked for
    "checked": 0.0,        # when the vendor was last asked for the newest settlement date
    "check": None,         # what the last look said when it did not go well, for the answer
    "block": None,         # (until, answer) with nothing held: unavailable / failed
    "inflight": None,      # the Event of the running job
}


class _Stop(Exception):
    """A vendor read that did not give rows. `state`: 'unavailable' | 'failed'. `hold` is how long
    the answer stands before the vendor is asked again."""

    def __init__(self, state: str, http_status: Optional[int] = None, reason: Optional[str] = None,
                 note: str = "", hold: float = FAILED_S):
        super().__init__(reason or state)
        self.state = state
        self.http_status = http_status
        self.reason = reason
        self.note = note
        self.hold = hold


# ── the readers (each one small, so a test can stand in for it) ──────────────────────────────

def _vendor_page(dataset: str, params: dict, activity: str) -> dict:
    """ONE vendor request through the house adapter: the JSON object as sent. Raises `ProviderError`."""
    from api.services import massive_adapter
    path = SI_PATH if dataset == INTEREST else SV_PATH
    return massive_adapter.get(path, params=params, data_class=_DATA_CLASS[dataset],
                               activity=activity, timeout=VENDOR_TIMEOUT_S).value


def _vendor_rows(dataset: str, params: dict, activity: str, max_pages: int) -> list:
    """Every row of a paged vendor list through the house adapter (all or nothing). Raises `ProviderError`."""
    from api.services import massive_adapter
    path = SI_PATH if dataset == INTEREST else SV_PATH
    return massive_adapter.get_pages(path, params=params, data_class=_DATA_CLASS[dataset],
                                     activity=activity, max_pages=max_pages, timeout=VENDOR_TIMEOUT_S).value


def universe() -> frozenset:
    """The site's stock universe. Empty when its file cannot be read: "cannot answer", never "no stocks"."""
    from api.services import cap_universe
    return cap_universe.symbols()


def read_floats(syms) -> tuple[dict[str, float], str]:
    """({SYM: float shares}, state) from the nightly screener export. state: 'ok' | 'stale' | 'missing'.
    One local file read; no vendor request. A stock the export has no float for is simply absent."""
    from api.services.screener import finviz_universe
    failures: dict = {}
    try:
        fields = finviz_universe.read_finviz_fields(list(syms), failures)
    except Exception:  # noqa: BLE001 -- an unreadable export is "no float", never a failed list
        return {}, "missing"
    notes = failures.get("finviz_universe") or {}
    if "missing" in notes or not fields:
        return {}, "missing"
    out = {}
    for sym, row in fields.items():
        v = _num(row.get("float_shares")) if isinstance(row, dict) else None
        if v is not None and v > 0:
            out[str(sym).upper()] = v
    return out, ("stale" if any(str(k).startswith("stale") for k in notes) else "ok")


def publication_estimate(day: Optional[str]) -> Optional[str]:
    """The day FINRA's schedule publishes the report for settlement date `day`, or None. An estimate
    from the calendar the house already keeps (`short_interest.py`), never read from the vendor."""
    d = _iso(day)
    if not d:
        return None
    try:
        from api.services import short_interest as house
        return house._add_business_days(date.fromisoformat(d), house._PUBLISH_LAG_BD, house._holidays()).isoformat()
    except Exception:  # noqa: BLE001 -- no estimate is honest; a guessed one is not
        return None


def _data_dir() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return base if os.path.isdir(base) else None


def _disk_path() -> Optional[str]:
    base = _data_dir()
    return os.path.join(base, "short_data", f"market_v{DISK_VERSION}.json") if base else None


# ── pure helpers ─────────────────────────────────────────────────────────────────────────────

def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _whole(v: Any) -> Optional[int]:
    """A count of shares: a finite number that is not negative, as an int. Anything else is None."""
    f = _num(v)
    return int(round(f)) if f is not None and f >= 0 else None


def _iso(v: Any) -> Optional[str]:
    s = str(v or "")[:10]
    if not _ISO_DAY.match(s):
        return None
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_symbol(raw: Any) -> Optional[str]:
    """A typed ticker in the house form (`BRK-B`), or None when it is not a US stock or fund symbol."""
    s = str(raw or "").strip().upper().lstrip("$")
    if not _SYMBOL.match(s):
        return None
    return s.replace(".", "-")


def vendor_symbol(sym: str) -> str:
    """The symbol the vendor expects (class shares with a dot: `BRK.B`)."""
    from api.services.massive import to_polygon_symbol
    return to_polygon_symbol(sym)


def house_symbol(ticker: str) -> str:
    return str(ticker or "").strip().upper().replace(".", "-")


def norm_rank(raw: Any) -> Optional[str]:
    if raw is None or str(raw).strip() == "":
        return DEFAULT_RANK
    key = str(raw).strip().lower()
    return key if key in RANKS else None


def parse_interest_rows(raw: Any) -> tuple[list[dict], int]:
    """(rows, dropped) from a short interest `results` list. A row needs its ticker, its settlement
    date and its short interest; the other two fields are None when the vendor did not send them."""
    rows: list[dict] = []
    dropped = 0
    for r in raw if isinstance(raw, list) else []:
        tick = str(r.get("ticker") or "").strip().upper() if isinstance(r, dict) else ""
        day = _iso(r.get("settlement_date")) if isinstance(r, dict) else None
        short = _whole(r.get("short_interest")) if isinstance(r, dict) else None
        if not tick or not day or short is None:
            dropped += 1
            continue
        dtc = _num(r.get("days_to_cover"))
        rows.append({
            "ticker": tick, "settlement_date": day, "short_interest": short,
            "avg_daily_volume": _whole(r.get("avg_daily_volume")),
            "days_to_cover": round(dtc, 2) if dtc is not None and dtc >= 0 else None,
        })
    return rows, dropped


def parse_volume_rows(raw: Any) -> tuple[list[dict], int]:
    """(rows, dropped) from a short volume `results` list. A row needs its ticker, its date and its
    short volume; total volume and the ratio are None when the vendor did not send them."""
    rows: list[dict] = []
    dropped = 0
    for r in raw if isinstance(raw, list) else []:
        tick = str(r.get("ticker") or "").strip().upper() if isinstance(r, dict) else ""
        day = _iso(r.get("date")) if isinstance(r, dict) else None
        short = _whole(r.get("short_volume")) if isinstance(r, dict) else None
        if not tick or not day or short is None:
            dropped += 1
            continue
        ratio = _num(r.get("short_volume_ratio"))
        rows.append({
            "ticker": tick, "date": day, "short_volume": short,
            "total_volume": _whole(r.get("total_volume")),
            "short_volume_ratio": round(ratio, 2) if ratio is not None and 0 <= ratio <= 100 else None,
        })
    return rows, dropped


def change_of(now: Optional[int], before: Optional[int]) -> tuple[Optional[int], Optional[float]]:
    """(shares, percent) from the previous report to this one. No previous report: (None, None).
    A previous report of zero shares has no percent (never an infinite or a 0% one)."""
    if now is None or before is None:
        return None, None
    shares = now - before
    return shares, (round(shares / before * 100.0, 2) if before > 0 else None)


def pct_of_float(short: Optional[int], float_shares: Optional[float]) -> tuple[Optional[float], bool]:
    """(percent of float, withheld). Withheld: the two figures cannot describe the same share count."""
    if short is None or float_shares is None or float_shares <= 0:
        return None, False
    pct = short / float_shares * 100.0
    if pct > PCT_FLOAT_MAX:
        return None, True
    return round(pct, 2), False


def history_of(rows: list[dict]) -> list[dict]:
    """One stock's reports, newest first, one per settlement date, each with its change from the
    report before it."""
    by_day: dict[str, dict] = {}
    for r in rows:
        by_day.setdefault(r["settlement_date"], r)
    days = sorted(by_day, reverse=True)
    out = []
    for i, day in enumerate(days):
        r = by_day[day]
        before = by_day[days[i + 1]]["short_interest"] if i + 1 < len(days) else None
        shares, pct = change_of(r["short_interest"], before)
        out.append({
            "settlement_date": day, "short_interest": r["short_interest"],
            "avg_daily_volume": r["avg_daily_volume"], "days_to_cover": r["days_to_cover"],
            "change_shares": shares, "change_pct": pct,
        })
    return out


def assemble_market(day: str, rows: list[dict], prev_day: Optional[str], prev_rows: list[dict], uni,
                    floats: dict[str, float], float_state: str, *, landing: Optional[str] = None,
                    vendor_rows: int = 0, read_at: Optional[str] = None) -> dict:
    """Pure: the held market list. One row per universe stock in the report for `day`, with its
    previous report beside it. Rows outside the universe are dropped."""
    before = {}
    for r in prev_rows:
        before.setdefault(house_symbol(r["ticker"]), r)
    out: dict[str, dict] = {}
    withheld = with_float = 0
    for r in rows:
        sym = house_symbol(r["ticker"])
        if sym not in uni or sym in out:
            continue
        prev = before.get(sym)
        prev_short = prev["short_interest"] if prev else None
        shares, pct = change_of(r["short_interest"], prev_short)
        flt = floats.get(sym)
        pf, held_back = pct_of_float(r["short_interest"], flt)
        withheld += 1 if held_back else 0
        with_float += 1 if pf is not None else 0
        out[sym] = {
            "sym": sym, "short_interest": r["short_interest"], "avg_daily_volume": r["avg_daily_volume"],
            "days_to_cover": r["days_to_cover"], "prev_short_interest": prev_short,
            "change_shares": shares, "change_pct": pct,
            "float_shares": int(round(flt)) if flt is not None else None, "pct_float": pf,
        }
    return {
        "v": DISK_VERSION,
        "settlement_date": day,
        "previous_settlement_date": prev_day,
        "newer_report_landing": landing,
        "read_at": read_at or _now_iso(),
        "rows": [out[s] for s in sorted(out)],
        "count": len(out),
        "universe": len(uni),
        "vendor_rows": vendor_rows,
        "float": {"state": float_state, "with_float": with_float, "withheld": withheld, "source": FLOAT_SOURCE},
    }


def _ranked(rows: list[dict], rank: str) -> list[dict]:
    if rank == "dtc":
        pool = [r for r in rows if r.get("days_to_cover") is not None]
        return sorted(pool, key=lambda r: (-r["days_to_cover"], r["sym"]))
    if rank == "float":
        pool = [r for r in rows if r.get("pct_float") is not None]
        return sorted(pool, key=lambda r: (-r["pct_float"], r["sym"]))
    based = [r for r in rows if r.get("change_pct") is not None and (r.get("prev_short_interest") or 0) >= FLOOR_SHARES]
    if rank == "up":
        return sorted([r for r in based if r["change_pct"] > 0], key=lambda r: (-r["change_pct"], r["sym"]))
    return sorted([r for r in based if r["change_pct"] < 0], key=lambda r: (r["change_pct"], r["sym"]))


def rank_market(held: dict, rank: str, limit: int, *, check: Optional[dict] = None) -> dict:
    """Pure: one ranked answer from the held list. `ranked` is how many stocks have the number this
    rank needs (and pass its floor); `cut` says the answer carries only the first `limit` of them."""
    pool = _ranked(held.get("rows") or [], rank)
    day = held.get("settlement_date")
    return {
        "status": "ok",
        "rank": rank,
        "settlement_date": day,
        "previous_settlement_date": held.get("previous_settlement_date"),
        "newer_report_landing": held.get("newer_report_landing"),
        "published": None,
        "publication_estimate": publication_estimate(day),
        "published_basis": PUBLISHED_BASIS,
        "read_at": held.get("read_at"),
        "count": held.get("count", 0),
        "universe": held.get("universe", 0),
        "ranked": len(pool),
        "limit": limit,
        "cut": len(pool) > limit,
        "rows": pool[:limit],
        "floor_shares": FLOOR_SHARES if rank in ("up", "down") else None,
        "float": held.get("float"),
        "source": SOURCE,
        "check": check,
    }


# ── the vendor reads, under the refusal memory ───────────────────────────────────────────────

def _refusal(dataset: str) -> Optional[tuple[float, Optional[int], str]]:
    with _lock:
        hit = _refused.get(dataset)
        if hit is None:
            return None
        if hit[0] <= time.time():
            _refused.pop(dataset, None)
            return None
        return hit


def _read(dataset: str, fetch: Callable[[], Any]) -> Any:
    """Run one vendor read. Returns what it returned, or raises `_Stop`. A refusal is remembered
    for the dataset and the vendor is not asked again until it lapses."""
    from api.services import provider_errors as pe
    held = _refusal(dataset)
    if held is not None:
        left = max(1.0, held[0] - time.time())
        raise _Stop("unavailable", held[1], held[2], hold=left,
                    note=f"unavailable (not asked: a refusal is remembered for {int(left // 60)} more min)")
    try:
        out = fetch()
    except (pe.ProviderAuthError, pe.ProviderNotFound) as exc:
        status = exc.status or (404 if isinstance(exc, pe.ProviderNotFound) else 403)
        with _lock:
            _refused[dataset] = (time.time() + REFUSED_HOLD_S, status, "refused")
        raise _Stop("unavailable", status, "refused", hold=REFUSED_HOLD_S,
                    note=f"unavailable (the vendor refused this key; not asked again for {int(REFUSED_HOLD_S // 3600)}h)") from None
    except pe.ProviderNotConfigured:
        with _lock:
            _refused[dataset] = (time.time() + NOT_CONFIGURED_HOLD_S, None, "not_configured")
        raise _Stop("unavailable", None, "not_configured", hold=NOT_CONFIGURED_HOLD_S,
                    note="unavailable (no vendor key on this server)") from None
    except pe.ProviderError as exc:
        # the exception's own text is never logged: only its class and the status it carried
        raise _Stop("failed", exc.status, "rate_limited" if isinstance(exc, pe.ProviderRateLimited) else "vendor",
                    note=f"failed ({type(exc).__name__})") from None
    except Exception as exc:  # noqa: BLE001 -- a failed read is said, never raised into the build thread's caller
        raise _Stop("failed", None, "error", note=f"failed ({type(exc).__name__})") from None
    with _lock:
        _refused.pop(dataset, None)
    return out


def _say(dataset: str, status: Any, text: str) -> str:
    return f"{_LOG_NAME[dataset]} status={status if status is not None else 'none'} {text}"


def _section(dataset: str, sym: str) -> tuple[dict, str]:
    """(one dataset's section of a stock's answer, its part of the log line)."""
    vsym = vendor_symbol(sym)
    if dataset == INTEREST:
        params = {"ticker": vsym, "sort": "settlement_date.desc", "limit": SI_HISTORY_LIMIT}
    else:
        params = {"ticker": vsym, "sort": "date.desc", "limit": SV_DAYS}
    try:
        obj = _read(dataset, lambda: _vendor_page(dataset, params, f"short_data.stock.{dataset}"))
    except _Stop as stop:
        return ({"state": stop.state, "http_status": stop.http_status, "reason": stop.reason},
                _say(dataset, stop.http_status, stop.note))
    raw = obj.get("results") if isinstance(obj, dict) else None
    n_raw = len(raw) if isinstance(raw, list) else 0
    rows, dropped = parse_interest_rows(raw) if dataset == INTEREST else parse_volume_rows(raw)
    rows = [r for r in rows if r["ticker"] == vsym]          # a filter the vendor ignored never mixes stocks
    more = bool(obj.get("next_url")) if isinstance(obj, dict) else False
    if not rows:
        if n_raw:
            return ({"state": "failed", "http_status": 200, "reason": "shape"},
                    _say(dataset, 200, f"rows=0 shape mismatch ({n_raw} results, none usable for {vsym})"))
        return ({"state": "none", "http_status": 200, "reason": None},
                _say(dataset, 200, "rows=0 no rows (the vendor answered with an empty list)"))
    tail = f" dropped={dropped}" if dropped else ""
    if dataset == INTEREST:
        reports = history_of(rows)
        return ({"state": "ok", "http_status": 200, "reason": None, "reports": reports, "count": len(reports),
                 "cut": more, "first_date": reports[-1]["settlement_date"]},
                _say(dataset, 200, f"rows={len(reports)}{tail}"))
    by_day: dict[str, dict] = {}
    for r in rows:
        by_day.setdefault(r["date"], r)
    days = [{k: by_day[d][k] for k in ("date", "short_volume", "total_volume", "short_volume_ratio")}
            for d in sorted(by_day, reverse=True)][:SV_DAYS]
    return ({"state": "ok", "http_status": 200, "reason": None, "days": days, "count": len(days), "window_days": SV_DAYS},
            _say(dataset, 200, f"rows={len(days)}{tail}"))


def build_stock(sym: str) -> tuple[dict, str]:
    """(one stock's answer, the log line). Two vendor requests at most; never raises."""
    interest, said_i = _section(INTEREST, sym)
    volume, said_v = _section(VOLUME, sym)
    states = (interest["state"], volume["state"])
    status = "ok" if any(s in ("ok", "none") for s in states) else "unavailable" if "unavailable" in states else "failed"
    newest = interest["reports"][0] if interest["state"] == "ok" else None
    flt: dict = {"shares": None, "pct_float": None, "withheld": False, "state": "missing", "source": FLOAT_SOURCE}
    if newest is not None:
        floats, state = read_floats([sym])
        shares = floats.get(sym)
        pct, withheld = pct_of_float(newest["short_interest"], shares)
        flt = {"shares": int(round(shares)) if shares is not None else None, "pct_float": pct, "withheld": withheld,
               "state": state if shares is not None else "missing", "source": FLOAT_SOURCE}
    day = newest["settlement_date"] if newest else None
    return ({
        "status": status,
        "sym": sym,
        "interest": interest,
        "volume": volume,
        "float": flt,
        "settlement_date": day,
        "published": None,
        "publication_estimate": publication_estimate(day),
        "published_basis": PUBLISHED_BASIS,
        "read_at": _now_iso(),
        "source": SOURCE,
    }, f"stock {sym}: {said_i}; {said_v}")


# ── one stock: one build, off the request ────────────────────────────────────────────────────

def _stock_remember(sym: str, out: dict, ttl: float) -> None:
    now = time.time()
    complete = out.get("status") == "ok" and "failed" not in (out["interest"]["state"], out["volume"]["state"])
    with _lock:
        _stock_done[sym] = (now + ttl, out)
        for k in [k for k, (exp, _o) in _stock_done.items() if exp <= now]:
            _stock_done.pop(k, None)
        while len(_stock_done) > STOCK_KEEP:
            _stock_done.pop(min(_stock_done, key=lambda k: _stock_done[k][0]), None)
        if complete:
            _stock_old[sym] = (now + ttl + STOCK_STALE_EXTRA_S, out)
            for k in [k for k, (until, _o) in _stock_old.items() if until <= now]:
                _stock_old.pop(k, None)
            while len(_stock_old) > STOCK_KEEP:
                _stock_old.pop(min(_stock_old, key=lambda k: _stock_old[k][0]), None)


def _stock_answer(sym: str) -> Optional[dict]:
    with _lock:
        hit = _stock_done.get(sym)
        if hit is None:
            return None
        if hit[0] <= time.time():
            _stock_done.pop(sym, None)
            return None
        return hit[1]


def _stock_old_answer(sym: str, *, mark: bool = True) -> Optional[dict]:
    with _lock:
        hit = _stock_old.get(sym)
        if hit is None:
            return None
        if hit[0] <= time.time():
            _stock_old.pop(sym, None)
            return None
        return {**hit[1], "refreshing": True} if mark else hit[1]


def _stock_bg(sym: str, done: threading.Event) -> None:
    started = time.time()
    said = f"stock {sym}: failed"
    try:
        out, said = build_stock(sym)
        states = (out["interest"]["state"], out["volume"]["state"])
        ttl = FAILED_S if "failed" in states else UNAVAILABLE_S if out["status"] != "ok" else STOCK_FRESH_S
        _stock_remember(sym, out, ttl)
    except Exception as exc:  # noqa: BLE001 -- a failed build is said, never left as "computing" for ever
        said = f"stock {sym}: failed ({type(exc).__name__})"
        with _lock:
            _stock_done[sym] = (time.time() + FAILED_S, {"status": "failed", "sym": sym})
    finally:
        level = logging.WARNING if ("unavailable" in said or "failed" in said or "mismatch" in said) else logging.INFO
        _log.log(level, "[short-data] %s; %.2fs", said, time.time() - started)
        with _lock:
            _stock_inflight.pop(sym, None)
        done.set()


def held_stock(ticker: Any) -> tuple[Optional[dict], str]:
    """READ ONLY: what this module already holds for one stock, as `(answer, how)`. It never starts
    a build. how: 'fresh' | 'last_good' | 'not_held' | 'refused' (not a symbol)."""
    sym = clean_symbol(ticker)
    if sym is None:
        return {"status": "bad_symbol", "sym": None}, "refused"
    held = _stock_answer(sym)
    if held is not None and held.get("status") == "ok":
        return held, "fresh"
    old = _stock_old_answer(sym, mark=False)
    if old is not None:
        return old, "last_good"
    return (held, "fresh") if held is not None else (None, "not_held")


def get_stock(ticker: Any, *, wait_s: Optional[float] = None) -> dict:
    """One stock's short interest history and daily short volume. NEVER builds on the caller's
    thread: the held answer, else the last good one marked `refreshing`, else a short wait on the
    one background build, else `{"status": "computing"}`.

    status: 'ok' (each of `interest` and `volume` carries its own state: 'ok' | 'none' (the vendor
            has no rows for this symbol) | 'unavailable' | 'failed') | 'computing' |
            'unavailable' (the vendor refused both datasets) | 'failed' | 'bad_symbol'
    """
    sym = clean_symbol(ticker)
    if sym is None:
        return {"status": "bad_symbol", "sym": None}
    held = _stock_answer(sym)
    if held is not None and held.get("status") == "ok":
        return held
    old = _stock_old_answer(sym)
    if held is not None:
        # a failed or refused rebuild is held for a while; the last good answer is worth more
        return old if old is not None else held
    with _lock:
        done = _stock_inflight.get(sym)
        if done is None:
            if len(_stock_inflight) >= MAX_STOCK_BUILDS:
                return old if old is not None else {"status": "computing", "sym": sym, "busy": True}
            done = _stock_inflight[sym] = threading.Event()
            threading.Thread(target=_stock_bg, args=(sym, done), daemon=True, name="short-data-stock").start()
    if old is not None:
        return old                                   # at once; the build replaces it for the next read
    done.wait(WAIT_S if wait_s is None else wait_s)
    held = _stock_answer(sym)
    return held if held is not None else {"status": "computing", "sym": sym}


# ── the market list: one build, held here and on disk ────────────────────────────────────────

def _save_disk(held: dict, checked: float) -> None:
    path = _disk_path()
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".market_", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"held": held, "checked": checked}, fh)
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:  # noqa: BLE001 -- the list is still held in memory
        _log.warning("[short-data] market list: could not be written to disk (%s)", type(exc).__name__)


def _load_disk() -> tuple[Optional[dict], float]:
    path = _disk_path()
    if not path:
        return None, 0.0
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None, 0.0
    held = doc.get("held") if isinstance(doc, dict) else None
    if (not isinstance(held, dict) or held.get("v") != DISK_VERSION or not _iso(held.get("settlement_date"))
            or not isinstance(held.get("rows"), list) or not held["rows"]):
        return None, 0.0
    checked = _num(doc.get("checked")) or 0.0
    return held, min(checked, time.time())


def _held_market() -> Optional[dict]:
    """The list this module holds, looking for the disk copy once per process."""
    with _lock:
        if _market["held"] is not None or _market["loaded"]:
            return _market["held"]
    held, checked = _load_disk()
    with _lock:
        if not _market["loaded"]:
            _market["loaded"] = True
            if _market["held"] is None and held is not None:
                _market["held"], _market["checked"] = held, checked
        return _market["held"]


def _newest_day(before: Optional[str] = None) -> Optional[str]:
    """The newest settlement date the vendor holds (before `before` when given), or None when it has
    none. One request, one row. Raises `_Stop`; rows that cannot be read are a shape mismatch."""
    params: dict = {"sort": "settlement_date.desc", "limit": 1}
    if before:
        params["settlement_date.lt"] = before
    obj = _read(INTEREST, lambda: _vendor_page(INTEREST, params, "short_data.market.newest"))
    raw = obj.get("results") if isinstance(obj, dict) else None
    rows, _dropped = parse_interest_rows(raw)
    if not rows:
        if isinstance(raw, list) and raw:
            raise _Stop("unavailable", 200, "shape", hold=UNAVAILABLE_S,
                        note="rows=0 shape mismatch (the newest row carried no ticker, settlement_date and short_interest)")
        if before is None:
            raise _Stop("unavailable", 200, "shape", hold=UNAVAILABLE_S,
                        note="rows=0 no rows (the vendor answered with an empty list)")
        return None
    day = rows[0]["settlement_date"]
    if before and day >= before:
        raise _Stop("unavailable", 200, "shape", hold=UNAVAILABLE_S,
                    note=f"rows=0 shape mismatch (asked for a report before {before}, got {day})")
    return day


def _report(day: str) -> tuple[list[dict], int]:
    """(every usable row of one settlement date's report, how many the vendor sent). Raises `_Stop`."""
    params = {"settlement_date": day, "sort": "ticker.asc", "limit": PAGE_LIMIT}
    raw = _read(INTEREST, lambda: _vendor_rows(INTEREST, params, "short_data.market.report", MARKET_MAX_PAGES))
    rows, _dropped = parse_interest_rows(raw)
    return [r for r in rows if r["settlement_date"] == day], len(raw) if isinstance(raw, list) else 0


def build_market(held_day: Optional[str] = None, held_landing: Optional[str] = None) -> tuple[str, Optional[dict], str]:
    """(what happened, the new held list or None, the log line's text).
    what happened: 'ok' (a new list) | 'same' (the vendor's newest report is the one held).
    Raises `_Stop` for a refusal, a failed read, a shape mismatch or a report too thin to be a market."""
    uni = universe()
    if not uni:
        raise _Stop("failed", None, "universe", hold=UNAVAILABLE_S,
                    note="failed (the site's stock universe could not be read; the vendor was not asked)")
    newest = _newest_day()
    if held_day and newest == held_day and not held_landing:
        return "same", None, _say(INTEREST, 200, f"newest settlement {newest} is the one held; nothing rebuilt")
    in_uni = lambda rows: sum(1 for s in {house_symbol(r["ticker"]) for r in rows} if s in uni)  # noqa: E731
    rows, n_raw = _report(newest)
    prev_day = _newest_day(before=newest)
    prev_rows, prev_raw = _report(prev_day) if prev_day else ([], 0)
    day, landing = newest, None
    if prev_day and in_uni(rows) < PARTIAL_RATIO * in_uni(prev_rows):
        # the newest report is still landing at the vendor: show the one before it, and say so
        landing, day, rows, n_raw = newest, prev_day, prev_rows, prev_raw
        prev_day = _newest_day(before=day)
        prev_rows, prev_raw = _report(prev_day) if prev_day else ([], 0)
    have = in_uni(rows)
    if have < MIN_UNIVERSE_ROWS:
        if n_raw and not rows:
            raise _Stop("unavailable", 200, "shape", hold=UNAVAILABLE_S,
                        note=f"rows=0 shape mismatch ({n_raw} results for {day}, none usable)")
        raise _Stop("unavailable", 200, "thin", hold=UNAVAILABLE_S,
                    note=f"rows={len(rows)} thin report (only {have} of {len(uni)} universe stocks for {day}; nothing held)")
    floats, float_state = read_floats(uni)
    held = assemble_market(day, rows, prev_day, prev_rows, uni, floats, float_state, landing=landing, vendor_rows=n_raw)
    return "ok", held, _say(INTEREST, 200, (
        f"rows={len(rows)} settlement={day} previous={prev_day or 'none'} universe_rows={held['count']} of {len(uni)} "
        f"float={held['float']['with_float']}{f' landing={landing}' if landing else ''}"))


def _market_bg(done: threading.Event) -> None:
    started = time.time()
    said, level = "failed", logging.WARNING
    try:
        with _lock:
            held = _market["held"]
        what, new, said = build_market(held.get("settlement_date") if held else None,
                                       held.get("newer_report_landing") if held else None)
        now = time.time()
        with _lock:
            if new is not None:
                _market["held"] = new
            _market["checked"], _market["check"], _market["block"] = now, None, None
            held = _market["held"]
        if held is not None:
            _save_disk(held, now)
        level = logging.INFO
    except _Stop as stop:
        said = _say(INTEREST, stop.http_status, stop.note)
        now = time.time()
        answer = {"status": stop.state, "reason": stop.reason, "http_status": stop.http_status, "source": SOURCE}
        with _lock:
            _market["block"] = (now + stop.hold, answer)
            _market["check"] = {"state": stop.state, "reason": stop.reason, "http_status": stop.http_status, "at": _now_iso()}
            # with a list held, look again after the same hold, not on every request
            _market["checked"] = now - CHECK_EVERY_S + stop.hold
    except Exception as exc:  # noqa: BLE001 -- a failed build is said, never left as "computing" for ever
        said = f"{_LOG_NAME[INTEREST]} status=none failed ({type(exc).__name__})"
        now = time.time()
        with _lock:
            _market["block"] = (now + FAILED_S, {"status": "failed", "reason": "error", "http_status": None, "source": SOURCE})
            _market["check"] = {"state": "failed", "reason": "error", "http_status": None, "at": _now_iso()}
            _market["checked"] = now - CHECK_EVERY_S + FAILED_S
    finally:
        _log.log(level, "[short-data] market list: %s; %.2fs", said, time.time() - started)
        with _lock:
            _market["inflight"] = None
        done.set()


def _start_market_job() -> threading.Event:
    with _lock:
        done = _market["inflight"]
        if done is None:
            done = _market["inflight"] = threading.Event()
            threading.Thread(target=_market_bg, args=(done,), daemon=True, name="short-data-market").start()
        return done


def _market_block() -> Optional[dict]:
    with _lock:
        hit = _market["block"]
        if hit is None:
            return None
        if hit[0] <= time.time():
            _market["block"] = None
            return None
        return dict(hit[1])


def _limit(raw: Any) -> int:
    n = _num(raw)
    return MARKET_LIMIT if n is None else max(1, min(MARKET_LIMIT_MAX, int(n)))


def held_market(rank: Any = None, limit: Any = None) -> tuple[Optional[dict], str]:
    """READ ONLY: one ranked answer from the list this module already holds, as `(answer, how)`.
    It never starts a build or a check. how: 'held' | 'not_held' | 'refused' (not a rank).
    With no list held, the answer is None, or what the last build said while that still stands
    (`unavailable` or `failed`, with its reason: the answer `get_market` gives without starting
    another build), so a caller can tell "refused by the data plan" from "never read"."""
    key = norm_rank(rank)
    if key is None:
        return {"status": "bad_rank", "ranks": list(RANKS)}, "refused"
    held = _held_market()
    if held is None:
        return _market_block(), "not_held"
    with _lock:
        check = _market["check"]
    return rank_market(held, key, _limit(limit), check=check), "held"


def get_market(rank: Any = None, limit: Any = None, *, wait_s: Optional[float] = None) -> dict:
    """The newest report's short interest across the site's universe, ranked. NEVER builds on the
    caller's thread: the held list (looked for on disk once), else a short wait on the one
    background build, else `{"status": "computing"}`.

    rank:   'dtc' days to cover, highest first (the default) | 'up' biggest percent increase since
            the previous report | 'down' biggest percent decrease | 'float' percent of float
    status: 'ok' | 'computing' | 'unavailable' (the vendor refused the key, or its answer could
            not be read as a market; `reason` says which) | 'failed' | 'bad_rank'
    """
    key = norm_rank(rank)
    if key is None:
        return {"status": "bad_rank", "ranks": list(RANKS)}
    n = _limit(limit)
    held = _held_market()
    if held is not None:
        with _lock:
            due = time.time() - _market["checked"] >= CHECK_EVERY_S
            check = _market["check"]
        if due:
            _start_market_job()                      # never waited for: the held list answers now
        return rank_market(held, key, n, check=check)
    block = _market_block()
    if block is not None:
        return block
    done = _start_market_job()
    done.wait(WAIT_S if wait_s is None else wait_s)
    with _lock:
        held, check = _market["held"], _market["check"]
    if held is not None:
        return rank_market(held, key, n, check=check)
    block = _market_block()
    return block if block is not None else {"status": "computing"}


def held_market_row(ticker: Any) -> tuple[Optional[dict], str]:
    """READ ONLY: ONE stock's row of the market list this module already holds, as `(row, how)`.
    It never starts a build, a check or a vendor read. For a reader that wants a stock's newest
    short interest without that stock's own history having been read (`held_stock`): the list
    covers the whole universe once the daily warm has built it.

    how: 'held'        the row, with the report's dates and the list's read time beside it
         'not_in_list' a list is held and this stock is not in the report (row is None)
         'not_held'    no list is held; row is None, or what the last build said while that still
                       stands (`unavailable` / `failed` with its reason), as `held_market` gives
         'refused'     not a symbol
    """
    sym = clean_symbol(ticker)
    if sym is None:
        return None, "refused"
    held = _held_market()
    if held is None:
        return _market_block(), "not_held"
    for r in held.get("rows") or []:
        if r.get("sym") == sym:
            day = held.get("settlement_date")
            return {**r, "settlement_date": day,
                    "previous_settlement_date": held.get("previous_settlement_date"),
                    "publication_estimate": publication_estimate(day),
                    "read_at": held.get("read_at"), "source": SOURCE,
                    "float_source": (held.get("float") or {}).get("source")}, "held"
    return None, "not_in_list"


# ── the daily warm: the market list is kept built, on the web service only ───────────────────

WARM_DELAY_S = 180.0          # after boot: never compete with startup
WARM_EVERY_S = 1800.0         # how often the loop looks; a look asks the vendor at most every CHECK_EVERY_S

_warm_started = threading.Event()


def warm_market() -> str:
    """What `get_market` does about the list, with nobody waiting. Says what it did:
    'held' (a list is held and the last look is recent), 'checking' (a list is held and the cheap
    "is there a newer report" look was started), 'blocked' (nothing held and the last build's
    unavailable / failed answer still stands, so the vendor is not asked), 'building' (nothing
    held: the one background build was started). Never raises, never waits on the build."""
    try:
        if _held_market() is not None:
            with _lock:
                due = time.time() - _market["checked"] >= CHECK_EVERY_S
            if not due:
                return "held"
            _start_market_job()
            return "checking"
        if _market_block() is not None:
            return "blocked"
        _start_market_job()
        return "building"
    except Exception:  # noqa: BLE001 -- a warm that fails is a warm that did nothing
        return "failed"


def _warm_loop() -> None:
    time.sleep(WARM_DELAY_S)
    while True:
        warm_market()
        time.sleep(WARM_EVERY_S)


def start_market_warmer(force: bool = False) -> bool:
    """Start the loop once, on the web service only (any other service that imports this module
    would repeat the same vendor reads for nobody). True when this call started it.

    Without it the list was built only when a member opened the short interest list, so a reader of
    one stock's row (`held_market_row`) found nothing most of the time, and nobody learned whether
    the data plan answers until a member looked. With it the first build runs a few minutes after
    boot and its one `[short-data] market list: ...` log line says what the vendor answered."""
    if _warm_started.is_set():
        return False
    if not force and os.environ.get("RAILWAY_SERVICE_NAME", "") != "web":
        return False
    _warm_started.set()
    threading.Thread(target=_warm_loop, daemon=True, name="short-data-warm").start()
    return True


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    with _lock:
        _refused.clear()
        _stock_done.clear()
        _stock_old.clear()
        _stock_inflight.clear()
        _market.update({"held": None, "loaded": False, "checked": 0.0, "check": None, "block": None, "inflight": None})
