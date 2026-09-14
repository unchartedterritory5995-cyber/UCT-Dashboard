"""D12 family: scanner candidates — candidates.json and the wire envelope are OVERWRITTEN daily.

The envelope comes out of ``engine.get_candidates()`` and the rows are counted by
``engine.candidate_rows()``, the ONE reader of that envelope's shape (its
docstring records three readers that re-derived it and failed silently).
``get_candidates`` is cache-only and goes empty on weekends, so the volume-backed
``_load_wire_data`` runs first and re-seeds the cache it reads.
"""
from __future__ import annotations

from api.services.wisdom.capture.families import wire as wire_family
from api.services.wisdom.capture.families._base import result, safe_reader, session_of, to_date, unavailable

FAMILY = "candidates"
SOURCE = "api.services.engine.get_candidates+candidate_rows"


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services import engine

    expected = session_of(now_et)
    wire = wire_family.load_wire()
    envelope = engine.get_candidates()
    if not isinstance(envelope, dict) or not isinstance(envelope.get("candidates"), dict):
        return unavailable(FAMILY, as_of=as_of or expected, source=SOURCE, gap="candidates",
                           reason="get_candidates() returned no candidates envelope (wire payload absent "
                                  "or pushed without a scanner run)")
    rows = engine.candidate_rows()
    gaps: dict = {}
    meta: dict = {"buckets": sorted(envelope["candidates"].keys()),
                  "generated_at": envelope.get("generated_at")}
    market_date = to_date(envelope.get("market_date"))
    wire_date = to_date((wire or {}).get("date"))
    if market_date is None:
        market_date = wire_date or expected
        gaps["market_date"] = "envelope carries no market_date; keyed on the wire date"
    if wire is None:
        gaps["wire_data"] = "the wire payload was unreadable; the envelope came from the candidates cache"
    elif wire_date and wire_date != market_date:
        gaps["envelope_date"] = f"envelope market_date {market_date} differs from the wire date {wire_date}"
    if as_of is not None:
        if to_date(as_of) != market_date:
            gaps["as_of_requested"] = (f"requested {to_date(as_of)}, the live envelope is for {market_date}; "
                                       "archived under the envelope's own date")
    elif market_date < expected:
        gaps["stale"] = f"the newest candidates are for {market_date}; session {expected} has none"
        meta["stale_session"] = expected.isoformat()
    return result(FAMILY, as_of=market_date, source=SOURCE, rows=len(rows), payload=envelope,
                  gaps=gaps, meta=meta)
