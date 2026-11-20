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
#: U14: a row pins only the rules it says it exercised; each T2 fixture exercises the rule it is listed for.
EXERCISED = {"fx-a": ["B-PATH"], "fx-b": ["B-PATH"], "fx-c": ["B-SIZE"]}


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
                        "provenance": readback(), "rulesExercised": EXERCISED.get(cid.replace("_", "-"), [])})
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


def ledger_row(cid, production="INCONCLUSIVE"):
    """The evidence ledger's OWN row for a capture (evidence_ledger.SCHEMA): the indicator harness's per-lane grade,
    no top-level broker `verdict` (every one of the 972 committed rows on 2026-11-17 has this shape)."""
    return {"schema": ee.LEDGER_SCHEMA, "captureId": cid, "sourceSha256": "sha-default", "rows": [],
            "verdicts": {"production": {"verdict": production, "reason": "member door refused (pine:strategy-call)"},
                         "runtime-on": None}}


def test_the_indicator_harness_ledger_row_is_not_a_broker_verdict():
    # 2026-11-17 (Q-S1i, B-MARGIN-CALL): w9-q-s1i-short-v6 carries such a row beside its MATCHing strategy verdict.
    # Read as a broker row, its missing `verdict` was a non-MATCH and no capture promoted through it could pin.
    r = ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_b="MATCH", fx_c="MATCH") + [ledger_row("fx-b")], sources=SOURCES)
    assert r["rules"] == {"B-PATH": ["fx-a", "fx-b"], "B-SIZE": ["fx-c"]}
    # a ledger row with a top-level verdict is still read as one (fail closed: only the per-lane row is skipped)
    r = ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_b="MATCH", fx_c="MATCH") + [{**ledger_row("fx-b"), "verdict": "DIVERGE"}],
                        sources=SOURCES)
    assert "B-PATH" not in r["rules"]
    # and a fixture with ONLY such a row has no committed verdict: an ERROR, never a pin and never a silent un-pin
    with pytest.raises(ee.PinResolveError, match="fx-b"):
        ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_c="MATCH") + [ledger_row("fx-b")], sources=SOURCES)


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
        json.loads(ee.PINS_SRC.read_text(encoding="utf-8")), ee.pin_rows()))
    assert ee.PINS_OUT.read_bytes().decode("utf-8").replace("\r\n", "\n") == text  # autocrlf checkouts


def test_FRESHNESS_check_fails_on_a_stale_ledger(tmp_path):
    src = tmp_path / "pins.json"
    src.write_text(json.dumps({"schema": ee.PINS_SCHEMA, "rules": {}}), encoding="utf-8")
    out = tmp_path / "resolved.json"
    out.write_text('{"rules":{"X":["f"]},"schema":"%s"}\n' % ee.PINS_RESOLVED_SCHEMA, encoding="utf-8")
    led = tmp_path / "ledger.jsonl"
    vd = tmp_path / "verdicts"
    assert ee.cmd_pins(check=True, src=src, out=out, ledger=led, verdicts_dir=vd) == 1
    assert ee.cmd_pins(check=False, src=src, out=out, ledger=led, verdicts_dir=vd) == 0
    assert ee.cmd_pins(check=True, src=src, out=out, ledger=led, verdicts_dir=vd) == 0

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
         "provenance": readback() if core is None else core, "rulesExercised": ["B-MARKET"]},
        {"captureId": "p1", "verdict": "MATCH", "queueTargetId": "W9-P1", "sourceSha256": p1_sha,
         "provenance": readback(process_orders_on_close=True) if p1 is None else p1, "rulesExercised": ["B-POC"]},
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
                                     ("use_bar_magnifier", True)])
def test_r2_a_default_timing_row_with_a_moved_setting_is_not_match(key, bad):
    r = ee.resolve_pins(R2_PINS, r2_rows(core=readback(**{key: bad})), sources=SRC)
    assert "B-MARKET" not in r["rules"] and "B-POC" in r["rules"]


def test_u14_an_input_the_source_version_does_not_have_is_not_read_back():
    """`calc_on_every_history_tick` exists from //@version=6 (PROPERTY_TABLE sinceVersion, measured on s25):
    a v5 source (s1-broker-core) has no such input, so its row is not held to it; a v6 source is."""
    assert ee.settings_property_table()["calc_on_every_history_tick"]["sinceVersion"] == 6
    v5 = ee.resolve_pins(R2_PINS, r2_rows(core=readback(calc_on_every_history_tick="true")), sources=SRC)
    assert "B-MARKET" in v5["rules"]
    no_input = readback()
    no_input["strategySettings"]["properties"] = [p for p in no_input["strategySettings"]["properties"]
                                                  if p["name"] != TABLE["calc_on_every_history_tick"]["name"]]
    assert "B-MARKET" in ee.resolve_pins(R2_PINS, r2_rows(core=no_input), sources=SRC)["rules"]
    v6 = {"schema": ee.PINS_SCHEMA, "rules": {"B-PATH": ["fx-a"]}}
    rows_v6 = [{"captureId": "fx-a", "verdict": "MATCH", "sourceSha256": "sha-default", "rulesExercised": ["B-PATH"],
                "provenance": readback(calc_on_every_history_tick="true")}]
    assert ee.resolve_pins(v6, rows_v6, sources=SRC)["rules"] == {}
    rows_v6[0]["provenance"] = readback()
    assert ee.resolve_pins(v6, rows_v6, sources=SRC)["rules"] == {"B-PATH": ["fx-a"]}


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


# ─── U14: verdict files -> resolve_pins (D1: pinned only when EVERY capture that exercises it MATCHes) ───
import re  # noqa: E402

BROKER_RULES_JS = (ee.RT_DIR / "brokerRules.js").read_text(encoding="utf-8")
#: the ledger's vocabulary, read off brokerRules.js (emulator + presentation rules): `'ID': Object.freeze({ capture:`
BROKER_RULE_IDS = sorted(set(re.findall(r"'([A-Z][A-Z0-9-]+)': Object\.freeze\(\{ capture:", BROKER_RULES_JS)))
RULE_IDS = sorted(set(BROKER_RULE_IDS) | set(re.findall(r"export const MARKER_RULE = '([A-Z-]+)'", BROKER_RULES_JS)))
U_PINS = {"schema": ee.PINS_SCHEMA, "rules": {"B-MARKET": ["core"], "B-PATH": ["core"]}}


def sv(cid="core", verdict="MATCH", exercised=("B-MARKET", "B-PATH"), fills=True, sha="sha-core", values=36):
    """A strategy verdict file's row (the shape strategyHarness.js writes)."""
    return {"schema": ee.STRATEGY_VERDICT_SCHEMA, "captureId": cid, "verdict": verdict, "sourceSha256": sha,
            "queueTargetId": "Q-S1-core",
            "graded": {"trades": True, "fills": fills, "slots": 3, "values": values, "texts": 0},
            "rulesExercised": list(exercised), "provenance": readback()}


def test_u14_rule_vocabulary_is_read_off_brokerRules():
    # 51 since 2026-11-16: B-PYR-PRICE (Q-S1g, a value witness; strategiesAreRuled.test.js pins the same count)
    # 52 since 2026-11-16: B-FUNDS (Q-S1i, the report capture w9-q-s1a-size-v6)
    # 54 since 2026-11-17: B-FUNDS-SHORT and B-MARGIN-CALL (Q-S1i, the report capture w9-q-s1i-short-v6)
    # 58 since 2026-11-17: B-QTY-REVERSE, B-FUNDS-REVERSE, B-MARGIN-CALL-ALL, B-ENTRY-ORDER (w9-q-s1b-defaults-v6)
    # 59 since 2026-11-17: B-V3 (Pine v2 / v3, w9-q-s1a-size-v2 and w9-g1-v3-properties)
    # 60 since 2026-11-17: B-V4-MARGIN0 (ruling D12b, the two v4 captures)
    # 63 since 2026-11-19 (the strategy unit): B-ROUND-LEVEL and B-QTY-REVERSE-M0 (the community capture
    # macd-shortlong-strategy-is-rddt-1d-2026-11-18), B-MARGIN-ZERO (w9-q-s1b-v4-shape-b)
    assert len(BROKER_RULE_IDS) == 63 and "B-MARKET" in RULE_IDS and "MK-LOOK" in RULE_IDS
    assert "B-ROUND" in RULE_IDS and "B-TXT-CLOSE-ID" in RULE_IDS and "B-PYR-PRICE" in RULE_IDS
    assert "B-FUNDS" in RULE_IDS
    assert "B-FUNDS-SHORT" in RULE_IDS and "B-MARGIN-CALL" in RULE_IDS
    assert {"B-QTY-REVERSE", "B-FUNDS-REVERSE", "B-MARGIN-CALL-ALL", "B-ENTRY-ORDER", "B-V3", "B-V4-MARGIN0"} <= set(RULE_IDS)
    assert {"B-ROUND-LEVEL", "B-QTY-REVERSE-M0", "B-MARGIN-ZERO"} <= set(RULE_IDS)


def test_u14_a_match_that_exercised_the_rule_pins_it():
    assert ee.resolve_pins(U_PINS, [sv()], sources=SRC)["rules"] == {"B-MARKET": ["core"], "B-PATH": ["core"]}


def test_u14_a_pin_from_a_DIVERGE_capture_is_refused():
    assert ee.resolve_pins(U_PINS, [sv(verdict="DIVERGE")], sources=SRC)["rules"] == {}


@pytest.mark.parametrize("bad", ["INCONCLUSIVE", "UNGRADABLE", "EXPECTED-REFUSAL"])
def test_u14_no_other_verdict_pins(bad):
    assert ee.resolve_pins(U_PINS, [sv(verdict=bad)], sources=SRC)["rules"] == {}


def test_u14_a_capture_pins_only_the_rules_it_exercised():
    assert ee.resolve_pins(U_PINS, [sv(exercised=["B-MARKET"])], sources=SRC)["rules"] == {"B-MARKET": ["core"]}


def test_u14_a_row_that_states_nothing_it_exercised_pins_nothing():
    row = sv()
    del row["rulesExercised"]
    assert ee.resolve_pins(U_PINS, [row], sources=SRC)["rules"] == {}


def test_u14_a_trade_list_match_without_the_fills_graded_does_not_pin():
    assert ee.resolve_pins(U_PINS, [sv(fills=False)], sources=SRC)["rules"] == {}


@pytest.mark.parametrize("values", [0, None, True, "36"])
def test_a_fill_match_that_graded_no_value_series_does_not_pin(values):
    """Value read-backs: `graded.values` is how many of the capture's plots were compared bar by bar. A MATCH
    with none (0, absent, or not a count) is a fill match only and pins nothing; the control pins."""
    row = sv(values=values)
    if values is None:
        del row["graded"]["values"]
    assert ee.resolve_pins(U_PINS, [row], sources=SRC)["rules"] == {}
    assert ee.resolve_pins(U_PINS, [sv(values=1)], sources=SRC)["rules"] == {"B-MARKET": ["core"], "B-PATH": ["core"]}


def test_an_UNLISTED_match_without_values_unpins_the_rules_it_exercised():
    rows = [sv(), sv(cid="other", exercised=["B-PATH"], values=0)]
    assert ee.resolve_pins(U_PINS, rows, sources=SRC)["rules"] == {"B-MARKET": ["core"]}


def test_u14_an_UNLISTED_capture_that_exercised_the_rule_and_diverged_unpins_it():
    rows = [sv(), sv(cid="other", verdict="DIVERGE", exercised=["B-PATH"])]
    assert ee.resolve_pins(U_PINS, rows, sources=SRC)["rules"] == {"B-MARKET": ["core"]}
    # control: the same unlisted capture MATCHing leaves both pinned
    rows = [sv(), sv(cid="other", verdict="MATCH", exercised=["B-PATH"])]
    assert ee.resolve_pins(U_PINS, rows, sources=SRC)["rules"] == {"B-MARKET": ["core"], "B-PATH": ["core"]}


# ── ruling D11: a DIVERGE with a proven first difference un-pins only its culprit set ──
D11_PINS = {"schema": ee.PINS_SCHEMA, "rules": {"B-MARKET": ["core"], "B-PATH": ["core"], "B-CANCEL": ["core"]}}


def d11(**over):
    """An unlisted capture that exercised three rules and DIVERGEd at an event where it first exercised B-CANCEL."""
    row = sv(cid="x5", verdict="DIVERGE", exercised=["B-MARKET", "B-PATH", "B-CANCEL"])
    row.update({"firstDifference": {"bar": 1714397400, "step": 5}, "prefixExact": True,
                "culprit": ["B-CANCEL"], "afterDifference": []})
    row.update(over)
    return row


def d11_core():
    return sv(exercised=["B-MARKET", "B-PATH", "B-CANCEL"])


def test_d11_a_proven_first_difference_unpins_only_the_culprit_set():
    got = ee.resolve_pins(D11_PINS, [d11_core(), d11()], sources=SRC)["rules"]
    assert got == {"B-MARKET": ["core"], "B-PATH": ["core"]}       # B-CANCEL, the culprit, stays unpinned
    # control: without the recorded fields the same row is strict and un-pins all three
    strict = sv(cid="x5", verdict="DIVERGE", exercised=["B-MARKET", "B-PATH", "B-CANCEL"])
    assert ee.resolve_pins(D11_PINS, [d11_core(), strict], sources=SRC)["rules"] == {}


def test_d11_a_rule_first_exercised_after_the_difference_is_unpinned_too():
    row = d11(afterDifference=["B-PATH"])
    assert ee.resolve_pins(D11_PINS, [d11_core(), row], sources=SRC)["rules"] == {"B-MARKET": ["core"]}


@pytest.mark.parametrize("over", [
    {"culprit": []},                                   # an EMPTY culprit set: the event exercised nothing new
    {"prefixExact": False},                            # the bars before the difference are not exact
    {"prefixExact": "true"},
    {"prefixExact": None},
    {"firstDifference": None},
    {"firstDifference": {"bar": 1714397400}},
    {"firstDifference": {"bar": "1714397400", "step": 5}},
    {"firstDifference": {"bar": True, "step": 5}},
    {"culprit": None},
    {"culprit": "B-CANCEL"},
    {"afterDifference": None},
    {"culprit": ["B-NOT-EXERCISED"]},                  # a culprit the run never exercised
    {"culprit": ["B-CANCEL"], "afterDifference": ["B-CANCEL"]},
])
def test_d11_anything_missing_or_unproven_falls_back_to_the_strict_rule(over):
    assert ee.culprit_scope(d11(**over)) is None
    assert ee.resolve_pins(D11_PINS, [d11_core(), d11(**over)], sources=SRC)["rules"] == {}


def test_d11_the_exception_is_for_DIVERGE_alone_and_never_makes_a_capture_match_evidence():
    for verdict in ("INCONCLUSIVE", "UNGRADABLE", "EXPECTED-REFUSAL"):
        assert ee.culprit_scope(d11(verdict=verdict)) is None
        assert ee.resolve_pins(D11_PINS, [d11_core(), d11(verdict=verdict)], sources=SRC)["rules"] == {}
    # a LISTED capture that DIVERGEs pins nothing, culprit set or not: its "before" rules are not evidence
    listed = d11()
    listed["captureId"] = "core"
    assert ee.resolve_pins(D11_PINS, [listed], sources=SRC)["rules"] == {}
    # and the culprit rule stays unpinned even when another capture MATCHes on it
    assert "B-CANCEL" not in ee.resolve_pins(D11_PINS, [d11_core(), d11()], sources=SRC)["rules"]


def test_u14_the_settings_precondition_still_applies_to_a_strategy_verdict():
    row = sv()
    row["provenance"] = readback(process_orders_on_close=True)
    assert ee.resolve_pins(U_PINS, [row], sources=SRC)["rules"] == {}


def test_u14_verdict_files_are_read_and_a_bad_one_fails(tmp_path):
    (tmp_path / "core.json").write_text(json.dumps(sv()), encoding="utf-8")
    rows = ee.read_strategy_verdicts(tmp_path)
    assert [r["captureId"] for r in rows] == ["core"]
    (tmp_path / "misnamed.json").write_text(json.dumps(sv(cid="core")), encoding="utf-8")
    with pytest.raises(ee.PinResolveError, match="not its own file name"):
        ee.read_strategy_verdicts(tmp_path)
    (tmp_path / "misnamed.json").write_text(json.dumps({"schema": "other"}), encoding="utf-8")
    with pytest.raises(ee.PinResolveError, match="not a uct.strategy-verdict/v1"):
        ee.read_strategy_verdicts(tmp_path)


def test_u14_cmd_pins_resolves_from_verdict_files(tmp_path):
    src = tmp_path / "pins.json"
    src.write_text(json.dumps(U_PINS), encoding="utf-8")
    vd = tmp_path / "verdicts"
    vd.mkdir()
    out = tmp_path / "resolved.json"
    led = tmp_path / "ledger.jsonl"
    with pytest.raises(ee.PinResolveError, match="no committed verdict"):
        ee.cmd_pins(src=src, out=out, ledger=led, verdicts_dir=vd)
    (vd / "core.json").write_text(json.dumps(sv(sha=CORE_SHA)), encoding="utf-8")
    assert ee.cmd_pins(src=src, out=out, ledger=led, verdicts_dir=vd) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["rules"] == {"B-MARKET": ["core"], "B-PATH": ["core"]}


import hashlib  # noqa: E402
CORE_SHA = hashlib.sha256(CORE_SRC.replace("\r\n", "\n").encode("utf-8")).hexdigest()
SRC["sha-core"] = CORE_SRC


# ── the per-rule pin rail, over the COMMITTED state ────────────────────────────────
COMMITTED_PINS = json.loads(ee.PINS_SRC.read_text(encoding="utf-8"))
COMMITTED_RESOLVED = json.loads(ee.PINS_OUT.read_text(encoding="utf-8"))
COMMITTED_VERDICTS = ee.read_strategy_verdicts()


@pytest.mark.parametrize("rule", RULE_IDS)
def test_u14_PER_RULE_a_committed_pin_rests_on_matching_captures_that_exercised_it(rule):
    """For every rule: it is pinned in the committed resolved ledger only if every capture brokerPins.json
    names for it has a committed verdict that is MATCH, graded its fills, and exercised the rule; and no
    committed verdict that exercised it is anything but MATCH."""
    exercisers = [v for v in COMMITTED_VERDICTS if rule in v["rulesExercised"]]
    if rule not in COMMITTED_RESOLVED["rules"]:
        return
    listed = COMMITTED_RESOLVED["rules"][rule]
    assert listed == sorted(set(COMMITTED_PINS["rules"][rule]))
    by_id = {v["captureId"]: v for v in COMMITTED_VERDICTS}
    for cid in listed:
        v = by_id.get(cid)
        assert v is not None, f"{rule}: pinned by {cid}, which has no committed strategy verdict"
        assert v["verdict"] == "MATCH" and v["graded"]["fills"] is True and rule in v["rulesExercised"]
        assert v["graded"]["values"] > 0, f"{rule}: {cid} MATCHed without one value series compared"
    assert all(v["verdict"] == "MATCH" for v in exercisers), f"{rule}: a committed capture exercised it and did not MATCH"


def test_u14_every_committed_ledger_rule_is_in_the_vocabulary():
    assert set(COMMITTED_PINS["rules"]) <= set(RULE_IDS)
    assert set(COMMITTED_RESOLVED["rules"]) <= set(RULE_IDS)
    for v in COMMITTED_VERDICTS:
        assert set(v["rulesExercised"]) <= set(RULE_IDS), v["captureId"]
