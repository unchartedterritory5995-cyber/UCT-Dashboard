import os, tempfile, importlib
import pytest

@pytest.fixture()
def store(monkeypatch, tmp_path):
    # Point auth_db at a scratch DB (house pattern: AUTH_DB_PATH env honored by auth_db)
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as auth_db
    importlib.reload(auth_db)
    import api.services.theme_engine.store as st
    importlib.reload(st)
    st.init_engine_tables()
    return st

def test_upsert_add_then_retier_preserves_lineage(store):
    r1 = store.start_run("orphan")
    assert store.upsert_add("ai_infrastructure", "MRVL", "peripheral", None, 0.9, "seed", r1) == "added"
    r2 = store.start_run("improve")
    assert store.upsert_add("ai_infrastructure", "MRVL", "relevant", None, 0.92, "up", r2) == "retiered"
    row = store.engine_rows("ai_infrastructure")[0]
    assert row["tier"] == "relevant"
    assert row["created_run_id"] == r1 and row["updated_run_id"] == r2   # lineage immutable

def test_rollback_retier_restores_prior_tier_add_removes_row(store):
    r1 = store.start_run("orphan"); store.upsert_add("t", "AAA", "peripheral", None, .8, "x", r1)
    r2 = store.start_run("improve"); store.upsert_add("t", "AAA", "relevant", None, .9, "y", r2)
    store.rollback_run(r2)
    assert store.engine_rows("t")[0]["tier"] == "peripheral"   # inverse-event replay, not DELETE
    store.rollback_run(r1)
    assert store.engine_rows("t") == []                        # add rolled back -> absent

def test_decision_memory_window(store):
    r = store.start_run("orphan")
    store.record_decision("ZZZQ", "none", None, 0.4, r)
    assert "ZZZQ" in store.decided_recent_syms(35)
    assert "ZZZQ" not in store.decided_recent_syms(0)          # window expired -> re-eligible

def test_cost_log_and_day_total(store):
    r = store.start_run("orphan")
    c = store.log_cost(r, "claude-opus-4-8", 2000, 250)        # $5/M in + $25/M out
    assert abs(c - (2000*5/1e6 + 250*25/1e6)) < 1e-9
    assert store.day_cost_usd() >= c

def test_dot_conversion_single_point(store):
    r = store.start_run("orphan")
    store.upsert_add("financials_broad", "BRK-B", "peripheral", None, .8, "x", r)
    row = store.engine_rows("financials_broad")[0]
    assert row["sym"] == "BRK.B" and row["sym_hy"] == "BRK-B"

def test_abort_stale_runs(store):
    r = store.start_run("orphan")
    with store._conn() as c:
        c.execute("UPDATE engine_runs SET started_at=datetime('now','-4 hours') WHERE run_id=?", (r,))
        c.commit()
    assert store.abort_stale_runs(3) == 1

def test_suppress_lifecycle(store):
    r = store.start_run("improve")
    store.suppress_propose("space", "LMT", "off-theme", r)
    assert store.engine_rows("space") == []                    # suppress rows never merge
    store.set_suppress_status("space", "LMT", "dismissed")
    assert store.pending_suppressions() == []                  # dismissed never resurfaces
