"""upsert_items and the owner's approval carried by the save file (2026-10-21).

The bank marks an item approved when the owner's verdict is in
docs/study/corrections (corrections.py `approve`). A re-import of an item the
pod still holds as a DRAFT at the same version must go live, or the pod lags
the bank forever (seen 2026-10-21: 603 approved in the bank, 180 on the pod
after a re-import that "updated 603"). It never downgrades an approved row at
the same version, never resurrects a reject, and a HIGHER version still resets
to draft (nothing goes live unreviewed).
Run alone: python -m pytest tests/test_study_upsert_status.py -q
"""
from __future__ import annotations

import pytest

from api.services import study_store as ss


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    ss.init_db()
    return ss


def _item(iid, **kw):
    base = {"id": iid, "type": "recall", "skill_id": "vocab.candle", "difficulty": 2,
            "prompt_json": {"q": "?", "choices": ["a", "b"]}, "answer_json": {"answer": "a"},
            "source_kind": "candles", "lesson_text": "L"}
    base.update(kw)
    return base


def test_a_draft_on_the_pod_goes_live_when_the_bank_says_approved(store):
    store.upsert_items([_item("si_a")])
    assert store.get_item_full("si_a")["review_status"] == "draft"
    res = store.upsert_items([_item("si_a", review_status="approved",
                                    reviewed={"by": "owner", "ts": "2026-10-21", "words": "good"})])
    assert res == {"inserted": 0, "updated": 1, "ids": ["si_a"]}
    row = store.get_item_full("si_a")
    assert row["review_status"] == "approved" and row["reviewed_by"] == "owner" and row["reviewed_at"]
    assert row["version"] == 1


def test_the_bank_without_a_reviewed_block_still_names_the_reviewer(store):
    store.upsert_items([_item("si_b")])
    store.upsert_items([_item("si_b", review_status="approved")])
    assert store.get_item_full("si_b")["reviewed_by"] == "owner (bank)"


def test_never_downgrades_never_resurrects_and_a_new_version_still_resets(store):
    store.upsert_items([_item("si_c"), _item("si_d"), _item("si_e")])
    store.approve("si_c", "owner")
    store.reject("si_d", "owner", reason="bad chart")
    store.approve("si_e", "owner")
    # the bank still says draft for si_c (the pod's approval stands)
    store.upsert_items([_item("si_c")])
    assert store.get_item_full("si_c")["review_status"] == "approved"
    # the bank says approved for a row the owner rejected on the pod: the reject stands
    store.upsert_items([_item("si_d", review_status="approved")])
    assert store.get_item_full("si_d")["review_status"] == "rejected"
    # a higher version resets to draft even when the bank says approved
    store.upsert_items([_item("si_e", version=2, review_status="approved")])
    row = store.get_item_full("si_e")
    assert row["review_status"] == "draft" and row["version"] == 2
