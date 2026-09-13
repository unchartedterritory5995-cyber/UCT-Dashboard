import importlib


def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


def test_put_and_get_confirmed(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
                   "confirmed": 1, "vision_confidence": 82.0, "rationale": "tight contractions",
                   "key_level": 184.0, "raw_confidence": 0.6, "model": "claude-opus-4-8",
                   "signals_hash": "abc", "judged_at": 1})
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "bull_flag", "asof_date": "2026-06-19",
                   "confirmed": 0, "vision_confidence": 20.0, "rationale": "no pole",
                   "signals_hash": "def", "judged_at": 1})
    # `today` is pinned because get_confirmed now applies a recency bound; this
    # fixture's asof_date is 2026-06-19 and would otherwise age out.
    conf = s.get_confirmed("NVDA", today="2026-06-20")
    assert len(conf) == 1 and conf[0]["setup"] == "vcp"
    assert conf[0]["rationale"] == "tight contractions"


def _v(s, setup, asof, confirmed, ticker="NVDA", judged_at=1):
    s.put_verdict({"ticker": ticker, "tf": "D", "setup": setup, "asof_date": asof,
                   "confirmed": confirmed, "vision_confidence": 80.0, "rationale": "r",
                   "key_level": 1.0, "raw_confidence": 0.5, "model": "claude-opus-4-8",
                   "signals_hash": setup + asof, "judged_at": judged_at})


def test_latest_rejected_hides_older_confirm(tmp_path, monkeypatch):
    """The D1 defect: confirmed on an older bar, rejected on the newest one.
    Filtering confirmed=1 first would serve the stale confirm as current."""
    s = _fresh(tmp_path, monkeypatch)
    _v(s, "vcp", "2026-09-04", 1)
    _v(s, "vcp", "2026-09-08", 0)      # newer evidence says it is no longer valid
    assert s.get_confirmed("NVDA", today="2026-09-09") == []


def test_confirmed_outside_window_not_served(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    _v(s, "vcp", "2026-06-19", 1)      # months old, nothing newer ever written
    assert s.get_confirmed("NVDA", today="2026-09-09") == []


def test_ingestion_lag_case_is_served(tmp_path, monkeypatch):
    """Wed 09:00: bars had not rolled, so the newest bar judged is Friday's.
    Inside the window, so it must still be served."""
    s = _fresh(tmp_path, monkeypatch)
    _v(s, "bull_flag", "2026-09-04", 1)
    out = s.get_confirmed("NVDA", today="2026-09-09")
    assert len(out) == 1 and out[0]["asof_date"] == "2026-09-04"


def test_per_setup_latest_is_independent(tmp_path, monkeypatch):
    """Latest-per-key is per SETUP, not per ticker: one setup going stale must
    not drag a different setup's fresh confirm out of the result."""
    s = _fresh(tmp_path, monkeypatch)
    _v(s, "vcp", "2026-09-04", 1)
    _v(s, "vcp", "2026-09-08", 0)      # vcp invalidated
    _v(s, "bull_flag", "2026-09-08", 1)  # bull_flag still good
    out = s.get_confirmed("NVDA", today="2026-09-09")
    assert [r["setup"] for r in out] == ["bull_flag"]


def test_window_boundary_is_inclusive(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    floor = s.confirmed_window_floor("2026-09-09")
    assert floor == "2026-09-02"                     # exactly K=7 days back
    _v(s, "vcp", floor, 1)
    assert len(s.get_confirmed("NVDA", today="2026-09-09")) == 1
    other = tmp_path / "b"
    other.mkdir()
    s2 = _fresh(other, monkeypatch)
    _v(s2, "vcp", "2026-09-01", 1)                   # one day past the floor
    assert s2.get_confirmed("NVDA", today="2026-09-09") == []


def test_guard_is_not_vacuous(tmp_path, monkeypatch):
    """Control: the same fixtures MUST be visible without the two rules, so a
    green suite cannot mean the filter was silently removed."""
    s = _fresh(tmp_path, monkeypatch)
    _v(s, "vcp", "2026-09-04", 1)
    _v(s, "vcp", "2026-09-08", 0)
    _v(s, "flat_base", "2026-06-19", 1)
    with s.connect() as c:
        raw = c.execute("SELECT COUNT(*) FROM pattern_verdicts WHERE confirmed=1").fetchone()[0]
    assert raw == 2, "fixtures must contain confirmed rows the filter is expected to reject"
    assert s.get_confirmed("NVDA", today="2026-09-09") == []


def test_cost_guard(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "1.00")
    s = _fresh(tmp_path, monkeypatch)
    assert s.may_judge("2026-06-19") is True
    s.log_cost("2026-06-19", "NVDA", "claude-opus-4-8", 1000, 200, 0.90)
    assert s.cost_today("2026-06-19") == 0.90
    assert s.may_judge("2026-06-19") is True
    s.log_cost("2026-06-19", "AAPL", "claude-opus-4-8", 1000, 200, 0.20)
    assert s.may_judge("2026-06-19") is False  # 1.10 >= 1.00


def test_recent_verdicts_includes_rejected_and_feedback(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
                   "confirmed": 1, "vision_confidence": 80, "rationale": "ok",
                   "signals_hash": "a", "judged_at": 5})
    s.put_verdict({"ticker": "TSLA", "tf": "D", "setup": "bull_flag", "asof_date": "2026-06-19",
                   "confirmed": 0, "vision_confidence": 30, "rationale": "weak",
                   "signals_hash": "b", "judged_at": 6})
    s.record_feedback("TSLA", "D", "bull_flag", "2026-06-19", "down", note="missed the pole")
    recent = s.get_recent_verdicts(limit=10)
    assert {r["setup"] for r in recent} == {"vcp", "bull_flag"}  # both confirmed + rejected
    tsla = next(r for r in recent if r["ticker"] == "TSLA")
    assert tsla["feedback"]["rating"] == "down" and tsla["feedback"]["note"] == "missed the pole"


def test_exemplar_roundtrip_and_delete(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    eid = s.add_exemplar("vcp", b"\x89PNGideal", ticker="NVDA", asof_date="2026-06-19",
                         note="this is the ideal coil", drawings_json='[]', by_user="u1")
    assert s.exemplar_pngs("vcp") == [b"\x89PNGideal"]
    meta = s.list_exemplars("vcp")
    assert len(meta) == 1 and meta[0]["note"] == "this is the ideal coil"
    assert "png" not in meta[0]  # blob excluded from listing
    s.delete_exemplar(eid)
    assert s.exemplar_pngs("vcp") == []


def test_feedback_source_and_list(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    s.record_feedback("NVDA", "D", "vcp", "2026-06-19", "up", source="chart")
    s.record_feedback("AAPL", "D", "scan:pullback", "2026-06-19", "down",
                      note="extended", source="scanner")
    scanner = s.list_feedback(source="scanner")
    assert len(scanner) == 1 and scanner[0]["ticker"] == "AAPL"
    assert scanner[0]["source"] == "scanner" and scanner[0]["note"] == "extended"
    assert len(s.list_feedback()) == 2  # both, unfiltered
