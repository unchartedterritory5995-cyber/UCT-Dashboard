"""Levels v2 (2026-10-18): the chart's drawn levels picked by reading the chart (api/services/levels_v2.py).

Rails:
  * PARITY: drawn_levels reproduces the lab drawer (lab/levels_v2/drawer_v2.draw_levels) on a vendored fixture of
    daily bars, case by case, in order. The fixture was generated ONCE from the lab code (lab/levels_v2/
    make_fixture.py) and carries bars and the expected levels only -- no tickers, no image paths, no record ids.
  * the fixture can tell v2 from the C2 drawer it replaces under the stamp;
  * NO LOOKAHEAD: wild bars after the as-of bar change nothing, and a forming last bar is dropped;
  * the verbatim blocks still hash as the module says they do.
Members are served levels v3 (api/services/levels_v3.py, tests/test_levels_v3.py), which reads THIS module's frozen
ranker; the tier-stamp and fallback rails live there.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
from pathlib import Path

import numpy as np
import pytest

from api.services import auto_draw, levels_v2

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "levels_v2_parity.json"
SRC = Path(levels_v2.__file__).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def parity():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _got(bars, forming=False):
    out = levels_v2.drawn_levels([tuple(r) for r in bars], last_bar_forming=forming)
    return [{"price": h["price"], "t_from": h["t_from"], "label": h["label"]} for h in out["horizontals"]]


def test_fixture_is_bars_and_levels_only(parity):
    s = parity["source"]
    assert "levels_v2" in s["study"]
    m = levels_v2.MODEL
    assert (s["k"], s["alpha"], s["sep_atr"]) == (m["k"], m["alpha"], m["sep_atr"])
    cases = parity["cases"]
    assert len(cases) >= 20
    for c in cases:
        assert set(c) == {"name", "bars", "expect"}, c["name"]
        assert re.fullmatch(r"(case|synthetic)_\d+", c["name"]), c["name"]
        assert all(len(r) == 6 for r in c["bars"]) and len(c["bars"]) >= 200, c["name"]
        assert all(set(h) == {"price", "t_from", "label"} for h in c["expect"]), c["name"]


def test_drawn_levels_reproduce_the_lab_drawer(parity):
    bad = [(c["name"], _got(c["bars"]), c["expect"]) for c in parity["cases"] if _got(c["bars"]) != c["expect"]]
    assert bad == []


def test_the_fixture_tells_v2_from_the_c2_drawer(parity):
    # control: a port that silently returned the C2 levels could not pass the parity rail above
    differ = 0
    for c in parity["cases"]:
        c2 = auto_draw.drawn_set(auto_draw.clean_bars([tuple(r) for r in c["bars"]]))
        if [h["price"] for h in c2["horizontals"]] != [h["price"] for h in c["expect"]]:
            differ += 1
    assert differ >= len(parity["cases"]) // 2


def test_count_and_one_above_the_close(parity):
    for c in parity["cases"]:
        got = levels_v2.drawn_levels([tuple(r) for r in c["bars"]])
        hs = got["horizontals"]
        assert 1 <= len(hs) <= levels_v2.MODEL["k"] == 3, c["name"]
        assert got["round"] == levels_v2.LEVELS_V2_ROUND
        close = c["bars"][-1][4]
        assert any(h["price"] > close for h in hs) or not any(
            r[2] > close for r in c["bars"][-120:]), c["name"]
        assert [abs(h["price"] - close) for h in hs] == sorted(abs(h["price"] - close) for h in hs)


def test_no_lookahead_future_bars_change_nothing(parity):
    rng = random.Random(7)
    for c in parity["cases"][:10]:
        rows = [tuple(r) for r in c["bars"]]
        a = np.array([[float(x) for x in r] for r in rows])
        i = len(a) - 1
        base = levels_v2.draw_levels(a, i)
        fut, last = [], a[-1].copy()
        for k in range(40):   # wild future bars: new highs, lows, gaps and volume far outside the history
            p = float(last[4]) * rng.choice([0.5, 0.8, 1.3, 2.0])
            fut.append([last[0] + k + 1, p, p * 1.2, p * 0.7, p * rng.choice([0.9, 1.1]), 1e9])
        a2 = np.vstack([a, np.array(fut)])
        assert levels_v2.draw_levels(a2, i) == base, c["name"]


def test_a_forming_last_bar_is_dropped(parity):
    for c in parity["cases"][:6]:
        last = c["bars"][-1]
        forming = [last[0] + 1, last[4], last[4] * 1.4, last[4] * 0.6, last[4] * 1.3, 5e9]
        assert _got(c["bars"] + [forming], forming=True) == c["expect"], c["name"]


def test_too_few_bars_draw_nothing():
    rows = [(20240101 + k, 10.0, 10.5, 9.5, 10.0, 1000) for k in range(20)]
    assert levels_v2.drawn_levels(rows) is None
    assert levels_v2.drawn_levels([]) is None


def _block(name):
    b = SRC.index("# ---- BEGIN VERBATIM %s\n" % name)
    b = SRC.index("\n", b) + 1
    e = SRC.index("# ---- END VERBATIM %s" % name)
    return SRC[b:e]


def test_the_verbatim_blocks_hash_as_declared():
    assert hashlib.sha256(_block("lab/levels_v2/lv2core.py").encode("utf-8")).hexdigest() == \
        levels_v2.CORE_BLOCK_SHA256
    assert hashlib.sha256(_block("lab/levels_v2/drawer_v2.py").encode("utf-8")).hexdigest() == \
        levels_v2.DRAWER_BLOCK_SHA256
