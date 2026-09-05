"""Analyst ratings + price targets + recent grade actions (FMP Ultimate).

Composes five FMP stable endpoints into one analyst picture for a ticker:
  - grades-consensus      → current buy/hold/sell bucket counts + label
  - price-target-consensus→ target high/low/median/consensus
  - price-target-summary  → recency-weighted avg targets (month/quarter/year)
  - grades                → recent upgrade/downgrade/maintain actions (feed)
  - grades-historical     → monthly bucket snapshots (rating trend)

Returns one dict (or None when nothing resolves). Every sub-call is defensive —
a single failing endpoint nulls only its own slice, never the whole payload.
Cached 6h. Never raises.

2026-09-03 (dedicated Analyst Ratings slice): this is now the CANONICAL
composer for the research page's Analyst Ratings tab
(`api/services/research/analyst_ratings.py`). Canonical identity resolves
through Entity Master (`resolve_entity(ticker, vendor="fmp")`) before any
FMP call, on the SUCCESS path only (mirrors `sec_filings.py`'s A6/A7
precedent — the "no data at all" miss path stays byte-for-byte unchanged;
the research-page wrapper resolves entity independently for that case, the
same way every other `research/*.py` module already does regardless of
what its own data legs return). `recent_actions` now carries the same S8
`_meta` envelope `consensus`/`price_target` already had — one envelope for
the whole leg, not per-row, matching the calendar page's identical A5
precedent. Two other production consumers exist for THIS module's ticker
argument today (`catalyst/analyst_actions.py`, `catalyst/engine.py`, via
the raw typed `fmp_client.get_analyst_grades`, not this composer) — neither
calls this composer function, so none of this is a behavior change for them.
"""
from __future__ import annotations

import logging
from typing import Optional

from api.services import fmp_client
from api.services.cache import cache as _cache_singleton
from api.services.research.entity_resolution import resolve_entity

_log = logging.getLogger(__name__)

cache = _cache_singleton          # module-level handle — tests patch this
_TTL = 6 * 3_600                  # 6h — analyst data moves slowly intra-day
# A result shaped by a PROVIDER FAILURE self-heals in 5 min instead of 6h. The
# two are not the same thing: "this small-cap has no analyst coverage" is a real
# answer worth holding for 6h, while "FMP timed out" is not an answer at all and
# used to be indistinguishable from it — both cached `{"_miss": True}` for the
# full 6h, so one transient blip blanked a ticker's analyst panel for the rest
# of the session.
_FAIL_TTL = 300
_MAX_ACTIONS = 12                 # recent grade actions to surface
_MAX_TREND = 6                    # months of rating-bucket history


def _num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _first(data):
    return data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None


def _fmp_row(fn, ticker: str, **kwargs) -> Optional[dict]:
    """The first row from a `fmp_client` typed function, or None on ANY
    outcome that isn't a genuine row (not configured, network error,
    rate-limited, degraded, or genuinely no data) — mirrors the retired
    `ee._fmp_get`'s "None on any failure, never raises" contract exactly,
    so `get_analyst_grades`'s per-leg `all_answered` accounting (which was
    written assuming the FMP call itself never raises) stays unchanged."""
    try:
        result = fn(ticker, **kwargs)
    except Exception:
        return None
    if result.degraded is not None:
        return None
    return _first(result.value)


def _fmp_rows(fn, ticker: str, **kwargs) -> list:
    """Same contract as `_fmp_row`, for a leg that wants the whole list."""
    try:
        result = fn(ticker, **kwargs)
    except Exception:
        return []
    if result.degraded is not None:
        return []
    return result.value if isinstance(result.value, list) else []


def _fmp_row_with_meta(fn, ticker: str, **kwargs) -> tuple[Optional[dict], Optional[dict]]:
    """Same contract as `_fmp_row`, but ALSO returns D1's own typed provenance
    envelope (`ProviderResult.provenance`/`.freshness`/`.degraded`) alongside
    the extracted row — used ONLY by the two legs (`_consensus`,
    `_price_target`) whose cards render S8 `<Provenance>`/`<FreshnessBadge>`
    UI. `_fmp_row`/`_fmp_rows` are left untouched (same contract, same
    failure semantics) so `_recent_actions`/`_trend` and every existing
    caller of this module are byte-for-byte unaffected.

    Unlike `_fmp_row`, a `degraded` result is NOT converted to a hard miss
    when it still carries a usable row (e.g. `cached_forbidden` — the vendor's
    own memory of a fact a fresh call can no longer confirm): the row is
    honest, older data, and the caller renders that fact through
    `availabilityContract.js`'s existing `ENTITLEMENT_DENIED` state rather
    than losing the card entirely. A `degraded` result with NO row (e.g.
    `circuit_open`) still returns `(None, None)`, same as any other miss.
    """
    try:
        result = fn(ticker, **kwargs)
    except Exception:
        return None, None
    row = _first(result.value) if result.value else None
    if row is None:
        return None, None
    meta = {
        "vendor": result.provenance.vendor,
        "sourceActivity": result.provenance.source_activity,
        "fetchedAt": result.provenance.fetched_at,
        "sourceObservedAt": result.provenance.source_observed_at,
        "tieBreak": result.provenance.tie_break,
        "freshnessClass": result.freshness,
        "licensingClass": result.licensing_class,
        "degraded": result.degraded,
    }
    return row, meta


def _fmp_rows_with_meta(fn, ticker: str, **kwargs) -> tuple[list, Optional[dict]]:
    """Same contract as `_fmp_row_with_meta`, for a leg whose card wants the
    WHOLE list plus ONE provenance envelope describing the leg as a whole —
    never per-row metadata (matches the calendar page's identical A5
    precedent: an envelope over a merged/multi-row leg, not per-entry S8
    badges, which would clutter a dense list). `(< >, None)` on any miss —
    empty list, failure, or a degraded result with nothing usable."""
    try:
        result = fn(ticker, **kwargs)
    except Exception:
        return [], None
    rows = result.value if isinstance(result.value, list) else []
    if not rows:
        return [], None
    meta = {
        "vendor": result.provenance.vendor,
        "sourceActivity": result.provenance.source_activity,
        "fetchedAt": result.provenance.fetched_at,
        "sourceObservedAt": result.provenance.source_observed_at,
        "tieBreak": result.provenance.tie_break,
        "freshnessClass": result.freshness,
        "licensingClass": result.licensing_class,
        "degraded": result.degraded,
    }
    return rows, meta


def _consensus(ticker: str) -> Optional[dict]:
    row, meta = _fmp_row_with_meta(fmp_client.get_grades_consensus, ticker)
    if not row:
        return None
    buckets = {k: int(row.get(k) or 0) for k in
               ("strongBuy", "buy", "hold", "sell", "strongSell")}
    total = sum(buckets.values())
    if total == 0:
        return None
    return {**buckets, "total": total, "label": row.get("consensus") or None, "_meta": meta}


def _price_target(ticker: str) -> Optional[dict]:
    con, con_meta = _fmp_row_with_meta(fmp_client.get_price_target_consensus, ticker)
    con = con or {}
    summ = _fmp_row(fmp_client.get_price_target_summary, ticker) or {}
    out = {
        "high":      _num(con.get("targetHigh")),
        "low":       _num(con.get("targetLow")),
        "median":    _num(con.get("targetMedian")),
        "consensus": _num(con.get("targetConsensus")),
        "last_month":   {"count": int(summ.get("lastMonthCount") or 0),
                         "avg": _num(summ.get("lastMonthAvgPriceTarget"))},
        "last_quarter": {"count": int(summ.get("lastQuarterCount") or 0),
                         "avg": _num(summ.get("lastQuarterAvgPriceTarget"))},
        "last_year":    {"count": int(summ.get("lastYearCount") or 0),
                         "avg": _num(summ.get("lastYearAvgPriceTarget"))},
        "_meta": con_meta,
    }
    if out["consensus"] is None and out["last_quarter"]["avg"] is None:
        return None
    return out


# `/stable/grades`'s real live-captured action vocabulary (see
# tests/test_analyst_intel_fmp_shapes.py's GRADES_NEWS_FIXTURE, captured
# live from the sibling grades-news endpoint) includes "initialise" (the
# British spelling) alongside "hold" — this file's own prior comment
# assumed only "upgrade/downgrade/maintain/initiate". Normalize ONLY the
# one case that's unambiguously the same word spelled two ways; "hold" is
# left as-is rather than guessed to mean the same thing as "maintain".
_ACTION_NORMALIZE = {"initialise": "initiate"}


def _recent_actions(ticker: str) -> dict:
    data, meta = _fmp_rows_with_meta(fmp_client.get_analyst_grades, ticker, limit=40)
    out: list[dict] = []
    seen: set[tuple] = set()
    for row in data:
        if not isinstance(row, dict):
            continue
        action = (row.get("action") or "").lower()
        action = _ACTION_NORMALIZE.get(action, action)
        date = str(row.get("date") or "")[:10]
        company = row.get("gradingCompany") or ""
        from_grade = row.get("previousGrade") or None
        to_grade = row.get("newGrade") or None
        # Minimum trustworthy normalization for a first slice (owner scope,
        # 2026-09-03): collapse an EXACT repeat of the same action -- never a
        # broader analyst/firm-identity reconciliation.
        key = (date, company, action, from_grade, to_grade)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "date":       date,
            "company":    company,
            "action":     action,
            "from_grade": from_grade,
            "to_grade":   to_grade,
        })
    # FMP returns newest-first; keep order, cap AFTER dedup.
    return {"items": out[:_MAX_ACTIONS], "_meta": meta}


def _trend(ticker: str) -> list[dict]:
    data = _fmp_rows(fmp_client.get_grades_historical, ticker, limit=_MAX_TREND)
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        out.append({
            "date":       str(row.get("date") or "")[:10],
            "strongBuy":  int(row.get("analystRatingsStrongBuy") or 0),
            "buy":        int(row.get("analystRatingsBuy") or 0),
            "hold":       int(row.get("analystRatingsHold") or 0),
            "sell":       int(row.get("analystRatingsSell") or 0),
            "strongSell": int(row.get("analystRatingsStrongSell") or 0),
        })
    return out[:_MAX_TREND]


def get_analyst_grades(ticker: str) -> Optional[dict]:
    """Composed analyst picture for `ticker`, or None when nothing resolves."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return None

    cache_key = f"analyst_grades_{ticker}"       # keyed on the CANONICAL ticker, never the vendor symbol
    cached = cache.get(cache_key)
    if cached is not None:
        return None if cached.get("_miss") else cached

    # S3: resolve canonical identity before any FMP call. `fmp_symbol` (falls
    # back to `ticker` on any resolution/vendor-symbol miss) is what actually
    # reaches every leg below, so a renamed/reused/dual-class ticker (e.g.
    # BRK-B) hits FMP under its real vendor symbol. `entity` is threaded onto
    # the SUCCESS-path payload only, mirroring `sec_filings.py`'s A6/A7
    # precedent — the "no data at all" miss path below is left byte-for-byte
    # unchanged; the research-page wrapper resolves entity independently for
    # that case, the same way every other `research/*.py` module already does.
    entity, fmp_symbol = resolve_entity(ticker, vendor="fmp")

    # Track whether each leg ANSWERED, separately from what it answered. An
    # empty result from a leg that ran cleanly is a fact about the company; an
    # empty result from a leg that raised is a fact about the provider. Same
    # shape as research/ownership.py's yf_ok/insider_ok.
    all_answered = True

    # The four legs are INDEPENDENT provider calls. Run sequentially they cost
    # ~3.25s end-to-end — over the 2-3s budget this panel is held to — while
    # each leg is only ~0.8s. Fan them out and the endpoint costs the slowest
    # leg instead of their sum.
    #
    # Its OWN executor, not a plain run_in_threadpool: this handler is a sync
    # `def`, so it is already occupying one anyio worker thread. Borrowing three
    # more from that same shared pool is what starves the request path under
    # load.
    from concurrent.futures import ThreadPoolExecutor

    legs = (("consensus", _consensus, None),
            ("price_target", _price_target, None),
            ("actions", _recent_actions, {"items": [], "_meta": None}),
            ("trend", _trend, []))
    got: dict = {}
    with ThreadPoolExecutor(max_workers=len(legs),
                            thread_name_prefix="grades") as ex:
        futures = [(name, on_fail, ex.submit(fn, fmp_symbol))
                   for name, fn, on_fail in legs]
        for name, on_fail, fut in futures:
            try:
                got[name] = fut.result()
            except Exception:
                # Per-leg isolation is preserved exactly: one failing endpoint
                # nulls only its own slice and flips all_answered, which is what
                # separates "no analyst coverage" (hold 6h) from "provider
                # blipped" (retry in 5 min).
                got[name] = on_fail
                all_answered = False

    consensus = got["consensus"]
    price_target = got["price_target"]
    actions = got["actions"]
    trend = got["trend"]

    # `actions` is now a dict ({"items": [...], "_meta": ...}), always
    # truthy even when empty -- the real "did this leg contribute anything"
    # signal is its `items` list, not the dict's own truthiness.
    if not (consensus or price_target or actions.get("items")):
        # No data. Hold it 6h only if every provider actually ANSWERED — that
        # is genuine "no analyst coverage". If any leg raised, this emptiness
        # is the outage talking, so retry in 5 min.
        # Deliberately this module's own `cache`, not cache_policy's
        # set_by_completeness: that helper writes through the shared singleton
        # and would bypass the module-level seam the existing tests patch. The
        # policy is identical — the completeness decision is what matters, not
        # which helper applies it.
        cache.set(cache_key, {"_miss": True},
                  ttl=_TTL if all_answered else _FAIL_TTL)
        return None

    payload = {
        "symbol":         ticker,
        "entity":         entity,
        "consensus":      consensus,
        "price_target":   price_target,
        "recent_actions": actions,
        "trend":          trend,
    }
    # A payload assembled while a leg was down is missing a section it would
    # otherwise have; hold it briefly so the gap fills rather than persisting
    # a partial picture for 6h.
    cache.set(cache_key, payload, ttl=_TTL if all_answered else _FAIL_TTL)
    return payload
