"""Today's Study composer (spec §4.5, §7.1 Selection, §13.5 P1, §13.2 T5).

Run alone: python -m pytest tests/test_study_select.py -q
"""
from __future__ import annotations

import random
from collections import Counter

import pytest

from api.services import study_select as sel


def _bank():
    rows = []
    for i in range(6):
        rows.append({"id": f"rec{i}", "type": "recall", "skill_id": "f1.basics", "difficulty": 1,
                     "has_chart": False})
    for i in range(6):
        rows.append({"id": f"sz{i}", "type": "size", "skill_id": "m5.size", "difficulty": 2,
                     "has_chart": False})
    for i in range(3):
        rows.append({"id": f"rg{i}", "type": "regime", "skill_id": "m2.regime", "difficulty": 2,
                     "has_chart": False})
    for i in range(8):
        rows.append({"id": f"ch{i}", "type": "spot", "skill_id": "setup.vcp", "difficulty": 3,
                     "has_chart": True})
    return rows


def _compose(**kw):
    kw.setdefault("due_fn", lambda u, n: [])
    kw.setdefault("missed_fn", lambda u: set())
    kw.setdefault("weak_fn", lambda u: set())
    kw.setdefault("rng", random.Random(7))
    return sel.compose_today("u1", _bank, **kw)


def _no_adjacent_charts(ids, bank_by_id):
    for a, b in zip(ids, ids[1:]):
        if bank_by_id[a]["has_chart"] and bank_by_id[b]["has_chart"]:
            return False
    return True


def test_ten_unique_ids_with_the_type_mix_and_no_adjacent_charts():
    by_id = {r["id"]: r for r in _bank()}
    for seed in range(25):
        ids = _compose(rng=random.Random(seed))
        assert len(ids) == 10 and len(set(ids)) == 10
        kinds = Counter("chart" if by_id[i]["has_chart"] else by_id[i]["type"] for i in ids)
        assert kinds["regime"] == 1 and kinds["size"] == 1 and kinds["recall"] >= 1
        assert 2 <= kinds["chart"] <= 3
        assert _no_adjacent_charts(ids, by_id), ids


def test_due_slots_come_first_and_are_never_repeated():
    due = [{"id": "rec0", "type": "recall", "skill_id": "f1.basics", "has_chart": False},
           {"id": "ch0", "type": "spot", "skill_id": "setup.vcp", "has_chart": True},
           {"id": "sz0", "type": "size", "skill_id": "m5.size", "has_chart": False}]
    ids = _compose(due_fn=lambda u, n: due)
    assert ids[:3] == ["rec0", "ch0", "sz0"]
    assert len(set(ids)) == 10
    assert ids.count("ch0") == 1


def test_due_items_count_toward_the_mix():
    due = [{"id": "sz0", "type": "size", "skill_id": "m5.size", "has_chart": False}]
    by_id = {r["id"]: r for r in _bank()}
    ids = _compose(due_fn=lambda u, n: due)
    assert sum(1 for i in ids if by_id[i]["type"] == "size") == 1


def test_due_item_outside_the_bank_is_still_placed():
    due = [{"id": "old1", "type": "recall", "skill_id": "x", "has_chart": False}]
    ids = _compose(due_fn=lambda u, n: due)
    assert ids[0] == "old1" and len(ids) == 10


def test_weak_skills_and_missed_items_are_weighted_double():
    bank = [{"id": f"a{i}", "type": "recall", "skill_id": "weak", "has_chart": False} for i in range(10)] + \
           [{"id": f"b{i}", "type": "recall", "skill_id": "strong", "has_chart": False} for i in range(10)]
    picks = Counter()
    for seed in range(300):
        ids = sel.compose_today("u1", lambda: bank, n=4, due_fn=lambda u, n: [],
                                missed_fn=lambda u: set(), weak_fn=lambda u: {"weak"},
                                rng=random.Random(seed))
        for i in ids:
            picks["weak" if i.startswith("a") else "strong"] += 1
    ratio = picks["weak"] / picks["strong"]
    assert 1.5 < ratio < 2.6, picks

    picks = Counter()
    for seed in range(300):
        ids = sel.compose_today("u1", lambda: bank, n=4, due_fn=lambda u, n: [],
                                missed_fn=lambda u: {"b0"}, weak_fn=lambda u: set(),
                                rng=random.Random(seed))
        picks["b0"] += ids.count("b0")
        picks["b1"] += ids.count("b1")
    assert picks["b0"] > picks["b1"] * 1.4, picks


def test_small_bank_returns_what_exists_without_duplicates():
    bank = [{"id": "x1", "type": "recall", "skill_id": "s", "has_chart": False},
            {"id": "x2", "type": "spot", "skill_id": "s", "has_chart": True}]
    ids = sel.compose_today("u1", lambda: bank, due_fn=lambda u, n: [], missed_fn=lambda u: set(),
                            weak_fn=lambda u: set(), rng=random.Random(1))
    assert sorted(ids) == ["x1", "x2"]
    assert sel.compose_today("u1", lambda: [], due_fn=lambda u, n: [], missed_fn=lambda u: set(),
                             weak_fn=lambda u: set()) == []


def test_arrange_no_adjacent_charts_keeps_order_where_it_can():
    rows = [{"id": "c1", "has_chart": True}, {"id": "c2", "has_chart": True},
            {"id": "r1", "has_chart": False}, {"id": "c3", "has_chart": True},
            {"id": "r2", "has_chart": False}]
    out = [r["id"] for r in sel.arrange_no_adjacent_charts(rows)]
    assert out == ["c1", "r1", "c2", "r2", "c3"]
    # more charts than gaps: the leftovers land at the end rather than being dropped
    rows = [{"id": "c1", "has_chart": True}, {"id": "c2", "has_chart": True}, {"id": "c3", "has_chart": True}]
    assert len(sel.arrange_no_adjacent_charts(rows)) == 3


def test_defaults_point_at_the_store(monkeypatch):
    from api.services import study_store
    calls = []
    monkeypatch.setattr(study_store, "list_due", lambda u, n: calls.append("due") or [])
    monkeypatch.setattr(study_store, "missed_item_ids", lambda u: calls.append("missed") or set())
    monkeypatch.setattr(study_store, "weak_skill_ids", lambda u: calls.append("weak") or set())
    sel.compose_today("u1", _bank, rng=random.Random(0))
    assert sorted(calls) == ["due", "missed", "weak"]


@pytest.mark.parametrize("n", [1, 3, 7, 10, 15])
def test_set_size_is_honoured(n):
    assert len(_compose(n=n)) == n


# ── walk-throughs: never in the daily set, first in a unit (§13.9 #1) ────────

def _bank_with_walks():
    rows = _bank()
    for i in range(4):
        rows.append({"id": f"wk{i}", "type": "walkthrough", "skill_id": "m2.regime", "difficulty": 1,
                     "has_chart": False})
    return rows


def test_compose_today_never_selects_a_walkthrough_even_when_due_or_weak():
    due = [{"id": "wk0", "type": "walkthrough", "skill_id": "m2.regime", "has_chart": False},
           {"id": "rec0", "type": "recall", "skill_id": "f1.basics", "has_chart": False}]
    for seed in range(40):
        ids = sel.compose_today("u1", _bank_with_walks, due_fn=lambda u, n: due, missed_fn=lambda u: {"wk1"},
                                weak_fn=lambda u: {"m2.regime"}, rng=random.Random(seed))
        assert len(ids) == 10 and not any(i.startswith("wk") for i in ids), ids
        assert ids[0] == "rec0"
    assert sel.UNSCORED_TYPES == ("walkthrough",) and sel.MAX_WALKTHROUGHS == 3


def test_compose_unit_puts_the_walkthroughs_first_capped_at_three_then_the_scored_set():
    walks = [{"id": "wk2", "order": 1}, {"id": "wk0", "order": 2}, {"id": "wk3", "order": 2}, {"id": "wk1", "order": 9}]
    ids = sel.compose_unit("u1", "m2.regime", _bank_with_walks, walkthrough_query=lambda s: walks, n=5,
                           due_fn=lambda u, n: [{"id": "rec0", "type": "recall", "skill_id": "f1.basics", "has_chart": False}],
                           missed_fn=lambda u: set(), weak_fn=lambda u: set(), rng=random.Random(3))
    assert ids[:3] == ["wk2", "wk0", "wk3"]            # the store's order, never re-sorted here
    assert len(ids) == 8 and len(set(ids)) == 8
    assert "wk1" not in ids and "rec0" not in ids       # cap of three; a unit has no due slots
    assert not any(i.startswith("wk") for i in ids[3:])
    # no walk-throughs: a plain scored set
    plain = sel.compose_unit("u1", "x", _bank_with_walks, walkthrough_query=lambda s: [], n=4,
                             due_fn=lambda u, n: [], missed_fn=lambda u: set(), weak_fn=lambda u: set(),
                             rng=random.Random(1))
    assert len(plain) == 4 and not any(i.startswith("wk") for i in plain)


def test_compose_unit_defaults_to_the_stores_walkthrough_list(monkeypatch):
    from api.services import study_store
    seen = []
    monkeypatch.setattr(study_store, "list_walkthroughs", lambda s: seen.append(s) or [{"id": "w1", "order": 1}])
    monkeypatch.setattr(study_store, "list_due", lambda u, n: [])
    monkeypatch.setattr(study_store, "missed_item_ids", lambda u: set())
    monkeypatch.setattr(study_store, "weak_skill_ids", lambda u: set())
    ids = sel.compose_unit("u1", "regime.bands", _bank, n=2, rng=random.Random(0))
    assert seen == ["regime.bands"] and ids[0] == "w1" and len(ids) == 3
