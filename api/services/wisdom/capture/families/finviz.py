"""D12 family: the Finviz universe artifact — screener_finviz.json is OVERWRITTEN nightly (02:45 ET).

The artifact's parsed content is archived under the ET date of its own
``as_of``; ``meta.source_sha256`` is the sha256 of the exact file bytes, so the
archived copy is checkable against the file that was read. The Finviz SCANNER
setups (PULLBACK_MA / REMOUNT / GAPPER_NEWS) run only on the PC and reach web as
``wire.candidates``, which the candidates dataset archives.
"""
from __future__ import annotations

import datetime as dt
import json
import os

from api.services.wisdom.capture.families._base import result, safe_reader, to_date, unavailable
from api.services.wisdom.core import ids, timeutil

FAMILY = "finviz"
SOURCE = "api.services.screener.finviz_universe._artifact_path"


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services.screener import finviz_universe

    path = finviz_universe._artifact_path()
    if not os.path.exists(path):
        return unavailable(FAMILY, as_of=as_of or now_et.date(), source=SOURCE, gap="finviz_artifact",
                           reason=f"no artifact at {path} (FINVIZ_API_KEY unset on this service, or the "
                                  "02:45 ET pull has never written one)")
    with open(path, "rb") as fh:
        raw = fh.read()
    try:
        artifact = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        return unavailable(FAMILY, as_of=as_of or now_et.date(), source=SOURCE, gap="finviz_unparseable",
                           reason=f"{type(exc).__name__}: {exc}"[:300])
    rows = artifact.get("rows") if isinstance(artifact, dict) else None
    if not isinstance(rows, dict):
        return unavailable(FAMILY, as_of=as_of or now_et.date(), source=SOURCE, gap="finviz_shape",
                           reason="artifact has no 'rows' object")
    gaps: dict = {}
    pulled = None
    try:
        pulled = timeutil.to_et(dt.datetime.fromisoformat(str(artifact.get("as_of")).replace("Z", "+00:00")))
    except (TypeError, ValueError):
        gaps["as_of"] = "artifact carries no parseable as_of; keyed on the run date"
    day = pulled.date() if pulled else now_et.date()
    meta = {"source_sha256": ids.sha256_bytes(raw), "source_bytes": len(raw),
            "missing_headers": artifact.get("missing_headers")}
    if as_of is not None:
        if to_date(as_of) != day:
            gaps["as_of_requested"] = f"requested {to_date(as_of)}, the artifact was pulled {day}"
    elif day < now_et.date():
        gaps["stale"] = f"artifact pulled {day}; no pull today ({now_et.date()})"
        meta["stale_session"] = now_et.date().isoformat()
    return result(FAMILY, as_of=day, source=SOURCE, rows=len(rows), payload=artifact, gaps=gaps, meta=meta)
