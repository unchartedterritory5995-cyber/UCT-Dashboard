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
from types import SimpleNamespace as NS

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


class _FakeBatches:
    def __init__(self, ends=True):
        self.ends, self.created = ends, []

    def create(self, requests):
        self.created.append(list(requests))
        return NS(id=f"batch_{len(self.created)}")

    def retrieve(self, batch_id):
        return NS(processing_status="ended" if self.ends else "in_progress")

    def results(self, batch_id):
        usage = NS(input_tokens=1000, output_tokens=100, cache_read_input_tokens=0, cache_creation_input_tokens=0,
                   cache_creation=None)
        for req in self.created[int(batch_id.split("_")[1]) - 1]:
            message = NS(content=[NS(type="text", text='{"segment_id": "x", "records": []}')], stop_reason="end_turn",
                         usage=usage)
            yield NS(custom_id=req["custom_id"], result=NS(type="succeeded", message=message))


def _params():
    return {"model": "claude-opus-5", "max_tokens": 1000, "system": [{"type": "text", "text": "s"}],
            "messages": [{"role": "user", "content": "x"}], "output_config": {}}


def test_batches_are_sized_to_what_the_cap_can_still_reserve(tmp_path):
    gate = _load("extract_golden_gate")
    worst = gate.worst_case_usd(_params(), "claude-opus-5", batch=True)
    cap = gate.SpendCap(tmp_path / "ledger.json", worst * 2.5)
    fake = NS(messages=NS(batches=_FakeBatches()))
    got = gate.run_batch_round(fake, [(i, _params()) for i in range(5)], model="claude-opus-5", spend=cap,
                               phase="gate", poll_s=0, timeout_s=5, log=lambda *_: None)
    sizes = [len(c) for c in fake.messages.batches.created]
    assert max(sizes) == 2 and sum(sizes) == 5 and all("output" in r for r in got.values())
    assert cap.spent <= cap.max_usd and cap.reserved == pytest.approx(0.0)
    # control: a cap below one worst case sends nothing at all
    none = NS(messages=NS(batches=_FakeBatches()))
    tight = gate.SpendCap(tmp_path / "tight.json", worst * 0.9)
    skipped = gate.run_batch_round(none, [(0, _params())], model="claude-opus-5", spend=tight, phase="gate",
                                   poll_s=0, timeout_s=5, log=lambda *_: None)
    assert none.messages.batches.created == [] and skipped == {0: {"skipped": "spend cap"}}


def test_a_batch_that_is_never_collected_is_charged_its_full_reservation(tmp_path):
    gate = _load("extract_golden_gate")
    worst = gate.worst_case_usd(_params(), "claude-opus-5", batch=True)
    cap = gate.SpendCap(tmp_path / "ledger.json", 10.0)
    stuck = NS(messages=NS(batches=_FakeBatches(ends=False)))
    got = gate.run_batch_round(stuck, [(0, _params()), (1, _params())], model="claude-opus-5", spend=cap,
                               phase="gate", poll_s=0, timeout_s=0, log=lambda *_: None)
    assert cap.spent == pytest.approx(2 * worst) and all(r.get("transport_error") for r in got.values())
    # control: a batch that ends is charged what its usage says it cost
    done = gate.SpendCap(tmp_path / "done.json", 10.0)
    gate.run_batch_round(NS(messages=NS(batches=_FakeBatches())), [(0, _params())], model="claude-opus-5",
                         spend=done, phase="gate", poll_s=0, timeout_s=5, log=lambda *_: None)
    assert done.spent == pytest.approx((1000 * 5 + 100 * 25) / 1e6 * 0.5)


def test_tools_refuse_paths_inside_the_shared_data_root(tmp_path):
    common = _load("extract_common")
    assert common._inside_shared_root("C:\\data\\wisdom.db") and common._inside_shared_root("/data/x/y.db")
    assert not common._inside_shared_root(str(tmp_path / "wisdom.db"))
    assert not common._inside_shared_root("C:\\database\\x.db")  # control: a name prefix is not a parent
    with pytest.raises(SystemExit):
        common.out_path("C:\\data\\wisdom\\report.json")
    assert common.out_path(str(tmp_path / "sub" / "report.json")).parent.is_dir()
