"""R12 — the gate persists its validated records, and persisting changes nothing it measures.

Two properties, and they fail for different reasons, so both are here:

1. **Persistence does not touch scoring.** A phase's aggregates must be byte-identical with
   persistence on and off. This is the mutation proof: if `persist_phase` ever mutated a result
   (it strips its own private key, and that strip is the load-bearing line), this goes red.
2. **A persisted run re-scores offline.** Reading the run back through the SAME
   `segment_scores` / `golden.score` path reproduces the report's `per_type` exactly, with no
   API call, no golden file and no samples tree — which is the whole point of the ruling.

⛔ No network, no API key, no spend: the "extractor output" here is a fixture built in-process.
"""
from __future__ import annotations

import copy
import json
import pathlib
import sys

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools" / "wisdom"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import gate_records  # noqa: E402

from api.services.wisdom.extract import golden, writer  # noqa: E402

import extract_golden_gate as gate  # noqa: E402


def _checked(**kw):
    base = dict(
        fields={}, model_type="call", pre_entity_type="CALL", record_type="CALL", ticker="NVDA",
        quote="taking NVDA long here", q_start=0, q_end=21, author_id="a1", is_guest=False,
        speaker_confidence="high", entity=None, private={}, record_hash="h0", hindsight=False,
        reasons=[], ticker_inferred=False, bar_verdict=None,
    )
    base.update(kw)
    return writer.Checked(**base)


def _fixture():
    """Two segments, five records across four types, and a NULL span on the second.

    ⛔ `expected` and `nulls` are the REAL frozen dataclasses (`golden.Expected`,
    `golden.NullSpan`), not dicts. Using dicts here would have hidden the serialisation bug this
    file exists to catch — `NullSpan.types` is a frozenset and is not JSON.
    """
    items = [
        {"segment": {"segment_id": "seg-a", "text": "taking NVDA long here and I like AMD too",
                     "source_id": "src-1", "source_version": 1},
         "source": {"stream": "zoom_live"},
         "expected": [golden.Expected(gid="g1", record_type="CALL", ticker="NVDA", stance="long",
                                      direction=None, statement=None, quote="taking NVDA long here")],
         "nulls": (), "gids": ["g1"]},
        {"segment": {"segment_id": "seg-b", "text": "size down when the tape is choppy",
                     "source_id": "src-1", "source_version": 1},
         "source": {"stream": "zoom_live"},
         "expected": [golden.Expected(gid="g2", record_type="PRINCIPLE", ticker=None, stance=None,
                                      direction=None, statement="Size down when the tape is choppy.",
                                      quote="size down when the tape is choppy")],
         "nulls": (golden.NullSpan(gid="g3", quote="the tape is choppy",
                                   types=frozenset({"CALL", "LEVEL"})),),
         "gids": ["g2", "g3"]},
    ]
    results = [
        {"cost": 0.01, "effort": "high", "counts": {"kept": 3},
         "kept": [
             _checked(record_hash="h1"),
             _checked(record_hash="h2", record_type="MENTION", pre_entity_type="MENTION", ticker="AMD",
                      quote="I like AMD too", q_start=26, q_end=40),
             _checked(record_hash="h3", record_type="MARKET_SIGNAL", pre_entity_type="MARKET_SIGNAL",
                      ticker=None, quote="choppy tape", q_start=0, q_end=11,
                      fields={"market_signal": {"name": "choppy tape"}}),
         ],
         gate_records.RAW_KEY: {"records": [{"record_type": "CALL", "ticker": "NVDA"}]}},
        {"cost": 0.02, "effort": "high", "counts": {"kept": 2},
         "kept": [
             _checked(record_hash="h4", record_type="PRINCIPLE", pre_entity_type="PRINCIPLE", ticker=None,
                      quote="size down when the tape is choppy", q_start=0, q_end=33,
                      fields={"principle": {"statement": "Size down when the tape is choppy."}}),
             _checked(record_hash="h5", record_type="LEVEL", pre_entity_type="LEVEL", ticker="NVDA",
                      quote="choppy", q_start=22, q_end=28),
         ],
         gate_records.RAW_KEY: {"records": [{"record_type": "PRINCIPLE"}]}},
    ]
    return items, results


KW = dict(extractor_version="wx-v0-deadbeef", model="claude-opus-5", effort="high", transport="stream")


# ── property 1: persistence does not touch scoring ───────────────────────────

def test_aggregates_are_byte_identical_with_persistence_on_and_off(tmp_path):
    items, with_persist = _fixture()
    _, without_persist = _fixture()

    # OFF: the raw key is what a `--no-persist-records` run would never have set
    for r in without_persist:
        r.pop(gate_records.RAW_KEY, None)
    off_scores = gate.segment_scores(items, without_persist)
    off_metrics = golden.score(list(off_scores.values()))
    off_summary = gate.summarise(without_persist)
    off_keys = gate.keys_by_segment(items, without_persist)

    # ON
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=with_persist, **KW)
    on_scores = gate.segment_scores(items, with_persist)
    on_metrics = golden.score(list(on_scores.values()))
    on_summary = gate.summarise(with_persist)
    on_keys = gate.keys_by_segment(items, with_persist)

    dumps = lambda o: json.dumps(o, sort_keys=True, default=str)  # noqa: E731
    assert dumps(on_scores) == dumps(off_scores)
    assert dumps(on_metrics) == dumps(off_metrics)
    assert dumps(on_summary) == dumps(off_summary)
    assert dumps(on_keys) == dumps(off_keys), "R12 3d: the keys-*.json format must be unchanged"


def test_the_byte_identical_check_can_actually_fail(tmp_path):
    """⛔ Non-vacuity control. A comparison that cannot distinguish proves nothing.

    Without this, `test_aggregates_are_byte_identical...` would pass just as happily if
    `segment_scores` returned a constant.
    """
    items, results = _fixture()
    baseline = json.dumps(gate.segment_scores(items, results), sort_keys=True, default=str)
    tampered = copy.deepcopy(results)
    tampered[0]["kept"] = tampered[0]["kept"][:1]
    assert json.dumps(gate.segment_scores(items, tampered), sort_keys=True, default=str) != baseline


def test_persist_strips_its_own_key_so_nothing_downstream_can_see_the_raw_output(tmp_path):
    """⚠️ NOT what keeps the aggregates identical — mutation-proved 2026-09-14: deleting the
    strip leaves every aggregate byte-identical and fails only this test. It is here because the
    raw outputs are the bulkiest thing in a run and because a future consumer that serialises a
    result wholesale would otherwise pick up transcript text it never asked for.
    """
    items, results = _fixture()
    assert any(gate_records.RAW_KEY in r for r in results), "control: the fixture must carry raw output"
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)
    assert not any(gate_records.RAW_KEY in r for r in results)


def test_the_raw_output_actually_reached_disk_before_being_stripped(tmp_path):
    """Non-vacuity: stripping would also 'pass' if persistence had written nothing."""
    items, results = _fixture()
    got = gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)
    assert got["raw_outputs"] == 2
    segs = [json.loads(l) for l in (tmp_path / "R1" / gate_records.SEGMENTS_FILE).read_text().splitlines() if l.strip()]
    assert [s["raw_output"] for s in segs] == [{"records": [{"record_type": "CALL", "ticker": "NVDA"}]},
                                               {"records": [{"record_type": "PRINCIPLE"}]}]


# ── property 2: a persisted run re-scores offline ────────────────────────────

def test_a_persisted_run_rescores_to_the_same_per_type(tmp_path):
    items, results = _fixture()
    live_metrics = golden.score(list(gate.segment_scores(items, copy.deepcopy(results)).values()))
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)

    back_items, back_results = gate_records.load_phase(tmp_path, "R1", "gate")
    replay_metrics = golden.score(list(gate.segment_scores(back_items, back_results).values()))

    assert replay_metrics["per_type"] == live_metrics["per_type"]
    assert replay_metrics["n_expected"] == live_metrics["n_expected"]
    assert replay_metrics["unscored_predictions"] == live_metrics["unscored_predictions"]


def test_the_replay_is_self_contained_needing_no_golden_file_and_no_samples(tmp_path):
    """⭐ The run directory alone must be enough — the golden file may have moved on."""
    items, results = _fixture()
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)
    back_items, _ = gate_records.load_phase(tmp_path, "R1", "gate")
    assert [i["segment"]["text"] for i in back_items] == [i["segment"]["text"] for i in items]
    # ⛔ equality of the DATACLASSES, not of their reprs — a frozen dataclass compares by value,
    # so this is what proves the round trip is lossless rather than merely string-equal.
    assert [i["expected"] for i in back_items] == [i["expected"] for i in items]
    assert [tuple(i["nulls"]) for i in back_items] == [tuple(i["nulls"]) for i in items]
    assert all(isinstance(e, golden.Expected) for i in back_items for e in i["expected"])
    assert all(isinstance(n.types, frozenset) for i in back_items for n in i["nulls"])
    only = {p.name for p in (tmp_path / "R1").iterdir()}
    assert only == {gate_records.RECORDS_FILE, gate_records.SEGMENTS_FILE, gate_records.MANIFEST_FILE}


def test_reconstructed_records_are_equal_to_the_originals(tmp_path):
    """A re-score that reproduced the numbers off DIFFERENT objects would be luck, not proof."""
    items, results = _fixture()
    original = [list(r["kept"]) for r in copy.deepcopy(results)]
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)
    _, back = gate_records.load_phase(tmp_path, "R1", "gate")
    for was, now in zip(original, [r["kept"] for r in back]):
        assert was == now


# ── identity ─────────────────────────────────────────────────────────────────

def test_every_record_carries_the_identity_the_ruling_named(tmp_path):
    items, results = _fixture()
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)
    rows = [json.loads(l) for l in (tmp_path / "R1" / gate_records.RECORDS_FILE).read_text().splitlines() if l.strip()]
    assert len(rows) == 5
    for row in rows:
        assert row["record_id"] and row["record_type"] and row["segment_id"]
        assert row["extractor_version"] == KW["extractor_version"]
        assert row["run_id"] == "R1"
        assert isinstance(row["q_start"], int) and isinstance(row["q_end"], int)
        assert row["quote"]
    by_type = {r["record_type"]: r for r in rows}
    # PRINCIPLE gets the cross-segment key; MARKET_SIGNAL has no id anywhere, so it gets its tuple
    assert by_type["PRINCIPLE"]["principle_key"].startswith("p_")
    assert by_type["MARKET_SIGNAL"]["market_signal_key"][0] == "MARKET_SIGNAL"
    assert by_type["CALL"]["principle_key"] is None and by_type["CALL"]["market_signal_key"] is None


def test_record_id_matches_the_writers_own_definition(tmp_path):
    """⛔ One authority. If these ever diverge, a persisted run stops joining to wisdom_records."""
    items, results = _fixture()
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)
    rows = [json.loads(l) for l in (tmp_path / "R1" / gate_records.RECORDS_FILE).read_text().splitlines() if l.strip()]
    for row in rows:
        assert row["record_id"] == writer.record_id_for(row["segment_id"], KW["extractor_version"], row["record_hash"])


def test_principle_key_matches_the_writers_own_definition():
    assert writer.principle_key_for("a1", "Size down.") == writer.principle_key_for("a1", "Size down.")
    assert writer.principle_key_for("a1", "Size down.") != writer.principle_key_for("a2", "Size down.")
    assert writer.principle_key_for("a1", "Size down.").startswith("p_")


# ── phases stay separate ─────────────────────────────────────────────────────

def test_two_phases_share_a_run_directory_without_mixing(tmp_path):
    items, results = _fixture()
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)
    items2, results2 = _fixture()
    gate_records.persist_phase(tmp_path, run_id="R1", phase="drift", items=items2, results=results2, **KW)

    g_items, g_res = gate_records.load_phase(tmp_path, "R1", "gate")
    d_items, d_res = gate_records.load_phase(tmp_path, "R1", "drift")
    assert len(g_items) == len(d_items) == 2
    assert sum(len(r["kept"]) for r in g_res) == sum(len(r["kept"]) for r in d_res) == 5

    manifest = json.loads((tmp_path / "R1" / gate_records.MANIFEST_FILE).read_text())
    assert set(manifest["phases"]) == {"gate", "drift"}
    assert manifest["phases"]["gate"]["records"] == 5
    assert manifest["run_id"] == "R1"


def test_note_manifest_folds_in_the_eval_run_id(tmp_path):
    items, results = _fixture()
    gate_records.persist_phase(tmp_path, run_id="R1", phase="gate", items=items, results=results, **KW)
    gate_records.note_manifest(tmp_path, "R1", eval_run_id="ev-123", gate_decision="accept")
    manifest = json.loads((tmp_path / "R1" / gate_records.MANIFEST_FILE).read_text())
    assert manifest["eval_run_id"] == "ev-123" and manifest["gate_decision"] == "accept"
    assert manifest["phases"]["gate"]["records"] == 5, "folding in must not clobber the phases"


def test_note_manifest_on_a_run_that_was_never_persisted_is_a_no_op(tmp_path):
    gate_records.note_manifest(tmp_path, "nope", eval_run_id="ev-1")
    assert not (tmp_path / "nope").exists()


# ── the gate tool's wiring ───────────────────────────────────────────────────

def test_validate_into_keeps_the_raw_output_only_when_asked():
    item = {"segment": {"segment_id": "s", "text": "t"}, "source": {"stream": "zoom_live"}}
    payload = {"records": []}

    kept = gate.validate_into({"output": dict(payload)}, item, set(), keep_raw=True)
    assert kept[gate_records.RAW_KEY] == payload
    assert "output" not in kept, "the key must MOVE, not be duplicated"

    dropped = gate.validate_into({"output": dict(payload)}, item, set())
    assert gate_records.RAW_KEY not in dropped and "output" not in dropped


@pytest.mark.parametrize("phase", ["gate", "drift", "trial"])
def test_every_api_phase_persists(phase):
    """⛔ A phase that ran and kept nothing is the exact defect R12 closes."""
    src = (TOOLS / "extract_golden_gate.py").read_text(encoding="utf-8")
    call = f'phase="{phase}", **phase_kw' if phase != "trial" else f'phase="{phase}", **phase_kw'
    assert call in src, f"control: the {phase} phase must still call run_phase"
    body = src.split(call, 1)[1][:1400]
    assert "gate_records.persist_phase" in body, f"{phase} runs an API phase and persists nothing"


def test_persistence_is_on_by_default_and_the_opt_out_is_explicit():
    src = (TOOLS / "extract_golden_gate.py").read_text(encoding="utf-8")
    assert '"--no-persist-records", dest="persist_records", action="store_false", default=True' in src
