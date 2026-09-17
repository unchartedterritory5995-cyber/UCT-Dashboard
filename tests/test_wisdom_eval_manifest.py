"""R67 — the gate manifest crosses as aggregates, or it does not cross.

Production's `wisdom_eval_runs` is empty, so `golden.gate_status` answers `accepted: False` and
the chain's extract step reports `blocked_by_gate`. The gate runs happened on this box. This
pair of tools moves the VERDICT without moving the evidence.

⛔⛔ WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a quote, a segment id, or any other non-aggregate reaching a file that goes into a PUBLIC
   git repo — at any depth, including inside a list;
2. an evaluation of a DIFFERENT extractor_version opening the gate for this one;
3. a REJECTED gate being imported, which would be worse than importing nothing because the
   chain would then run;
4. a second import inserting a second row.
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.extract import golden
from tools.wisdom import export_eval_manifest as exp
from tools.wisdom import import_eval_manifest as imp

REPO = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = REPO / "docs" / "wisdom" / "eval-manifests" / "gate-run-3-93a248c9.json"


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


def _manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


# ── the committed manifest is real, and it is clean ──────────────────────────

def test_the_committed_manifest_exists_and_is_aggregates_only():
    m = _manifest()
    exp.assert_aggregates_only(m["metrics"])          # raises if not
    assert m["kind"] == exp.EVAL_KIND
    assert m["metrics"]["gate"]["decision"] == "accepted"


def test_the_committed_manifest_carries_NO_long_strings_at_all():
    """⭐ The blunt version of the same question, in case the allow-list ever grows: a sha256 is
    64 characters, and nothing else here has any business being longer."""
    def leaves(o):
        if isinstance(o, dict):
            for v in o.values():
                yield from leaves(v)
        elif isinstance(o, list):
            for v in o:
                yield from leaves(v)
        elif isinstance(o, str):
            yield o
    assert max((len(s) for s in leaves(_manifest()["metrics"])), default=0) <= 64


# ── the classifier refuses, and can be seen refusing ─────────────────────────

@pytest.mark.parametrize("bad, where", [
    ({"example_text": "he said the base was tight"}, "an unknown key"),
    ({"per_type": {"CALL": {"sample": "NVDA over 120"}}}, "two levels down"),
    ({"regressions": [{"note": "recall fell on CALL"}]}, "inside a list"),
    ({"segment_id": "seg_0001"}, "a segment id"),
    ({"golden_sha256": "x" * 200}, "an over-long allowed string"),
])
def test_a_non_aggregate_is_refused_wherever_it_hides(bad, where):
    with pytest.raises(exp.NotAggregatesOnly):
        exp.assert_aggregates_only(bad)


def test_CONTROL_a_clean_blob_is_accepted():
    """⭐ Without this, every refusal above would pass against a classifier that refuses
    everything — which is the same defect as a gate that always says no."""
    exp.assert_aggregates_only({"model": "claude-opus-5", "effort": "high", "split": "dev",
                                "gate": {"decision": "accepted", "regressions": []},
                                "per_type": {"CALL": {"tp": 17, "precision": 0.65}},
                                "segments": 83, "unplaced": []})


def test_the_exporter_self_check_passes_standalone():
    assert exp.self_check() == 0


# ── import: refuses, is idempotent, and opens the gate ───────────────────────

def test_a_manifest_for_a_DIFFERENT_extractor_version_is_refused():
    """⛔ A gate result belongs to the extractor it graded. Accepting an older verdict would open
    the extractor on a prompt nobody measured."""
    with pytest.raises(imp.ManifestRefused, match="belongs to the extractor it graded"):
        imp.validate(_manifest(), expected_version="wx-v0-SOMETHING-ELSE")


def test_a_REJECTED_gate_is_refused():
    m = copy.deepcopy(_manifest())
    m["metrics"]["gate"]["decision"] = "rejected"
    with pytest.raises(imp.ManifestRefused, match="did not pass"):
        imp.validate(m, expected_version=m["extractor_version"])


def test_a_quote_bearing_manifest_is_refused_on_the_way_IN_too():
    """⭐ The export's guarantee is NOT inherited: the file has been through git and a human."""
    m = copy.deepcopy(_manifest())
    m["metrics"]["leaked"] = "he said the base was tight"
    with pytest.raises(imp.ManifestRefused, match="aggregates-only"):
        imp.validate(m, expected_version=m["extractor_version"])


def test_import_is_idempotent_and_opens_the_gate(wisdom_db):
    """⛔⛔ THE LOAD-BEARING ONE: after the import the chain's own predicate says accepted."""
    m = _manifest()
    version = m["extractor_version"]
    model = m["metrics"]["model"]

    with store.read() as conn:
        before = golden.gate_status(conn, extractor_version=version, model=model)
    assert before["accepted"] is False, "the gate must start shut, or this proves nothing"

    assert imp.insert(m)["status"] == "inserted"
    assert imp.insert(m)["status"] == "already_present"

    with store.read() as conn:
        rows = conn.execute("SELECT COUNT(*) FROM wisdom_eval_runs").fetchone()[0]
        after = golden.gate_status(conn, extractor_version=version, model=model)
    assert rows == 1
    assert after["accepted"] is True


def test_dry_run_inserts_nothing(wisdom_db):
    m = _manifest()
    assert imp.insert(m, dry_run=True)["status"] == "would_insert"
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_eval_runs").fetchone()[0] == 0


def test_the_importer_self_check_passes_standalone():
    assert imp.self_check() == 0
