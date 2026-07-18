from api.services.screener import snapshot_db


def test_get_rows_batches_and_matches_pk(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "RKLB", "price": 24.0, "avg_volume_30d": 9_000_000, "adr_pct": 6.1, "built_at": 111},
        {"ticker": "ASTS", "price": 40.0, "avg_volume_30d": 3_000_000, "adr_pct": 8.0, "built_at": 111},
    ])
    out = snapshot_db.get_rows(["rklb", "ASTS", "ZZZZ"])   # lower-case + a miss
    assert set(out.keys()) == {"RKLB", "ASTS"}             # matched, PK-cased; miss absent
    assert out["RKLB"]["price"] == 24.0
    assert out["ASTS"]["adr_pct"] == 8.0
    assert snapshot_db.get_rows([]) == {}
