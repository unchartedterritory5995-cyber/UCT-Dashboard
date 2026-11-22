"""ENGINE 53 -- `runtime_definitions.stamp_served` reaches an ``ast`` row that asks the run.

A host (``ast``) document may carry a run half (``compute.runtimeObjects``) or run-read colours
(``compute.runtimeColours``, DIV-4). The served copy is stamped by the runtime lane's three rules
(kill list, stage, allowlist) exactly as a runtime row is, and a stale stamp written back by a
client is dropped. Every other ``ast`` row is served untouched (the same object).
"""
import pytest

from api.services import runtime_definitions as rt

SOURCE = '//@version=5\nindicator("run half")\nplot(close)\nlabel.new(bar_index, high, "x")\n'
DEF_ID = "u_0123456789ab"


def row(compute_extra=None, meta=None):
    compute = {"kind": "ast", "fn": "sha256:" + "0" * 64, "ast": {"type": "num", "value": 0}}
    compute.update(compute_extra or {})
    return {"def_id": DEF_ID, "definition": {"id": DEF_ID, "compute": compute, "meta": dict(meta or {})}}


RUN_HALF = {"runtimeObjects": {"source": SOURCE, "outputs": {"value": 0}}}
RUN_COLOURS = {"runtimeColours": {"source": SOURCE, "at": [], "keys": []}}


@pytest.fixture(autouse=True)
def _lists(monkeypatch):
    monkeypatch.delenv(rt.KILL_ENV, raising=False)
    monkeypatch.setenv(rt.STAGE_ENV, rt.STAGE_ALL)
    # the committed allowlist is read too; this script is on neither, so the variable decides
    monkeypatch.setenv(rt.ALLOW_ENV, "")


def test_a_plain_ast_row_is_served_untouched():
    r = row()
    assert rt.stamp_served(r) is r


@pytest.mark.parametrize("extra", [RUN_HALF, RUN_COLOURS], ids=["runtimeObjects", "runtimeColours"])
def test_an_ungraded_run_read_is_stamped_not_graded(extra):
    r = row(extra)
    out = rt.stamp_served(r)
    assert out is not r and "runtimeNotGraded" in out["definition"]["meta"]
    assert "runtimeKilled" not in out["definition"]["meta"]
    assert r["definition"]["meta"] == {}, "the stored row is not touched"


def test_a_graded_run_half_is_served_untouched(monkeypatch):
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(SOURCE)[:16])
    r = row(RUN_HALF)
    assert rt.stamp_served(r) is r


def test_a_killed_run_half_is_stamped_killed(monkeypatch):
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(SOURCE)[:16])
    monkeypatch.setenv(rt.KILL_ENV, DEF_ID)
    out = rt.stamp_served(row(RUN_HALF))
    assert "runtimeKilled" in out["definition"]["meta"] and "runtimeNotGraded" not in out["definition"]["meta"]


def test_stage_off_stamps_a_run_half_like_a_kill(monkeypatch):
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(SOURCE)[:16])
    monkeypatch.setenv(rt.STAGE_ENV, rt.STAGE_OFF)
    out = rt.stamp_served(row(RUN_HALF))
    assert "switched off for every member" in out["definition"]["meta"]["runtimeKilled"]


def test_a_stale_stamp_written_back_is_dropped(monkeypatch):
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(SOURCE)[:16])
    r = row(RUN_HALF, meta={"runtimeNotGraded": "old", "runtimeKilled": "old", "keep": 1})
    out = rt.stamp_served(r)
    assert out["definition"]["meta"] == {"keep": 1}


def test_a_runtime_row_is_still_stamped_as_before():
    r = {"def_id": DEF_ID, "definition": {"id": DEF_ID, "compute": {"kind": "runtime", "source": SOURCE, "outputs": {"value": 0}}, "meta": {}}}
    out = rt.stamp_served(r)
    assert "runtimeNotGraded" in out["definition"]["meta"]


def test_run_read_source_reads_only_ast_rows():
    assert rt.run_read_source(row(RUN_HALF)["definition"]) == SOURCE
    assert rt.run_read_source(row(RUN_COLOURS)["definition"]) == SOURCE
    assert rt.run_read_source(row()["definition"]) is None
    assert rt.run_read_source({"compute": {"kind": "runtime", "runtimeObjects": {"source": SOURCE}}}) is None
