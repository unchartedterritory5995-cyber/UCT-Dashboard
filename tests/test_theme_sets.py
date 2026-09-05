"""Per-user custom theme SETS — store + read-time overlay.

The load-bearing invariant: applying a user's set NEVER mutates the shared base result
(so it can never move anyone else's numbers), and edits aggregate with the same owner-only
rule as the shared tracker.
"""
import copy
import importlib

import pytest


@pytest.fixture
def ts(tmp_path, monkeypatch):
    monkeypatch.setenv("THEME_SETS_ENABLED", "1")
    monkeypatch.setenv("THEME_SETS_DB_PATH", str(tmp_path / "theme_sets.db"))
    import api.services.theme_sets as mod
    importlib.reload(mod)          # pick up the tmp path + reset _inited
    mod.init_db()
    return mod


# ── store ─────────────────────────────────────────────────────────────────────

def test_create_list_get_replace_delete(ts):
    s = ts.create_set("u1", "My Growth")
    assert s and s["name"] == "My Growth" and s["id"].startswith("ts_")
    assert ts.list_sets("u1") == [{"id": s["id"], "name": "My Growth", "sort_order": 0}]

    got = ts.get_set("u1", s["id"])
    assert got["hidden"] == [] and got["custom"] == []

    upd = ts.replace_set("u1", s["id"], "Renamed", {
        "hidden": ["cybersecurity"],
        "removed": {"memory-hbm": ["AVGO"]},
        "added": {"memory-hbm": ["mu"]},
        "custom": [{"key": "custom:1", "name": "My Memes", "members": ["GME", "amc"]}],
    })
    assert upd["name"] == "Renamed"
    assert upd["hidden"] == ["cybersecurity"]
    assert upd["removed"] == {"memory-hbm": ["AVGO"]}
    assert upd["added"] == {"memory-hbm": ["MU"]}            # sym upper-cased
    assert upd["custom"][0]["members"] == ["GME", "AMC"]

    assert ts.delete_set("u1", s["id"]) is True
    assert ts.get_set("u1", s["id"]) is None


def test_ownership_isolation(ts):
    a = ts.create_set("userA", "A set")
    # userB cannot read, edit, or delete userA's set
    assert ts.get_set("userB", a["id"]) is None
    assert ts.replace_set("userB", a["id"], "hijack", {}) is None
    assert ts.delete_set("userB", a["id"]) is False
    assert ts.list_sets("userB") == []
    # userA still intact
    assert ts.get_set("userA", a["id"])["name"] == "A set"


def test_caps_and_sanitize(ts):
    # bad syms dropped; over-long name trimmed
    s = ts.create_set("u", "x" * 200, {"added": {"t": ["OK", "bad sym!", "", "TOOLONGTICKERXX"]}})
    assert len(s["name"]) <= 60
    assert s["added"]["t"] == ["OK"]                        # only the valid ticker survives
    # set cap
    for i in range(ts._MAX_SETS_PER_USER):
        ts.create_set("capped", f"s{i}")
    assert ts.create_set("capped", "one too many") is None


def test_enabled_flag(ts, monkeypatch):
    monkeypatch.setenv("THEME_SETS_ENABLED", "0")
    import importlib
    importlib.reload(ts)
    assert ts.enabled() is False


# ── overlay (apply_theme_set) ──────────────────────────────────────────────────

def _base():
    return {"themes": [
        {"ticker": "XLK", "name": "Cybersecurity", "sector": "Tech",
         "group_return": {"1d": 1.0},
         "holdings": [
             {"sym": "CRWD", "name": "CrowdStrike", "returns": {"1d": 2.0, "1w": 5.0},
              "ref_prices": {"1d": 100.0}, "source": "owner"},
             {"sym": "PANW", "name": "Palo Alto", "returns": {"1d": 4.0, "1w": 3.0},
              "ref_prices": {"1d": 200.0}, "source": "owner"},
         ]},
        {"ticker": "SMH", "name": "Memory & HBM", "sector": "Tech",
         "group_return": {"1d": 3.0},
         "holdings": [
             {"sym": "MU", "name": "Micron", "returns": {"1d": 6.0}, "ref_prices": {}, "source": "owner"},
             {"sym": "AVGO", "name": "Broadcom", "returns": {"1d": 1.0}, "ref_prices": {}, "source": "owner"},
         ]},
    ]}


def test_hide_theme_drops_it_only(monkeypatch):
    import api.services.theme_performance as tp
    out = tp.apply_theme_set(_base(), {"id": "s", "name": "S", "hidden": ["cybersecurity"]})
    names = [t["name"] for t in out["themes"]]
    assert names == ["Memory & HBM"]                         # Cybersecurity hidden, rest intact
    assert out["theme_set"] == {"id": "s", "name": "S"}


def test_remove_sym_reaggregates(monkeypatch):
    import api.services.theme_performance as tp
    out = tp.apply_theme_set(_base(), {"removed": {"memory-hbm": ["AVGO"]}})
    mem = next(t for t in out["themes"] if t["name"] == "Memory & HBM")
    syms = [h["sym"] for h in mem["holdings"]]
    assert syms == ["MU"]                                    # AVGO removed
    assert mem["group_return"]["1d"] == 6.0                  # re-aggregated to just MU
    assert mem["user_edited"] is True


def test_add_sym_included_and_counts(monkeypatch):
    import api.services.theme_performance as tp
    # NVDA is off-taxonomy here -> mini-compute; stub it.
    monkeypatch.setattr(tp, "live_returns_for_syms",
                        lambda syms: {"NVDA": {"sym": "NVDA", "name": "NVDA",
                                               "returns": {"1d": 10.0}, "ref_prices": {}, "source": "user"}})
    out = tp.apply_theme_set(_base(), {"added": {"cybersecurity": ["NVDA"]}})
    cyber = next(t for t in out["themes"] if t["name"] == "Cybersecurity")
    syms = [h["sym"] for h in cyber["holdings"]]
    assert "NVDA" in syms
    added = next(h for h in cyber["holdings"] if h["sym"] == "NVDA")
    assert added["source"] == "user"


def test_custom_theme_appears(monkeypatch):
    import api.services.theme_performance as tp
    # Members reuse the in-taxonomy index where possible (CRWD present); GME off-taxonomy -> stub.
    monkeypatch.setattr(tp, "live_returns_for_syms",
                        lambda syms: {"GME": {"sym": "GME", "name": "GME",
                                              "returns": {"1d": 20.0}, "ref_prices": {}, "source": "user"}})
    out = tp.apply_theme_set(_base(), {"custom": [
        {"key": "custom:1", "name": "My Memes", "members": ["CRWD", "GME"]}]})
    custom = next(t for t in out["themes"] if t.get("is_custom"))
    assert custom["name"] == "My Memes" and custom["custom_key"] == "custom:1"
    assert {h["sym"] for h in custom["holdings"]} == {"CRWD", "GME"}
    assert "1d" in custom["group_return"]


def test_apply_never_mutates_the_shared_base(monkeypatch):
    import api.services.theme_performance as tp
    monkeypatch.setattr(tp, "live_returns_for_syms",
                        lambda syms: {s and __import__("api.services.theme_performance",
                                                       fromlist=["_ts_key"])._ts_key(s):
                                      {"sym": s, "name": s, "returns": {"1d": 9.0},
                                       "ref_prices": {}, "source": "user"} for s in syms})
    base = _base()
    snapshot = copy.deepcopy(base)
    tp.apply_theme_set(base, {
        "hidden": ["cybersecurity"],
        "removed": {"memory-hbm": ["AVGO"]},
        "added": {"memory-hbm": ["TSLA"]},
        "custom": [{"key": "c", "name": "C", "members": ["TSLA"]}],
    })
    assert base == snapshot                                  # base untouched, byte-for-byte


def test_empty_set_is_identity(monkeypatch):
    import api.services.theme_performance as tp
    base = _base()
    out = tp.apply_theme_set(base, {"id": "s", "name": "S"})
    # Same themes, same group returns (untouched themes reused as-is).
    assert [t["name"] for t in out["themes"]] == [t["name"] for t in base["themes"]]
    assert out["themes"][0]["group_return"] == base["themes"][0]["group_return"]


# -- router integration (TestClient) -------------------------------------------

def test_router_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setenv("THEME_SETS_ENABLED", "1")
    monkeypatch.setenv("THEME_SETS_DB_PATH", str(tmp_path / "r.db"))
    import importlib
    import api.services.theme_sets as s
    importlib.reload(s)
    s.init_db()
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import theme_sets as r
    importlib.reload(r)

    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[r.require_paid] = lambda: {"id": "userA"}
    c = TestClient(app)

    # enabled + empty
    assert c.get("/api/theme-sets").json() == {"enabled": True, "sets": []}
    # create
    sid = c.post("/api/theme-sets", json={"name": "My Growth"}).json()["id"]
    assert [x["name"] for x in c.get("/api/theme-sets").json()["sets"]] == ["My Growth"]
    # edit (PUT whole diff)
    put = c.put(f"/api/theme-sets/{sid}", json={
        "name": "Growth", "hidden": ["cybersecurity"],
        "removed": {"memory-hbm": ["AVGO"]},
        "custom": [{"key": "k1", "name": "Memes", "members": ["gme"]}],
    }).json()
    assert put["name"] == "Growth" and put["hidden"] == ["cybersecurity"]
    assert put["custom"][0]["members"] == ["GME"]
    # read back
    got = c.get(f"/api/theme-sets/{sid}").json()
    assert got["removed"] == {"memory-hbm": ["AVGO"]}

    # ownership: a different user can't see or delete it
    app.dependency_overrides[r.require_paid] = lambda: {"id": "userB"}
    assert c.get(f"/api/theme-sets/{sid}").status_code == 404
    assert c.delete(f"/api/theme-sets/{sid}").status_code == 404
    assert c.get("/api/theme-sets").json()["sets"] == []

    # owner deletes
    app.dependency_overrides[r.require_paid] = lambda: {"id": "userA"}
    assert c.delete(f"/api/theme-sets/{sid}").json() == {"ok": True}
    assert c.get("/api/theme-sets").json()["sets"] == []


def test_router_disabled_refuses_writes(tmp_path, monkeypatch):
    monkeypatch.setenv("THEME_SETS_ENABLED", "0")
    monkeypatch.setenv("THEME_SETS_DB_PATH", str(tmp_path / "d.db"))
    import importlib
    import api.services.theme_sets as s
    importlib.reload(s)
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import theme_sets as r
    importlib.reload(r)
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[r.require_paid] = lambda: {"id": "u"}
    c = TestClient(app)
    assert c.get("/api/theme-sets").json() == {"enabled": False, "sets": []}
    assert c.post("/api/theme-sets", json={"name": "x"}).status_code == 404   # writes refused


# -- additive/inclusion model (v2) ---------------------------------------------

def test_inclusion_mode_orders_and_filters(monkeypatch):
    import api.services.theme_performance as tp
    # Only these two owner themes, in THIS order (base order is Cyber, then Memory).
    out = tp.apply_theme_set(_base(), {"themes": ["memory-hbm", "cybersecurity"]})
    assert [t["name"] for t in out["themes"]] == ["Memory & HBM", "Cybersecurity"]


def test_clear_all_shows_no_owner_themes(monkeypatch):
    import api.services.theme_performance as tp
    monkeypatch.setattr(tp, "live_returns_for_syms",
                        lambda syms: {"GME": {"sym": "GME", "name": "GME",
                                              "returns": {"1d": 5.0}, "ref_prices": {}, "source": "user"}})
    out = tp.apply_theme_set(_base(), {"themes": [], "custom": [
        {"key": "k", "name": "Mine", "members": ["GME"]}]})
    # empty inclusion -> only the custom theme survives
    assert [t.get("name") for t in out["themes"]] == ["Mine"]


def test_all_themes_palette_returned(monkeypatch):
    import api.services.theme_performance as tp
    out = tp.apply_theme_set(_base(), {"themes": ["cybersecurity"]})
    slugs = {t["slug"] for t in out["all_themes"]}
    assert slugs == {"cybersecurity", "memory-hbm"}          # full palette regardless of inclusion


def test_inclusion_still_never_mutates_base(monkeypatch):
    import api.services.theme_performance as tp
    import copy
    base = _base(); snap = copy.deepcopy(base)
    tp.apply_theme_set(base, {"themes": ["memory-hbm"], "removed": {"memory-hbm": ["AVGO"]}})
    assert base == snap


def test_sanitize_themes_list(ts):
    s = ts.create_set("u", "S", {"themes": ["Cyber", "cyber", "", "memory-hbm"]})
    assert s["themes"] == ["cyber", "memory-hbm"]            # lowercased + deduped, order kept
    # absent themes -> None (all-defaults mode)
    s2 = ts.create_set("u", "S2", {})
    assert s2["themes"] is None
