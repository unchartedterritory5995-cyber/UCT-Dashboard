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
import re
import json
import copy
import pathlib
import threading as _threading
import time as _time

UCT_INTEL_PATH = pathlib.Path(
    os.environ.get("UCT_INTEL_PATH", r"C:\Users\Patrick\uct-intelligence")
)

MORNING_WIRE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "morning-wire")
)
if MORNING_WIRE_PATH not in sys.path:
    sys.path.insert(0, MORNING_WIRE_PATH)

STATE_FILE = os.path.join(MORNING_WIRE_PATH, "morning_wire_state.json")
WIRE_DATA_FILE = os.path.join(MORNING_WIRE_PATH, "data", "wire_data.json")
PERSISTENT_WIRE_DATA_FILE = "/data/wire_data.json"  # Railway volume mount

from api.services import yf_util
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
                # timeout bounds a hung LLM call so it can't pin a worker thread
                # forever (the 2026-07-01 thread-exhaustion class). 60s is generous
                # for our max_tokens; the SDK still retries transient errors.
                _anthropic_client = anthropic.Anthropic(api_key=api_key, timeout=60.0)
    return _anthropic_client

# ── Earnings analysis configuration ───────────────────────────────────────────
_EARNINGS_NEWS_MAX_ITEMS    = 4        # max Finnhub headlines per ticker
_EARNINGS_AI_MAX_TOKENS         = 1800     # post-earnings: rich narrative + 5 substantive bullets
_EARNINGS_PREVIEW_AI_MAX_TOKENS = 1800     # pre-earnings: strategist-note paragraph + 5 substantive bullets
_EARNINGS_CACHE_TTL_HIT     = 43_200   # 12 h — full result cached after success
_EARNINGS_CACHE_TTL_MISS    = 300      # 5 min — retry window on failure
# `enrich_earnings_response` (earnings_enrichment.py) ALWAYS returns a dict
# with all six of these keys present (value or None) -- it never raises.
# Fewer than six keys means the 25s deadline in the fan-out cut it off before
# every leg resolved (a shed partial), and zero keys means the outer
# try/except here caught a total failure. Either way that's a fan-out
# failure, distinct from an individual leg being legitimately None (a stock
# with no options, no recent quotes, etc. — normal and NOT a reason to
# refetch). See _generate_earnings_analysis / _generate_earnings_preview.
_ENRICHMENT_LEG_KEYS = ("pre_earnings", "hist_moves", "revisions",
                        "beat_surprises", "implied_move", "key_quotes")
_FH_TIMEOUT_SECS            = 6        # Finnhub request timeout
_EARNINGS_AI_MODEL          = os.environ.get("EARNINGS_AI_MODEL", "claude-sonnet-5")  # Haiku→Sonnet 4.6 (2026-05-27)→Sonnet 5 (2026-07-12, richer previews; now generate-once + disk-persisted so the better model is affordable). Env-overridable.

_anthropic_lock = _threading.Lock()

from concurrent.futures import ThreadPoolExecutor as _ThreadPoolExecutor

# Bounded pool for pre-warm work (earnings preview/analysis background
# generation). max_workers=4 is just a general-purpose concurrency cap now —
# it used to also double as an AlphaVantage rate-limit guard (removed
# 2026-08-05, Phase 3 Task 12: AV's EARNINGS fallback and its 13s-sleep
# _av_get were deleted, FMP is the sole quarterly-history source).
_prewarm_executor = _ThreadPoolExecutor(max_workers=4, thread_name_prefix="prewarm")


def _anthropic_text(msg) -> str:
    """Concatenate the text blocks of an Anthropic message.

    Claude 5-family models (e.g. Sonnet 5) emit a ThinkingBlock BEFORE the
    TextBlock by default, so the old `msg.content[0].text` reads the thinking
    block and throws `AttributeError`. Always pick out the text block(s)."""
    parts = []
    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "text":
            t = getattr(block, "text", None)
            if t:
                parts.append(t)
    return "".join(parts).strip()


def _earnings_signals_hash(row: dict) -> str:
    """Stable SHA1 of the meaningful inputs that determine the AI output
    (mirrors the catalyst signals_hash). Skip-if-stable: a name is only re-sent
    to Claude when these change — so a stable name costs ~$0 to keep warm, and a
    preview refreshes the moment its inputs move (consensus populating N/A → real,
    a revised estimate, or the name reporting pending → actual).

    Hashes ONLY the ROW (which is passed in, not re-fetched) so it is fully
    deterministic. Fetch-derived signals (enrichment revisions/implied move, the
    churning 3-day news set) are EXCLUDED — they varied per fetch, so the hash
    never matched and it re-billed Claude every cycle."""
    import hashlib
    row = row or {}

    def _num(v):
        try:
            return round(float(v), 4)
        except (TypeError, ValueError):
            return None

    try:
        payload = {
            "eps_est":  _num(row.get("eps_estimate")),
            "rev_est":  _num(row.get("rev_estimate")),
            "eps_act":  _num(row.get("reported_eps") if row.get("reported_eps") is not None else row.get("eps_act")),
            "rev_act":  _num(row.get("rev_actual") if row.get("rev_actual") is not None else row.get("rev_act")),
            "surprise": _num(row.get("surprise_pct")),
            "date":     row.get("date") or row.get("earnings_date"),
            "timing":   (row.get("session") or row.get("when") or "").upper(),
        }
        raw = json.dumps(payload, sort_keys=True, default=str)
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()
    except Exception:
        return ""


def _parse_json_block(raw: str) -> dict:
    """Parse a JSON object from a model reply, tolerating code fences AND stray
    prose around it — Sonnet 5 occasionally adds a lead-in sentence despite the
    'JSON only' instruction, which made a strict json.loads throw (→ empty
    preview). Falls back to the outermost {...} span."""
    raw = (raw or "").strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        if len(parts) >= 2:
            raw = parts[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
    try:
        return json.loads(raw)
    except Exception:
        i, j = raw.find("{"), raw.rfind("}")
        if i != -1 and j != -1 and j > i:
            return json.loads(raw[i:j + 1])
        raise


def _fetch_quarterly_history(sym: str) -> list:
    """Fetch up to 12 quarters of EPS history from FMP `stable/earnings`.

    AlphaVantage's EARNINGS fallback was removed 2026-08-05 (data-
    dependability migration plan, Phase 3 Task 12): AV's free tier is
    capped at 25 requests/DAY (exhausted on every observation), it is
    strictly EPS-only where FMP also carries revenue, and it was the sole
    caller of `_av_get`'s 13s-sleep-under-`_av_lock` — a blocking sleep on
    the shared anyio threadpool, reachable from `GET
    /api/earnings-analysis/{sym}` on the request path (the documented
    524-outage class here). FMP was already the primary leg and answers on
    every live-probed large cap; a genuine FMP miss now returns [] rather
    than trading a 13s stall for a 25/day-exhausted second source.

    Returns a list normalized to a stable shape so existing code
    (yoy_eps_growth, beat_streak, beat_history computation) keeps working
    unchanged. Each item: {reportedDate, fiscalDateEnding, reportedEPS,
    estimatedEPS, surprise, surprisePercentage, reportTime}.

    GUARANTEED newest-first (sorted by reportedDate/fiscalDateEnding
    descending) — regardless of source. Every consumer treats index 0 as
    "most recent quarter": the YoY/beat-streak indexing right below in this
    module (`quarters[0]` vs `quarters[4]`, `quarters[:4]`), and
    `get_historical_earnings_moves`'s `moves_pct`, which `calendar.py`
    re-emits verbatim as `hist_stats.last_n`. Before this fix that ordering
    was an ASSUMPTION, not a guarantee — live-verified newest-first for FMP
    (the dominant path), but never normalized, so `calendar.py`'s downstream
    `reversed()` (written for a since-superseded AV-only, oldest-first world)
    silently flipped `last_n` to oldest-first end-to-end, mispairing every
    reaction to the wrong quarter (P2 T9 review, CRITICAL). Sorting HERE — the
    one place every consumer's input funnels through — keeps the contract
    true even for a raw/shuffled FMP response order (the AV fallback this
    docstring used to also cover was removed 2026-08-05, Phase 3 Task 12).
    """
    def _newest_first(rows: list) -> list:
        # ISO 'YYYY-MM-DD' strings sort correctly as plain strings. A blank/
        # unparseable date sorts to '' which — under reverse=True — lands
        # LAST, never masquerading as "most recent" and never corrupting the
        # index-0-is-newest contract every consumer relies on.
        return sorted(
            rows,
            key=lambda q: (q.get("reportedDate") or q.get("fiscalDateEnding") or ""),
            reverse=True,
        )

    import requests as _r
    fmp_key = os.environ.get("FMP_API_KEY", "")
    if fmp_key:
        try:
            # FMP stable/earnings is the current supported endpoint.
            # v3/earnings-surprises and v3/historical/earning_calendar are
            # legacy as of Aug 31 2025 — return 403 on new subscriptions.
            url = (
                f"https://financialmodelingprep.com/stable/earnings"
                f"?symbol={sym.upper()}&limit=20&apikey={fmp_key}"
            )
            resp = _r.get(url, timeout=8).json()
            if isinstance(resp, list) and resp:
                out = []
                for item in resp:
                    try:
                        actual = item.get("epsActual")
                        estimated = item.get("epsEstimated")
                        date_str = item.get("date")
                        # Skip future earnings (epsActual is null) — only past quarters
                        if actual is None or estimated is None or not date_str:
                            continue
                        actual_f = float(actual)
                        est_f = float(estimated)
                        surprise = actual_f - est_f
                        surprise_pct = (surprise / abs(est_f) * 100) if est_f else 0.0
                        out.append({
                            "reportedDate":       date_str,
                            "fiscalDateEnding":   date_str,
                            "reportedEPS":        str(actual_f),
                            "estimatedEPS":       str(est_f),
                            "surprise":           f"{surprise:.4f}",
                            "surprisePercentage": f"{surprise_pct:.2f}",
                            "reportTime":         "",  # FMP doesn't expose pre/post
                        })
                        # NOTE: no cap here. Capping mid-loop, in FMP's raw
                        # response order, BEFORE the sort below let a
                        # shuffled/non-monotonic provider order silently keep
                        # the wrong 12 rows — e.g. probed with 20 oldest-first
                        # rows (2010->2029), a mid-loop `if len(out)>=12: break`
                        # returned 2021-01-01 as index 0 and never reached the
                        # true newest quarter at all, even though `_newest_first`
                        # then sorted THOSE 12 correctly (P2 T9 review round 2,
                        # IMPORTANT #2 — the ORDER guarantee held, the SET
                        # guarantee didn't). `limit=20` in the URL already
                        # bounds this loop; cap AFTER sorting instead.
                    except (TypeError, ValueError):
                        continue
                if out:
                    return _newest_first(out)[:12]
        except Exception as e:
            _logger.warning("FMP quarterly history failed for %s: %s", sym, e)

    return []


def _with_retry(fn, retries: int = 1, delay: float = 2.0):
    """Call fn(); on requests.Timeout or ConnectionError, retry up to `retries` times.

    Only Finnhub calls are wrapped here (AlphaVantage's own retry/rate-limit
    path, `_av_get`, was removed 2026-08-05, Phase 3 Task 12).
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
        return _stamp_wire_status(cached)   # re-judge on every read, never cached

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

    # Stamp the payload with the wire run it came from. ⛔ Read it back off
    # wire_data rather than assuming the branch above found one: the state-file
    # and live-fetch branches legitimately have no wire behind them, and those
    # must report "unknown", never a borrowed date. Best-effort — a breadth
    # payload is worth serving even if the stamp can't be resolved.
    try:
        _w = _load_wire_data() or {}
        breadth["wire_date"] = _w.get("date") or None
    except Exception:  # noqa: BLE001
        breadth["wire_date"] = None

    cache.set("breadth", breadth, ttl=3600)
    return _stamp_wire_status(breadth)


def _stamp_wire_status(breadth: dict) -> dict:
    """Attach `wire_status`, computed at READ time.

    ⛔ THE DATE IS CACHEABLE; THE VERDICT IS NOT. `wire_date` is a fact about the
    payload and rides the 1-hour cache safely. `wire_status` is a function of NOW
    — a payload cached at 09:29 ET reads "fresh" and is still saying so at 10:29,
    which is a staleness indicator that itself goes stale: the exact defect this
    whole change exists to remove. So it is stamped on the way out of every call,
    cache hit included, and deliberately NOT stored.
    """
    if isinstance(breadth, dict):
        breadth["wire_status"] = wire_freshness(breadth.get("wire_date"))
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
        "webster_phase":   state.get("webster_phase", state.get("market_phase", "")),
    }


def expected_wire_date():
    """The most recent ET trading day whose wire run should have landed.

    The wire lands ~7:35 AM ET on weekdays; give it until 9:30 AM ET before
    expecting today's run. Weekends expect Friday's. (Holiday-naive: a market
    holiday reads as one calendar day of 'stale' — acceptable.)

    🔑 MOVED HERE FROM `engine_data._expected_wire_date` SO THERE IS ONE COPY.
    `/api/leadership` already judged staleness with this rule; the breadth and
    exposure payloads now need the same judgement, and two implementations of
    "is the wire late" would drift into two different answers on the same day.
    The router keeps its old private name as an alias.
    """
    from datetime import datetime as _dt, timedelta
    from zoneinfo import ZoneInfo
    now = _dt.now(ZoneInfo("America/New_York"))
    d = now.date()
    if now.weekday() < 5 and (now.hour, now.minute) < (9, 30):
        d = d - timedelta(days=1)
    while d.weekday() >= 5:          # roll weekend back to Friday
        d = d - timedelta(days=1)
    return d


def wire_freshness(wire_date_str) -> str:
    """'fresh' | 'stale' | 'unknown' for a wire payload's own date stamp.

    🔴 WHY THIS EXISTS. Nothing on the exposure tile rendered a date, and
    `_normalize_exposure` emitted no timestamp at all — so a rating from a run
    that never happened was pixel-identical to today's, and `score_delta` showed
    yesterday's move as today's. On 2026-08-14 the 06:35 run crashed before
    pushing and the dashboard served the prior day's rating all day with nothing
    on screen, or in the payload, able to say so.

    'unknown' is deliberately distinct from 'stale': an absent date means we
    cannot tell, and claiming staleness we cannot support is the same class of
    error as claiming freshness we cannot support.
    """
    from datetime import datetime as _dt
    if not wire_date_str:
        return "unknown"
    try:
        wire_d = _dt.fromisoformat(str(wire_date_str)[:10]).date()
    except (ValueError, TypeError):
        return "unknown"
    return "fresh" if wire_d >= expected_wire_date() else "stale"


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

# Curated-only themes carry their theme *id* (lowercase snake, e.g.
# "ai_gpu_chips", "mortgage_reits") as the wire key instead of a real ETF
# ticker. Snapshotting those against Massive is pure noise (they read as
# delisted tickers) — filter them out of every live-quote batch.
_PSEUDO_TICKER_RE = re.compile(r"[a-z0-9_]+")


def _snapshot_real_etfs(keys):
    """Batch-snapshot only the REAL ETF tickers among the wire theme keys —
    curated-only pseudo-tickers (lowercase snake theme ids) are skipped.
    Returns the snapshot map ({} when nothing real to quote).

    get_etf_snapshots resolves through module globals first so tests can patch
    it on this module; otherwise falls back to the lazy massive import (the
    module-level circular-import guard used across engine.py)."""
    real = [k for k in (keys or []) if not _PSEUDO_TICKER_RE.fullmatch(k or "")]
    if not real:
        return {}
    snap_fn = globals().get("get_etf_snapshots")
    if snap_fn is None:
        from api.services.massive import get_etf_snapshots as snap_fn
    return snap_fn(real) or {}


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

        snap = _snapshot_real_etfs(tickers)

        synthetic = {}
        for ticker, data in wire_themes.items():
            if not isinstance(data, dict):
                continue
            if _PSEUDO_TICKER_RE.fullmatch(ticker or ""):
                # Curated-only theme — no live ETF to quote. Renderers already
                # handle a missing Today value.
                synthetic[ticker] = {**data, "Today": None}
            else:
                # `Number(null) === 0` in Python form: defaulting a missing
                # snapshot to 0.0 rendered EVERY theme at exactly +0.00% on a
                # Massive outage/miss, indistinguishable from a real flat
                # print. The curated-only branch two lines up already gets
                # this right (`"Today": None`) — match it here.
                synthetic[ticker] = {**data, "Today": snap.get(ticker)}

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
            # This branch only fires when the direct `morning_wire_engine`
            # import succeeds at all (local-dev fallback only — production
            # reaches themes via wire_data/`/api/push`) but the fetch itself
            # raises: always a failure, never a legitimate empty result. A 1h
            # TTL on an error placeholder used to outlive most local-dev
            # sessions; retry in a few minutes instead.
            result = {"leaders": [], "laggards": [], "period": period, "error": str(e)}
            cache.set(cache_key, result, ttl=300)
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
        # `data.get(period, 0) or 0` used to collapse an EXPLICIT None (the
        # "Today" branch's honest "no snapshot" value, see get_themes) right
        # back into a fabricated 0 -- `.get(key, default)` only substitutes
        # the default when the KEY is absent, not when its value is None, so
        # the `or 0` was doing that collapsing instead. Every theme rendered
        # at exactly +0.00% on a snapshot miss, indistinguishable from a
        # genuinely flat print.
        pct_val = data.get(period)
        pct_str = f"{pct_val:+.2f}%" if isinstance(pct_val, (int, float)) else str(pct_val)
        bar = min(100, max(0, abs(pct_val) * 8)) if isinstance(pct_val, (int, float)) else 50

        from api.services import delisted_registry
        raw_holdings = data.get("holdings", [])
        holdings = [
            h["sym"] for h in raw_holdings
            if isinstance(h, dict) and h.get("sym")
            and not delisted_registry.is_delisted(h["sym"])
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

    # None-valued items sink to the end deterministically (tuple compares
    # the "is missing" flag first) instead of raising `TypeError: '>=' not
    # supported between instances of 'NoneType' and 'int'`.
    items.sort(key=lambda x: (x["pct_val"] is None, x["pct_val"] or 0), reverse=True)

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

    # A theme whose period value is honestly absent is excluded from the
    # ranked leaders/laggards split rather than fabricated into either
    # bucket at a fake 0.00% — absent renders as absent.
    leaders  = [clean(i) for i in items if i["pct_val"] is not None and i["pct_val"] >= 0]
    laggards = [clean(i) for i in reversed(items) if i["pct_val"] is not None and i["pct_val"] < 0]

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


def _fmp_calendar_actuals_for_day(day_iso: str) -> dict:
    """FMP `stable/earnings-calendar` for exactly ONE calendar day, keyed by
    symbol -> raw FMP row. ONE call, scoped to a single day — a multi-day FMP
    calendar call silently truncates and is NOT date-fair (live-measured,
    `api/services/implied_store.py:384-398`; the same idiom
    `api/routers/calendar.py::_fmp_calendar_day` mirrors).

    Used only as a breadth fallback in `get_earnings()`, to fill missing
    ACTUALS on entries whose bmo/amc session ALREADY came from
    EarningsWhispers/wire/Finnhub — never to invent a new bmo/amc member (FMP
    carries no session field, so adding one would fabricate a session the
    same way coercing `tbd` into `amc` would). Returns {} on failure/missing
    key; never raises."""
    fmp_key = os.environ.get("FMP_API_KEY", "")
    if not fmp_key:
        return {}
    import requests as _r
    try:
        resp = _r.get(
            "https://financialmodelingprep.com/stable/earnings-calendar",
            params={"from": day_iso, "to": day_iso, "apikey": fmp_key},
            timeout=8,
        )
        if not resp.ok:
            return {}
        data = resp.json()
    except Exception as e:
        _logger.warning("get_earnings: FMP calendar fetch failed for %s: %s", day_iso, e)
        return {}
    if not isinstance(data, list):
        return {}
    out = {}
    for row in data:
        if not isinstance(row, dict):
            continue
        sym = (row.get("symbol") or "").strip().upper()
        if sym:
            out[sym] = row
    return out


def get_earnings() -> dict:
    cached = cache.get("earnings")
    if cached:
        return cached

    import datetime
    today     = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    # Read once, up front, so it is defined in EVERY branch below (both the
    # `not ew_ok` and `ew_ok` paths reach the "today AMC" Finnhub patch a few
    # dozen lines down) — it used to be assigned only inside the `ew_ok`
    # branch, which raised NameError on the second `if fh_key:` whenever
    # EarningsWhispers failed (a live provider-outage combination that simply
    # never got exercised by a test).
    fh_key = os.environ.get("FINNHUB_API_KEY")

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
        pending_syms = {
            e["symbol"] for e in (bmo_raw + amc_raw)
            if e.get("eps_actual") is None
        }
        if pending_syms and fh_key:
            try:
                # Routed through the shared finnhub_client.fh_get
                # (2026-08-05) so this market-wide range call shares the
                # process-wide token bucket / 429 cooldown with every
                # other Finnhub caller — a raw requests.get here spent the
                # SAME account budget with no coordination (see
                # finnhub_client.py's module docstring).
                from api.services.finnhub_client import fh_get as _fh_budgeted_cal
                fh_data = _fh_budgeted_cal(
                    "/calendar/earnings", {"from": yesterday, "to": today}, timeout=15,
                )
                fh_map = {
                    e["symbol"]: e
                    for e in (fh_data or {}).get("earningsCalendar", [])
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

        # ── FMP breadth fallback — fills whatever Finnhub still left pending
        # (throttle/429/missing key). Two per-day calls (yesterday, today),
        # never one call spanning both (see `_fmp_calendar_actuals_for_day`).
        # Only ever fills a null field on an EXISTING entry — never adds a
        # new bmo/amc member (FMP carries no session field).
        still_pending = {
            e["symbol"] for e in (bmo_raw + amc_raw)
            if e.get("eps_actual") is None
        }
        if still_pending:
            try:
                fmp_map = {}
                for d_iso in {yesterday, today}:
                    fmp_map.update(_fmp_calendar_actuals_for_day(d_iso))
                for entry in (bmo_raw + amc_raw):
                    if entry.get("eps_actual") is not None:
                        continue
                    fr = fmp_map.get(entry["symbol"])
                    if fr and fr.get("epsActual") is not None:
                        rev_a = fr.get("revenueActual")
                        rev_e = fr.get("revenueEstimated")
                        entry["eps_actual"]   = fr["epsActual"]
                        entry["eps_estimate"] = entry.get("eps_estimate") or fr.get("epsEstimated")
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

    # Finnhub patch + supplement: patch EW entries that already reported,
    # and add Finnhub-only AMC reporters not tracked by EarningsWhispers.
    if fh_key:
        ew_syms = {e["symbol"] for e in amc_tonight_raw}
        try:
            # Same shared-budget routing as the range call above.
            from api.services.finnhub_client import fh_get as _fh_budgeted_cal2
            fh_data2 = _fh_budgeted_cal2(
                "/calendar/earnings", {"from": today, "to": today}, timeout=15,
            )
            fh_today_amc = [
                e for e in (fh_data2 or {}).get("earningsCalendar", [])
                if e.get("hour", "").lower() == "amc"
            ]
            fh_by_sym = {e["symbol"]: e for e in fh_today_amc}

            # Patch existing EW entries with actuals from Finnhub
            for entry in amc_tonight_raw:
                if entry.get("eps_actual") is not None:
                    continue
                fh = fh_by_sym.get(entry["symbol"])
                if fh and fh.get("epsActual") is not None:
                    rev_a = fh.get("revenueActual")
                    rev_e = fh.get("revenueEstimate")
                    entry["eps_actual"]   = fh["epsActual"]
                    entry["eps_estimate"] = entry.get("eps_estimate") or fh.get("epsEstimate")
                    entry["rev_actual"]   = (rev_a / 1_000_000) if rev_a else None
                    entry["rev_estimate"] = entry.get("rev_estimate") or (
                        (rev_e / 1_000_000) if rev_e else None
                    )

            # Add Finnhub-only AMC reporters not tracked by EarningsWhispers
            for fh in fh_today_amc:
                sym = fh.get("symbol", "")
                if not sym or sym in ew_syms:
                    continue
                rev_a = fh.get("revenueActual")
                rev_e = fh.get("revenueEstimate")
                amc_tonight_raw.append({
                    "symbol":       sym,
                    "hour":         "amc",
                    "eps_actual":   fh.get("epsActual"),
                    "eps_estimate": fh.get("epsEstimate"),
                    "rev_actual":   (rev_a / 1_000_000) if rev_a else None,
                    "rev_estimate": (rev_e / 1_000_000) if rev_e else None,
                    "ew_total":     0,
                })
        except Exception:
            pass

    # ── FMP breadth fallback — fills whatever is STILL pending on tonight's
    # AMC list (Finnhub throttle/429/missing key). Patches EXISTING entries
    # only — it never adds a new AMC member: FMP's `stable/earnings-calendar`
    # carries no session field, so an FMP-only symbol has no confirmed
    # session to be added under (the same rule that keeps an unconfirmed
    # `hour` in `tbd`, never coerced into `amc`, on the Calendar page).
    if any(e.get("eps_actual") is None for e in amc_tonight_raw):
        try:
            fmp_today_map = _fmp_calendar_actuals_for_day(today)
            for entry in amc_tonight_raw:
                if entry.get("eps_actual") is not None:
                    continue
                fr = fmp_today_map.get(entry["symbol"])
                if fr and fr.get("epsActual") is not None:
                    rev_a = fr.get("revenueActual")
                    rev_e = fr.get("revenueEstimated")
                    entry["eps_actual"]   = fr["epsActual"]
                    entry["eps_estimate"] = entry.get("eps_estimate") or fr.get("epsEstimated")
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


def _generate_earnings_analysis(sym: str, row: dict | None, force_fresh_check: bool = False) -> dict:
    """Generate Claude Haiku earnings analysis + fetch AV history + Finnhub news. Cached 12h.

    force_fresh_check (background warm): skip the fast mem/disk return and
    re-check the inputs' signals_hash, regenerating only if they changed.

    Cache key is versioned (v2) — bumped when the strategist-note prompt
    redesign shipped so users get fresh richer output instead of short
    bullets cached under v1.
    """
    cache_key = f"earnings_analysis_v2_{sym}"
    from api.services import earnings_ai_store as _ai_store
    if not force_fresh_check:
        cached = cache.get(cache_key)
        if cached:
            return cached
        # Disk-persisted hit (survives redeploys) → generate-once, zero re-burn.
        _disk = _ai_store.get("analysis", sym)
        if _disk:
            cache.set(cache_key, _disk, ttl=_EARNINGS_CACHE_TTL_HIT)
            return _disk

    # ── Skip-if-stable (from the row, before any fetch): reuse the persisted
    #    analysis when the reported figures / surprise are unchanged. ──
    _sig = _earnings_signals_hash(row)
    _prior = _ai_store.read("analysis", sym)
    if (_prior and _prior.get("analysis") is not None
            and _prior.get("signals_hash") and _prior.get("signals_hash") == _sig):
        cache.set(cache_key, _prior, ttl=_EARNINGS_CACHE_TTL_HIT)
        _ai_store.touch("analysis", sym)
        return _prior

    import datetime as _dt
    import requests as _req

    # ── Step 1: Quarterly EPS history (FMP; see _fetch_quarterly_history) ────
    yoy_eps_growth = None
    beat_streak    = None
    beat_history   = []       # visual pattern e.g. ["✗","✓","✓","✓"] oldest→newest
    quarters       = _fetch_quarterly_history(sym)
    try:
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
        _logger.warning("Quarterly history processing failed for %s: %s", sym, _e)

    # ── Step 2: Finnhub company news (last 3 days, up to 4 items) ────────────
    news_items = []
    try:
        today_str = _dt.date.today().isoformat()
        from_str  = (_dt.date.today() - _dt.timedelta(days=3)).isoformat()
        # Routed through the budgeted _fh_get so per-symbol news sweeps share
        # the global 429 cooldown / junk-symbol skip instead of hammering an
        # exhausted rate bucket with a raw request per reporter.
        from api.services.earnings_estimates import _fh_get as _fh_budgeted
        fh_resp = _fh_budgeted(
            "/company-news",
            {"symbol": sym, "from": from_str, "to": today_str},
            timeout=_FH_TIMEOUT_SECS,
        )
        if fh_resp is None:
            fh_resp = []  # budget-shed or failed — _fh_get already logged it
        elif not isinstance(fh_resp, list):
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

    # ── Step 3: Run enrichment FIRST so the AI prompt can use it ──────────────
    # All best-effort — each helper returns None on failure. Running this before
    # the AI call lets the model see implied move, historical move, revisions,
    # pre-earnings price action, and beat magnitudes for a much richer analysis.
    enrichment = {}
    try:
        from api.services.earnings_enrichment import enrich_earnings_response
        earnings_date = (row or {}).get("date") or (row or {}).get("earnings_date")
        enrichment = enrich_earnings_response(sym, quarters or [], earnings_date)
    except Exception as _e:
        _logger.warning("enrichment failed for %s (analysis): %s", sym, _e)

    # ── Step 4: AI analysis (non-Pending only, JSON-structured) ───────────────
    analysis = None
    analysis_headline = None
    analysis_summary = None
    analysis_bullets = []
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

            # Build a dense, trader-focused context block from all enrichment data
            ctx = []
            ctx.append(
                f"Verdict: {row.get('verdict', 'N/A')} · "
                f"EPS {_fmt_eps(row.get('eps_estimate'))} → "
                f"{_fmt_eps(row.get('reported_eps'))} "
                f"({row.get('surprise_pct', 'N/A')} surprise)"
            )
            ctx.append(
                f"Revenue {_fmt_rev(row.get('rev_estimate'))} → "
                f"{_fmt_rev(row.get('rev_actual'))} "
                f"({row.get('rev_surprise_pct', 'N/A')} surprise)"
            )
            # Pre-earnings setup — what the stock did into the print
            pe = enrichment.get("pre_earnings") or {}
            if pe.get("label"):
                ctx.append(f"Heading in: {pe['label']}")
            # Reaction vs implied/historical — was move expected?
            im = enrichment.get("implied_move") or {}
            hm = enrichment.get("hist_moves") or {}
            reaction_parts = [f"Stock reaction: {gap_str}"]
            if im.get("pct"):
                reaction_parts.append(f"options implied ±{im['pct']}%")
            if hm.get("avg_abs_move_pct"):
                reaction_parts.append(
                    f"hist avg ±{hm['avg_abs_move_pct']}% over "
                    f"last {hm.get('n_quarters', '?')} reports"
                )
            ctx.append(" · ".join(reaction_parts))
            # Beat history with magnitudes (not just count)
            bs = enrichment.get("beat_surprises") or []
            if bs:
                recent = bs[:4]
                mags = ", ".join(
                    f"{'+' if s['surprise_pct'] >= 0 else ''}{s['surprise_pct']}%"
                    for s in recent
                )
                ctx.append(f"Last 4 EPS surprises (most recent first): {mags}")
            elif beat_streak:
                ctx.append(f"Beat history: {beat_streak}")
            # YoY direction
            if yoy_eps_growth:
                ctx.append(f"YoY EPS: {yoy_eps_growth}")
            # Estimate / analyst revision trend going in
            rv = enrichment.get("revisions") or {}
            if rv.get("label"):
                ctx.append(f"Pre-print revisions: {rv['label']}")
            # Key quotes from prior call (if available — gives signal on guidance shifts)
            kq = enrichment.get("key_quotes") or []
            if kq:
                top_quotes = kq[:2]
                quote_lines = " | ".join(
                    f"[{q.get('topic', 'topic')}] {q.get('text', '')[:140]}"
                    for q in top_quotes
                    if q.get("text")
                )
                if quote_lines:
                    ctx.append(f"Prior call quotes: {quote_lines}")
            # Recent headlines — top 3
            if news_items:
                top_news = news_items[:3]
                heads = " · ".join(
                    f"{n['headline']}"
                    for n in top_news
                    if n.get("headline")
                )
                if heads:
                    ctx.append(f"Recent news: {heads}")

            context_block = "\n".join(f"- {line}" for line in ctx)

            prompt = (
                f"You are a senior buy-side options strategist writing a "
                f"post-earnings briefing for {sym}'s earnings print that just "
                f"released. Your job is to produce a detailed, specific, "
                f"trader-actionable analysis that pulls from your knowledge of "
                f"this company's business model, segment dynamics, peer competitive "
                f"positioning, and prior management commentary — combined with the "
                f"LIVE PRINT DATA below.\n\n"
                f"==== LIVE PRINT DATA ====\n{context_block}\n\n"
                "==== HOW TO THINK ====\n"
                f"Before writing, draw on what you know about {sym}:\n"
                "  - Which 2-3 SPECIFIC business segments or product lines drove "
                "the surprise (or miss) — name them concretely (Reels, Cloud, "
                "iPhone, Data Center, Networking, etc.)\n"
                "  - The named KPIs the buy-side actually models for this "
                "company (DAU growth, take rate, ARPU, segment margin, AI/cloud "
                "growth %, ad pricing, subs net adds, capex absorption — pick "
                "what's specific to THIS company)\n"
                "  - The recent earnings narrative arc — did this print extend "
                "the streak, break it, accelerate, or signal transition? Use "
                "the surprise magnitudes and YoY context above.\n"
                "  - What management's prior guidance said vs what they likely "
                "said today on the call — frame the guidance trajectory\n"
                "  - Whether the stock reaction was IN-line, UNDER-, or OVER- "
                "the options-implied move — and what that says about positioning\n"
                "  - Macro/peer dynamics relevant to this name (peer prints, "
                "AI capex cycle, ad market, rates, regulatory)\n\n"
                "==== OUTPUT FORMAT ====\n"
                "Return JSON only — no markdown fences, no preamble outside the JSON:\n"
                "{\n"
                '  "headline": "<1-2 sentence verdict that captures the print + '
                "reaction in trader terms — e.g., 'Q1 came in $0.12 ahead on the "
                "line but light on data center; stock sold the news inside the "
                'implied move\'>",\n'
                '  "summary": "<5-8 sentence strategist-note paragraph: (1) what '
                "the company reported with specific surprise %, (2) what the most "
                "important segment(s) or KPI(s) did or implied, (3) how the stock "
                "reaction compares to the options-implied move and historical "
                "move and what that means for positioning, (4) what guidance "
                "signaled for forward (specific bracket / segment / margin), (5) "
                "where the print fits in the recent narrative arc (extend "
                "beat-and-raise / break it / accelerate / decelerate), (6) what "
                'the buy-side debate is going forward.>",\n'
                '  "bullets": [\n'
                '    "<THE PRINT: EPS and revenue surprise magnitudes (quote '
                "them) + what they say about underlying business health vs the "
                'prior trend. 60-90 words.>",\n'
                '    "<REACTION DECODED: actual stock move vs implied move vs '
                "historical — was this in-line, under-, or over- expected? "
                "What does that say about positioning, expectations, and "
                'whether the move is fadeable or extendable? 60-90 words.>",\n'
                '    "<TREND CONSISTENCY: how this print fits vs the last 4 '
                "surprise magnitudes and YoY trajectory — accelerating, "
                'decelerating, breaking, or stable? Quote the magnitudes. 60-90 words.>",\n'
                '    "<GUIDANCE / OUTLOOK: what the company said (or implied) '
                "about forward — be specific to a metric/segment/range. If "
                'missing, name the gap and what was expected. 60-90 words.>",\n'
                '    "<NEXT CATALYST OR RISK: a SPECIFIC event/segment/KPI to '
                "watch into next quarter — name it concretely (margin line, "
                "segment growth rate, capex digestion, peer print, regulatory "
                'event, etc.). 60-90 words.>"\n'
                '  ]\n'
                "}\n\n"
                "==== RULES ====\n"
                f"- Be SPECIFIC to {sym}'s actual business. Don't write generic "
                "'investors will watch' when you can write 'AWS growth rate "
                "deceleration vs Azure' or 'iPhone ASP and India mix.'\n"
                "- QUOTE real numbers from CONTEXT (surprise %, gap %, implied "
                "move, historical move). These are not optional — they are the "
                "spine of the briefing.\n"
                "- Use your training knowledge of this company's segments, "
                "prior management commentary, and peer dynamics — but don't "
                "fabricate specific numbers you don't have. Frame uncertain "
                "ranges qualitatively.\n"
                "- No directional trade calls. Surface signal, asymmetry, and "
                "tradeable structure only.\n"
                "- Aim for the depth of a strategist's morning note (think: a "
                "well-written sell-side post-earnings recap), not a press release."
            )

            client = _get_anthropic_client()
            msg = client.messages.create(
                model=_EARNINGS_AI_MODEL,
                max_tokens=_EARNINGS_AI_MAX_TOKENS,
                # Claude 5 models emit a thinking block by default, which eats
                # into max_tokens and truncates our structured-JSON output. We
                # don't need reasoning for a formatted note — disable it (faster,
                # cheaper, deterministic single text block).
                thinking={"type": "disabled"},
                metadata={"user_id": "earnings_analysis:global"},
                messages=[{"role": "user", "content": prompt}],
            )
            parsed = _parse_json_block(_anthropic_text(msg))
            analysis_headline = str(parsed.get("headline", "")).strip()
            analysis_summary  = str(parsed.get("summary",  "")).strip()
            analysis_bullets  = [str(b).strip() for b in parsed.get("bullets", [])[:5]]
            # Populate legacy `analysis` field — prefer summary, fall back to headline
            analysis = analysis_summary or analysis_headline
        except Exception as _e:
            _logger.warning("AI analysis failed for %s: %s", sym, _e, exc_info=True)
            analysis = None
            analysis_headline = None
            analysis_summary  = None
            analysis_bullets = []

    result = {
        "sym":               sym,
        "analysis":          analysis,
        "analysis_headline": analysis_headline,
        "analysis_summary":  analysis_summary,
        "analysis_bullets":  analysis_bullets,
        "yoy_eps_growth":    yoy_eps_growth,
        "beat_streak":       beat_streak,
        "beat_history":      beat_history,
        "news":              news_items,
        # Enrichment (may be None)
        "pre_earnings":      enrichment.get("pre_earnings"),
        "hist_moves":        enrichment.get("hist_moves"),
        "revisions":         enrichment.get("revisions"),
        "beat_surprises":    enrichment.get("beat_surprises"),
        "implied_move":      enrichment.get("implied_move"),
        "key_quotes":        enrichment.get("key_quotes"),
        "signals_hash":      _sig,   # inputs fingerprint for skip-if-stable
    }
    # TTL/persist decided on the AI leg alone used to let a total enrichment
    # fan-out failure (pre_earnings/hist_moves/revisions/beat_surprises/
    # implied_move/key_quotes ALL missing) get the full 12h TTL and a
    # PERMANENT disk write as long as Claude itself produced text. Since
    # `signals_hash` is derived only from `row` (deliberately, to avoid
    # re-billing Claude every cycle over churning fetch data — see
    # `_earnings_signals_hash`), a disk-persisted partial would satisfy the
    # skip-if-stable reuse check forever and never get a chance to re-fetch
    # the missing legs.
    enrichment_complete = all(k in enrichment for k in _ENRICHMENT_LEG_KEYS)
    complete = analysis is not None and enrichment_complete
    ttl = _EARNINGS_CACHE_TTL_HIT if complete else _EARNINGS_CACHE_TTL_MISS
    cache.set(cache_key, result, ttl=ttl)
    if complete:
        _ai_store.put("analysis", sym, result)   # persist only real, complete output
    return result


def _generate_earnings_preview(sym: str, row: dict | None, force_fresh_check: bool = False) -> dict:
    """Generate forward-looking AI preview for Pending earnings entries. Cached 12h.

    row may be None or {} (e.g., when called for a future calendar entry not in
    today's bmo/amc); the function falls back to N/A for missing context.

    force_fresh_check (background warm path): skip the fast mem/disk return and
    re-fetch inputs to compare their signals_hash — regenerating via Claude ONLY
    if the inputs changed (skip-if-stable). The user-facing click path leaves it
    False so a cached preview is served instantly.

    Cache key is versioned (v2) — bumped when the strategist-note prompt
    redesign shipped so users get fresh richer output instead of short
    bullets cached under v1.
    """
    if row is None:
        row = {"sym": sym}
    cache_key = f"earnings_preview_v2_{sym}"
    from api.services import earnings_ai_store as _ai_store
    if not force_fresh_check:
        cached = cache.get(cache_key)
        if cached:
            return cached
        # Disk-persisted hit (survives Railway redeploys) → warm the hot cache
        # and return without spending tokens. Generate-once for the click path.
        _disk = _ai_store.get("preview", sym)
        if _disk:
            cache.set(cache_key, _disk, ttl=_EARNINGS_CACHE_TTL_HIT)
            return _disk

    # ── Skip-if-stable (computed from the row BEFORE any fetch): if the persisted
    #    preview was built from the same inputs, reuse it — skip the input fetches
    #    AND Claude entirely. Regenerates only when the inputs move. ──
    _sig = _earnings_signals_hash(row)
    _prior = _ai_store.read("preview", sym)
    if (_prior and _prior.get("preview_text")
            and _prior.get("signals_hash") and _prior.get("signals_hash") == _sig):
        cache.set(cache_key, _prior, ttl=_EARNINGS_CACHE_TTL_HIT)
        _ai_store.touch("preview", sym)
        return _prior

    import datetime as _dt
    import requests as _req

    # ── Step 1: Quarterly EPS history (FMP; see _fetch_quarterly_history) ────
    yoy_eps_growth = None
    beat_streak    = None
    beat_history   = []
    quarters       = _fetch_quarterly_history(sym)
    try:

        def _to_f(v):
            try: return float(v)
            except (TypeError, ValueError): return None

        if len(quarters) >= 5:
            q0 = _to_f(quarters[0].get("reportedEPS"))
            q4 = _to_f(quarters[4].get("reportedEPS"))
            if q0 is not None and q4 is not None and q4 != 0:
                pct  = (q0 - q4) / abs(q4) * 100
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
            for _q in reversed(quarters[:4]):
                _r = _to_f(_q.get("reportedEPS"))
                _e = _to_f(_q.get("estimatedEPS"))
                if _r is not None and _e is not None:
                    beat_history.append("✓" if _r >= _e else "✗")
                else:
                    beat_history.append("—")
    except Exception as _e:
        _logger.warning("Quarterly history processing failed for %s (preview): %s", sym, _e)

    # ── Step 2: Finnhub company news (last 3 days, up to 4 items) ─────────────
    news_items = []
    try:
        today_str = _dt.date.today().isoformat()
        from_str  = (_dt.date.today() - _dt.timedelta(days=3)).isoformat()
        # Routed through the budgeted _fh_get so per-symbol news sweeps share
        # the global 429 cooldown / junk-symbol skip instead of hammering an
        # exhausted rate bucket with a raw request per reporter.
        from api.services.earnings_estimates import _fh_get as _fh_budgeted
        fh_resp = _fh_budgeted(
            "/company-news",
            {"symbol": sym, "from": from_str, "to": today_str},
            timeout=_FH_TIMEOUT_SECS,
        )
        if fh_resp is None:
            fh_resp = []  # budget-shed or failed — _fh_get already logged it
        elif not isinstance(fh_resp, list):
            raise ValueError(f"Finnhub returned unexpected shape: {type(fh_resp)}")
        for item in fh_resp[:_EARNINGS_NEWS_MAX_ITEMS]:
            ts = item.get("datetime", 0)
            try:
                _d    = _dt.datetime.fromtimestamp(ts)
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
        _logger.warning("Finnhub news fetch failed for %s (preview): %s", sym, _e)

    # ── Step 3: Run enrichment FIRST so the AI prompt can use it ──────────────
    # All best-effort — each helper returns None on failure. Running this before
    # the AI call lets the model see implied move, historical move, revisions,
    # pre-earnings price action, and beat magnitudes for a much richer preview.
    enrichment = {}
    try:
        from api.services.earnings_enrichment import enrich_earnings_response
        earnings_date = row.get("date") or row.get("earnings_date")
        enrichment = enrich_earnings_response(sym, quarters or [], earnings_date)
    except Exception as _e:
        _logger.warning("enrichment failed for %s (preview): %s", sym, _e)

    # ── Step 4: AI preview (forward-looking, JSON-structured) ─────────────────
    preview_text    = ""
    preview_bullets = []
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

        # ── Build a dense, strategist-note-quality context block ──────────────
        ctx = []
        # Report timing + date framing
        timing_label = (row.get("session") or row.get("when") or "").upper()
        timing_str = (
            "before the open" if timing_label in ("BMO", "BEFORE", "PRE")
            else "after the close" if timing_label in ("AMC", "AFTER", "POST")
            else ""
        )
        report_date = row.get("date") or row.get("earnings_date") or ""
        when_parts = [p for p in [report_date, timing_str] if p]
        if when_parts:
            ctx.append(f"Report timing: {' '.join(when_parts)}")
        # Consensus (the number to beat)
        ctx.append(
            f"Street consensus: EPS {_fmt_eps(row.get('eps_estimate'))} · "
            f"Revenue {_fmt_rev(row.get('rev_estimate'))}"
        )
        # Most recent reported quarter (for beat-and-raise / accel/decel framing)
        if quarters:
            q0 = quarters[0]
            q0_rep = q0.get("reportedEPS")
            q0_est = q0.get("estimatedEPS")
            q0_date = q0.get("fiscalDateEnding") or q0.get("date") or ""
            q0_surp = q0.get("surprisePercentage")
            try:
                q0_rep_f = float(q0_rep) if q0_rep is not None else None
                q0_est_f = float(q0_est) if q0_est is not None else None
            except (TypeError, ValueError):
                q0_rep_f = q0_est_f = None
            if q0_rep_f is not None and q0_est_f is not None:
                surp_str = ""
                try:
                    if q0_surp is not None:
                        surp_str = f" ({float(q0_surp):+.1f}% surprise)"
                except (TypeError, ValueError):
                    pass
                ctx.append(
                    f"Last reported quarter ({q0_date}): EPS "
                    f"{_fmt_eps(q0_rep_f)} vs {_fmt_eps(q0_est_f)} consensus"
                    f"{surp_str}"
                )
        # Pre-earnings price action — multi-window, not just intraday gap
        pe = enrichment.get("pre_earnings") or {}
        if pe.get("label"):
            ctx.append(f"Heading in: {pe['label']}")
        elif change_pct is not None:
            ctx.append(f"Today's gap: {gap_str}")
        # Implied move vs historical move — the #1 trader question
        im = enrichment.get("implied_move") or {}
        hm = enrichment.get("hist_moves") or {}
        if im.get("pct") and hm.get("avg_abs_move_pct"):
            ctx.append(
                f"Options imply ±{im['pct']}% move (front-week ATM straddle); "
                f"historical avg ±{hm['avg_abs_move_pct']}% over last "
                f"{hm.get('n_quarters', '?')} reports"
            )
        elif im.get("pct"):
            ctx.append(f"Options imply ±{im['pct']}% (front-week ATM straddle)")
        elif hm.get("avg_abs_move_pct"):
            ctx.append(
                f"Historical avg earnings move ±{hm['avg_abs_move_pct']}% over "
                f"last {hm.get('n_quarters', '?')} reports"
            )
        # Beat history with magnitudes (not just count)
        bs = enrichment.get("beat_surprises") or []
        if bs:
            recent = bs[:4]
            mags = ", ".join(
                f"{'+' if s['surprise_pct'] >= 0 else ''}{s['surprise_pct']}%"
                for s in recent
            )
            ctx.append(f"Last 4 EPS surprises (most recent first): {mags}")
        elif beat_streak:
            ctx.append(f"Beat history: {beat_streak}")
        # YoY direction
        if yoy_eps_growth:
            ctx.append(f"YoY EPS growth (most recent quarter vs year-ago): {yoy_eps_growth}")
        # Estimate / analyst revision trend
        rv = enrichment.get("revisions") or {}
        if rv.get("label"):
            ctx.append(f"Pre-print analyst revisions: {rv['label']}")
        # Recent headlines — top 3 with sources
        if news_items:
            top_news = news_items[:3]
            heads = " · ".join(
                f"{n['headline']}"
                for n in top_news
                if n.get("headline")
            )
            if heads:
                ctx.append(f"Recent news (last 3 days): {heads}")

        context_block = "\n".join(f"- {line}" for line in ctx)

        prompt = (
            f"You are a senior buy-side options strategist writing a pre-earnings "
            f"briefing for {sym}'s upcoming report. Your job is to produce a "
            f"detailed, specific, trader-actionable preview that pulls from your "
            f"knowledge of this company's business model, recent earnings narrative, "
            f"segment dynamics, peer competitive positioning, and prior management "
            f"commentary — combined with the LIVE SETUP DATA below.\n\n"
            f"==== LIVE SETUP DATA ====\n{context_block}\n\n"
            "==== HOW TO THINK ====\n"
            f"Before writing, draw on what you know about {sym}:\n"
            "  - The 2-3 SPECIFIC business segments or product lines that drive "
            "this print (name them — Reels, Cloud, iPhone, Data Center, Networking, etc.)\n"
            "  - The named KPIs the buy-side actually models for this company "
            "(DAU growth, take rate, ARPU, segment margin, AI/cloud growth %, "
            "ad pricing, subs net adds, capex absorption — pick what's specific to THIS company)\n"
            "  - The recent earnings narrative arc (beat-and-raise streak, "
            "deceleration, transition phase, turnaround, accelerating into AI cycle, "
            "etc.) using the surprise magnitudes and YoY context above\n"
            "  - The forward guidance brackets management gave on the prior call "
            "if you remember them (revenue growth range, capex range, segment color) "
            "— if you don't remember exact numbers, frame the bracket qualitatively rather than fabricate\n"
            "  - The macro/peer dynamics in play right now relevant to this name "
            "(peer prints, AI capex cycle, ad market trends, rates, regulatory)\n\n"
            "==== OUTPUT FORMAT ====\n"
            "Return JSON only — no markdown fences, no preamble outside the JSON:\n"
            "{\n"
            '  "preview": "<5-8 sentence strategist-note paragraph that reads '
            "like a buy-side morning note. MUST include: (1) company + report "
            "date/timing framing, (2) specific consensus EPS and revenue + "
            "implied YoY % growth, (3) what the last reported quarter did and "
            "the narrative arc that creates (beat-and-raise / accelerating / "
            "decelerating / transition), (4) the 2-3 specific business drivers "
            "that determine this print outcome — named segments and KPIs, (5) "
            "what management's prior guidance signals or the bracket the buy-side "
            "is watching, (6) a binary or trinary scenario setup framed against "
            "the implied move (clean beat → reaction; in-line/soft → fade; "
            "miss → downside). Reference real numbers, real segment names, real KPIs.>\","
            "\n"
            '  "bullets": [\n'
            '    "<THE BACKDROP: Recent narrative arc — quote the last 4 surprise '
            "magnitudes from CONTEXT and frame what this print needs to do to "
            'extend or break the arc. 60-90 words.>",\n'
            '    "<BUSINESS DRIVERS: The 2-3 specific segments, products, or '
            "KPIs that determine print outcome — name them concretely (e.g., "
            "'Reels monetization,' 'AWS growth rate,' 'iPhone ASP,' 'cloud "
            "margin,' 'AI capex absorption'). Tie each to a number when "
            'possible. 60-90 words.>",\n'
            '    "<EXPECTATIONS BAR: Combine consensus EPS + revenue + YoY % '
            "implied with pre-print positioning (revisions trend, stock action "
            "heading in, options pricing ±X% vs historical ±Y%). What is the "
            'buy-side actually modeled at vs whisper? 60-90 words.>",\n'
            '    "<GUIDANCE SETUP: Specific forward commentary the market is '
            "focused on — full-year revenue growth bracket, capex range, "
            "segment color, margin trajectory. Name the specific data points "
            'investors are listening for on the call. 60-90 words.>",\n'
            '    "<SCENARIO MAP: Binary or trinary setup tied to the implied '
            "move. Clean beat + raise → expected reaction direction and "
            "magnitude vs implied; in-line + flat guide → likely faded move; "
            "miss or soft guide → downside setup. Quote the implied % so the "
            'trader can size against it. 60-90 words.>"\n'
            '  ]\n'
            "}\n\n"
            "==== RULES ====\n"
            f"- Be SPECIFIC to {sym}'s actual business. Don't write generic "
            "'ad spending environment' when you can write 'Reels engagement and "
            "Meta AI ad ranking lift.'\n"
            "- QUOTE real numbers from CONTEXT (consensus EPS, revenue, YoY %, "
            "surprise %, implied move, historical move, recent stock action). "
            "These are not optional — they are the spine of the briefing.\n"
            "- Use your training knowledge of this company's segments, prior "
            "management commentary, and peer dynamics — but don't fabricate "
            "specific numbers you don't have. Frame uncertain ranges qualitatively.\n"
            "- No directional trade calls (no 'buy this' or 'sell that'). "
            "Surface asymmetry, scenarios, and tradeable structure only.\n"
            "- Aim for the depth of a strategist's morning note (think: a "
            "well-written sell-side preview), not a press release summary."
        )

        client = _get_anthropic_client()
        msg = client.messages.create(
            model=_EARNINGS_AI_MODEL,
            max_tokens=_EARNINGS_PREVIEW_AI_MAX_TOKENS,
            # Disable Claude-5 default thinking — it truncates the JSON (see the
            # analysis call above). We only need the formatted preview.
            thinking={"type": "disabled"},
            metadata={"user_id": "earnings_preview:global"},
            messages=[{"role": "user", "content": prompt}],
        )
        parsed = _parse_json_block(_anthropic_text(msg))
        preview_text    = str(parsed.get("preview", "")).strip()
        preview_bullets = [str(b).strip() for b in parsed.get("bullets", [])[:5]]
    except Exception as _e:
        _logger.warning("AI preview failed for %s: %s", sym, _e, exc_info=True)
        preview_text    = ""
        preview_bullets = []

    result = {
        "sym":             sym,
        "preview_text":    preview_text,
        "preview_bullets": preview_bullets,
        "beat_history":    beat_history,
        "yoy_eps_growth":  yoy_eps_growth,
        "beat_streak":     beat_streak,
        "news":            news_items,
        # ── Enrichment fields (may be None) ─────────────────────────────────
        "pre_earnings":    enrichment.get("pre_earnings"),
        "hist_moves":      enrichment.get("hist_moves"),
        "revisions":       enrichment.get("revisions"),
        "beat_surprises":  enrichment.get("beat_surprises"),
        "implied_move":    enrichment.get("implied_move"),
        "key_quotes":      enrichment.get("key_quotes"),
        "signals_hash":    _sig,   # inputs fingerprint for skip-if-stable
    }
    # Same extension as _generate_earnings_analysis: a real preview_text with
    # a totally-failed enrichment fan-out must not get the 12h TTL or the
    # permanent disk write (see that function's comment for why signals_hash
    # can't catch this on its own).
    enrichment_complete = all(k in enrichment for k in _ENRICHMENT_LEG_KEYS)
    complete = bool(preview_text) and enrichment_complete
    ttl = _EARNINGS_CACHE_TTL_HIT if complete else _EARNINGS_CACHE_TTL_MISS
    cache.set(cache_key, result, ttl=ttl)
    # Persist only real, complete output — a miss/partial stays lazy so it retries.
    if complete:
        _ai_store.put("preview", sym, result)
    return result


def _prewarm_earnings_analysis(data: dict) -> None:
    """Pre-cache AI analysis for reported tickers; AI preview for Pending entries.

    Disabled by default 2026-05-27 emergency cost pass: Railway redeploys wipe
    the in-memory cache, causing this pre-warm to re-fire for every earnings
    ticker on every restart (~60K Haiku/Sonnet tokens per redeploy × N redeploys/day
    = primary source of baseline daily burn). On-demand modal clicks still work
    via synchronous cache-miss fallback. Set EARNINGS_PREWARM_ENABLED=1 to revert.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return
    if os.environ.get("EARNINGS_PREWARM_ENABLED", "0") != "1":
        _logger.info("prewarm: disabled via EARNINGS_PREWARM_ENABLED=0 (no tokens spent)")
        return
    _logger.info("prewarm: starting for buckets bmo/amc/amc_tonight")

    for bucket in ("bmo", "amc", "amc_tonight"):
        for entry in data.get(bucket, []):
            sym = entry.get("sym", "")
            if not sym:
                continue
            is_pending = entry.get("verdict", "").lower() in ("pending", "")  # "" = no verdict yet (edge case)

            if is_pending:
                # Full AI preview (AV history + news + Claude)
                if not cache.get(f"earnings_preview_v2_{sym}"):
                    _prewarm_executor.submit(_generate_earnings_preview, sym, dict(entry))
            else:
                # Full post-earnings analysis (AV history + news + Claude)
                if not cache.get(f"earnings_analysis_v2_{sym}"):
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

        # `fast_info` is LAZY — the requests fire on each attribute read, not on
        # the property access — so the whole read block goes through the shared
        # guard. Bounding only `yf.Ticker(sym).fast_info` would guard the one
        # step that never touches the network.
        def _read():
            fi = yf.Ticker(sym).fast_info
            qt = getattr(fi, "quote_type", "EQUITY") or "EQUITY"
            if qt.upper() not in ("EQUITY", ""):
                return False
            price      = getattr(fi, "last_price", 0) or 0
            avg_vol    = getattr(fi, "three_month_average_volume", 0) or 0
            market_cap = getattr(fi, "market_cap", 0) or 0
            return (price * avg_vol) >= 5_000_000 and market_cap >= 300_000_000

        # `True` is the fail-OPEN default the except below already used: a
        # timeout or a 429 must not silently drop all news.
        return sym, yf_util.bounded_call(_read, True)
    except Exception:
        return sym, True


# ── News: stale-while-revalidate so a user never blocks on the 2-4s rebuild ──
_news_stale: dict = {"value": None}   # last GOOD payload, outlives the TTL
_news_refresh_lock = _threading.Lock()
_news_refreshing = False


def _store_news(result: list, ttl: float, healthy: bool | None = None) -> None:
    """Write the fresh-cache entry and (if it's a real, healthy payload) the
    stale copy.

    `healthy` lets a caller that knows WHICH source produced `result`
    distinguish "the primary source (AV) actually succeeded" from "merely no
    explicit `error` key" — an RSS-only fallback payload has neither an
    `error` key nor a healthy primary source, so the old truthiness-only
    check couldn't tell them apart. Defaults to that weaker check for callers
    that don't know the difference.
    """
    cache.set("news", result, ttl=ttl)
    ok = healthy if healthy is not None else bool(result and not result[0].get("error"))
    # Only keep a successful payload as the stale fallback — never let an error
    # placeholder (or, now, an unhealthy-source payload) become the value
    # served to every user for the next window.
    if ok:
        _news_stale["value"] = result


def _kick_news_refresh() -> None:
    """Refresh the news cache in the background (deduped — one at a time)."""
    global _news_refreshing
    with _news_refresh_lock:
        if _news_refreshing:
            return
        _news_refreshing = True

    def _bg():
        global _news_refreshing
        try:
            _compute_news()
        except Exception:
            pass
        finally:
            with _news_refresh_lock:
                _news_refreshing = False

    _threading.Thread(target=_bg, daemon=True, name="news-refresh").start()


def get_news() -> list:
    """Fast path. Fresh cache → return. Else serve the last good payload and
    refresh in the background. Only the very first cold call (no stale value
    yet) pays the full fetch cost — and startup warming covers even that."""
    cached = cache.get("news")
    if cached:
        return cached
    stale = _news_stale["value"]
    if stale is not None:
        _kick_news_refresh()
        return stale
    return _compute_news()


def _fmp_news_item(row: dict, tickers: list[str]) -> dict | None:
    """Map one `stable/news/general-latest` or `stable/news/stock` row to the
    engine's news-item shape. Returns None for a malformed/titleless row.

    FMP's `publishedDate` is an ET wall-clock string ("YYYY-MM-DD HH:MM:SS",
    live-verified 2026-08-05: the freshest row in `general-latest` trailed
    "now" by minutes when compared against ET, by ~4.6h when compared against
    UTC) -- the SAME shape the rest of this function already emits for
    `time`, so no timezone conversion is needed (unlike AV's UTC
    "YYYYMMDDTHHMMSS" `time_published`).

    `sentiment` is always "neutral" -- FMP's news endpoints carry no
    sentiment score (the plan's §D3: the AV field this migration explicitly
    drops rather than fabricate a replacement for). "neutral" is not a
    guess standing in for missing data; it is the SAME "no signal" default
    the RSS leg below already uses for the identical reason.
    """
    headline = (row.get("title") or "").strip()
    if not headline:
        return None
    return {
        "headline":  headline,
        "source":    row.get("publisher") or row.get("site") or "",
        "url":       row.get("url") or "",
        "time":      str(row.get("publishedDate") or "")[:19],
        "category":  _classify_category(row, headline),
        "sentiment": "neutral",
        "tickers":   tickers,
    }


def _compute_news() -> list:
    cached = cache.get("news")
    if cached:
        return cached

    fmp_key = os.environ.get("FMP_API_KEY", "")
    av_key = os.environ.get("ALPHAVANTAGE_API_KEY")
    if not fmp_key and not av_key:
        result = [{"headline": "News unavailable", "source": "", "url": "",
                   "time": "", "category": "GENERAL", "sentiment": "neutral",
                   "tickers": [], "change_pct": None,
                   "error": "FMP_API_KEY and ALPHAVANTAGE_API_KEY both unset"}]
        _store_news(result, ttl=120)
        return result

    # Defined here (not just inside `try`) so the health-check block after
    # the try/except below can always read them — an exception raised before
    # the normal assignment further down (e.g. the ThreadPoolExecutor fan-out
    # itself failing) must still resolve to "nothing healthy contributed",
    # never a NameError that skips the failure-TTL contract entirely.
    av_filtered: list = []
    fmp_filtered: list = []
    _av_rate_limited = False

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

        # ── Fetch FMP (primary) + AV (now a fallback leg, see _healthy below)
        # + EDGAR in parallel. FMP gets its OWN bounded timeout, never on
        # Finnhub's or AV's budget/rate-limit state. `_av_rate_limited` is
        # declared above the try block (nonlocal still resolves to it).

        def _fetch_av():
            if not av_key:
                return []
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

        def _fetch_fmp_general():
            if not fmp_key:
                return []
            try:
                r = _requests.get(
                    "https://financialmodelingprep.com/stable/news/general-latest",
                    params={"apikey": fmp_key, "limit": 100},
                    timeout=10,
                )
                r.raise_for_status()
                data = r.json()
                return data if isinstance(data, list) else []
            except Exception as e:
                _logger.warning("get_news: FMP general-latest failed: %s", e)
                return []

        def _fmp_stock_symbols() -> str:
            """Today's movers -- a small, always-fresh, zero-extra-cost ticker
            batch (already independently cached in massive.py) for the
            per-symbol `stable/news/stock` leg. Movers are, definitionally,
            the names generating news right now."""
            try:
                from api.services.massive import get_movers
                m = get_movers() or {}
                syms = [row.get("sym") for row in (m.get("ripping") or [])] + \
                       [row.get("sym") for row in (m.get("drilling") or [])]
                syms = [s for s in dict.fromkeys(syms) if s]  # dedupe, preserve order
                return ",".join(syms[:40])
            except Exception:
                return ""

        def _fetch_fmp_stock():
            if not fmp_key:
                return []
            symbols_csv = _fmp_stock_symbols()
            if not symbols_csv:
                return []
            try:
                r = _requests.get(
                    "https://financialmodelingprep.com/stable/news/stock",
                    params={"symbols": symbols_csv, "apikey": fmp_key, "limit": 100},
                    timeout=10,
                )
                r.raise_for_status()
                data = r.json()
                return data if isinstance(data, list) else []
            except Exception as e:
                _logger.warning("get_news: FMP news/stock failed: %s", e)
                return []

        with ThreadPoolExecutor(max_workers=4) as ex:
            av_future = ex.submit(_fetch_av)
            edgar_future = ex.submit(_fetch_edgar)
            fmp_general_future = ex.submit(_fetch_fmp_general)
            fmp_stock_future = ex.submit(_fetch_fmp_stock)
            try:
                av_feed = av_future.result(timeout=20)
            except Exception:
                av_feed = []
            try:
                edgar_items = edgar_future.result(timeout=15)
            except Exception:
                edgar_items = []
            try:
                fmp_general_rows = fmp_general_future.result(timeout=15)
            except Exception:
                fmp_general_rows = []
            try:
                fmp_stock_rows = fmp_stock_future.result(timeout=15)
            except Exception:
                fmp_stock_rows = []

        # ── Noise filters ──────────────────────────────────────────────────────
        _BAD_SOURCES = {"stock titan", "intellectia ai"}
        _BAD_HEADLINE = ("sec filings", "stock news today", "stock price and chart",
                         "latest stock news", "annual report")

        # ── Process FMP feeds → candidate items ──────────────────────────────
        # general-latest carries no `symbol` (true market-wide headlines,
        # verified live: every sampled row had `symbol: null`) -- those
        # become tickers=[] items, a genuinely new content class AV's
        # ticker_sentiment (which REQUIRED >=1 relevant ticker) never
        # contributed. news/stock tags exactly the ONE symbol it was queried
        # for per row -- cap/ETF-checked below via the same `_check_sym_cap`
        # pipeline AV's tickers go through.
        fmp_general_items = []
        for row in fmp_general_rows:
            if not isinstance(row, dict):
                continue
            if (row.get("publisher") or "").lower() in _BAD_SOURCES:
                continue
            title = row.get("title") or ""
            if any(p in title.lower() for p in _BAD_HEADLINE):
                continue
            item = _fmp_news_item(row, tickers=[])
            if item:
                fmp_general_items.append(item)

        fmp_stock_syms_raw: set[str] = set()
        fmp_stock_by_sym: dict[str, list[dict]] = {}
        for row in fmp_stock_rows:
            if not isinstance(row, dict):
                continue
            if (row.get("publisher") or "").lower() in _BAD_SOURCES:
                continue
            title = row.get("title") or ""
            if any(p in title.lower() for p in _BAD_HEADLINE):
                continue
            sym = (row.get("symbol") or "").strip().upper()
            if not sym:
                continue
            fmp_stock_syms_raw.add(sym)
            fmp_stock_by_sym.setdefault(sym, []).append(row)

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

        # ── ETF + volume filter on AV + FMP-stock candidates (ONE shared pool) ─
        unique_syms = list(
            {sym for it in av_candidates for sym in it["tickers"]} | fmp_stock_syms_raw
        )

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

        fmp_stock_items = []
        for sym, rows in fmp_stock_by_sym.items():
            if sym not in allowed:
                continue
            for row in rows:
                item = _fmp_news_item(row, tickers=[sym])
                if item:
                    fmp_stock_items.append(item)
        fmp_filtered = fmp_general_items + fmp_stock_items

        # ── RSS fallback when NEITHER primary source (FMP, then AV) produced
        # anything usable. The AV-specific half of this condition is
        # UNCHANGED from before this task; only the `not fmp_filtered` guard
        # is new, so a live FMP success (the now-common case) no longer
        # forces an RSS fetch just because AV itself was empty/rate-limited.
        rss_items = []
        if not fmp_filtered and (_av_rate_limited or not av_filtered):
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

        # ── Merge FMP + AV + EDGAR + RSS, dedup, sort, take top 40 ───────────
        # FMP listed FIRST: `_deduplicate_news` picks a same-story winner via
        # `min(group, key=(_tier, time))`, and `min` keeps the FIRST item on
        # an exact tie — so when FMP and AV cover the identical story at the
        # identical source tier, FMP (the new primary) wins the dedup.
        merged = fmp_filtered + av_filtered + edgar_items + rss_items
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

    # `result[0].get("error")` is never set on an RSS-only fallback payload
    # (RSS items carry no "error" key), so a truthiness-only check would give
    # an RSS-only result the SAME full 30-min success TTL as a healthy pull —
    # and the same eternal "last good" stale slot below. RSS only ever fires
    # when BOTH primary sources came up empty/degraded (see the
    # `if not fmp_filtered and (_av_rate_limited or not av_filtered)` gate
    # above), so "FMP or AV actually contributed" is the honest source-health
    # signal, not "no error key happened to be present." (2026-08-05,
    # data-dependability migration Task 14: generalized from AV-only to
    # FMP-or-AV now that FMP is the primary leg — an FMP-only cycle, e.g. AV
    # legitimately rate-limited that day, must still count as healthy.)
    _fmp_ok = bool(fmp_filtered)
    _av_ok = bool(av_filtered) and not _av_rate_limited
    _healthy = bool(result and not result[0].get("error") and (_fmp_ok or _av_ok))
    _ttl = 1800 if _healthy else 600
    _store_news(result, ttl=_ttl, healthy=_healthy)
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
    local_path = UCT_INTEL_PATH / "data" / "candidates.json"
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
        _intel_str = str(UCT_INTEL_PATH)
        if _intel_str not in sys.path:
            sys.path.insert(0, _intel_str)
        import uct_intelligence.api as _uct_api
        result = _uct_api.get_uct20_portfolio(account_size=50000)
        if result:
            cache.set("uct20_portfolio", result, ttl=3600)
            return result
    except Exception as e:
        _logger.warning("get_uct20_portfolio_data local fallback failed: %s", e)

    return {}


def get_uct20_backtest_data() -> dict:
    """Compute extended backtest analytics from portfolio data.

    Adds: monthly_returns, drawdown_series, trade_distribution,
    streak stats, best/worst trades, rolling alpha.
    """
    cached = cache.get("uct20_backtest")
    if cached is not None:
        return cached

    portfolio = get_uct20_portfolio_data()
    if not portfolio or not portfolio.get("equity_curve"):
        return {}

    from datetime import datetime as _dt
    from collections import defaultdict

    equity_curve = portfolio["equity_curve"]
    trades = portfolio.get("trades", [])
    account_size = portfolio.get("account_size", 50000)
    qqq_curve = portfolio.get("qqq_curve", [])

    # ── Monthly returns ────────────────────────────────────────────────
    # Group equity curve by month, compute month-over-month return
    monthly_returns = []
    if len(equity_curve) >= 2:
        month_vals = {}  # "YYYY-MM" -> last value in that month
        for pt in equity_curve:
            ym = pt["date"][:7]
            month_vals[ym] = pt["value"]

        months = sorted(month_vals.keys())
        prev_val = account_size
        for ym in months:
            val = month_vals[ym]
            pct = round((val / prev_val - 1) * 100, 2) if prev_val > 0 else 0
            monthly_returns.append({
                "month": ym,
                "return_pct": pct,
                "end_value": round(val, 2),
            })
            prev_val = val

    # ── Drawdown series ────────────────────────────────────────────────
    drawdown_series = []
    if equity_curve:
        peak = equity_curve[0]["value"]
        for pt in equity_curve:
            if pt["value"] > peak:
                peak = pt["value"]
            dd = round((pt["value"] / peak - 1) * 100, 2) if peak > 0 else 0
            drawdown_series.append({"date": pt["date"], "drawdown": dd})

    # ── Trade distribution (bucket returns into ranges) ────────────────
    buckets = {"< -5%": 0, "-5% to -2%": 0, "-2% to 0%": 0,
               "0% to 2%": 0, "2% to 5%": 0, "5% to 10%": 0,
               "10% to 20%": 0, "> 20%": 0}
    for t in trades:
        r = t.get("pct_return", 0)
        if r < -5:
            buckets["< -5%"] += 1
        elif r < -2:
            buckets["-5% to -2%"] += 1
        elif r < 0:
            buckets["-2% to 0%"] += 1
        elif r < 2:
            buckets["0% to 2%"] += 1
        elif r < 5:
            buckets["2% to 5%"] += 1
        elif r < 10:
            buckets["5% to 10%"] += 1
        elif r < 20:
            buckets["10% to 20%"] += 1
        else:
            buckets["> 20%"] += 1
    trade_distribution = [{"bucket": k, "count": v} for k, v in buckets.items()]

    # ── Win/loss streaks ───────────────────────────────────────────────
    sorted_trades = sorted(trades, key=lambda t: t.get("exit_date", ""))
    max_win_streak = 0
    max_loss_streak = 0
    cur_win = 0
    cur_loss = 0
    for t in sorted_trades:
        if t.get("win"):
            cur_win += 1
            cur_loss = 0
            max_win_streak = max(max_win_streak, cur_win)
        else:
            cur_loss += 1
            cur_win = 0
            max_loss_streak = max(max_loss_streak, cur_loss)

    # ── Best / worst trades ────────────────────────────────────────────
    best_trade = max(trades, key=lambda t: t.get("pct_return", 0)) if trades else None
    worst_trade = min(trades, key=lambda t: t.get("pct_return", 0)) if trades else None

    # ── Rolling alpha vs QQQ (per equity curve point) ──────────────────
    rolling_alpha = []
    if qqq_curve and equity_curve:
        qqq_map = {pt["date"]: pt.get("pct", 0) for pt in qqq_curve}
        base_val = equity_curve[0]["value"]
        qqq_base = qqq_map.get(equity_curve[0]["date"], 0)
        for pt in equity_curve:
            uct_pct = (pt["value"] / base_val - 1) * 100 if base_val > 0 else 0
            qqq_pct = qqq_map.get(pt["date"], qqq_base) - qqq_base
            rolling_alpha.append({
                "date": pt["date"],
                "alpha": round(uct_pct - qqq_pct, 2),
            })

    result = {
        **portfolio,
        "monthly_returns": monthly_returns,
        "drawdown_series": drawdown_series,
        "trade_distribution": trade_distribution,
        "max_win_streak": max_win_streak,
        "max_loss_streak": max_loss_streak,
        "best_trade": best_trade,
        "worst_trade": worst_trade,
        "rolling_alpha": rolling_alpha,
        # The MEASURED backtest, carried alongside. Everything above this line
        # is analytics computed FROM the live no-stops tracker -- it is the
        # tracker re-sliced, not a backtest of anything. `harness` is the real
        # one: 1,119 sessions, both arms, from a published run manifest.
        "harness": get_uct20_harness_backtest_data(),
    }
    cache.set("uct20_backtest", result, ttl=3600)
    return result


def get_uct20_harness_backtest_data() -> dict:
    """The measured 1,119-session A/B the UCT20 system ships on.

    Priority: cache -> wire_data["uct20_backtest"] -> direct engine call.
    Not gated on the Book flag: this is a published result, not a live record.
    """
    cached = cache.get("uct20_harness_backtest")
    if cached is not None:
        return cached

    wire = _load_wire_data()
    if wire and wire.get("uct20_backtest"):
        result = wire["uct20_backtest"]
        cache.set("uct20_harness_backtest", result, ttl=86400)
        return result

    try:
        _intel_str = str(UCT_INTEL_PATH)
        if _intel_str not in sys.path:
            sys.path.insert(0, _intel_str)
        import uct_intelligence.api as _uct_api
        result = _uct_api.get_uct20_harness_backtest()
        if result:
            cache.set("uct20_harness_backtest", result, ttl=86400)
            return result
    except Exception as e:
        _logger.warning("get_uct20_harness_backtest_data fallback failed: %s", e)

    return {}


def get_uct20_book_data() -> dict:
    """The LIVE UCT20 Book -- the risk-managed arm built from published plans.

    Priority: cache -> wire_data["uct20_book"] -> direct engine call.

    Returns {} when the Book is switched off or has never run. When it HAS
    run but is still short of a usable sample it returns a payload whose
    `stats_published` is False -- the caller must render the counts and NOT
    the performance. That threshold is decided in uct_intelligence, not here,
    so there is one authority over "is this a track record yet".
    """
    cached = cache.get("uct20_book")
    if cached is not None:
        return cached

    wire = _load_wire_data()
    if wire and wire.get("uct20_book"):
        result = wire["uct20_book"]
        cache.set("uct20_book", result, ttl=3600)
        return result

    try:
        _intel_str = str(UCT_INTEL_PATH)
        if _intel_str not in sys.path:
            sys.path.insert(0, _intel_str)
        import uct_intelligence.api as _uct_api
        result = _uct_api.get_uct20_book_display()
        if result:
            cache.set("uct20_book", result, ttl=3600)
            return result
    except Exception as e:
        _logger.warning("get_uct20_book_data fallback failed: %s", e)

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
