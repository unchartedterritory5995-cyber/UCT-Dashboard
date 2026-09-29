"""Short interest + days-to-cover for a ticker.

Two sources, one shape, chosen per call by ``SHORT_INTEREST_SOURCE`` (TERM-046):

* ``yfinance`` (DEFAULT, unset, or any unrecognised value) — today's source,
  byte-for-byte: yfinance pulls FINRA-reported short interest from Yahoo
  Finance's quote summary endpoint (sharesShort, sharesShortPriorMonth,
  shortRatio, shortPercentOfFloat). Updates bi-monthly per FINRA cadence.
  If yfinance fails, returns graceful error so voice degrades cleanly.
  ``tests/test_short_interest_source.py`` holds this path to the exact JSON
  bytes the pre-TERM-046 code produced (a frozen golden, not a restatement).

* ``finviz`` — the owner ruling of 2026-09-29: short interest comes from
  Finviz, which the product already licenses (licensing register row T-48,
  class LA once answered). NO new request is made. The screener's nightly
  whole-market Elite export (``screener.finviz_universe.run_pull``, 02:45 ET,
  ONE ``export.ashx`` call, 90 s timeout) ALREADY carries ``Short Float``
  (c=30) and ``Short Ratio`` (c=31) beside ``Shares Float`` (c=25) and
  ``Shares Outstanding`` (c=24); this path reads that artifact. Nothing here
  touches the network, so nothing here needs a timeout of its own.

  Field by field, and what each one IS on this path:

  ``short_pct_of_float``   Finviz "Short Float", as served.
  ``days_to_cover``        Finviz "Short Ratio", as served.
  ``shares_short``         DERIVED: short_float_pct / 100 * float_shares. That
                           is Finviz's own definition of Short Float run
                           backwards; the export's c=84 "Short Interest" would
                           give it directly but is not requested today (the
                           screener's pull is not widened by a consumer). Its
                           precision is bounded by Short Float's 2 decimals.
  ``short_pct_of_shares_outstanding``  DERIVED: shares_short / shares_outstanding.
  ``shares_short_prior_month``  from THIS module's own dated history (below),
                           the row two settlements back — None until that
                           history exists. Never fabricated, never backfilled.
  ``crowded``              the same tiers as the yfinance path, but ``None``
                           when the short float is unknown. ⛔ An unknown short
                           float is NOT "low": the yfinance path's
                           ``crowded="low"`` for a missing value is kept there
                           only because that path must stay byte-identical.
  ``as_of``                ⛔ NEVER the pull date and never "today". The export
                           carries NO date column, so the date is INFERRED:
                           short interest is exchange-reported twice a month
                           for a FINRA settlement date (the 15th, or the
                           business day before it; the last business day of
                           the month) and disseminated after the close on the
                           7th business day after it. A settlement is taken as
                           the one the column represents once the pull is at
                           least 9 business days past it (one day for FINRA to
                           publish, one for Finviz to ingest). On the single
                           business day where it might or might not have
                           landed, ``as_of`` is None and ``as_of_candidates``
                           names both. ``as_of`` is epoch seconds (UTC
                           midnight of the settlement date) — the same type
                           Yahoo's ``dateShortInterest`` carries — with
                           ``as_of_date`` (ISO) and ``as_of_basis`` beside it.

History (``short_interest_history``, FB-A7-02). Finviz serves only the current
value. When the flag is on, the nightly pull appends one dated row per ticker
per settlement date to ``SHORT_INTEREST_HISTORY_DB_PATH`` — INSERT OR IGNORE,
first-write-wins, append-only, a pull whose settlement is ambiguous writes
nothing. It starts the first night the flag is on. Nothing is backfilled: a
series that begins on the arming date is the honest series.
"""

import calendar
import json
import logging
import os
import sqlite3
import threading
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import yfinance as yf

from api.services import yf_util
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)
_CACHE = TTLCache()
_CACHE_TTL = 3600  # 1 hour — short interest barely changes intraday

# ── the source flag (TERM-046) ───────────────────────────────────────────────

SOURCE_ENV = "SHORT_INTEREST_SOURCE"
SOURCE_YFINANCE = "yfinance"
SOURCE_FINVIZ = "finviz"
# ⭐ The mode table `feature_flag_index.mode_flags` reads by AST: default AND
# vocabulary as literals, in the expression the code itself falls back to.
SHORT_INTEREST_MODE_FLAGS = {
    "SHORT_INTEREST_SOURCE": (SOURCE_YFINANCE, (SOURCE_YFINANCE, SOURCE_FINVIZ)),
}
DEFAULT_SOURCE, SOURCES = SHORT_INTEREST_MODE_FLAGS[SOURCE_ENV]


def source() -> str:
    """The configured source, read per call. Anything unrecognised is TODAY'S
    source — a typo must never move a member-facing number to a new vendor."""
    raw = (os.environ.get(SOURCE_ENV) or "").strip().lower()
    return raw if raw in SOURCES else DEFAULT_SOURCE


def history_enabled() -> bool:
    """The dated history is recorded only while the Finviz source is armed —
    flag off writes nothing anywhere."""
    return source() == SOURCE_FINVIZ


def _fmt_int(v) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _fmt_pct(v) -> float | None:
    """Yahoo returns shortPercentOfFloat as fraction (0.0234 = 2.34%).
    Convert to percentage points."""
    try:
        return round(float(v) * 100.0, 2)
    except (TypeError, ValueError):
        return None


def _fmt_float(v) -> float | None:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _crowd_tier(pct: float) -> str:
    """The crowding tier for a KNOWN short-float percentage. One authority for
    the thresholds; each source decides what an UNKNOWN value means."""
    if pct >= 20:
        return "very_high"
    if pct >= 10:
        return "high"
    if pct >= 5:
        return "moderate"
    return "low"


def get_short_interest(ticker: str) -> dict[str, Any]:
    if source() == SOURCE_FINVIZ:
        return _get_short_interest_finviz(ticker)
    return _get_short_interest_yfinance(ticker)


def _get_short_interest_yfinance(ticker: str) -> dict[str, Any]:
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    cache_key = f"short::{sym}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        info = yf_util.bounded_call(lambda: yf.Ticker(sym).info, None)
        if info is None:
            raise RuntimeError("bounded yfinance call returned no data")
        info = info or {}
    except Exception as e:
        _log.warning("yfinance short interest failed for %s: %s", sym, e)
        return {"error": f"yfinance failed: {e}", "ticker": sym}

    shares_short = _fmt_int(info.get("sharesShort"))
    prior_month = _fmt_int(info.get("sharesShortPriorMonth"))
    short_ratio = _fmt_float(info.get("shortRatio"))   # days-to-cover
    short_pct_float = _fmt_pct(info.get("shortPercentOfFloat"))
    short_pct_outstanding = _fmt_pct(info.get("shortPercentOfShares"))

    change = None
    if shares_short is not None and prior_month and prior_month > 0:
        change = round((shares_short - prior_month) / prior_month * 100.0, 2)

    # Interpretation hint for voice. ⚠️ A missing/zero short float reads "low"
    # here — kept, because this path is held byte-identical (see module doc).
    crowded = _crowd_tier(short_pct_float) if short_pct_float else "low"

    if not any([shares_short, short_ratio, short_pct_float]):
        return {"ticker": sym, "error": "no short interest data available"}

    result = {
        "ticker": sym,
        "shares_short": shares_short,
        "shares_short_prior_month": prior_month,
        "shares_short_change_pct": change,
        "days_to_cover": short_ratio,
        "short_pct_of_float": short_pct_float,
        "short_pct_of_shares_outstanding": short_pct_outstanding,
        "crowded": crowded,
        "as_of": info.get("dateShortInterest"),
        "source": "yfinance / FINRA",
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result


# ── the FINRA settlement calendar (inference, labelled as such) ──────────────

_ET = ZoneInfo("America/New_York")
# FINRA disseminates short interest after the close on the 7th business day
# after the settlement date; Finviz is allowed one more business day to ingest.
_PUBLISH_LAG_BD = 7
_INGEST_LAG_BD = 1
AS_OF_BASIS = (
    "inferred, not read: the Finviz export carries no date column. Short interest "
    "is exchange-reported for a FINRA settlement date (the 15th or the business day "
    "before it; the last business day of the month) and disseminated after the close "
    "on the 7th business day after it; this is the newest settlement date at least "
    f"{_PUBLISH_LAG_BD + _INGEST_LAG_BD + 1} business days before the pull."
)


def _holidays() -> frozenset:
    try:
        from api.services.nyse_calendar import NYSE_HOLIDAYS_YYYYMMDD
        return NYSE_HOLIDAYS_YYYYMMDD
    except Exception:  # noqa: BLE001 — weekends-only is the honest fallback
        return frozenset()


def _is_business_day(d: date, holidays: frozenset) -> bool:
    return d.weekday() < 5 and int(d.strftime("%Y%m%d")) not in holidays


def _on_or_before_business_day(d: date, holidays: frozenset) -> date:
    while not _is_business_day(d, holidays):
        d -= timedelta(days=1)
    return d


def _add_business_days(d: date, n: int, holidays: frozenset) -> date:
    while n > 0:
        d += timedelta(days=1)
        if _is_business_day(d, holidays):
            n -= 1
    return d


def settlement_dates_before(d: date, n: int) -> list[date]:
    """The newest ``n`` FINRA settlement dates on or before ``d``, newest first."""
    hol = _holidays()
    out: list[date] = []
    y, m = d.year, d.month
    while len(out) < n:
        last = calendar.monthrange(y, m)[1]
        for s in (_on_or_before_business_day(date(y, m, last), hol),
                  _on_or_before_business_day(date(y, m, 15), hol)):
            if s <= d and s not in out:
                out.append(s)
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return sorted(out, reverse=True)[:n]


def infer_settlement(pulled_on: date) -> dict:
    """``{"settlement": date|None, "candidates": [older, newer] | []}``.

    ``settlement`` is set only when the pull is certainly past both FINRA's
    dissemination and Finviz's ingest of it. The one business day where the
    newest settlement may or may not be in the export yields ``None`` plus both
    candidates — an unknown date stays unknown rather than guessed.
    """
    hol = _holidays()
    cands = settlement_dates_before(pulled_on, 6)
    for i, s in enumerate(cands):
        certain = _add_business_days(s, _PUBLISH_LAG_BD + _INGEST_LAG_BD + 1, hol) <= pulled_on
        possible = _add_business_days(s, _PUBLISH_LAG_BD + _INGEST_LAG_BD, hol) <= pulled_on
        if certain:
            return {"settlement": s, "candidates": []}
        if possible:
            older = cands[i + 1] if i + 1 < len(cands) else None
            return {"settlement": None, "candidates": [c for c in (older, s) if c]}
    return {"settlement": None, "candidates": []}


def _today_et() -> date:
    """The one wall-clock read on this path (the pull-age check); a seam so a
    test is never a function of the day it runs."""
    return datetime.now(_ET).date()


def _epoch(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())


def _pulled_on_et(as_of_iso: str | None) -> date | None:
    if not as_of_iso:
        return None
    try:
        dt = datetime.fromisoformat(str(as_of_iso))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_ET).date()


# ── the Finviz artifact (read-only; the 02:45 ET job owns the fetch) ─────────

_SNAP_LOCK = threading.Lock()
_SNAP: dict = {"key": None, "snap": None}


def _load_finviz_snapshot() -> dict | None:
    """The whole-market artifact, parsed once per file version (path, mtime,
    size) and held in-process. None when it is absent, unreadable, not an
    object, or short — the same refusals ``finviz_universe.read_finviz_fields``
    makes, so this path never serves a failed pull as a market."""
    from api.services.screener import finviz_universe as fv
    path = fv._artifact_path()
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (path, st.st_mtime_ns, st.st_size)
    with _SNAP_LOCK:
        if _SNAP["key"] == key:
            return _SNAP["snap"]
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    rows = payload.get("rows") or {}
    if not isinstance(rows, dict) or len(rows) < fv._MIN_ROWS:
        return None
    snap = {
        "as_of": payload.get("as_of"),
        "missing_headers": set(payload.get("missing_headers") or ()),
        "rows": rows,
        "stale_days": fv._STALE_DAYS,
    }
    with _SNAP_LOCK:
        _SNAP["key"], _SNAP["snap"] = key, snap
    return snap


def _num(row: dict, col: str, missing: set):
    if col in missing:
        return None
    v = row.get(col)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _derive(row: dict, missing: set) -> dict:
    """The short-interest facts one artifact row supports. ``None`` = unknown;
    a real 0.0 stays 0.0."""
    pct = _num(row, "short_float_pct", missing)
    ratio = _num(row, "short_ratio", missing)
    flt = _num(row, "float_shares", missing)
    out_sh = _num(row, "shares_outstanding", missing)
    shares_short = int(round(pct / 100.0 * flt)) if pct is not None and flt is not None else None
    pct_out = (round(shares_short / out_sh * 100.0, 2)
               if shares_short is not None and out_sh else None)
    return {
        "short_float_pct": round(pct, 2) if pct is not None else None,
        "short_ratio": round(ratio, 2) if ratio is not None else None,
        "shares_short": shares_short,
        "short_pct_of_shares_outstanding": pct_out,
        "float_shares": flt,
        "shares_outstanding": out_sh,
    }


def fetch_finviz_short_interest(ticker: str):
    """One ticker's short interest off the Finviz artifact, in the D1 provider
    envelope. Raises ``ProviderTransient`` when the nightly pull has not landed
    (absent/short/unreadable artifact) and ``ProviderNotFound`` when the pull
    has nothing for this ticker; returns a ``ProviderResult`` otherwise, whose
    ``licensing_class`` is stamped from (finviz, short_interest)."""
    from api.services import provider_errors as pe
    from api.services.provider_licensing_class import licensing_class_for

    sym = (ticker or "").upper().strip()
    snap = _load_finviz_snapshot()
    if snap is None:
        raise pe.ProviderTransient("finviz whole-market artifact unavailable", vendor="finviz")
    row = snap["rows"].get(sym)
    if not isinstance(row, dict):
        raise pe.ProviderNotFound(f"{sym} not in the finviz export", vendor="finviz")
    facts = _derive(row, snap["missing_headers"])
    if facts["short_float_pct"] is None and facts["short_ratio"] is None:
        raise pe.ProviderNotFound(f"{sym}: finviz export carries no short columns",
                                  vendor="finviz")

    pulled_on = _pulled_on_et(snap["as_of"])
    inf = infer_settlement(pulled_on) if pulled_on else {"settlement": None, "candidates": []}
    settle = inf["settlement"]
    fetched_at = None
    try:
        fetched_at = datetime.fromisoformat(str(snap["as_of"])).timestamp()
    except (TypeError, ValueError):
        pass
    stale = False
    if pulled_on is not None:
        stale = (_today_et() - pulled_on).days > snap["stale_days"]
    value = dict(facts, settlement_date=settle.isoformat() if settle else None,
                 settlement_candidates=[c.isoformat() for c in inf["candidates"]],
                 pulled_at=snap["as_of"])
    prov = {"vendor": "finviz",
            "source_activity": "short_interest.fetch_finviz_short_interest",
            "source_observed_at": float(_epoch(settle)) if settle else None}
    if fetched_at is not None:
        # when the vendor was actually asked (the nightly pull), not "now"
        prov["fetched_at"] = fetched_at
    return pe.ProviderResult(
        value=value,
        provenance=pe.ProvenanceRecord(**prov),
        licensing_class=licensing_class_for("finviz", "short_interest"),
        # Not established as a delivery tier: the value's age is FINRA's
        # twice-monthly cadence. "stale" only when the PULL itself is old.
        freshness="stale" if stale else None,
    )


def _get_short_interest_finviz(ticker: str) -> dict[str, Any]:
    from api.services import provider_errors as pe

    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    try:
        res = fetch_finviz_short_interest(sym)
    except pe.ProviderNotFound:
        return {"ticker": sym, "error": "no short interest data available"}
    except Exception as e:  # noqa: BLE001 — degrade like the yfinance path
        _log.warning("finviz short interest failed for %s: %s", sym, e)
        return {"error": f"finviz failed: {e}", "ticker": sym}

    v = res.value
    settle = date.fromisoformat(v["settlement_date"]) if v["settlement_date"] else None
    prior = _prior_month_from_history(sym, settle) if settle else None
    change = None
    if v["shares_short"] is not None and prior and prior > 0:
        change = round((v["shares_short"] - prior) / prior * 100.0, 2)
    pct = v["short_float_pct"]
    derived = ["shares_short", "short_pct_of_shares_outstanding"]
    if prior is not None:
        derived.append("shares_short_prior_month")
    return {
        "ticker": sym,
        "shares_short": v["shares_short"],
        "shares_short_prior_month": prior,
        "shares_short_change_pct": change,
        "days_to_cover": v["short_ratio"],
        "short_pct_of_float": pct,
        "short_pct_of_shares_outstanding": v["short_pct_of_shares_outstanding"],
        # ⛔ unknown is never "low": no short float, no crowding verdict.
        "crowded": _crowd_tier(pct) if pct is not None else None,
        "as_of": _epoch(settle) if settle else None,
        "source": "finviz / exchange-reported short interest",
        "as_of_date": v["settlement_date"],
        "as_of_basis": AS_OF_BASIS,
        "as_of_candidates": v["settlement_candidates"],
        "pulled_at": v["pulled_at"],
        "derived_fields": derived,
        "licensing_class": res.licensing_class,
        "freshness": res.freshness,
    }


# ── dated history (append-only; recorded only while the flag is on) ──────────

_HIST_LOCK = threading.Lock()
_HIST_SCHEMA = """
CREATE TABLE IF NOT EXISTS short_interest_history (
    ticker            TEXT NOT NULL,
    settlement_date   TEXT NOT NULL,
    shares_short      INTEGER,
    short_float_pct   REAL,
    short_ratio       REAL,
    float_shares      REAL,
    shares_outstanding REAL,
    pulled_at         TEXT NOT NULL,
    source            TEXT NOT NULL,
    recorded_at       TEXT NOT NULL,
    PRIMARY KEY (ticker, settlement_date)
)
"""


def _history_db_path() -> str:
    return os.environ.get("SHORT_INTEREST_HISTORY_DB_PATH", "/data/short_interest_history.db")


def _history_connect() -> sqlite3.Connection:
    path = _history_db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(_HIST_SCHEMA)
    return conn


def record_history_from_artifact() -> dict:
    """Append one dated row per ticker for the settlement the current artifact
    represents. INSERT OR IGNORE — the first pull that observed a settlement
    wins, nothing is ever updated or deleted. An ambiguous settlement writes
    nothing. Called from the nightly Finviz job, never from a request."""
    snap = _load_finviz_snapshot()
    if snap is None:
        return {"recorded": 0, "skipped": "artifact_unavailable"}
    pulled_on = _pulled_on_et(snap["as_of"])
    inf = infer_settlement(pulled_on) if pulled_on else {"settlement": None, "candidates": []}
    settle = inf["settlement"]
    if settle is None:
        return {"recorded": 0, "skipped": "settlement_ambiguous",
                "candidates": [c.isoformat() for c in inf["candidates"]]}
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for sym, row in snap["rows"].items():
        if not isinstance(row, dict):
            continue
        f = _derive(row, snap["missing_headers"])
        if f["short_float_pct"] is None and f["short_ratio"] is None:
            continue
        rows.append((str(sym).upper(), settle.isoformat(), f["shares_short"],
                     f["short_float_pct"], f["short_ratio"], f["float_shares"],
                     f["shares_outstanding"], str(snap["as_of"]), SOURCE_FINVIZ, now))
    with _HIST_LOCK, closing(_history_connect()) as conn:
        before = conn.total_changes
        conn.executemany(
            "INSERT OR IGNORE INTO short_interest_history (ticker, settlement_date, "
            "shares_short, short_float_pct, short_ratio, float_shares, shares_outstanding, "
            "pulled_at, source, recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
        conn.commit()
        inserted = conn.total_changes - before
    return {"recorded": inserted, "already_present": len(rows) - inserted,
            "settlement_date": settle.isoformat(), "pulled_at": snap["as_of"]}


def get_short_interest_history(ticker: str) -> list[dict]:
    """The dated series recorded so far, oldest first. Empty until the flag has
    been on across at least one settlement — never synthesised."""
    sym = (ticker or "").upper().strip()
    if not sym or not os.path.exists(_history_db_path()):
        return []
    with closing(_history_connect()) as conn:
        cur = conn.execute(
            "SELECT settlement_date, shares_short, short_float_pct, short_ratio, pulled_at "
            "FROM short_interest_history WHERE ticker = ? ORDER BY settlement_date", (sym,))
        return [{"settlement_date": r[0], "shares_short": r[1], "short_float_pct": r[2],
                 "short_ratio": r[3], "pulled_at": r[4]} for r in cur.fetchall()]


def _prior_month_from_history(sym: str, settle: date) -> int | None:
    """Shares short at the settlement two steps before ``settle`` (a month
    back, the same horizon as Yahoo's sharesShortPriorMonth) — only if this
    module recorded it. None otherwise."""
    try:
        prior = settlement_dates_before(settle, 3)[2]
    except IndexError:
        return None
    try:
        if not os.path.exists(_history_db_path()):
            return None
        with closing(_history_connect()) as conn:
            r = conn.execute(
                "SELECT shares_short FROM short_interest_history "
                "WHERE ticker = ? AND settlement_date = ?", (sym, prior.isoformat())).fetchone()
    except sqlite3.Error:
        return None
    return int(r[0]) if r and r[0] is not None else None
