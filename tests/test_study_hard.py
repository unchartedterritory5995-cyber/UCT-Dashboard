"""Hard mode's last-bar sweep (api/services/study_hard.py) and its two doors in the router: the `hard` flag on a
skill session, and the forward-bar top-up that carries the run-on to the trade's culmination.

The owner, batch 21 (2026-11-06), on an AAPL chart filed as a Launchpad near-miss whose screen said "Nothing fired
here": "AAPL in this example IS an oops reversal! We cannot have incorrect examples and explanations!" The detector
agrees with him, so that chart is the fixture here: a No item on which ANOTHER setup fires must never reach Hard mode.

Run alone: python -m pytest tests/test_study_hard.py -q
"""
from __future__ import annotations

import json
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import get_current_user
from api.services import study_hard as H
from api.services import study_store as ss

FIX = pathlib.Path(__file__).parent / "fixtures"
OWNERS_AAPL = FIX / "uct_launch_pad" / "neg_quiet_session_AAPL_20230302.json"     # the chart he flagged
QUIET_AAPL = FIX / "uct_oops_reversal" / "neg_quiet_session_AAPL_20230721.json"   # an ordinary session
OOPS_AAPL = FIX / "uct_oops_reversal" / "pos_1_AAPL_20220809.json"                # an Oops that fires


def _bars(path: pathlib.Path) -> list:
    bars = json.loads(path.read_text(encoding="utf-8"))["bars"]
    # the bank keys daily bars YYYYMMDD; the fixtures carry unix seconds, which the sweep never reads
    return [{"t": 20000101 + i, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]} for i, b in enumerate(bars)]


def test_the_owners_aapl_chart_is_an_oops_reversal_not_a_quiet_session():
    fired, ok = H.fired_on_last_bar(_bars(OWNERS_AAPL))
    assert ok
    assert "setup.family4.oops" in fired
    assert "setup.family1.launchpad" not in fired
    # a Launchpad No item on which the Oops fires can never back the "Nothing fired" card
    assert H.hard_eligible(False, "setup.family1.launchpad", _bars(OWNERS_AAPL)) is False


def test_a_quiet_session_is_a_clean_nothing_fired_and_a_positive_is_clean_when_it_fires_alone():
    fired, ok = H.fired_on_last_bar(_bars(QUIET_AAPL))
    assert ok and fired == set()
    assert H.hard_eligible(False, "setup.family4.oops", _bars(QUIET_AAPL)) is True
    fired, ok = H.fired_on_last_bar(_bars(OOPS_AAPL))
    assert ok and "setup.family4.oops" in fired
    assert H.hard_eligible(True, "setup.family4.oops", _bars(OOPS_AAPL)) is (fired == {"setup.family4.oops"})
    # a Yes item some OTHER setup also fires on is ambiguous: one card cannot be the one right answer
    assert H.hard_eligible(True, "setup.family3.kicker", _bars(OOPS_AAPL)) is False


def test_an_unreadable_chart_is_unknown_never_nothing_fired():
    assert H.fired_on_last_bar([]) == (set(), False)
    assert H.fired_on_last_bar([{"t": 1, "o": "x"}]) == (set(), False)
    assert H.hard_eligible(False, "setup.family4.oops", []) is False


def test_the_key_reader():
    assert H.key_is_yes({"answer": "yes"}) is True
    assert H.key_is_yes({"answer": "No"}) is False
    assert H.key_is_yes("YES") is True
    assert H.key_is_yes({"answer": "target hit"}) is None
    assert H.key_is_yes(None) is None


def test_bear_gap_rule_needs_a_true_gap_on_volume_off_a_top():
    # 80 flat sessions at 100 (the top is the last close before the gap), then a 12% true gap down on 3x volume
    bars = [{"t": 20240101 + i, "o": 100, "h": 101, "l": 99, "c": 100, "v": 1000} for i in range(80)]
    gap = {"t": 20240301, "o": 88, "h": 90, "l": 85, "c": 86, "v": 3000}
    fired, ok = H.fired_on_last_bar(bars + [gap])
    assert ok and "setup.family3.bear_gap" in fired
    thin = dict(gap, v=1200)          # no volume: not the bank's bear gap
    assert "setup.family3.bear_gap" not in H.fired_on_last_bar(bars + [thin])[0]
    shallow = dict(gap, o=97, h=98, c=96)   # no true gap, no 6% close
    assert "setup.family3.bear_gap" not in H.fired_on_last_bar(bars + [shallow])[0]


# ── the router doors ──────────────────────────────────────────────────────────

MEMBER = {"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"}


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    H.clear_cache()
    return ss


@pytest.fixture()
def paid_client(store):
    app = FastAPI()
    app.include_router(study_router.router)
    app.dependency_overrides[study_router.require_paid] = lambda: MEMBER
    app.dependency_overrides[get_current_user] = lambda: MEMBER
    return TestClient(app)


def _spot(iid, skill, answer, sym, asof):
    return {"id": iid, "type": "spot", "skill_id": skill, "difficulty": 3, "bars_ref": f"sb_{iid}", "sym": sym,
            "asof": asof, "prompt_json": {"q": "fires?", "choices": ["Yes", "No"]}, "answer_json": {"answer": answer},
            "reveal_json": {"fixture": iid}, "source_kind": "detection", "source_ref": f"det:{iid}", "lesson_text": "L"}


def _seed(store):
    items = [
        _spot("si_flag", "setup.family1.launchpad", "no", "AAPL", "2023-03-02"),   # the owner's chart: an Oops fires
        _spot("si_quiet", "setup.family1.launchpad", "no", "AAPL", "2023-07-21"),  # nothing fires
    ]
    store.upsert_items(items)
    store.upsert_bars("sb_si_flag", "D", _bars(OWNERS_AAPL), [])
    store.upsert_bars("sb_si_quiet", "D", _bars(QUIET_AAPL), [])
    for it in items:
        store.approve(it["id"], "owner")


def test_a_hard_skill_session_leaves_out_the_chart_another_setup_fired_on(paid_client, store):
    _seed(store)
    plain = paid_client.post("/api/study/sessions", json={"kind": "skill", "skill_id": "setup.family1.launchpad", "size": 4})
    assert plain.status_code == 200 and {i["id"] for i in plain.json()["items"]} == {"si_flag", "si_quiet"}
    hard = paid_client.post("/api/study/sessions", json={"kind": "skill", "skill_id": "setup.family1.launchpad", "size": 4, "hard": True})
    assert hard.status_code == 200
    assert [i["id"] for i in hard.json()["items"]] == ["si_quiet"]


def test_the_sweep_is_cached_per_item_version(store, monkeypatch):
    _seed(store)
    calls = []
    real = H.fired_on_last_bar
    monkeypatch.setattr(H, "fired_on_last_bar", lambda bars: calls.append(1) or real(bars))
    assert H.item_eligible("si_quiet") is True
    assert H.item_eligible("si_quiet") is True
    assert len(calls) == 1
    assert H.item_eligible("si_missing") is False


def test_the_forward_strip_is_topped_up_from_the_servers_own_bars(paid_client, store, monkeypatch):
    _seed(store)
    stored = [{"t": 20230724 + i, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for i in range(5)]
    store.upsert_bars("sb_si_quiet", "D", _bars(QUIET_AAPL), stored)
    asked = []

    def fake_rows(sym, tf, max_bars, to_key):
        asked.append((sym, tf, max_bars, to_key))
        # the server's own bars: some before the stored strip's end (never re-served), then plenty after
        return [(20230720 + i, 1.5, 1.6, 1.4, 1.55, 100) for i in range(120)]   # continuing the stored strip's price

    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars_before", fake_rows)
    r = paid_client.post("/api/study/attempts", json={"item_id": "si_quiet", "answer": "no"}).json()
    rev = r["reveal"]
    assert rev["forward_total"] == study_router.FORWARD_WANT == 60
    assert rev["forward_bars"][:5] == stored                            # the sealed strip first
    assert rev["forward_bars"][5]["t"] == 20230729 and len(rev["forward_bars"]) == study_router.REVEAL_FORWARD_BARS
    assert asked and asked[0][0] == "AAPL" and asked[0][1] == "D"
    step = paid_client.post(f"/api/study/attempts/{r['attempt_id']}/step", json={"offset": 20, "n": 60}).json()
    assert len(step["bars"]) == 40 and step["done"] is True and step["forward_total"] == 60
    assert all(step["bars"][k]["t"] < step["bars"][k + 1]["t"] for k in range(39))


def test_a_missing_symbol_in_the_servers_bars_leaves_the_strip_as_stored(paid_client, store, monkeypatch):
    _seed(store)
    stored = [{"t": 20230724 + i, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for i in range(5)]
    store.upsert_bars("sb_si_quiet", "D", _bars(QUIET_AAPL), stored)
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda *a: [])
    rev = paid_client.post("/api/study/attempts", json={"item_id": "si_quiet", "answer": "no"}).json()["reveal"]
    assert rev["forward_bars"] == stored and rev["forward_total"] == 5
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda *a: (_ for _ in ()).throw(RuntimeError("no db")))
    rev = paid_client.post("/api/study/attempts", json={"item_id": "si_quiet", "answer": "no"}).json()["reveal"]
    assert rev["forward_bars"] == stored


def test_the_setup_rule_is_the_definition_the_approved_lessons_share(store):
    lesson = ("Oops Reversal (scanner version): opens below the prior close, trades under the prior day's low, then reverses "
              "and closes above the prior close. LOCATION is the main thing (owner rulings 2026-10-23/24). Here it opened 0.48% "
              "from the prior low and closed up 11.57%.")
    items = [dict(_spot(f"si_o{k}", "setup.family4.oops", "yes", "ORIC", f"2024-01-1{k}"), lesson_text=lesson) for k in range(3)]
    items.append(dict(_spot("si_tpl", "setup.family4.oops", "no", "AAPL", "2022-07-13"),
                      lesson_text="Oops Reversal: the firm's detector does not fire on the last bar of this chart. closed back under it"))
    store.upsert_items(items)
    for it in items:
        store.approve(it["id"], "owner")
    H.clear_rule_cache()
    rule = H.setup_rule("setup.family4.oops")
    assert rule["name"] == "Oops Reversal (scanner version)"
    assert rule["text"].startswith("opens below the prior close, trades under the prior day's low")
    assert "Here it opened" not in rule["text"] and rule["text"].endswith("(owner rulings 2026-10-23/24).")
    assert H.setup_rule("setup.family3.kicker") is None


def test_the_reveal_carries_the_setup_rule(paid_client, store):
    _seed(store)
    H.clear_rule_cache()
    rev = paid_client.post("/api/study/attempts", json={"item_id": "si_quiet", "answer": "no"}).json()["reveal"]
    assert "setup_rule" in rev          # None here: the seed's lessons are one word, not a definition


def test_a_top_up_on_another_price_basis_is_dropped(paid_client, store, monkeypatch):
    """A split adjusted after import would join the chart at a tenth of its price: the stored strip stands alone."""
    _seed(store)
    stored = [{"t": 20230724 + i, "o": 100, "h": 101, "l": 99, "c": 100, "v": 10} for i in range(5)]
    store.upsert_bars("sb_si_quiet", "D", _bars(QUIET_AAPL), stored)
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda *a: [(20230801 + i, 10, 10.2, 9.9, 10.1, 100) for i in range(60)])
    rev = paid_client.post("/api/study/attempts", json={"item_id": "si_quiet", "answer": "no"}).json()["reveal"]
    assert rev["forward_bars"] == stored and rev["forward_total"] == 5
