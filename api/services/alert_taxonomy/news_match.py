"""S7 trigger type `news-match`: a Trade Exchange headline that names a ticker or
contains a keyword the member chose (owner-approved 2026-10-27, Checkpoint A).

Unlike every other S7 type this one is EVENT-DRIVEN, not a sweep: the Trade
Exchange News pipeline hands each NEW headline here (``on_headline``) right
after its commit -- on a separate one-thread pool, never the writer thread, so
email I/O can never slow the live stream.

THE RULES (each one is a test in tests/test_alert_news_match.py):
  * ⛔ THE DURABLE RECORD IS `alert_fires`. Every fire goes through
    `receipts.record_fire` (UNIQUE(predicate_id, fire_key) is the dedup, the
    key is the headline's event id) and then `delivery.deliver` (lease,
    routing, caps) -- the same path as every other S7 type.
  * ⛔ ONE ALERT PER MEMBER PER HEADLINE, however many of their rules match:
    the first matching rule fires and the others are listed in its detail.
  * ⛔ ONLY NEW HEADLINES. A collapsed repeat never fires again, and a headline
    that reached web more than ``MAX_ALERT_DELAY_MS`` after receipt (recovered
    after an outage) is NOT alerted -- a stale "breaking" alert is worse than
    none. The widget still shows it, marked delayed.
  * NO AI. Tickers come from the headline's own `tickers` (the one
    `ticker_resolver`, HEADLINE context -- provisional until real samples are
    reviewed); keywords use the transcript-keyword rules (normalised, at least
    3 characters, word-boundary match allowing a plural/suffix).
  * NO HISTORY REPLAY: a rule only ever sees headlines that arrive after it.

DARK: `ALERT_NEWS_MATCH_ENABLED` (default off, read per call). Off: the routes
404 and `on_headline` does nothing. Not registered at boot (no CP3 entry is
signed); the routes register the type on demand, as rating-change does.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

from api.services.alert_taxonomy import delivery as _delivery
from api.services.alert_taxonomy import ops_monitor as _ops
from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import receipts as _receipts
from api.services.alert_taxonomy import registry as _registry
from api.services.alert_taxonomy.predicates import PredicateRegistrationError
from api.services.transcript_keyword_alerts import normalize_keyword

logger = logging.getLogger(__name__)

TYPE_ID = "news-match"
FLAG = "ALERT_NEWS_MATCH_ENABLED"
SOURCE = "news_match"
MAX_TICKERS = 10
MAX_KEYWORDS = 10
MAX_RULES_PER_USER = 25
MAX_ALERT_DELAY_MS = 10 * 60 * 1000
MODES = ("any", "all")
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]{0,9}(?:-[A-Z0-9]{1,4})?$")
PARAMS_SCHEMA = {
    "tickers": "list[str] -- fire when the headline names any of these (canonical, upper-case)",
    "keywords": "list[str] -- fire when the headline contains any of these (>= 3 chars)",
    "mode": "'any' (default): a ticker OR a keyword; 'all': a ticker AND a keyword",
}

_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="news-match")


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def register() -> None:
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__)


# ── rules ────────────────────────────────────────────────────────────────────

def clean_params(tickers=None, keywords=None, mode: str = "any") -> dict[str, Any]:
    ts = sorted({str(t).strip().upper().replace(".", "-") for t in (tickers or []) if str(t).strip()})
    bad = [t for t in ts if not _TICKER_RE.match(t)]
    if bad:
        raise PredicateRegistrationError(f"news-match: not a ticker: {', '.join(bad[:3])}")
    kws = []
    for raw in keywords or []:
        k = normalize_keyword(str(raw))
        if not k:
            raise PredicateRegistrationError(
                "news-match: each keyword must be 3 to 60 characters")
        kws.append(k)
    kws = sorted(set(kws))
    if not ts and not kws:
        raise PredicateRegistrationError("news-match: give at least one ticker or keyword")
    if len(ts) > MAX_TICKERS or len(kws) > MAX_KEYWORDS:
        raise PredicateRegistrationError(
            f"news-match: at most {MAX_TICKERS} tickers and {MAX_KEYWORDS} keywords per rule")
    mode = (mode or "any").lower()
    if mode not in MODES:
        raise PredicateRegistrationError("news-match: mode must be 'any' or 'all'")
    if mode == "all" and not (ts and kws):
        raise PredicateRegistrationError("news-match: 'all' needs both a ticker and a keyword")
    return {"tickers": ts, "keywords": kws, "mode": mode}


def rule_id(params: dict[str, Any]) -> str:
    """A rule's identity is its content: the same tickers+keywords+mode is the
    same rule (re-adding it reactivates rather than duplicates)."""
    blob = "|".join([",".join(params["tickers"]), ",".join(params["keywords"]), params["mode"]])
    return "news:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def register_predicate_for_user(user_id: str, *, tickers=None, keywords=None,
                                mode: str = "any") -> str:
    if not user_id:
        raise PredicateRegistrationError("user is required")
    params = clean_params(tickers, keywords, mode)
    active = _predicates.list_predicates(type_id=TYPE_ID, user_id=user_id, active_only=True)
    rid = rule_id(params)
    if len(active) >= MAX_RULES_PER_USER and all(p["entity_scope"].get("id") != rid for p in active):
        raise PredicateRegistrationError(
            f"news-match: at most {MAX_RULES_PER_USER} news alerts per member")
    scope = {"kind": "news_rule", "id": rid, "asOf": None}
    return _predicates.register_predicate(TYPE_ID, scope, params, user_id, None)


# ── matching ─────────────────────────────────────────────────────────────────

def _kw_pattern(kw: str) -> re.Pattern:
    # The transcript-keyword rule (transcript_keyword_alerts.find_mentions):
    # word boundary, internal whitespace flexible, up to 3 suffix characters.
    return re.compile(r"\b" + re.escape(kw).replace(r"\ ", r"\s+") + r"\w{0,3}\b", re.I)


def match(params: dict[str, Any], headline: dict[str, Any]) -> dict[str, list[str]] | None:
    """The matched tickers/keywords, or None. Pure."""
    names = {str(t).upper() for t in headline.get("tickers") or []}
    tick = [t for t in params.get("tickers") or [] if t in names]
    text = headline.get("content") or ""
    kws = [k for k in params.get("keywords") or [] if _kw_pattern(k).search(text)]
    if params.get("mode") == "all":
        ok = bool(tick) and bool(kws)
    else:
        ok = bool(tick) or bool(kws)
    return {"tickers": tick, "keywords": kws} if ok else None


def _texts(d: dict[str, Any]) -> tuple[str, str]:
    """The ONE place a news-match alert's words are built (live + reconstructed).
    The headline is quoted as Trade Exchange sent it; nothing is invented."""
    what = ", ".join([*(d.get("matched_tickers") or []), *(f'"{k}"' for k in d.get("matched_keywords") or [])])
    title = f"News: {what}" if what else "News alert"
    content = (d.get("content") or "").strip()
    message = content if len(content) <= 280 else content[:279] + "…"
    return title, message


def _evaluate(headline: dict[str, Any], now_ms: int | None = None) -> dict[str, Any]:
    now = int(now_ms or time.time() * 1000)
    if (now - int(headline.get("received_at_ms") or now)) > MAX_ALERT_DELAY_MS:
        return {"outcome": "stale", "fired": 0}
    active = _predicates.list_predicates(type_id=TYPE_ID, active_only=True)
    by_user: dict[str, list[tuple[dict, dict]]] = {}
    for p in active:
        try:
            m = match(p.get("params") or {}, headline)
        except Exception:  # noqa: BLE001 -- one bad rule never aborts the headline
            continue
        if m:
            by_user.setdefault(p["user_id"], []).append((p, m))
    fired, results = 0, []
    eid = headline["id"]
    for user_id, hits in by_user.items():
        p, m = hits[0]
        tickers = sorted({t for _, mm in hits for t in mm["tickers"]})
        kws = sorted({k for _, mm in hits for k in mm["keywords"]})
        fire_key = f"news:{eid}"
        detail = {"event_id": eid, "seq": headline.get("seq"), "source": headline.get("source"),
                  "content": headline.get("content"), "received_at_ms": headline.get("received_at_ms"),
                  "matched_tickers": tickers, "matched_keywords": kws,
                  "rules": [hp["id"] for hp, _ in hits], "tickers_provisional": True}
        fire_id = _receipts.record_fire(
            predicate_id=p["id"], trigger_type=TYPE_ID, user_id=user_id, entity_ref=p["entity_scope"].get("id"),
            fire_key=fire_key, detail=detail, source_data_class="trade_exchange_news",
            freshness_class="real_time", as_of=(headline.get("received_at_ms") or now) / 1000)
        if fire_id is None:
            results.append({"user_id": user_id, "outcome": "dedup_collision"})
            continue
        title, message = _texts(detail)
        sym = tickers[0] if tickers else ""
        extra = {"sym": sym, "s7_fire_key": fire_key, "event_id": eid,
                 "news_seq": headline.get("seq")}
        if sym:
            extra["research_url"] = f"/research/{sym}"
        report = _delivery.deliver(fire_id, user_id, sym, title, message, source=SOURCE,
                                   extra_data=extra, severity="info")
        fired += 1
        results.append({"user_id": user_id, "outcome": "fired", "fire_id": fire_id, "delivery": report})
    _ops.record_sweep(TYPE_ID, evaluated=len(active), fired=fired, could_not_evaluate=0)
    return {"outcome": "evaluated", "fired": fired, "results": results}


def evaluate_headline(headline: dict[str, Any], now_ms: int | None = None) -> dict[str, Any]:
    """Synchronous entry point (tests, and the pool below)."""
    if not is_enabled():
        return {"outcome": "disabled", "fired": 0}
    if headline.get("type") not in (None, "headline"):
        return {"outcome": "not_a_headline", "fired": 0}
    register()
    try:
        return _evaluate(headline, now_ms)
    except Exception as e:  # noqa: BLE001 -- an alert fault never touches the stream
        logger.warning("[news-match] evaluation failed: %s", type(e).__name__)
        return {"outcome": "error", "fired": 0, "error": type(e).__name__}


def on_headline(headline: dict[str, Any]) -> None:
    """The pipeline's hook: queue evaluation off the writer thread. Never raises."""
    if not is_enabled():
        return
    try:
        _POOL.submit(evaluate_headline, dict(headline))
    except RuntimeError:
        pass                                    # interpreter shutting down


def alert_shape_for_fire(fire: dict[str, Any]) -> dict[str, Any]:
    """The bell's durable reconstruction, from the fire's own frozen detail."""
    from zoneinfo import ZoneInfo
    d = fire.get("detail") or {}
    title, message = _texts(d)
    sym = (d.get("matched_tickers") or [""])[0]
    fired_at = fire.get("fired_at")
    ts = (datetime.fromtimestamp(fired_at, tz=ZoneInfo("America/New_York")).isoformat()
          if fired_at else "")
    data = {"symbol": sym, "sym": sym, "source": SOURCE, "event_id": d.get("event_id"),
            "news_seq": d.get("seq"), "s7_fire_key": fire.get("fire_key")}
    if sym:
        data["research_url"] = f"/research/{sym}"
    return {"id": f"s7fire_{fire['id']}", "type": TYPE_ID.replace("-", "_"), "severity": "info",
            "title": title, "message": message, "timestamp": ts,
            "read": fire.get("read_at") is not None, "user_id": fire.get("user_id"), "data": data}
