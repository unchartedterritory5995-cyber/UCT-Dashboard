"""scripts/study/retire_ids.py: retire the audit's cut ids on the pod.

Run alone: python -m pytest tests/test_study_retire_ids.py -q
"""
from __future__ import annotations

import contextlib
import glob
import json
import pathlib
import sqlite3

import pytest

from api.services import study_store as ss
from scripts.study import retire_ids as rt

REPO = pathlib.Path(__file__).resolve().parents[1]
BATCH1 = REPO / "docs/study/audits/2026-10-21/retire_batch1.json"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    ss.init_db()
    return ss


def _item(iid):
    return {"id": iid, "type": "recall", "skill_id": "f1.basics", "module": "F1", "difficulty": 2,
            "prompt_json": {"q": f"What is {iid}?", "choices": ["a", "b"]},
            "answer_json": {"answer": "a"}, "reveal_json": {"why": "because"},
            "source_kind": "glossary", "source_ref": f"glossary#{iid}", "sym": None,
            "lesson_text": "A lesson.", "lesson_origin": "session"}


def _status(store, iid):
    with contextlib.closing(sqlite3.connect(store._DB_PATH)) as c:
        return c.execute("SELECT review_status FROM study_items WHERE id=?", (iid,)).fetchone()[0]


def test_retires_drafts_only_and_names_everything_it_skipped(store):
    store.upsert_items([_item("si_00000000000a"), _item("si_00000000000b"), _item("si_00000000000c")])
    store.review("si_00000000000c", "approve", "owner")
    out = rt.retire(["si_00000000000a", "si_00000000000c", "si_0000000000zz", "si_00000000000a"],
                    "audit cut", "study audit")
    assert out == {"retired": ["si_00000000000a"], "not_draft": ["si_00000000000c:approved"],
                   "unknown": ["si_0000000000zz"], "duplicate": ["si_00000000000a"]}
    assert _status(store, "si_00000000000a") == ss.STATUS_REJECTED
    assert _status(store, "si_00000000000b") == ss.STATUS_DRAFT       # not on the list
    assert _status(store, "si_00000000000c") == ss.STATUS_APPROVED    # an owner verdict is never overwritten
    with contextlib.closing(sqlite3.connect(store._DB_PATH)) as c:
        n = c.execute("SELECT COUNT(*) FROM study_corrections WHERE item_id=? AND action='reject'",
                      ("si_00000000000a",)).fetchone()[0]
    assert n == 1


def test_a_rerun_retires_nothing_twice(store):
    store.upsert_items([_item("si_00000000000a")])
    rt.retire(["si_00000000000a"], "audit cut", "study audit")
    again = rt.retire(["si_00000000000a"], "audit cut", "study audit")
    assert again["retired"] == [] and again["not_draft"] == ["si_00000000000a:rejected"]


def test_dry_run_writes_nothing(store):
    store.upsert_items([_item("si_00000000000a")])
    out = rt.retire(["si_00000000000a"], "audit cut", "study audit", dry_run=True)
    assert out["retired"] == ["si_00000000000a"]
    assert _status(store, "si_00000000000a") == ss.STATUS_DRAFT


def test_refuses_off_the_pod_without_an_explicit_db(monkeypatch, capsys):
    monkeypatch.delenv("STUDY_DB_PATH", raising=False)
    for k in rt._POD_ENV:
        monkeypatch.delenv(k, raising=False)
    assert rt.main([str(BATCH1), "--dry-run"]) == 2
    assert "refusing" in capsys.readouterr().out


def test_batch1_is_the_137_cuts_and_none_of_them_is_still_in_the_bank():
    ids, why = rt.load_ids(BATCH1)
    assert len(ids) == 137 and len(set(ids)) == 137
    assert "2026-10-21" in why
    bank = set()
    for p in glob.glob(str(REPO / "docs/study/bank/*.json")):
        bank.update(it["id"] for it in json.loads(pathlib.Path(p).read_text(encoding="utf-8")))
    assert len(bank) > 100                                   # the bank was actually read
    assert not (set(ids) & bank), sorted(set(ids) & bank)[:10]


def test_batch2_is_the_9_bottoms_cuts_and_none_of_them_is_still_in_the_bank():
    ids, why = rt.load_ids(REPO / "docs/study/audits/2026-10-23/retire_batch2.json")
    assert len(ids) == 9 and len(set(ids)) == 9
    assert "2026-10-23" in why
    bank = {it["id"] for it in json.loads((REPO / "docs/study/bank/regime.bottoms.json").read_text(encoding="utf-8"))}
    assert len(bank) == 8
    assert not (set(ids) & bank)
