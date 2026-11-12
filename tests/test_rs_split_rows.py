"""RS split unit U4 (engineering map projects/rs-split-handoff-2026-11-09/
engineering-map.md §(a) U4, §(e) step 1): the three server rows behind
`RS_SPLIT_ENABLED`, their providers, and the row ↔ provider contract.

THE CONTROL: the rsLine row is byte-identical with the flag off AND on (the
subprocess tests import `registry_defs` fresh under each state, the
`test_registry_string_inputs.py` pattern), and the flag off leaves the lane's
four rows exactly as they were.

⭐ THE CONTRACT FOR UNIT U6 (the JS definitions): `RS_SPLIT_CONTRACT` below
lists, per definition, every wire column and every payload `scalar:` path the
JS side may read. A path listed here is proved present in a real envelope; a
path the JS names that is not here is the drift this file exists to catch.
"""
from __future__ import annotations

import json
import os
import pathlib
import sqlite3
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import signature as sig
from api.services import relative_strength as rsm
from api.services import rs_benchmarks as rb
from api.services.screener import rs_history
from api.services.signature import registry_defs as rd
from api.services.signature import rs_provider as rsp
from tests.test_rs_columns_provider import (  # noqa: F401 - fixtures are used by name
    _fetcher, _hermetic_reads, _long_daily, _no_cache,
)
from tests.test_signature_router import client, _paid_user  # noqa: F401

REPO = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = REPO / "tests" / "fixtures" / "rs_line_rows_pre_phase3.json"
LEDGER = REPO / "docs" / "feature_flags.json"

SPLIT_IDS = ("rsRating", "rsPhases", "rsVsEma", "rsExit")

#: ⭐ THE CONTRACT FOR U6: per id, the wire columns and the payload paths.
RS_SPLIT_CONTRACT = {
    "rsRating": {
        "columns": ["ratingLine", "ratingMa"],
        "inputs": [],
        "paths": ["rating.ibd", "rating.m1", "rating.m3", "rating.m6", "rating.m9", "rating.m12",
                  "rating.asof", "rating.summary", "rating.components", "rating.source",
                  "ratingHistory.summary", "ratingHistory.reason", "ratingHistory.value",
                  "ratingHistory.average", "ratingHistory.change20", "ratingHistory.sessions",
                  "ratingHistory.asof", "ratingHistory.stale",
                  "history.bars", "history.short", "inputs", "intraday", "state"],
    },
    "rsPhases": {
        "columns": ["phase", "divergence"],
        "inputs": ["benchmark", "customBenchmark", "shortEma", "longEma"],
        "paths": ["benchmark.label", "benchmark.resolved", "benchmark.requested", "benchmark.fallback",
                  "benchmark.note", "benchmark.bars",
                  "legend.summary", "legend.phase", "legend.phaseLabel", "legend.divergence",
                  "legend.rsTrend", "legend.benchTrend", "legend.asOf", "legend.stale",
                  "history.bars", "history.short", "inputs.benchmark", "inputs.customBenchmark",
                  "inputs.shortEma", "inputs.longEma", "intraday", "state"],
    },
    "rsVsEma": {
        "columns": ["dist", "fast", "slow"],
        "inputs": ["benchmark", "customBenchmark"],
        "paths": ["benchmark.label", "benchmark.resolved", "benchmark.requested", "benchmark.fallback",
                  "benchmark.note", "benchmark.bars",
                  "legend.summary", "legend.pctFromMa", "legend.above", "legend.maSlope", "legend.index",
                  "legend.lastValue", "legend.asOf", "legend.stale", "legend.fast", "legend.slow",
                  "history.bars", "history.short", "inputs.benchmark", "inputs.customBenchmark",
                  "inputs.maLength", "inputs.maType", "intraday", "state"],
    },
    # 2026-11-12: UCT RS Exit Warnings (Webster's Quick Break / Quicksand / Grateful Dead Break).
    "rsExit": {
        "columns": ["rsLine", "fast", "slow", "dotQuick", "dotQuicksand", "dotDead"],
        "inputs": ["benchmark", "customBenchmark", "fastLength", "slowLength"],
        "paths": ["benchmark.label", "benchmark.resolved", "benchmark.requested", "benchmark.fallback",
                  "benchmark.note", "benchmark.bars",
                  "legend.summary", "legend.chipText", "legend.lastKind", "legend.lastLabel", "legend.barsAgo", "legend.lastAsOf",
                  "legend.status", "legend.statusLabel", "legend.rs", "legend.fast", "legend.slow",
                  "legend.fastLength", "legend.slowLength", "legend.asOf", "legend.stale",
                  "history.bars", "history.short", "inputs.benchmark", "inputs.customBenchmark",
                  "inputs.fastLength", "inputs.slowLength", "inputs.maType", "intraday", "state"],
    },
}


@pytest.fixture(autouse=True)
def _fresh_core():
    """The shared core memo is per process: every test starts without one."""
    rsp.rs_core_reset()
    yield
    rsp.rs_core_reset()


@pytest.fixture
def split_rows(monkeypatch):
    """The three rows installed and their providers plugged in, the way the
    flag does it, for one test (the import-time state is restored after)."""
    for row in rd.RS_SPLIT_DEFS:
        monkeypatch.setitem(rd._BY_ID, row["id"], row)
        monkeypatch.setitem(rd._PROVIDERS, row["id"], sig.RS_SPLIT_PROVIDERS[row["id"]])
    monkeypatch.setattr(rd, "SERVER_DEFS", tuple(rd.SERVER_DEFS) + tuple(rd.RS_SPLIT_DEFS))
    monkeypatch.setattr(rb, "_custom_warmed", {})
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    _no_cache(monkeypatch)
    return {row["id"]: row for row in rd.RS_SPLIT_DEFS}


def _serve_fresh(code: str, split: str | None, v2="1", v3="1") -> tuple[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in ("RS_V2_ENABLED", "RS_V3_ENABLED", "RS_SPLIT_ENABLED")}
    if v2 is not None:
        env["RS_V2_ENABLED"] = v2
    if v3 is not None:
        env["RS_V3_ENABLED"] = v3
    if split is not None:
        env["RS_SPLIT_ENABLED"] = split
    r = subprocess.run([sys.executable, "-c", code], cwd=str(REPO), env=env,
                       capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stderr
    return r.stdout, r.stderr


_IDS_AND_RSLINE = ("import json, sys\n"
                   "from api.services.signature import registry_defs as rd\n"
                   "sys.stdout.write(json.dumps({'ids': [d['id'] for d in rd.SERVER_DEFS], "
                   "'rsLine': rd.definition('rsLine')}))\n")


# ── the flag ──────────────────────────────────────────────────────────────────

def test_flag_off_serves_the_four_rows_and_the_rsline_row_unchanged():
    for split in (None, "0"):
        out, _ = _serve_fresh(_IDS_AND_RSLINE, split)
        got = json.loads(out)
        assert got["ids"] == ["uct-darkpool-levels", "uct-gex-walls", "uct-flow-breakout", "rsLine"]
        assert json.dumps(got["rsLine"]) == json.dumps(rd._rs_line_row(True, True))


def test_flag_on_adds_the_four_rows_after_rsline_and_leaves_rsline_byte_identical():
    off, _ = _serve_fresh(_IDS_AND_RSLINE, None)
    on, _ = _serve_fresh(_IDS_AND_RSLINE, "1")
    assert json.loads(on)["ids"] == json.loads(off)["ids"] + list(SPLIT_IDS)
    assert json.dumps(json.loads(on)["rsLine"]) == json.dumps(json.loads(off)["rsLine"])


def test_flag_on_leaves_the_v3_and_v1_rsline_rows_byte_identical_too():
    """The pre-Phase-3 control fixture, under the split flag: the rsLine row
    in its v3 and v1 shapes is still the frozen bytes."""
    frozen = json.loads(FIXTURE.read_text(encoding="utf-8"))
    code = ("import json, sys\nfrom api.services.signature import registry_defs as rd\n"
            "sys.stdout.write(json.dumps(rd.definition('rsLine')))\n")
    out, _ = _serve_fresh(code, "1", v2="1", v3=None)
    assert out == json.dumps(frozen["v3"])
    out, _ = _serve_fresh(code, "1", v2=None, v3=None)
    assert out == json.dumps(frozen["v1"])


def test_the_router_registers_the_four_providers_only_with_the_flag():
    code = ("import json, sys\n"
            "from api.routers import signature\n"
            "from api.services.signature import registry_defs as rd\n"
            "sys.stdout.write(json.dumps(sorted(k for k in rd._PROVIDERS if k.startswith('rs'))))\n")
    assert json.loads(_serve_fresh(code, None)[0]) == ["rsLine"]
    assert json.loads(_serve_fresh(code, "1")[0]) == ["rsExit", "rsLine", "rsPhases", "rsRating", "rsVsEma"]


def test_the_rows_are_built_whether_or_not_the_flag_is_on():
    assert rd.RS_SPLIT_DEF_IDS == SPLIT_IDS
    assert [d["id"] for d in rd.RS_SPLIT_DEFS] == list(SPLIT_IDS)
    assert "rsRating" not in rd._BY_ID or rd.RS_SPLIT_ENABLED


# ── the rows ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("def_id", SPLIT_IDS)
def test_each_row_is_version_1_rev_1_with_a_payload_and_no_ledger_row(def_id):
    row = next(d for d in rd.RS_SPLIT_DEFS if d["id"] == def_id)
    assert row["version"] == 1 and row["compute"] == {"kind": "server", "fn": def_id, "rev": 1}
    assert row["schemaVersion"] == rd.SCHEMA_VERSION
    assert row["payload_keys"] == ["payload"] and row["rules_key"] is None
    assert row["placement"] == {"target": "pane"}
    assert row["meta"]["tier"] == "premium" and row["meta"]["repaint"] == "non-repainting"
    assert row["columns"] == RS_SPLIT_CONTRACT[def_id]["columns"]
    assert [i["key"] for i in row["inputs"]] == RS_SPLIT_CONTRACT[def_id]["inputs"]
    assert len(set(row["columns"])) == len(row["columns"])


def test_the_rating_row_has_no_benchmark_and_reuses_the_rev_5_rating_columns():
    row = next(d for d in rd.RS_SPLIT_DEFS if d["id"] == "rsRating")
    assert row["inputs"] == []
    assert tuple(row["columns"]) == rd.RS_RATING_WIRE_COLUMNS == ("ratingLine", "ratingMa")
    assert row["meta"]["name"] == "UCT RS Rating"


def test_the_two_ratio_rows_declare_the_rsline_v4_benchmark_pair_exactly():
    v4 = {i["key"]: i for i in rd._rs_line_row(True, True)["inputs"]}
    for def_id in ("rsPhases", "rsVsEma", "rsExit"):
        by_key = {i["key"]: i for i in next(d for d in rd.RS_SPLIT_DEFS if d["id"] == def_id)["inputs"]}
        assert by_key["benchmark"] == v4["benchmark"], def_id
        assert by_key["benchmark"]["options"] == list(rd.RS_LINE_BENCHMARKS_V4) and "CUSTOM" in by_key["benchmark"]["options"]
        assert by_key["customBenchmark"] == v4["customBenchmark"], def_id


def test_the_phases_row_declares_the_two_lengths_from_the_compute_module():
    by_key = {i["key"]: i for i in next(d for d in rd.RS_SPLIT_DEFS if d["id"] == "rsPhases")["inputs"]}
    assert by_key["shortEma"] == {"key": "shortEma", "type": "int", "default": 3, "min": 2, "max": 20}
    assert by_key["longEma"] == {"key": "longEma", "type": "int", "default": 10, "min": 3, "max": 60}
    assert (by_key["shortEma"]["default"], by_key["longEma"]["default"]) == (
        rsm.DEFAULT_PHASES_SHORT, rsm.DEFAULT_PHASES_LONG)
    assert (by_key["shortEma"]["min"], by_key["shortEma"]["max"]) == rsm.PHASES_SHORT_RANGE
    assert (by_key["longEma"]["min"], by_key["longEma"]["max"]) == rsm.PHASES_LONG_RANGE


def test_member_copy_is_plain_english():
    for row in rd.RS_SPLIT_DEFS:
        text = (row["meta"]["name"] + " " + row["meta"]["description"]).lower()
        for banned in (" buy", " sell", "rsi"):
            assert banned not in text, (row["id"], banned)


# ── the resolver on the new rows ──────────────────────────────────────────────

def test_the_resolver_clamps_the_lengths_drops_colours_and_accepts_custom(split_rows):
    out = rd.resolve_inputs("rsPhases", {"benchmark": "CUSTOM", "customBenchmark": " smh ", "shortEma": 999,
                                         "longEma": 1, "lineColor": "#fff", "view": "rating"})
    assert out == {"benchmark": "CUSTOM", "customBenchmark": "SMH", "shortEma": 20, "longEma": 3}
    assert rd.resolve_inputs("rsVsEma", {"lookback": 20, "maLength": 50}) == {"benchmark": "SPY", "customBenchmark": ""}
    assert rd.resolve_inputs("rsRating", {"benchmark": "QQQ", "view": "rating"}) == {}
    with pytest.raises(rd.InputRejected, match="outside the enum vocabulary"):
        rd.resolve_inputs("rsPhases", {"benchmark": "TSLA"})
    with pytest.raises(rd.InputRejected, match="does not match the declared pattern"):
        rd.resolve_inputs("rsVsEma", {"customBenchmark": "$SPX"})


# ── the row ↔ provider contract ───────────────────────────────────────────────

def _key_paths(obj, path=""):
    out = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            out.add(p)
            out |= _key_paths(v, p)
    return out


def _store(monkeypatch, n=900):
    store = _long_daily(n=n)
    fetch = _fetcher(store)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", fetch)
    return store, fetch


@pytest.mark.parametrize("def_id", SPLIT_IDS)
def test_every_declared_column_is_sent_and_every_contract_path_exists(def_id, split_rows, monkeypatch):
    _store(monkeypatch)
    env = sig.RS_SPLIT_PROVIDERS[def_id]("NVDA", "D", rd.resolve_inputs(def_id, {}))
    assert sorted(env["columns"]) == sorted(RS_SPLIT_CONTRACT[def_id]["columns"])
    wired = rd.wire_columns(def_id, env["columns"])            # the lane's exact-match contract
    assert all(len(col) == len(env["times"]) == 900 for col in wired.values())
    got = _key_paths(env["payload"])
    missing = [p for p in RS_SPLIT_CONTRACT[def_id]["paths"] if p not in got]
    assert not missing, f"{def_id} payload lacks {missing}; paths: {sorted(got)}"


@pytest.mark.parametrize("def_id", SPLIT_IDS)
def test_the_lane_serves_each_row_end_to_end(def_id, split_rows, monkeypatch):
    _store(monkeypatch, n=300)
    env = rd.serve(def_id, "NVDA", "D", {"benchmark": "SPY", "lineColor": "#fff"})
    assert env["defId"] == def_id and env["rev"] == 1 and len(env["times"]) == 300
    assert set(env["columns"]) == set(RS_SPLIT_CONTRACT[def_id]["columns"])
    assert "payload" in env and "lineColor" not in env["inputs"]


def test_the_columns_route_and_the_definitions_route_carry_the_three(split_rows, monkeypatch, client):
    _store(monkeypatch, n=300)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    ids = [d["id"] for d in c.get("/api/signature/definitions").json()["definitions"]]
    assert ids == ["uct-darkpool-levels", "uct-gex-walls", "uct-flow-breakout", "rsLine", *SPLIT_IDS]
    for def_id in SPLIT_IDS:
        r = c.get(f"/api/signature/columns?defId={def_id}&sym=NVDA&tf=D")
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body["columns"]) == set(RS_SPLIT_CONTRACT[def_id]["columns"]) and body["rev"] == 1
        assert all(v is None or isinstance(v, (int, float)) for v in body["columns"][RS_SPLIT_CONTRACT[def_id]["columns"][0]])


def test_the_phases_envelope_draws_the_formula_and_reads_its_legend(split_rows, monkeypatch):
    store, _ = _store(monkeypatch)
    env = sig._rs_phases_provider("NVDA", "D", rd.resolve_inputs("rsPhases", {"shortEma": 3, "longEma": 10}))
    pure = rsm.compute_rs_phases_columns(store["NVDA"], store["SPY"], 3, 10)
    assert env["columns"]["phase"] == pure["phase"]
    assert env["columns"]["divergence"][-1] == pytest.approx(pure["divergence"][-1], abs=1e-4)
    assert set(env["columns"]["phase"]) <= {None, 0.0, 1.0}
    assert all(v is None or -3.0 <= v <= 3.0 for v in env["columns"]["divergence"])
    leg = env["payload"]["legend"]
    assert leg["phase"] in (None, 0, 1) and leg["summary"] and leg["asOf"] and leg["stale"] is False
    assert leg["divergence"] == pytest.approx(pure["divergence"][-1])
    assert env["payload"]["inputs"] == {"benchmark": "SPY", "customBenchmark": "", "shortEma": 3, "longEma": 10}
    assert env["payload"]["state"] == "ok" and env["payload"]["benchmark"]["resolved"] == "SPY"


def test_the_vs_ema_envelope_prints_the_rs_line_readout_sentence(split_rows, monkeypatch):
    """One formula: `legend.pctFromMa` IS the newest `dist` cell and the
    summary is the RS line's own "above its 21 EMA by X%"."""
    store, _ = _store(monkeypatch)
    env = sig._rs_vs_ema_provider("NVDA", "D", rd.resolve_inputs("rsVsEma", {}))
    leg = env["payload"]["legend"]
    assert leg["index"] == 899 and leg["pctFromMa"] == pytest.approx(env["columns"]["dist"][-1], abs=1e-4)
    word = "above" if leg["above"] else "below"
    assert leg["summary"].startswith(f"{word} its 21 EMA by ") or leg["summary"] == "at its 21 EMA"
    # ...and it is the sentence the RS line envelope prints for the same bars
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True, True))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    line = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})
    assert line["payload"]["legend"]["summary"] == leg["summary"]
    assert leg["fast"] == pytest.approx(env["columns"]["fast"][-1], abs=1e-4)
    assert leg["slow"] == pytest.approx(env["columns"]["slow"][-1], abs=1e-4)


# ── the rating envelope ───────────────────────────────────────────────────────

def test_the_rating_envelope_is_blank_with_a_reason_when_the_history_is_dark(split_rows, monkeypatch):
    _store(monkeypatch, n=300)
    env = sig._rs_rating_provider("NVDA", "D", {})
    assert all(v is None for col in env["columns"].values() for v in col)
    assert env["payload"]["ratingHistory"]["reason"] == "the rating history is not switched on"
    assert env["payload"]["ratingHistory"]["summary"] == env["payload"]["ratingHistory"]["reason"]
    assert env["payload"]["rating"]["source"] == "dark" and env["payload"]["rating"]["ibd"] is None
    assert env["payload"]["state"] == "ok" and env["payload"]["inputs"] == {}


@pytest.mark.parametrize("tf", ["W", "M", "60", "5"])
def test_the_rating_envelope_says_daily_charts_only_elsewhere(tf, split_rows, monkeypatch):
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    _store(monkeypatch, n=300)
    reads = []
    monkeypatch.setattr(rs_history, "rating_series", lambda *a, **k: reads.append(a) or [])
    env = sig._rs_rating_provider("NVDA", tf, {})
    assert env["payload"]["ratingHistory"]["reason"] == "daily charts only"
    assert env["payload"]["state"] == "daily-only" and reads == [], "no history read off a daily chart"
    assert all(v is None for col in env["columns"].values() for v in col)


def _dated_bars(n, end=(2026, 11, 6)):
    import datetime as _dt
    days, d = [], _dt.date(*end)
    while len(days) < n:
        if d.weekday() < 5:
            days.append(int(d.strftime("%Y%m%d")))
        d -= _dt.timedelta(days=1)
    days.sort()
    return days


def test_the_rating_envelope_draws_the_stored_rating_and_its_blocks(split_rows, monkeypatch, tmp_path):
    """A real SQLite history: the line is the stored rating at each bar's
    session, the average the plain mean of 21 stored values, the blocks the
    rev 5 Rating Reading's and `_rs_rating`'s."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    store = _long_daily(n=300)
    days = _dated_bars(300)
    store = {s: [dict(b, t=t) for b, t in zip(bars, days)] for s, bars in store.items()}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    conn = sqlite3.connect(tmp_path / "screener.db")
    rs_history.ensure_schema(conn)
    sessions = [f"{str(t)[:4]}-{str(t)[4:6]}-{str(t)[6:]}" for t in days[-60:]]
    conn.executemany(
        f"INSERT INTO {rs_history.TABLE} (session, ticker, ibd, m1, m3, m6, m9, m12, score, bars) "
        "VALUES (?, 'NVDA', ?, 50, 60, 70, 80, 90, 1.0, 253)",
        [(s, 40 + i) for i, s in enumerate(sessions)])
    conn.commit()
    conn.close()
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {
        "NVDA": {"ibd": 99, "fast": 91, "asof": sessions[-1], "m1": 50, "m3": 60, "m6": 70, "m9": 80, "m12": 90}})
    env = sig._rs_rating_provider("NVDA", "D", {})
    line, ma = env["columns"]["ratingLine"], env["columns"]["ratingMa"]
    assert line[-60:] == [40 + i for i in range(60)] and line[:-60] == [None] * 240
    assert ma[-1] == pytest.approx(sum(range(79, 100)) / 21.0, abs=0.01) and ma[-60] is None
    rh = env["payload"]["ratingHistory"]
    assert rh["value"] == 99 and rh["change20"] == 20 and rh["sessions"] == 60 and rh["reason"] is None
    assert rh["asof"] == sessions[-1] and rh["stale"] is False and rh["summary"].startswith("99, up")
    rating = env["payload"]["rating"]
    assert (rating["ibd"], rating["m1"], rating["m3"], rating["m6"], rating["m9"], rating["m12"]) == (99, 50, 60, 70, 80, 90)
    assert rating["components"] == "1M 50 · 3M 60 · 6M 70 · 9M 80 · 12M 90" and rating["source"] == "row"


# ── blank states, the RS line's own words ─────────────────────────────────────

@pytest.mark.parametrize("def_id", ["rsPhases", "rsVsEma", "rsExit"])
def test_same_symbol_blanks_everything_with_the_rs_line_reason(def_id, split_rows, monkeypatch):
    _store(monkeypatch, n=300)
    env = sig.RS_SPLIT_PROVIDERS[def_id]("SPY", "D", rd.resolve_inputs(def_id, {"benchmark": "SPY"}))
    assert all(v is None for col in env["columns"].values() for v in col) and len(env["times"]) == 300
    assert env["payload"]["state"] == "same-symbol"
    assert env["payload"]["legend"]["summary"] == "benchmark is the symbol"
    assert env["payload"]["benchmark"]["resolved"] == "SPY"


@pytest.mark.parametrize("def_id", ["rsPhases", "rsVsEma", "rsExit"])
def test_no_benchmark_bars_blanks_everything_and_caches_for_a_minute(def_id, split_rows, monkeypatch):
    store = _long_daily(n=300)
    del store["SPY"]
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    seen = []
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.append((k, ttl)))
    env = sig.RS_SPLIT_PROVIDERS[def_id]("NVDA", "D", rd.resolve_inputs(def_id, {}))
    assert all(v is None for col in env["columns"].values() for v in col)
    assert env["payload"]["state"] == "no-benchmark-bars"
    assert env["payload"]["legend"]["summary"] == "no benchmark bars"
    assert seen and seen[-1][1] == 60


def test_an_unknown_symbol_has_no_bars_and_is_not_cached(split_rows, monkeypatch):
    _store(monkeypatch, n=300)
    seen = []
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.append(k))
    for def_id in SPLIT_IDS:
        env = sig.RS_SPLIT_PROVIDERS[def_id]("ZZZZ", "D", rd.resolve_inputs(def_id, {}))
        assert env["times"] == [] and all(col == [] for col in env["columns"].values())
    assert seen == []


# ── the shared core and the cache keys ────────────────────────────────────────

def test_three_instances_on_one_chart_read_the_bars_once(split_rows, monkeypatch):
    _, fetch = _store(monkeypatch, n=300)
    for def_id in SPLIT_IDS:
        sig.RS_SPLIT_PROVIDERS[def_id]("NVDA", "D", rd.resolve_inputs(def_id, {}))
    assert [c[0] for c in fetch.calls] == ["NVDA", "SPY"], fetch.calls
    # a different benchmark reads the benchmark only; a different timeframe reads both again
    sig._rs_phases_provider("NVDA", "D", rd.resolve_inputs("rsPhases", {"benchmark": "RSP"}))
    assert [c[0] for c in fetch.calls] == ["NVDA", "SPY", "RSP"]
    sig._rs_phases_provider("NVDA", "W", rd.resolve_inputs("rsPhases", {}))
    assert [c[0] for c in fetch.calls] == ["NVDA", "SPY", "RSP", "NVDA", "SPY"]


def test_the_core_memo_expires_and_is_bounded(split_rows, monkeypatch):
    _, fetch = _store(monkeypatch, n=100)
    sig._rs_vs_ema_provider("NVDA", "D", rd.resolve_inputs("rsVsEma", {}))
    assert len(fetch.calls) == 2
    clock = [1_000.0]
    monkeypatch.setattr(rsp.time, "monotonic", lambda: clock[0])
    rsp.rs_core_reset()
    sig._rs_vs_ema_provider("NVDA", "D", rd.resolve_inputs("rsVsEma", {}))
    clock[0] += rsp._RS_CORE_TTL_S + 1
    sig._rs_vs_ema_provider("NVDA", "D", rd.resolve_inputs("rsVsEma", {}))
    assert len(fetch.calls) == 6, "past the TTL both reads run again"
    for i in range(rsp._RS_CORE_MAX + 5):
        rsp._rs_core_put(("bars", f"T{i}", "D", 1, "d"), [])
    assert len(rsp._RS_CORE_MEMO) <= rsp._RS_CORE_MAX


def test_the_cache_keys_lead_with_the_rev_and_shape_and_carry_the_session_day(split_rows, monkeypatch):
    _store(monkeypatch, n=300)
    seen = []
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.append((k, ttl)))
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-09")
    sig._rs_rating_provider("NVDA", "D", {})
    sig._rs_phases_provider("NVDA", "D", rd.resolve_inputs("rsPhases", {"longEma": 12}))
    sig._rs_vs_ema_provider("NVDA", "5", rd.resolve_inputs("rsVsEma", {}))
    keys = [k for k, _ in seen]
    assert keys[0].startswith(f"sig:rsRating1p{rsp._RS_RATING_PAYLOAD_SHAPE}:NVDA:D:r-|e-:2026-11-09")
    assert keys[1].startswith(f"sig:rsPhases1p{rsp._RS_PHASES_PAYLOAD_SHAPE}:NVDA:D:") and '"longEma": 12' in keys[1]
    assert keys[1].endswith(":2026-11-09")
    assert keys[2].startswith(f"sig:rsVsEma1p{rsp._RS_VS_EMA_PAYLOAD_SHAPE}:NVDA:5:")
    assert [ttl for _, ttl in seen][2] == 900, "intraday: 900 s"
    assert all(60 < ttl <= 3 * 24 * 3600 for _, ttl in seen[:2]), "D: to the next session close"


def test_a_cache_hit_is_served_without_a_read(split_rows, monkeypatch):
    sentinel = {"columns": {}, "times": [], "asOf": 0}
    monkeypatch.setattr(sig.cache, "get", lambda k: sentinel)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", lambda *a, **k: pytest.fail("no read on a hit"))
    for def_id in SPLIT_IDS:
        assert sig.RS_SPLIT_PROVIDERS[def_id]("NVDA", "D", rd.resolve_inputs(def_id, {})) is sentinel
        assert rsp.last_timing()["tier"] == "cache"


def test_none_of_the_three_reads_regime_sensitivity_or_evidence(split_rows, monkeypatch):
    _store(monkeypatch, n=300)
    for name in ("_rs_regime", "_rs_regime_bench_bars", "_rs_sensitivity", "_rs_evidence", "_rs_checks",
                 "_rs_phase3", "compute_mansfield_columns"):
        target = rsm if name == "compute_mansfield_columns" else rsp
        monkeypatch.setattr(target, name, lambda *a, _n=name, **k: pytest.fail(f"{_n} was read"))
    for def_id in SPLIT_IDS:
        env = sig.RS_SPLIT_PROVIDERS[def_id]("NVDA", "D", rd.resolve_inputs(def_id, {}))
        assert not {"regime", "sensitivity", "evidence", "checks"} & set(env["payload"])
        rec = rsp.last_timing()
        assert rec["tier"] == "cold" and "evidence" not in rec["stages"]


def test_a_custom_benchmark_resolves_and_warms_when_missing(split_rows, monkeypatch):
    store = _long_daily(n=900)
    store["SMH"] = store["XLK"]
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    env = sig._rs_phases_provider("NVDA", "D", rd.resolve_inputs("rsPhases", {"benchmark": "CUSTOM", "customBenchmark": "smh"}))
    assert env["payload"]["benchmark"]["resolved"] == "SMH" and env["payload"]["state"] == "ok"
    assert env["payload"]["benchmark"]["label"] == "SMH" and env["payload"]["inputs"]["customBenchmark"] == "SMH"
    warmed = []
    monkeypatch.setattr(sig, "_rs_warm_bars", lambda t, tf: warmed.append((t, tf)))
    env = sig._rs_vs_ema_provider("NVDA", "D", rd.resolve_inputs("rsVsEma", {"benchmark": "CUSTOM", "customBenchmark": "ZZZQ"}))
    assert env["payload"]["state"] == "no-benchmark-bars" and warmed == [("ZZZQ", "D")]
    assert "ZZZQ" in (env["payload"]["benchmark"]["note"] or "")


# ── the other rows are untouched ──────────────────────────────────────────────

def test_the_other_four_rows_and_the_signature_ids_are_untouched():
    assert rd.SIGNATURE_DEF_IDS == ("uct-darkpool-levels", "uct-gex-walls", "uct-flow-breakout")
    assert json.dumps(rd.definition("rsLine")) == json.dumps(rd._rs_line_row(rd.RS_V2_ENABLED, rd.RS_V3_ENABLED))
    assert not set(SPLIT_IDS) & set(rd.LEDGER_INDICATOR_FOR)


# ── the flag ledger ───────────────────────────────────────────────────────────

def test_the_ledger_carries_rs_split_dark_on_web_with_its_arming_note():
    raw = LEDGER.read_bytes()
    assert raw.count(b"\n") == raw.count(b"\r\n"), "docs/feature_flags.json is a CRLF file"
    flags = json.loads(raw.decode("utf-8"))["flags"]
    e = flags["RS_SPLIT_ENABLED"]
    assert e["status"] == "dark" and e["where"] == ["web"]
    for must in ("unit U4", "import", "rsRating", "rsPhases", "rsVsEma", "byte-identical",
                 "railway variables --service web --set RS_SPLIT_ENABLED=1",
                 "railway redeploy --service web --yes", "/api/signature/definitions", "Rollback"):
        assert must in e["note"], must
    text = raw.decode("utf-8")
    assert text.index('"RS_LISTS_ENABLED"') < text.index('"RS_SPLIT_ENABLED"') < text.index('"RS_V2_ENABLED"'), "alphabetical"
