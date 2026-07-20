"""Task 4: propagation — the merged (owner + engine-overlay) membership
authority reaches Theme Tracker enrichment / theme-index / rotation / voice,
plus the wire taxonomy handshake and the post-engine-run invalidation hook.

Adaptations from the task brief (real code shapes forced them):
- Tests 1-2: `_enrich_with_taxonomy` consumes the theme-performance response
  shape {"themes": [{name, ticker, holdings: [{sym, returns, ref_prices}, ...]}]}
  — NOT the {theme_id: {... "holdings": [syms]}} map sketched in the brief.
  The wire key lives in each theme's "ticker" field and holdings are per-sym
  dicts, so inputs and asserts are re-shaped accordingly (assert against
  out["themes"][0]). The appended-member assert also checks the real appended
  holding shape (source tag + null returns) and the `_owner_syms` stash.
- Test 6: the real chart_health_alerts.emit signature is
  emit(alert_key, severity, message, metadata=None); push calls it as
  emit(kind, "warning", message=...), which the brief's 2-positional lambda
  still captures — the test body is unchanged from the brief.
- Tests 3, 4, 5: verbatim from the brief.
- Added a 7th smoke test for theme_engine.invalidate.post_engine_run (the
  artifact this task produces for T5/T6/T7) — not in the brief's six.
"""


def test_enrich_lookup_indexes_id_first(monkeypatch):
    import api.services.theme_performance as tp
    monkeypatch.setattr(tp.theme_db, "get_all_themes", lambda: {"themes": [
        {"id": "ai_gpu_chips", "name": "RENAMED IN DB", "etf_ticker": None, "sector_id": "tech",
         "sub_themes": [], "holdings": [{"sym": "NVDA", "tier": "core", "source": "owner"}]}], "sectors": []})
    themes = {"themes": [
        {"name": "AI / GPU Chips", "ticker": "ai_gpu_chips",
         "holdings": [{"sym": "NVDA", "returns": {}, "ref_prices": {}}]}]}
    out = tp._enrich_with_taxonomy(themes)
    assert out["themes"][0].get("sector_id") == "tech"     # id join hit despite name drift


def test_enrich_appends_engine_members_with_null_return(monkeypatch):
    import api.services.theme_performance as tp
    monkeypatch.setattr(tp.theme_db, "get_all_themes", lambda: {"themes": [
        {"id": "ai", "name": "AI", "etf_ticker": None, "sector_id": "tech", "sub_themes": [],
         "holdings": [{"sym": "NVDA", "tier": "core", "source": "owner"},
                      {"sym": "SMCI", "tier": "peripheral", "source": "engine"}]}], "sectors": []})
    themes = {"themes": [
        {"name": "AI", "ticker": "ai",
         "holdings": [{"sym": "NVDA", "returns": {"1d": 1.0}, "ref_prices": {}}]}]}
    out = tp._enrich_with_taxonomy(themes)
    holdings = {h["sym"]: h for h in out["themes"][0]["holdings"]}
    assert "SMCI" in holdings                              # appended, priced next recompute
    assert holdings["SMCI"]["source"] == "engine"
    assert all(v is None for v in holdings["SMCI"]["returns"].values())
    assert "NVDA" in out["themes"][0]["_owner_syms"]       # aggregate-step input
    assert "SMCI" not in out["themes"][0]["_owner_syms"]   # engine member never in owner basket


def test_group_return_uses_owner_rows_only():
    import api.services.theme_performance as tp
    # helper introduced by this task:
    vals = tp._owner_only_mean({"NVDA": 5.0, "SMCI": -40.0}, owner_syms={"NVDA"})
    assert vals == 5.0


def test_rotation_order_keys_by_wire_ticker(monkeypatch):
    from api.services import groups
    import api.services.theme_performance as tp
    sig = {"rankings": {"ai_gpu_chips": {"name": "WHATEVER", "ticker": "ai_gpu_chips", "1w_rank": 90.0}}}
    monkeypatch.setattr(tp, "compute_rotation_signals", lambda: sig)
    order = groups._rotation_order()
    assert order.get("ai_gpu_chips") == 0                  # keyed by ticker/id, not name


def test_voice_today_skips_pseudo_tickers(monkeypatch):
    import api.services.engine as eng
    captured = {}
    def fake_snap(tickers):
        captured["t"] = list(tickers); return {}
    monkeypatch.setattr(eng, "get_etf_snapshots", fake_snap, raising=False)
    # call the internal helper this task extracts:
    eng._snapshot_real_etfs(["SMH", "ai_gpu_chips", "XLE", "mortgage_reits"])
    assert captured["t"] == ["SMH", "XLE"]


def test_push_handshake_alerts_on_version_mismatch(monkeypatch):
    import api.routers.push as push
    fired = {}
    monkeypatch.setattr(push, "_taxonomy_version_stored", lambda: "4.16.0+aaa")
    monkeypatch.setattr(push.chart_health_alerts, "emit",
                        lambda kind, msg, **kw: fired.setdefault("kind", kind), raising=False)
    push._check_taxonomy_handshake({"taxonomy_version": "4.2.0"})
    assert fired.get("kind") == "taxonomy_version_mismatch"


def test_post_engine_run_calls_all_invalidators(monkeypatch):
    from api.services.theme_engine import invalidate
    from api.services import groups, theme_index
    import api.services.theme_performance as tp
    called = []
    monkeypatch.setattr(groups, "invalidate_sizes", lambda: called.append("groups"))
    monkeypatch.setattr(tp, "invalidate_memory_cache", lambda: called.append("perf"))
    monkeypatch.setattr(theme_index, "invalidate_cache", lambda: called.append("index"))
    invalidate.post_engine_run()
    assert called == ["groups", "perf", "index"]
