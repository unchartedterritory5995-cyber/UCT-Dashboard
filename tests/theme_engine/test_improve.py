"""Task 6 — Loop 2 self-improvement + co-movement audit. Brief's 4 tests verbatim
plus one per-item-isolation test for _apply_theme_verdict. No LLM calls: heat and
correlation helpers are module-level in improve.py so they monkeypatch cleanly."""
import api.services.theme_engine.improve as imp


def test_pick_themes_heat_ordered(monkeypatch):
    monkeypatch.setattr(imp, "_rotation_heat", lambda: ["uranium_miners", "ai_gpu_chips"])
    monkeypatch.setattr(imp, "_all_theme_ids", lambda: ["cold_a", "uranium_miners", "ai_gpu_chips", "cold_b"])
    assert imp.pick_themes(3) == ["uranium_miners", "ai_gpu_chips", "cold_a"]


def test_owner_row_concern_becomes_suppress_proposal_never_drop(monkeypatch, store):
    monkeypatch.setattr(imp, "store", store)
    r = store.start_run("improve")
    imp._apply_theme_verdict(run_id=r, theme_id="space", verdict={
        "adds": [], "retiers": [], "drops": [],
        "owner_concerns": [{"sym": "LMT", "reason": "off-theme"}]}, dry=False)
    assert store.pending_suppressions()[0]["sym"] == "LMT"
    assert store.engine_rows("space") == []                # nothing applied


def test_comovement_audit_drops_after_two_low_audits(monkeypatch, store):
    monkeypatch.setattr(imp, "store", store)
    r = store.start_run("orphan")
    store.upsert_add("ai", "WEAK", "peripheral", None, .9, "x", r)
    # age the row past 30d:
    with store._conn() as c:
        c.execute("UPDATE engine_memberships SET created_at=datetime('now','-40 days')"); c.commit()
    monkeypatch.setattr(imp, "_corr_vs_theme", lambda sym_hy, tid: 0.05)   # below floor
    a1 = imp.comovement_audit(); assert a1["dropped"] == 0                 # first strike
    a2 = imp.comovement_audit(); assert a2["dropped"] == 1                 # second strike -> drop
    assert store.engine_rows("ai") == []


def test_comovement_none_is_not_a_strike(monkeypatch, store):
    monkeypatch.setattr(imp, "store", store)
    r = store.start_run("orphan")
    store.upsert_add("ai", "COLDBARS", "peripheral", None, .9, "x", r)
    with store._conn() as c:
        c.execute("UPDATE engine_memberships SET created_at=datetime('now','-40 days')"); c.commit()
    monkeypatch.setattr(imp, "_corr_vs_theme", lambda sym_hy, tid: None)   # bars cold -> skip
    assert imp.comovement_audit()["dropped"] == 0
    assert store.engine_rows("ai")[0]["audit_low_count"] == 0


def test_apply_verdict_malformed_add_never_kills_the_theme(monkeypatch, store):
    # Per-item isolation: one malformed add dict (non-string sym, junk tier/conf)
    # must be skipped with warn+continue — the retier later in the SAME verdict
    # still lands. Mirrors T5's malformed-verdict batch test at item granularity.
    monkeypatch.setattr(imp, "store", store)
    r0 = store.start_run("orphan")
    store.upsert_add("space", "GOOD", "peripheral", None, 0.9, "x", r0)
    r = store.start_run("improve")
    imp._apply_theme_verdict(run_id=r, theme_id="space", verdict={
        "adds": [{"sym": {"weird": 1}, "tier": 5, "confidence": "high"}],
        "retiers": [{"sym": "GOOD", "new_tier": "relevant"}],
        "drops": [], "owner_concerns": []}, dry=False)
    rows = store.engine_rows("space")
    assert [(x["sym"], x["tier"]) for x in rows] == [("GOOD", "relevant")]
