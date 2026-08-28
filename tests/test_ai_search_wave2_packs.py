"""Wave-2 pack PROVIDERS (2026-08-27) — each renders real store shapes into one
desk-context line and renders absence as "" (never a fabricated quiet market).
The topic matrix pins the ROUTING; this pins the FORMATTING against the actual
provider return shapes the signature audit measured (screener row columns,
call_recap_store payload, grade_ticker verdict dict, DPL/GXW envelopes,
cot_narrative rows)."""
import sys
import types

import api.routers.ai_search as ai


def test_ctx_posture_renders_only_non_null(monkeypatch):
    import api.services.screener.snapshot_db as sdb
    row = {"pct_vs_sma20": 4.2, "pct_vs_sma50": 11.0, "pct_vs_sma200": None,
           "dist_52w_high_pct": -3.1, "rsi14": 68.4, "adr_pct": 3.2,
           "rs_rank": None, "uct_composite": 91, "stage2": 1, "stage4": 0,
           "candle_recent_label": "Bullish Engulfing", "candle_recent": "bull_engulf",
           "bar_character_label": None, "bar_character": None,
           "short_float_pct": 2.4, "theme": "AI Infrastructure"}
    monkeypatch.setattr(sdb, "get_row", lambda s: dict(row))
    out = ai._ctx_posture("NVDA")
    assert out.startswith("NVDA technical posture (UCT nightly snapshot):")
    assert "+4.2% vs 20sma" in out and "RSI 68" in out and "Stage 2 uptrend" in out
    assert "UCT composite 91" in out and "Bullish Engulfing" in out
    assert "200sma" not in out and "RS rank" not in out   # NULLs stay absent
    monkeypatch.setattr(sdb, "get_row", lambda s: None)
    assert ai._ctx_posture("NVDA") == ""


def test_ctx_call_recap_reads_store_only(monkeypatch):
    import api.services.call_recap_store as store
    monkeypatch.setattr(store, "get", lambda s, q=None: {
        "headline": "CRM beat and raised on Agentforce momentum",
        "guidance": "raised", "guidance_detail": "FY revenue guide up 2%",
        "bullets": ["Agentforce ARR doubled", "Margins expanded 300bps", "third bullet"],
        "quarter": "2026-Q2"})
    out = ai._ctx_call_recap("CRM")
    assert out.startswith("CRM earnings call (2026-Q2) (UCT transcript-grounded recap):")
    assert "beat and raised" in out and "guidance raised" in out
    assert "Agentforce ARR doubled" in out and "third bullet" not in out
    monkeypatch.setattr(store, "get", lambda s, q=None: None)
    assert ai._ctx_call_recap("CRM") == ""


def test_ctx_verdict_narrates_computed_answer(monkeypatch):
    import api.services.grade_ticker as gt
    monkeypatch.setattr(gt, "grade_ticker", lambda s, **k: {
        "ok": True, "symbol": s, "verdict": "GO", "regime": "GREEN",
        "setup": "High Tight Flag", "grade": "A", "entry": 254.1, "stop": 246.0,
        "first_target": 275.0, "size_pct": 15.0, "account_risk_pct": 0.48,
        "hard_flags": [], "basis": "regime green, A-grade flag, 3.2% stop"})
    out = ai._ctx_verdict("CRM")
    assert "verdict GO" in out and "regime GREEN" in out
    assert "entry 254.1 / stop 246.0 / target 275.0" in out
    assert "size 15.0% (0.48% acct risk)" in out
    assert "deterministic" in out
    monkeypatch.setattr(gt, "grade_ticker", lambda s, **k: {"ok": False, "reason": "x"})
    assert ai._ctx_verdict("CRM") == ""


def test_ctx_verdict_surfaces_hard_flags(monkeypatch):
    import api.services.grade_ticker as gt
    monkeypatch.setattr(gt, "grade_ticker", lambda s, **k: {
        "ok": True, "verdict": "SKIP", "regime": "GREEN", "setup": None,
        "entry": None, "stop": None, "size_pct": None,
        "hard_flags": ["size_unavailable"], "basis": ""})
    out = ai._ctx_verdict("CRM")
    assert "flags: size_unavailable" in out   # a SKIP-for-missing-data reads as that


def test_ctx_levels_never_builds_gxw_cold(monkeypatch):
    import api.routers.signature as sig
    monkeypatch.setattr(sig, "_serve_dpl", lambda s: {
        "levels": [{"price": 182.5, "notional": 240e6, "printCount": 18},
                   {"price": 178.9, "notional": 90e6, "printCount": 7}]})
    import api.services.cache as c
    monkeypatch.setattr(c.cache, "get", lambda k: None)

    class _Stale:
        _slots: dict = {}   # conftest's autouse teardown clears _GXW_STALE._slots

        def peek(self, sym):
            return ({"levels": [{"kind": "callWall", "price": 190.0},
                                {"kind": "zeroGamma", "price": 181.0}],
                     "spot": 185.2}, 900)

    monkeypatch.setattr(sig, "_GXW_STALE", _Stale())
    out = ai._ctx_levels("NVDA")
    assert "dark-pool levels: $182.5 ($240M, 18 prints)" in out
    assert "call wall $190" in out and "zero-gamma $181" in out and "spot $185.2" in out


def test_ctx_levels_failed_dpl_build_renders_nothing(monkeypatch):
    import api.routers.signature as sig
    monkeypatch.setattr(sig, "_serve_dpl", lambda s: {"levels": None, "error": "boom"})
    import api.services.cache as c
    monkeypatch.setattr(c.cache, "get", lambda k: None)

    class _Empty:
        _slots: dict = {}   # conftest's autouse teardown clears _GXW_STALE._slots

        def peek(self, sym):
            return None

    monkeypatch.setattr(sig, "_GXW_STALE", _Empty())
    assert ai._ctx_levels("NVDA") == ""   # levels=None is a FAILED build, not a quiet tape


def test_ctx_earnings_deep_warm_only_quarters(monkeypatch):
    import api.services.screener.snapshot_db as sdb
    monkeypatch.setattr(sdb, "get_row", lambda s: {
        "last_report_move_pct": 22.6, "earnings_setup_grade": "A+",
        "days_to_earnings": None, "next_earnings_date": None,
        "implied_move_pct": None})
    import api.services.implied_store as istore
    monkeypatch.setattr(istore, "get_implied_history",
                        lambda s, limit=8: [{"pct": 7.8, "report_date": "2026-08-26"}],
                        raising=False)
    import api.services.cache as c
    quarters = [{"quarter": 1, "eps_actual": 2.5, "eps_estimate": 2.4, "eps_surprise_pct": 4.0},
                {"quarter": 2, "eps_actual": 5.9, "eps_estimate": 3.31, "eps_surprise_pct": 78.2},
                {"quarter": 3, "eps_actual": None}]
    monkeypatch.setattr(c.cache, "get",
                        lambda k: quarters if k.startswith("mb_year_earnings_CRM_") else None)
    warmed = []
    monkeypatch.setattr(ai, "_warm_year_earnings_bg", lambda s: warmed.append(s))
    out = ai._ctx_earnings_deep("CRM")
    assert "last report moved +22.6%" in out and "earnings setup grade A+" in out
    assert "prior pre-report implied moves: ±7.8% (2026-08-26)" in out
    assert "Q2 EPS 5.9 vs 3.31e (+78%)" in out
    assert not warmed, "warm cache → no background warm thread"
    # cold quarters cache → background warm kicked, no blocking read
    monkeypatch.setattr(c.cache, "get", lambda k: None)
    out2 = ai._ctx_earnings_deep("CRM")
    assert warmed == ["CRM"] and "recent quarters" not in out2


def test_ctx_cot_reads_cached_narrative(monkeypatch):
    import api.services.cot_narrative as cn
    monkeypatch.setattr(cn, "list_for_symbol", lambda s, limit=1: [{
        "report_date": "2026-08-19",
        "text": "Commercials extended their net short in gold this week..."}])
    out = ai._ctx_cot("what's the COT positioning in gold?")
    assert out.startswith("COT positioning — GC, report week 2026-08-19")
    assert "Commercials extended" in out
    assert ai._ctx_cot("what's the COT positioning in kumquats?") == ""


def test_ctx_wire_reads_exposure_dial(monkeypatch):
    import api.services.engine as engine
    monkeypatch.setattr(engine, "get_breadth", lambda: {
        "exposure": {"score": 112, "note": "Stay aggressive while leaders act right.",
                     "gate_active": False}})
    out = ai._ctx_wire()
    assert "112/150" in out and "Stay aggressive" in out
    monkeypatch.setattr(engine, "get_breadth", lambda: {"exposure": {}})
    assert ai._ctx_wire() == ""


def test_ctx_ticker_news_formats_sentiment(monkeypatch):
    import api.services.polygon_news as pn
    monkeypatch.setattr(pn, "get_news", lambda s, limit=3: {
        "items": [{"title": "CRM crushes Q2 estimates", "ticker_sentiment": "positive"},
                  {"title": "Analysts lift targets", "ticker_sentiment": None}]})
    out = ai._ctx_ticker_news("CRM")
    assert "CRM crushes Q2 estimates [positive]" in out
    assert "Analysts lift targets" in out and "[None]" not in out
