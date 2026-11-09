"""W9-T2 -- the pin ledger's resolve step and its freshness rail (design rule 7)."""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "tools" / "vendor_harness"))
import evidence_engine as ee  # noqa: E402

PINS = {"schema": ee.PINS_SCHEMA, "rules": {"B-PATH": ["fx-a", "fx-b"], "B-SIZE": ["fx-c"]}}


# W9-T6 r2: every pin fixture needs its settings read back as its source asks. These T2 rails test the
# verdict logic, so each row carries a default-timing source and a read-back that agrees with it.
TABLE = ee.settings_property_table()
DEFAULT_SRC = '//@version=6\nstrategy("t")\nplot(close)\n'
SOURCES = {"sha-default": DEFAULT_SRC}


def readback(**over):
    vals = {**ee.SETTINGS_DEFAULTS, **over}
    return {"strategySettings": {"properties": [{"name": TABLE[k]["name"], "value": v} for k, v in vals.items()]}}


def rows(**verdicts):
    out = []
    for cid, vs in verdicts.items():
        for v in (vs if isinstance(vs, list) else [vs]):
            out.append({"captureId": cid.replace("_", "-"), "verdict": v, "sourceSha256": "sha-default",
                        "provenance": readback()})
    return out


def test_a_rule_is_kept_only_when_every_verdict_of_every_fixture_is_match():
    r = ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_b="MATCH", fx_c="MATCH"), sources=SOURCES)
    assert r == {"schema": ee.PINS_RESOLVED_SCHEMA, "rules": {"B-PATH": ["fx-a", "fx-b"], "B-SIZE": ["fx-c"]}}


@pytest.mark.parametrize("bad", ["DIVERGE", "INCONCLUSIVE", "UNGRADABLE", None, "match"])
def test_a_non_match_fixture_does_not_pin(bad):
    r = ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_b=bad, fx_c="MATCH"), sources=SOURCES)
    assert "B-PATH" not in r["rules"] and "B-SIZE" in r["rules"]


def test_a_later_divergence_unpins_what_an_earlier_match_pinned():
    r = ee.resolve_pins(PINS, rows(fx_a=["MATCH", "DIVERGE"], fx_b="MATCH", fx_c="MATCH"), sources=SOURCES)
    assert "B-PATH" not in r["rules"]


def test_a_missing_fixture_fails_it_never_silently_unpins():
    with pytest.raises(ee.PinResolveError, match="fx-b"):
        ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_c="MATCH"), sources=SOURCES)


@pytest.mark.parametrize("bad", [[], "fx-a", [""], None])
def test_a_malformed_fixture_list_fails(bad):
    with pytest.raises(ee.PinResolveError):
        ee.resolve_pins({"schema": ee.PINS_SCHEMA, "rules": {"R": bad}}, rows(fx_a="MATCH"), sources=SOURCES)


def test_a_malformed_source_fails():
    with pytest.raises(ee.PinResolveError):
        ee.resolve_pins({"schema": "other", "rules": {}}, [], sources=SOURCES)


def test_the_output_is_canonical_and_order_independent():
    a = ee.canonical_pins_text(ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_b="MATCH", fx_c="MATCH"), sources=SOURCES))
    swapped = {"schema": ee.PINS_SCHEMA, "rules": {"B-SIZE": ["fx-c"], "B-PATH": ["fx-b", "fx-a"]}}
    b = ee.canonical_pins_text(ee.resolve_pins(swapped, list(reversed(rows(fx_a="MATCH", fx_b="MATCH", fx_c="MATCH"))), sources=SOURCES))
    assert a == b and a.endswith("}\n") and " " not in a.strip()


def test_FRESHNESS_the_committed_ledger_is_the_resolution_of_its_sources():
    text = ee.canonical_pins_text(ee.resolve_pins(
        json.loads(ee.PINS_SRC.read_text(encoding="utf-8")), ee.read_ledger_rows()))
    assert ee.PINS_OUT.read_bytes().decode("utf-8").replace("\r\n", "\n") == text  # autocrlf checkouts


def test_FRESHNESS_check_fails_on_a_stale_ledger(tmp_path):
    src = tmp_path / "pins.json"
    src.write_text(json.dumps({"schema": ee.PINS_SCHEMA, "rules": {}}), encoding="utf-8")
    out = tmp_path / "resolved.json"
    out.write_text('{"rules":{"X":["f"]},"schema":"%s"}\n' % ee.PINS_RESOLVED_SCHEMA, encoding="utf-8")
    led = tmp_path / "ledger.jsonl"
    assert ee.cmd_pins(check=True, src=src, out=out, ledger=led) == 1
    assert ee.cmd_pins(check=False, src=src, out=out, ledger=led) == 0
    assert ee.cmd_pins(check=True, src=src, out=out, ledger=led) == 0

# ─── W9-T6 r2: the settings read-back is a precondition on EVERY pin fixture (design 5.1) ─────────────
P1_SRC = (ee.REPO / "tools" / "visual_conformance" / "probes" / "w9-p1-on-close.pine").read_text(encoding="utf-8")
CORE_SRC = (ee.REPO / "tools" / "visual_conformance" / "probes" / "s1-broker-core.pine").read_text(encoding="utf-8")
SRC = {"sha-core": CORE_SRC, "sha-p1": P1_SRC, "sha-default": DEFAULT_SRC,
       "sha-input": '//@version=6\npoc = input.bool(false)\nstrategy("t", process_orders_on_close = poc)\n',
       "sha-none": '//@version=6\nindicator("t")\nplot(close)\n'}
R2_PINS = {"schema": ee.PINS_SCHEMA, "rules": {"B-MARKET": ["core"], "B-POC": ["p1"]}}


def r2_rows(core=None, p1=None, core_sha="sha-core", p1_sha="sha-p1", core_verdict="MATCH"):
    return [
        {"captureId": "core", "verdict": core_verdict, "queueTargetId": "Q-S1-core", "sourceSha256": core_sha,
         "provenance": readback() if core is None else core},
        {"captureId": "p1", "verdict": "MATCH", "queueTargetId": "W9-P1", "sourceSha256": p1_sha,
         "provenance": readback(process_orders_on_close=True) if p1 is None else p1},
    ]


def test_r2_the_property_table_derives_from_the_capture_side():
    text = (_ROOT / "tools" / "vendor_harness" / "strategy_capture.mjs").read_text(encoding="utf-8")
    for key, row in TABLE.items():
        assert f"key: '{key}'" in text and row["name"] in text
    assert set(TABLE) == set(ee.SETTINGS_DEFAULTS)


def test_r2_expected_settings_come_from_the_source_declaration():
    assert ee.expected_settings(P1_SRC, TABLE)["process_orders_on_close"] is True
    assert ee.expected_settings(CORE_SRC, TABLE) == ee.SETTINGS_DEFAULTS
    assert ee.expected_settings(SRC["sha-input"], TABLE) is None     # a non-literal declaration fails closed
    assert ee.expected_settings(SRC["sha-none"], TABLE) is None      # no strategy() call
    # a commented-out declaration is not a declaration
    assert ee.expected_settings('strategy("t", calc_on_every_tick = true) // process_orders_on_close = true', TABLE) \
        == {**ee.SETTINGS_DEFAULTS, "calc_on_every_tick": True}
    # a comment INSIDE the argument list, and a commented-out strategy() call before the real one
    assert ee.expected_settings('strategy("t", // process_orders_on_close = true\n    calc_on_every_tick = true)', TABLE) \
        == {**ee.SETTINGS_DEFAULTS, "calc_on_every_tick": True}
    assert ee.expected_settings('// strategy("x", process_orders_on_close = true)\nstrategy("t")', TABLE) \
        == ee.SETTINGS_DEFAULTS


def test_r2_both_rows_read_back_as_their_sources_ask_pin():
    assert ee.resolve_pins(R2_PINS, r2_rows(), sources=SRC)["rules"] == {"B-MARKET": ["core"], "B-POC": ["p1"]}


@pytest.mark.parametrize("key,bad", [("process_orders_on_close", True), ("calc_on_order_fills", True),
                                     ("calc_on_every_tick", True), ("backtest_fill_limits_assumption", 2),
                                     ("use_bar_magnifier", True), ("calc_on_every_history_tick", "true")])
def test_r2_a_default_timing_row_with_a_moved_setting_is_not_match(key, bad):
    r = ee.resolve_pins(R2_PINS, r2_rows(core=readback(**{key: bad})), sources=SRC)
    assert "B-MARKET" not in r["rules"] and "B-POC" in r["rules"]


def test_r2_a_w9_p1_row_with_poc_true_read_back_passes_and_poc_false_does_not():
    assert "B-POC" in ee.resolve_pins(R2_PINS, r2_rows(), sources=SRC)["rules"]
    assert "B-POC" not in ee.resolve_pins(R2_PINS, r2_rows(p1=readback()), sources=SRC)["rules"]


def test_r2_a_w9_p1_row_with_an_undeclared_setting_moved_is_not_match():
    r = ee.resolve_pins(R2_PINS, r2_rows(p1=readback(process_orders_on_close=True, calc_on_order_fills=True)), sources=SRC)
    assert "B-POC" not in r["rules"]


@pytest.mark.parametrize("prov", [{}, {"strategySettings": {}}, {"strategySettings": {"properties": []}}])
def test_r2_no_readback_is_not_match(prov):
    assert "B-MARKET" not in ee.resolve_pins(R2_PINS, r2_rows(core=prov), sources=SRC)["rules"]


def test_r2_one_setting_missing_from_the_readback_is_not_match():
    prov = readback()
    prov["strategySettings"]["properties"] = [p for p in prov["strategySettings"]["properties"]
                                              if p["name"] != TABLE["use_bar_magnifier"]["name"]]
    assert "B-MARKET" not in ee.resolve_pins(R2_PINS, r2_rows(core=prov), sources=SRC)["rules"]


@pytest.mark.parametrize("sha", ["sha-unknown", None, "sha-input", "sha-none"])
def test_r2_a_row_whose_source_is_unknown_or_unreadable_is_not_match(sha):
    assert "B-MARKET" not in ee.resolve_pins(R2_PINS, r2_rows(core_sha=sha), sources=SRC)["rules"]


def test_r2_never_turns_a_divergence_into_a_match():
    assert "B-MARKET" not in ee.resolve_pins(R2_PINS, r2_rows(core_verdict="DIVERGE"), sources=SRC)["rules"]


def test_r2_rows_no_pin_rests_on_are_not_checked():
    rs = r2_rows() + [{"captureId": "unrelated", "verdict": "MATCH"}]
    assert ee.resolve_pins(R2_PINS, rs, sources=SRC)["rules"] == {"B-MARKET": ["core"], "B-POC": ["p1"]}


def test_r2_the_committed_probes_are_found_by_their_text_sha():
    import hashlib
    shas = ee.committed_sources_by_sha()
    lf = P1_SRC.replace("\r\n", "\n")
    assert shas[hashlib.sha256(lf.encode("utf-8")).hexdigest()] == lf
