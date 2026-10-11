"""Splits in the NH/NL and 20/150-SMA rings (2026-10-11).

A split after a ring column was written left that column on the old basis for up to a year:
a reverse split read as a new 52-week high and could then almost never print a new low. Each
session's splits now restate the ticker's stored window before the session is measured, and
a rebuild builds beside the served files. No network.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pytest

from api.services import breadth_nhnl_intraday as nhi
from api.services import massive


def _ring_with(ticker: str, closes: list) -> nhi.Ring:
    r = nhi.Ring()
    for k, c in enumerate(closes):
        rows = r.rows_for([ticker])
        r.write(f"2026-01-{k + 1:02d}", rows, np.asarray([c * 1.01], np.float32),
                np.asarray([c * 0.99], np.float32), np.asarray([c], np.float32))
    return r


def test_splits_between_turns_rows_into_price_factors():
    rows = [{"ticker": "ABC", "execution_date": "2026-10-09", "split_from": 10, "split_to": 1},
            {"ticker": "XYZ", "execution_date": "2026-10-09", "split_from": 1, "split_to": 4},
            {"ticker": "BAD", "execution_date": "2026-10-09", "split_from": 0, "split_to": 1},
            {"ticker": "NOOP", "execution_date": "2026-10-09", "split_from": 1, "split_to": 1}]
    out = nhi.splits_between("2026-10-09", "2026-10-09", fetch=lambda a, b: rows)
    assert out == {"2026-10-09": [("ABC", 10.0), ("XYZ", 0.25)]}


def test_a_reverse_split_restates_the_window_and_is_not_a_new_high():
    r = _ring_with("ABC", [1.0, 1.1, 0.9, 1.0])            # a $1 stock
    applied = set()
    frame = {"ABC": {"h": 10.2, "l": 9.8, "c": 10.0, "v": 1e6}}    # 1-for-10: now $10
    done = nhi.apply_splits(r, "2026-01-05", frame, [("ABC", 10.0)], applied)
    assert done == ["ABC"]
    mx, mn, _ = r.prior(r.rows_for(["ABC"]), 252)
    assert mx[0] == pytest.approx(11.11, rel=1e-3)          # 1.1 * 1.01 * 10 — not a new high
    assert mn[0] == pytest.approx(8.91, rel=1e-3)
    # idempotent: the same split is never applied twice
    assert nhi.apply_splits(r, "2026-01-05", frame, [("ABC", 10.0)], applied) == []


def test_a_window_already_on_the_new_basis_is_left_alone():
    r = _ring_with("ABC", [10.0, 11.0, 9.0, 10.0])          # fetched after the split
    frame = {"ABC": {"h": 10.2, "l": 9.8, "c": 10.1, "v": 1e6}}
    assert nhi.apply_splits(r, "2026-01-05", frame, [("ABC", 10.0)], set()) == []
    assert r.last_close(r.index["ABC"]) == pytest.approx(10.0)


def test_live_counts_restate_a_split_effective_today(monkeypatch):
    r = _ring_with("ABC", [1.0] * 30)
    monkeypatch.setattr(nhi, "active", lambda: True)
    monkeypatch.setattr(nhi, "values", lambda u, d: None)
    monkeypatch.setattr(nhi, "_ring_for_live", lambda: r)
    r.dates[-1] = "2026-10-08"
    monkeypatch.setattr(nhi, "todays_splits", lambda d: {"ABC": 10.0})
    out = nhi.live_counts("nasdaq", {"ABC": 10.05}, {"ABC": 9.95}, ["ABC"], "2026-10-09")
    assert out is not None and out["new_52w_highs"] == 0 and out["new_52w_lows"] == 0
    monkeypatch.setattr(nhi, "todays_splits", lambda d: {})
    out = nhi.live_counts("nasdaq", {"ABC": 10.05}, {"ABC": 9.95}, ["ABC"], "2026-10-09")
    assert out["new_52w_highs"] == 1                         # the old, wrong answer


def _sweep_env(tmp_path, monkeypatch, frames, settled="2026-10-09"):
    monkeypatch.setattr(nhi, "STATE_PATH", str(tmp_path / "state.npz"))
    monkeypatch.setattr(nhi, "SERIES_PATH", str(tmp_path / "series.json"))
    monkeypatch.setattr(nhi, "PACE_SECONDS", 0)
    monkeypatch.setattr(nhi, "_settled_through", lambda: settled)
    monkeypatch.setattr(nhi, "_sessions_after",
                        lambda last, through: [d for d in sorted(frames) if (last or "") < d <= through])
    monkeypatch.setattr(nhi, "report_block", lambda *a: None)
    uploads = []
    real_write = nhi._write_series
    monkeypatch.setattr(nhi, "_write_series",
                        lambda s, upload=False, path=None: uploads.append(path) or real_write(s, False, path))
    from api.services import breadth_pit_frame as bpf
    monkeypatch.setattr(bpf, "reference_map", lambda: {})
    monkeypatch.setattr(nhi, "splits_between", lambda a, b: {})
    asked = []
    monkeypatch.setattr(massive, "get_grouped_daily_frame",
                        lambda d, adjusted=True, store=False, fresh=False:
                        asked.append((d, fresh)) or {"rows": frames[d]})
    return asked


def test_a_rebuild_builds_beside_the_served_files_and_swaps_when_caught_up(tmp_path, monkeypatch):
    frames = {f"2026-10-0{i}": {"AAA": {"h": 10, "l": 9, "c": 9.5, "v": 100}} for i in range(5, 10)}
    asked = _sweep_env(tmp_path, monkeypatch, frames)
    (tmp_path / "series.json").write_text(json.dumps({"rows": {"us": {"2001-01-02": [1]}}}))
    out = nhi.sweep(rebuild=True, max_sessions=2)            # interrupted part-way
    assert out["rebuild"] == "in progress"
    assert json.loads((tmp_path / "series.json").read_text())["rows"]["us"] == {"2001-01-02": [1]}
    assert os.path.exists(str(tmp_path / "state.npz") + ".rebuild")
    out = nhi.sweep(rebuild=True)                            # resumes, catches up, swaps
    assert out["rebuild"] == "swapped in", out
    assert not os.path.exists(str(tmp_path / "state.npz") + ".rebuild")
    served = json.loads((tmp_path / "series.json").read_text())
    assert served["through"] == "2026-10-09" and "2001-01-02" not in json.dumps(served["rows"])
    assert asked and all(f for _d, f in asked)               # a rebuild reads FRESH frames


def test_a_splits_outage_stops_the_sweep(tmp_path, monkeypatch):
    frames = {"2026-10-09": {"AAA": {"h": 10, "l": 9, "c": 9.5, "v": 100}}}
    _sweep_env(tmp_path, monkeypatch, frames)
    monkeypatch.setattr(nhi, "splits_between",
                        lambda a, b: (_ for _ in ()).throw(RuntimeError("503")))
    out = nhi.sweep()
    assert out["sessions"] == 0 and "splits unavailable" in out["failed"][0][1]


def test_scheduled_extend_resumes_an_interrupted_rebuild(tmp_path, monkeypatch):
    monkeypatch.setattr(nhi, "STATE_PATH", str(tmp_path / "state.npz"))
    monkeypatch.setattr(nhi, "basis", lambda: "intraday")
    monkeypatch.setattr(nhi, "_restore_from_r2", lambda: True)
    (tmp_path / "state.npz.rebuild").write_bytes(b"x")
    calls = []
    monkeypatch.setattr(nhi, "start_sweep", lambda rebuild=False, max_sessions=None: calls.append(rebuild))
    nhi.scheduled_extend()
    assert calls == [True]


def test_todays_splits_retries_a_failed_read_only_every_30_minutes(monkeypatch):
    nhi._LIVE_SPLITS.clear()
    calls = []

    def boom(a, b, fetch=None):
        calls.append(1)
        raise RuntimeError("503")
    monkeypatch.setattr(nhi, "splits_between", boom)
    assert nhi.todays_splits("2026-10-09") == {} and nhi.todays_splits("2026-10-09") == {}
    assert len(calls) == 1
