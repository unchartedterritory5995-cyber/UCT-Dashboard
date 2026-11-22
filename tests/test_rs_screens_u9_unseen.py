"""RS screens unit U9: the shadow Leader score is visible to NO member, through NO API,
for EVERY flag combination.

Owner decision D1 (plan 2026-11-14 v2, section 8): the score runs unseen until it
passes its pre-registered test. "Unseen" is held here as a property of the payloads,
not of the picker: a scan answers ``SELECT *`` over ``screener_rows``, so the values
live in side tables (``rs_leader_shadow``) and none of the seven names in
``filters.RS_SHADOW_KEYS`` is a column, a filter, a view column or a word in a receipt.

The table under test is FILLED: the post-pass has run with every flag on, so a leak
would carry a real number. Then all 32 combinations of the five RS flags are walked.
"""
from __future__ import annotations

import itertools
import json
import pathlib
import re
from contextlib import closing

import pytest

from api.services.screener import filters as F
from api.services.screener import (methodology, query, rs_leader_shadow, rs_post_pass,
                                   saved_screens, snapshot_db)
from api.services.screener import rs_history as rh
from tests.test_rs_screens_u9_storage import S, scores, universe

ROOT = pathlib.Path(__file__).resolve().parents[1]
KEYS = ("rs_steady", "rs_line_below_high_pct", "rs_leader_score",
        "rs_ls_strength", "rs_ls_steady", "rs_ls_high", "rs_ls_group")
#: Anything of the unit a payload could name: the seven keys, the two tables, the words.
LEAK = re.compile(r"rs_steady|rs_line_below_high|rs_leader_score|rs_ls_|rs_leader_shadow|"
                  r"leader[ _]score|leader_shadow", re.I)
FLAGS = ("v2", "history", "v3", "screens", "shadow")
COMBOS = list(itertools.product((False, True), repeat=len(FLAGS)))


def _leaks(payload) -> list:
    return sorted(set(LEAK.findall(json.dumps(payload, default=str))))


def _set_flags(monkeypatch, v2, history, v3, screens, shadow):
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", v2)
    monkeypatch.setattr(F, "_rs_history_on", lambda: history)
    monkeypatch.setattr(F, "_rs_v3_on", lambda: v3)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1" if screens else "0")
    monkeypatch.setenv("RS_LEADER_SHADOW_ENABLED", "1" if shadow else "0")


@pytest.fixture
def filled(tmp_path, monkeypatch):
    """A screener.db whose side tables hold real scores: built with every flag on."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    monkeypatch.setattr(query, "stale_gate", lambda conn: None)
    from api.services.screener import distribution
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": None})
    _set_flags(monkeypatch, True, True, True, True, True)
    snapshot_db.init_db()
    rows = universe()
    snapshot_db.upsert_rows([{**r, "snapshot_date": S, "built_at": 1} for r in rows])
    rh.store_rows(S, scores())
    rs_leader_shadow.write_inputs({r["ticker"]: {"rs_steady": 0.3, "rs_line_below_high_pct": 0.0,
                                                 "bars_asof": r["bars_asof"]} for r in rows})
    assert rs_post_pass.run(S)["ok"]
    with closing(snapshot_db.connect()) as conn:
        n = conn.execute(f"SELECT COUNT(*) FROM {rs_leader_shadow.TABLE} "
                         "WHERE rs_leader_score IS NOT NULL").fetchone()[0]
        h = conn.execute(f"SELECT COUNT(*) FROM {rs_leader_shadow.HISTORY_TABLE}").fetchone()[0]
    assert (n, h) == (16, 16), "the fixture must hold real scores, or nothing here proves anything"
    return tmp_path


# ───────────────────────── the names, and where they must not be ─────────────

def test_the_shadow_family_is_these_seven_names():
    assert F.RS_SHADOW_KEYS == KEYS
    assert set(rs_leader_shadow.INPUT_COLUMNS) | {c for c, _k in rs_leader_shadow.SCORE_COLUMNS} == set(KEYS)
    assert all(LEAK.search(k) for k in KEYS), "the leak pattern must see every key"


def test_no_registry_names_a_shadow_key():
    """Not a filter, not a column of the served table, not a column of a view, not a
    retired key, not in any RS family a flag can light."""
    keys = set(KEYS)
    assert not (keys & set(F.FILTERS)), "registering one serves it: move it out of RS_SHADOW_KEYS first"
    assert not (keys & {f.get("column") for f in F.FILTERS.values()})
    assert not (keys & set(snapshot_db.COLUMNS)), "a screener_rows column is in every scan response"
    assert not (keys & set(F.RS_SCREENS_KEYS)) and not (keys & set(getattr(F, "RETIRED", {})))
    for name, view in F.VIEWS.items():
        assert not (keys & set(view["columns"])), name
    assert not (keys & set(F.comparable_keys()))
    for combo in COMBOS:
        assert not (keys & set(F.rs_dark_keys(*combo[:4]))), "dark is for keys that can be lit"
    assert not _leaks(F.CATEGORIES) and not _leaks(methodology.all_methods())


def test_no_file_a_member_s_browser_loads_names_one():
    """The client bundle, the Agent's field list and the chart engine's column table."""
    hits = []
    for path in (ROOT / "app" / "src").rglob("*"):
        if path.is_file() and path.suffix in (".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".md", ".html"):
            if LEAK.search(path.read_text(encoding="utf-8", errors="ignore")):
                hits.append(str(path.relative_to(ROOT)))
    assert hits == []


def test_only_the_units_own_modules_touch_the_side_tables():
    """No router and no other service reads `rs_leader_shadow`, its tables or the
    harness: there is no request path to the score to forget to gate."""
    allowed = {"api/services/screener/rs_leader_shadow.py", "api/services/screener/rs_leader_score.py",
               "api/services/screener/rs_post_pass.py", "api/services/screener/snapshot_builder.py",
               "api/services/screener/rs_columns.py", "api/services/screener/filters.py",
               "api/services/relative_strength.py"}
    word = re.compile(r"rs_leader_shadow|rs_leader_score|rs_leader_test|leader_shadow|RS_SHADOW_KEYS|"
                      r"shadow_fields|steady_last")
    hits = set()
    for path in (ROOT / "api").rglob("*.py"):
        rel = path.relative_to(ROOT).as_posix()
        if rel.startswith("api/services/rs_leader_test/"):
            continue
        if word.search(path.read_text(encoding="utf-8", errors="ignore")):
            hits.add(rel)
    assert hits == allowed
    assert not any(p.startswith("api/routers/") or p == "api/main.py" for p in hits)


# ───────────────────────── every flag combination: the services ──────────────

@pytest.mark.parametrize("combo", COMBOS, ids=["+".join(n for n, on in zip(FLAGS, c) if on) or "all-off"
                                               for c in COMBOS])
def test_no_service_payload_names_the_score(filled, monkeypatch, combo):
    _set_flags(monkeypatch, *combo)
    meta = F.meta(user_id=None)
    assert not _leaks(meta)
    assert not (set(KEYS) & {f["key"] for f in meta["filters"]})
    assert not (set(KEYS) & {c for v in meta["views"] for c in v["columns"]})
    assert not (set(KEYS) & set(meta["picker_hidden"]))
    assert not (set(KEYS) & {c["key"] for c in meta["comparable_fields"]})
    assert not _leaks(F.field_catalog()) and not _leaks(F.field_options())
    assert not _leaks(saved_screens.starters())
    assert not _leaks(methodology.all_methods())
    assert all(methodology.for_column(k) is None for k in KEYS)
    assert not _leaks(snapshot_db.status())
    # every view's scan: the rows a member receives carry no such key and no such value
    for view in F.VIEWS:
        out = query.run_scan({"view": view, "page_size": 200})
        assert out["rows"], view
        assert not _leaks(out), view
        assert not (set(KEYS) & set(out["rows"][0])), view
    # the screen whose gate the history records, exactly as a member runs it
    leaders = next(s for s in saved_screens._starter_defs() if s["id"] == "starter_momentum_leaders")
    assert not _leaks(query.run_scan(leaders["spec"]))


@pytest.mark.parametrize("key", KEYS)
def test_asking_for_a_shadow_key_by_name_is_refused(filled, monkeypatch, key):
    """A member who guesses a name gets a refusal from every door a column name can
    come through, not a value: filter, sort, second sort, columns, rank, comparison."""
    for combo in (COMBOS[0], COMBOS[-1]):
        _set_flags(monkeypatch, *combo)
        doors = {
            "filter": {"filters": [{"key": key, "op": "gte", "min": 0}]},
            "sort": {"sort": {"key": key, "dir": "desc"}},
            "then": {"sort": {"key": "price", "dir": "desc", "then": {"key": key, "dir": "asc"}}},
            "columns": {"columns": ["ticker", key]},
            "rank": {"rank": {"criteria": [{"key": key, "weight": 1}]}},
            "compare": {"filters": [{"key": "price", "op": "gt_col", "other": key}]},
        }
        for door, spec in doors.items():
            with pytest.raises(ValueError):
                query.run_scan(spec)
            with pytest.raises(ValueError):
                query.preview_count(spec)


# ───────────────────────── every flag combination: the routes ────────────────

def _client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    monkeypatch.setattr(screener_mod.scr_saved, "list_for", lambda uid: [])
    # `_rs_history_block` imports api.main (the whole app) to read one flag; not this test's.
    monkeypatch.setattr(screener_mod, "_rs_history_block", lambda: {"enabled": True})
    paid = {"id": "u1", "role": "member", "plan": "pro"}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(paid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(paid)
    return TestClient(app)


GETS = ("/api/screener/meta", "/api/screener/fields?options=1", "/api/screener/methodology",
        "/api/screener/snapshot-status", "/api/screener/saved-screens")


def test_no_route_a_member_can_call_names_the_score(filled, monkeypatch):
    client = _client(monkeypatch)
    for combo in COMBOS:
        _set_flags(monkeypatch, *combo)
        for url in GETS:
            r = client.get(url)
            assert r.status_code == 200, (combo, url, r.text[:200])
            assert not LEAK.search(r.text), (combo, url, LEAK.findall(r.text)[:3])
        for view in F.VIEWS:
            r = client.post("/api/screener/scan", json={"view": view, "page_size": 200})
            assert r.status_code == 200, (combo, view, r.text[:200])
            assert r.json()["rows"] and not LEAK.search(r.text), (combo, view)
        for key in KEYS:
            assert client.get(f"/api/screener/methodology?column={key}").status_code == 404
            for body in ({"filters": [{"key": key, "op": "gte", "min": 0}]},
                         {"sort": {"key": key, "dir": "desc"}}, {"columns": ["ticker", key]}):
                r = client.post("/api/screener/scan", json=body)
                assert r.status_code == 400, (combo, key, body)
                r = client.post("/api/screener/count", json=body)
                assert r.status_code == 400, (combo, key, body)


def test_the_leak_pattern_would_catch_a_leak(filled, monkeypatch):
    """The control for every assertion above: put one value where a member could read it
    and the same check goes red."""
    assert _leaks({"rows": [{"ticker": "A1", "rs_leader_score": 62.28}]}) == ["rs_leader_score"]
    assert _leaks({"note": "Leader score computed"}) and _leaks(["rs_ls_group"]) and _leaks("rs_steady")
    assert not _leaks({"view": "rs_leaders", "name": "UCT RS Leaders", "id": "starter_rs_leaders"})
    with closing(snapshot_db.connect()) as conn:
        side = [dict(r) for r in conn.execute(f"SELECT * FROM {rs_leader_shadow.TABLE} LIMIT 1")]
    assert _leaks(side), "the side table itself does hold the names"
