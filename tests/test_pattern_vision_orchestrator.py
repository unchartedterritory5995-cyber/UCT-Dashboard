import datetime
import importlib


def _setup(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    import api.services.pattern_vision.orchestrator as orch
    importlib.reload(orch)
    return s, orch


def test_judge_ticker_confirms_and_stores(tmp_path, monkeypatch):
    s, orch = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6, "asof_date": "2026-06-19"}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    monkeypatch.setattr(orch.chart_render, "render_chart", lambda bars, **k: b"\x89PNGx")
    monkeypatch.setattr(orch.vision_judge, "judge",
                        lambda setup, png, client=None, **kw: {"confirmed": True, "confidence": 80,
                        "reason": "tight", "key_level": 10.0, "model": "claude-opus-4-8",
                        "checks": [{"criterion": "tight contractions", "passed": True}],
                        "usage": {"input_tokens": 1000, "output_tokens": 100}})
    out = orch.judge_ticker("NVDA", client=object())
    assert out["judged"] == 1 and out["confirmed"] == 1
    conf = s.get_confirmed("NVDA")[0]
    assert conf["setup"] == "vcp"
    assert conf["checks"][0]["criterion"] == "tight contractions"  # decoded back to list
    out2 = orch.judge_ticker("NVDA", client=object())
    assert out2["skipped"] == 1 and out2["judged"] == 0


def test_low_confidence_is_gated_not_confirmed(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_MIN_CONFIDENCE", "70")
    s, orch = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6,
                                            "asof_date": "2026-06-19", "key_level": 10.0}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    monkeypatch.setattr(orch.chart_render, "render_chart", lambda bars, **k: b"\x89PNGx")
    # model confirms but at only 55 confidence (< 70 floor) → must NOT confirm
    monkeypatch.setattr(orch.vision_judge, "judge",
                        lambda setup, png, client=None, **kw: {"confirmed": True, "confidence": 55,
                        "reason": "borderline", "key_level": None, "checks": [],
                        "model": "claude-opus-4-8", "usage": {"input_tokens": 1, "output_tokens": 1}})
    out = orch.judge_ticker("NVDA", client=object())
    assert out["judged"] == 1 and out["confirmed"] == 0
    assert s.get_confirmed("NVDA") == []


def test_cost_cap_blocks_judging(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "0.00")
    s, orch = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6, "asof_date": "2026-06-19"}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    out = orch.judge_ticker("NVDA", client=object())
    assert out["cost_capped"] is True and out["judged"] == 0


def test_signals_hash_ignores_developing_last_bar():
    """The judge must not re-judge every hour just because the live daily
    candle wiggled: the hash keys off the last CLOSED bar, so intraday
    mutations of bars[-1] are stable, while a newly closed bar re-judges."""
    from api.services.pattern_vision.orchestrator import _signals_hash

    closed = [("2026-07-01", 10, 12, 9, 11, 1000)]
    live_10am = closed + [("2026-07-02", 11, 11.5, 10.8, 11.2, 200)]
    live_3pm = closed + [("2026-07-02", 11, 13.0, 10.8, 12.9, 900)]

    # Same closed history, different developing candle -> same hash (skip)
    assert _signals_hash("NVDA", "VCP", live_10am) == _signals_hash("NVDA", "VCP", live_3pm)

    # A new bar CLOSES (yesterday's live bar joins the closed history) -> new hash
    next_day = live_3pm + [("2026-07-03", 13, 14, 12.5, 13.8, 300)]
    assert _signals_hash("NVDA", "VCP", live_3pm) != _signals_hash("NVDA", "VCP", next_day)

    # Degenerate inputs stay safe
    assert _signals_hash("NVDA", "VCP", [])
    assert _signals_hash("NVDA", "VCP", closed)


# ── Holiday / evidence-date defect fix (owner authorization, 2026-09-05) ────
#
# asof_date used to be datetime.date.today().isoformat(): on a weekday market
# holiday (no new session, evidence bar unchanged from the prior real trading
# day) the calendar date still advanced, minting a dedup key that never
# matched the prior verdict -- a real paid re-judgment of unchanged evidence,
# persisted under a misleading holiday date. These tests pin the fix: the
# dedup identity (asof_date + signals_hash) must track the EVIDENCE BAR, not
# wall-clock date.

def _freeze_today(monkeypatch, orch, y, m, d):
    """Fixes orchestrator.datetime.date.today() without touching
    datetime.datetime (orchestrator._evidence_date's intraday-tf fallback
    uses the latter, and must keep working normally)."""
    frozen = type("_Frozen", (datetime.date,), {})
    frozen.today = classmethod(lambda cls, _y=y, _m=m, _d=d: cls(_y, _m, _d))
    monkeypatch.setattr(orch.datetime, "date", frozen)


def _bar(ts, c=100.0):
    return (ts, c, c + 1, c - 1, c, 1000)


def test_evidence_date_normal_day_uses_last_closed_bar_not_wallclock(monkeypatch):
    """Scenario 1 -- normal day: a real new session closed. The evidence date
    must come from that closed bar, and must NOT drift if wall-clock 'today'
    disagrees with it (e.g. a late-running cron after midnight UTC)."""
    from api.services.pattern_vision import orchestrator as orch
    _freeze_today(monkeypatch, orch, 2026, 9, 8)  # wall-clock says Tue

    bars = [_bar(20260901), _bar(20260902), _bar(20260903), _bar(20260904)]
    assert orch._evidence_bar(bars) == bars[-2]
    assert orch._evidence_date(bars) == "2026-09-03"  # bars[-2]'s own date, not "2026-09-08"


def test_evidence_date_stable_across_a_weekday_holiday_with_no_new_session(monkeypatch):
    """Scenario 2 -- holiday / no new session: Labor Day 2026-09-07 is a
    Monday, the weekday-only cron still fires, but no new bar closed. The
    provider's bars list is IDENTICAL to Friday's, so the evidence date (and
    the dedup hash) must be identical too -- this is the exact defect: the old
    code minted a NEW asof_date ("2026-09-07") off wall-clock alone, which
    never matched Friday's persisted verdict and re-triggered a paid judge."""
    from api.services.pattern_vision import orchestrator as orch

    bars = [_bar(20260901), _bar(20260902), _bar(20260903), _bar(20260904)]  # unchanged by the holiday

    _freeze_today(monkeypatch, orch, 2026, 9, 4)  # Friday afternoon run
    friday_date = orch._evidence_date(bars)
    friday_hash = orch._signals_hash("NVDA", "vcp", bars)

    _freeze_today(monkeypatch, orch, 2026, 9, 7)  # Labor Day run, same unchanged bars
    monday_date = orch._evidence_date(bars)
    monday_hash = orch._signals_hash("NVDA", "vcp", bars)

    assert friday_date == monday_date == "2026-09-03", (
        "evidence date must not move on a holiday with no new session"
    )
    assert friday_hash == monday_hash, "dedup hash must not move either -- this is what stops the re-judge"


def test_evidence_date_advances_when_a_new_bar_actually_closes(monkeypatch):
    """Scenario 3 -- same-date-new-evidence: hold wall-clock 'today' FIXED
    across both calls to prove the date is evidence-driven, not date-driven,
    then show that a genuinely new closed bar advances asof_date AND the
    dedup hash together (they must never disagree about which bar is being
    judged)."""
    from api.services.pattern_vision import orchestrator as orch
    _freeze_today(monkeypatch, orch, 2026, 9, 8)  # same wall-clock date both times

    before = [_bar(20260901), _bar(20260902), _bar(20260903), _bar(20260904)]
    after = before + [_bar(20260908)]  # a genuinely new session closed

    date_before, hash_before = orch._evidence_date(before), orch._signals_hash("NVDA", "vcp", before)
    date_after, hash_after = orch._evidence_date(after), orch._signals_hash("NVDA", "vcp", after)

    assert date_before == "2026-09-03" and date_after == "2026-09-04"
    assert hash_before != hash_after


def test_evidence_date_falls_back_to_today_only_when_no_bars_exist(monkeypatch):
    """Existing-safety-invariant: the wall-clock fallback is defensive only
    (candidates_for already returns [] before any bar-less path is reached),
    and must never raise on degenerate input."""
    from api.services.pattern_vision import orchestrator as orch
    _freeze_today(monkeypatch, orch, 2026, 9, 7)

    assert orch._evidence_date([]) == "2026-09-07"
    assert orch._evidence_bar([]) is None
    # A single-bar list has no closed prior bar to fall back on -- uses the only bar there is.
    assert orch._evidence_date([_bar(20260904)]) == "2026-09-04"


def test_stale_provider_data_across_simulated_holiday_yields_zero_paid_judge_calls(tmp_path, monkeypatch):
    """Scenario 4 -- stale-provider-data / holiday end-to-end through
    judge_ticker: a verdict already exists for Friday's evidence bar. The
    Monday-holiday cron fires against the SAME unchanged bars/candidates and
    must skip -- zero Opus calls, zero spend -- rather than re-judging."""
    s, orch = _setup(tmp_path, monkeypatch)
    bars = [_bar(20260901), _bar(20260902), _bar(20260903), _bar(20260904)]
    asof = orch._evidence_date(bars)
    sig = orch._signals_hash("NVDA", "vcp", bars)

    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: bars)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6,
                                            "asof_date": asof, "key_level": 10.0}])

    def _fail_if_called(*a, **k):
        raise AssertionError("vision_judge.judge must not be called on a stale-data holiday cycle")
    monkeypatch.setattr(orch.vision_judge, "judge", _fail_if_called)

    # Friday's real judge already ran and persisted a verdict at this evidence identity.
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": asof,
                   "confirmed": 1, "vision_confidence": 80.0, "rationale": "tight",
                   "key_level": 10.0, "raw_confidence": 0.6, "model": "claude-opus-4-8",
                   "signals_hash": sig, "judged_at": 0, "checks": "[]"})

    _freeze_today(monkeypatch, orch, 2026, 9, 7)  # Labor Day cron fires, provider unchanged
    out = orch.judge_ticker("NVDA", client=object())
    assert out == {"judged": 0, "confirmed": 0, "skipped": 1, "cost_capped": False}


def test_persisted_verdict_asof_date_reflects_evidence_and_cost_day_stays_wallclock(tmp_path, monkeypatch):
    """Scenario 5 -- persisted-verdict-date-correctness, plus scenario 6 --
    existing-safety-invariants-unchanged: the stored verdict's asof_date must
    be the EVIDENCE date (Friday), even though the cron actually runs on the
    Monday holiday, while the daily COST-CAP bookkeeping (a deliberately
    separate concern) must stay keyed on wall-clock 'today' -- conflating the
    two would either double-count spend across the real calendar day or hide
    it under the wrong evidence date."""
    s, orch = _setup(tmp_path, monkeypatch)
    bars = [_bar(20260901), _bar(20260902), _bar(20260903), _bar(20260904)]
    asof = orch._evidence_date(bars)  # "2026-09-03", computed before freezing "today"

    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: bars)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6,
                                            "asof_date": orch._evidence_date(bars), "key_level": 10.0}])
    monkeypatch.setattr(orch.chart_render, "render_chart", lambda bars, **k: b"\x89PNGx")
    monkeypatch.setattr(orch.vision_judge, "judge",
                        lambda setup, png, client=None, **kw: {"confirmed": True, "confidence": 80,
                        "reason": "tight", "key_level": 10.0, "model": "claude-opus-4-8",
                        "checks": [], "usage": {"input_tokens": 1000, "output_tokens": 100}})

    _freeze_today(monkeypatch, orch, 2026, 9, 7)  # Labor Day: wall-clock != evidence date
    out = orch.judge_ticker("NVDA", client=object())
    assert out["judged"] == 1 and out["confirmed"] == 1

    verdict = s.get_verdict("NVDA", "D", "vcp", asof)
    assert verdict is not None, "verdict must be persisted under the EVIDENCE date, not wall-clock today"
    assert verdict["asof_date"] == "2026-09-03"

    # The cost-cap/spend ledger is a distinct concern keyed on the real calendar
    # day the judge call was actually billed on -- must remain "2026-09-07",
    # never silently pulled onto the evidence date by this fix.
    with s.connect() as c:
        row = c.execute("SELECT day FROM vision_cost_log WHERE ticker='NVDA'").fetchone()
    assert row[0] == "2026-09-07"


def test_candidates_for_itself_wires_evidence_date_not_wallclock(tmp_path, monkeypatch):
    """Exercises the REAL candidates_for() body (not a stand-in lambda) to
    prove the wiring fix landed there, not just in the helper functions it
    calls -- a future edit could re-wire the pattern-detection path back onto
    datetime.date.today() while every _evidence_date unit test stayed green."""
    _, orch = _setup(tmp_path, monkeypatch)
    # candidates_for requires >=30 bars; pad with older filler, keep the last two real.
    bars = [_bar(20260701 + i) for i in range(30)] + [_bar(20260903), _bar(20260904)]

    import api.services.pattern_engine as pattern_engine
    from api.services.pattern_engine.primitives import context as pe_context
    monkeypatch.setattr(pattern_engine, "detect_all",
                        lambda bars, ctx, pattern_ids=None: [
                            {"pattern_id": "vcp", "confidence": 72.0, "levels": {"entry": 105.0}}])
    monkeypatch.setattr(pe_context, "build_context", lambda bars_list, sym=None: {})
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: bars)

    _freeze_today(monkeypatch, orch, 2026, 9, 7)  # Labor Day: wall-clock disagrees with the evidence bar
    cands = orch.candidates_for("NVDA")
    assert len(cands) == 1
    assert cands[0]["asof_date"] == "2026-09-03", (
        "candidates_for must derive asof_date from the evidence bar, not datetime.date.today()"
    )
