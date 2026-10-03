"""Exchange Breadth V1 engine patch: `unchanged` is emitted and the issue counts reconcile.

The exchange module set (tools/breadth_exch/pinned) = the accepted V2c2 pins + ONE patch. Run in a
subprocess so the overlay never leaks into this interpreter's api.services.
"""
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCH = os.path.join(ROOT, "tools", "breadth_exch", "pinned")
V2 = os.path.join(ROOT, "tools", "breadth_v2", "pinned")

_PROBE = r"""
import json, sys, numpy as np
sys.path.insert(0, ROOT)
import api.services
api.services.__path__.insert(0, PIN)
from api.services import breadth_live as bl, breadth_metrics as bm
tick = ["UP", "DN", "FLAT", "NOPREV", "ZEROPREV", "NOTPRICED"]
n_dates = 260
closes = np.full((len(tick), n_dates), 10.0)
closes[3, :] = np.nan                  # never traded before today
closes[4, -1] = 0.0                    # a zero prior close (bad data)
levels = bl.build_levels(tick, closes, np.full_like(closes, 1e6), 0)
prices = {"UP": 10.5, "DN": 9.5, "FLAT": 10.0, "NOPREV": 7.0, "ZEROPREV": 3.0}
m = bl.compute_metrics(levels, prices)
print(json.dumps({k: m.get(k) for k in ("universe_count", "advancing", "declining", "unchanged",
                                        "_directional", "adv_decline")}
                 | {"applies_us": bm.applies_to("unchanged", "us"),
                    "applies_nyse": bm.applies_to("unchanged", "nyse")}))
"""


def _run(pin):
    code = "ROOT=%r\nPIN=%r\n" % (ROOT, pin) + _PROBE
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=ROOT)
    assert out.returncode == 0, out.stderr[-2000:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_unchanged_is_emitted_and_counts_reconcile():
    m = _run(EXCH)
    assert (m["advancing"], m["declining"], m["unchanged"]) == (1, 1, 1)
    assert m["advancing"] + m["declining"] + m["unchanged"] == m["_directional"]
    # priced members not in the directional base are exactly the no-usable-prior-close names
    assert m["universe_count"] - m["_directional"] == 2          # NOPREV, ZEROPREV
    assert m["adv_decline"] == m["advancing"] - m["declining"]
    assert m["applies_us"] and m["applies_nyse"]


def test_the_patch_changes_nothing_else():
    a, b = _run(V2), _run(EXCH)
    assert a["unchanged"] is None and b["unchanged"] == 1
    for k in ("universe_count", "advancing", "declining", "adv_decline"):
        assert a[k] == b[k]


def _md5(p):
    return hashlib.md5(open(p, "rb").read().replace(b"\r\n", b"\n")).hexdigest()


def test_only_two_modules_differ_from_the_accepted_pins():
    pins = json.load(open(os.path.join(V2, "breadth_v2c2_pins.json")))["modules_md5_lf"]
    differ = sorted(f for f in pins if _md5(os.path.join(EXCH, f)) != pins[f])
    assert differ == ["breadth_live.py", "breadth_metrics.py"]
    assert all(_md5(os.path.join(V2, f)) == d for f, d in pins.items())   # production pins untouched
