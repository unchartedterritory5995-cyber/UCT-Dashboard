"""W9-T3b rails for the generated probe files and the W9 queue doc.

The expected row and probe names are the design's own (docs/pine/W9-STRATEGY-DESIGN.md 5.2, r3); the engine's
own parser (`evidence_engine.parse_doc`) is the authority on whether a row resolves to a source.
"""
from __future__ import annotations

import collections
import hashlib
import pathlib
import re
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "vendor_harness"))
import w9_probes as wp  # noqa: E402
import evidence_engine as ee  # noqa: E402

PROBES = REPO / "tools" / "visual_conformance" / "probes"
QUEUE = REPO / "docs" / "pine" / "capture-queue-2026-11-05-w9.md"

# 5.2's probe names, by row (the design's table), written out. `(new)` probes plus the S1 core pair.
EXPECTED = {
    "Q-S1-core": ["s1-broker-core"], "Q-S1-core-b": ["s1-broker-core-range"],
    # 2026-11-08, W9 integration review N2: two full exits on one trade (S1's B-EXIT-BIND witness)
    "Q-S1-core-2x": ["w9-q-s1core-two-exits"],
    "Q-S1a": ["w9-q-s1a-size-v4", "w9-q-s1a-size-v6", "w9-q-s1a-size-v5pct", "w9-q-s1a-size-v5cash", "w9-q-s1a-size-v2"],
    "Q-S1b": ["w9-q-s1b-defaults-v4", "w9-q-s1b-defaults-v5", "w9-q-s1b-defaults-v6"],
    "Q-S1c": ["w9-q-s1c-tie"], "Q-S1d": ["w9-q-s1d-same-tick"], "Q-S1e": ["w9-q-s1e-live-past"],
    "Q-S1f": ["w9-q-s1f-reversal-exit"], "Q-S1g": ["w9-q-s1g-pyr-limit"], "Q-S1h": ["w9-q-s1h-fifo"],
    "Q-S1i": ["w9-q-s1i-funds"], "Q-S1j": ["w9-q-s1j-stop-limit"],
    "Q-S1k": ["w9-q-s1k-exit-levels", "w9-q-s1k-exit-levels-v6"], "Q-S1l": ["w9-q-s1l-off-grid"],
    "Q-S1m": ["w9-q-s1m-index"], "Q-S1p": ["w9-q-s1p-when"], "Q-S1n": ["s1-broker-core"],
    "W9-D1": ["w9-d1-v6-defaults", "w9-d1-margin50"], "W9-D2": ["w9-d2-currency"],
    "W9-K1": ["w9-k1-commission-pct"], "W9-K2": ["w9-k2-commission-contract"], "W9-K3": ["w9-k3-commission-order"],
    "W9-K4": ["w9-k4-slippage"], "W9-P1": ["w9-p1-on-close"], "W9-P1b": ["w9-p1b-on-close-fills"],
    "W9-P2": ["w9-p2-order-fills"], "W9-P3": ["w9-p3-every-tick-history"], "W9-X1": ["w9-x1-trail"],
    "W9-X2": ["w9-x2-partial"], "W9-X3": ["w9-x3-oca"], "W9-X4": ["w9-x4-order"],
    "W9-R1": ["w9-r1-risk-allow", "w9-r1-risk-ddown"], "W9-R1i": ["w9-r1-risk-intraday"],
    "W9-M1": ["w9-m1-magnifier-off", "w9-m1-magnifier-on"], "W9-V1": ["w9-v1-values"], "W9-MK1": ["w9-mk1-markers"],
    "W9-S1": ["s1-broker-core"], "W9-S2": ["w9-s2-sharpe", "w9-s2-sharpe-rf0"], "W9-J1": ["s1-broker-core"],
    "Q-S1o": ["w9-q-s1o-every-tick"], "Q-S1p-live": ["s1-broker-core"], "W9-C0": ["r1-strategy-draws"],
}
GENERATED = sorted({n for v in EXPECTED.values() for n in v if n.startswith("w9-") or n.startswith("s1-broker-core")})


def _text(name):
    return (PROBES / f"{name}.pine").read_text(encoding="utf-8")


def _version(src):
    return int(re.match(r"//@version=(\d)", src).group(1))


def test_every_committed_probe_is_exactly_what_the_generator_writes():
    files = wp.all_files()
    assert sorted(n[:-5] for n in files) == GENERATED
    for name, text in files.items():
        assert (PROBES / name).read_bytes().replace(b"\r\n", b"\n") == text.encode("utf-8"), f"{name} differs from its generator"


def test_the_check_mode_can_fail(tmp_path, monkeypatch):
    monkeypatch.setattr(wp, "PROBES", tmp_path)
    assert wp.main(["--check"]) == 1                                   # nothing written: every probe differs
    assert wp.main([]) == 0 and wp.main(["--check"]) == 0
    f = tmp_path / "w9-k1-commission-pct.pine"
    f.write_text(f.read_text(encoding="utf-8") + "// hand edit\n", encoding="utf-8")
    assert wp.main(["--check"]) == 1


def test_every_probe_carries_the_standard_set_for_its_dialect():
    for name in GENERATED:
        src = _text(name)
        v = _version(src)
        titles = re.findall(r'plot\([^\n]*?(?:, title=|, )"([^"]+)"\)', src)
        assert len(titles) == len(set(titles)), f"{name}: duplicate plot titles"
        assert len(titles) <= 64, f"{name}: {len(titles)} plots"
        for must in ["S01_time_CONTROL", "S03_position_size", "S04_position_avg_price", "S05_opentrades", "S06_closedtrades",
                     "S07_netprofit", "S08_equity", "S09_openprofit"]:
            assert must in titles, f"{name} lacks {must}"
        if v >= 5:
            assert "S02_bar_index_CONTROL" in titles
            for k in range(3):
                for fn in wp.TRADE_FNS:
                    assert any(t.startswith("S") and t.endswith(f"_c{k}_{fn}") for t in titles), f"{name} lacks c{k}_{fn}"
            assert "strategy.closedtrades.exit_comment(_i)" in src and "label.new(" in src
        else:
            assert not re.search(r"closedtrades\.\w+\(", src)          # v2 / v4 have no per-trade functions
            assert "strategy.closedtrades.entry_id" not in src


def test_the_standard_set_is_written_once_and_the_table_cannot_drop_it():
    one = {wp.std_block(6) for _ in range(2)}
    assert len(one) == 1
    for name in GENERATED:
        if name.startswith("s1-broker-core") or _version(_text(name)) < 5:
            continue
        assert wp.std_block(_version(_text(name))) in _text(name)
    # control: a probe built without the block would differ from the committed file
    spec = [s for s in wp.specs() if s["name"] == "k1-commission-pct"][0]
    assert wp.std_block(6) in wp.build(spec) and wp.std_block(6) not in wp.build(spec).replace(wp.std_block(6), "")


def test_each_probe_is_a_strategy_with_its_own_title_and_distinct_bytes():
    seen, shas = {}, {}
    for name in GENERATED:
        src = _text(name)
        decl = re.findall(r'^strategy\((?:title=)?"([^"]+)"', src, re.M)
        assert len(decl) == 1, name
        assert decl[0] not in seen, f"{name} repeats the title of {seen[decl[0]]}"
        seen[decl[0]] = name
        sha = hashlib.sha256(src.encode()).hexdigest()
        assert sha not in shas
        shas[sha] = name


def test_dialect_specific_probes_use_their_dialect():
    assert _version(_text("w9-q-s1a-size-v2")) == 2 and "if " not in _text("w9-q-s1a-size-v2").split("// ── standard")[0].split("\n\n", 2)[-1].replace("//", "")
    assert _version(_text("w9-q-s1a-size-v4")) == 4 and "ta.sma" not in _text("w9-q-s1a-size-v4")
    assert _version(_text("w9-q-s1p-when")) == 5 and "when = up" in _text("w9-q-s1p-when")
    assert [_version(_text(f"w9-q-s1b-defaults-{v}")) for v in ("v4", "v5", "v6")] == [4, 5, 6]
    # a "defaults" probe declares none of the settings it is asking about
    for v in ("v4", "v5", "v6"):
        head = _text(f"w9-q-s1b-defaults-{v}").split("\n")[1]
        assert not re.search(r"default_qty|initial_capital|pyramiding|margin_", head)


def test_settings_are_set_in_the_source_for_the_rows_that_test_them():
    assert "commission_value = 0.1" in _text("w9-k1-commission-pct")
    assert "cash_per_contract" in _text("w9-k2-commission-contract") and "cash_per_order" in _text("w9-k3-commission-order")
    assert "slippage = 3" in _text("w9-k4-slippage")
    assert "process_orders_on_close = true" in _text("w9-p1-on-close")
    assert "calc_on_order_fills = true" in _text("w9-p2-order-fills") and "varip int _runs" in _text("w9-p2-order-fills")
    assert "use_bar_magnifier = true" in _text("w9-m1-magnifier-on") and "use_bar_magnifier = false" in _text("w9-m1-magnifier-off")
    assert "risk_free_rate = 0" in _text("w9-s2-sharpe-rf0").splitlines()[1]
    assert "risk_free_rate" not in _text("w9-s2-sharpe").splitlines()[1]


def test_method_b_probe_guards_every_order_call_and_only_it():
    import range_guard as rg
    calls = rg.order_calls()
    for name in GENERATED:
        src = _text(name)
        n_calls = sum(1 for m in rg.CALL_RX.finditer(rg.blank(src)) if m.group(1) in calls)
        n_guards = len(re.findall(r"^\s*if time >= \d+ and time < \d+$", src, re.M))
        if name == "s1-broker-core-range":
            assert n_calls > 0 and n_guards == n_calls
        else:
            assert n_guards == 0, f"{name} carries a guard (only the method (b) probe may)"
    assert "RANGE_X_MS" in (REPO / "tools/vendor_harness/w9_probes.py").read_text(encoding="utf-8")


def test_every_w9_queue_row_resolves_to_its_probe_and_chart():
    world = ee.World()
    doc = ee.parse_doc(world, QUEUE)
    rows = {r["key"].split("#", 1)[1]: r for r in doc["rows"]}
    assert set(rows) == set(EXPECTED)
    for rid, probes in EXPECTED.items():
        r = rows[rid]
        assert r["needsProbe"] is None, f"{rid}: {r['needsProbe']}"
        assert sorted(pathlib.PurePosixPath(s["path"]).stem for s in r["sources"]) == sorted(probes), rid
        assert not r["chartDefaulted"] and r["charts"], rid
    assert rows["Q-S1-core-b"]["charts"] == [["AMEX:SPY", "1D"]]
    assert rows["W9-R1i"]["charts"] == [["AMEX:SPY", "15"]]
    assert rows["Q-S1o"]["charts"] == [["AMEX:SPY", "5"]]
    assert rows["Q-S1a"]["charts"] == [["NYSE:RDDT", "1D"]]


def test_no_generated_probe_is_an_orphan_of_the_queue():
    named = {n for v in EXPECTED.values() for n in v}
    assert set(GENERATED) <= named
    doc = QUEUE.read_text(encoding="utf-8")
    for n in GENERATED:
        assert f"`{n}.pine`" in doc, f"{n} is not named in the queue doc"


def test_the_resolver_can_fail_a_row_with_no_probe(tmp_path):
    d = tmp_path / "capture-queue-2026-11-05-x.md"
    d.write_text("| row | probe | chart |\n|---|---|---|\n| Z1 | `w9-does-not-exist.pine` | NYSE:RDDT 1D |\n", encoding="utf-8")
    r = ee.parse_doc(ee.World(), d)["rows"][0]
    assert r["needsProbe"] is not None and r["sources"] == []


def test_the_committed_queue_json_matches_the_docs():
    r = subprocess.run([sys.executable, str(REPO / "tools/vendor_harness/evidence_engine.py"), "queue", "--check"],
                       capture_output=True, text=True, cwd=REPO, env={**__import__("os").environ, "PYTHONUTF8": "1"})
    assert r.returncode == 0, r.stdout[-400:] + r.stderr[-400:]
