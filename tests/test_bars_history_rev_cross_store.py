"""D5: the cross-store history_rev monitor. Synthetic series_meta only; the pod is never contacted."""
import json
import types

from tools import bars_history_rev_cross_store as X


def _doc(rows, floor):
    return {"rows": rows, "store_meta": [["rev_floor_ms", float(floor)], ["proof_floor_s", floor / 1000]]}


def test_the_served_base_is_the_floor_when_the_series_is_older():
    bases, floor = X.served_bases(_doc([["SPY", "D", 5, 100], ["KO", "D", 9, 900]], 500))
    assert floor == 500 and bases == {("SPY", "D"): 500, ("KO", "D"): 900}


def test_compare_counts_equal_higher_and_floors():
    web = _doc([["SPY", "D", 1, 100], ["KO", "D", 1, 900], ["FDX", "D", 1, 0], ["ONLYW", "D", 1, 1]], 500)
    ba = _doc([["SPY", "D", 1, 100], ["KO", "D", 1, 700], ["FDX", "D", 1, 0], ["ONLYB", "D", 1, 1]], 400)
    r = X.compare(web, ba)
    # SPY: 500 vs 400 (floors), KO: 900 vs 700, FDX: 500 vs 400 -> 3 diverged, web higher on all
    assert r["series_compared"] == 3 and r["equal"] == 0 and r["diverged"] == 3
    assert r["web_higher"] == 3 and r["bars-api_higher"] == 0
    assert r["web_at_floor"] == 2 and r["bars-api_at_floor"] == 2
    assert r["only_web"] == 1 and r["only_bars-api"] == 1 and r["max_abs_gap_ms"] == 200


def test_identical_stores_read_as_zero_divergence():
    d = _doc([["SPY", "D", 1, 100], ["SPY", "W", 1, 800]], 500)
    r = X.compare(d, json.loads(json.dumps(d)))
    assert r["diverged"] == 0 and r["equal"] == 2


def test_the_probe_is_read_only_and_parses_back():
    src = X.probe_source(["spy", "KO"])
    assert "mode=ro" in src and "query_only=1" in src
    assert not any(w in src.upper() for w in ("INSERT", "UPDATE ", "DELETE", "DROP", "REPLACE", "ATTACH"))
    compile(src, "probe", "exec")                                      # it is valid Python as sent
    assert X.parse("noise\nJ" + json.dumps({"rows": [], "store_meta": []}) + "\n") == {"rows": [], "store_meta": []}
    assert X.parse("nothing here") is None


def test_main_reports_divergence_and_exit_2_when_a_service_is_unreadable(capsys):
    docs = {"web": _doc([["SPY", "D", 1, 100]], 500), "bars-api": _doc([["SPY", "D", 1, 100]], 400)}

    def runner(cmd, **kw):
        assert cmd[0].lower().endswith("railway.exe") and cmd[1:4] == ["ssh", "-s", cmd[3]]
        return types.SimpleNamespace(stdout="J" + json.dumps(docs[cmd[3]]))
    assert X.main(["--tickers", "SPY", "--json"], runner=runner) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["diverged"] == 1 and out["web_higher"] == 1

    def dead(cmd, **kw):
        return types.SimpleNamespace(stdout="" if cmd[3] == "bars-api" else "J" + json.dumps(docs["web"]))
    assert X.main(["--json"], runner=dead) == 2
    assert json.loads(capsys.readouterr().out)["unreadable"] == ["bars-api"]
