"""Run the ACCEPTED V2c2 methodology code inside ONE process (the dedicated V2 producer).

The corrected pass was accepted as 14 exact module files (`tools/breadth_v2/pinned`, byte-identical
to `origin/breadth/v2c-correction` 4ededea64, digests in `breadth_v2c2_pins.json`). They share
module names with master's V1 Breadth (`breadth_live`, `breadth_wick_recon`, …), so they are never
imported by the web or the worker: the producer process puts the pinned directory FIRST on
`api.services.__path__` before any Breadth import — exactly how the frozen grind ran — and every
other module comes from master.

⛔ `activate()` must run before anything imports an `api.services.breadth_*` module in this
process; it refuses if one already has been, and refuses if a pinned file's LF digest differs.

⭐ LIVE METHODOLOGY = pinned + ONE declared change (`EMA_RULE`): the 20-day EMA keeps an exact
value when the new observation equals it (pandas' adjust=False behaviour) instead of re-evaluating
`(w·ema + α·x)/(w+α)`, which drifts 1 ULP on a gapped constant series (the 21 accepted frozen
cells). It is installed by replacing `breadth_live._ewm_last` in THIS process only — master's V1
`breadth_live` and every chart-indicator EMA are untouched, and the frozen artifact is not
recomputed.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import numpy as np

PINNED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools", "breadth_v2", "pinned")
PINNED_DIR = os.path.normpath(PINNED_DIR)
BASE_METHODOLOGY = "rth-1m-composites-v2c2-div"
EMA_RULE = "ema-tie-exact-v1"
LIVE_METHODOLOGY = BASE_METHODOLOGY + "+" + EMA_RULE

_ACTIVE = {"on": False}


def pins() -> dict:
    return json.load(open(os.path.join(PINNED_DIR, "breadth_v2c2_pins.json")))


def pinned_digests() -> dict:
    out = {}
    for m in pins()["modules_md5_lf"]:
        b = open(os.path.join(PINNED_DIR, m), "rb").read().replace(b"\r\n", b"\n")
        out[m] = hashlib.md5(b).hexdigest()
    return out


def ewm_last_tie_exact(arr: np.ndarray, alpha: float) -> np.ndarray:
    """Final value of pandas `ewm(alpha, adjust=False, ignore_na=False)` per row — exact on ties.

    Identical to the pinned `_ewm_last` (weight decays on a missing session, resets to 1 after an
    observation) except that an observation EQUAL to the current value leaves it untouched, as
    pandas does ("avoid numerical errors on constant series"). A constant series with gaps
    therefore stays exactly constant.
    """
    n, m = arr.shape
    out = np.full(n, np.nan)
    old_wt = np.ones(n)
    for j in range(m):
        col = arr[:, j]
        ok = ~np.isnan(col)
        seed = ok & np.isnan(out)
        out[seed] = col[seed]
        old_wt[seed] = 1.0
        step = ~np.isnan(out) & ~seed
        old_wt[step] *= (1.0 - alpha)
        upd = step & ok
        calc = upd & (out != col)
        out[calc] = (old_wt[calc] * out[calc] + alpha * col[calc]) / (old_wt[calc] + alpha)
        old_wt[upd] = 1.0
    return out


def activate(ema_rule: bool = True) -> dict:
    """Overlay the pinned modules in this process; verify digests; install the live EMA rule."""
    if _ACTIVE["on"]:
        return status()
    early = sorted(k for k in sys.modules if k.startswith("api.services.breadth_")
                   and not k.startswith("api.services.breadth_v2_"))
    if early:
        raise RuntimeError("breadth modules already imported before the overlay: %s" % early)
    want = pins()["modules_md5_lf"]
    have = pinned_digests()
    bad = {m: (have.get(m), d) for m, d in want.items() if have.get(m) != d}
    if bad:
        raise RuntimeError("pinned module digest mismatch: %s" % bad)
    import api.services
    api.services.__path__.insert(0, PINNED_DIR)
    import importlib
    bl = importlib.import_module("api.services.breadth_live")
    # resolvable ONLY through the overlay just installed (it is not a master module)
    cp = importlib.import_module("api.services.breadth_corrected_pass")
    if not os.path.abspath(bl.__file__).startswith(PINNED_DIR) or not os.path.abspath(cp.__file__).startswith(PINNED_DIR):
        raise RuntimeError("overlay did not take: %s / %s" % (bl.__file__, cp.__file__))
    if cp.METHODOLOGY != BASE_METHODOLOGY:
        raise RuntimeError("pinned methodology %r" % cp.METHODOLOGY)
    if ema_rule:
        bl._ewm_last = ewm_last_tie_exact
    _ACTIVE.update(on=True, ema_rule=ema_rule)
    return status()


def status() -> dict:
    from api.services import breadth_live as bl
    return {"active": _ACTIVE["on"], "pinned_dir": PINNED_DIR,
            "methodology": LIVE_METHODOLOGY if _ACTIVE.get("ema_rule") else BASE_METHODOLOGY,
            "ema_rule": EMA_RULE if bl._ewm_last is ewm_last_tie_exact else "pinned",
            "modules_md5_lf": pinned_digests()}
