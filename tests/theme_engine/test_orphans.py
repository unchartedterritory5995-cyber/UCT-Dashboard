"""Task 5 — Loop 1 orphan classifier. All tests mock _adjudicate (no LLM calls);
helpers are module-level in orphans.py specifically so they monkeypatch cleanly."""
import api.services.theme_engine.orphans as orph


def _patch_env(monkeypatch, store):
    monkeypatch.setattr(orph, "store", store)
    monkeypatch.setattr(orph, "_orphan_candidates_ordered", lambda: ["LIQ1", "TAIL1", "GONE1"])
    monkeypatch.setattr(orph, "_theme_roster", lambda tid: {"PNC", "USB", "CFG"})
    monkeypatch.setattr(orph, "_industry_cohort", lambda sym: {"PNC", "USB", "ZION"})
    monkeypatch.setattr(orph, "_is_liquid", lambda sym: sym.startswith("LIQ"))
    monkeypatch.setattr(orph, "_theme_exists", lambda tid: tid == "regional_banks")
    monkeypatch.setattr(orph, "_in_cap", lambda sym: sym != "GONE1")
    monkeypatch.setattr(orph, "_industry_matches_theme", lambda sym, tid: False)


def test_liquid_orphan_needs_085_plus_corroboration(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.80, "rationale": "r"})
    res = orph.run_orphan_batch(batch=1, dry_run=False)
    assert res["added"] == 0 and res["skipped"] == 1          # 0.80 < 0.85 for liquid
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.86, "rationale": "r"})
    store2 = store  # decision memory: LIQ1 already decided below_gate -> excluded
    assert "LIQ1" in store.decided_recent_syms(35)


def test_beat_the_incumbent_requires_cohort_overlap(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_theme_roster", lambda tid: {"AAA", "BBB"})   # 0 cohort overlap
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.95, "rationale": "r"})
    res = orph.run_orphan_batch(batch=1, dry_run=False)
    assert res["added"] == 0                                   # NONE recorded, industry fill kept


def test_dry_run_records_decisions_but_writes_no_rows(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.9, "rationale": "r"})
    res = orph.run_orphan_batch(batch=2, dry_run=True)
    assert store.engine_rows() == [] and res["examined"] == 2


def test_cost_cap_halts_run(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.9, "rationale": "r"})
    monkeypatch.setattr(orph.store, "day_cost_usd", lambda: 99.0)
    res = orph.run_orphan_batch(batch=3, dry_run=False)
    assert res["cost_capped"] is True and res["examined"] == 0


def test_malformed_verdict_never_kills_the_batch(monkeypatch, store):
    # Review Important #1: a deterministic bad LLM response (non-numeric
    # confidence, non-string theme_id) must skip THAT sym and continue — the
    # old behavior aborted the whole nightly batch at the same sym forever.
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_orphan_candidates_ordered", lambda: ["BAD1", "GOOD1"])
    def verdicts(ctx):
        if ctx["sym"] == "BAD1":
            return {"theme_id": {"weird": 1}, "confidence": "high"}   # both malformed
        return {"theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.9, "rationale": "r"}
    monkeypatch.setattr(orph, "_adjudicate", verdicts)
    monkeypatch.setattr(orph, "_is_liquid", lambda sym: False)        # 0.75 gate for GOOD1
    monkeypatch.setattr(orph, "_industry_matches_theme", lambda sym, tid: True)
    res = orph.run_orphan_batch(batch=2, dry_run=False)
    assert res["examined"] == 2
    assert res["added"] == 1                                          # GOOD1 landed
    # BAD1's theme_id dict was sanitized to None -> decision 'none', no crash,
    # no row, and the run ledger closed cleanly (no error).
    rows = store.engine_rows()
    assert [r["sym_hy"] for r in rows] == ["GOOD1"]
