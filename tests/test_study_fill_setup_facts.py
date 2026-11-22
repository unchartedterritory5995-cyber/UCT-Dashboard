"""scripts/study/fill_setup_facts.py: the setup examples' facts completed from
their own bars (2026-11-04), after three LIVE Gap Support lessons printed
"None%" for facts the first scan had not stored.

The facts measure the test against the GAP-UP DAY'S LOW (owner rulings
2026-10-26/27) and the sessions until a close back above it; they never grade
the test (the finder's one-day held / breached / failed rule called charts the
owner graded great "failed"). A stored fact that disagrees with the bars stops
the run. Run alone: python -m pytest tests/test_study_fill_setup_facts.py -q
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from scripts.study import fill_setup_facts as ff


def _bar(t, o, h, l, c, v=1_000_000):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def _gap_window():
    """A flat tape, a gap day (open 104 over a 100 close, low 103 over the
    prior high 101), a run to 110, then the test day as the last bar."""
    bars = [_bar(20240100 + d, 100, 101, 99, 100) for d in range(1, 10)]
    bars.append(_bar(20240110, 104, 106, 103, 105))            # the gap day
    bars += [_bar(20240110 + d, 106, 110, 105, 108) for d in range(1, 5)]
    return bars


def test_gap_support_facts_measure_the_test_against_the_gap_up_low():
    bars = _gap_window()
    bars.append(_bar(20240115, 104, 105, 101.5, 102.5))        # undercut the 103 low, close under it
    forward = [_bar(20240116, 102, 104, 101, 102.8), _bar(20240117, 103, 106, 102.5, 105)]
    f = ff.gap_support_facts(bars, forward, {"bars_since_gap": 5})
    assert f["gap_asof"] == "2024-01-10" and f["gap_pct"] == 4.0 and f["true_gap"] is True
    assert f["gap_top"] == 101 and f["gap_low"] == 103
    assert f["test_low_vs_gap_low_pct"] == round((101.5 / 103 - 1) * 100, 1)
    assert f["close_vs_gap_low_pct"] == round((102.5 / 103 - 1) * 100, 1)
    assert f["close_vs_gap_top_pct"] == round((102.5 / 101 - 1) * 100, 1)
    assert f["reclaim_sessions"] == 2 and f["reclaimed_in_forward"] is True
    assert f["post_gap_run_pct"] == round((110 / 105 - 1) * 100, 1)
    assert "test_kind" not in f and "failed" not in json.dumps(f)


def test_a_close_back_above_the_low_on_the_day_is_reclaim_zero_and_a_miss_is_recorded():
    bars = _gap_window()
    bars.append(_bar(20240115, 104, 106, 102.8, 104.5))        # dipped under 103, closed above it
    f = ff.gap_support_facts(bars, [], {"bars_since_gap": 5})
    assert f["reclaim_sessions"] == 0 and f["reclaimed_in_forward"] is True
    bars[-1] = _bar(20240115, 104, 105, 101.5, 102.0)
    f = ff.gap_support_facts(bars, [_bar(20240116, 102, 102.5, 100, 101)] * 20, {"bars_since_gap": 5})
    assert "reclaim_sessions" not in f and f["reclaimed_in_forward"] is False


def test_go_signal_facts_read_the_open_against_the_prior_close():
    bars = [_bar(20240101, 100, 101, 99, 100), _bar(20240102, 99.5, 102, 98.5, 101.8)]
    f = ff.go_signal_facts(bars, [], {"red_to_green": True})
    assert f == {"open_vs_prior_close_pct": -0.5, "low_vs_prior_low_pct": round((98.5 / 99 - 1) * 100, 2),
                 "day_pct": 1.8, "dcr": round((101.8 - 98.5) / (102 - 98.5), 3)}
    with pytest.raises(ValueError, match="red_to_green"):
        ff.go_signal_facts([bars[0], _bar(20240102, 100.5, 102, 98.5, 101.8)], [], {"red_to_green": True})


def test_merge_keeps_a_stored_fact_that_agrees_and_stops_on_one_that_does_not():
    stored = {"gap_pct": 4.0, "dcr": 0.5, "first_test": True}
    facts, added, bad = ff.merge(stored, {"gap_pct": 4.01, "dcr": 0.503, "gap_low": 103.0, "true_gap": True})
    assert not bad and added == ["gap_low", "true_gap"] and facts["gap_pct"] == 4.0 and facts["gap_low"] == 103.0
    _, _, bad = ff.merge(stored, {"gap_pct": 4.6})
    assert bad == ["gap_pct: stored 4.0, bars say 4.6"]
    _, _, bad = ff.merge({"true_gap": True}, {"true_gap": False})
    assert bad and bad[0].startswith("true_gap")


def test_fill_writes_only_the_missing_facts_and_is_idempotent(tmp_path):
    db = sqlite3.connect(tmp_path / "bars.db")
    db.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v INTEGER)")
    bars = _gap_window() + [_bar(20240115, 104, 105, 101.5, 102.5)]
    pad = [_bar(20230000 + d, 100, 101, 99, 100) for d in range(101, 101 + ff.WINDOW)]
    fwd = [_bar(20240200 + d, 103, 106, 102.5, 105) for d in range(1, ff.FORWARD + 1)]
    db.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                   [("XYZ", "D", b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in pad + bars + fwd])
    db.commit()
    data = {"examples": [
        {"setup": "Gap Support", "sym": "XYZ", "asof": "2024-01-15", "facts": {"gap_pct": 4.0, "bars_since_gap": 5}},
        {"setup": "Launchpad", "sym": "XYZ", "asof": "2024-01-15", "facts": {"day_pct": 1.0}},
    ]}
    report = ff.fill(data, db)
    assert [r["sym"] for r in report] == ["XYZ"] and "gap_low" in report[0]["added"]
    gap = data["examples"][0]["facts"]
    assert gap["gap_pct"] == 4.0 and gap["gap_low"] == 103 and gap["reclaim_sessions"] == 1
    assert data["examples"][1]["facts"] == {"day_pct": 1.0}
    assert ff.fill(data, db) == []
    with pytest.raises(ValueError, match="disagree"):
        data["examples"][0]["facts"]["gap_pct"] = 9.9
        ff.fill(data, db)
