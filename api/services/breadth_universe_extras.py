"""Up Vol / HVC / >7xATR on US / Nasdaq / NYSE (2026-11-23).

⭐⭐ WHY (owner, 2026-11-23): "all the breadth metrics on every universe, all the way back to 2008."
The universe authorities (V2 US, Exchange V1 NYSE / Nasdaq) never produced these three columns,
so the Monitor showed "n/a" for them off UCT, even in 2026.

⭐ HOW THE SERIES IS BUILT (once, on the breadth runner; tools/breadth/uct_pit/umem.py + ucompute.py):
  • the membership: production's own rules, per session: `breadth_corrected_pass.resolve_universes`
    (common stock / ADR on a US venue, as of that date, in the PIT reference) for US, then the
    venue ledger's split (`exch_grind`) for NYSE / Nasdaq. Graded against the frozen artifacts' own
    list sizes: US median 0.04% (p95 0.23%); Nasdaq median 0.07%; NYSE median 0.
  • the columns: the same production engine the UCT point-in-time rebuild uses
    (`breadth_live.compute_metrics` via `breadth_history_recon.recompute_from_frame`, and
    `breadth_eod_extras.atr_extended` line for line) over the provider's day files.

⛔ ONLY THESE THREE KEYS, ONLY WHERE THE SERIES HAS THE SESSION. Every other per-universe column
still comes from the authorities. A session the series does not hold stays blank ("n/a").

⛔ OFF unless BREADTH_UNIVERSE_EXTRAS=1 AND the series is present (/data, else restored from R2).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import threading
from typing import Optional

VERSION = "universe-extras-v1"
KEYS = ("up_vol_ratio", "hvc_52w", "atr_ext_7")
_DATA = os.environ.get("DATA_DIR", "/data")
SERIES_PATH = os.path.join(_DATA, "breadth_universe_extras_v1.json")
R2_KEY = "breadth_universe_extras/v1.json.gz"

_lock = threading.Lock()
_view: dict = {}


def enabled() -> bool:
    return os.environ.get("BREADTH_UNIVERSE_EXTRAS", "").strip().lower() in ("1", "true", "yes", "on")


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
    return f"_uex{s['_token']}" if s.get("rows") else ""


def values(universe: str, date_iso: str) -> Optional[dict]:
    """{key: value} for the session, or None (off / not in the series)."""
    if not active():
        return None
    return ((_series().get("rows") or {}).get(universe) or {}).get(date_iso)
