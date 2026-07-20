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
    # Grounding lookup (I-1) — patched so tests never hit the live industry map.
    monkeypatch.setattr(orph, "_industry_of", lambda sym: None)


def test_liquid_orphan_below_085_is_skipped(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.80, "rationale": "r"})
    res = orph.run_orphan_batch(batch=1, dry_run=False)
    assert res["added"] == 0 and res["skipped"] == 1          # 0.80 < 0.85 for liquid
    assert "LIQ1" in store.decided_recent_syms(35)            # decision recorded (below_gate)


def test_liquid_orphan_at_086_with_corroboration_WRITES(monkeypatch, store):
    # Review I-5(c): the second half of the old 085 test never re-ran the batch
    # (decision memory blocked LIQ1), so the liquid WRITE path was never exercised.
    # _patch_env gives 2-name cohort overlap (PNC/USB) -> corroborated + beats
    # incumbent; 0.86 clears the 0.85 liquid bar.
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.86, "rationale": "r"})
    res = orph.run_orphan_batch(batch=1, dry_run=False)     # first candidate LIQ1 is liquid
    assert res["added"] == 1
    assert [r["sym_hy"] for r in store.engine_rows()] == ["LIQ1"]


def test_per_theme_add_cap(monkeypatch, store):
    # Review I-5(b): MAX_ADDS_PER_THEME_PER_RUN caps how many the engine adds to
    # ONE theme in a single run — the second same-theme add is skipped.
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_orphan_candidates_ordered", lambda: ["TAIL1", "TAIL2"])
    monkeypatch.setattr(orph, "_is_liquid", lambda sym: False)   # 0.75 tail gate
    monkeypatch.setattr(orph, "_in_cap", lambda sym: True)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.9, "rationale": "r"})
    monkeypatch.setenv("THEME_ENGINE_MAX_ADDS_PER_THEME_PER_RUN", "1")
    res = orph.run_orphan_batch(batch=2, dry_run=False)
    assert res["added"] == 1 and res["skipped"] == 1
    assert [r["sym_hy"] for r in store.engine_rows()] == ["TAIL1"]


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


def test_daily_report_groups_adds_by_theme(monkeypatch, store):
    # Digest for the nightly Discord ping: names grouped by theme + the run counts.
    monkeypatch.setattr(orph, "store", store)
    r = store.start_run("orphan")
    store.upsert_add("regional_banks", "FBIZ", "peripheral", None, 0.9, "x", r)
    store.upsert_add("regional_banks", "OSBC", "peripheral", None, 0.9, "x", r)
    store.upsert_add("reits", "SUI", "peripheral", None, 0.9, "x", r)
    text = orph.daily_report_text({"run_id": r, "examined": 50, "added": 3,
                                   "retiered": 0, "dropped": 0, "skipped": 47})
    assert "Absorbed 3 orphans:" in text
    assert "FBIZ, OSBC → regional_banks" in text               # append order preserved
    assert "SUI → reits" in text
    assert "Examined 50 · added 3 · retiered 0 · dropped 0 · skipped 47" in text
    assert "LLM spend:" in text


def test_daily_report_zero_adds_is_quiet_line(monkeypatch, store):
    monkeypatch.setattr(orph, "store", store)
    r = store.start_run("orphan")
    text = orph.daily_report_text({"run_id": r, "examined": 40, "added": 0,
                                   "retiered": 0, "dropped": 0, "skipped": 40})
    assert "No new memberships tonight." in text
    assert "added 0" in text


def test_daily_report_tolerates_missing_result(monkeypatch, store):
    # A notification must never crash on a partial/None result (batch errored path).
    monkeypatch.setattr(orph, "store", store)
    assert "No new memberships tonight." in orph.daily_report_text(None)
