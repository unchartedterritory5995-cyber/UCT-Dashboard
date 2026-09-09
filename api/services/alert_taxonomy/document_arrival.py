"""S7's first live trigger type: `document-arrival` (PRD-S7 §6.1 row 4;
SPEC-S7 §1.5/§5.2/§12 -- "needs engineering only," no existing subsystem to
migrate).

Data source: `api/services/sec_filings.py::recent_filings()` -- the
per-ticker submissions lookup, NOT `edgar.py`'s market-wide 8-K firehose
(SPEC §1.5's own correction: edgar.py "has no per-ticker filter and no
'have I seen this filing before' state"). Neither module has a watermark;
this module IS that watermark, persisted on the predicate's own
`last_seen_state` column (SPEC §12).

Temporal/freshness semantics -- modeled honestly, not forced from quote
data (owner instruction, §6): a SEC filing is not a D1-typed feed at all
(FMP/Massive don't carry EDGAR data), so a document-arrival fire's
`freshness_class` is honestly None -- D1's own documented "not established"
state, never a guessed tier. What IS precise and real is `as_of`: the
filing's own `filed` date (SEC's submissions JSON is date-only, no
intraday time -- also modeled honestly, not padded with a fabricated
time-of-day).

First-run handling: a NEW predicate's baseline (the newest filing that
already existed at registration time) is captured at registration, not on
the first sweep cycle -- so "no prior history to replay" (SPEC §5.6) is
true by construction; nothing already-existing at arm-time is ever reported
as a new arrival.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import sec_filings
from api.services.alert_taxonomy import delivery as _delivery
from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import receipts as _receipts
from api.services.alert_taxonomy import registry as _registry
from api.services.alert_taxonomy.predicates import PredicateRegistrationError

TYPE_ID = "document-arrival"
PARAMS_SCHEMA = {
    "form_type": "string | null -- SEC form code filter (e.g. '8-K', '10-Q'); null = any form",
    "keyword": "string | null -- reserved for the transcript-keyword leg (SPEC §1.5); "
               "not evaluated by this module -- see module docstring's scope note",
}
_FETCH_COUNT = 5  # newest N filings per (ticker, form_type) -- only [0] is used as the
                  # watermark comparison, the rest give the sweep context for logging/debug

_ET = ZoneInfo("America/New_York")  # matches api/services/alerts.py's _now_et() exactly,
                                     # so a reconstructed row sorts correctly beside ephemeral ones


def register() -> None:
    """Idempotent -- call at process start. Registers the type so
    `alert_predicates.type_id` foreign-key-style validation (predicates.py's
    `is_registered` check) accepts `document-arrival` predicates."""
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__)


def _parse_filed_date_epoch(filed: str) -> float:
    """SEC's `filed` field is 'YYYY-MM-DD', date-only. Midnight UTC on that
    date -- an honest, documented precision floor, not a fabricated
    intraday timestamp."""
    try:
        dt = datetime.strptime(filed, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return time.time()  # malformed date from the provider -- fall back to "now" rather
                             # than raise; the real filed date is still preserved in `detail`


def register_predicate_for_user(
    user_id: str,
    ticker: str,
    *,
    form_type: Optional[str] = None,
    keyword: Optional[str] = None,
    channels: Optional[list[str]] = None,
) -> str:
    """Register a document-arrival predicate. Validates the ticker actually
    resolves in SEC's CIK map (a real, evidenced pre-condition for this
    trigger type specifically -- SPEC §5.2's generic cap_universe.json
    validation is necessary but not sufficient here: a symbol can be a real
    equity and still have no SEC filer record). Raises
    PredicateRegistrationError with a named reason on failure -- never
    silently accepted (SPEC §5.2/§9)."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        raise PredicateRegistrationError("ticker is required")

    baseline = sec_filings.recent_filings(ticker, form_type=form_type or "", count=1)
    if "error" in baseline:
        raise PredicateRegistrationError(f"document-arrival: {baseline['error']}")

    entity_scope = _predicates.resolve_entity_scope(ticker)
    params = {"form_type": form_type, "keyword": keyword}
    predicate_id = _predicates.register_predicate(TYPE_ID, entity_scope, params, user_id, channels)

    newest_accession = baseline["filings"][0]["accession"] if baseline["filings"] else None
    _predicates.update_last_seen_state(predicate_id, {"accession": newest_accession})
    return predicate_id


def _evaluate_one(predicate: dict[str, Any], fetch_cache: dict[tuple, dict]) -> Optional[dict]:
    """One predicate's evaluation. Returns a result dict on any outcome
    (fired / no-new-filing / error) -- callers accumulate these; never
    raises (the sweep's own try/except is the backstop, but this function
    is written defensively so a malformed row can't escalate)."""
    ticker = predicate["entity_scope"].get("symbol") or predicate["entity_scope"].get("id")
    entity_ref = predicate["entity_scope"].get("id")
    form_type = predicate["params"].get("form_type") or ""

    cache_key = (ticker, form_type)
    if cache_key not in fetch_cache:
        fetch_cache[cache_key] = sec_filings.recent_filings(ticker, form_type=form_type, count=_FETCH_COUNT)
    result = fetch_cache[cache_key]

    if "error" in result:
        return {"predicate_id": predicate["id"], "outcome": "error", "error": result["error"]}

    filings = result.get("filings") or []
    if not filings:
        return {"predicate_id": predicate["id"], "outcome": "no_data"}

    newest = filings[0]
    last_seen = (predicate.get("last_seen_state") or {}).get("accession")
    if not newest.get("accession") or newest["accession"] == last_seen:
        return {"predicate_id": predicate["id"], "outcome": "no_new_filing"}

    fire_key = f"occ:{newest['accession']}"
    as_of = _parse_filed_date_epoch(newest.get("filed", ""))
    fire_id = _receipts.record_fire(
        predicate_id=predicate["id"],
        trigger_type=TYPE_ID,
        user_id=predicate["user_id"],
        entity_ref=entity_ref,
        fire_key=fire_key,
        detail={
            "form": newest.get("form"), "accession": newest["accession"],
            "url": newest.get("url"), "filed": newest.get("filed"),
            "company": result.get("company"), "ticker": ticker,
        },
        source_data_class="sec_filing",
        freshness_class=None,  # honest: SEC filings are not a D1-typed feed (see module docstring)
        as_of=as_of,
    )
    # Watermark advances regardless of whether THIS process won the fire race
    # (fire_id is None on a dedup collision) -- the accession number is the
    # same real fact either way, and a losing process must not re-attempt it
    # forever.
    _predicates.update_last_seen_state(predicate["id"], {"accession": newest["accession"]})

    if fire_id is None:
        return {"predicate_id": predicate["id"], "outcome": "dedup_collision"}

    company = result.get("company") or ticker
    title = f"New {newest.get('form', 'filing')} — {ticker}"
    message = f"{company} filed a {newest.get('form', 'document')} on {newest.get('filed', 'an unknown date')}."
    report = _delivery.deliver(
        fire_id, predicate["user_id"], ticker, title, message,
        source="document_arrival",
        extra_data={
            "sym": ticker, "research_url": f"/research/{ticker}",
            "filing_url": newest.get("url"), "accession": newest["accession"],
            "form": newest.get("form"),
        },
        severity="info",
    )
    return {"predicate_id": predicate["id"], "outcome": "fired", "fire_id": fire_id, "delivery": report}


def alert_shape_for_fire(fire: dict[str, Any]) -> dict[str, Any]:
    """Reconstruct the same shape add_alert()/get_alerts() produce, from a
    durable alert_fires row -- the S7 durable in-app bridge (owner
    authorization). Uses ONLY the fire's own immutable `detail` JSON (frozen
    at fire time) -- never a fresh provider/entity lookup, so a historical
    notification always describes the event that actually fired, not
    whatever the ticker/company looks like today."""
    detail = fire.get("detail") or {}
    ticker = detail.get("ticker") or fire.get("entity_ref") or ""
    form = detail.get("form") or "filing"
    filed = detail.get("filed") or "an unknown date"
    company = detail.get("company") or ticker
    fired_at = fire.get("fired_at")
    timestamp = datetime.fromtimestamp(fired_at, tz=_ET).isoformat() if fired_at else ""
    return {
        "id": f"s7fire_{fire['id']}",
        "type": TYPE_ID.replace("-", "_"),
        "severity": "info",
        "title": f"New {form} — {ticker}",
        "message": f"{company} filed a {form} on {filed}.",
        "timestamp": timestamp,
        "read": fire.get("read_at") is not None,
        "user_id": fire.get("user_id"),
        "data": {
            "symbol": ticker, "source": "document_arrival", "sym": ticker,
            "research_url": f"/research/{ticker}",
            "filing_url": detail.get("url"), "accession": detail.get("accession"),
            "form": form,
        },
    }


def run_document_arrival_sweep() -> dict[str, Any]:
    """The scheduled cycle (SPEC §12): bulk-load every active document-
    arrival predicate, batch the SEC fetch per DISTINCT (ticker, form_type)
    pair (not per predicate -- SPEC §18's batching requirement), evaluate
    each predicate against its own diff, never let one predicate's failure
    abort the cycle (SPEC §14)."""
    active = _predicates.list_predicates(type_id=TYPE_ID, active_only=True)
    fetch_cache: dict[tuple, dict] = {}
    results: list[dict] = []
    for predicate in active:
        try:
            results.append(_evaluate_one(predicate, fetch_cache))
        except Exception as e:  # noqa: BLE001 -- one bad predicate must never abort the cycle
            results.append({"predicate_id": predicate.get("id"), "outcome": "error", "error": str(e)})

    fired = sum(1 for r in results if r["outcome"] == "fired")
    errored = [r for r in results if r["outcome"] == "error"]
    return {
        "checked": len(active),
        "distinct_fetches": len(fetch_cache),
        "fired": fired,
        "errors": errored,
        "results": results,
    }
