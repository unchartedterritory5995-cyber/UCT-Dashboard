"""Task 3: groups.py engine-invariance — background engine adds must NEVER
change which group a member's keypress fills.

- _theme_sizes counts OWNER rows only (absent source = owner, counted)
- an owner membership always outranks any engine membership in
  resolve_primary_theme (engine 'relevant' never beats owner 'peripheral')
- top_n rows carry per-sym source for the cell dot
- invalidate_sizes() resets the size cache (wired via theme_db.invalidate_caches)
"""
from api.services import groups


def test_theme_sizes_count_owner_rows_only(monkeypatch):
    fake = {"themes": [{"id": "ai", "holdings": [
        {"sym": "NVDA", "source": "owner"}, {"sym": "SMCI", "source": "engine"}]}]}
    monkeypatch.setattr(groups, "_get_all_themes", lambda: fake)
    groups.invalidate_sizes()
    assert groups._theme_sizes() == {"ai": 1}


def test_owner_membership_always_outranks_engine(monkeypatch):
    rows = [
        {"theme_id": "eng_t", "theme_name": "Engine Theme", "tier": "relevant", "sub_theme_id": None, "source": "engine"},
        {"theme_id": "own_t", "theme_name": "Owner Theme", "tier": "peripheral", "sub_theme_id": None, "source": "owner"},
    ]
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: rows)
    monkeypatch.setattr(groups, "_theme_size", lambda tid: 10)
    r = groups.resolve_primary_theme("RKLB")
    assert r["theme_id"] == "own_t"        # engine 'relevant' never beats owner 'peripheral'


def test_top_n_rows_carry_source(monkeypatch):
    monkeypatch.setattr(groups, "_theme_holdings",
        lambda tid: [{"sym": "NVDA", "tier": "core", "rationale": "x", "source": "owner"},
                     {"sym": "SMCI", "tier": "peripheral", "rationale": "y", "source": "engine"}])
    import api.services.theme_db as tdb
    monkeypatch.setattr(tdb, "get_theme_holdings", groups._theme_holdings)
    monkeypatch.setattr(groups, "rank_holdings",
        lambda h, by="today", seed=None, seed_sub=None, scores_out=None: ["NVDA", "SMCI"])
    out = groups.top_n("ai", 2)
    assert out["rows"][0]["source"] == "owner" and out["rows"][1]["source"] == "engine"


def test_invalidate_sizes_resets_cache(monkeypatch):
    groups._SIZES_CACHE["map"] = {"stale": 1}; groups._SIZES_CACHE["at"] = 1e18
    groups.invalidate_sizes()
    assert groups._SIZES_CACHE["map"] is None
