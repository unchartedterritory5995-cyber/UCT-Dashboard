"""Shared plumbing for the corrected-V2 final validation.

⛔ READ-ONLY BY CONSTRUCTION. Every artifact is opened `mode=ro&immutable=1`, so SQLite
creates no -wal/-shm beside it and cannot write. The FROZEN artifact is only ever read to
verify its hash and to make the disposable scratch copy; every query runs on the copy.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time

AUDIT = "/data/_audit"
FROZEN = AUDIT + "/breadth_replacement_v2_corrected_COMPLETE_FROZEN_2026-09-23.db"
FROZEN_SHA = "ad8c157fceafad163b844b113cb1784a9d9672ccbb732ed6c8a8270d37afe8e8"
FROZEN_BYTES = 78540800
WORK = AUDIT + "/validation/v2c_final"
SCRATCH = WORK + "/scratch_copy_of_frozen.db"
OUT = WORK + "/out"

ORIG_V2 = AUDIT + "/breadth_replacement_v2_FROZEN_NOT_VALIDATED.db"
V1 = AUDIT + "/validation/ref_breadth_replacement_v1.db"
PROD = AUDIT + "/validation/prodsnap/breadth_daily_ohlc.db"
GROUPED = "/data/grouped_closes"
PINNED_UCT = AUDIT + "/validation/pinned_uct_universe.json"
REFERENCE = "/data/breadth_pit_reference.json"

UNIVERSES = ("uct", "us", "nasdaq", "nyse")


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ro(path: str) -> sqlite3.Connection:
    c = sqlite3.connect("file:%s?mode=ro&immutable=1" % path, uri=True)
    return c


def scratch() -> sqlite3.Connection:
    assert os.path.exists(SCRATCH), "run p0_protect first"
    return ro(SCRATCH)


def write(name: str, obj) -> str:
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    if os.path.exists(p):                       # never overwrite a prior result
        p = p.replace(".json", "_%s.json" % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    with open(p, "x") as f:
        json.dump(obj, f, indent=1, default=str)
    return p


def grouped(iso: str, adjusted: bool = True) -> dict:
    """Provider grouped daily closes for one session, provider ticker form -> dash form."""
    p = os.path.join(GROUPED, "%s_%d.json" % (iso, 1 if adjusted else 0))
    try:
        with open(p) as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return {}
    return {k.replace(".", "-"): float(v) for k, v in raw.items()
            if isinstance(v, (int, float)) and v > 0}


def calendar() -> list:
    return sorted(f[:-7] for f in os.listdir(GROUPED) if f.endswith("_1.json"))
