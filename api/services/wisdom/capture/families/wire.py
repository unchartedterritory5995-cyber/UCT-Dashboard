"""D12 family: the Morning Wire payload — /data wire_data.json is OVERWRITTEN on every push.

Read through ``engine._load_wire_data`` (cache, then the volume file). The push
writer is not atomic, so a None is retried once before it becomes a gap. The
archive keys on the payload's OWN ``date``: on a weekend the payload is still
Friday's, and capturing it under Saturday would manufacture a second observation.
"""
from __future__ import annotations

import time
from typing import Optional

from api.services.wisdom.capture.families._base import result, safe_reader, session_of, to_date, unavailable

FAMILY = "wire"
SOURCE = "api.services.engine._load_wire_data"
RETRY_DELAY_S = 2.0


def load_wire() -> Optional[dict]:
    """The current wire payload, or None. Shared by the candidates and wire_inputs readers."""
    from api.services import engine

    data = engine._load_wire_data()
    if not data:
        time.sleep(RETRY_DELAY_S)
        data = engine._load_wire_data()
    return data if isinstance(data, dict) and data else None


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    expected = session_of(now_et)
    data = load_wire()
    if data is None:
        return unavailable(FAMILY, as_of=as_of or expected, source=SOURCE, gap="wire_data",
                           reason="engine._load_wire_data() returned nothing twice (cache cold and the "
                                  "volume file absent, unparseable or mid-write)")
    gaps: dict = {}
    meta: dict = {"top_level_keys": sorted(str(k) for k in data.keys())}
    wire_date = to_date(data.get("date"))
    if wire_date is None:
        gaps["date"] = "payload carries no parseable 'date'; keyed on the session of the run"
        wire_date = expected
    if as_of is not None:
        if to_date(as_of) != wire_date:
            gaps["as_of_requested"] = (f"requested {to_date(as_of)}, the live payload is dated {wire_date}; "
                                       "archived under the payload's own date")
    elif wire_date < expected:
        gaps["stale"] = f"the newest wire is dated {wire_date}; session {expected} has no push"
        meta["stale_session"] = expected.isoformat()
    return result(FAMILY, as_of=wire_date, source=SOURCE, rows=len(data), payload=data, gaps=gaps, meta=meta)
