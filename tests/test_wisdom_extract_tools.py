"""Extract tool rails (stream S-D). No network, no api.main.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a live gate run that can spend past its TOTAL cap — across runs, or by parallel
   calls reserving at the same time;
2. a tool that accepts a --db or output path inside the shared data root.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import threading

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools" / "wisdom"


def _load(name: str):
    if str(TOOLS) not in sys.path:
        sys.path.insert(0, str(TOOLS))
    spec = importlib.util.spec_from_file_location(f"wisdom_tool_{name}", TOOLS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_spend_cap_reserves_the_worst_case_and_persists_across_runs(tmp_path):
    gate = _load("extract_golden_gate")
    ledger = tmp_path / "ledger.json"
    cap = gate.SpendCap(ledger, 1.0)
    assert cap.reserve(0.6)
    assert not cap.reserve(0.5)  # 0.6 reserved + 0.5 would cross 1.0
    cap.settle(0.6, 0.2, {"phase": "gate"})
    assert cap.reserve(0.5)  # 0.2 actual + 0.5 fits
    cap.settle(0.5, 0.5, {"phase": "gate"})
    again = gate.SpendCap(ledger, 1.0)  # a new run reads what the last one spent
    assert again.spent == pytest.approx(0.7)
    assert not again.reserve(0.31) and again.reserve(0.3)
    # control: the same reservation is admitted against a fresh ledger
    assert gate.SpendCap(tmp_path / "other.json", 1.0).reserve(0.31)


def test_parallel_reservations_never_cross_the_cap(tmp_path):
    gate = _load("extract_golden_gate")
    cap = gate.SpendCap(tmp_path / "ledger.json", 1.0)
    granted = []
    barrier = threading.Barrier(20)

    def worker():
        barrier.wait()
        if cap.reserve(0.3):
            granted.append(1)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(granted) == 3


def test_tools_refuse_paths_inside_the_shared_data_root(tmp_path):
    common = _load("extract_common")
    assert common._inside_shared_root("C:\\data\\wisdom.db") and common._inside_shared_root("/data/x/y.db")
    assert not common._inside_shared_root(str(tmp_path / "wisdom.db"))
    assert not common._inside_shared_root("C:\\database\\x.db")  # control: a name prefix is not a parent
    with pytest.raises(SystemExit):
        common.out_path("C:\\data\\wisdom\\report.json")
    assert common.out_path(str(tmp_path / "sub" / "report.json")).parent.is_dir()
