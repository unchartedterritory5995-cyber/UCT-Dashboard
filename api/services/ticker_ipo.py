"""Per-ticker IPO / first-listing date, and the corroborated FIRST-TRADE date.

Source: Massive/Polygon `v3/reference/tickers` `list_date` (via
`massive.get_ticker_details`) — the SAME provider the chart's bars come from, so
the listing date the chart compares its first bar against is consistent with the
tape. `list_date` is the official first-listing day and never changes, so this is
cached aggressively (in-memory TTLCache + disk JSON under DATA_DIR, 30-day TTL).

Never raises — returns {"list_date": None} on any failure (and does NOT cache a
null, so a transient provider miss self-heals on the next view).

──────────────────────────────────────────────────────────────────────────────
⭐ `first_trade_date` — WHAT THE CHART'S LISTING STATEMENT COMPARES AGAINST
──────────────────────────────────────────────────────────────────────────────
Ruling R-W (`app/src/components/chart/engine/listingSeed.js`) is EXACT: a daily
series is "from the listing" only when its first bar is dated ON the reference
day. That exactness is untouched here. What this corrects is the REFERENCE DATE,
never the comparison: no tolerance is added anywhere.

Polygon's `list_date` for an ETF is the fund's inception, a few days BEFORE its
first session. Measured on production 2026-10-04: SPY `1993-01-22` against a
first daily bar of `1993-01-29` (the same bar 0 TradingView records), IWM
`2000-05-22` against `2000-05-26`, DIA `1998-01-13` against `1998-01-20`. So a
series that DOES start at the symbol's first session could never equal it, and
every off-listing recurrence on those names stayed withheld.

`first_trade_date` = the earliest bar of the deep daily history (the same
`bars_fetch._fetch_daily(..., deep=True)` path a member's deep chart reads), but
ONLY when ALL of these hold — otherwise it is `list_date`, exactly as before:

  (a) the deep read is EXHAUSTED — it returned fewer bars than requested, so the
      provider holds no earlier bar to have missed;
  (b) the earliest bar is strictly AFTER `list_date`;
  (c) it is no more than `_MAX_GAP_DAYS` (14) calendar days after `list_date` —
      an inception-to-first-trade week, not missing history. QQQ (`list_date`
      1999-03-10, provider history from 2006) fails this, which is correct.

Optional third check (pod only, needs `FMP_API_KEY`): ONE windowed FMP
`historical-price-eod` read from `list_date` to `list_date + 20d`, bounded by a
timeout. If FMP returns bars and its earliest DIFFERS from ours, REFUSE (fall back
to `list_date`). If it returns nothing, fails or times out, it is ignored.

⛔ WHY THERE IS NO "SECOND SOURCE" CORROBORATION. The bars layer's pre-2003 daily
history IS yfinance (`bars_fetch.py`: "Massive/Polygon's daily floor is
2003-09-10", older bars merged from yfinance `period=max`). Comparing it against
yfinance would compare yfinance with itself and pass trivially for exactly the
names this exists for. FMP is the only independent check, and it is optional.

⚠️ RESIDUAL RISK, stated rather than hidden: a name whose ONLY deep source starts a
few sessions LATE (inside the 14-day window, and with no FMP answer to refuse it)
gets a false listing. A false listing seeds a recurrence from the wrong bar and
can draw WRONG values where the bounded window would have drawn nothing. The
window is what keeps that case small; it does not make it impossible.

⛔ OFF THE REQUEST PATH. A cache miss returns `list_date` with
`first_trade_final: false` IMMEDIATELY and kicks ONE deduped background resolve on
a single worker thread (a cold post-deploy wave of misses each doing a deep bars
read plus a vendor call on the request path is the 2026-07-01 threadpool-pinning
outage class). Once resolved the answer is served with `first_trade_final: true`
and cached durably like `list_date`. The client (`useTickerIpo`) persists only a
final answer.
"""
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from api.services.cache import TTLCache

_logger = logging.getLogger(__name__)
_mem = TTLCache()
_TTL = 86400 * 30  # 30d — list_date is immutable; long cache is safe
_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "ticker_ipo_cache")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The deep daily request. MUST match the chart's `fullBarsFor('D')`
# (`app/src/utils/barsBackfill.js`) and `deep_history_warm._DEEP_TARGET['D']`:
# "exhausted" means the provider returned fewer bars than THIS.
_DEEP_REQUEST_BARS = 12500
_MAX_GAP_DAYS = 14
_FMP_WINDOW_DAYS = 20
_FMP_TIMEOUT_S = 8
# A resolve that could not reach a decision (the deep read failed) is retried no
# sooner than this, so a broken provider cannot be hammered by every chart open.
_RETRY_AFTER_S = 3600

# ONE worker: resolves are rare (once per ticker per 30 days) and must never fan out.
_RESOLVE_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ticker-ipo-resolve")
_inflight: set = set()
_failed_at: dict = {}
_lock = threading.Lock()


def _disk_path(ticker: str) -> str:
    return os.path.join(_CACHE_DIR, os.path.basename(f"{ticker}.json"))


def _disk_get(ticker: str):
    try:
        p = _disk_path(ticker)
        if time.time() - os.path.getmtime(p) > _TTL:
            return None
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _disk_put(ticker: str, data: dict) -> None:
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        tmp = _disk_path(ticker) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, _disk_path(ticker))
    except Exception as e:
        _logger.warning("ticker_ipo disk write failed for %s: %s", ticker, e)


def _iso_day(v):
    """A bar key or provider date as `YYYY-MM-DD`, or None."""
    if not isinstance(v, str):
        return None
    d = v.strip()[:10]
    return d if _ISO.match(d) else None


def first_trade_decision(list_date, earliest, served, requested, fmp_earliest=None):
    """THE RULE (see the module docstring), as a pure function.

    Returns the reference date: `earliest` only when every condition holds,
    otherwise `list_date` unchanged."""
    if not list_date or not earliest:
        return list_date
    if not (isinstance(served, int) and isinstance(requested, int) and served < requested):
        return list_date                                   # (a) not exhausted
    if not (earliest > list_date):
        return list_date                                   # (b) not after list_date
    try:
        gap = (date.fromisoformat(earliest) - date.fromisoformat(list_date)).days
    except ValueError:
        return list_date
    if gap > _MAX_GAP_DAYS:
        return list_date                                   # (c) a history gap, not a first week
    if fmp_earliest is not None and fmp_earliest != earliest:
        return list_date                                   # an independent source disagrees
    return earliest


def _deep_daily_earliest(sym: str):
    """(earliest ISO day, bars served) from the deep daily path, or (None, None)."""
    try:
        from api.services import bars_fetch
        bars = bars_fetch._fetch_daily(sym, _DEEP_REQUEST_BARS, deep=True) or []
    except Exception as e:
        _logger.warning("ticker_ipo deep daily read failed for %s: %s", sym, e)
        return None, None
    days = [d for d in (_iso_day(b.get("t")) for b in bars if isinstance(b, dict)) if d]
    if not days:
        return None, None
    return min(days), len(bars)


def _fmp_earliest(sym: str, list_date: str):
    """FMP's earliest daily bar in [list_date, list_date + 20d], or None (ignored)."""
    if not os.environ.get("FMP_API_KEY"):
        return None
    try:
        from api.services import fmp_client
        to = (date.fromisoformat(list_date) + timedelta(days=_FMP_WINDOW_DAYS)).isoformat()
        res = fmp_client.get_historical_price_eod_light(
            sym, list_date, to, timeout=_FMP_TIMEOUT_S)
        rows = getattr(res, "value", None)
        if not isinstance(rows, list):
            return None
        days = [d for d in (_iso_day(r.get("date")) for r in rows if isinstance(r, dict)) if d]
        return min(days) if days else None
    except Exception:
        return None


def _resolve_first_trade(sym: str, list_date: str):
    """The final payload, or None when no decision could be reached."""
    earliest, served = _deep_daily_earliest(sym)
    if earliest is None:
        return None
    fmp = None
    if served is not None and served < _DEEP_REQUEST_BARS and earliest > list_date:
        fmp = _fmp_earliest(sym, list_date)
    ftd = first_trade_decision(list_date, earliest, served, _DEEP_REQUEST_BARS, fmp)
    return {"symbol": sym, "list_date": list_date,
            "first_trade_date": ftd, "first_trade_final": True}


def _run_resolve(sym: str, list_date: str) -> None:
    try:
        out = _resolve_first_trade(sym, list_date)
        if out is None:
            with _lock:
                _failed_at[sym] = time.time()
            return
        _mem.set(f"ticker_ipo_{sym}", out, ttl=_TTL)
        _disk_put(sym, out)
    except Exception as e:
        _logger.warning("ticker_ipo first-trade resolve failed for %s: %s", sym, e)
        with _lock:
            _failed_at[sym] = time.time()
    finally:
        with _lock:
            _inflight.discard(sym)


def _submit_resolve(fn) -> None:
    """The one seam that leaves the request thread. Late-bound so a test can replace it."""
    _RESOLVE_POOL.submit(fn)


def _kick_resolve(sym: str, list_date: str) -> bool:
    """Start ONE background resolve for `sym`; True if one was started."""
    with _lock:
        if sym in _inflight:
            return False
        if time.time() - _failed_at.get(sym, 0) < _RETRY_AFTER_S:
            return False
        _inflight.add(sym)
    try:
        _submit_resolve(lambda: _run_resolve(sym, list_date))
    except Exception:
        with _lock:
            _inflight.discard(sym)
        return False
    return True


def get_ipo_date(ticker: str) -> dict:
    """{"symbol", "list_date", "first_trade_date", "first_trade_final"} for a ticker.

    `list_date` is the provider's reference value, unchanged in meaning.
    `first_trade_date` is what the chart's listing statement compares against.
    Never blocks on the first-trade resolve: a non-final answer carries
    `first_trade_date == list_date` and a background resolve is kicked."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"symbol": sym, "list_date": None, "first_trade_date": None, "first_trade_final": False}
    ck = f"ticker_ipo_{sym}"
    hit = _mem.get(ck)
    if hit is None:
        hit = _disk_get(sym)
        if hit is not None:
            _mem.set(ck, hit, ttl=_TTL)
    if hit is not None and hit.get("first_trade_final") is True:
        return hit

    list_date = hit.get("list_date") if hit is not None else None
    if not list_date:
        try:
            from api.services import massive
            res = massive.get_ticker_details(sym) or {}
            ld = res.get("list_date")
            if isinstance(ld, str) and _ISO.match(ld.strip()):
                list_date = ld.strip()
        except Exception:
            list_date = None

    out = {"symbol": sym, "list_date": list_date,
           "first_trade_date": list_date, "first_trade_final": False}
    # Only persist a genuine date — a null (provider miss / no coverage) stays
    # uncached so a later view can still resolve it.
    if list_date:
        if hit is None:
            _mem.set(ck, out, ttl=_TTL)
            _disk_put(sym, out)
        _kick_resolve(sym, list_date)
    return out
