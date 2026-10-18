"""The drawn levels are the drawn-vs-team study's config C2 (`flat_nearest_pd`, 2026-10-18).

Rails:
  * PARITY: drawn_set's horizontals equal the lab's own C2 levels (lab/drawn_vs_team/analyze.py
    levels_config(ch, 'flat_nearest_pd')) on a vendored fixture of daily bars, case by case, in order.
    The fixture was generated ONCE from the lab code; it carries bars (ticker, date, OHLCV) and the
    expected levels only -- no image paths, no record ids.
  * the fixture can tell C2 from the round-5 drawer it replaced (the stored `incumbent` levels);
  * the RESTORE: after the close the prior-day pair is the last bar's own high / low, drawn when it
    is among the nearest structural levels, and nothing is omitted;
  * the ORDER: nearer structural levels outrank a far major swing high (no major-swing priority).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import auto_draw

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "auto_draw_c2_parity.json"


@pytest.fixture(scope="module")
def parity():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _levels(case):
    out = auto_draw.drawn_set(auto_draw.clean_bars([tuple(r) for r in case["bars"]]), last_bar_forming=False)
    return [{"source": h["source"], "price": h["price"]} for h in out["horizontals"]], out


def test_fixture_is_bars_and_levels_only(parity):
    s = parity["source"]
    assert "flat_nearest_pd" in s["study"]
    assert (s["count"], s["dup_atr"], s["micro_bars"], s["major_max_dist_atr"]) == (
        auto_draw.DRAWN_HORIZONTALS, auto_draw.H_DUP_ATR, auto_draw.MICRO_BARS, auto_draw.MAJOR_MAX_DIST_ATR)
    cases = parity["cases"]
    assert len(cases) >= 20
    for c in cases:
        assert set(c) == {"name", "bars", "expect", "incumbent"}, c["name"]
        assert all(len(r) == 6 for r in c["bars"]) and len(c["bars"]) >= 300, c["name"]
        assert all(set(h) == {"source", "price"} for h in c["expect"] + c["incumbent"]), c["name"]


def test_drawn_levels_reproduce_the_lab_c2_levels(parity):
    bad = []
    for c in parity["cases"]:
        got, _ = _levels(c)
        if got != c["expect"]:
            bad.append((c["name"], got, c["expect"]))
    assert bad == []


def test_the_fixture_tells_c2_from_the_round5_drawer(parity):
    # control: a drawer that still omitted the prior day or kept the major-swing priority would not
    # pass the parity rail above -- most cases differ, and they differ on both counts
    cases = parity["cases"]
    differ = [c for c in cases if c["expect"] != c["incumbent"]]
    assert len(differ) >= len(cases) // 2
    assert sum(any(h["source"].startswith("prior_day") for h in c["expect"]) for c in cases) >= 10
    assert not any(h["source"].startswith("prior_day") for c in cases for h in c["incumbent"])
    # some C2 sets drop a major swing level the incumbent's priority tier forced in
    major = {"major_swing_high", "major_swing_low", "major_peak_high"}
    assert any({h["source"] for h in c["incumbent"]} & major - {h["source"] for h in c["expect"]}
               for c in cases)


def test_after_the_close_nothing_is_omitted_and_the_prior_day_is_the_last_bar(parity):
    seen = 0
    for c in parity["cases"]:
        _, out = _levels(c)
        assert out["omitted"] == [] and out["last_bar_forming"] is False
        last = auto_draw.clean_bars([tuple(r) for r in c["bars"]])[-1]
        for h in out["horizontals"]:
            if h["source"] in ("prior_day_high", "prior_day_low"):
                col, label = (2, "PDH") if h["source"] == "prior_day_high" else (3, "PDL")
                assert (h["price"], h["t_from"], h["label"]) == (round(last[col], 4), last[0], label), c["name"]
                seen += 1
    assert seen >= 10, "control: the prior-day pair never reached a fixture chart"


def _wave():
    """A long climb to a peak at bar 80, a fall, then a 160-bar sine-wave range (100 +- 4) whose
    repeated 104.4 crest is a MAJOR swing high overhead. The incumbent round-5 drawer forced that
    major high into the four (priority tier 0); C2 ranks it with the rest, and the last bar's own
    high / low (the prior day after the close) and the 10-day high sit nearer."""
    import datetime as dt
    import math
    rows, d = [], dt.date(2024, 1, 2)
    closes = [100.0 + 40.0 * k / 80 for k in range(80)] + [140.0]
    closes += [139.0 - 39.0 * k / 60 for k in range(1, 61)]
    closes += [100.0 + 4.0 * math.sin(2 * math.pi * k / 20) for k in range(160)]
    while len(rows) < len(closes):
        if d.weekday() < 5:
            k = len(rows)
            c = closes[k]
            h = 141.0 if k == 80 else c + 0.4
            rows.append((int(d.strftime("%Y%m%d")), round(c, 4), round(h, 4), round(c - 0.4, 4),
                         round(c, 4), 1e6))
        d += dt.timedelta(days=1)
    return rows


def test_near_structural_levels_outrank_a_far_major_swing_high(monkeypatch):
    rows = _wave()
    a = auto_draw.as_arrays(rows)
    i = len(a) - 1
    assert auto_draw.major_swings(a, i, True)[0]["price"] == 104.4               # the major high exists
    d = auto_draw.drawn_set(rows)
    got = [(h["source"], h["price"]) for h in d["horizontals"]]
    last = rows[-1]
    assert got == [("prior_day_high", last[2]), ("prior_day_low", last[3]),
                   ("ten_day_high", 100.4), ("major_swing_low", 95.6)], got
    assert "major_swing_high" not in [s for s, _ in got]                        # no priority tier
    # control: with room for every candidate the major high is still drawn (ranked, not deleted)
    monkeypatch.setattr(auto_draw, "DRAWN_HORIZONTALS", 40)
    wide = auto_draw.drawn_set(rows)["horizontals"]
    assert ("major_swing_high", 104.4) in [(h["source"], h["price"]) for h in wide]
