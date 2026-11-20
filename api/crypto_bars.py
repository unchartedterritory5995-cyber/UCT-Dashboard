"""crypto_bars.py — Bitcoin (BTC/USD) daily bars and a quote, from FMP ONLY.

WHY: the owner asked for a Bitcoin price (2026-11-19). The app had none it may show: Yahoo
crypto is class X in `provider_licensing_class` (never a member path) and Massive crypto is
not on the plan. FMP's `/stable/` price endpoints (the ones `index_bars` reads for the cash
indices) accept the pair symbol `BTCUSD` on the plan already paid for.

DARK: everything here is behind `CRYPTO_BARS_ENABLED` (unset or 0 = off, `admin` = admins
only, `1` = everyone the chart-data gate admits). Off, no route reaches this module's vendor
reads and `/api/bars/BTCUSD` answers exactly as it does today (the stock path, which has no
such stock). Whether FMP crypto may be shown to members is NOT recorded in the licensing
table (no `("fmp", "crypto")` row): that is the owner's fact, so the switch stays off until
he answers.

WHAT IS DIFFERENT FROM A STOCK OR AN INDEX, AND WHAT THIS MODULE DOES ABOUT IT
  * Bitcoin trades every day, all day. A daily bar here is one UTC calendar day and the
    series holds seven bars a week. No exchange calendar is read anywhere in this module.
  * A bar is SERVED keyed the way a stock's daily bar is: `t` is a 'YYYY-MM-DD' string (the
    UTC day; a week is keyed by its Friday and a month by its 1st, the stock resample's
    keys). Not the unix UTC midnight a cash index's daily bar carries: the chart treats
    every NUMERIC `t` as an intraday instant and shifts it to New York time
    (StockChart `adjustTime`), which would label each Bitcoin day as the evening before.
    Held and stored rows keep the unix UTC midnight; `_label` turns it into the key.
  * "Is the newest bar still forming" is the bar's own UTC day (week, month) against the
    clock, not the NYSE session (`routers/bars._augment_with_bar_close_state` would call a
    Saturday bar settled and today's bar settled until 9:30 ET).
  * No vendor but FMP is ever asked. There is no fallback: a refresh that gets nothing keeps
    the stored copy and says so (`refresh_state: "failed"`), and with nothing stored the
    answer is empty and says why.
  * No request builds the series. A stored copy is served as it is and refreshed in the
    background (one job per pair at a time); with nothing stored the request kicks that job
    and answers "warming".

WHAT IS HELD: one entry per pair, in this process and on disk
(`<DATA_DIR>/crypto_bars_cache/<PAIR>_D.json`): `{saved_at, full_at, series}`. The first
build pages the whole history; after that a refresh reads only the newest days and merges
them, and the whole history is read again once a week.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

#: The name a member is shown for where the price comes from.
SOURCE = "FMP"

#: THE PAIRS SERVED. One line per pair: the symbol a member types -> the symbol FMP is asked
#: for, the names shown, and the oldest day asked of the vendor. Explicit on purpose: `BTC`
#: alone is a real fund ticker and must keep meaning the fund, so nothing here is matched by
#: shape (`BTC`, `BTC-USD`, `BTCUSDT`, `X:BTCUSD` are not pairs).
PAIRS: Dict[str, Dict[str, str]] = {
    "BTCUSD": {"fmp": "BTCUSD", "name": "Bitcoin", "base": "BTC", "quote": "USD",
               "history_start": "2010-07-01"},
}

#: The timeframes a pair is served on. Weekly and monthly are sums of the daily rows held
#: here (no second vendor read). Intraday is not served: the time zone of FMP's intraday
#: crypto timestamps has not been checked, and a bar on the wrong hour is not a bar.
DAILY_TFS = ("D", "W", "M")

DAY_S = 86400
#: The span of one FMP history call (about 1,100 rows; a 5-year index page is about 1,260).
PAGE_DAYS = 365 * 3
#: Two consecutive daily bars further apart than this are a hole in the vendor's answer. The
#: series served is the newest run WITHOUT one (older rows are dropped, never bridged), and a
#: series whose newest bar is older than this is not Bitcoin's chart today: not served.
MAX_GAP_DAYS = 3
#: A refresh of a held series re-reads this many days before its newest bar and merges them.
TAIL_OVERLAP_DAYS = 7
#: Older than this, a held daily copy is served as it is and refreshed in the background.
TTL_S = 300
#: The whole history is read again this often (a vendor may restate old rows).
FULL_REFRESH_S = 7 * DAY_S
#: After a refresh that got nothing, the next one is not tried for this long.
RETRY_S = 60
FMP_TIMEOUT_S = 10

#: A held quote older than this is read again (one read at a time, off the request thread).
QUOTE_TTL_S = 15
#: With no quote held, a request waits at most this long for the background read to land.
QUOTE_FIRST_WAIT_S = 2.0
# A quote past its hold: how long a request waits for the read it started (or joined) before it
# answers with the price held, marked "stale". Bounded, so a slow vendor costs a caller at most
# this, and a vendor that just failed is not waited on at all (`RETRY_S`).
QUOTE_STALE_WAIT_S = 1.0
QUOTE_TIMEOUT_S = 5

_DATA_DIR = os.environ.get("DATA_DIR", "/data")
_DISK_DIR = os.path.join(_DATA_DIR, "crypto_bars_cache")

_now = time.time                      # the serve clock (tests pin it)
_lock = threading.Lock()
_held: Dict[str, dict] = {}           # pair -> {saved_at, full_at, series}
_failed_at: Dict[str, float] = {}     # pair -> unix s of the newest refresh that got nothing
_inflight: set = set()
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="crypto-bars")

_quotes: Dict[str, dict] = {}         # pair -> the quote payload last read
_quote_failed_at: Dict[str, float] = {}
_quote_inflight: Dict[str, threading.Event] = {}


# ── the pair table and the switch ───────────────────────────────────────────────────────

def normalize(symbol) -> str:
    return symbol.strip().upper() if isinstance(symbol, str) else ""


def is_pair(symbol) -> bool:
    """Is this EXACTLY one of the pairs in `PAIRS` (any case, outer spaces ignored)?"""
    return normalize(symbol) in PAIRS


def mode() -> str:
    """`CRYPTO_BARS_ENABLED`, read per call (no restart to flip): "on" for the literal 1,
    "admin" for admin, and "off" for everything else (unset, 0, a typo): it fails closed."""
    raw = os.environ.get("CRYPTO_BARS_ENABLED", "0").strip().lower()
    return "on" if raw == "1" else "admin" if raw == "admin" else "off"


def enabled() -> bool:
    return mode() != "off"


def allowed(user) -> bool:
    """May THIS caller read a pair? `user` is what the chart-data gate
    (`bars_auth.require_bars_access`) returned, so the caller is already a paid member, an
    admin, or a trusted service. Off: nobody. `admin`: an admin account only (a service
    caller carries no role and is not one). On: everyone that gate admitted."""
    m = mode()
    if m == "off" or not isinstance(user, dict):
        return False
    if m == "admin":
        return user.get("role") == "admin"
    return True


def pairs_public() -> List[dict]:
    """The table as a member's client reads it (no vendor symbol)."""
    return [{"symbol": sym, "name": p["name"], "base": p["base"], "quote": p["quote"]}
            for sym, p in PAIRS.items()]


# ── the vendor read (FMP only) ──────────────────────────────────────────────────────────

def _utc_today(now: Optional[float] = None) -> _dt.date:
    return _dt.datetime.fromtimestamp(_now() if now is None else now, _dt.timezone.utc).date()


def _utc_midnight(d: _dt.date) -> int:
    return int(_dt.datetime(d.year, d.month, d.day, tzinfo=_dt.timezone.utc).timestamp())


def _date_of(t) -> _dt.date:
    return _dt.datetime.fromtimestamp(int(t), _dt.timezone.utc).date()


def _num(v) -> Optional[float]:
    """A finite number, or None. Never a default: a field the vendor did not send is absent."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _parse_rows(raw, start: _dt.date, end: _dt.date) -> Dict[_dt.date, dict]:
    """FMP end-of-day rows -> {UTC date: bar}. A row that does not parse completely, has a
    price that is not above zero, or lies outside the span asked is DROPPED, never repaired."""
    out: Dict[_dt.date, dict] = {}
    for r in raw if isinstance(raw, list) else []:
        try:
            d = _dt.date.fromisoformat(str(r["date"])[:10])
            o, h, l, c = (float(r[k]) for k in ("open", "high", "low", "close"))
            v_raw = r.get("volume")
            v = float(v_raw) if v_raw is not None else 0.0
        except (KeyError, ValueError, TypeError, AttributeError):
            continue
        if not all(math.isfinite(x) and x > 0 for x in (o, h, l, c)):
            continue
        if h < l or not math.isfinite(v) or v < 0 or not (start <= d <= end):
            continue
        out[d] = {"t": _utc_midnight(d), "o": o, "h": h, "l": l, "c": c, "v": v}
    return out


def _read_span(pair: str, start: _dt.date, end: _dt.date) -> Optional[Dict[_dt.date, dict]]:
    """Every daily row FMP has for `pair` from `start` to `end`, paged oldest first. None
    when ANY page fails (the caller keeps what it holds); an empty page is not a failure
    (the pair may not have traded yet), and what it leaves is judged by `_newest_run`."""
    from api.services import fmp_client
    fmp_symbol = PAIRS[pair]["fmp"]
    one = _dt.timedelta(days=1)
    page = _dt.timedelta(days=PAGE_DAYS)
    by_date: Dict[_dt.date, dict] = {}
    f = start
    while f <= end:
        t_end = min(end, f + page - one)
        try:
            raw = fmp_client.get_crypto_history_eod_full(
                fmp_symbol, f.isoformat(), t_end.isoformat(), timeout=FMP_TIMEOUT_S).value
        except fmp_client.FMPNotFound:
            raw = []
        except Exception as e:                    # noqa: BLE001 - recorded, the copy held stays
            logger.warning("[crypto_bars] FMP daily %s %s..%s failed: %s", pair, f, t_end,
                           type(e).__name__)
            return None
        if not isinstance(raw, list):             # a refused endpoint answers no list
            logger.warning("[crypto_bars] FMP daily %s %s..%s: no list", pair, f, t_end)
            return None
        by_date.update(_parse_rows(raw, start, end))
        f = t_end + one
    return by_date


def _newest_run(by_date: Dict[_dt.date, dict], today: _dt.date) -> List[dict]:
    """The newest stretch of daily bars with no hole (`MAX_GAP_DAYS`), oldest first. []
    when the newest bar itself is older than that: a series that stopped is not served."""
    dates = sorted(by_date)
    if not dates or (today - dates[-1]).days > MAX_GAP_DAYS:
        return []
    first = len(dates) - 1
    while first > 0 and (dates[first] - dates[first - 1]).days <= MAX_GAP_DAYS:
        first -= 1
    if first > 0:
        logger.warning("[crypto_bars] daily rows before %s are across a hole (%s -> %s): "
                       "not served", dates[first], dates[first - 1], dates[first])
    return [by_date[d] for d in dates[first:]]


def _build(pair: str, held: Optional[dict], now: float) -> Optional[dict]:
    """A new entry for `pair`, or None (the vendor gave nothing usable). The whole history
    when nothing is held or the held copy's full read is old; otherwise the newest days,
    merged onto the held series."""
    today = _utc_today(now)
    start = _dt.date.fromisoformat(PAIRS[pair]["history_start"])
    series = (held or {}).get("series") or []
    full_at = float((held or {}).get("full_at") or 0)
    whole = not series or now - full_at > FULL_REFRESH_S
    if not whole:
        last = _date_of(series[-1]["t"])
        whole = (today - last).days > PAGE_DAYS // 2      # too far behind for a tail read
    if whole:
        by_date = _read_span(pair, start, today)
        full_at = now
    else:
        tail = _read_span(pair, max(start, last - _dt.timedelta(days=TAIL_OVERLAP_DAYS)), today)
        if tail is None:
            return None
        by_date = {_date_of(b["t"]): b for b in series}
        by_date.update(tail)
    if by_date is None:
        return None
    run = _newest_run(by_date, today)
    if not run:
        return None
    return {"saved_at": now, "full_at": full_at, "series": run}


# ── the store ───────────────────────────────────────────────────────────────────────────

def _disk_path(pair: str) -> str:
    return os.path.join(_DISK_DIR, f"{pair}_D.json")


def _load_disk(pair: str) -> Optional[dict]:
    try:
        with open(_disk_path(pair), "r", encoding="utf-8") as fh:
            entry = json.load(fh)
    except FileNotFoundError:
        return None
    except Exception as e:                        # noqa: BLE001 - an unreadable copy is no copy
        logger.warning("[crypto_bars] disk load failed %s: %s", pair, type(e).__name__)
        return None
    if not isinstance(entry, dict) or not isinstance(entry.get("series"), list) or not entry["series"]:
        return None
    return entry


def _save_disk(pair: str, entry: dict) -> None:
    try:
        os.makedirs(_DISK_DIR, exist_ok=True)
        tmp = _disk_path(pair) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(entry, fh, separators=(",", ":"))
        os.replace(tmp, _disk_path(pair))
    except Exception as e:                        # noqa: BLE001 - memory still holds it
        logger.warning("[crypto_bars] disk save failed %s: %s", pair, type(e).__name__)


def _entry(pair: str) -> Optional[dict]:
    """The copy this process holds for `pair` (memory, then disk), or None. No vendor call."""
    with _lock:
        e = _held.get(pair)
    if e:
        return e
    e = _load_disk(pair)
    if e:
        with _lock:
            _held.setdefault(pair, e)
            return _held[pair]
    return None


def _refresh(pair: str) -> bool:
    """One vendor read for `pair` -> memory + disk. False when it got nothing (recorded and
    logged by name; the copy held stays in place)."""
    now = _now()
    try:
        entry = _build(pair, _entry(pair), now)
    except Exception as e:                        # noqa: BLE001 - never out of a worker thread
        logger.warning("[crypto_bars] refresh %s raised %s", pair, type(e).__name__)
        entry = None
    if not entry:
        _failed_at[pair] = now
        logger.warning("[crypto_bars] refresh FAILED %s: FMP gave no usable daily series; "
                       "%s", pair, "the stored copy stays" if _entry(pair) else "nothing is stored")
        return False
    with _lock:
        _held[pair] = entry
    _save_disk(pair, entry)
    _failed_at.pop(pair, None)
    return True


def _kick(pair: str) -> bool:
    """Start the ONE background refresh for `pair` unless one is running. True if started."""
    with _lock:
        if pair in _inflight:
            return False
        _inflight.add(pair)

    def _job():
        try:
            _refresh(pair)
        finally:
            with _lock:
                _inflight.discard(pair)
    try:
        _pool.submit(_job)
        return True
    except Exception:                             # noqa: BLE001 - a pool that is shutting down
        with _lock:
            _inflight.discard(pair)
        return False


def _refresh_due(pair: str, saved_at, now: float) -> bool:
    failed = _failed_at.get(pair)
    if failed is not None and now - failed < RETRY_S:
        return False
    return saved_at is None or now - float(saved_at) > TTL_S


# ── serve ───────────────────────────────────────────────────────────────────────────────

def _bucket_start(tf: str, d: _dt.date) -> _dt.date:
    if tf == "W":
        return d - _dt.timedelta(days=d.weekday())        # the week's Monday (UTC)
    if tf == "M":
        return d.replace(day=1)
    return d


def _bucket_end(tf: str, start: _dt.date) -> _dt.date:
    if tf == "W":
        return start + _dt.timedelta(days=7)
    if tf == "M":
        return (start.replace(day=28) + _dt.timedelta(days=4)).replace(day=1)
    return start + _dt.timedelta(days=1)


def bucket_bounds(tf: str, t) -> Optional[Tuple[int, int]]:
    """[start, end) in unix seconds of the UTC day / week / month the bar keyed `t` covers."""
    if tf not in DAILY_TFS or isinstance(t, bool) or not isinstance(t, (int, float)):
        return None
    start = _bucket_start(tf, _date_of(t))
    return _utc_midnight(start), _utc_midnight(_bucket_end(tf, start))


def _label(tf: str, t) -> str:
    """The key a served bar carries: 'YYYY-MM-DD' of the UTC day (D), of the FRIDAY of the
    Monday-to-Sunday week (W), or of the month's 1st (M). `t` is the bucket's first UTC
    midnight. The same keys `bars_fetch._resample_weekly_iso` / `_resample_monthly_iso`
    give a stock, so every weekly and monthly reader on the chart lines up."""
    d = _date_of(t)
    if tf == "W":
        d = d + _dt.timedelta(days=4)
    return d.isoformat()


def _aggregate(series: List[dict], tf: str) -> List[dict]:
    """Daily bars -> weekly (Monday to Sunday, UTC) or monthly bars, keyed at the bucket's
    first UTC midnight. Arithmetic on the rows held; nothing is asked of a vendor."""
    if tf == "D":
        return series
    out: List[dict] = []
    for b in series:
        key = _utc_midnight(_bucket_start(tf, _date_of(b["t"])))
        if out and out[-1]["t"] == key:
            cur = out[-1]
            cur["h"] = max(cur["h"], b["h"])
            cur["l"] = min(cur["l"], b["l"])
            cur["c"] = b["c"]
            cur["v"] += b["v"]
        else:
            out.append({"t": key, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]})
    return out


def _withhold_ended_partial(series: List[dict], saved_at, now: float) -> List[dict]:
    """`series` without a newest daily bar that was still forming when the copy was stored and
    whose day has ended since: its close is a print from mid-day, and the settled bar comes
    with the next refresh (the rule `index_bars._settled_partial_withheld` applies intraday)."""
    if not series or saved_at is None:
        return series
    end = int(series[-1]["t"]) + DAY_S
    if float(saved_at) < end <= now:
        return series[:-1]
    return series


def _parse_since(since) -> Optional[str]:
    """`since=` as a bar key to compare served keys against, else None. The chart sends the
    key of the newest bar it holds ('YYYY-MM-DD'); a unix time (seconds or milliseconds) is
    read as the UTC day it falls in."""
    if isinstance(since, bool) or since in (None, ""):
        return None
    text = str(since).strip()
    try:
        return _dt.date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        pass
    try:
        s = int(text)
    except ValueError:
        return None
    if s <= 0:
        return None
    try:
        return _date_of(s // 1000 if s > 10_000_000_000 else s).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _parse_to(to) -> Optional[int]:
    """`to=YYYY-MM-DD` as the unix second that day ends (UTC), else None."""
    if not isinstance(to, str) or not to.strip():
        return None
    try:
        return _utc_midnight(_dt.date.fromisoformat(to.strip()[:10])) + DAY_S
    except ValueError:
        return None


def _state(pair: str, saved_at, now: float) -> str:
    failed = _failed_at.get(pair)
    if failed is not None and (saved_at is None or failed >= float(saved_at)):
        return "failed"
    if saved_at is None or now - float(saved_at) > TTL_S:
        return "stale"
    return "fresh"


def serve_bars(symbol, tf="D", bars=200, since=None, to=None) -> Tuple[int, dict]:
    """(HTTP status, body) for one pair's bars. The caller has already checked the pair and
    the switch. Never raises and never waits on the vendor.

      200 bars            the series (possibly a `since=` delta), with `source`,
                          `refreshed_at`, `refresh_state`, `newest_bar_is_forming` and the bar
                          contract's identity fields;
      200 no_data         a timeframe not served for a pair (`timeframe_not_carried`), or
                          nothing stored and the newest read got nothing (`no_provider_data`);
      503 error: warming  nothing stored yet and the one background build is running: ask again.
    """
    pair = normalize(symbol)
    tf_s = tf if isinstance(tf, str) else "D"
    head = {"ticker": pair, "tf": tf_s}
    if tf_s not in DAILY_TFS:
        return 200, {**head, "bars": [], "no_data": True, "reason": "timeframe_not_carried",
                     "source": SOURCE}
    now = _now()
    entry = _entry(pair)
    saved_at = entry.get("saved_at") if entry else None
    if _refresh_due(pair, saved_at, now):
        _kick(pair)
    if not entry:
        with _lock:
            building = pair in _inflight
        if building:
            return 503, {**head, "bars": [], "error": "warming"}
        entry = _entry(pair)                      # the build may have landed just now
        if not entry:
            return 200, {**head, "bars": [], "no_data": True, "reason": "no_provider_data",
                         "source": SOURCE, "refreshed_at": None, "refresh_state": "failed"}
        saved_at = entry.get("saved_at")
    daily = _withhold_ended_partial(entry["series"], saved_at, now)
    to_s = _parse_to(to)
    if to_s is not None:
        daily = [b for b in daily if b["t"] < to_s]
    buckets = _aggregate(daily, tf_s)
    bounds = bucket_bounds(tf_s, buckets[-1]["t"]) if buckets else None
    out = [{**b, "t": _label(tf_s, b["t"])} for b in buckets]
    newest = out[-1] if out else None
    since_s = _parse_since(since)
    if since_s is not None:
        out = [b for b in out if b["t"] > since_s]
    try:
        limit = max(1, int(bars))
    except (TypeError, ValueError):
        limit = 200
    if len(out) > limit:
        out = out[-limit:]
    forming = bool(bounds and bounds[0] <= now < bounds[1])
    body = {**head, "bars": out, "source": SOURCE,
            "refreshed_at": float(saved_at) if saved_at else None,
            "refresh_state": _state(pair, saved_at, now),
            "newest_bar_is_forming": forming if newest else None}
    if since_s is not None:
        body["delta"] = True
    body.update(_contract_fields(pair, tf_s, newest if forming else None, now))
    return 200, body


def _contract_fields(pair: str, tf: str, developing: Optional[dict], now: float) -> dict:
    """The bar contract's fields for an answer that is NOT backed by bars.db (the shape
    `bar_contract.compute(store_backed=False)` gives an index): identity only, no proofs.
    `developing` is the newest bar when its own UTC bucket contains now; the contract's own
    rule reads the NYSE session and would be wrong on a weekend and before 9:30 ET."""
    try:
        from api.services import bar_contract as _bc
        version, key, grid = _bc.CONTRACT_VERSION, _bc.cache_key(pair, tf, None), _bc.grid_for(tf, None)
    except Exception:                             # noqa: BLE001 - identity fields never break a serve
        return {}
    dev = None
    if developing:
        dev = {k: developing.get(k) for k in ("t", "o", "h", "l", "c", "v")}
        dev["rev"] = int(now * 1000)
    return {"contract": version, "grid": grid, "session": None, "cache_key": key,
            "series_rev": None, "history_rev": None, "verified_through": None,
            "sealed_through": None, "complete_through": None, "developing": dev,
            "adj_basis": None}


# ── the quote ───────────────────────────────────────────────────────────────────────────

def _read_quote(pair: str, now: float) -> Optional[dict]:
    """One FMP quote read -> the payload, or None (refused, failed, or no usable price)."""
    from api.services import fmp_client
    try:
        res = fmp_client.get_crypto_quote(PAIRS[pair]["fmp"], timeout=QUOTE_TIMEOUT_S)
    except Exception as e:                        # noqa: BLE001 - recorded by the caller
        logger.warning("[crypto_bars] FMP quote %s failed: %s", pair, type(e).__name__)
        return None
    rows = res.value
    q = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    price = _num(q.get("price")) if q else None
    if price is None or price <= 0:
        return None
    p = PAIRS[pair]
    as_of = _num(res.provenance.source_observed_at)
    return {"symbol": pair, "name": p["name"], "base": p["base"], "quote": p["quote"],
            "price": price, "change": _num(q.get("change")),
            "change_pct": _num(q.get("changePercentage")),
            "open": _num(q.get("open")), "day_high": _num(q.get("dayHigh")),
            "day_low": _num(q.get("dayLow")), "prev_close": _num(q.get("previousClose")),
            "year_high": _num(q.get("yearHigh")), "year_low": _num(q.get("yearLow")),
            "volume": _num(q.get("volume")),
            "as_of": as_of, "fetched_at": now, "source": SOURCE}


def _spawn(job) -> None:
    """Run `job` off the request thread (tests replace this to run it where they choose)."""
    threading.Thread(target=job, name="crypto-quote", daemon=True).start()


def _kick_quote(pair: str) -> threading.Event:
    """Start the one background quote read for `pair` unless one runs; the event it sets."""
    with _lock:
        ev = _quote_inflight.get(pair)
        if ev is not None:
            return ev
        ev = _quote_inflight[pair] = threading.Event()

    def _job():
        try:
            now = _now()
            q = _read_quote(pair, now)
            with _lock:
                if q:
                    _quotes[pair] = q
                    _quote_failed_at.pop(pair, None)
                else:
                    _quote_failed_at[pair] = now
        finally:
            with _lock:
                _quote_inflight.pop(pair, None)
            ev.set()
    try:
        _spawn(_job)
    except Exception:                             # noqa: BLE001
        with _lock:
            _quote_inflight.pop(pair, None)
        ev.set()
    return ev


def quote(symbol) -> dict:
    """The quote for one pair, with `state`: "fresh" (read within `QUOTE_TTL_S`), "stale"
    (older: the read this call started or joined did not land within `QUOTE_STALE_WAIT_S`),
    "failed" (the newest read got nothing; `price` is the
    last one read, or None when there has never been one) or "warming" (the first read has
    not landed yet). `as_of` is the vendor's own time for the price, never this server's."""
    pair = normalize(symbol)
    now = _now()
    with _lock:
        held = _quotes.get(pair)
    failed = _quote_failed_at.get(pair)
    age = None if not held else now - float(held.get("fetched_at") or 0)
    retry_ok = failed is None or now - failed >= RETRY_S
    if (held is None or age > QUOTE_TTL_S) and retry_ok:
        ev = _kick_quote(pair)
        ev.wait(QUOTE_FIRST_WAIT_S if held is None else QUOTE_STALE_WAIT_S)
        with _lock:
            held = _quotes.get(pair)
        failed = _quote_failed_at.get(pair)
        age = None if not held else now - float(held.get("fetched_at") or 0)
    if held is None:
        p = PAIRS[pair]
        return {"symbol": pair, "name": p["name"], "base": p["base"], "quote": p["quote"],
                "price": None, "as_of": None, "fetched_at": None, "source": SOURCE,
                "state": "failed" if failed is not None else "warming"}
    if failed is not None and failed >= float(held.get("fetched_at") or 0):
        state = "failed"
    else:
        state = "fresh" if age is not None and age <= QUOTE_TTL_S else "stale"
    return {**held, "state": state}


def _reset_for_tests() -> None:
    with _lock:
        _held.clear()
        _inflight.clear()
        _quotes.clear()
        _quote_inflight.clear()
    _failed_at.clear()
    _quote_failed_at.clear()
