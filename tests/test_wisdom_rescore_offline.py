"""R12 step 4d — the offline re-scorer reproduces a phase's receipt, and CAN fail.

⭐ WHY THIS RAIL EXISTS. `tools/wisdom/rescore_offline.py` is the gate between pass 1 and pass 2:
it re-derives a paid pass's numbers from the persisted records for $0.00 and refuses the next
purchase if they disagree. An instrument like that is worthless unless it has been SEEN to fail —
a comparison that silently compares nothing passes vacuously and reads exactly like agreement
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

So this builds a small phase end to end — persist, score, write the receipt the gate would write —
then asserts three things that fail for three different reasons:

  * MATCH over a NON-EMPTY population (the vacuity control: fields compared > 0, segments > 0);
  * MISMATCH the moment one persisted record is removed;
  * INCONCLUSIVE, never MATCH, when there is nothing to compare.

⛔ Every number here is synthetic and no API key, golden file or network call is involved.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load(name: str, relpath: str):
    spec = importlib.util.spec_from_file_location(name, REPO / relpath)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gate_records = _load("_gr_under_test", "tools/wisdom/gate_records.py")
gate = _load("_gate_under_test", "tools/wisdom/extract_golden_gate.py")
rescore = _load("_rescore_under_test", "tools/wisdom/rescore_offline.py")

VERSION, MODEL, EFFORT, TRANSPORT = "wx-v0-testtest", "claude-opus-5", "high", "batch"
TEXT = "I am long NVDA here and I would stop out below the low."


def _checked(**over):
    from api.services.wisdom.extract import writer

    # ⛔ `stance` lives in `fields`, NOT as an attribute — `match_segment` compares
    # `p.fields.get("stance")` to the expectation's, so a fixture with `fields={}` matches
    # nothing and scores tp=0 while still looking like a populated phase. The vacuity control
    # below is what caught exactly that.
    base = dict(fields={"stance": "long"}, model_type="CALL", pre_entity_type="CALL",
                record_type="CALL", ticker="NVDA", quote="I am long NVDA here", q_start=0, q_end=19,
                author_id="a1", is_guest=False, speaker_confidence=1.0, entity=None,
                private=False, record_hash="h-nvda", hindsight=False, reasons=(),
                ticker_inferred=False, bar_verdict=None)
    base.update(over)
    return writer.Checked(**base)


def _phase(tmp_path: pathlib.Path):
    """Build one segment carrying a true positive and a false positive, plus one missed expectation."""
    from api.services.wisdom.extract import golden

    items = [{
        "segment": {"segment_id": "seg-1", "text": TEXT, "source_id": "src-1", "source_version": 1},
        "source": {"stream": "zoom"},
        "expected": [
            golden.Expected(gid="g1", record_type="CALL", ticker="NVDA", stance="long",
                            direction=None, statement=None, quote="I am long NVDA here"),
            # never predicted -> a false negative, so the comparison has a non-zero fn to move
            golden.Expected(gid="g2", record_type="LEVEL", ticker="NVDA", stance=None,
                            direction=None, statement=None, quote="stop out below the low"),
        ],
        "nulls": (),
        "gids": ["g1", "g2"],
    }]
    results = [{
        "kept": [
            _checked(),                                             # matches g1
            _checked(ticker="AMD", quote="would stop out below", q_start=26, q_end=46,
                     record_hash="h-amd"),                          # unexpected -> false positive
        ],
        "cost": 0.0, "effort": EFFORT, "error": None, "counts": {},
    }]
    root = tmp_path / "gate-runs"
    gate_records.persist_phase(root, run_id="run-a", phase="gate", items=items, results=results,
                               extractor_version=VERSION, model=MODEL, effort=EFFORT,
                               transport=TRANSPORT)
    gate_records.note_manifest(root, "run-a", eval_run_id="eval-42", gate_decision="PASS")

    # the receipt the gate itself would write, from the SAME scoring path
    metrics = golden.score(list(gate.segment_scores(items, results).values()))
    receipt = {"kind": "wisdom_extract_eval", "run_id": "eval-42", "extractor_version": VERSION,
               "model": MODEL, "effort": EFFORT, "golden_version": "v1.1-test",
               "golden_sha256": "0" * 64, "split": "dev",
               "per_type": {k: {"tp": v["tp"], "fp": v["fp"], "fn": v["fn"],
                                "fp_null": v.get("fp_null", 0),
                                "null_segments": v.get("null_segments", 0)}
                            for k, v in metrics["per_type"].items()},
               "cost_usd": 0.0, "created_at": "2026-09-15T00:00:00Z"}
    rp = tmp_path / "receipt.json"
    rp.write_text(json.dumps(receipt), encoding="utf-8")
    return root, rp, metrics


def _run(argv, capsys):
    old = sys.argv
    sys.argv = ["rescore_offline.py", *argv]
    try:
        rc = rescore.main()
    finally:
        sys.argv = old
    return rc, capsys.readouterr().out


def test_a_persisted_phase_reproduces_its_own_receipt(tmp_path, capsys):
    root, rp, _ = _phase(tmp_path)
    rc, out = _run(["--gate-runs-root", str(root), "--receipt", str(rp)], capsys)
    assert rc == rescore.MATCH, out
    assert "MATCH" in out


def test_the_match_is_not_vacuous(tmp_path, capsys):
    """⛔ THE CONTROL. A comparison over an empty population passes and reads as agreement."""
    root, rp, metrics = _phase(tmp_path)
    _, out = _run(["--gate-runs-root", str(root), "--receipt", str(rp)], capsys)
    assert "1 segments, 2 records" in out, out
    compared = int(out.split("compared ")[1].split(" field")[0])
    assert compared == len(rescore.RECEIPT_FIELDS) * len(metrics["per_type"]) > 0
    # and the population it scored was not all-zero: this phase has a real tp, fp and fn
    per_type = metrics["per_type"]
    assert sum(v["tp"] for v in per_type.values()) > 0
    assert sum(v["fp"] for v in per_type.values()) > 0
    assert sum(v["fn"] for v in per_type.values()) > 0


def test_dropping_one_persisted_record_is_caught(tmp_path, capsys):
    root, rp, _ = _phase(tmp_path)
    recs = root / "run-a" / gate_records.RECORDS_FILE
    lines = [l for l in recs.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 2
    recs.write_text(lines[0] + "\n", encoding="utf-8", newline="\n")

    rc, out = _run(["--gate-runs-root", str(root), "--receipt", str(rp)], capsys)
    assert rc == rescore.MISMATCH, out
    assert "MISMATCH" in out


def test_the_self_check_proves_the_comparison_can_fail(tmp_path, capsys):
    root, rp, _ = _phase(tmp_path)
    rc, out = _run(["--gate-runs-root", str(root), "--receipt", str(rp), "--self-check"], capsys)
    assert rc == rescore.MATCH, out
    assert "SELF-CHECK PASSED" in out, out


def test_an_empty_phase_is_inconclusive_never_a_match(tmp_path, capsys):
    """⛔ 'I could not look' and 'they agree' are different facts."""
    root, rp, _ = _phase(tmp_path)
    (root / "run-a" / gate_records.RECORDS_FILE).write_text("", encoding="utf-8")
    rc, out = _run(["--gate-runs-root", str(root), "--receipt", str(rp)], capsys)
    assert rc == rescore.INCONCLUSIVE, out
    assert "MATCH" not in out.replace("INCONCLUSIVE", "")


def test_a_missing_run_is_inconclusive(tmp_path, capsys):
    rc, _ = _run(["--gate-runs-root", str(tmp_path / "nope"), "--run-id", "absent"], capsys)
    assert rc == rescore.INCONCLUSIVE


def test_an_unchecked_receipt_field_is_reported_not_skipped(tmp_path, capsys):
    """A field added to the receipt and not to RECEIPT_FIELDS must not pass unchecked forever."""
    root, rp, _ = _phase(tmp_path)
    receipt = json.loads(rp.read_text(encoding="utf-8"))
    first = sorted(receipt["per_type"])[0]
    receipt["per_type"][first]["tp_lenient"] = 99
    rp.write_text(json.dumps(receipt), encoding="utf-8")
    rc, out = _run(["--gate-runs-root", str(root), "--receipt", str(rp)], capsys)
    assert rc == rescore.MISMATCH
    assert "UNCHECKED FIELD" in out, out


def test_the_receipt_field_list_matches_what_the_gate_writes():
    """⛔ Derived, never re-typed: the gate's receipt literal is the authority."""
    src = (REPO / "tools" / "wisdom" / "extract_golden_gate.py").read_text(encoding="utf-8")
    block = src.split('"per_type": {k: {', 1)[1].split("for k, v in metrics", 1)[0]
    import re

    written = set(re.findall(r'"([a-z_]+)":', block))
    assert written, "could not read the gate's receipt literal — this check is vacuous"
    assert written == set(rescore.RECEIPT_FIELDS), (
        f"the gate writes {sorted(written)} but the re-scorer compares {sorted(rescore.RECEIPT_FIELDS)}")


@pytest.mark.parametrize("code,name", [(0, "MATCH"), (1, "MISMATCH"), (2, "INCONCLUSIVE")])
def test_the_three_exit_codes_are_distinct(code, name):
    assert getattr(rescore, name) == code
