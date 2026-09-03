"""Provider Abstraction Layer (D1) — the Massive adapter.

Built to the MINIMUM scope the Real-Provider Validation Checkpoint
(2026-09-02, user authorization) requires: typed errors, a non-blocking
rate limiter, the cached-forbidden-endpoint idiom, and ONE typed function
(`get_quote`) that exercises the real request/response/canonicalization
path this checkpoint validates — mirroring `fmp_client.py`'s shape (read in
full before this file was written), with ONE deliberate difference: it
reuses `api/services/massive.py`'s existing shared `httpx.Client` (`_http`)
rather than opening a second HTTP client, per the D1 spec's "respect
existing infrastructure where it already solves these problems" (§8)
rather than rebuilding a second connection pool for the same vendor.

**NOT a migration of `_MassiveRestClient`** — that class, and every one of
its own call sites (get_top_movers, get_batch_snapshots, get_todays_daily_
ohlcv, ...), stay untouched. Broader Massive call-site migration is
explicitly deferred past this checkpoint per the authorization's boundary
("Do not begin broad additional call-site migration yet").

Symbol translation (D1 authorization Section 6's design, exercised here
for the checkpoint rather than fully wired into every call site): prefers
Entity Master's `vendor_symbol(entity_id, "massive")` when an `entity_id`
is supplied and a mapping exists, falling back to the existing
`to_polygon_symbol()` dot/hyphen boundary translation otherwise.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional

from api.services.cache import cache
from api.services import provider_errors as _pe
from api.services import provider_licensing_class as _plc
from api.services.massive import to_polygon_symbol, _http, _REST_BASE

_logger = logging.getLogger(__name__)

_ERR = _pe.make_vendor_errors("massive", class_prefix="Massive")
MassiveNotConfigured = _ERR.NotConfigured
MassiveAuthError = _ERR.AuthError
MassiveRateLimited = _ERR.RateLimited
MassiveTransient = _ERR.Transient
MassiveNotFound = _ERR.NotFound

# ── Rate limiting ────────────────────────────────────────────────────────────
# 🔴 Open item, same shape as fmp_client.py's: Massive's actual per-minute
# ceiling on UCT's plan is not confirmed anywhere in the accepted corpus.
# Configuration value with a conservative-but-workable default (existing
# batch-snapshot code already fires ~11 parallel chunk requests for a
# 2,050-ticker universe with no throttle at all, so 300/min is a floor,
# not a guess at the true ceiling) — changeable with no code change once
# the real ceiling is known.
_MASSIVE_RATE_LIMIT_PER_MIN = float(os.environ.get("MASSIVE_RATE_LIMIT_PER_MIN", "300"))
_bucket_tokens = _MASSIVE_RATE_LIMIT_PER_MIN
_bucket_updated = time.monotonic()
_bucket_lock = threading.Lock()
_bucket_denied_total = 0

_FORBIDDEN_TTL = 86_400  # 24h, same precedent as fmp_client.py / finnhub_client.py


def _take_token() -> bool:
    """Non-blocking — never sleeps, same reasoning as fmp_client.py's
    `_take_token`: this runs on the shared request-path threadpool."""
    global _bucket_tokens, _bucket_updated, _bucket_denied_total
    with _bucket_lock:
        now = time.monotonic()
        elapsed = max(0.0, now - _bucket_updated)
        _bucket_updated = now
        _bucket_tokens = min(
            _MASSIVE_RATE_LIMIT_PER_MIN,
            _bucket_tokens + elapsed * (_MASSIVE_RATE_LIMIT_PER_MIN / 60.0),
        )
        if _bucket_tokens >= 1.0:
            _bucket_tokens -= 1.0
            return True
        _bucket_denied_total += 1
        return False


def budget() -> dict:
    with _bucket_lock:
        return {
            "tokens_remaining": _bucket_tokens,
            "ceiling": _MASSIVE_RATE_LIMIT_PER_MIN,
            "denied_total": _bucket_denied_total,
        }


def _resolve_symbol(ticker: str, entity_id: Optional[str]) -> str:
    """Entity Master's `vendor_symbol()` first when `entity_id` is given
    and a mapping exists; falls back to the existing `to_polygon_symbol()`
    dot/hyphen boundary translation otherwise. Never raises — an Entity
    Master lookup failure degrades to the existing translation rather than
    blocking the request."""
    if entity_id:
        try:
            from api.services.entity_master import api as em_api
            vs = em_api.vendor_symbol(entity_id, "massive")
            if vs:
                return vs
        except Exception as exc:
            _logger.warning("Entity Master vendor_symbol lookup failed for %s: %s", entity_id, exc)
    return to_polygon_symbol(ticker)


def get_quote(ticker: str, *, entity_id: Optional[str] = None) -> _pe.ProviderResult:
    """Single-ticker snapshot. Raises typed errors for every non-2xx/
    network outcome; a not-found/unsupported symbol raises `MassiveNotFound`
    — Massive DOES carry a `status` field (unlike FMP), the exact
    distinction `massive.py::get_single_ticker_snapshot`'s existing
    `if data.get("status") not in ("OK", "DELAYED")` check already uses,
    reused here rather than re-derived."""
    api_key = os.environ.get("MASSIVE_API_KEY", "")
    if not api_key:
        raise _ERR.not_configured("MASSIVE_API_KEY not set")

    sym = _resolve_symbol(ticker, entity_id)

    # Scoped to the ENDPOINT, not the symbol — a 401/403 is an auth-level
    # failure, not a fact about one ticker (matches fmp_client.py's
    # per-path, never-per-parameter cached-forbidden key).
    forbidden_key = "massive_forbidden_get_quote"
    forbidden_since = cache.get(forbidden_key)
    if forbidden_since is not None:
        return _pe.ProviderResult(
            value=None,
            provenance=_pe.ProvenanceRecord(vendor="massive", source_activity="massive_client.get_quote"),
            licensing_class=_plc.licensing_class_for("massive", "quotes"),
            degraded="cached_forbidden",
            degraded_since=forbidden_since,
        )

    if not _take_token():
        raise _ERR.rate_limited("local Massive budget exhausted for get_quote")

    url = f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/{sym}?apiKey={api_key}"
    try:
        resp = _http.get(url, timeout=8.0)
    except Exception as exc:
        raise _ERR.transient(f"Massive get_quote network error: {exc}") from exc

    if resp.status_code == 429:
        raise _ERR.rate_limited("Massive get_quote rate-limited", status=429)
    if resp.status_code in (401, 403):
        now = time.time()
        cache.set(forbidden_key, now, ttl=_FORBIDDEN_TTL)
        raise _ERR.auth_error(f"Massive get_quote rejected ({resp.status_code})", status=resp.status_code)
    if resp.status_code >= 500:
        raise _ERR.transient(f"Massive get_quote server error ({resp.status_code})", status=resp.status_code)
    if resp.status_code == 404:
        # Live-verified during the Real-Provider Validation Checkpoint
        # (2026-09-02): a genuinely unsupported/delisted/nonexistent symbol
        # (ZZZNOTREAL, a delisted equity, a plain index ticker with no
        # "I:" prefix) answers with a bare HTTP 404, NOT a 200 body
        # carrying a non-OK `status` field. Both are real "not found"
        # shapes Massive uses; the 200-body one is handled below.
        raise _ERR.not_found(f"Massive get_quote: {sym!r} not found (HTTP 404)")
    try:
        resp.raise_for_status()
    except Exception as exc:
        raise _ERR.transient(f"Massive get_quote unexpected status {resp.status_code}") from exc
    try:
        data = resp.json()
    except ValueError as exc:
        raise _ERR.transient("Massive get_quote returned non-JSON body") from exc

    status = data.get("status")
    if status not in ("OK", "DELAYED"):
        raise _ERR.not_found(f"Massive get_quote: no data for {sym!r} (status={status!r})")

    return _pe.ProviderResult(
        value=data.get("ticker") or {},
        provenance=_pe.ProvenanceRecord(vendor="massive", source_activity="massive_client.get_quote"),
        licensing_class=_plc.licensing_class_for("massive", "quotes"),
        freshness="real_time",
    )
