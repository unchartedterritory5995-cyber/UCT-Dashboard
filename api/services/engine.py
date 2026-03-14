"""
api/services/engine.py

Reads data for the engine endpoints. Primary source is data/wire_data.json
(written at the end of each morning_wire_engine.py run). Falls back to
morning_wire_state.json keys and finally live engine calls when the JSON
file is absent or stale.

wire_data.json schema (written by morning_wire_engine.run()):
  date          — ISO date string, e.g. "2026-02-22"
  rundown_html  — full assembled rundown HTML string
  leadership    — list of dicts (sym, thesis, score, …)
  themes        — dict keyed by ETF ticker (name, 1W, 1M, 3M, holdings, …)
  earnings      — {"bmo": [...], "amc": [...]} — raw EW/Finnhub entries

Key findings from inspecting morning_wire_engine.py:
  fetch_breadth()        → returns dict with keys: pct_above_50, pct_above_200,
                           nyad, nyhl, breadth_score
  fetch_theme_tracker()  → returns dict keyed by ETF ticker, each value has:
                           name, ticker, etf_name, 1W, 1M, 3M, holdings
  fetch_leadership()     → returns list of dicts (requires analyst arg = AIAnalyst instance)
  fetch_finviz_news()    → returns list of dicts: headline, source, url, datetime, category, summary
  fetch_earnings_whispers() → list of dicts: symbol, date, hour, eps_actual, eps_estimate, etc.

State file keys (morning_wire_state.json):
  distribution_days_spy, distribution_days_qqq, rally_start_date, rally_day_count,
  market_phase, ftd_detected, ftd_date, last_run_date, historical_breadth,
  historical_risk_appetite, stockbee_cache, stockbee_last_5_days,
  positioning_cache, aaii_cache, naaim_cache
"""
import sys
import os
import json
import copy
import pathlib
import threading as _threading
import time as _time

MORNING_WIRE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "morning-wire")
)
if MORNING_WIRE_PATH not in sys.path:
    sys.path.insert(0, MORNING_WIRE_PATH)

STATE_FILE = os.path.join(MORNING_WIRE_PATH, "morning_wire_state.json")
WIRE_DATA_FILE = os.path.join(MORNING_WIRE_PATH, "data", "wire_data.json")
PERSISTENT_WIRE_DATA_FILE = "/data/wire_data.json"  # Railway volume mount

from api.services.cache import cache
import logging as _logging
_logger = _logging.getLogger(__name__)

_anthropic_client = None  # anthropic.Anthropic | None (lazy-init)

def _get_anthropic_client():
    """Return the module-level Anthropic client, initializing it once (thread-safe)."""
    global _anthropic_client
    if _anthropic_client is None:
        with _anthropic_lock:
            if _anthropic_client is None:
                import anthropic
                api_key = os.environ.get("ANTHROPIC_API_KEY")
                if not api_key:
                    raise RuntimeError("ANTHROPIC_API_KEY is not set")
                _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client

# ── Earnings analysis configuration ───────────────────────────────────────────
_EARNINGS_NEWS_MAX_ITEMS    = 4        # max Finnhub headlines per ticker
_EARNINGS_AI_MAX_TOKENS     = 400      # Haiku response token limit
_EARNINGS_CACHE_TTL_HIT     = 43_200   # 12 h — full result cached after success
_EARNINGS_CACHE_TTL_MISS    = 300      # 5 min — retry window on failure
_AV_TIMEOUT_SECS            = 8        # Alpha Vantage request timeout
_FH_TIMEOUT_SECS            = 6        # Finnhub request timeout
_AV_RATE_INTERVAL_SECS      = 13.0     # ≥13s between AV calls → ≤4.6/min (free tier: 5/min)
_EARNINGS_AI_MODEL          = "claude-haiku-4-5-20251001"

# Alpha Vantage free tier: 5 calls/min. Serialize all AV calls with ≥13s spacing.
_av_lock = _threading.Lock()
_av_last_call: list[float] = [0.0]  # mutable so inner scope can write
_anthropic_lock = _threading.Lock()

from concurrent.futures import ThreadPoolExecutor as _ThreadPoolExecutor

# Bounded pool for pre-warm work. Max 4 workers: respects AV rate limiter
# (4 concurrent threads → at most 4 AV calls queued, serialized by _av_lock).
_prewarm_executor = _ThreadPoolExecutor(max_workers=4, thread_name_prefix="prewarm")


def _av_get(req_module, url: str, timeout: int = _AV_TIMEOUT_SECS) -> dict:
    """Rate-limited Alpha Vantage GET. Enforces ≥13s between calls (≤4.6/min)."""
    with _av_lock:
        wait = _AV_RATE_INTERVAL_SECS - (_time.monotonic() - _av_last_call[0])
        if wait > 0:
            _time.sleep(wait)
        _av_last_call[0] = _time.monotonic()
    data = req_module.get(url, timeout=timeout).json()
    if "Note" in data or "Information" in data:
        # AV returned a rate-limit or info message instead of actual data
        raise RuntimeError(f"AV rate limit hit for {url!r}: {data.get('Note') or data.get('Information')}")
    return data


def _with_retry(fn, retries: int = 1, delay: float = 2.0):
    """Call fn(); on requests.Timeout or ConnectionError, retry up to `retries` times.

    Note: AV calls go through _av_get() which has its own rate-limit serialization
    via _av_lock. Adding _with_retry there would conflict with the lock's timing
    guarantees, so only Finnhub calls are wrapped here.
    """
    import requests as _r
    for attempt in range(retries + 1):
        try:
            return fn()
        except (_r.Timeout, _r.ConnectionError) as e:
            if attempt < retries:
                _logger.warning("Transient error (attempt %d/%d): %s", attempt + 1, retries + 1, e)
                _time.sleep(delay)
            else:
                raise


def _load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _load_wire_data() -> dict | None:
    """Load the pre-computed wire_data.json from the engine's last run.

    Priority: in-memory cache → Railway volume (/data/) → local dev path.
    """
    cached = cache.get("wire_data")
    if cached:
        return cached
    for path in [PERSISTENT_WIRE_DATA_FILE, WIRE_DATA_FILE]:
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                cache.set("wire_data", data, ttl=82800)
                return data
            except (json.JSONDecodeError, OSError):
                continue
    return None


# ─── Breadth ──────────────────────────────────────────────────────────────────

def get_breadth() -> dict:
    cached = cache.get("breadth")
    if cached:
        return cached

    state = _load_state()

    # Priority 1: state file breadth_data (local dev)
    breadth = state.get("breadth_data")
    if breadth:
        breadth = _normalize_breadth(breadth, state)
        breadth["exposure"] = _normalize_exposure(state.get("exposure") or {})
    else:
        # Priority 2: wire_data pushed from engine (persisted in Railway volume)
        wire = _load_wire_data()
        if wire and wire.get("breadth"):
            breadth = _normalize_breadth(wire["breadth"], state)
            breadth["exposure"] = _normalize_exposure(wire.get("exposure") or {})
            breadth["ma_data"]  = wire.get("ma_data") or {}
        else:
            # Priority 3: live fetch (local dev only — Finviz token not on Railway)
            try:
                import morning_wire_engine as eng
                raw = eng.fetch_breadth()
                breadth = _normalize_breadth(raw, state)
            except Exception as e:
                breadth = {
                    "pct_above_50ma": None,
                    "pct_above_200ma": None,
                    "advancing": None,
                    "declining": None,
                    "breadth_score": None,
                    "distribution_days": state.get("distribution_days_qqq", 0),
                    "market_phase": state.get("market_phase", ""),
                }

    cache.set("breadth", breadth, ttl=3600)
    return breadth


def _normalize_breadth(raw: dict, state: dict) -> dict:
    """
    fetch_breadth() uses keys: pct_above_50, pct_above_200, breadth_score.
    Map them to our public API keys: pct_above_50ma, pct_above_200ma.
    """
    if not isinstance(raw, dict):
        raw = {}
    return {
        "pct_above_5ma":   raw.get("pct_above_5ma",  raw.get("pct_above_5"))  or None,
        "pct_above_50ma":  raw.get("pct_above_50ma", raw.get("pct_above_50")) or None,
        "pct_above_200ma": raw.get("pct_above_200ma", raw.get("pct_above_200")) or None,
        "advancing":       raw.get("advancing") or None,
        "declining":       raw.get("declining") or None,
        "new_highs":       raw.get("new_highs") or None,
        "new_lows":        raw.get("new_lows")  or None,
        "new_highs_list":  raw.get("new_highs_list", []),
        "new_lows_list":   raw.get("new_lows_list",  []),
        "breadth_score":   raw.get("breadth_score", 50.0),
        "distribution_days": state.get("distribution_days_qqq", 0),
        "market_phase":    state.get("market_phase", ""),
    }


def _normalize_exposure(raw: dict) -> dict:
    """Pass through UCT Intelligence Exposure Rating from wire_data."""
    if not raw:
        return {}
    return {
        "score":       raw.get("score"),
        "score_delta": raw.get("score_delta"),
        "breakdown":   raw.get("breakdown", {}),
        "note":        raw.get("note", ""),
        "gate_active": raw.get("gate_active", False),
        "gate_reason": raw.get("gate_reason"),
        "bonus":       raw.get("bonus", 0),
    }


# ─── Themes ───────────────────────────────────────────────────────────────────

def get_themes(period: str = "1W") -> dict:
    # ── Today: live intraday via Massive batch snapshot ───────────────────────
    if period == "Today":
        cache_key = "themes_Today"
        cached = cache.get(cache_key)
        if cached:
            return cached

        wire = _load_wire_data()
        wire_themes = wire.get("themes", {}) if wire else {}
        tickers = list(wire_themes.keys()) if wire_themes else []

        from api.services.massive import get_etf_snapshots
        snap = get_etf_snapshots(tickers) if tickers else {}

        synthetic = {}
        for ticker, data in wire_themes.items():
            if not isinstance(data, dict):
                continue
            synthetic[ticker] = {**data, "Today": snap.get(ticker, 0.0)}

        result = _normalize_themes(synthetic, "Today")
        cache.set(cache_key, result, ttl=30)
        return result

    # ── Historical periods (1W / 1M / 3M): unchanged ─────────────────────────
    wire = _load_wire_data()
    cache_key = f"themes_{period}"
    if wire and wire.get("themes"):
        cached = cache.get(cache_key)
        if cached:
            return cached
        data = _normalize_themes(wire["themes"], period)
        cache.set(cache_key, data, ttl=3600)
        return data

    cached = cache.get(cache_key)
    if cached:
        return cached

    state = _load_state()
    raw = state.get("themes_data")
    if not raw:
        try:
            import morning_wire_engine as eng
            raw = eng.fetch_theme_tracker()
        except Exception as e:
            result = {"leaders": [], "laggards": [], "period": period, "error": str(e)}
            cache.set(cache_key, result, ttl=3600)
            return result

    result = _normalize_themes(raw, period)
    cache.set(cache_key, result, ttl=3600)
    return result


def _normalize_themes(raw, period: str = "1W") -> dict:
    """
    fetch_theme_tracker() returns a dict keyed by ETF ticker.
    Each value has: name, ticker, etf_name, 1W, 1M, 3M, holdings, intl_holdings.

    Returns ALL themes sorted by selected period with holdings included.
    """
    if not isinstance(raw, dict) or not raw:
        return {"leaders": [], "laggards": [], "period": period}

    items = []
    for ticker, data in raw.items():
        if not isinstance(data, dict):
            continue
        pct_val = data.get(period, 0) or 0
        pct_str = f"{pct_val:+.2f}%" if isinstance(pct_val, (int, float)) else str(pct_val)
        bar = min(100, max(0, abs(pct_val) * 8)) if isinstance(pct_val, (int, float)) else 50

        raw_holdings = data.get("holdings", [])
        holdings = [
            h["sym"] for h in raw_holdings
            if isinstance(h, dict) and h.get("sym")
        ]

        raw_intl = data.get("intl_holdings", [])
        intl_count = len(raw_intl) if isinstance(raw_intl, list) else 0

        items.append({
            "name": data.get("name", ticker),
            "ticker": ticker,
            "etf_name": data.get("etf_name", ""),
            "pct": pct_str,
            "pct_val": pct_val,
            "bar": round(bar),
            "holdings": holdings,
            "intl_count": intl_count,
        })

    items.sort(key=lambda x: x["pct_val"], reverse=True)

    def clean(item):
        return {
            "name": item["name"],
            "ticker": item["ticker"],
            "etf_name": item["etf_name"],
            "pct": item["pct"],
            "bar": item["bar"],
            "holdings": item["holdings"],
            "intl_count": item["intl_count"],
        }

    leaders  = [clean(i) for i in items if i["pct_val"] >= 0]
    laggards = [clean(i) for i in reversed(items) if i["pct_val"] < 0]

    return {"leaders": leaders, "laggards": laggards, "period": period}


# ─── Leadership ───────────────────────────────────────────────────────────────

def get_leadership() -> list:
    wire = _load_wire_data()
    if wire and wire.get("leadership"):
        cached = cache.get("leadership")
        if cached:
            return cached
        data = wire["leadership"] if isinstance(wire["leadership"], list) else []
        cache.set("leadership", data, ttl=3600)
        return data

    cached = cache.get("leadership")
    if cached:
        return cached

    state = _load_state()
    # Leadership data is injected into state by the engine as a JS variable;
    # look for it under "leadership_data". It typically won't be there unless
    # engine.py has been extended to store it — return empty list if absent.
    data = state.get("leadership_data", [])
    if not isinstance(data, list):
        data = []

    cache.set("leadership", data, ttl=3600)
    return data


# ─── Rundown ──────────────────────────────────────────────────────────────────

def get_rundown() -> dict:
    wire = _load_wire_data()
    if wire and wire.get("rundown_html"):
        cached = cache.get("rundown")
        if cached:
            return cached
        data = {"html": wire["rundown_html"], "date": wire.get("date", "")}
        cache.set("rundown", data, ttl=3600)
        return data

    cached = cache.get("rundown")
    if cached:
        return cached

    state = _load_state()
    data = state.get("rundown_data", {"html": "", "date": ""})
    if not isinstance(data, dict):
        data = {"html": str(data), "date": ""}

    cache.set("rundown", data, ttl=3600)
    return data


# ─── Earnings ─────────────────────────────────────────────────────────────────

def _enrich_earnings_with_gap(data: dict) -> None:
    """Batch-fetch live change_pct from Massive and add it to each earnings entry."""
    all_entries = data.get("bmo", []) + data.get("amc", []) + data.get("amc_tonight", [])
    syms = [e["sym"] for e in all_entries if e.get("sym")]
    if not syms:
        return
    try:
        from api.services.massive import _get_client
        price_map = _get_client().get_batch_snapshots(syms)
        for entry in all_entries:
            entry["change_pct"] = price_map.get(entry["sym"])
    except Exception:
        pass


def _fetch_ew_live(date_str: str) -> list:
    """Live EarningsWhispers fetch for a single date. Returns flat list of dicts."""
    import requests as _req
    yyyymmdd = date_str.replace("-", "")
    r = _req.get(
        f"https://www.earningswhispers.com/api/caldata/{yyyymmdd}",
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
            "Referer": f"https://www.earningswhispers.com/calendar/{yyyymmdd}/1",
        },
        timeout=15,
    )
    r.raise_for_status()
    items = r.json()
    if not isinstance(items, list):
        return []
    result = []
    for item in items:
        sym = (item.get("ticker") or "").strip().upper()
        if not sym:
            continue
        eps_actual  = item.get("eps")           # None until reported
        eps_est     = item.get("q1EstEPS")
        rev_actual  = item.get("revenue")       # already in millions
        rev_est_raw = item.get("q1RevEst")      # raw dollars → convert
        rev_est     = (rev_est_raw / 1_000_000) if rev_est_raw else None
        release_time = item.get("releaseTime", 0)
        hour = "bmo" if release_time == 1 else "amc"
        result.append({
            "symbol":       sym,
            "hour":         hour,
            "eps_actual":   eps_actual,
            "eps_estimate": eps_est,
            "rev_actual":   rev_actual,
            "rev_estimate": rev_est,
            "ew_total":     item.get("total", 0),
        })
    return result


def get_earnings() -> dict:
    cached = cache.get("earnings")
    if cached:
        return cached

    import datetime
    today     = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

    # ── Primary: live EarningsWhispers fetch (today BMO + yesterday AMC) ──────
    bmo_raw: list = []
    amc_raw: list = []
    today_ew: list = []
    ew_ok = False
    try:
        today_ew = _fetch_ew_live(today)
        yest_ew  = _fetch_ew_live(yesterday)
        bmo_raw  = sorted(
            [e for e in today_ew if e["hour"] == "bmo"],
            key=lambda x: x.get("ew_total", 0), reverse=True,
        )
        amc_raw  = sorted(
            [e for e in yest_ew if e["hour"] == "amc"],
            key=lambda x: x.get("ew_total", 0), reverse=True,
        )
        ew_ok = True
    except Exception:
        pass

    # ── Fallback: wire_data if EW unreachable ─────────────────────────────────
    wire = _load_wire_data()
    wire_bmo: dict = {}
    wire_amc: dict = {}
    if wire and wire.get("earnings"):
        raw = wire["earnings"]
        for e in raw.get("bmo", []):
            sym = e.get("symbol", e.get("sym", ""))
            if sym:
                wire_bmo[sym] = e
        for e in raw.get("amc", []):
            sym = e.get("symbol", e.get("sym", ""))
            if sym:
                wire_amc[sym] = e

    if not ew_ok:
        bmo_raw = [dict(e, hour="bmo") for e in wire_bmo.values()]
        amc_raw = [dict(e, hour="amc") for e in wire_amc.values()]
    else:
        # ── Patch missing actuals from wire_data (EW sometimes lags AMC results) ─
        for entry in bmo_raw:
            if entry.get("eps_actual") is None:
                wb = wire_bmo.get(entry["symbol"])
                if wb and wb.get("eps_actual") is not None:
                    entry["eps_actual"]   = wb["eps_actual"]
                    entry["eps_estimate"] = entry.get("eps_estimate") or wb.get("eps_estimate")
                    entry["rev_actual"]   = wb.get("rev_actual")
                    entry["rev_estimate"] = entry.get("rev_estimate") or wb.get("rev_estimate")
        for entry in amc_raw:
            if entry.get("eps_actual") is None:
                wa = wire_amc.get(entry["symbol"])
                if wa and wa.get("eps_actual") is not None:
                    entry["eps_actual"]   = wa["eps_actual"]
                    entry["eps_estimate"] = entry.get("eps_estimate") or wa.get("eps_estimate")
                    entry["rev_actual"]   = wa.get("rev_actual")
                    entry["rev_estimate"] = entry.get("rev_estimate") or wa.get("rev_estimate")

        # ── Finnhub patch: fill remaining Pending from live Finnhub calendar ──
        fh_key = os.environ.get("FINNHUB_API_KEY")
        if fh_key:
            pending_syms = {
                e["symbol"] for e in (bmo_raw + amc_raw)
                if e.get("eps_actual") is None
            }
            if pending_syms:
                try:
                    import requests as _req2
                    fh_r = _req2.get(
                        "https://finnhub.io/api/v1/calendar/earnings",
                        params={"from": yesterday, "to": today, "token": fh_key},
                        timeout=15,
                    )
                    fh_map = {
                        e["symbol"]: e
                        for e in fh_r.json().get("earningsCalendar", [])
                        if e.get("symbol") in pending_syms
                        and e.get("epsActual") is not None
                    }
                    for entry in (bmo_raw + amc_raw):
                        if entry.get("eps_actual") is not None:
                            continue
                        fh = fh_map.get(entry["symbol"])
                        if fh:
                            rev_a = fh.get("revenueActual")
                            rev_e = fh.get("revenueEstimate")
                            entry["eps_actual"]   = fh["epsActual"]
                            entry["eps_estimate"] = entry.get("eps_estimate") or fh.get("epsEstimate")
                            entry["rev_actual"]   = (rev_a / 1_000_000) if rev_a else None
                            entry["rev_estimate"] = entry.get("rev_estimate") or (
                                (rev_e / 1_000_000) if rev_e else None
                            )
                except Exception:
                    pass

    # ── Tonight's AMC: today's reporters sorted by EW interest ──────────────
    amc_tonight_raw: list = []
    if ew_ok:
        amc_tonight_raw = sorted(
            [e for e in today_ew if e["hour"] == "amc"],
            key=lambda x: x.get("ew_total", 0), reverse=True,
        )
        # Patch any already-reported results from EW itself (some report early)
        # Finnhub patch for tonight entries that have already reported
        if fh_key:
            tonight_pending = {e["symbol"] for e in amc_tonight_raw if e.get("eps_actual") is None}
            if tonight_pending:
                try:
                    import requests as _req3
                    fh_r2 = _req3.get(
                        "https://finnhub.io/api/v1/calendar/earnings",
                        params={"from": today, "to": today, "token": fh_key},
                        timeout=15,
                    )
                    fh_tonight = {
                        e["symbol"]: e
                        for e in fh_r2.json().get("earningsCalendar", [])
                        if e.get("symbol") in tonight_pending
                        and e.get("epsActual") is not None
                    }
                    for entry in amc_tonight_raw:
                        if entry.get("eps_actual") is not None:
                            continue
                        fh = fh_tonight.get(entry["symbol"])
                        if fh:
                            rev_a = fh.get("revenueActual")
                            rev_e = fh.get("revenueEstimate")
                            entry["eps_actual"]   = fh["epsActual"]
                            entry["eps_estimate"] = entry.get("eps_estimate") or fh.get("epsEstimate")
                            entry["rev_actual"]   = (rev_a / 1_000_000) if rev_a else None
                            entry["rev_estimate"] = entry.get("rev_estimate") or (
                                (rev_e / 1_000_000) if rev_e else None
                            )
                except Exception:
                    pass

    # ── Apply $300M cap filter from engine push ───────────────────────────────
    # wire_data["cap_universe"] is a sorted list of $300M+ tickers written by
    # morning_wire_engine.py each run. Filters the live EW fetch which returns
    # everything EarningsWhispers tracks regardless of market cap.
    cap_uni = set(wire.get("cap_universe", []) if wire else [])
    if cap_uni:
        bmo_raw        = [e for e in bmo_raw        if e.get("symbol", "") in cap_uni]
        amc_raw        = [e for e in amc_raw        if e.get("symbol", "") in cap_uni]
        amc_tonight_raw= [e for e in amc_tonight_raw if e.get("symbol", "") in cap_uni]

    data = _normalize_earnings(bmo_raw + amc_raw, amc_tonight_raw)
    _enrich_earnings_with_gap(data)
    _prewarm_earnings_analysis(data)
    cache.set("earnings", data, ttl=1800)
    return data


def _fmt_surprise(actual, estimate):
    if actual is None or estimate is None or estimate == 0:
        return None
    pct = (actual - estimate) / abs(estimate) * 100
    return f"{'+' if pct >= 0 else ''}{pct:.1f}%"


def _build_earnings_entry(item: dict) -> dict:
    """Convert a raw EW/Finnhub item into a normalised earnings entry dict."""
    eps_actual   = item.get("eps_actual")
    eps_estimate = item.get("eps_estimate")
    rev_actual   = item.get("rev_actual")
    rev_estimate = item.get("rev_estimate")
    entry = {
        "sym":              item.get("symbol", item.get("sym", "")),
        "reported_eps":     eps_actual,
        "eps_estimate":     eps_estimate,
        "surprise_pct":     _fmt_surprise(eps_actual, eps_estimate),
        "rev_estimate":     rev_estimate,
        "rev_actual":       rev_actual,
        "rev_surprise_pct": _fmt_surprise(rev_actual, rev_estimate),
        "ew_total":         item.get("ew_total", 0),
    }
    if eps_actual is None or eps_estimate is None:
        entry["verdict"] = "Pending"
    else:
        eps_beat = eps_actual >= eps_estimate
        if rev_actual is not None and rev_estimate is not None:
            rev_beat = rev_actual >= rev_estimate
            if eps_beat and rev_beat:
                entry["verdict"] = "Beat"
            elif not eps_beat and not rev_beat:
                entry["verdict"] = "Miss"
            else:
                entry["verdict"] = "Mixed"
        else:
            entry["verdict"] = "Beat" if eps_beat else "Miss"
    return entry


def _earnings_sort_key(e):
    """Sort: largest absolute EPS surprise first; Pending entries last."""
    if e.get("verdict") == "Pending":
        return (1, 0.0)
    surp = e.get("surprise_pct") or "0"
    try:
        return (0, -abs(float(surp.replace("%", "").replace("+", ""))))
    except (ValueError, AttributeError):
        return (0, 0.0)


def _normalize_earnings(raw, amc_tonight_raw=None) -> dict:
    """
    Normalise flat earnings list into bmo / amc / amc_tonight buckets.
    raw            — mixed bmo+amc_yesterday entries (hour=="bmo"|"amc")
    amc_tonight_raw — today's AMC list (separate, already filtered)
    """
    bmo, amc = [], []
    for item in (raw or []):
        if not isinstance(item, dict):
            continue
        entry = _build_earnings_entry(item)
        if item.get("hour") == "bmo":
            bmo.append(entry)
        else:
            amc.append(entry)

    # Sort by EW analyst interest — ensures high-profile names are never dropped
    # by a small surprise %. A 3% beat from ANF (ew=22) matters more than a
    # 900% "beat" from EYE (ew=2) where the estimate was near-zero.
    bmo.sort(key=lambda e: -e.get("ew_total", 0))
    amc.sort(key=lambda e: -e.get("ew_total", 0))

    # Tonight's AMC: sort by EW analyst interest (most-followed first).
    # Surprise magnitude is irrelevant here — traders need to know what matters,
    # not how dramatic a result was. AVGO (ew=195) must always lead.
    amc_tonight = []
    for item in (amc_tonight_raw or []):
        if not isinstance(item, dict):
            continue
        amc_tonight.append(_build_earnings_entry(item))
    amc_tonight.sort(key=lambda e: -e.get("ew_total", 0))

    return {"bmo": bmo[:15], "amc": amc[:15], "amc_tonight": amc_tonight[:15]}


def _generate_earnings_analysis(sym: str, row: dict | None) -> dict:
    """Generate Claude Haiku earnings analysis + fetch AV history + Finnhub news. Cached 12h."""
    cache_key = f"earnings_analysis_{sym}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    import datetime as _dt
    import requests as _req

    av_key  = os.environ.get("ALPHAVANTAGE_API_KEY", "")
    fh_key  = os.environ.get("FINNHUB_API_KEY", "")

    # ── Step 1: Alpha Vantage quarterly history ───────────────────────────────
    yoy_eps_growth = None
    beat_streak    = None
    beat_history   = []       # visual pattern e.g. ["✗","✓","✓","✓"] oldest→newest
    try:
        av_url = (
            f"https://www.alphavantage.co/query"
            f"?function=EARNINGS&symbol={sym}&apikey={av_key}"
        )
        av_resp = _av_get(_req, av_url, timeout=_AV_TIMEOUT_SECS)
        quarters = av_resp.get("quarterlyEarnings", [])

        def _to_f(v):
            try: return float(v)
            except (TypeError, ValueError): return None

        if len(quarters) >= 5:
            q0 = _to_f(quarters[0].get("reportedEPS"))
            q4 = _to_f(quarters[4].get("reportedEPS"))
            if q0 is not None and q4 is not None and q4 != 0:
                pct = (q0 - q4) / abs(q4) * 100
                sign = "+" if pct >= 0 else ""
                yoy_eps_growth = f"{sign}{pct:.1f}%"
        if len(quarters) >= 4:
            beats = sum(
                1 for q in quarters[:4]
                if _to_f(q.get("reportedEPS")) is not None
                and _to_f(q.get("estimatedEPS")) is not None
                and _to_f(q.get("reportedEPS")) >= _to_f(q.get("estimatedEPS"))
            )
            beat_streak = f"Beat {beats} of last 4"
            # Visual beat history: oldest→newest, e.g. ["✗", "✓", "✓", "✓"]
            beat_history = []
            for _q in reversed(quarters[:4]):
                _r = _to_f(_q.get("reportedEPS"))
                _e = _to_f(_q.get("estimatedEPS"))
                if _r is not None and _e is not None:
                    beat_history.append("✓" if _r >= _e else "✗")
                else:
                    beat_history.append("—")
    except Exception as _e:
        _logger.warning("AV history fetch failed for %s: %s", sym, _e)

    # ── Step 2: Finnhub company news (last 3 days, up to 4 items) ────────────
    news_items = []
    try:
        today_str = _dt.date.today().isoformat()
        from_str  = (_dt.date.today() - _dt.timedelta(days=3)).isoformat()
        fh_url = (
            f"https://finnhub.io/api/v1/company-news"
            f"?symbol={sym}&from={from_str}&to={today_str}&token={fh_key}"
        )
        fh_resp = _with_retry(lambda: _req.get(fh_url, timeout=_FH_TIMEOUT_SECS).json())
        if not isinstance(fh_resp, list):
            raise ValueError(f"Finnhub returned unexpected shape: {type(fh_resp)}")
        for item in fh_resp[:_EARNINGS_NEWS_MAX_ITEMS]:
            ts = item.get("datetime", 0)
            try:
                _d = _dt.datetime.fromtimestamp(ts)
                dt_str = _d.strftime("%I:%M %p").lstrip("0") if ts else ""
            except Exception:
                dt_str = ""
            news_items.append({
                "headline": item.get("headline", ""),
                "source":   item.get("source", ""),
                "url":      item.get("url", ""),
                "time":     dt_str,
            })
    except Exception as _e:
        _logger.warning("Finnhub news fetch failed for %s: %s", sym, _e)

    # ── Step 3: AI analysis (non-Pending only) ────────────────────────────────
    analysis = None
    is_pending = not row or row.get("verdict", "").lower() in ("pending", "")
    if not is_pending:
        try:
            def _fmt_eps(v):
                if v is None: return "N/A"
                return f"{'-' if v < 0 else ''}${abs(v):.2f}"

            def _fmt_rev(m):
                if m is None: return "N/A"
                return f"${m / 1000:.2f}B" if m >= 1000 else f"${round(m)}M"

            change_pct = row.get("change_pct")
            gap_str = (
                f"{'+' if change_pct >= 0 else ''}{change_pct:.2f}%"
                if change_pct is not None else "N/A"
            )

            context_parts = []
            if yoy_eps_growth:
                context_parts.append(f"YoY EPS growth: {yoy_eps_growth}")
            if beat_streak:
                context_parts.append(f"Beat history: {beat_streak}")
            if news_items:
                context_parts.append(
                    "Recent headlines: "
                    + " / ".join(n["headline"] for n in news_items[:2] if n["headline"])
                )
            context_block = "\n".join(context_parts)

            prompt = (
                f"Analyze this earnings report for {sym} in 4-5 concise sentences.\n"
                f"Be specific about the business — no filler, no trade advice.\n\n"
                f"Verdict: {row.get('verdict')}\n"
                f"EPS: Expected {_fmt_eps(row.get('eps_estimate'))} → "
                f"Reported {_fmt_eps(row.get('reported_eps'))} "
                f"({row.get('surprise_pct', 'N/A')} surprise)\n"
                f"Revenue: Expected {_fmt_rev(row.get('rev_estimate'))} → "
                f"Reported {_fmt_rev(row.get('rev_actual'))} "
                f"({row.get('rev_surprise_pct', 'N/A')} surprise)\n"
                f"Stock reaction: {gap_str}\n"
            )
            if context_block:
                prompt += f"{context_block}\n"
            prompt += (
                "\nCover: what the numbers say about the business, whether this is "
                "consistent with trend, and what the market reaction implies about expectations."
            )

            client = _get_anthropic_client()
            msg = client.messages.create(
                model=_EARNINGS_AI_MODEL,
                max_tokens=_EARNINGS_AI_MAX_TOKENS,
                messages=[{"role": "user", "content": prompt}],
            )
            analysis = msg.content[0].text.strip()
        except Exception as _e:
            _logger.warning("AI analysis failed for %s: %s", sym, _e, exc_info=True)
            analysis = None

    result = {
        "sym":            sym,
        "analysis":       analysis,
        "yoy_eps_growth": yoy_eps_growth,
        "beat_streak":    beat_streak,
        "beat_history":   beat_history,   # ["✗","✓","✓","✓"] oldest→newest
        "news":           news_items,  # list of {headline, source, url, time}
    }
    # Only cache for full 12h if analysis succeeded; short TTL lets it retry on failure
    ttl = _EARNINGS_CACHE_TTL_HIT if analysis is not None else _EARNINGS_CACHE_TTL_MISS
    cache.set(cache_key, result, ttl=ttl)
    return result


def _prewarm_earnings_analysis(data: dict) -> None:
    """Pre-cache AI analysis for reported tickers; pre-fetch context for Pending AMC tonight."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return
    _logger.info("prewarm: starting for buckets bmo/amc/amc_tonight")

    def _partial_prewarm(sym: str) -> None:
        """For Pending entries: cache news + AV history without AI call."""
        cache_key = f"earnings_analysis_{sym}"
        if cache.get(cache_key):
            return
        # Calling with row=None causes _generate_earnings_analysis to skip AI
        # but still fetches AV history and Finnhub news, then caches the partial result.
        _generate_earnings_analysis(sym, None)

    for bucket in ("bmo", "amc", "amc_tonight"):
        for entry in data.get(bucket, []):
            sym = entry.get("sym", "")
            if not sym:
                continue
            is_pending = entry.get("verdict", "").lower() in ("pending", "")
            if cache.get(f"earnings_analysis_{sym}"):
                continue  # already warmed

            if is_pending and bucket == "amc_tonight":
                # Partial pre-warm: AV history + news, no AI
                _prewarm_executor.submit(_partial_prewarm, sym)
            elif not is_pending:
                # Full pre-warm: AV history + news + AI analysis
                _prewarm_executor.submit(_generate_earnings_analysis, sym, dict(entry))


# ─── News ─────────────────────────────────────────────────────────────────────

# ─── News helpers ─────────────────────────────────────────────────────────────

_AV_TOPIC_MAP = {
    "Earnings":                "EARN",
    "Mergers & Acquisitions":  "M&A",
    "IPO":                     "IPO",
    "Life Sciences":           "BIO",
    "Economy - Monetary":      "MACRO",
}

_UPGRADE_PATTERNS = (
    "upgrades to", "raises to", "initiates", "outperform",
    "overweight", "price target raised", "raises price target",
    "pt raised", "price target increase",
)
_DOWNGRADE_PATTERNS = (
    "downgrades to", "cuts to", "underperform", "underweight",
    "price target cut", "price target lowered", "pt cut", "pt lowered",
    "price target decrease",
)


def _classify_category(item: dict, headline: str) -> str:
    """Classify an AV article dict into a category badge string."""
    hl = headline.lower()
    if any(p in hl for p in _UPGRADE_PATTERNS):
        return "UPGRADE"
    if any(p in hl for p in _DOWNGRADE_PATTERNS):
        return "DOWNGRADE"
    topics = sorted(
        item.get("topics", []),
        key=lambda t: float(t.get("relevance_score", 0) or 0),
        reverse=True,
    )
    for t in topics:
        badge = _AV_TOPIC_MAP.get(t.get("topic", ""))
        if badge:
            return badge
    return "GENERAL"


def _map_sentiment(label: str | None) -> str:
    """Map AV overall_sentiment_label to 'bullish' | 'bearish' | 'neutral'."""
    if not label:
        return "neutral"
    lc = label.lower()
    if "bullish" in lc:
        return "bullish"
    if "bearish" in lc:
        return "bearish"
    return "neutral"


_SOURCE_TIER = {
    "reuters": 1, "associated press": 1, "ap": 1, "dow jones": 1, "bloomberg": 1,
    "benzinga": 2, "business wire": 2, "pr newswire": 2, "globenewswire": 2, "sec edgar": 2,
}

_CATEGORY_PRIORITY = {
    "EARN": 0, "M&A": 1, "UPGRADE": 2, "DOWNGRADE": 2,
    "BIO": 3, "IPO": 4, "MACRO": 5, "GENERAL": 6,
}
_PREMARKET_PINNED = {"EARN", "M&A", "BIO"}


def _deduplicate_news(items: list[dict]) -> list[dict]:
    """Collapse same-event articles (same ticker + category within 2h) into one item."""
    from datetime import datetime
    # Pre-pass: drop exact URL duplicates (AV sometimes returns the same article twice)
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for item in items:
        u = item.get("url", "")
        if u and u in seen_urls:
            continue
        if u:
            seen_urls.add(u)
        deduped.append(item)
    items = deduped

    buckets: dict[tuple, list[dict]] = {}
    for item in items:
        ticker = (item.get("tickers") or [""])[0]
        category = item.get("category", "GENERAL")
        try:
            ts = datetime.strptime(item["time"], "%Y-%m-%d %H:%M:%S").timestamp()
            bucket = int(ts) // 7200
        except Exception:
            bucket = 0
        key = (ticker, category, bucket)
        buckets.setdefault(key, []).append(item)

    def _tier(it):
        return _SOURCE_TIER.get(it.get("source", "").lower(), 3)

    result = []
    for group in buckets.values():
        best = min(group, key=lambda it: (_tier(it), it.get("time", "")))
        if len(group) > 1:
            other_sources = [g["source"] for g in group if g is not best]
            unique_others = list(dict.fromkeys(other_sources))
            if unique_others:
                extra = f" +{len(unique_others) - 1}" if len(unique_others) > 1 else ""
                best = dict(best)
                best["source"] = f"{best['source']} · {unique_others[0]}{extra}"
        result.append(best)
    return result


def _sort_news(items: list[dict], is_premarket: bool) -> list[dict]:
    """Sort by category priority (premarket-aware) then recency."""
    import datetime as _dt

    def _key(item):
        cat = item.get("category", "GENERAL")
        pri = _CATEGORY_PRIORITY.get(cat, 6)
        if is_premarket and cat in _PREMARKET_PINNED:
            pri = -1
        try:
            ts = _dt.datetime.strptime(item["time"], "%Y-%m-%d %H:%M:%S").timestamp()
            recency = -int(ts)
        except Exception:
            recency = 1  # sort to bottom — positive beats all negative recency values
        return (pri, recency)

    return sorted(items, key=_key)


def _check_sym_cap(sym: str) -> tuple[str, bool]:
    """Return (sym, allowed) applying $5M dollar-volume AND $300M market-cap gates.

    Fails open on yfinance errors so transient network issues don't silently
    drop all news. ETFs and non-equity instruments are always blocked.
    """
    try:
        import yfinance as yf
        fi = yf.Ticker(sym).fast_info
        qt = getattr(fi, "quote_type", "EQUITY") or "EQUITY"
        if qt.upper() not in ("EQUITY", ""):
            return sym, False
        price      = getattr(fi, "last_price", 0) or 0
        avg_vol    = getattr(fi, "three_month_average_volume", 0) or 0
        market_cap = getattr(fi, "market_cap", 0) or 0
        return sym, (price * avg_vol) >= 5_000_000 and market_cap >= 300_000_000
    except Exception:
        return sym, True


def get_news() -> list:
    cached = cache.get("news")
    if cached:
        return cached

    av_key = os.environ.get("ALPHAVANTAGE_API_KEY")
    if not av_key:
        result = [{"headline": "News unavailable", "source": "", "url": "",
                   "time": "", "category": "GENERAL", "sentiment": "neutral",
                   "tickers": [], "change_pct": None,
                   "error": "ALPHAVANTAGE_API_KEY not set"}]
        cache.set("news", result, ttl=120)
        return result

    try:
        import requests as _requests
        from datetime import datetime, timezone, timedelta
        from concurrent.futures import ThreadPoolExecutor, as_completed as _ac

        try:
            from zoneinfo import ZoneInfo
            _et_tz = ZoneInfo("America/New_York")
        except ImportError:
            _et_tz = timezone(timedelta(hours=-5))
        now_et = datetime.now(_et_tz)
        is_premarket = 4 <= now_et.hour < 9 or (now_et.hour == 9 and now_et.minute < 30)
        time_from = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y%m%dT%H%M")

        # ── Fetch AV + EDGAR in parallel ──────────────────────────────────────
        _av_rate_limited = False

        def _fetch_av():
            nonlocal _av_rate_limited
            r = _requests.get(
                "https://www.alphavantage.co/query",
                params={"function": "NEWS_SENTIMENT", "sort": "LATEST",
                        "limit": "200", "time_from": time_from, "apikey": av_key},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()
            if "Information" in data or "Note" in data:
                _av_rate_limited = True
                return []
            return data.get("feed", [])

        def _fetch_edgar():
            try:
                from api.services.edgar import fetch_edgar_news
                return fetch_edgar_news(hours=24)
            except Exception:
                return []

        with ThreadPoolExecutor(max_workers=2) as ex:
            av_future = ex.submit(_fetch_av)
            edgar_future = ex.submit(_fetch_edgar)
            try:
                av_feed = av_future.result(timeout=20)
            except Exception:
                av_feed = []
            try:
                edgar_items = edgar_future.result(timeout=15)
            except Exception:
                edgar_items = []

        # ── Noise filters ──────────────────────────────────────────────────────
        _BAD_SOURCES = {"stock titan", "intellectia ai"}
        _BAD_HEADLINE = ("sec filings", "stock news today", "stock price and chart",
                         "latest stock news", "annual report")

        # ── Process AV feed → candidate items ─────────────────────────────────
        av_candidates = []
        for item in av_feed:
            if item.get("source", "").lower() in _BAD_SOURCES:
                continue
            headline = item.get("title", "")
            if any(p in headline.lower() for p in _BAD_HEADLINE):
                continue
            ticker_sentiment = sorted(
                item.get("ticker_sentiment", []),
                key=lambda t: float(t.get("relevance_score", 0) or 0),
                reverse=True,
            )
            tickers = []
            for t in ticker_sentiment:
                try:
                    rel = float(t.get("relevance_score", 0))
                except (TypeError, ValueError):
                    rel = 0
                sym = (t.get("ticker") or "").strip().upper()
                if rel >= 0.5 and sym and 1 <= len(sym) <= 4 and sym.isalpha():
                    tickers.append(sym)
                if len(tickers) == 3:
                    break
            if not tickers:
                continue

            ts = item.get("time_published", "")
            try:
                dt_utc = datetime.strptime(ts[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                time_str = dt_utc.astimezone(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                time_str = ""

            av_candidates.append({
                "headline":  headline,
                "source":    item.get("source", ""),
                "url":       item.get("url", ""),
                "time":      time_str,
                "category":  _classify_category(item, headline),
                "sentiment": _map_sentiment(item.get("overall_sentiment_label")),
                "tickers":   tickers,
            })

        # ── ETF + volume filter on AV candidates ──────────────────────────────
        unique_syms = list({sym for it in av_candidates for sym in it["tickers"]})

        def _check_sym(sym: str) -> tuple[str, bool]:
            return _check_sym_cap(sym)

        if unique_syms:
            with ThreadPoolExecutor(max_workers=min(len(unique_syms), 12)) as ex:
                allowed = {s for s, ok in (f.result() for f in _ac(
                    ex.submit(_check_sym, s) for s in unique_syms
                )) if ok}
        else:
            allowed = set()

        av_filtered = [
            it for it in av_candidates
            if any(t in allowed for t in it["tickers"])
        ]
        for it in av_filtered:
            it["tickers"] = [t for t in it["tickers"] if t in allowed]

        # ── RSS fallback when AV is rate-limited or returns nothing ──────────
        rss_items = []
        if _av_rate_limited or not av_filtered:
            try:
                from api.services.news_aggregator import fetch_rss_news
                from datetime import date as _date
                _rss_raw = fetch_rss_news(str(_date.today()), limit=40)
                _cat_map = {"earnings": "EARN", "analyst": "UPGRADE",
                            "m_and_a": "M&A", "economic": "MACRO", "general": "GENERAL"}

                # Cap-check any RSS tickers not already validated by the AV loop
                _rss_new_syms = list({
                    t for rss in _rss_raw
                    for t in (rss.get("tickers") or [])
                    if t not in allowed
                })
                if _rss_new_syms:
                    with ThreadPoolExecutor(max_workers=min(len(_rss_new_syms), 8)) as ex:
                        _rss_allowed = {s for s, ok in (f.result() for f in _ac(
                            ex.submit(_check_sym_cap, s) for s in _rss_new_syms
                        )) if ok}
                    allowed = allowed | _rss_allowed

                for rss in _rss_raw:
                    rss_tickers = [t for t in (rss.get("tickers") or []) if t in allowed]
                    # Drop ticker-specific items whose ticker didn't pass cap check;
                    # items with no tickers at all are general headlines and always kept.
                    if (rss.get("tickers") or []) and not rss_tickers:
                        continue
                    tp = rss.get("time_published", "")
                    try:
                        from datetime import datetime as _dtt, timezone as _tz, timedelta as _td
                        dt_utc = _dtt.fromisoformat(tp.replace("Z", "+00:00")) if tp else None
                        time_str = dt_utc.astimezone(_tz((_td(hours=-5)))).strftime("%Y-%m-%d %H:%M:%S") if dt_utc else ""
                    except Exception:
                        time_str = ""
                    rss_items.append({
                        "headline":  rss.get("title", ""),
                        "source":    rss.get("source", ""),
                        "url":       rss.get("url", ""),
                        "time":      time_str,
                        "category":  _cat_map.get(rss.get("category", "general"), "GENERAL"),
                        "sentiment": rss.get("sentiment_label", "Neutral").lower(),
                        "tickers":   rss_tickers,
                    })
            except Exception:
                pass

        # ── Merge AV + EDGAR + RSS, dedup, sort, take top 40 ─────────────────
        merged = av_filtered + edgar_items + rss_items
        deduped = _deduplicate_news(merged)
        sorted_items = _sort_news(deduped, is_premarket=is_premarket)
        top40 = sorted_items[:40]

        # ── Batch Massive price fetch ──────────────────────────────────────────
        primary_tickers = [(it.get("tickers") or [""])[0] for it in top40 if it.get("tickers")]
        price_map: dict[str, float] = {}
        try:
            from api.services.massive import _get_client
            client = _get_client()
            price_map = client.get_batch_snapshots(list(set(primary_tickers)))
        except Exception:
            pass

        # ── Build final 20-item list ───────────────────────────────────────────
        result = []
        for it in top40:
            if len(result) >= 20:
                break
            primary = (it.get("tickers") or [""])[0]
            result.append({
                "headline":   it["headline"],
                "source":     it.get("source", ""),
                "url":        it.get("url", ""),
                "time":       it.get("time", ""),
                "category":   it.get("category", "GENERAL"),
                "sentiment":  it.get("sentiment", "neutral"),
                "tickers":    it.get("tickers", []),
                "change_pct": price_map.get(primary),
            })

    except Exception as e:
        result = [{"headline": "News unavailable", "source": "", "url": "",
                   "time": "", "category": "GENERAL", "sentiment": "neutral",
                   "tickers": [], "change_pct": None, "error": str(e)}]

    # Use longer TTL when AV worked (preserve quota); shorter when RSS fallback used
    _ttl = 1800 if (result and not result[0].get("error")) else 600
    cache.set("news", result, ttl=_ttl)
    return result


# ─── Screener ─────────────────────────────────────────────────────────────────

def get_screener() -> list:
    """
    No screener.py in morning-wire. Return leadership data re-shaped as screener rows,
    or return an empty list if leadership is also absent.
    """
    cached = cache.get("screener")
    if cached:
        return cached

    leadership = get_leadership()
    if leadership:
        result = [
            {
                "ticker": item.get("ticker", item.get("sym", item.get("symbol", ""))),
                "rs_score": item.get("score", item.get("rs_score", 0)),
                "vol_ratio": item.get("vol_ratio", 1.0),
                "momentum": item.get("momentum", item.get("mom", 0.0)),
                "cap_tier": item.get("cap_tier", "—"),
                "thesis": item.get("thesis", ""),
            }
            for item in leadership
        ]
    else:
        result = []

    cache.set("screener", result, ttl=900)
    return result


# ─── Candidates ───────────────────────────────────────────────────────────────

_EMPTY_CANDIDATES = {
    "generated_at": None,
    "market_date": None,
    "is_premarket_window": False,
    "leading_sectors_used": [],
    "leading_sectors_source": "none",
    "note": "",
    "candidates": {"pullback_ma": [], "gapper_news": [], "remount": []},
    "counts": {"pullback_ma": 0, "gapper_news": 0, "remount": 0, "total": 0},
    "scan_meta": {"skipped_rows": 0, "deduplicated_tickers": [], "runtime_seconds": 0, "errors": []},
}


def get_candidates() -> dict:
    """Return scanner candidates. Priority: cache → wire_data["candidates"] → local file → empty structure."""
    cached = cache.get("candidates")
    if cached is not None:
        return cached

    # Try wire_data (populated by /api/push from morning wire engine)
    wire = cache.get("wire_data")
    if wire and "candidates" in wire:
        result = wire["candidates"]
        cache.set("candidates", result, ttl=1800)
        return result

    # Try local file (dev fallback)
    local_path = pathlib.Path(r"C:\Users\Patrick\uct-intelligence\data\candidates.json")
    if local_path.exists():
        try:
            result = json.loads(local_path.read_text(encoding="utf-8"))
            cache.set("candidates", result, ttl=1800)
            return result
        except Exception:
            pass

    return copy.deepcopy(_EMPTY_CANDIDATES)


# ─── UCT 20 Portfolio ──────────────────────────────────────────────────────────

def get_uct20_portfolio_data() -> dict:
    """Return UCT 20 portfolio performance data.

    Priority: cache → wire_data["uct20_portfolio"] → direct engine call (local dev).
    """
    cached = cache.get("uct20_portfolio")
    if cached is not None:
        return cached

    # Try wire_data (populated by /api/push from morning wire engine)
    wire = _load_wire_data()
    if wire and wire.get("uct20_portfolio"):
        result = wire["uct20_portfolio"]
        cache.set("uct20_portfolio", result, ttl=3600)
        return result

    # Local dev fallback: call engine directly
    try:
        _UCT_INTEL_PATH = r"C:\Users\Patrick\uct-intelligence"
        if _UCT_INTEL_PATH not in sys.path:
            sys.path.insert(0, _UCT_INTEL_PATH)
        import uct_intelligence.api as _uct_api
        result = _uct_api.get_uct20_portfolio(account_size=50000)
        if result:
            cache.set("uct20_portfolio", result, ttl=3600)
            return result
    except Exception as e:
        _logger.warning("get_uct20_portfolio_data local fallback failed: %s", e)

    return {}


def get_analyst_actions() -> dict:
    """Return analyst upgrades and downgrades from wire_data.

    Returns { upgrades: [...], downgrades: [...] }
    Each item: { ticker, action, firm, from_rating, to_rating, price_target }
    """
    cached = cache.get("analyst_actions")
    if cached is not None:
        return cached

    wire = _load_wire_data()
    actions = wire.get("analyst_actions", []) if wire else []

    UPGRADE_ACTIONS   = {"upgrade", "upgraded", "initiates", "initiated"}
    DOWNGRADE_ACTIONS = {"downgrade", "downgraded"}
    PT_RAISE_ACTIONS  = {"raises pt"}
    PT_LOWER_ACTIONS  = {"lowers pt"}

    upgrades   = [a for a in actions if a.get("action", "").lower() in UPGRADE_ACTIONS][:12]
    downgrades = [a for a in actions if a.get("action", "").lower() in DOWNGRADE_ACTIONS][:12]
    pt_changes = [a for a in actions if a.get("action", "").lower() in (PT_RAISE_ACTIONS | PT_LOWER_ACTIONS)][:15]

    result = {
        "upgrades":   upgrades,
        "downgrades": downgrades,
        "pt_changes": pt_changes,
        "summary": {
            "upgrades":   len(upgrades),
            "downgrades": len(downgrades),
            "pt_changes": len(pt_changes),
        },
    }
    cache.set("analyst_actions", result, ttl=3600)
    return result
