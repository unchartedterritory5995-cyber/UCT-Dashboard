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


def rows(**verdicts):
    out = []
    for cid, vs in verdicts.items():
        for v in (vs if isinstance(vs, list) else [vs]):
            out.append({"captureId": cid.replace("_", "-"), "verdict": v})
    return out


def test_a_rule_is_kept_only_when_every_verdict_of_every_fixture_is_match():
    r = ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_b="MATCH", fx_c="MATCH"))
    assert r == {"schema": ee.PINS_RESOLVED_SCHEMA, "rules": {"B-PATH": ["fx-a", "fx-b"], "B-SIZE": ["fx-c"]}}


@pytest.mark.parametrize("bad", ["DIVERGE", "INCONCLUSIVE", "UNGRADABLE", None, "match"])
def test_a_non_match_fixture_does_not_pin(bad):
    r = ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_b=bad, fx_c="MATCH"))
    assert "B-PATH" not in r["rules"] and "B-SIZE" in r["rules"]


def test_a_later_divergence_unpins_what_an_earlier_match_pinned():
    r = ee.resolve_pins(PINS, rows(fx_a=["MATCH", "DIVERGE"], fx_b="MATCH", fx_c="MATCH"))
    assert "B-PATH" not in r["rules"]


def test_a_missing_fixture_fails_it_never_silently_unpins():
    with pytest.raises(ee.PinResolveError, match="fx-b"):
        ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_c="MATCH"))


@pytest.mark.parametrize("bad", [[], "fx-a", [""], None])
def test_a_malformed_fixture_list_fails(bad):
    with pytest.raises(ee.PinResolveError):
        ee.resolve_pins({"schema": ee.PINS_SCHEMA, "rules": {"R": bad}}, rows(fx_a="MATCH"))


def test_a_malformed_source_fails():
    with pytest.raises(ee.PinResolveError):
        ee.resolve_pins({"schema": "other", "rules": {}}, [])


def test_the_output_is_canonical_and_order_independent():
    a = ee.canonical_pins_text(ee.resolve_pins(PINS, rows(fx_a="MATCH", fx_b="MATCH", fx_c="MATCH")))
    swapped = {"schema": ee.PINS_SCHEMA, "rules": {"B-SIZE": ["fx-c"], "B-PATH": ["fx-b", "fx-a"]}}
    b = ee.canonical_pins_text(ee.resolve_pins(swapped, list(reversed(rows(fx_a="MATCH", fx_b="MATCH", fx_c="MATCH")))))
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
