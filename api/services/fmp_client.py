"""Provider Abstraction Layer (D1) — the FMP adapter. Per
provider-abstraction-spec.md §9: the ONE module in this codebase that
constructs an `financialmodelingprep.com` URL for the endpoints this
build's approved scope covers (the 6 originally-named call sites — see
`docs/d1-implementation-log.md`'s Section 1 for the corrected, larger true
FMP surface this build deliberately does not migrate yet).

Shape modeled on `finnhub_client.py` (module-level functions + module-level
state guarded by `threading.Lock`s, read in full before this file was
written) — non-blocking proactive token bucket, 24h cached-forbidden-
endpoint idiom via the existing `cache` module — with ONE deliberate
divergence: `finnhub_client.fh_get` returns `None` on every failure class
(the "never raises" anti-pattern this system exists to retire, spec §2.1's
own explicit warning not to copy that part). This module raises typed
exceptions (`provider_errors.py`) instead.

Interim contract (spec §4.2): every typed function takes `ticker: str`
(not an Entity Master `EntityId` — D2/Canonical Data Model doesn't exist
yet either, and per spec §8 the adapter's own internals don't change when
S3 narrows the type at call sites) and returns a `ProviderResult`.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Callable, Optional, Sequence

import requests

from api.services.cache import cache
from api.services import provider_errors as _pe
from api.services import provider_licensing_class as _plc

_logger = logging.getLogger(__name__)

_BASE_URL = "https://financialmodelingprep.com"
# Highest of the four existing implementations' defaults (spec §9.2) as the
# ceiling; individual typed functions below pass a tighter timeout where
# the existing code already did.
_DEFAULT_TIMEOUT = 25

_ERR = _pe.make_vendor_errors("fmp", class_prefix="FMP")
# Re-exported so a caller migrating an existing `except X` clause can import
# the specific leaf classes directly: `from api.services.fmp_client import FMPNotFound`.
FMPNotConfigured = _ERR.NotConfigured
FMPAuthError = _ERR.AuthError
FMPRateLimited = _ERR.RateLimited
FMPTransient = _ERR.Transient
FMPNotFound = _ERR.NotFound

_session = requests.Session()

# ── Rate limiting (spec §9.4) ────────────────────────────────────────────────
# 🔴 Open item (spec §9.4, §25): FMP's actual per-minute ceiling on UCT's
# plan is not confirmed anywhere in the accepted corpus. Configuration
# value with a conservative default, per data-architecture §18.3's own
# principle — changeable with no code change once the real ceiling is known.
_FMP_RATE_LIMIT_PER_MIN = float(os.environ.get("FMP_RATE_LIMIT_PER_MIN", "120"))
_bucket_tokens = _FMP_RATE_LIMIT_PER_MIN
_bucket_updated = time.monotonic()
_bucket_lock = threading.Lock()
_bucket_denied_total = 0
# Spec §18.2's evidence-ladder "OC" (observed-called) field: "derived from
# whether budget()'s denied/served counters have moved off zero since
# process start." Incremented once per actual network attempt (in
# _get_raw, success or failure alike) — a token-shed doesn't count as
# "called", it counts as denied.
_served_total = 0

_FORBIDDEN_TTL = 86_400  # 24h, Finnhub's proven precedent (spec §9.3/§5.2)


def _take_token() -> bool:
    """Non-blocking — never sleeps (spec §2.1's explicit reasoning: this
    runs on the shared request-path threadpool)."""
    global _bucket_tokens, _bucket_updated, _bucket_denied_total
    with _bucket_lock:
        now = time.monotonic()
        elapsed = max(0.0, now - _bucket_updated)
        _bucket_updated = now
        _bucket_tokens = min(_FMP_RATE_LIMIT_PER_MIN, _bucket_tokens + elapsed * (_FMP_RATE_LIMIT_PER_MIN / 60.0))
        if _bucket_tokens >= 1.0:
            _bucket_tokens -= 1.0
            return True
        _bucket_denied_total += 1
        return False


def budget() -> dict:
    """Spec §7.1's `budget(vendor)` primitive — ships to target shape from
    day one (spec §4.4: this does not depend on D2/S3 at all)."""
    with _bucket_lock:
        return {
            "tokens_remaining": _bucket_tokens,
            "ceiling": _FMP_RATE_LIMIT_PER_MIN,
            "denied_total": _bucket_denied_total,
            "served_total": _served_total,
        }


# ── Low-level transport (spec §9.2, §9.5) ───────────────────────────────────

def _get_raw(path: str, params: dict, timeout: Optional[int] = None) -> Any:
    """Fires one FMP GET. Returns the parsed JSON body on a normal 200
    (which may be an empty list/dict — genuinely empty is NOT this
    function's business to classify; each typed function above applies its
    own not-found predicate, spec §9.5). Raises a typed exception for every
    other outcome — including the SECOND+ call to a cached-forbidden
    endpoint, which instead returns the sentinel `_CachedForbidden` object
    so callers can render a degraded ProviderResult instead of an
    exception (spec §6.4 — the state is distinguishable, not a failure the
    caller must catch)."""
    api_key = os.environ.get("FMP_API_KEY", "")
    if not api_key:
        raise _ERR.not_configured("FMP_API_KEY not set")

    forbidden_since = cache.get(f"fmp_forbidden_{path}")
    if forbidden_since is not None:
        return _CachedForbidden(since=forbidden_since)

    if not _take_token():
        raise _ERR.rate_limited(f"local FMP budget exhausted for {path}")

    global _served_total
    with _bucket_lock:
        _served_total += 1

    call_params = dict(params)
    call_params["apikey"] = api_key
    try:
        resp = _session.get(f"{_BASE_URL}{path}", params=call_params, timeout=timeout or _DEFAULT_TIMEOUT)
    except requests.exceptions.Timeout as exc:
        raise _ERR.transient(f"FMP {path} timed out") from exc
    except requests.exceptions.RequestException as exc:
        raise _ERR.transient(f"FMP {path} network error: {exc}") from exc

    if resp.status_code == 429:
        raise _ERR.rate_limited(f"FMP {path} rate-limited", status=429)
    if resp.status_code in (401, 403):
        now = time.time()
        cache.set(f"fmp_forbidden_{path}", now, ttl=_FORBIDDEN_TTL)
        raise _ERR.auth_error(f"FMP {path} rejected ({resp.status_code})", status=resp.status_code)
    if resp.status_code >= 500:
        raise _ERR.transient(f"FMP {path} server error ({resp.status_code})", status=resp.status_code)
    try:
        resp.raise_for_status()
    except requests.exceptions.HTTPError as exc:
        raise _ERR.transient(f"FMP {path} unexpected status {resp.status_code}") from exc
    try:
        return resp.json()
    except ValueError as exc:
        raise _ERR.transient(f"FMP {path} returned non-JSON body") from exc


class _CachedForbidden:
    """Internal sentinel — `_get_raw` returns this instead of raising when
    an endpoint is in its 24h cached-forbidden window. Never escapes this
    module; `_fetch` (below) converts it to a degraded `ProviderResult`."""
    __slots__ = ("since",)

    def __init__(self, since: float):
        self.since = since


def _fetch(
    path: str, params: dict, *, source_activity: str, data_class: str,
    not_found_if: Optional[Callable[[Any], bool]] = None,
    freshness: Optional[_pe.FreshnessClass] = None, timeout: Optional[int] = None,
    observed_at_of: Optional[Callable[[Any], Optional[float]]] = None,
) -> _pe.ProviderResult:
    """The shared body every typed function below calls. Owns: raising
    FMPNotFound via the caller-supplied predicate (FMP has no status field
    that means "not found" — spec §9.5 — so this cannot be generic at the
    transport layer, only at this per-endpoint layer), stamping provenance
    and the licensing-class lookup, and translating a cached-forbidden
    sentinel into a degraded ProviderResult.

    `observed_at_of` (D1 provenance/freshness hardening, 2026-09-02) is an
    optional per-endpoint hook, same shape as `not_found_if`, that extracts
    the vendor's OWN observation timestamp from the raw response -- only
    `get_quote` supplies one today (FMP's `/stable/quote` carries a real
    `timestamp` field, live-verified 2026-09-02). Every other typed
    function leaves this `None`, so `source_observed_at` stays `None` and
    `freshness` is unaffected -- this hook is additive, not a behavior
    change for the 16 endpoints that don't opt in."""
    licensing_class = _plc.licensing_class_for("fmp", data_class)
    raw = _get_raw(path, params, timeout=timeout)
    if isinstance(raw, _CachedForbidden):
        return _pe.ProviderResult(
            value=None,
            provenance=_pe.ProvenanceRecord(vendor="fmp", source_activity=source_activity),
            licensing_class=licensing_class,
            freshness=freshness,
            degraded="cached_forbidden",
            degraded_since=raw.since,
        )
    if not_found_if is not None and not_found_if(raw):
        raise _ERR.not_found(f"FMP {path}: no data for this request")
    observed_at = observed_at_of(raw) if observed_at_of is not None else None
    final_freshness = (
        _pe.freshness_from_observed_age(observed_at, normal=freshness)
        if freshness is not None else freshness
    )
    return _pe.ProviderResult(
        value=raw,
        provenance=_pe.ProvenanceRecord(
            vendor="fmp", source_activity=source_activity, source_observed_at=observed_at,
        ),
        licensing_class=licensing_class,
        freshness=final_freshness,
    )


def _empty_list(v: Any) -> bool:
    return isinstance(v, list) and len(v) == 0


def _empty_container(v: Any) -> bool:
    return v is None or (isinstance(v, (list, dict)) and len(v) == 0)


# ── Typed per-endpoint functions (spec §4.2/§9.3) ───────────────────────────
# One function per endpoint the six originally-scoped call sites use,
# named after what it returns — not after the URL path.

def _fmp_index_symbol(ticker: str) -> str:
    """FMP's own index-quote convention is a caret prefix (`^SPX`, `^GSPC`,
    `^DJI`, `^IXIC`, `^VIX`) — live-verified during the D1 completion pass
    (2026-09-02) against all five. Applied ONLY when the caller identifies
    the entity as an index (`entity_type="index"`); canonical identity
    (Entity Master) never carries vendor syntax — this stays entirely
    inside the adapter boundary, per the D1 authorization's explicit
    instruction. A no-op for an already-prefixed symbol."""
    t = ticker.upper().strip()
    return t if t.startswith("^") else f"^{t}"


def _quote_observed_at(raw: Any) -> Optional[float]:
    """FMP's `/stable/quote` row carries its own `timestamp` (unix epoch
    seconds) -- live-verified 2026-09-02 against both an actively-traded
    name (AAPL) and a thin/illiquid one (ATLQ); both rows carried a real
    `timestamp`. Returns None (never fabricated) when the field is absent
    or the response isn't the expected one-row list."""
    if isinstance(raw, list) and raw and isinstance(raw[0], dict):
        ts = raw[0].get("timestamp")
        if isinstance(ts, (int, float)):
            return float(ts)
    return None


def get_quote(ticker: str, *, entity_type: Optional[str] = None) -> _pe.ProviderResult:
    sym = _fmp_index_symbol(ticker) if entity_type == "index" else ticker.upper()
    return _fetch("/stable/quote", {"symbol": sym},
                   source_activity="fmp_client.get_quote", data_class="fundamentals",
                   not_found_if=_empty_list, freshness="delayed_15",
                   observed_at_of=_quote_observed_at)


def get_key_metrics_ttm(ticker: str) -> _pe.ProviderResult:
    return _fetch("/stable/key-metrics-ttm", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_key_metrics_ttm", data_class="fundamentals",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_ratios_ttm(ticker: str) -> _pe.ProviderResult:
    return _fetch("/stable/ratios-ttm", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_ratios_ttm", data_class="fundamentals",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_analyst_grades(ticker: str, *, limit: Optional[int] = None) -> _pe.ProviderResult:
    """Latest analyst grades (`/stable/grades`) — the endpoint
    `catalyst/analyst_actions.py` and `analyst_grades.py` both use, per
    §2.3's finding that these two call sites already share ONE real
    consolidation opportunity."""
    params = {"symbol": ticker.upper()}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/grades", params,
                   source_activity="fmp_client.get_analyst_grades", data_class="analyst_grades",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_grades_consensus(ticker: str) -> _pe.ProviderResult:
    return _fetch("/stable/grades-consensus", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_grades_consensus", data_class="analyst_grades",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_grades_historical(ticker: str, *, limit: Optional[int] = None) -> _pe.ProviderResult:
    params = {"symbol": ticker.upper()}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/grades-historical", params,
                   source_activity="fmp_client.get_grades_historical", data_class="analyst_grades",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_price_target_consensus(ticker: str) -> _pe.ProviderResult:
    return _fetch("/stable/price-target-consensus", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_price_target_consensus", data_class="estimates",
                   not_found_if=_empty_container, freshness="end_of_day")


def get_price_target_summary(ticker: str) -> _pe.ProviderResult:
    return _fetch("/stable/price-target-summary", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_price_target_summary", data_class="estimates",
                   not_found_if=_empty_container, freshness="end_of_day")


# 2026-09-04 (News/Intelligence Slice 1, A8, owner-authorized narrow slice):
# the two typed methods behind the canonical News composer
# (`api/services/research/news.py`). Previously called as raw, unrated,
# un-rate-limited requests via `earnings_estimates._fmp_get` from
# `api/routers/research.py`'s legacy `/api/research/news/{sym}` route (left
# untouched -- see that module's own docstring) -- these are net-new D1
# construction, unlike every other typed method this file already had before
# its own composer slice. `limit` is left optional/unbounded here exactly like
# every other typed list endpoint above; the composer is the one that clamps
# it, not the adapter.
def get_news_stock(ticker: str, *, limit: Optional[int] = None) -> _pe.ProviderResult:
    """Wire coverage naming this ticker (`/stable/news/stock`)."""
    params = {"symbols": ticker.upper()}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/news/stock", params,
                   source_activity="fmp_client.get_news_stock", data_class="news",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=12)


def get_news_press_releases(ticker: str, *, limit: Optional[int] = None) -> _pe.ProviderResult:
    """The company's own announcements (`/stable/news/press-releases`)."""
    params = {"symbols": ticker.upper()}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/news/press-releases", params,
                   source_activity="fmp_client.get_news_press_releases", data_class="news",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=12)


def get_earnings(ticker: str, *, limit: int = 20) -> _pe.ProviderResult:
    return _fetch("/stable/earnings", {"symbol": ticker.upper(), "limit": limit},
                   source_activity="fmp_client.get_earnings", data_class="earnings",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_transcript_dates(ticker: str) -> _pe.ProviderResult:
    return _fetch("/stable/earning-call-transcript-dates", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_transcript_dates", data_class="transcripts",
                   not_found_if=_empty_list, freshness="historical")


def get_transcript_latest_page(page: int) -> _pe.ProviderResult:
    return _fetch("/stable/earning-call-transcript-latest", {"page": page, "limit": 100},
                   source_activity="fmp_client.get_transcript_latest_page", data_class="transcripts",
                   not_found_if=_empty_list, freshness="historical", timeout=25)


def get_transcript_content(ticker: str, year: int, quarter: int) -> _pe.ProviderResult:
    return _fetch(
        "/stable/earning-call-transcript",
        {"symbol": ticker.upper(), "year": year, "quarter": quarter},
        source_activity="fmp_client.get_transcript_content", data_class="transcripts",
        not_found_if=_empty_list, freshness="historical", timeout=40,
    )


def get_earnings_calendar(from_date: str, to_date: str) -> _pe.ProviderResult:
    """Earnings-calendar rows for a date RANGE — the one typed function in
    this module that does NOT take `ticker: str`, since `/stable/
    earnings-calendar` is a market-wide day/range query, not a per-symbol
    one. Added for `engine.py::_fmp_calendar_actuals_for_day`, whose own
    docstring documents why callers must scope `from_date == to_date` to a
    single day: a multi-day range silently truncates and is not date-fair
    (live-measured, `api/services/implied_store.py`)."""
    return _fetch("/stable/earnings-calendar", {"from": from_date, "to": to_date},
                   source_activity="fmp_client.get_earnings_calendar", data_class="earnings",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_economic_calendar(from_date: str, to_date: str) -> _pe.ProviderResult:
    """Economic-calendar rows for a date range — added for the calendar
    page's A5 modernization (2026-09-03). A market-wide range query, not a
    per-symbol one, same shape as `get_earnings_calendar`. `econ_calendar_fmp.py`
    owns the response-shaping (UTC->ET, impact curation) — this function only
    replaces its raw `requests.get` transport."""
    return _fetch("/stable/economic-calendar", {"from": from_date, "to": to_date},
                   source_activity="fmp_client.get_economic_calendar", data_class="economic",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=20)


def get_ipo_calendar(from_date: str, to_date: str) -> _pe.ProviderResult:
    """IPO-calendar rows for a date range — added for the calendar page's A5
    modernization (2026-09-03). Mirrors `ipo_calendar.py`'s existing
    `_fmp_ipo_get` request shape exactly; that module owns the merge with
    Finnhub's richer per-row detail."""
    return _fetch("/stable/ipos-calendar", {"from": from_date, "to": to_date},
                   source_activity="fmp_client.get_ipo_calendar", data_class="ipo",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=8)


def get_insider_trading(ticker: str) -> _pe.ProviderResult:
    return _fetch("/stable/insider-trading/search", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_insider_trading", data_class="insider",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_shares_float(ticker: str) -> _pe.ProviderResult:
    """Float + shares-outstanding — added for the Ownership tab's D1
    migration (2026-09-03). Share counts move slowly (a company action, not
    an intraday event), same tier as key-metrics/ratios."""
    return _fetch("/stable/shares-float", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_shares_float", data_class="ownership",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_institutional_ownership_summary(ticker: str, *, year: int, quarter: int) -> _pe.ProviderResult:
    """One quarter's Form 13F position-flow summary — added for the
    Ownership tab's D1 migration (2026-09-03). A genuinely historical
    filing (13Fs lag ~45 days), not an end-of-day snapshot."""
    return _fetch("/stable/institutional-ownership/symbol-positions-summary",
                   {"symbol": ticker.upper(), "year": year, "quarter": quarter},
                   source_activity="fmp_client.get_institutional_ownership_summary", data_class="ownership",
                   not_found_if=_empty_list, freshness="historical")


def get_institutional_ownership_holders(ticker: str, *, year: int, quarter: int, limit: int = 12) -> _pe.ProviderResult:
    """Top holders for one 13F quarter — added for the Ownership tab's D1
    migration (2026-09-03). Same freshness class as the summary leg above;
    both describe the identical filing quarter."""
    return _fetch("/stable/institutional-ownership/extract-analytics/holder",
                   {"symbol": ticker.upper(), "year": year, "quarter": quarter, "page": 0, "limit": limit},
                   source_activity="fmp_client.get_institutional_ownership_holders", data_class="ownership",
                   not_found_if=_empty_list, freshness="historical")


def get_income_statement(ticker: str, *, period: str = "quarter", limit: int) -> _pe.ProviderResult:
    params = {"symbol": ticker.upper(), "limit": limit}
    if period == "quarter":
        params["period"] = "quarter"
    return _fetch("/stable/income-statement", params,
                   source_activity="fmp_client.get_income_statement", data_class="fundamentals",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=20)


def get_balance_sheet_statement(ticker: str, *, period: str = "quarter", limit: int) -> _pe.ProviderResult:
    params = {"symbol": ticker.upper(), "limit": limit}
    if period == "quarter":
        params["period"] = "quarter"
    return _fetch("/stable/balance-sheet-statement", params,
                   source_activity="fmp_client.get_balance_sheet_statement", data_class="fundamentals",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=20)


def get_cash_flow_statement(ticker: str, *, period: str = "quarter", limit: int) -> _pe.ProviderResult:
    params = {"symbol": ticker.upper(), "limit": limit}
    if period == "quarter":
        params["period"] = "quarter"
    return _fetch("/stable/cash-flow-statement", params,
                   source_activity="fmp_client.get_cash_flow_statement", data_class="fundamentals",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=20)


# ── 2026-09-11: D1 adapter gap G2 — typed functions for endpoints reached
# DIRECTLY today with no adapter surface at all (owner-authorized, additive
# only). ADDITIVE SURFACE, NOT A MIGRATION: not one call site changes in the
# commit that adds these, so `tools/fmp_guard_census.py` is expected to report
# IDENTICAL numbers before and after — the census counts violations at call
# sites, and this block creates none and removes none.
#
# The endpoint list was DERIVED, not typed: an AST walk over `api/**` for
# (a) every `_fmp_get(...)`-shaped call whose first argument is a string
# literal, (b) every `financialmodelingprep.com` literal/f-string, and
# (c) every string constant ANYWHERE whose value is FMP-path-shaped
# (`/stable/...`, `/api/v3/...`, `/image-stock/...`), diffed against the
# `_fetch(...)` path literal of every `def get_*` above.
#
# ⭐ Rule (c) exists because rules (a)+(b) alone MISSED endpoints, and the
# miss is worth recording: `api/services/news/adapters/fmp_news.py` binds
# `STOCK_LATEST = "/stable/news/stock-latest"` at module level and calls
# `_get(STOCK_LATEST, ...)`, so neither the call site nor the URL carries a
# path literal. The first pass of this very census reported that file as
# reaching only "/" — the base URL. `index_constituents.py` hides four more
# the same way, inside a table of tuples. An enumerator that only looks
# where it expects the answer reproduces its own blind spot, so this list
# is the UNION of all three rules, not rule (a)'s output.
#
# Endpoints found uncovered and covered HERE (one typed function each):
#   /stable/profile · /stable/analyst-estimates · /stable/grades-news ·
#   /stable/grades-latest-news · /stable/news/general-latest ·
#   /stable/news/stock-latest · /stable/news/press-releases-latest ·
#   /stable/sp500-constituent · /stable/nasdaq-constituent ·
#   /stable/dowjones-constituent · /stable/etf/holdings
#
# Found uncovered and deliberately NOT covered, because an endpoint left out
# silently is indistinguishable from one nobody noticed:
#
#   /stable/ratios-bulk, /stable/ratios-ttm-bulk, /stable/key-metrics-ttm-bulk,
#   /stable/profile-bulk  — these return **CSV, not JSON** (measured live and
#       documented in `api/services/screener/fundamentals_bulk.py`'s own
#       header; `earnings_estimates._fmp_get` ends in `r.json()`, which is
#       exactly why `fmp_bulk.fetch_fundamentals_bulk()` has been returning
#       `{}` unconditionally). `_get_raw` above raises `transient(... non-JSON
#       body)` by construction, so a typed function here would be a
#       guaranteed-failing one. Non-JSON payload support is gap G3 and is NOT
#       authorized.
#   /image-stock/{sym}.png — `ticker_logos.py`; a PNG. Same G3 reason.
#   /stable/splits — reached only from `api/services/bars_sanitize.py`.
#   /stable/historical-chart/{interval} — reached only from
#       `api/services/bars_fetch.py`.
#       Both consumers are owner-excluded from this branch, so a typed
#       function for either would be adapter surface no authorized caller
#       could ever migrate onto. Recorded, deliberately not built.
#
# Also deliberately excluded: every FMP path that appears ONLY inside
# `api/routers/earnings.py::debug_earnings_sources` (`/stable/earnings-
# surprises`, `/stable/historical-earning-calendar`, `/stable/institutional-
# ownership/latest`, `/stable/price-target-news`, and the legacy `/api/v3/*`
# family that 403s on this plan). That endpoint's entire PURPOSE is to fire
# raw, unrouted URLs and report which ones the account can still reach —
# routing it through this adapter would destroy the diagnostic.
#
# ⛔ NONE of these expose a `timeout` PARAMETER. Adding one is gap G1, a
# separate pending owner ruling. Four of the five take the module default
# (`_DEFAULT_TIMEOUT`) because their live call sites disagree with each
# other about how long the call may take — `/stable/profile` alone is
# reached with 8, 8.0, 10 and two env-configured values — so there is no
# single existing request shape to mirror the way `get_ipo_calendar` mirrors
# `_fmp_ipo_get`'s. The one exception is `get_news_general_latest`, which
# carries the same internal `timeout=12` as the two news-family functions
# already above it, on the rule that typed functions in one endpoint family
# must not disagree about their own ceiling. An internal constant is not an
# exposed parameter; G1 is untouched either way.

def get_company_profile(ticker: str) -> _pe.ProviderResult:
    """Company profile (`/stable/profile`) — name, exchange, sector,
    industry, description, logo URL, beta, market cap. The single
    highest-value gap in the census: EIGHT separate modules reach this
    endpoint directly today (`darkpool_eod.py`, `bars_sanitize.py`,
    `company_about.py`, `earnings_growth_fmp.py`, `industry_map.py`,
    `ir_webcast.py`, `ticker_logos.py`, `ticker_meta.py`).

    ⚠️ `data_class="profile"` is DELIBERATELY UNREGISTERED in
    `provider_licensing_class._TABLE`, so `licensing_class` stamps "U"
    (Unknown), not "R". That is the correct answer, not an oversight: the
    licensing register has no row for FMP company-profile/reference data,
    and that module's own `("fmp", "ipo")` comment states the rule —
    "no research exists for that pair, so it is left unregistered and
    correctly falls through to `_DEFAULT` ('U' — not researched, never
    inferred)". Re-using a registered neighbour like "fundamentals" purely
    to obtain an "R" would be inferring a licensing class from a
    resemblance, which is the exact move this module's own header
    correction (spec §20 vs register row T-07) exists to refuse. Registering
    the pair is an owner/licensing input, a one-line data change there, and
    touches zero adapter code."""
    return _fetch("/stable/profile", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_company_profile", data_class="profile",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_analyst_estimates(ticker: str, *, period: str = "annual",
                          limit: Optional[int] = None) -> _pe.ProviderResult:
    """Forward analyst estimates (`/stable/analyst-estimates`) — reached
    directly by `annual_financials.py` (annual, limit 20),
    `earnings_table.py` (quarter, limit 40) and
    `screener/analyst_pass.py` (annual, limit 20).

    `period` is ALWAYS sent (all three live call sites send it explicitly,
    and the annual/quarter answer differs enough that letting FMP's own
    default decide would make the returned rows depend on a vendor default
    nobody here has pinned). It is NOT normalized or validated — the
    adapter does not invent a vocabulary the vendor owns.

    ⚠️ Every live call site is gated behind `FUNDAMENTALS_FMP_ANALYST_
    ESTIMATES` (quarterly analyst-estimates is an FMP Ultimate feature);
    that gate belongs to the callers and is deliberately NOT duplicated
    here — an adapter that silently no-ops on an env var would be a second
    authority over "is this capability on"."""
    params: dict = {"symbol": ticker.upper(), "period": period}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/analyst-estimates", params,
                   source_activity="fmp_client.get_analyst_estimates", data_class="estimates",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_grades_news(ticker: str, *, limit: Optional[int] = None) -> _pe.ProviderResult:
    """Per-firm rating actions for ONE symbol (`/stable/grades-news`) —
    `analyst_intel.py::_fmp_recent_actions`'s endpoint. Distinct from
    `get_grades_historical` above, which is aggregate buy/hold/sell COUNTS
    per date with no firm attached; this one carries the
    `gradingCompany`/`action`/`previousGrade`/`newGrade` fields.

    `data_class="analyst_grades"` (not "news") because the payload IS the
    grade action — the `newsURL`/`newsPublisher` fields are the citation
    for it, not the content."""
    params: dict = {"symbol": ticker.upper()}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/grades-news", params,
                   source_activity="fmp_client.get_grades_news", data_class="analyst_grades",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_grades_latest_news(*, limit: Optional[int] = None) -> _pe.ProviderResult:
    """The newest rating actions ACROSS THE MARKET
    (`/stable/grades-latest-news`) — `catalyst/sources.py`'s analyst pull.
    Market-wide, not per-symbol, so like `get_earnings_calendar` /
    `get_economic_calendar` / `get_ipo_calendar` it does NOT take
    `ticker: str`; the caller filters by symbol from the returned rows."""
    params: dict = {}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/grades-latest-news", params,
                   source_activity="fmp_client.get_grades_latest_news", data_class="analyst_grades",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_news_general_latest(*, limit: Optional[int] = None) -> _pe.ProviderResult:
    """Market-wide headlines (`/stable/news/general-latest`) — the third
    leg of FMP's news family, beside `get_news_stock` and
    `get_news_press_releases` above, reached directly today from
    `engine.py::get_news._fetch_fmp_general`.

    Market-wide by construction: these rows carry `symbol: null` (verified
    live by that call site's own comment), which is precisely why they are
    a different content class from `news/stock`'s per-symbol tagging."""
    params: dict = {}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/news/general-latest", params,
                   source_activity="fmp_client.get_news_general_latest", data_class="news",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=12)


def get_news_stock_latest(*, limit: Optional[int] = None,
                          page: Optional[int] = None) -> _pe.ProviderResult:
    """The GLOBAL stock-news feed (`/stable/news/stock-latest`) — every
    symbol at once, newest first, rather than one symbol's coverage.

    ⚠️ NOT the same endpoint as `get_news_stock` despite the near-identical
    name, and the difference is the point: `news/stock` answers "what has
    been written about THIS symbol", `news/stock-latest` answers "what has
    just been written about anything", which is what lets an ingestor pull
    once and fan out by symbol instead of iterating the universe.
    `page` is exposed because the global feed is inherently paginated (the
    caller walks it until a page predates its watermark); FMP honours
    `limit` up to 250 and silently caps there — that ceiling is the
    VENDOR's and is deliberately not re-asserted here."""
    params: dict = {}
    if limit is not None:
        params["limit"] = limit
    if page is not None:
        params["page"] = page
    return _fetch("/stable/news/stock-latest", params,
                   source_activity="fmp_client.get_news_stock_latest", data_class="news",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=12)


def get_news_press_releases_latest(*, limit: Optional[int] = None,
                                   page: Optional[int] = None) -> _pe.ProviderResult:
    """The GLOBAL press-release feed (`/stable/news/press-releases-latest`)
    — the company-IR lane's ingest path, same global/paginated shape as
    `get_news_stock_latest` above and the same relationship to
    `get_news_press_releases` that that one has to `get_news_stock`."""
    params: dict = {}
    if limit is not None:
        params["limit"] = limit
    if page is not None:
        params["page"] = page
    return _fetch("/stable/news/press-releases-latest", params,
                   source_activity="fmp_client.get_news_press_releases_latest", data_class="news",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=12)


# ── Index membership (`index_constituents.py` / `etf_holdings.py`) ──────────
# Three constituent endpoints with identical request shapes. They are three
# FUNCTIONS rather than one `get_index_constituents(index="sp500")` on
# purpose: an `index` argument would be a vocabulary THIS adapter invented,
# sitting between the caller and a vendor path that is already the name of
# the thing — and the module's own rule above is "one function per endpoint,
# named after what it returns, not after the URL path". A typo in a string
# argument is a runtime 404; a typo in a function name is an ImportError.
#
# ⚠️ All four stamp licensing_class "U" — see `get_company_profile`'s
# docstring for why an unregistered (vendor, data_class) pair is left to
# fall through rather than borrowed from a neighbour.

def get_sp500_constituents() -> _pe.ProviderResult:
    """S&P 500 members (`/stable/sp500-constituent`). Market-wide, no
    `ticker` argument. Rows carry `symbol`."""
    return _fetch("/stable/sp500-constituent", {},
                   source_activity="fmp_client.get_sp500_constituents", data_class="constituents",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_nasdaq_constituents() -> _pe.ProviderResult:
    """Nasdaq 100 members (`/stable/nasdaq-constituent`)."""
    return _fetch("/stable/nasdaq-constituent", {},
                   source_activity="fmp_client.get_nasdaq_constituents", data_class="constituents",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_dowjones_constituents() -> _pe.ProviderResult:
    """Dow 30 members (`/stable/dowjones-constituent`)."""
    return _fetch("/stable/dowjones-constituent", {},
                   source_activity="fmp_client.get_dowjones_constituents", data_class="constituents",
                   not_found_if=_empty_list, freshness="end_of_day")


def get_etf_holdings(ticker: str) -> _pe.ProviderResult:
    """One ETF's holdings (`/stable/etf/holdings`) — how
    `index_constituents.py` resolves the four index lists that have no
    constituent endpoint (S&P 100 via OEF, MidCap 400 via IJH, SmallCap 600
    via IJR, Russell 2000 via IWM), and how `etf_holdings.py` answers
    "what is in this ETF".

    ⚠️ The member ticker is in each row's `asset` field, NOT `symbol` —
    `symbol` is the ETF that was asked about. Recorded here because the two
    constituent-shaped answers above DO use `symbol`, and a caller moving
    between them will reach for the wrong field."""
    return _fetch("/stable/etf/holdings", {"symbol": ticker.upper()},
                   source_activity="fmp_client.get_etf_holdings", data_class="etf_holdings",
                   not_found_if=_empty_list, freshness="end_of_day")


# ── 2026-09-11: D1 adapter gap G4 — the multi-symbol news leg ───────────────
# `get_news_stock` above takes ONE ticker. `engine.py::get_news._fetch_fmp_
# stock` sends a comma-separated list of up to 40 mover symbols to the same
# endpoint in ONE request, so it has no adapter surface to migrate onto.
#
# This is a SEPARATE FUNCTION rather than a widened `get_news_stock`, and
# that is the whole point: widening would mean giving `ticker: str` a
# `str | Sequence[str]` union, and `get_news_stock("AAPL,MSFT")` is then
# genuinely ambiguous — one ticker or two? — against a function whose
# current body would happily uppercase that string and send it. A separate
# name is additive BY CONSTRUCTION: `get_news_stock`'s signature, default,
# body and `source_activity` are untouched, so no existing caller can
# observe anything. It also follows the precedent already set four times in
# this module (`get_earnings_calendar`, `get_economic_calendar`,
# `get_ipo_calendar`, `get_transcript_latest_page`) for a typed function
# that deliberately does not take `ticker: str`.

def _symbols_csv(tickers: Sequence[str]) -> str:
    """FMP's `symbols` parameter, built from a sequence.

    Order-preserving de-duplication (asking FMP for the same symbol twice
    in one request spends a rate-limit token for nothing), `.upper()` and
    `.strip()` exactly mirroring every single-ticker function's
    `ticker.upper()`, blanks dropped.

    ⛔ DELIBERATELY UNCAPPED. `engine.py` caps its own batch at 40 movers,
    and that is the CALLER's policy about how many names it wants to ask
    about. An adapter that silently truncated a symbol list would return
    fewer rows than the caller asked for and read as a quiet news day —
    the exact silently-capped-list failure `screener/fundamentals_bulk.py`
    rejected `/stable/company-screener` over."""
    seen: dict[str, None] = {}
    for t in tickers:
        s = str(t).strip().upper()
        if s:
            seen.setdefault(s, None)
    return ",".join(seen)


def get_news_stock_multi(tickers: Sequence[str], *,
                         limit: Optional[int] = None) -> _pe.ProviderResult:
    """Wire coverage naming ANY of `tickers`, in ONE request
    (`/stable/news/stock`) — the multi-symbol sibling of `get_news_stock`.

    Identical to `get_news_stock` in every respect a caller can observe
    apart from the symbol list: same path, same `data_class="news"`, same
    `not_found_if=_empty_list` (an empty answer for the whole batch is a
    NotFound, exactly as it is for one ticker), same `freshness="end_of_day"`
    and the same internal `timeout=12`. The timeout is matched to the
    sibling ON PURPOSE rather than to the raw call site's 10s: two typed
    functions firing the SAME endpoint must not disagree about how long it
    is allowed to take. `source_activity` is this function's own name, so
    provenance still says which typed function produced the value.

    Raises `TypeError` for a bare `str` — `Sequence[str]` admits one, and
    iterating it would yield CHARACTERS and quietly request `A,P,L`. A
    single ticker belongs in `get_news_stock`. Raises `ValueError` when the
    sequence contains no non-blank symbol, rather than firing a request
    that cannot succeed and burning a rate-limit token to learn it. Neither
    is a provider state, so neither is a `provider_errors` type: the typed
    exception taxonomy classifies what the VENDOR did, and these are
    argument bugs at the call site."""
    if isinstance(tickers, str):
        raise TypeError(
            "get_news_stock_multi takes a sequence of tickers, not a str "
            "(a str would be iterated character by character); use "
            "get_news_stock(ticker) for a single symbol"
        )
    symbols = _symbols_csv(tickers)
    if not symbols:
        raise ValueError("get_news_stock_multi requires at least one non-blank ticker")
    params: dict = {"symbols": symbols}
    if limit is not None:
        params["limit"] = limit
    return _fetch("/stable/news/stock", params,
                   source_activity="fmp_client.get_news_stock_multi", data_class="news",
                   not_found_if=_empty_list, freshness="end_of_day", timeout=12)
