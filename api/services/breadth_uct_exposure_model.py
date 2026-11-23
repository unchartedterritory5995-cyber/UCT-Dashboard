"""UCT Exp before the Morning Wire published it: the Exposure Rating formula, run on history.

⭐⭐ WHY (owner, 2026-11-23): "I want UCT-like exposure rating to go all the way back to 2008, based off
the calculations we use for it." The Breadth `uct_exposure` column is the Morning Wire's published
Exposure Rating for that date and nothing else (uct-intelligence `scripts/wire_exposure.py`). The wire
has published the current formula (calibration v2, morning_wire_engine `calculate_exposure`) since
2026-08-22; every earlier session is blank (the 2026-02-20..08-21 values were AI estimates and were
removed on 2026-11-19).

⭐ WHAT FILLS THE BLANKS: `tools/breadth/uct_exposure_model.py` runs the engine's whole exposure
machine — its distribution-day count, phase machine (circuit breaker, rally attempt, follow-through
day, S2 / B4 / restraint) and v2 `calculate_exposure` — day by day from 2003 on SPY/QQQ daily bars,
the same bars the engine reads. Row D gets the rating the engine would have published that morning,
from the bars through the session before.
  • Graded against every published rating since 2026-08-22: identical on every session from
    2026-09-25 on (41 of 41). 08-22..09-24 the live engine disagreed on 14 of 23 days (it carried
    phase state from before the recalibration); those published values are kept as published.

⛔ A PUBLISHED RATING IS NEVER REPLACED. Only a row before CUTOVER whose `uct_exposure` is blank is
filled, and it is marked `uct_exposure_model` so the UI says it is a rebuilt value, not a rating
the wire published.

⛔ OFF unless BREADTH_UCT_EXP_MODEL=1 AND the series is present (/data, else restored from R2).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import threading

VERSION = "uct-exp-model-v1"
#: The first session the wire published the current formula; nothing from here on is filled.
CUTOVER = "2026-08-22"
_DATA = os.environ.get("DATA_DIR", "/data")
SERIES_PATH = os.path.join(_DATA, "breadth_uct_exposure_model_v1.json")
R2_KEY = "breadth_uct_exposure_model/v1.json.gz"
MARK = "uct_exposure_model"

_lock = threading.Lock()
_view: dict = {}


def enabled() -> bool:
    return os.environ.get("BREADTH_UCT_EXP_MODEL", "").strip().lower() in ("1", "true", "yes", "on")


def _restore_from_r2() -> bool:
    try:
        from api.services import data_sync
        raw = data_sync.get_bytes(R2_KEY)
        if not raw:
            return False
        body = gzip.decompress(raw)
        json.loads(body)
        with open(SERIES_PATH + ".tmp", "wb") as fh:
            fh.write(body)
        os.replace(SERIES_PATH + ".tmp", SERIES_PATH)
        return True
    except Exception:
        return False


def _series() -> dict:
    try:
        st = os.stat(SERIES_PATH)
    except FileNotFoundError:
        if not _restore_from_r2():
            return {}
        st = os.stat(SERIES_PATH)
    key = (st.st_mtime_ns, st.st_size)
    with _lock:
        if _view.get("key") == key:
            return _view["data"]
    with open(SERIES_PATH, "rb") as fh:
        raw = fh.read()
    doc = json.loads(raw)
    if doc.get("version") != VERSION:
        doc = {}
    doc["_token"] = hashlib.sha256(raw).hexdigest()[:12] if doc else ""
    with _lock:
        _view.update(key=key, data=doc)
    return doc


def active() -> bool:
    return enabled() and bool(_series().get("rows"))


def token() -> str:
    """'' when off (every cache key byte-identical to before), else the series' content hash."""
    if not enabled():
        return ""
    s = _series()
    return f"_uxm{s['_token']}" if s.get("rows") else ""


def fill(rows_asc: list) -> int:
    """Fill blank `uct_exposure` before CUTOVER from the series, in place. Returns rows filled."""
    if not active():
        return 0
    series = _series()["rows"]
    n = 0
    for r in rows_asc:
        d = r.get("date") or ""
        if d >= CUTOVER or r.get("uct_exposure") is not None:
            continue
        v = series.get(d)
        if v is None:
            continue
        r["uct_exposure"] = v
        r[MARK] = True
        n += 1
    return n
