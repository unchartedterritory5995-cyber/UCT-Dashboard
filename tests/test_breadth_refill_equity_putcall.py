"""The equity put/call re-fill tool (owner 2026-11-19): equity replaces total, dry run writes nothing."""
import importlib.util
import json
import os
from unittest.mock import patch

_SPEC = importlib.util.spec_from_file_location(
    "refill_equity_putcall",
    os.path.join(os.path.dirname(__file__), "..", "tools", "breadth", "refill_equity_putcall.py"))
tool = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(tool)


class _R:
    def __init__(self, code, body=None):
        self.status_code, self._b = code, body or {}

    def json(self):
        return self._b


def _body(eq, total=0.99):
    return {"ratios": [{"name": "TOTAL PUT/CALL RATIO", "value": str(total)},
                       {"name": "EQUITY PUT/CALL RATIO", "value": str(eq)}]}


DAYS = {"2026-11-02": _R(200, _body(0.55)), "2026-11-03": _R(200, _body(0.61)),
        "2026-11-04": _R(403), "2026-11-05": _R(200, _body(0.70))}


def _get(calls):
    def get(url, **kw):
        calls.append(url)
        d = url.rsplit("/", 1)[1].split("_")[0]
        return DAYS[d]
    return get


def test_weekdays_skip_weekends():
    assert tool.weekdays("2026-11-06", "2026-11-09") == ["2026-11-06", "2026-11-09"]


def test_fetch_caches_raw_json_so_a_rerun_refetches_nothing(tmp_path):
    calls = []
    f = tool.Fetcher(str(tmp_path), get=_get(calls), sleep=0, today="2026-11-19")
    first = tool.collect(sorted(DAYS), f, progress=False)
    assert first["2026-11-02"] == (tool.OK, 0.55)          # EQUITY, not TOTAL
    assert first["2026-11-04"] == (tool.MISSING, None)
    n = len(calls)
    again = tool.collect(sorted(DAYS), tool.Fetcher(str(tmp_path), get=_get(calls), sleep=0,
                                                    today="2026-11-19"), progress=False)
    assert again == first and len(calls) == n
    assert json.load(open(tmp_path / "2026-11-02.json"))["ratios"][1]["value"] == "0.55"


def test_plan_overwrites_total_with_equity_and_clears_a_dateless_reading():
    results = {"2026-11-02": (tool.OK, 0.55), "2026-11-03": (tool.OK, 0.61),
               "2026-11-04": (tool.MISSING, None), "2025-06-02": (tool.OK, 0.66),
               "2026-11-05": (tool.FAILED, None)}
    stored = {"2026-11-02": 0.99, "2026-11-03": 0.61, "2026-11-04": 0.98, "2026-11-05": 0.97}
    p = tool.plan(results, stored)
    assert p["patch"] == {"2026-11-02": 0.55}
    assert p["unchanged"] == ["2026-11-03"]
    assert p["clear"] == ["2026-11-04"]                    # no CBOE file: the TOTAL value goes
    assert p["sentiment"] == {"2025-06-02": 0.66}          # no stored row: the deep-history store
    # before the endpoint's first file a missing date says nothing: the archive's value stays
    early = tool.plan({"2019-10-04": (tool.MISSING, None), "2019-10-07": (tool.OK, 0.6)},
                      {"2019-10-04": 0.7})
    assert early["clear"] == []
    # a network failure is never a reason to touch a stored value
    assert "2026-11-05" not in p["patch"] and "2026-11-05" not in p["clear"]


def test_dry_run_writes_nothing(tmp_path):
    calls = []
    with patch.object(tool, "stored_putcall", return_value={"2026-11-02": 0.99}), \
         patch.object(tool, "apply", side_effect=AssertionError("dry run wrote")), \
         patch.object(tool, "rewrite_csv", side_effect=AssertionError("dry run wrote")), \
         patch.object(tool, "Fetcher", lambda *a, **k: _FakeFetcher(calls)):
        assert tool.main(["--from", "2026-11-02", "--to", "2026-11-05", "--cache-dir", str(tmp_path),
                          "--csv"]) == 0


class _FakeFetcher:
    network_calls = 0

    def __init__(self, calls):
        self.calls = calls

    def status(self, d):
        r = DAYS[d]
        v = tool.pcb.ratio_from(r.json()) if r.status_code == 200 else None
        return (tool.OK, v) if v is not None else (tool.MISSING, None)


def test_rewrite_csv_replaces_only_putcall_rows_before_the_collector_floor(tmp_path):
    p = tmp_path / "seed.csv"
    p.write_text("date,key,value\n2019-10-04,cboe_putcall,0.5\n2019-10-07,aaii_bulls,30.0\n"
                 "2019-10-07,cboe_putcall,0.9\n", encoding="utf-8")
    out = tool.rewrite_csv({"2019-10-07": (tool.OK, 0.6), "2019-10-08": (tool.OK, 0.62),
                            "2026-01-05": (tool.OK, 0.7)}, str(p))
    rows = p.read_text(encoding="utf-8").split()
    assert rows == ["date,key,value", "2019-10-04,cboe_putcall,0.5", "2019-10-07,aaii_bulls,30.0",
                    "2019-10-07,cboe_putcall,0.6", "2019-10-08,cboe_putcall,0.62"]
    assert out["csv_putcall_replaced"] == 1 and out["csv_putcall_added"] == 1


def test_tune_band_maps_percentiles_of_total_onto_equity():
    # equity = total - 0.2 everywhere: the same percentiles land 0.2 lower
    pairs = {f"d{i:03d}": (0.5 + i / 100, 0.3 + i / 100) for i in range(60)}
    t = tool.tune_band(pairs, total_band=(0.65, 0.85))
    assert t["band"] == (0.45, 0.65) and t["sessions"] == 60
