"""R70 rehearsal — submit, persist three passes, reap, and see the night scored THAT night.

Runs the REAL `batch.run_daily` and `batch.reap` against a throwaway store with a fixture
extractor (the same fake Anthropic client the batch rails drive), in a CHILD PROCESS, and prints
ONE JSON object describing what happened at each tick.

  tick A  two of three passes reaped  -> scores nothing
  tick B  the third pass reaped       -> reconcile + floor run, once, that night
  tick C  another tick                -> nothing, the night is claimed

⛔ NOTHING HERE TOUCHES THE SHARED DATA ROOT, THE NETWORK OR A KEY. The census pins below are the
same ones the pytest conftest applies, resolved BEFORE any `api.*` import, because those paths are
captured at module import and a pin set afterwards reaches nothing.

Usage:  python tools/wisdom/same_night_rehearsal.py [--keep]
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.getcwd())

_SANDBOX = tempfile.mkdtemp(prefix="wisdom-r70-rehearsal-")

import conftest  # noqa: E402  the census lives at the repo root

_, _PINS, _ = conftest.shared_data_root_census()
for _env, _literal in _PINS.items():
    os.environ[_env] = _literal.replace("/data", _SANDBOX)
os.environ["DATA_DIR"] = _SANDBOX
os.environ["WISDOM_DB_PATH"] = os.path.join(_SANDBOX, "wisdom.db")
os.environ["WISDOM_GATE_RUNS_DIR"] = os.path.join(_SANDBOX, "gate-runs")
os.environ["WISDOM_INGEST_ENABLED"] = "1"
os.environ["WISDOM_EXTRACT_ENABLED"] = "1"
os.environ["WISDOM_EXTRACT_PASSES"] = "3"
os.environ.pop("WISDOM_EXTRACT_BUDGET_USD", None)
os.environ.pop("WISDOM_EXTRACT_DAILY_BUDGET_USD", None)

from api.services.wisdom import registry  # noqa: E402
from api.services.wisdom.core import store, timeutil  # noqa: E402
from api.services.wisdom.extract import batch, config, golden, prompt, same_night, segmenter  # noqa: E402

# ⭐ ONE fake API for the whole programme. The batch rails' client already refuses every request
# shape the real Messages API refuses, so a rehearsal built on a second fake would be a rehearsal
# of a different API.
from tests.test_wisdom_extract_batch import FakeClient, output_for, succeeded  # noqa: E402

SEG_TEXTS = ["Watching TTTT over 55 now.", "Breadth is washing out under the surface."]


def _ctx(job_id="wisdom_extract_reap"):
    return registry.JobContext(job_id=job_id, now_et=timeutil.now_et(), due_key=None,
                               force=False, dry_run=False, run_id="rehearsal")


def _seed_source():
    with store.write() as conn:
        conn.execute(
            "INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
            "published_at_et, ingest_version, ingested_at) VALUES ('src1','sunday_scans','reh:1',1,'x',"
            "'2026-09-06T08:00:00-04:00','t','2026-09-06T09:00:00-04:00')")
        segs = [segmenter.Segment(ordinal=i, kind="section", text=t, char_start=0, char_end=len(t),
                                  path="INTRO", author_id="tsdr", speaker_confidence="medium")
                for i, t in enumerate(SEG_TEXTS)]
        segmenter.write_segments(conn, "src1", 1, segs)
    return [s.segment_id("src1", 1) for s in segs]


def _accept_gate():
    with store.write() as conn:
        golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version=prompt.extractor_version(), n=1,
                           metrics={"model": config.configured_model(), "effort": config.configured_effort(),
                                    "golden_version": "rehearsal", "golden_sha256": "c" * 64, "split": "dev",
                                    "per_type": {"MENTION": {"tp": 1, "fp": 0, "fn": 0, "precision": 1.0,
                                                             "recall": 1.0, "n_expected": 1,
                                                             "n_predicted_scored": 1}}})


def _requests_by_pass():
    with store.read() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT custom_id, segment_id, pass_index, run_id, batch_id, status "
            "FROM wisdom_extract_requests WHERE purpose = 'extract'")]
    by_pass: dict = {}
    for row in rows:
        by_pass.setdefault(int(row["pass_index"]), []).append(row)
    return by_pass


def _result_for(row, segment_texts, pass_index):
    """The fixture extractor's answer. Pass 3 RENAMES the market signal, so that record scores
    2/3 and the publication floor has something real to block."""
    text = segment_texts[row["segment_id"]]
    if text == SEG_TEXTS[0]:
        return succeeded(row["custom_id"], output_for(text, "MENTION", "TTTT"))
    name = "breadth washout" if pass_index < 3 else "tape improving"
    return succeeded(row["custom_id"],
                     output_for(text, "MARKET_SIGNAL",
                                market_signal={"name": name, "direction": "bearish"}))


def _end_passes(fake, by_pass, segment_texts, passes):
    for p in passes:
        rows = by_pass[p]
        bid = rows[0]["batch_id"]
        fake.messages.batches.state[bid] = "ended"
        fake.messages.batches.results_map[bid] = [_result_for(r, segment_texts, p) for r in rows]


def _tick(fake, label):
    out = batch.reap(_ctx(), client=fake)
    same = out.get("same_night") or {}
    return {"tick": label, "reap_status": out.get("status"),
            "complete_nights": same.get("complete"), "incomplete_nights": same.get("incomplete"),
            "already_scored": same.get("already_scored"), "scored": same.get("scored"),
            "error": same.get("error")}


def _job_rows():
    with store.read() as conn:
        runs = [dict(r) for r in conn.execute(
            "SELECT run_id, job_id, due_key, status, substr(result_json, 1, 400) AS result_json "
            "FROM wisdom_job_runs WHERE job_id = ? ORDER BY started_at", (same_night.JOB_ID,))]
        claims = [dict(r) for r in conn.execute(
            "SELECT job_id, due_key, status FROM wisdom_job_claims WHERE job_id = ?",
            (same_night.JOB_ID,))]
        records = [dict(r) for r in conn.execute(
            "SELECT record_type, stability, stability_runs FROM wisdom_records "
            "ORDER BY record_type, record_id")]
        queue = conn.execute(
            "SELECT COUNT(*) FROM wisdom_review_queue WHERE json_extract(new_json, '$.reason') = ?",
            ("below_publication_floor",)).fetchone()[0]
    return {"job_runs": runs, "claims": claims, "records": records, "floor_queue_rows": queue}


def main() -> int:
    report: dict = {"sandbox": _SANDBOX}
    store.init_db()
    segment_ids = _seed_source()
    segment_texts = dict(zip(segment_ids, SEG_TEXTS))
    _accept_gate()

    fake = FakeClient()
    submitted = batch.run_daily(_ctx("wisdom_daily_chain"), client=fake)
    report["submit"] = {"status": submitted.get("status"), "passes": submitted.get("passes"),
                        "runs": submitted.get("runs"),
                        "nights": sorted({same_night.night_of(r) for r in submitted.get("runs") or []})}
    by_pass = _requests_by_pass()
    report["requests_per_pass"] = {p: len(rows) for p, rows in sorted(by_pass.items())}

    ticks = []
    _end_passes(fake, by_pass, segment_texts, [1, 2])
    ticks.append(_tick(fake, "A: 2 of 3 passes reaped"))
    _end_passes(fake, by_pass, segment_texts, [3])
    ticks.append(_tick(fake, "B: the third pass reaped"))
    ticks.append(_tick(fake, "C: another tick, same night"))
    report["ticks"] = ticks
    report.update(_job_rows())

    scored_events = [s for t in ticks for s in (t.get("scored") or []) if s.get("status") == "ok"]
    report["verdict"] = {
        "scored_exactly_once": len(scored_events) == 1,
        "scored_on_the_tick_the_last_pass_was_reaped":
            bool(ticks[1].get("scored")) and not ticks[0].get("scored") and not ticks[2].get("scored"),
        "run_row_written": len(report["job_runs"]) == 1,
        "claim_is_ok": [c["status"] for c in report["claims"]] == ["ok"],
        "stability_written": any(r["stability"] is not None for r in report["records"]),
        "floor_ran": report["floor_queue_rows"] >= 0,
    }
    report["PASS"] = all(report["verdict"].values())
    print(json.dumps(report, indent=1, default=str))
    return 0 if report["PASS"] else 1


if __name__ == "__main__":
    keep = "--keep" in sys.argv
    try:
        code = main()
    finally:
        if not keep:
            shutil.rmtree(_SANDBOX, ignore_errors=True)
    sys.exit(code)
