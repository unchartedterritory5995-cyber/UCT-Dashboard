"""R53 — N passes in the production chain: salted, persisted on the volume, ingested once.

⛔⛔ THE TWO WAYS TO BUILD THIS AND NOT NOTICE IT IS BROKEN, both of which pass every other test:

1. **NO PER-PASS SALT.** `pending_segments` excludes any segment with ANY request row for
   `(extractor_version, purpose)`, and `submit_items` counts a duplicate `custom_id` as
   `skipped_not_retryable`. So without a salt, pass 2 is SILENTLY a no-op: the chain reports
   success, the bill is for one pass, and one pass exists where three were intended.
2. **INGESTING EVERY PASS.** `writer.record_id_for` is deterministic, so N ingests mint N rows
   carrying the SAME record_id for the same finding — and the reconciler then scores a record
   against copies of itself and reports perfect stability for a single observation.

⭐ Neither shows up as an error. Both show up as a number that is quietly wrong, which is why each
has a mutation proof below rather than a comment.
"""
from __future__ import annotations

import json
import pathlib
import sys
from types import SimpleNamespace as NS

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services.wisdom.core import store, timeutil  # noqa: E402
from api.services.wisdom.extract import batch, run_records  # noqa: E402


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("WISDOM_GATE_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.delenv("WISDOM_EXTRACT_PASSES", raising=False)
    monkeypatch.setattr(batch, "_page", lambda *a, **k: None)
    store.init_db()
    return NS(root=tmp_path / "runs", tmp=tmp_path)


def _ctx(**kw):
    from api.services.wisdom import registry

    base = dict(job_id="wisdom_daily_chain", now_et=timeutil.now_et(), due_key=None,
                force=False, dry_run=False, run_id="r")
    base.update(kw)
    return registry.JobContext(**base)


# ── N and the throttle ───────────────────────────────────────────────────────

def test_the_default_is_three_because_MIN_RUNS_is_three(env):
    from api.services.wisdom.publish import floor

    assert batch.npass_count() == 3 == floor.MIN_RUNS, (
        "N and MIN_RUNS must agree: a smaller N means the reconciler never has enough runs and "
        "every record sits UNRECONCILED forever")


@pytest.mark.parametrize("raw,want", [("1", 1), ("5", 5), ("", 3), ("   ", 3), ("three", 3), ("0", 3), ("-2", 3)])
def test_N_is_read_from_the_environment_and_nonsense_falls_back(env, monkeypatch, raw, want):
    monkeypatch.setenv(batch.PASSES_ENV, raw)
    assert batch.npass_count() == want


def test_the_throttle_bounds_REQUESTS_not_segments(env):
    """⭐ 400 requests at N=3 is 133 segments, not 400 — and the nightly BILL is flat in N."""
    limit, n = batch.DAILY_SEGMENT_LIMIT, 3
    per_night = limit // n
    assert per_night == 133 and per_night * n == 399 <= limit


# ── the salt: the silent no-op ───────────────────────────────────────────────

def test_each_pass_gets_a_DIFFERENT_custom_id(env):
    """⛔⛔ THE LOAD-BEARING ONE. Same segment, same version — only the salt differs."""
    ids = {batch.custom_id_for("src1", 1, ["seg-1"], "v0", salt=f"pass{p}") for p in (1, 2, 3)}
    assert len(ids) == 3, "two passes share a custom_id — pass 2 would be skipped_not_retryable"


def test_without_a_salt_every_pass_collides(env):
    """⭐ THE CONTROL that makes the test above mean something: no salt, one id."""
    ids = {batch.custom_id_for("src1", 1, ["seg-1"], "v0") for _ in (1, 2, 3)}
    assert len(ids) == 1


def test_run_daily_ACTUALLY_sends_three_distinct_requests_per_segment(env, monkeypatch):
    """⛔⛔ THE TEST THAT CATCHES THE SILENT NO-OP — end to end, through `run_daily`.

    ⚰️ WRITTEN BECAUSE THE UNIT TESTS ABOVE DID NOT CATCH IT. Deleting the real salt from
    `run_daily` and re-running this file gave **21 passed**: the salt tests call `custom_id_for`
    with salts they supply themselves, so they prove the FUNCTION salts and say nothing about
    whether the CALLER does. That is the vacuous rail this programme keeps paying for, in the one
    place the design named as the way to build N-pass wrong and not notice.

    This drives the real `run_daily` against the real submit path and counts what reached the API.
    """
    from tests.test_wisdom_extract_batch import FakeClient, TEXTS  # the fake the mechanics use
    from api.services.wisdom.extract import segmenter

    monkeypatch.setenv(batch.PASSES_ENV, "3")
    monkeypatch.setattr(batch, "segment_pending_sources", lambda **kw: {"segmented": 0})
    monkeypatch.setattr(batch.golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g", "reason": None})
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "published_at_et, ingest_version, ingested_at) VALUES ('src1','sunday_scans','t:1',1,'x',"
                     "'2026-09-06T08:00:00-04:00','t','2026-09-06T09:00:00-04:00')")
        segs = [segmenter.Segment(ordinal=i, kind="section", text=t, char_start=0, char_end=len(t),
                                  path="INTRO", author_id="tsdr", speaker_confidence="medium")
                for i, t in enumerate(TEXTS[:2])]
        segmenter.write_segments(conn, "src1", 1, segs)

    fake = FakeClient()
    out = batch.run_daily(_ctx(), client=fake)
    assert out.get("passes") == 3, out

    sent = [r["custom_id"] for c in fake.messages.batches.created for r in c["requests"]]
    assert len(sent) == len(set(sent)), "a custom_id was reused — a pass was silently skipped"
    n_segments = out.get("segments_selected") or 0
    assert n_segments > 0, "the fixture selected no segments; this test would be vacuous"
    assert len(sent) == n_segments * 3, (
        f"expected {n_segments} segments x 3 passes = {n_segments * 3} requests, got {len(sent)} — "
        "the per-pass salt is missing, so passes 2 and 3 collided and were skipped")

    with store.read() as conn:
        rows = list(conn.execute(
            "SELECT pass_index, run_id FROM wisdom_extract_requests WHERE purpose='extract'"))
    assert {r["pass_index"] for r in rows} == {1, 2, 3}, "pass_index was not recorded per pass"
    assert len({r["run_id"] for r in rows}) == 3, "the three passes share a run directory"


# ── persistence: the half that did not exist ─────────────────────────────────

def test_a_run_directory_is_discoverable_by_the_reconciler_that_reads_gate_runs(env):
    """⛔ The chain's output and the gate tool's output must be indistinguishable to `discover`."""
    from api.services.wisdom.extract import reconcile

    run_records.append_records("20260915T000000Z-chain-p1",
                               [{"phase": "gate", "segment_id": "s1", "extractor_version": "v0",
                                 "record_type": "PRINCIPLE", "record_key": ["PRINCIPLE", "x"]}])
    assert reconcile.discover(reconcile.gate_runs_root()) == ["20260915T000000Z-chain-p1"]


def test_appending_builds_a_run_across_many_reap_ticks(env):
    """A night's segments arrive over many reap ticks; the run is built up, never overwritten."""
    rid = "20260915T000000Z-chain-p1"
    run_records.append_records(rid, [{"phase": "gate", "segment_id": "s1"}])
    run_records.append_records(rid, [{"phase": "gate", "segment_id": "s2"}])
    lines = (env.root / rid / "records.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    assert {json.loads(l)["segment_id"] for l in lines} == {"s1", "s2"}


def test_a_pass_that_kept_nothing_still_records_the_segment(env):
    """⛔⛔ `reconcile` REFUSES when the runs' segment SETS differ. A pass that legitimately found
    no records in one paragraph would otherwise be missing that id — and three good passes would
    refuse to reconcile because one of them found nothing."""
    rid = "20260915T000000Z-chain-p2"
    run_records.touch_segment(rid, "s1")
    run_records.touch_segment(rid, "s1")  # idempotent
    seen = (env.root / rid / "segments_seen.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(seen) == 1 and json.loads(seen[0])["segment_id"] == "s1"


def test_the_run_root_is_the_volume_not_the_working_directory(env, monkeypatch):
    """⛔ R56's regression, from the chain's side: a redeploy changes the CWD, never DATA_DIR."""
    monkeypatch.delenv("WISDOM_GATE_RUNS_DIR", raising=False)
    monkeypatch.setenv("DATA_DIR", str(env.tmp / "vol"))
    got = run_records.run_dir("rid")
    assert got == env.tmp / "vol" / "wisdom" / "gate-runs" / "rid"
    assert "gate-runs" in str(got) and got.is_absolute() or got.root


# ── ingest exactly once ──────────────────────────────────────────────────────

def _req(pass_index, run_id="20260915T000000Z-chain-p1"):
    return {"pass_index": pass_index, "run_id": run_id, "extractor_version": "v0",
            "segment_id": "s1", "purpose": "extract"}


def test_pass_1_ingests_and_later_passes_do_not(env, monkeypatch):
    """⛔⛔ THE OTHER LOAD-BEARING ONE."""
    wrote: list = []
    monkeypatch.setattr("api.services.wisdom.extract.writer.write_output",
                        lambda conn, **kw: wrote.append(kw["extractor_version"]) or {"written": 1})
    monkeypatch.setattr("api.services.wisdom.extract.writer.validate_output",
                        lambda output, **kw: NS(kept=[], counts={}))
    seg = {"segment_id": "s1", "source_id": "src1", "source_version": 1}
    with store.write() as conn:
        r1 = batch._handle_extract_result(conn, _req(1), segment=seg, source={}, output={}, model="m")
        r2 = batch._handle_extract_result(conn, _req(2), segment=seg, source={}, output={}, model="m")
        r3 = batch._handle_extract_result(conn, _req(3), segment=seg, source={}, output={}, model="m")
    assert len(wrote) == 1, f"write_output ran {len(wrote)} times; it must run once per segment"
    assert r1.get("written") == 1
    assert r2["not_ingested"] == "pass>1" and r3["not_ingested"] == "pass>1"


def test_a_null_pass_index_is_the_single_pass_era_and_still_ingests(env, monkeypatch):
    """⚠️ Every request row submitted before the extract_003 migration has pass_index NULL.
    Absent is not zero — and zero is not a pass."""
    wrote: list = []
    monkeypatch.setattr("api.services.wisdom.extract.writer.write_output",
                        lambda conn, **kw: wrote.append(1) or {"written": 1})
    monkeypatch.setattr("api.services.wisdom.extract.writer.validate_output",
                        lambda output, **kw: NS(kept=[], counts={}))
    seg = {"segment_id": "s1", "source_id": "src1", "source_version": 1}
    with store.write() as conn:
        out = batch._handle_extract_result(conn, _req(None), segment=seg, source={}, output={}, model="m")
    assert wrote == [1] and out.get("written") == 1


def test_a_persistence_failure_never_loses_an_ingested_record(env, monkeypatch):
    """⛔ The DB write IS the product. A failure to persist costs a reconciliation, not a paid
    result — so it is recorded in the report and never raised."""
    monkeypatch.setattr("api.services.wisdom.extract.writer.write_output",
                        lambda conn, **kw: {"written": 2})
    monkeypatch.setattr("api.services.wisdom.extract.writer.validate_output",
                        lambda output, **kw: NS(kept=[], counts={}))
    monkeypatch.setattr(run_records, "persist_result",
                        lambda **kw: (_ for _ in ()).throw(OSError("disk full")))
    seg = {"segment_id": "s1", "source_id": "src1", "source_version": 1}
    with store.write() as conn:
        out = batch._handle_extract_result(conn, _req(1), segment=seg, source={}, output={}, model="m")
    assert out["written"] == 2 and "OSError" in out["persist_error"]


# ── the per-night budget ─────────────────────────────────────────────────────

def test_an_unusable_nightly_budget_stops_the_night_before_any_request(env, monkeypatch):
    """⛔ A typo'd budget must not quietly become the default and spend a night nobody authorised."""
    monkeypatch.setenv("WISDOM_EXTRACT_DAILY_BUDGET_USD", "25O")  # letter O
    monkeypatch.setattr(batch, "segment_pending_sources", lambda **kw: {"segmented": 0})
    monkeypatch.setattr(batch.golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g", "reason": None})
    sent: list = []
    monkeypatch.setattr(batch, "submit_pending", lambda *a, **k: sent.append(1) or {})
    out = batch.run_daily(_ctx(), client=object())
    assert out["status"] == "skipped" and "daily budget unusable" in out["reason"]
    assert sent == [], "a request was built despite an unusable nightly budget"


def test_the_nightly_cap_never_RAISES_the_programme_total(env, monkeypatch):
    """⛔⛔ THE DIRECTION THAT MATTERS. A per-night value sits INSIDE the programme total; if it
    were passed through unconditionally, setting it to 9999 would raise a ceiling it is supposed to
    tighten. The tightest binds — always."""
    import inspect

    src = inspect.getsource(batch.submit_pending)
    assert "min(programme_cap" in src, (
        "the nightly cap is not combined with min() — a large nightly value could raise the "
        "programme total instead of tightening it")


def test_the_night_budget_shrinks_as_passes_are_submitted(env, monkeypatch):
    """⛔ Pass 3 must not get to spend pass 1's budget again."""
    monkeypatch.setenv("WISDOM_EXTRACT_DAILY_BUDGET_USD", "1.00")
    monkeypatch.setenv(batch.PASSES_ENV, "3")
    monkeypatch.setattr(batch, "segment_pending_sources", lambda **kw: {"segmented": 0})
    monkeypatch.setattr(batch.golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g", "reason": None})
    monkeypatch.setattr(batch, "pending_segments", lambda conn, v, n: [{"segment_id": "s1"}])
    monkeypatch.setattr(batch, "retry_rows", lambda *a, **k: [])
    caps: list = []

    dates: list = []

    def fake_submit(ctx, **kw):
        caps.append(kw.get("night_cap_usd"))
        dates.append(kw.get("night_date"))
        return {"status": "submitted", "selected_estimate_usd": 0.40,
                "pass_index": kw.get("pass_index"), "run_id": kw.get("run_id")}

    monkeypatch.setattr(batch, "submit_pending", fake_submit)
    out = batch.run_daily(_ctx(), client=object())
    # ⚰️ R65 MOVED WHERE THIS IS ENFORCED, AND STRENGTHENED IT. This used to assert the
    # shrinking remainder [1.00, 0.60, 0.20] was passed down as the cap. That remainder was
    # then compared against CUMULATIVE PROGRAMME spend, which is the clamp R65 removes.
    # Each pass now receives the FULL night line plus the night DATE, and the rationing is
    # done in select_within_budget against THAT NIGHT's rows — so pass 1's submitted
    # requests are pass 2's pending. That also survives a SECOND chain run on the same
    # night, which the in-memory remainder never could.
    assert caps == [1.00, 1.00, 1.00], caps
    assert dates == [_ctx().now_et.date().isoformat()] * 3, dates
    assert out["daily_budget_usd"] == 1.00


def test_a_pass_that_would_cross_the_night_budget_submits_NOTHING(env, monkeypatch):
    """⛔ A half-submitted pass is the UNRECONCILED case — it costs money and scores nothing."""
    monkeypatch.setenv("WISDOM_EXTRACT_DAILY_BUDGET_USD", "1.00")
    monkeypatch.setenv(batch.PASSES_ENV, "3")
    monkeypatch.setattr(batch, "segment_pending_sources", lambda **kw: {"segmented": 0})
    monkeypatch.setattr(batch.golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g", "reason": None})
    monkeypatch.setattr(batch, "pending_segments", lambda conn, v, n: [{"segment_id": "s1"}])
    monkeypatch.setattr(batch, "retry_rows", lambda *a, **k: [])
    calls: list = []

    def fake_submit(ctx, **kw):
        calls.append(kw.get("pass_index"))
        return {"status": "submitted", "selected_estimate_usd": 0.60,
                "pass_index": kw.get("pass_index"), "run_id": kw.get("run_id")}

    monkeypatch.setattr(batch, "submit_pending", fake_submit)
    out = batch.run_daily(_ctx(), client=object())
    assert calls == [1, 2], f"pass 3 was submitted past the night's budget: {calls}"
    stops = [r for r in out["pass_results"] if r.get("status") == "night_budget_stop"]
    assert len(stops) == 1 and stops[0]["pass_index"] == 3


# ── the migration ────────────────────────────────────────────────────────────

def test_the_new_columns_are_additive_and_nullable(env):
    with store.read() as conn:
        cols = {r["name"]: r for r in conn.execute("PRAGMA table_info(wisdom_extract_requests)")}
    for name in ("pass_index", "run_id"):
        assert name in cols, f"{name} is missing — the extract_003 migration did not apply"
        assert cols[name]["notnull"] == 0, f"{name} is NOT NULL; pre-R53 rows would have no value"
        assert cols[name]["dflt_value"] is None


def test_the_migration_is_declared_additive_only():
    from api.services.wisdom.extract import schema

    sql = dict(schema.MIGRATIONS)["extract_003_npass_columns"].upper()
    for banned in ("DROP", "DELETE", "NOT NULL", "TRUNCATE"):
        assert banned not in sql, f"extract_003 contains {banned}"


# ── the row shape has one owner ──────────────────────────────────────────────

def test_the_tool_and_the_chain_build_the_same_row(env):
    """⛔ Two builders for one on-disk format is how a writer and a reader diverge in silence."""
    src = (REPO / "tools" / "wisdom" / "gate_records.py").read_text(encoding="utf-8")
    assert "from api.services.wisdom.extract.run_records import record_row" in src
    import ast

    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "record_rows")
    # ⛔⛔ CODE, NEVER PROSE — and this test made the mistake on its first run. `ast.unparse(fn)`
    # includes the DOCSTRING, and that docstring EXPLAINS the `record_id_for` rule, so the check
    # matched its own explanation. Deleting the explanation would have made it pass. Drop the
    # docstring node and unparse only the statements that execute.
    statements = fn.body[1:] if ast.get_docstring(fn, clean=False) is not None else fn.body
    body = "\n".join(ast.unparse(s) for s in statements)
    assert "record_id_for" not in body, "gate_records builds identity fields again — one owner only"
    # ⭐ control: the probe can see the call when it is really there
    assert "record_row" in body
