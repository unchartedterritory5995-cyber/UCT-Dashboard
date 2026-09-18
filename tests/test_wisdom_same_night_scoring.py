"""R70 — when a night's passes are all reaped, that night is scored THAT night.

⛔⛔ WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR, and each of them is a way to build this and
have every other test stay green:

1. **A trigger on ARRIVAL rather than COMPLETION.** Scoring after 2 of 3 passes is not an early
   answer, it is a wrong one: `reconcile` compares SEGMENT SETS and would either refuse or score
   tonight's two passes beside last night's third. `test_two_of_three_passes_reaped_triggers_nothing`.
2. **A trigger that fires EVERY tick.** The reap runs at :16 and :46 forever; a night that is
   re-scored hourly churns the review queue and buries the one run that mattered.
   `test_a_later_reap_tick_for_the_same_night_triggers_nothing`.
3. **A trigger that cannot fire at all.** Both tests above pass vacuously against a rider that
   does nothing, which is why the CONTROL below is not optional.
4. **A rider that can fail its host.** A reconciliation that raises must cost a scoring cycle,
   never a tick's reaped batches — reap's contract is to advance them.
5. **A second scoring path.** The triggered path must call the chain's OWN two functions in the
   chain's own order; a copy of either one drifts, and the drift is silent because both spellings
   produce numbers.

⭐ The chain's two targets are READ OFF `chain.DAILY` here, never typed, so a step renamed or
reordered there fails this file by name instead of leaving two orders in the repo.
"""
from __future__ import annotations

import importlib
import json
import pathlib
import subprocess
import sys
from types import SimpleNamespace as NS

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services.wisdom import registry  # noqa: E402
from api.services.wisdom.core import flags, store, timeutil  # noqa: E402
from api.services.wisdom.extract import batch, jobs as extract_jobs, same_night  # noqa: E402
from api.services.wisdom.extract import reconcile  # noqa: E402
from api.services.wisdom.publish import chain, floor  # noqa: E402

# ⛔ ONE fixture shape for a persisted run, and it is not this file's. `_row`/`_write_run` are the
# shape `tools/wisdom/gate_records.record_rows` writes and `reconcile.load_run` reads; a second
# hand-built shape here would be a fixture that agrees with nothing.
from tests.test_wisdom_extract_reconcile import VERSION, _row, _write_run  # noqa: E402

NIGHT = "20260917T184703Z"
OTHER_NIGHT = "20260916T184703Z"


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_GATE_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("WISDOM_EXTRACT_PASSES", "3")
    monkeypatch.delenv("WISDOM_EXTRACT_BUDGET_USD", raising=False)
    monkeypatch.delenv("WISDOM_EXTRACT_DAILY_BUDGET_USD", raising=False)
    pages: list = []
    monkeypatch.setattr(batch, "_page", lambda *a, **k: None)
    monkeypatch.setattr(registry, "_page", lambda key, *a, **k: pages.append(key))
    store.init_db()
    return NS(tmp=tmp_path, root=tmp_path / "runs", pages=pages)


def ctx(dry_run=False, job_id="wisdom_extract_reap", due_key=None):
    return registry.JobContext(job_id=job_id, now_et=timeutil.now_et(), due_key=due_key,
                               force=False, dry_run=dry_run, run_id="run-test")


# ── the ledger: what a night looks like in wisdom_extract_requests ────────────

def add_request(*, run_id, pass_index, status, segment_id="seg-1", purpose="extract", custom_id=None):
    custom_id = custom_id or f"wx_{run_id}_{pass_index}_{segment_id}"
    now = timeutil.iso_et(timeutil.now_et())
    with store.write() as conn:
        conn.execute(
            "INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, segment_ids_json, "
            "extractor_version, attempt, status, segment_id, purpose, model, created_at, updated_at, "
            "pass_index, run_id) VALUES (?, 'src1', 1, '[]', ?, 1, ?, ?, ?, 'm', ?, ?, ?, ?)",
            (custom_id, VERSION, status, segment_id, purpose, now, now, pass_index, run_id))
    return custom_id


def night_rows(night, statuses):
    """One request per pass; `statuses[i]` is pass i+1's request status."""
    for index, status in enumerate(statuses, start=1):
        add_request(run_id=f"{night}-chain-p{index}", pass_index=index, status=status)


def set_status(custom_id, status):
    with store.write() as conn:
        conn.execute("UPDATE wisdom_extract_requests SET status = ? WHERE custom_id = ?",
                     (status, custom_id))


def spy_scoring(monkeypatch):
    """Record every call to the two functions the triggered path runs, in order."""
    calls: list = []
    monkeypatch.setattr(reconcile, "score_silently",
                        lambda c, **kw: calls.append("reconcile") or {"n": 3, "keys": 0})
    monkeypatch.setattr(floor, "score_silently",
                        lambda c: calls.append("floor") or {"blocked": 0, "enqueued": 0})
    return calls


def reap(client=None):
    """Drive the REAL reap. With no open batch it takes the idle branch — which still scores,
    deliberately, so a failed scoring can be retried on a later tick."""
    return batch.reap(ctx(), client=client or NS())


# ── 1. the night key is the product's, not this file's ───────────────────────

def test_the_night_is_derived_from_the_run_ids_run_daily_ACTUALLY_mints(env, monkeypatch):
    """⛔ DERIVED, NEVER TYPED. `NIGHT` above is a fixture; this proves the parser matches the ids
    `batch.run_daily` really writes, so a change to the id format fails here rather than making
    every night silently unparseable and unscored."""
    from tests.test_wisdom_extract_batch import FakeClient
    from api.services.wisdom.extract import segmenter

    monkeypatch.setattr(batch, "segment_pending_sources", lambda **kw: {"segmented": 0})
    monkeypatch.setattr(batch.golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g", "reason": None})
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "published_at_et, ingest_version, ingested_at) VALUES ('src1','sunday_scans','t:1',1,'x',"
                     "'2026-09-06T08:00:00-04:00','t','2026-09-06T09:00:00-04:00')")
        text = "Watching TTTT over 55 now."
        segmenter.write_segments(conn, "src1", 1, [segmenter.Segment(
            ordinal=0, kind="section", text=text, char_start=0, char_end=len(text),
            path="INTRO", author_id="tsdr", speaker_confidence="medium")])

    batch.run_daily(ctx(job_id="wisdom_daily_chain"), client=FakeClient())
    with store.read() as conn:
        run_ids = sorted({r[0] for r in conn.execute(
            "SELECT run_id FROM wisdom_extract_requests WHERE run_id IS NOT NULL")})
    assert len(run_ids) == 3, f"the fixture did not submit three passes: {run_ids}"
    nights = {same_night.night_of(r) for r in run_ids}
    assert None not in nights, f"run_daily mints ids this parser cannot read: {run_ids}"
    assert len(nights) == 1, f"the three passes of one night did not share a night: {nights}"


def test_a_run_id_of_an_unknown_shape_is_counted_rather_than_guessed_at(env):
    """⛔ An id this module was not written for must be VISIBLE, not silently unscored."""
    add_request(run_id="some-other-shape", pass_index=1, status="done")
    with store.read() as conn:
        found = same_night.scan(conn)
    assert found["nights"] == {} and found["unparsed_run_ids"] == ["some-other-shape"]
    assert same_night.score_completed_nights(ctx())["unparsed_run_ids"] == ["some-other-shape"]


# ── 2. completion, not arrival ───────────────────────────────────────────────

def test_two_of_three_passes_reaped_triggers_nothing(env, monkeypatch):
    calls = spy_scoring(monkeypatch)
    night_rows(NIGHT, ["done", "done", "submitted"])
    out = reap()
    assert calls == [], "scoring ran on a night whose third pass had not been reaped"
    assert out["same_night"]["complete"] == 0 and out["same_night"]["incomplete"] == 1
    assert out["same_night"]["scored"] == []


def test_CONTROL_the_third_pass_completing_DOES_trigger_the_scoring(env, monkeypatch):
    """⭐ THE CONTROL. Without it every "triggers nothing" test above passes against a rider that
    can never fire — which is the same rail, with the product deleted."""
    calls = spy_scoring(monkeypatch)
    night_rows(NIGHT, ["done", "done", "submitted"])
    assert reap()["same_night"]["scored"] == [] and calls == []

    set_status(f"wx_{NIGHT}-chain-p3_3_seg-1", "done")
    out = reap()
    assert calls == ["reconcile", "floor"], calls
    assert [s["night"] for s in out["same_night"]["scored"]] == [NIGHT]
    assert out["same_night"]["scored"][0]["status"] == "ok"


def test_a_failed_pass_still_completes_the_night_but_a_retry_does_not(env, monkeypatch):
    """⛔ `failed` is terminal and `retry` is not: a retry rides a LATER night's pass 1 under its
    ORIGINAL run id, so its night has records still to come."""
    calls = spy_scoring(monkeypatch)
    night_rows(NIGHT, ["done", "failed", "retry"])
    assert reap()["same_night"]["complete"] == 0 and calls == []
    set_status(f"wx_{NIGHT}-chain-p3_3_seg-1", "failed")
    assert reap()["same_night"]["complete"] == 1 and calls == ["reconcile", "floor"]


def test_one_nights_completion_does_not_score_another_nights_open_passes(env, monkeypatch):
    calls = spy_scoring(monkeypatch)
    night_rows(NIGHT, ["done", "done", "done"])
    night_rows(OTHER_NIGHT, ["done", "submitted", "submitted"])
    out = reap()
    assert [s["night"] for s in out["same_night"]["scored"]] == [NIGHT]
    assert out["same_night"]["incomplete"] == 1
    assert calls == ["reconcile", "floor"]


# ── 3. idempotence ───────────────────────────────────────────────────────────

def test_a_later_reap_tick_for_the_same_night_triggers_nothing(env, monkeypatch):
    calls = spy_scoring(monkeypatch)
    night_rows(NIGHT, ["done", "done", "done"])
    assert len(reap()["same_night"]["scored"]) == 1
    assert calls == ["reconcile", "floor"]

    second = reap()
    assert second["same_night"]["scored"] == [], "the same night was scored twice"
    assert second["same_night"]["already_scored"] == 1
    assert calls == ["reconcile", "floor"], f"the second tick re-ran the scoring: {calls}"


def test_the_idempotence_marker_is_a_job_claim_row_and_the_run_is_visible(env, monkeypatch):
    """⛔ THE MARKER IS `wisdom_job_claims`, the existing durable (job, slot) idiom, and the run
    is in `wisdom_job_runs` WITH ITS OUTCOME — a morning check reads one place, not a new one."""
    spy_scoring(monkeypatch)
    night_rows(NIGHT, ["done", "done", "done"])
    reap()
    with store.read() as conn:
        claims = [dict(r) for r in conn.execute(
            "SELECT job_id, due_key, status, finished_at FROM wisdom_job_claims")]
        runs = [dict(r) for r in conn.execute(
            "SELECT job_id, due_key, status, result_json FROM wisdom_job_runs")]
    assert claims == [{"job_id": same_night.JOB_ID, "due_key": NIGHT, "status": "ok",
                       "finished_at": claims[0]["finished_at"]}]
    assert claims[0]["finished_at"], "the claim was left open"
    assert len(runs) == 1 and runs[0]["job_id"] == same_night.JOB_ID and runs[0]["due_key"] == NIGHT
    assert runs[0]["status"] == "ok"
    result = json.loads(runs[0]["result_json"])
    assert result["night"] == NIGHT and "reconcile" in result and "floor" in result


def test_the_CLAIM_not_the_prefilter_is_what_makes_it_idempotent(env, monkeypatch):
    """⛔ MUTATION, IN THE FILE. `_already_scored` is an optimisation; disabling it must change
    nothing about idempotence, because the guard is the claim row. If this ever goes red the
    comment on `_already_scored` has become a lie and the real guard has been deleted."""
    calls = spy_scoring(monkeypatch)
    monkeypatch.setattr(same_night, "_already_scored", lambda conn, nights: set())
    night_rows(NIGHT, ["done", "done", "done"])
    assert reap()["same_night"]["scored"][0]["status"] == "ok"
    second = reap()["same_night"]["scored"]
    assert [s["status"] for s in second] == ["skipped"], second
    assert "already done" in second[0]["reason"]
    assert calls == ["reconcile", "floor"], f"the claim did not stop the second run: {calls}"


def test_a_scoring_that_FAILED_is_retried_on_a_later_tick(env, monkeypatch):
    """⭐ The other half of idempotence: `ok` is final, `failed` is not. A transient failure must
    not cost the night permanently."""
    attempts: list = []

    def flaky(c, **kw):
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("transient")
        return {"n": 3}

    monkeypatch.setattr(reconcile, "score_silently", flaky)
    monkeypatch.setattr(floor, "score_silently", lambda c: {"blocked": 0})
    night_rows(NIGHT, ["done", "done", "done"])
    assert reap()["same_night"]["scored"][0]["status"] == "failed"
    assert reap()["same_night"]["scored"][0]["status"] == "ok"
    assert len(attempts) == 2


# ── 4. the same two functions, in the chain's order ──────────────────────────

def _chain_scoring_steps():
    steps = [s for s in chain.DAILY if s.name in ("reconcile_stability", "publication_floor")]
    assert len(steps) == 2, f"the daily chain no longer carries both scoring steps: {steps}"
    return steps


def test_the_triggered_path_calls_the_chains_OWN_targets_in_the_chains_OWN_order(env, monkeypatch):
    """⛔ Read off `chain.DAILY`, never typed. Two scoring orders in one repo is the defect."""
    calls: list = []
    for step in _chain_scoring_steps():
        module, attr = step.targets[0]
        mod = importlib.import_module(module)
        assert callable(getattr(mod, attr, None)), f"{module}.{attr} does not resolve"
        monkeypatch.setattr(mod, attr, lambda c, _n=step.name, **kw: calls.append(_n) or {})
    same_night.score_night(ctx(due_key=NIGHT))
    assert calls == ["reconcile_stability", "publication_floor"], calls


def test_the_floor_step_still_enqueues_BEFORE_it_retracts(env, monkeypatch):
    """⛔ The order inside `floor.score_silently` is load-bearing — the reverse retracts against
    the previous cycle's rows and re-enqueues the same records, churning the queue. The triggered
    path must not be a second door around it."""
    order: list = []
    monkeypatch.setattr(floor, "enqueue_blocked",
                        lambda conn, **kw: order.append("enqueue") or {"blocked": 0, "enqueued": 0})
    monkeypatch.setattr(floor, "retract_passed",
                        lambda conn, **kw: order.append("retract") or {"retracted": 0})
    monkeypatch.setattr(reconcile, "score_silently", lambda c, **kw: {})
    same_night.score_night(ctx(due_key=NIGHT))
    assert order == ["enqueue", "retract"], order


# ── 5. same outcomes as the chain step would produce ─────────────────────────

def _fixture_runs(root: pathlib.Path):
    """Three passes over one segment set: a PRINCIPLE in 3/3 and a MARKET_SIGNAL in 2/3."""
    stable = _row("seg-1", "PRINCIPLE", ident="size-down", record_id="r_prin")
    signal = _row("seg-1", "MARKET_SIGNAL", ident="breadth-washout", record_id="r_sig")
    other = _row("seg-1", "MARKET_SIGNAL", ident="tape-improving", record_id="r_other")
    _write_run(root, f"{NIGHT}-chain-p1", [stable, signal])
    _write_run(root, f"{NIGHT}-chain-p2", [stable, signal])
    _write_run(root, f"{NIGHT}-chain-p3", [stable, other])


def _fixture_db():
    with store.write() as conn:
        for record_id, rtype in (("r_prin", "PRINCIPLE"), ("r_sig", "MARKET_SIGNAL"),
                                 ("r_other", "MARKET_SIGNAL")):
            conn.execute(
                "INSERT INTO wisdom_records (record_id, record_type, segment_id, source_id, "
                "source_version, extractor_version, record_hash, author_id, extraction_confidence, "
                "created_at) VALUES (?, ?, 'seg-1', 'src1', 1, ?, ?, 'tsdr', 'high', ?)",
                (record_id, rtype, VERSION, record_id, timeutil.iso_et(timeutil.now_et())))
        conn.execute("INSERT INTO wisdom_principles (principle_key, statement, category, author_id) "
                     "VALUES ('p_size-down', 'Size down in a hostile regime', 'risk', 'tsdr')")


def _observable_state():
    with store.read() as conn:
        records = [tuple(r) for r in conn.execute(
            "SELECT record_id, stability, stability_runs FROM wisdom_records ORDER BY record_id")]
        principles = [tuple(r) for r in conn.execute(
            "SELECT principle_key, stability, stability_runs FROM wisdom_principles ORDER BY principle_key")]
        queue = [tuple(r) for r in conn.execute(
            "SELECT subject_ref, summary FROM wisdom_review_queue "
            "WHERE json_extract(new_json, '$.reason') = 'below_publication_floor' ORDER BY subject_ref")]
    return {"records": records, "principles": principles, "queue": queue}


def _sandbox(monkeypatch, tmp_path, name):
    root = tmp_path / name / "runs"
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / name / "wisdom.db"))
    monkeypatch.setenv("WISDOM_GATE_RUNS_DIR", str(root))
    store.init_db()
    _fixture_runs(root)
    _fixture_db()


def test_the_triggered_path_leaves_the_store_EXACTLY_as_the_chain_step_would(env, monkeypatch, tmp_path):
    """⛔⛔ THE BEHAVIOURAL HALF. Two identical stores, one scored by the reap rider and one by
    the daily chain's own two steps — the stability columns and the floor's queue rows must match
    exactly. A second implementation would pass every structural test above and diverge here.
    """
    _sandbox(monkeypatch, tmp_path, "triggered")
    night_rows(NIGHT, ["done", "done", "done"])
    triggered_out = reap()["same_night"]
    triggered = _observable_state()

    _sandbox(monkeypatch, tmp_path, "chained")
    chain_result = chain.run_chain("daily", ctx(job_id="wisdom_daily_chain", due_key="2026-09-17"),
                                   steps=tuple(_chain_scoring_steps()))
    chained = _observable_state()

    assert [s["status"] for s in chain_result["steps"]] == ["ok", "ok"], chain_result["steps"]
    assert triggered["records"], "the fixture scored nothing; this comparison would be vacuous"
    assert any(value is not None for _id, value, _n in triggered["records"])
    assert triggered["queue"], "nothing was blocked; the floor half of this comparison is vacuous"
    assert triggered == chained, (
        "the reap's rider and the daily chain step disagree about the same night:\n"
        f"  triggered={triggered}\n  chained={chained}")
    assert [s["status"] for s in triggered_out["scored"]] == ["ok"]


# ── 6. the rider can never fail its host ─────────────────────────────────────

def _submit_and_end_all_passes(monkeypatch):
    """A real three-pass night, submitted and answered through the fake API."""
    from tests.test_wisdom_extract_batch import FakeClient, output_for, succeeded
    from api.services.wisdom.extract import segmenter

    monkeypatch.setattr(batch, "segment_pending_sources", lambda **kw: {"segmented": 0})
    monkeypatch.setattr(batch.golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g", "reason": None})
    text = "Watching TTTT over 55 now."
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "published_at_et, ingest_version, ingested_at) VALUES ('src1','sunday_scans','t:1',1,'x',"
                     "'2026-09-06T08:00:00-04:00','t','2026-09-06T09:00:00-04:00')")
        segmenter.write_segments(conn, "src1", 1, [segmenter.Segment(
            ordinal=0, kind="section", text=text, char_start=0, char_end=len(text),
            path="INTRO", author_id="tsdr", speaker_confidence="medium")])
    fake = FakeClient()
    batch.run_daily(ctx(job_id="wisdom_daily_chain"), client=fake)
    with store.read() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT custom_id, batch_id FROM wisdom_extract_requests WHERE purpose = 'extract'")]
    for row in rows:
        fake.messages.batches.state[row["batch_id"]] = "ended"
        fake.messages.batches.results_map.setdefault(row["batch_id"], []).append(
            succeeded(row["custom_id"], output_for(text, "MENTION", "TTTT")))
    return fake, [r["custom_id"] for r in rows]


@pytest.mark.parametrize("victim", ["reconcile", "floor"])
def test_a_raising_scoring_step_does_not_fail_the_reap_or_lose_reaped_work(env, monkeypatch, victim):
    """⛔ Reap's contract is to advance batches. Scoring is a rider: it may fail, alone."""
    fake, custom_ids = _submit_and_end_all_passes(monkeypatch)

    def boom(*a, **kw):
        raise RuntimeError("scoring exploded")

    monkeypatch.setattr(reconcile, "score_silently", boom if victim == "reconcile" else
                        (lambda c, **kw: {"n": 3}))
    monkeypatch.setattr(floor, "score_silently", boom if victim == "floor" else (lambda c: {"blocked": 0}))

    out = batch.reap(ctx(), client=fake)
    assert out["status"] == "ok", out
    assert out["same_night"]["scored"][0]["status"] == "failed"
    assert "RuntimeError" in (out["same_night"]["scored"][0]["error"] or "")
    with store.read() as conn:
        statuses = {r[0] for r in conn.execute(
            "SELECT status FROM wisdom_extract_requests WHERE purpose = 'extract'")}
        batches = {r[0] for r in conn.execute("SELECT status FROM wisdom_batches")}
    assert statuses == {"done"}, f"reaped work was lost: {statuses}"
    assert batches == {"reaped"}, batches
    assert f"wisdom_job_failed:{same_night.JOB_ID}" in env.pages, "a failed scoring did not page"


def test_an_exploding_rider_is_reported_and_never_raised(env, monkeypatch):
    """⛔ Even a failure OUTSIDE the scored callable — the scan, the claim, the store — is the
    rider's to absorb. `run_tracked` only catches the callable."""
    monkeypatch.setattr(same_night, "score_completed_nights",
                        lambda ctx, **kw: (_ for _ in ()).throw(OSError("disk full")))
    out = reap()
    assert out["status"] == "idle"
    assert "OSError" in out["same_night"]["error"]


# ── 7. the gates ─────────────────────────────────────────────────────────────

def _executable_source(path: pathlib.Path) -> str:
    """A module's CODE, with comments and docstrings removed.

    ⛔ CODE NEVER PROSE, and this check needs it more than most: `same_night.py`'s own docstrings
    NAME the flag it is asserting the code does not read, so a plain text scan would fail on its
    own explanation — and deleting the explanation would "fix" it.
    """
    import ast

    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if ast.get_docstring(node, clean=False) is not None:
                node.body = node.body[1:]
    return ast.unparse(tree)


def test_the_reap_job_is_gated_by_the_extract_switch_and_there_is_no_second_one(env):
    """⛔ DERIVED from the spec. R70 adds no switch of its own — the rider inherits this one, and
    a second copy of a gate is a guard that cannot be mutation-proved."""
    spec = next(s for s in extract_jobs.JOBS if s.job_id == "wisdom_extract_reap")
    assert spec.enabled is flags.extract_enabled
    code = _executable_source(REPO / "api" / "services" / "wisdom" / "extract" / "same_night.py")
    assert "flags." not in code, "the rider re-reads a flag; the gate has two copies now"
    assert "WISDOM_EXTRACT_ENABLED" not in code
    # ⭐ CONTROLS: the stripper can still see real code, and it really did strip the prose that
    # contains the banned strings.
    assert "def score_completed_nights" in code and "registry.run_tracked" in code
    raw = (REPO / "api" / "services" / "wisdom" / "extract" / "same_night.py").read_text(encoding="utf-8")
    assert "WISDOM_EXTRACT_ENABLED" in raw, "the docstring no longer names the gate it inherits"


def test_nothing_is_scored_while_extract_is_off(env, monkeypatch):
    calls = spy_scoring(monkeypatch)
    night_rows(NIGHT, ["done", "done", "done"])
    monkeypatch.delenv("WISDOM_EXTRACT_ENABLED")
    out = reap()
    assert out["status"] == "skipped" and "same_night" not in out
    assert calls == []
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_job_claims").fetchone()[0] == 0
    # ⭐ control: the same fixture DOES score with the switch back on
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    assert len(reap()["same_night"]["scored"]) == 1 and calls == ["reconcile", "floor"]


def test_a_dry_run_scores_nothing(env, monkeypatch):
    calls = spy_scoring(monkeypatch)
    night_rows(NIGHT, ["done", "done", "done"])
    out = batch.reap(ctx(dry_run=True), client=NS())
    assert out["same_night"] == {"skipped": "dry run"} and calls == []
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_job_runs").fetchone()[0] == 0


# ── 8. it is a rider, not a scheduled job ────────────────────────────────────

def test_it_is_NOT_a_registered_JobSpec_so_a_quiet_night_cannot_page(env):
    """⛔ A JobSpec carries `expected_every_s`, which the watchdog reads — registering this would
    page every weekend, for a night that correctly did not happen."""
    ids = {s.job_id for s in registry.job_specs()}
    assert "wisdom_extract_reap" in ids, "the spec scan found nothing; this proves nothing"
    assert same_night.JOB_ID not in ids


def test_the_night_question_is_indexed_and_the_migration_is_additive(env):
    """⚠️ The scan runs at :16 and :46 forever over a ledger that only grows."""
    from api.services.wisdom.extract import schema

    sql = dict(schema.MIGRATIONS)["extract_004_run_id_index"]
    for banned in ("DROP", "DELETE", "ALTER", "NOT NULL"):
        assert banned not in sql.upper(), f"extract_004 contains {banned}"
    with store.read() as conn:
        indexes = {r["name"] for r in conn.execute("PRAGMA index_list(wisdom_extract_requests)")}
        plan = " ".join(str(r[-1]) for r in conn.execute(
            "EXPLAIN QUERY PLAN SELECT run_id, COUNT(*) FROM wisdom_extract_requests "
            "WHERE run_id IS NOT NULL AND purpose = 'extract' GROUP BY run_id"))
    assert "ix_extract_requests_run" in indexes
    assert "ix_extract_requests_run" in plan, f"the night scan does not use the index: {plan}"


def test_the_backlog_is_bounded_and_the_newest_night_is_never_starved(env, monkeypatch):
    """⭐ Newest first, capped: R70 is about scoring TONIGHT tonight. A backlog drains over the
    following ticks instead of firing a burst of identical reconciliations in one."""
    spy_scoring(monkeypatch)
    nights = [f"2026091{d}T184703Z" for d in range(1, 8)]
    for night in nights:
        night_rows(night, ["done", "done", "done"])
    first = reap()["same_night"]
    assert len(first["scored"]) == same_night.MAX_NIGHTS_PER_TICK
    assert [s["night"] for s in first["scored"]] == sorted(nights, reverse=True)[:4]
    assert first["deferred"] == len(nights) - same_night.MAX_NIGHTS_PER_TICK
    second = reap()["same_night"]
    assert [s["night"] for s in second["scored"]] == sorted(nights, reverse=True)[4:]
    assert reap()["same_night"]["scored"] == []


# ── 9. the rehearsal, in a child process ─────────────────────────────────────

def test_the_whole_path_rehearses_in_a_child_process():
    """⛔ SUBMIT -> PERSIST 3 PASSES -> REAP COMPLETES -> RECONCILE + FLOOR, in one process that
    shares nothing with this one: its own store, its own runs root, its own environment."""
    proc = subprocess.run([sys.executable, "tools/wisdom/same_night_rehearsal.py"],
                          cwd=str(REPO), capture_output=True, text=True, timeout=600)
    assert proc.returncode == 0, f"rehearsal failed:\n{proc.stdout[-4000:]}\n{proc.stderr[-4000:]}"
    report = json.loads(proc.stdout)
    assert report["PASS"] is True, report["verdict"]
    assert report["submit"]["passes"] == 3 and len(report["submit"]["nights"]) == 1
    assert [t["scored"] for t in report["ticks"]] == [[], report["ticks"][1]["scored"], []]
    assert report["ticks"][1]["scored"][0]["status"] == "ok"
    assert [c["status"] for c in report["claims"]] == ["ok"]
    assert {r["stability_runs"] for r in report["records"]} == {3}
