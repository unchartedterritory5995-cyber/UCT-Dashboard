"""Task 2 — merged owner+engine reads in theme_db + reseed GC + content-hash gate.

Owner rows (theme_memberships, seeded by the `db` fixture: tech/ai/NVDA) always
win; engine 'add' rows fill around them; suppress rows and dangling-theme rows
never merge. seed_from_json GC-sweeps the overlay and reseeds on content drift
even without a version bump.
"""


def test_merge_owner_precedence_and_source_tags(db):
    # engine row for a sym the owner ALSO holds -> owner wins, no duplicate
    db.store.upsert_add("ai", "NVDA", "peripheral", None, .9, "dup", db.run)
    db.store.upsert_add("ai", "SMCI", "peripheral", None, .9, "new", db.run)
    holds = db.theme_db.get_theme_holdings("ai")
    syms = sorted((h["sym"], h["source"]) for h in holds)
    assert syms == [("NVDA", "owner"), ("SMCI", "engine")]


def test_suppress_rows_and_dangling_theme_filtered(db):
    db.store.suppress_propose("ai", "NVDA", "off-theme", db.run)       # never merges
    db.store.upsert_add("ghost_theme", "AAA", "peripheral", None, .9, "x", db.run)
    assert all(h["sym"] != "AAA" for t in db.theme_db.get_all_themes()["themes"] for h in t["holdings"])


def test_get_themes_for_ticker_normalizes_hyphen_input(db):
    db.store.upsert_add("ai", "BRK-B", "peripheral", None, .8, "x", db.run)
    rows = db.theme_db.get_themes_for_ticker("BRK-B")                  # hyphen in
    assert rows and rows[0]["source"] == "engine"


def test_reseed_gc_sweeps_orphaned_and_owner_dup_engine_rows(db, tmp_path):
    db.store.upsert_add("ai", "SMCI", "peripheral", None, .9, "x", db.run)      # will become owner-dup
    db.store.upsert_add("dead_theme", "BBB", "peripheral", None, .9, "x", db.run)
    tax = {"version": "9.9.9", "sectors": [{"id": "tech", "name": "T"}],
           "themes": [{"id": "ai", "name": "AI", "sector_id": "tech",
                       "holdings": [{"sym": "NVDA"}, {"sym": "SMCI"}]}]}   # owner curated SMCI
    p = tmp_path / "tax.json"; p.write_text(__import__("json").dumps(tax), encoding="utf-8")
    db.monkeypatch.setattr(db.theme_db, "_find_taxonomy_file", lambda: str(p))
    assert db.theme_db.seed_from_json() is True
    left = db.store.engine_rows()
    assert left == []                                                  # both swept


def test_content_hash_gate_reseeds_on_unbumped_edit(db, tmp_path):
    import json
    tax = {"version": "1.0.0", "sectors": [{"id": "tech", "name": "T"}],
           "themes": [{"id": "ai", "name": "AI", "sector_id": "tech", "holdings": [{"sym": "NVDA"}]}]}
    p = tmp_path / "tax.json"; p.write_text(json.dumps(tax), encoding="utf-8")
    db.monkeypatch.setattr(db.theme_db, "_find_taxonomy_file", lambda: str(p))
    db.theme_db.seed_from_json()
    tax["themes"][0]["holdings"].append({"sym": "AMD"})               # edit WITHOUT version bump
    p.write_text(json.dumps(tax), encoding="utf-8")
    db.theme_db.seed_from_json()
    syms = {h["sym"] for h in db.theme_db.get_theme_holdings("ai")}
    assert "AMD" in syms                                              # hash gate caught it
